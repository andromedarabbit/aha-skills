#!/usr/bin/env node
// ego-post.mjs - social-posting의 ego lite(ego-browser CLI) 실행 계층.
//
// aside exec(자연어)와 달리 ego CLI는 고정 JS 스크립트를 stdin으로 받아 JSON 1줄을
// 돌려준다. 이 모듈은 그 계약 위에 4개 서브커맨드를 제공한다:
//   setup     --platform <p> [--force]   신원 획득 + binding 저장 (Stage 2)
//   bootstrap --platform <p> [--count N] 최근 게시물 verbatim 수집 (Stage 4)
//   post      (payload JSON on stdin)    게시 실행 (publish.sh가 호출 — 유일한 경로)
//   readback  (payload JSON on stdin)    게시 URL 본문 일치 검증 (Stage 10)
//
// 안전 모델: ego에는 권한 엔진이 없다. 안전장치는 전부 이 모듈과 publish.sh의
// 승인 digest 가드가 담당한다. 고정 스크립트는 소유·양도·생명주기 계열 ego API를
// 일절 호출하지 않는다(테스트가 정규식으로 강제 — ego-post.test.mjs 참조).
//
// 스크립트 함수는 fn.toString()으로 ego 자식에 주입되므로 바깥 스코프를 참조하지
// 않는다. 입력은 데이터(JSON)로만 주입된다. 플랫폼 DOM 셀렉터는 첫 실측(2026-11)
// 기준의 보수적 추정이며 — 실측 전 표시된 주석 참조 — 기명 실패 코드로만 갈린다.
//
// Usage 상세는 docs/REFERENCE.md "ego 실행 계약".

import { spawn, execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_OUTPUT = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 125000;
const MAX_TIMEOUT_MS = 570000; // 하네스 Bash 전경 호출 상한(600s)보다 여유 있게 아래

export const EGO_FAILURE_REASONS = Object.freeze([
  'EGO_SPAWN_FAILED', 'EGO_PROCESS_FAILED', 'EGO_STDIN_FAILED', 'EGO_STDOUT_FAILED', 'EGO_STDERR_FAILED',
  'EGO_TIMEOUT', 'EGO_STDOUT_LIMIT', 'EGO_STDERR_LIMIT', 'EGO_EXIT_FAILED', 'EGO_CONNECT_FAILED',
  'EGO_UTF8_INVALID', 'EGO_JSON_INVALID', 'EGO_SCHEMA_INVALID',
]);

// 게시 단계 사유 코드 — publish.sh가 사용자에게 그대로 보여준다.
export const POST_STEP_CODES = Object.freeze([
  'EGO_SPACE_FAILED', 'EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED',
  'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_ACCOUNT_MISMATCH', 'EGO_SCHEMA_INVALID',
  'EGO_EVAL_STOPPED', 'EGO_COMPOSER_NOT_FOUND', 'EGO_READBACK_MISMATCH',
  'EGO_MEDIA_FAILED', 'EGO_VISIBILITY_FAILED', 'EGO_POST_BUTTON_NOT_FOUND',
  'EGO_EVIDENCE_MISSING', 'EGO_IDENTITY_NOT_FOUND',
]);

export const PLATFORMS = Object.freeze(['x', 'linkedin', 'facebook', 'bluesky']);
export const TASK_SPACE_NAME = 'social-posting-skill';
export const TRANSPORT = 'ego-post/1';

const fail = (code, reason) => Object.assign(new Error(reason ?? code), { code, reason });

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validString(value, limit) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
}

// ── 실행파일 발견·버전 ────────────────────────────────────────────────
// SOCIAL_EGO_EXECUTABLE 오버라이드 → PATH의 ego-browser. 절대경로만 binding에 저장한다.
export function discoverExecutable(env = process.env) {
  if (validString(env.SOCIAL_EGO_EXECUTABLE, 4096) && isAbsolute(env.SOCIAL_EGO_EXECUTABLE)) {
    return env.SOCIAL_EGO_EXECUTABLE;
  }
  let onPath;
  try { onPath = execFileSync('/usr/bin/which', ['ego-browser'], { encoding: 'utf8', env: { PATH: env.PATH } }).trim(); } catch { return null; }
  return onPath && isAbsolute(onPath) ? onPath : null;
}

export function egoVersion(executable) {
  try {
    return execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 15000 }).split('\n')[0].trim().slice(0, 64);
  } catch { return ''; }
}

// ── binding (상태 디렉토리는 런타임에 확정 — 스킬은 절대경로를 모른다) ──
export function stateDir(env = process.env) {
  if (validString(env.SOCIAL_EGO_STATE_DIR, 4096) && isAbsolute(env.SOCIAL_EGO_STATE_DIR)) {
    return env.SOCIAL_EGO_STATE_DIR;
  }
  const home = env.HOME;
  if (!validString(home, 4096)) throw fail('INVALID_ARGUMENT', 'HOME이 없다');
  return join(home, '.local', 'share', 'aha-skills', 'social-posting');
}

export function readBinding(env = process.env) {
  try {
    const raw = readFileSync(join(stateDir(env), 'binding.json'), 'utf8');
    const value = JSON.parse(raw);
    if (!exactKeys(value, ['transport', 'executable', 'taskSpaceName', 'egoVersion', 'identity'])) return null;
    if (value.transport !== TRANSPORT) return null;
    if (!validString(value.executable, 4096) || !isAbsolute(value.executable)) return null;
    if (!validString(value.taskSpaceName, 512)) return null;
    if (typeof value.egoVersion !== 'string') return null;
    if (value.identity === null || typeof value.identity !== 'object' || Array.isArray(value.identity)) return null;
    if (!Object.entries(value.identity).every(([p, id]) => PLATFORMS.includes(p) && validString(String(id), 256))) return null;
    return value;
  } catch { return null; }
}

function writeBinding(binding, env = process.env) {
  const dir = stateDir(env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'binding.json'), JSON.stringify(binding, null, 2) + '\n');
}

// ── ego 자식 실행 계약 (ego-ui.mjs 검증 스켈레톤 이식) ─────────────────
// stdout에 내용이 있으면 그것만 엄격히 검증하고(미래 계약 변경 대비), 비어 있으면
// stderr에서 정확히 한 줄 JSON + [ego-browser:notice] 공지만 허용한다(0.6.3.14 실측:
// 파이프 스크립트의 console.log는 stderr로 우회된다).
export function execute(executable, script, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!validString(executable, 4096) || !isAbsolute(executable)) throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > MAX_TIMEOUT_MS) throw fail('INVALID_ARGUMENT');
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CI: '1', NO_COLOR: '1' };
  for (const key of ['HOME', 'LANG', 'LC_ALL', 'TZ']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, ['nodejs'], { env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { reject(fail('EGO_PROCESS_FAILED', 'EGO_SPAWN_FAILED')); return; }
    let settled = false;
    let spawned = false;
    let output = [];
    let stderrOutput = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    const finish = (reason, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output = [];
      if (reason) { reject(fail('EGO_PROCESS_FAILED', reason)); return; }
      resolve(value);
    };
    const abort = reason => {
      if (settled) return;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
      finish(reason);
    };
    const timer = setTimeout(() => abort('EGO_TIMEOUT'), timeoutMs);
    child.on('spawn', () => { spawned = true; });
    child.on('error', () => abort(spawned ? 'EGO_PROCESS_FAILED' : 'EGO_SPAWN_FAILED'));
    child.stdin.on('error', () => abort('EGO_STDIN_FAILED'));
    child.stdout.on('error', () => abort('EGO_STDOUT_FAILED'));
    child.stderr.on('error', () => abort('EGO_STDERR_FAILED'));
    child.stdout.on('data', chunk => {
      if (settled) return;
      stdoutSize += chunk.length;
      if (stdoutSize > MAX_OUTPUT) { abort('EGO_STDOUT_LIMIT'); return; }
      output.push(chunk);
    });
    child.stderr.on('data', chunk => {
      if (settled) return;
      stderrSize += chunk.length;
      if (stderrSize > MAX_OUTPUT) { abort('EGO_STDERR_LIMIT'); return; }
      stderrOutput.push(chunk);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (signal) { finish('EGO_EXIT_FAILED'); return; }
      if (code !== 0) { finish('EGO_CONNECT_FAILED'); return; }
      let stdoutText;
      try { stdoutText = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output)); }
      catch { finish('EGO_UTF8_INVALID'); return; }
      if (stdoutText.trim()) {
        let value;
        try { value = JSON.parse(stdoutText); }
        catch { finish('EGO_JSON_INVALID'); return; }
        finish(null, value);
        return;
      }
      let stderrText;
      try { stderrText = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stderrOutput)); }
      catch { finish('EGO_UTF8_INVALID'); return; }
      const jsonLines = [];
      for (const raw of stderrText.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (line.includes('[ego-browser:notice]')) continue;
        let value;
        try { value = JSON.parse(line); }
        catch { finish('EGO_JSON_INVALID'); return; }
        jsonLines.push(value);
      }
      if (jsonLines.length !== 1) { finish('EGO_JSON_INVALID'); return; }
      finish(null, jsonLines[0]);
    });
    child.stdin.end(script, 'utf8');
  });
}

// 부모 측 결과 규약: 자식이 {status: <POST_STEP_CODES>}만 돌려주면 그 코드로 안전 실패.
function stepFail(output) {
  if (exactKeys(output, ['status']) && POST_STEP_CODES.includes(output.status)) throw fail(output.status);
}

// ── setup: 플랫폼별 신원 획득 고정 스크립트 ──────────────────────────
// 실측 전 주석: 각 플랫폼 신원 추출 셀렉터는 첫 실환경 실행(측정) 전까지 보수적 추정이다.

async function childAcquireIdentityX(spaceName) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    await page.goto('https://x.com/home', { timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const url = await page.url();
    const u = new URL(url);
    if (u.hostname !== 'x.com' && u.hostname !== 'twitter.com') stop('EGO_ORIGIN_MISMATCH');
    const probe = await page.evaluate(() => ({
      hasLogin: !!document.querySelector('input[autocomplete="username"], input[name="session[username_or_email]"]'),
      // 실측(2026-11-14): 로그아웃 상태의 x.com/home는 랜딩으로 리다이렉트되고 로그인 폼이
      // 아니라 "Sign in" 링크가 있다 — 링크 기반 탐지까지 병행한다.
      hasSignInLink: [...document.querySelectorAll('a, button')].some(e => /^(sign in|로그인)$/i.test((e.textContent || '').trim())),
      profileHref: document.querySelector('a[data-testid="AppTabBar_Profile_Link"], a[aria-label][href^="/"][data-testid]')?.getAttribute('href') || null,
    }));
    if (probe?.hasLogin || probe?.hasSignInLink) stop('EGO_NEEDS_LOGIN');
    const m = probe?.profileHref && /^\/([A-Za-z0-9_]{1,20})$/.exec(probe.profileHref);
    if (!m) stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity: m[1] }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

async function childAcquireIdentityLinkedin(spaceName) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    await page.goto('https://www.linkedin.com/in/me/', { timeout: 45000 });
    // /in/me는 SPA 리다이렉트로 slug 확정이 늦다(linkedin-followup G2 실측) — 리다이렉트 완료를 기다린다.
    try { await page.waitForFunction(() => /^\/in\/(?!me\/?$)[^/]+/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
    const url = await page.url();
    const u = new URL(url);
    if (u.origin !== 'https://www.linkedin.com') stop('EGO_ORIGIN_MISMATCH');
    if (/^\/(login|authwall|checkpoint)/.test(u.pathname)) stop('EGO_NEEDS_LOGIN');
    const slug = /^\/in\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
    if (!slug || slug === 'me') stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity: slug }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

async function childAcquireIdentityFacebook(spaceName) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    await page.goto('https://www.facebook.com/me/', { timeout: 45000 });
    try { await page.waitForFunction(() => !/^\/me\/?$/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
    const url = await page.url();
    const u = new URL(url);
    if (u.hostname !== 'www.facebook.com' && u.hostname !== 'facebook.com') stop('EGO_ORIGIN_MISMATCH');
    if (/^\/(login|checkpoint)/.test(u.pathname)) stop('EGO_NEEDS_LOGIN');
    // /me 는 프로필 경로(/profile.php?id=… | /<vanity>)로 리다이렉트된다. 그 경로 자체가 신원이다.
    const path = u.pathname.replace(/\/+$/, '');
    if (!path || path === '/me') stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity: path.slice(1) }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

async function childAcquireIdentityBluesky(spaceName) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    await page.goto('https://bsky.app/', { timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const url = await page.url();
    const u = new URL(url);
    if (u.origin !== 'https://bsky.app') stop('EGO_ORIGIN_MISMATCH');
    if (/^\/login/.test(u.pathname)) stop('EGO_NEEDS_LOGIN');
    const probe = await page.evaluate(() => {
      const link = document.querySelector('a[href^="/profile/"][href*="did:plc:"], a[data-testid^="profile"], a[aria-label*="rofile" i][href^="/profile/"]');
      return { href: link?.getAttribute('href') || null };
    });
    const m = probe?.href && /^\/profile\/([^/?#]+)/.exec(probe.href);
    if (!m) stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity: decodeURIComponent(m[1]) }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

const IDENTITY_SCRIPTS = Object.freeze({
  x: childAcquireIdentityX,
  linkedin: childAcquireIdentityLinkedin,
  facebook: childAcquireIdentityFacebook,
  bluesky: childAcquireIdentityBluesky,
});

// ── bootstrap: 최근 게시물 verbatim 수집 (Stage 4 보이스 프로필 원본) ──

async function childBootstrap(spaceName, platform, spec) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    const collected = [];
    const seen = new Set();
    const extractors = {
      x: () => page.evaluate(() => [...document.querySelectorAll('article[data-testid="tweet"]')].map(a => {
        const text = (a.querySelector('[data-testid="tweetText"]')?.innerText ?? '').trim();
        const href = a.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href') || null;
        const time = a.querySelector('time')?.getAttribute('datetime') || null;
        return { text, href, time };
      }).filter(p => p.text)),
      linkedin: () => page.evaluate(() => [...document.querySelectorAll('[data-urn*="ugcPost:"]')].map(a => ({
        text: (a.querySelector('.update-components-text, [dir="ltr"] span')?.innerText ?? '').trim(),
        href: a.querySelector('a[href*="ugcPost"]')?.getAttribute('href') || null,
        time: a.querySelector('time')?.getAttribute('datetime') || null,
      })).filter(p => p.text)),
      facebook: () => page.evaluate(() => [...document.querySelectorAll('div[data-ad-comet-preview], div[role="article"]')].map(a => {
        const story = a.querySelector('div[data-ad-preview="message"], div[dir="auto"] > span')?.closest('div[dir="auto"]');
        const text = (story?.innerText ?? '').trim();
        const href = a.querySelector('a[href*="/posts/"], a[href*="story_fbid"]')?.getAttribute('href') || null;
        return { text, href, time: null };
      }).filter(p => p.text)),
      bluesky: () => page.evaluate(() => [...document.querySelectorAll('div[data-testid^="feedItem"]')].map(a => {
        const record = a.querySelector('div[data-testid="postText"]')?.innerText ?? '';
        const href = a.querySelector('a[href*="/post/"] time')?.closest('a')?.getAttribute('href') || null;
        const time = a.querySelector('time')?.getAttribute('datetime') || null;
        return { text: record.trim(), href, time };
      }).filter(p => p.text)),
    };
    const profileUrlFor = {
      x: id => 'https://x.com/' + id,
      linkedin: id => 'https://www.linkedin.com/in/' + id + '/recent-activity/all/',
      facebook: id => 'https://www.facebook.com/' + id,
      bluesky: id => 'https://bsky.app/profile/' + id,
    };
    if (!extractors[platform]) stop('EGO_SCHEMA_INVALID');
    await page.goto(profileUrlFor[platform](spec.identity), { timeout: 45000 });
    try { await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 200, undefined, { timeout: 20000 }); } catch {}
    const deadline = Date.now() + 60000;
    let stableRounds = 0;
    let lastCount = -1;
    while (Date.now() < deadline && collected.length < spec.max) {
      const found = await extractors[platform]();
      for (const item of found) {
        const key = norm(item.text).slice(0, 80);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        collected.push({ text: item.text, url: item.href, time: item.time });
      }
      if (collected.length === lastCount) {
        stableRounds += 1;
        if (stableRounds >= 3) break;
      } else stableRounds = 0;
      lastCount = collected.length;
      await page.mouse.move(200, 300);
      await page.mouse.wheel(0, 1200);
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(JSON.stringify({ status: 'BOOTSTRAP_OBSERVED', posts: collected.slice(0, spec.max) }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

// ── post: 게시 실행 고정 스크립트 (플랫폼 공통 흐름 + 플랫폼별 단계) ──
// 흐름: 세그먼트별 (composer 개방 → 본문 삽입·정확 readback → [미디어] → [공개범위] →
// 게시 버튼 1회 → DOM 증거 폴링 → [스레드] 이전 게시물 답글 composer) → 프로필에서
// 퍼마링크 회수(최선). 도중 실패는 증거가 있는 세그먼트까지 PARTIAL_POSTED로 올린다.
//
// shortcut: 플랫폼 DOM 셀렉터는 첫 실측 전 보수적 추정이다 — 기명 실패 코드로만 갈리고,
// 실환경 1회 실행(측정) 후 셀렉터를 교정해야 한다. upgrade: 셀렉터가 안정되면 이 주석을
// 실측 날짜로 바꾼다.

async function childPost(spaceName, platform, segments, media, link, visibility, expectedIdentity) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const urls = [];
  const partial = code => {
    console.log(JSON.stringify(urls.length
      ? { status: 'PARTIAL_POSTED', urls, reason: code }
      : { status: 'POST_FAILED', reason: code }));
  };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();

    // ── 플랫폼 프로파일 (데이터 — 셀렉터는 여기 한 곳에 모은다) ──
    const P = {
      x: {
        origin: 'https://x.com',
        composerUrl: 'https://x.com/compose/post',
        composerSelector: '[data-testid="tweetTextarea_0"]',
        fileInput: 'input[type="file"]',
        attachButton: '[data-testid="addMedia"]',
        mediaPreview: '[data-testid="attachments"]',
        postButton: '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]',
        evidence: async () => {
          const gone = await page.evaluate(() => !document.querySelector('[data-testid="tweetTextarea_0"]'));
          return gone;
        },
        profileUrl: id => 'https://x.com/' + id,
        findPermalink: async text => page.evaluate(want => {
          for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
            const t = norm((a.querySelector('[data-testid="tweetText"]')?.innerText ?? ''));
            if (t === want || t.startsWith(want.slice(0, 40))) {
              const href = a.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href');
              if (href) return href;
            }
          }
          return null;
          function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
        }, norm(text).slice(0, 60)),
        replyOpen: async permalink => {
          await page.goto('https://x.com' + permalink, { timeout: 45000 });
          try { await page.waitForFunction(() => !!document.querySelector('[data-testid="tweetTextarea_0"], [data-testid="reply"]'), undefined, { timeout: 20000 }); } catch {}
          const clicked = await page.evaluate(() => {
            const b = document.querySelector('[data-testid="reply"]');
            if (!b) return false;
            b.click();
            return true;
          });
          if (!clicked) return false;
          await sleep(1200);
          return true;
        },
      },
      bluesky: {
        origin: 'https://bsky.app',
        composerOpen: async () => {
          const clicked = await page.evaluate(() => {
            const b = document.querySelector('button[aria-label*="포스트" i], button[aria-label*="ost" i][aria-label*="ew" i], a[aria-label*="포스트" i][href="/"], button[aria-label="New Post"]');
            if (!b) return false;
            b.click();
            return true;
          });
          if (!clicked) return false;
          await sleep(1200);
          return true;
        },
        composerSelector: 'div[contenteditable="true"][role="textbox"]',
        attachButton: 'button[aria-label*="이미지" i], button[aria-label*="mage" i]',
        mediaPreview: 'img[src^="blob:"], img[alt]',
        postButton: 'button[type="submit"]',
        evidence: async () => {
          const gone = await page.evaluate(() => !document.querySelector('div[contenteditable="true"][role="textbox"]'));
          return gone;
        },
        profileUrl: id => 'https://bsky.app/profile/' + id,
        findPermalink: async text => page.evaluate(want => {
          for (const item of document.querySelectorAll('div[data-testid^="feedItem"]')) {
            const t = norm(item.querySelector('div[data-testid="postText"]')?.innerText ?? '');
            if (t === want || t.startsWith(want.slice(0, 40))) {
              const href = item.querySelector('a[href*="/post/"] time')?.closest('a')?.getAttribute('href');
              if (href) return href;
            }
          }
          return null;
          function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
        }, norm(text).slice(0, 60)),
        replyOpen: async permalink => {
          await page.goto('https://bsky.app' + permalink, { timeout: 45000 });
          try { await page.waitForFunction(() => !!document.querySelector('button[aria-label*="답글" i], button[aria-label*="eply" i]'), undefined, { timeout: 20000 }); } catch {}
          const clicked = await page.evaluate(() => {
            const b = document.querySelector('button[aria-label*="답글" i], button[aria-label*="eply" i]');
            if (!b) return false;
            b.click();
            return true;
          });
          if (!clicked) return false;
          await sleep(1200);
          return true;
        },
      },
      linkedin: {
        origin: 'https://www.linkedin.com',
        composerOpen: async () => {
          const clicked = await page.evaluate(() => {
            const b = document.querySelector('button[data-test-id="share-box-trigger"], button[class*="share-box"]') ||
              [...document.querySelectorAll('button')].find(b => /start a post|게시물 작성|무엇을/i.test(b.innerText || ''));
            if (!b) return false;
            b.click();
            return true;
          });
          if (!clicked) return false;
          await sleep(1500);
          return true;
        },
        composerSelector: '.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]',
        attachButton: 'button[data-test-id="media-add-media"], button[aria-label*="미디어" i], button[aria-label*="Add media" i]',
        mediaPreview: '.share-confirmation, img.preview-image, div[class*="feed-image"]',
        postButton: 'button[class*="share-actions__primary-action"], button.artdeco-button--primary',
        evidence: async () => {
          const gone = await page.evaluate(() => !document.querySelector('.ql-editor[contenteditable="true"]'));
          return gone;
        },
        profileUrl: id => 'https://www.linkedin.com/in/' + id + '/recent-activity/all/',
        findPermalink: async text => page.evaluate(want => {
          for (const a of document.querySelectorAll('[data-urn*="ugcPost:"]')) {
            const t = norm(a.querySelector('.update-components-text')?.innerText ?? (a.querySelector('[dir="ltr"]')?.innerText ?? ''));
            if (t === want || t.startsWith(want.slice(0, 40))) {
              const href = a.querySelector('a[href*="ugcPost"]')?.getAttribute('href');
              if (href) return href;
            }
          }
          return null;
          function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
        }, norm(text).slice(0, 60)),
      },
      facebook: {
        origin: 'https://www.facebook.com',
        composerOpen: async () => {
          const clicked = await page.evaluate(() => {
            const b = [...document.querySelectorAll('div[role="button"], button')].find(b => /생각|your mind|하고 있는지/i.test(b.innerText || b.getAttribute('aria-label') || ''));
            if (!b) return false;
            b.click();
            return true;
          });
          if (!clicked) return false;
          await sleep(1500);
          return true;
        },
        composerSelector: 'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
        attachButton: 'div[aria-label*="사진" i][role="button"], div[aria-label*="hoto" i][role="button"]',
        mediaPreview: 'img[src^="blob:"], img[alt]',
        postButton: 'div[aria-label="게시"][role="button"], div[aria-label="Post"][role="button"], button[type="submit"]',
        evidence: async () => {
          const gone = await page.evaluate(() => !document.querySelector('div[role="dialog"] div[role="textbox"][contenteditable="true"]'));
          return gone;
        },
        profileUrl: id => 'https://www.facebook.com/' + id,
        findPermalink: async text => page.evaluate(want => {
          for (const a of document.querySelectorAll('div[role="article"]')) {
            const story = a.querySelector('div[data-ad-preview="message"], div[dir="auto"] > span')?.closest('div[dir="auto"]');
            const t = norm(story?.innerText ?? '');
            if (t === want || t.startsWith(want.slice(0, 40))) {
              const href = a.querySelector('a[href*="/posts/"], a[href*="story_fbid"]')?.getAttribute('href');
              if (href) return href;
            }
          }
          return null;
          function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
        }, norm(text).slice(0, 60)),
      },
    };
    const cfg = P[platform];
    if (!cfg) stop('EGO_SCHEMA_INVALID');

    // ── 라이브 신원 확인 (binding과 불일치면 게시 전 차단 — 계정 재타깃 방지) ──
    const loginCheck = async () => {
      const u = new URL(await page.url());
      if (u.origin !== cfg.origin) stop('EGO_ORIGIN_MISMATCH');
      if (/\/(login|authwall|checkpoint)/.test(u.pathname)) stop('EGO_NEEDS_LOGIN');
    };
    if (platform === 'linkedin') {
      await page.goto('https://www.linkedin.com/in/me/', { timeout: 45000 });
      try { await page.waitForFunction(() => /^\/in\/(?!me\/?$)[^/]+/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
      const slug = /^\/in\/([^/]+)/.exec(new URL(await page.url()).pathname)?.[1];
      if (!slug || slug === 'me') stop('EGO_NEEDS_LOGIN');
      if (slug !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
    } else if (platform === 'facebook') {
      await page.goto('https://www.facebook.com/me/', { timeout: 45000 });
      try { await page.waitForFunction(() => !/^\/me\/?$/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
      const path = new URL(await page.url()).pathname.replace(/\/+$/, '');
      if (!path || path === '/me') stop('EGO_NEEDS_LOGIN');
      if (path.slice(1) !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
    } else if (platform === 'x') {
      await page.goto('https://x.com/home', { timeout: 45000 });
      await sleep(2000);
      await loginCheck();
      const href = await page.evaluate(() => document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || null);
      const m = href && /^\/([A-Za-z0-9_]{1,20})$/.exec(href);
      if (!m) stop('EGO_NEEDS_LOGIN');
      if (m[1] !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
    } else {
      await page.goto('https://bsky.app/', { timeout: 45000 });
      await sleep(2000);
      await loginCheck();
      const href = await page.evaluate(() => document.querySelector('a[href^="/profile/"][href*="did:plc:"], a[aria-label*="rofile" i][href^="/profile/"]')?.getAttribute('href') || null);
      const m = href && /^\/profile\/([^/?#]+)/.exec(href);
      if (!m) stop('EGO_NEEDS_LOGIN');
      if (decodeURIComponent(m[1]) !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
    }

    // ── Facebook 공개 범위 (입력 전에 설정한다 — 본문 입력 후 메뉴가 닫히는 사례 방지) ──
    const setVisibility = async () => {
      if (platform !== 'facebook' || visibility === 'keep') return;
      const opened = await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return false;
        const b = dialog.querySelector('div[role="button"][aria-label*="공개" i], div[role="button"][aria-label*="친구" i], div[role="button"][aria-haspopup]');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!opened) stop('EGO_VISIBILITY_FAILED');
      await sleep(800);
      const picked = await page.evaluate(wantSource => {
        const re = new RegExp(wantSource, 'i');
        const items = [...document.querySelectorAll('div[role="menuitemradio"], span[dir="auto"]')];
        const item = items.find(el => re.test(el.innerText || el.textContent || ''));
        if (!item) return false;
        (item.closest('div[role="menuitemradio"]') ?? item).click();
        return true;
      }, visibility === 'public' ? '공개|Public' : '친구|Friends');
      if (!picked) stop('EGO_VISIBILITY_FAILED');
      await sleep(600);
    };

    // ── 미디어 첨부 (게시 클릭 전 fail-closed: 첨부 프리뷰가 보여야 진행) ──
    const attachMedia = async () => {
      if (!media.length) return;
      // 첨부 버튼 클릭으로 file input을 DOM에 드러나게 한다(플랫폼 공통 패턴)
      await page.evaluate(selector => {
        const b = document.querySelector(selector);
        if (b) b.click();
      }, cfg.attachButton).catch(() => {});
      await sleep(800);
      const paths = media.map(m => m.path);
      try {
        await page.setInputFiles('input[type="file"]', paths);
      } catch {
        stop('EGO_MEDIA_FAILED');
      }
      const previewDeadline = Date.now() + 20000;
      let preview = false;
      while (Date.now() < previewDeadline) {
        preview = await page.evaluate(selector => !!document.querySelector(selector), cfg.mediaPreview);
        if (preview) break;
        await sleep(500);
      }
      if (!preview) stop('EGO_MEDIA_FAILED');
    };

    // ── 세그먼트 루프 ──
    for (let i = 0; i < segments.length; i += 1) {
      const body = segments[i] + (i === 0 && link ? '\n' + link : '');
      if (i === 0) {
        if (cfg.composerUrl) await page.goto(cfg.composerUrl, { timeout: 45000 });
        else if (!(await cfg.composerOpen())) stop('EGO_COMPOSER_NOT_FOUND');
      } else {
        const prev = urls[urls.length - 1];
        if (!prev) stop('EGO_SCHEMA_INVALID');
        if (!(await cfg.replyOpen(prev))) stop('EGO_COMPOSER_NOT_FOUND');
      }
      // composer 렌더 대기
      let composerReady = false;
      const readyDeadline = Date.now() + 15000;
      while (Date.now() < readyDeadline) {
        composerReady = await page.evaluate(selector => !!document.querySelector(selector), cfg.composerSelector);
        if (composerReady) break;
        await sleep(400);
      }
      if (!composerReady) stop('EGO_COMPOSER_NOT_FOUND');
      if (i === 0) await setVisibility();
      // 본문 삽입 — execCommand insertText(에디터 모델 반영 검증 방식)
      const fill = await page.evaluate(({ selector, text }) => {
        const box = document.querySelector(selector);
        if (!box) return { ok: false };
        box.focus();
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch {}
        return { ok: ok === true };
      }, { selector: cfg.composerSelector, text: body });
      if (!fill?.ok) stop('EGO_READBACK_MISMATCH');
      // 정확한 readback — 공백 정규화 없이 일치해야 클릭한다
      const read = await page.evaluate(selector => {
        const box = document.querySelector(selector);
        return box ? String(box.innerText ?? '') : null;
      }, cfg.composerSelector);
      if (typeof read !== 'string' || read.replace(/\r\n/g, '\n') !== body) stop('EGO_READBACK_MISMATCH');
      if (i === 0) await attachMedia();
      // 게시 버튼 1회 클릭 (활성화 대기 포함)
      let postClicked = false;
      const clickDeadline = Date.now() + 15000;
      while (Date.now() < clickDeadline) {
        postClicked = await page.evaluate(selector => {
          const btn = document.querySelector(selector);
          if (!btn) return false;
          const disabled = btn.disabled === true || btn.getAttribute('aria-disabled') === 'true';
          if (disabled) return false;
          btn.click();
          return true;
        }, cfg.postButton);
        if (postClicked) break;
        await sleep(600);
      }
      if (!postClicked) stop('EGO_POST_BUTTON_NOT_FOUND');
      // DOM 증거 폴링 — composer 소멸(또는 플랫폼 evidence)이 게시 증거다
      let evidence = false;
      const evidenceDeadline = Date.now() + 20000;
      while (Date.now() < evidenceDeadline) {
        evidence = await cfg.evidence();
        if (evidence) break;
        await sleep(600);
      }
      if (!evidence) stop('EGO_EVIDENCE_MISSING');
      // 퍼마링크 회수 (최선 — 실패해도 게시는 증거로 성립)
      await page.goto(cfg.profileUrl(expectedIdentity), { timeout: 45000 });
      await sleep(2000);
      const href = await cfg.findPermalink(body);
      urls.push(href ? new URL(href, cfg.origin).href : null);
    }
    const recovered = urls.filter(Boolean);
    console.log(JSON.stringify({
      status: 'POSTED',
      urls: recovered,
      urlRecovered: recovered.length === segments.length,
      identity: expectedIdentity,
    }));
  } catch (error) {
    if (error?.code) partial(error.code);
    else partial('EGO_ATTACH_FAILED');
  }
}

// ── readback: 게시 URL을 열어 snapshot에서 승인 본문을 확인 (Stage 10) ──

async function childReadback(spaceName, urls, bodies) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const results = [];
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      const want = norm(bodies[i] ?? bodies[bodies.length - 1] ?? '');
      await page.goto(url, { timeout: 45000 });
      await new Promise(r => setTimeout(r, 2000));
      const snapshot = await page.snapshot();
      const text = norm(typeof snapshot === 'string' ? snapshot : '');
      results.push({ url, matched: want.length > 0 && text.includes(want) });
    }
    console.log(JSON.stringify({ status: 'READBACK_DONE', results, matched: results.every(r => r.matched) }));
  } catch {
    console.log(JSON.stringify({ status: 'READBACK_FAILED' }));
  }
}

// ── 부모 측 서브커맨드 ────────────────────────────────────────────────

function scriptOf(fn, ...args) {
  return `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(', ')}).catch(() => { console.log(JSON.stringify({ status: 'EGO_ATTACH_FAILED' })); });`;
}

export async function setup(platform, env = process.env, force = false) {
  if (!PLATFORMS.includes(platform)) throw fail('INVALID_ARGUMENT');
  const binding = readBinding(env);
  const executable = binding?.executable ?? discoverExecutable(env);
  if (!executable) throw fail('EGO_EXECUTABLE_NOT_FOUND');
  if (!force && binding?.identity?.[platform]) {
    return { status: 'BOUND', identity: binding.identity[platform], executable, egoVersion: binding.egoVersion, taskSpaceName: binding.taskSpaceName, cached: true };
  }
  const output = await execute(executable, scriptOf(IDENTITY_SCRIPTS[platform], TASK_SPACE_NAME), DEFAULT_TIMEOUT_MS);
  stepFail(output);
  if (!exactKeys(output, ['status', 'identity']) || output.status !== 'IDENTITY_ACQUIRED' || !validString(output.identity, 256)) {
    throw fail('EGO_SCHEMA_INVALID');
  }
  const next = binding ?? { transport: TRANSPORT, executable, taskSpaceName: TASK_SPACE_NAME, egoVersion: egoVersion(executable), identity: {} };
  next.executable = executable;
  next.identity = { ...next.identity, [platform]: output.identity };
  writeBinding(next, env);
  return { status: 'BOUND', identity: output.identity, executable, egoVersion: next.egoVersion, taskSpaceName: next.taskSpaceName, cached: false };
}

export async function bootstrap(platform, env = process.env, count = 20) {
  if (!PLATFORMS.includes(platform)) throw fail('INVALID_ARGUMENT');
  const binding = readBinding(env);
  const identity = binding?.identity?.[platform];
  if (!binding || !identity) throw fail('EGO_NOT_BOUND');
  const output = await execute(binding.executable, scriptOf(childBootstrap, TASK_SPACE_NAME, platform, { max: count, identity }), MAX_TIMEOUT_MS);
  stepFail(output);
  if (!exactKeys(output, ['status', 'posts']) || output.status !== 'BOOTSTRAP_OBSERVED' || !Array.isArray(output.posts)) {
    throw fail('EGO_SCHEMA_INVALID');
  }
  return output;
}

export function validatePostPayload(payload) {
  if (!exactKeys(payload, ['platform', 'format', 'body', 'media', 'link', 'visibility', 'identity'])) throw fail('INVALID_PAYLOAD');
  if (!PLATFORMS.includes(payload.platform)) throw fail('INVALID_PAYLOAD');
  if (!['single', 'thread'].includes(payload.format)) throw fail('INVALID_PAYLOAD');
  if (typeof payload.body !== 'string' || !payload.body.trim() || payload.body.includes('\0')) throw fail('INVALID_PAYLOAD');
  const segments = payload.body.split('\n=== POST ===\n').map(s => s.trim()).filter(s => s.length > 0);
  if (!segments.length || (payload.format === 'single' && segments.length !== 1)) throw fail('INVALID_PAYLOAD');
  if (!Array.isArray(payload.media) || payload.media.some(m => !exactKeys(m, ['path', 'alt']) || !validString(m.path, 4096) || !isAbsolute(m.path))) throw fail('INVALID_PAYLOAD');
  if (typeof payload.link !== 'string' || payload.link.length > 2048) throw fail('INVALID_PAYLOAD');
  if (!['public', 'friends', 'keep'].includes(payload.visibility)) throw fail('INVALID_PAYLOAD');
  if (!validString(payload.identity, 256)) throw fail('INVALID_PAYLOAD');
  return segments;
}

export function postTimeoutMs(segmentCount) {
  // 세그먼트당 composer+게시+회수 왕복 예산. 상한은 하네스 Bash 전경 호출(600s) 아래.
  return Math.min(MAX_TIMEOUT_MS, Math.max(DEFAULT_TIMEOUT_MS, 60000 * segmentCount + 90000));
}

export async function post(payload, env = process.env) {
  const segments = validatePostPayload(payload);
  const binding = readBinding(env);
  if (!binding) throw fail('EGO_NOT_BOUND');
  if (binding.identity[payload.platform] !== payload.identity) throw fail('EGO_ACCOUNT_MISMATCH');
  const timeoutMs = postTimeoutMs(segments.length);
  const output = await execute(binding.executable, scriptOf(childPost, TASK_SPACE_NAME, payload.platform, segments, payload.media, payload.link, payload.visibility, payload.identity), timeoutMs);
  stepFail(output);
  if (output.status === 'PARTIAL_POSTED') {
    if (!Array.isArray(output.urls)) throw fail('EGO_SCHEMA_INVALID');
    return { status: 'PARTIAL_POSTED', urls: output.urls, reason: output.reason ?? 'EGO_EVIDENCE_MISSING' };
  }
  if (!exactKeys(output, ['status', 'urls', 'urlRecovered', 'identity']) || output.status !== 'POSTED' ||
      !Array.isArray(output.urls) || typeof output.urlRecovered !== 'boolean' ||
      output.urls.some(u => typeof u !== 'string')) throw fail('EGO_SCHEMA_INVALID');
  return output;
}

export async function readback(payload, env = process.env) {
  if (!exactKeys(payload, ['urls', 'bodies']) || !Array.isArray(payload.urls) || !Array.isArray(payload.bodies) ||
      payload.urls.some(u => !validString(u, 2048)) || !payload.urls.length ||
      payload.bodies.some(b => typeof b !== 'string')) throw fail('INVALID_PAYLOAD');
  const binding = readBinding(env);
  if (!binding) throw fail('EGO_NOT_BOUND');
  const output = await execute(binding.executable, scriptOf(childReadback, TASK_SPACE_NAME, payload.urls, payload.bodies), MAX_TIMEOUT_MS);
  if (output.status === 'READBACK_FAILED') throw fail('READBACK_FAILED');
  if (!exactKeys(output, ['status', 'results', 'matched']) || output.status !== 'READBACK_DONE' ||
      !Array.isArray(output.results) || typeof output.matched !== 'boolean') throw fail('EGO_SCHEMA_INVALID');
  return output;
}

// ── CLI ──────────────────────────────────────────────────────────────

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function emit(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  try {
    if (command === 'setup') {
      const platform = flag('--platform');
      const force = rest.includes('--force');
      if (!platform) throw fail('INVALID_ARGUMENT');
      emit(await setup(platform, process.env, force));
      return;
    }
    if (command === 'bootstrap') {
      const platform = flag('--platform');
      const count = Number(flag('--count') ?? 20);
      if (!platform || !Number.isInteger(count) || count < 1 || count > 50) throw fail('INVALID_ARGUMENT');
      emit(await bootstrap(platform, process.env, count));
      return;
    }
    if (command === 'post') {
      const payload = JSON.parse(await readStdin());
      const result = await post(payload, process.env);
      emit(result);
      // 부분 게시(PARTIAL_POSTED)는 실패다 — 이미 게시된 URL과 함께 exit 1로 올린다.
      if (result.status !== 'POSTED') process.exitCode = 1;
      return;
    }
    if (command === 'readback') {
      const payload = JSON.parse(await readStdin());
      emit(await readback(payload, process.env));
      return;
    }
    throw fail('INVALID_ARGUMENT');
  } catch (error) {
    // 실패도 정확히 JSON 1줄 — publish.sh·에이전트가 기계 판정한다. exit 1.
    // post 명령은 POST_FAILED(부분 게시는 PARTIAL_POSTED), 나머지는 FAILED로 구분한다.
    const status = command === 'post' ? 'POST_FAILED' : 'FAILED';
    emit({ status, reason: error?.code ?? 'EGO_ATTACH_FAILED', detail: String(error?.message ?? '').slice(0, 200) });
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('ego-post.mjs')) {
  await main();
}
