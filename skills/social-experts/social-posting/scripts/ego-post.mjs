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
// 승인 digest 가드가 담당한다. 고정 스크립트는 공간 소유·양도·종료 API를
// 호출하지 않는다(테스트가 정규식으로 강제 — ego-post.test.mjs 참조).
//
// 스크립트 함수와 공유 신원 파서는 fn.toString()으로 함께 주입한다. 그 외 바깥
// 스코프는 참조하지 않으며 입력은 데이터(JSON)로만 주입된다. 플랫폼 DOM 셀렉터는 첫 실측(2026-11)
// 기준의 보수적 추정이며 — 실측 전 표시된 주석 참조 — 기명 실패 코드로만 갈린다.
//
// Usage 상세는 docs/REFERENCE.md "ego 실행 계약".

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { materializeFetchedMedia } from './materialize-media.mjs';
import * as xUI from './platforms/x.mjs';
import * as linkedinUI from './platforms/linkedin.mjs';
import * as facebookUI from './platforms/facebook.mjs';
import * as blueskyUI from './platforms/bluesky.mjs';
import * as threadsUI from './platforms/threads.mjs';
import * as instagramUI from './platforms/instagram.mjs';

const PLATFORM_UI = { x: xUI, linkedin: linkedinUI, facebook: facebookUI, bluesky: blueskyUI, threads: threadsUI, instagram: instagramUI };
const { facebookIdentity, facebookPost } = facebookUI;

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

export const PLATFORMS = Object.freeze(['x', 'linkedin', 'facebook', 'bluesky', 'threads', 'instagram']);
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
  // 실측(2026-11-14, 0.6.3.14): --version 출력은 stderr로 재배선된다 — stdout·stderr 통합 캡처.
  const r = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 15000 });
  return `${r.stdout ?? ''}${r.stdout ? '' : (r.stderr ?? '')}`.split('\n')[0].trim().slice(0, 64);
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




async function ownProfileHref(page, platform) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const href = await page.evaluate(profile => {
      const path = new RegExp(profile.path);
      const selector = profile.selector;
      const hrefs = new Set([...document.querySelectorAll(selector)]
        .filter(link => link.getClientRects().length > 0)
        .map(link => link.getAttribute('href')).filter(href => path.test(href ?? ''))
        .map(href => href.replace(/\/+$/, '')));
      return hrefs.size === 1 ? [...hrefs][0] : null;
    }, { path: PLATFORM_UI[platform].ownProfilePath, selector: PLATFORM_UI[platform].ownProfileSelector });
    if (href) return href;
    await new Promise(r => setTimeout(r, 600));
  }
  return null;
}



const IDENTITY_SCRIPTS = Object.freeze({
  x: xUI.childAcquireIdentityX,
  linkedin: linkedinUI.childAcquireIdentityLinkedin,
  facebook: facebookUI.childAcquireIdentityFacebook,
  bluesky: blueskyUI.childAcquireIdentityBluesky,
  threads: threadsUI.childAcquireIdentityThreads,
  instagram: instagramUI.childAcquireIdentityInstagram,
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
  const collected = [];
  let detailPage = null;
  let networkPage = null;
  let deadline = Date.now() + 60000;
  const beforeDeadline = async promise => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('TIME_LIMIT')), Math.max(0, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  };
  const responseTimes = new Map();
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    const seen = new Map();
    const responses = new Map();
    const completed = new Set();
    let observing = false;
    const ui = PLATFORM_UI[platform];
    const observeResponses = async deadline => {
      if (!observing || Date.now() >= deadline) return;
      let events;
      try { events = await beforeDeadline(page.events()); } catch { observing = false; return; }
      if (!Array.isArray(events)) { observing = false; return; }
      for (const event of events) {
        const { method, params } = event ?? {};
        if (!params || typeof params.requestId !== 'string') continue;
        if (method === 'Network.responseReceived' && responses.size + completed.size < 100 && !completed.has(params.requestId)) {
          try {
            const url = new URL(params.response?.url);
            if (!ui.acceptResponse(url, params.type)) continue;
            responses.set(params.requestId, { document: params.type === 'Document', finished: false });
          } catch {}
        }
        if (method === 'Network.loadingFinished' && responses.has(params.requestId)) responses.get(params.requestId).finished = true;
        if (method === 'Network.loadingFailed') responses.delete(params.requestId);
      }
      for (const [requestId, response] of responses) {
        if (!response.finished || Date.now() >= deadline) continue;
        responses.delete(requestId);
        completed.add(requestId);
        try {
          const received = await beforeDeadline(page.cdp('Network.getResponseBody', { requestId }));
          if (typeof received?.body !== 'string' || received.body.length > 12 * 1024 * 1024) continue;
          const body = received.base64Encoded ? Buffer.from(received.body, 'base64').toString('utf8') : received.body;
          if (Buffer.byteLength(body, 'utf8') > 8 * 1024 * 1024) continue;
          ui.rememberResponse(body, response.document, responseTimes);
        } catch {}
      }
      for (const post of collected) {
        const observed = responseTimes.get(post.url);
        if (observed?.publishers.includes(post.publisher ?? facebookPost(post.url)?.publisher)) post.time = observed.time;
      }
    };
    if (!ui) stop('EGO_SCHEMA_INVALID');
    if (platform === 'facebook' && facebookIdentity(new URL(PLATFORM_UI.facebook.profileUrl(spec.identity))) !== spec.identity) stop('EGO_IDENTITY_NOT_FOUND');
    if (ui.rememberResponse && typeof page.cdp === 'function' && typeof page.events === 'function') {
      networkPage = page;
      try {
        await page.cdp('Network.enable', { maxTotalBufferSize: 16 * 1024 * 1024, maxResourceBufferSize: 8 * 1024 * 1024 });
        observing = true;
      } catch {}
    }
    if (platform === 'instagram') await ui.verifyPostIdentity(page, spec.identity, stop, async () => {}, ms => new Promise(resolve => setTimeout(resolve, ms)));
    await page.goto(spec.postUrl ?? ui.profileUrl(spec.identity), { timeout: 45000 });
    try { await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 200, undefined, { timeout: 20000 }); } catch {}
    const baseUrl = await page.url();
    const base = new URL(baseUrl);
    if (base.origin !== new URL(ui.profileUrl(spec.identity)).origin) stop('EGO_ORIGIN_MISMATCH');
    if (/^\/(login|authwall|checkpoint|accounts\/login)/.test(base.pathname)) stop('EGO_NEEDS_LOGIN');
    // DOM 속성은 건드리지 않고 같은 페이지의 evaluate 호출 사이에서만 노드 신원을 유지한다.
    await page.evaluate(() => {
      const nodes = new WeakMap();
      const session = crypto.randomUUID();
      let next = 0;
      globalThis[Symbol.for('aha-skills.social-posting.observation-id')] = node => {
        if (!nodes.has(node)) nodes.set(node, `unidentified-${session}-${++next}`);
        return nodes.get(node);
      };
    });
    if (platform === 'instagram' && !spec.postUrl) detailPage = await task.newPage();
    deadline = Date.now() + 60000;
    let stopReason = 'TIME_LIMIT';
    let stableRounds = 0;
    let lastCount = -1;
    while (Date.now() < deadline && collected.length < spec.max) {
      await observeResponses(deadline);
      if (Date.now() >= deadline) break;
      let observationError = null;
      let found;
      try { found = platform === 'instagram' ? await ui.extractPosts(page, deadline, detailPage) : await ui.extractPosts(page); }
      catch (error) {
        if (platform !== 'instagram' || !error.observedPosts?.length) throw error;
        found = error.observedPosts;
        observationError = error;
      }
      for (const item of found) {
        let url = null;
        let publisher = null;
        try {
          const canonical = new URL(item.href, baseUrl);
          if (!item.href || canonical.origin !== base.origin) throw Error('no permalink');
          canonical.hash = '';
          const story = canonical.searchParams.get('story_fbid');
          const photo = canonical.searchParams.get('fbid');
          const owner = canonical.searchParams.get('id');
          canonical.search = '';
          canonical.pathname = canonical.pathname.replace(/\/+$/, '');
          if (story) canonical.searchParams.set('story_fbid', story);
          if (photo) canonical.searchParams.set('fbid', photo);
          if (owner && (story || photo)) canonical.searchParams.set('id', owner);
          url = canonical.href;
          publisher = platform === 'instagram' ? item.publisher ?? null : ui.publisher(canonical, owner);
          if (!publisher && item.publisherHref) publisher = facebookIdentity(new URL(item.publisherHref, baseUrl));
        } catch {}
        if (spec.postUrl && url !== spec.postUrl) continue;
        let parentUrl = null;
        try {
          const parent = new URL(item.parentHref, baseUrl);
          const parentPath = ui.parentPath ? new RegExp(ui.parentPath) : null;
          if (item.parentHref && parent.origin === base.origin && !parent.username && !parent.password && parentPath?.test(parent.pathname)) {
            parent.search = '';
            parent.hash = '';
            parent.pathname = parent.pathname.replace(/\/+$/, '');
            if (parent.href !== url) parentUrl = parent.href;
          }
        } catch {}
        const key = spec.scan ? (url || item.observationId) : String(item.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const observed = responseTimes.get(url);
        const time = observed?.publishers.includes(publisher) ? observed.time : item.time;
        if (key && seen.has(key)) {
          const previous = seen.get(key);
          if (!previous.time && time) previous.time = time;
          continue;
        }
        if (!spec.scan && !item.text) continue;
        const post = { text: item.text, url, time, media: item.media ?? [],
          ...(platform === 'instagram' ? { mediaComplete: item.mediaComplete === true } : {}),
          ...(spec.scan ? { publisher, observationId: item.observationId, ...(parentUrl ? { parentUrl } : {}) } : {}) };
        if (key) seen.set(key, post);
        collected.push(post);
        if (collected.length >= spec.max) break;
      }
      if (observationError) throw observationError;
      if (collected.length >= spec.max) { stopReason = 'POST_LIMIT'; break; }
      if (collected.length === lastCount) {
        stableRounds += 1;
        if (stableRounds >= 3) { stopReason = 'SCROLL_STALLED'; break; }
      } else stableRounds = 0;
      lastCount = collected.length;
      await page.mouse.move(200, 300);
      await page.mouse.wheel(0, 1200);
      await new Promise(r => setTimeout(r, 500));
    }
    await observeResponses(deadline);
    if (platform === 'threads' && !collected.length && stopReason === 'SCROLL_STALLED') stopReason = 'EGO_EVIDENCE_MISSING';
    console.log(JSON.stringify({ status: 'BOOTSTRAP_OBSERVED', posts: collected.slice(0, spec.max), ...(spec.scan ? { stopReason } : {}) }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_IDENTITY_NOT_FOUND', 'EGO_ACCOUNT_MISMATCH', 'EGO_EVIDENCE_MISSING'];
    const reason = codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED';
    console.log(JSON.stringify(spec.scan ? { status: 'BOOTSTRAP_OBSERVED', posts: collected, stopReason: reason } : { status: reason }));
  } finally {
    if (detailPage) {
      try { await beforeDeadline(detailPage.close()); } catch {}
    }
    if (networkPage) {
      try { await beforeDeadline(networkPage.cdp('Network.disable')); } catch {}
      try { await beforeDeadline(networkPage.events()); } catch {}
    }
    responseTimes.clear();
  }
}

async function childFetchScanMedia(spaceName, sourceUrl, destination) {
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
    const response = await page.fetch(sourceUrl, { saveAs: destination, timeout: 45000, redirect: 'error', credentials: 'same-origin' });
    const contentType = String(response?.headers?.['content-type'] ?? '').split(';', 1)[0].toLowerCase();
    if (!response?.ok || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType) ||
        typeof response?.url !== 'string' || !/^https?:\/\//.test(response.url)) stop('EGO_MEDIA_FAILED');
    console.log(JSON.stringify({ status: 'MEDIA_FETCHED', path: destination, sourceUrl, finalUrl: response.url, contentType }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_SPACE_FAILED', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_MEDIA_FAILED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_MEDIA_FAILED' }));
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
  let confirmedCount = 0;
  let clickUncertain = false;
  const partial = code => {
    console.log(JSON.stringify({
      status: clickUncertain ? 'POST_UNKNOWN' : confirmedCount ? 'PARTIAL_POSTED' : 'POST_FAILED',
      urls: urls.filter(Boolean), postedCount: confirmedCount, reason: code,
    }));
  };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();

    const ui = PLATFORM_UI[platform];
    const cfg = ui?.postProfile(page, norm, sleep);
    if (!cfg) stop('EGO_SCHEMA_INVALID');

    // ── 라이브 신원 확인 (binding과 불일치면 게시 전 차단 — 계정 재타깃 방지) ──
    const loginCheck = async () => {
      const u = new URL(await page.url());
      if (u.origin !== cfg.origin) stop('EGO_ORIGIN_MISMATCH');
      if (/\/(login|authwall|checkpoint)/.test(u.pathname)) stop('EGO_NEEDS_LOGIN');
    };
    await ui.verifyPostIdentity(page, expectedIdentity, stop, loginCheck, sleep);


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
      const altUI = cfg.altUI;
      const clickAltControl = async selector => {
        const clicked = await page.evaluate(selector => {
          const buttons = [...document.querySelectorAll(selector)];
          if (buttons.length !== 1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return false;
          buttons[0].click();
          return true;
        }, selector);
        if (!clicked) stop('EGO_MEDIA_FAILED');
      };
      for (let index = 0; index < media.length; index += 1) {
        const description = media[index].alt;
        if (!description) continue;
        if (!altUI) stop('EGO_MEDIA_FAILED');
        const openAlt = async () => {
          const opened = await page.evaluate(({ selector, index, count }) => {
            const buttons = [...document.querySelectorAll(selector)];
            if (buttons.length !== count) return false;
            buttons[index].click();
            return true;
          }, { selector: altUI.open, index, count: media.length });
          if (!opened) stop('EGO_MEDIA_FAILED');
          if (altUI.edit) {
            await page.waitForSelector(altUI.edit, { state: 'visible', timeout: 10000 });
            await clickAltControl(altUI.edit);
          }
          await page.waitForSelector(altUI.input, { state: 'visible', timeout: 10000 });
        };
        const saveAlt = async () => {
          await clickAltControl(altUI.save);
          await page.waitForSelector(altUI.input, { state: 'hidden', timeout: 10000 });
          if (altUI.done) {
            await page.waitForSelector(altUI.done, { state: 'visible', timeout: 10000 });
            await clickAltControl(altUI.done);
            await page.waitForSelector(altUI.done, { state: 'hidden', timeout: 10000 });
          }
        };
        try {
          await openAlt();
          await page.fill(altUI.input, description);
          if (await page.evaluate(selector => document.querySelector(selector)?.value, altUI.input) !== description) stop('EGO_MEDIA_FAILED');
          await saveAlt();
          await openAlt();
          if (await page.evaluate(selector => document.querySelector(selector)?.value, altUI.input) !== description) stop('EGO_MEDIA_FAILED');
          await saveAlt();
        } catch { stop('EGO_MEDIA_FAILED'); }
      }
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
      // Instagram은 사진 선택·편집 이후에 캡션 입력란이 나타난다.
      if (platform === 'instagram') await cfg.prepareMedia(media, stop);
      // composer 렌더 대기
      let composerReady = false;
      const readyDeadline = Date.now() + 15000;
      while (Date.now() < readyDeadline) {
        composerReady = await page.evaluate(selector => !!document.querySelector(selector), cfg.composerSelector);
        if (composerReady) break;
        await sleep(400);
      }
      if (!composerReady) stop('EGO_COMPOSER_NOT_FOUND');
      if (i === 0 && ui.setVisibility) await ui.setVisibility(page, visibility, stop, sleep);
      // 본문 삽입 — execCommand insertText(에디터 모델 반영 검증 방식)
      const fill = platform === 'instagram' && body.length === 0 ? { ok: true } : await page.evaluate(({ selector, text }) => {
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
      if (i === 0) {
        if (platform !== 'instagram') await attachMedia();
        const afterMedia = await page.evaluate(selector => document.querySelector(selector)?.innerText ?? null, cfg.composerSelector);
        if (typeof afterMedia !== 'string' || afterMedia.replace(/\r\n/g, '\n') !== body) stop('EGO_READBACK_MISMATCH');
      }
      if (platform === 'instagram') await cfg.verifyBeforeShare(media, body, expectedIdentity, stop);
      // 게시 버튼 1회 클릭 (활성화 대기 포함)
      let postClicked = false;
      const clickDeadline = Date.now() + 15000;
      while (Date.now() < clickDeadline) {
        // 평가 요청이 중단되면 click() 도달 여부를 알 수 없으므로 재시도하지 않는다.
        clickUncertain = true;
        postClicked = await page.evaluate(selector => {
          const btn = document.querySelector(selector);
          if (!btn) return false;
          const disabled = btn.disabled === true || btn.getAttribute('aria-disabled') === 'true';
          if (disabled) return false;
          btn.click();
          return true;
        }, cfg.postButton);
        if (postClicked) break;
        clickUncertain = false;
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
      confirmedCount += 1;
      clickUncertain = false;
      // 퍼마링크 회수 실패는 이미 확인한 게시를 되돌리지 않는다.
      let permalink = null;
      try {
        await page.goto(cfg.profileUrl(expectedIdentity), { timeout: 45000 });
        await sleep(2000);
        const href = await cfg.findPermalink(body);
        if (href) {
          const parsed = new URL(href, cfg.origin);
          if (parsed.origin === cfg.origin) permalink = parsed.href;
        }
      } catch {}
      urls.push(permalink);
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

// ── readback: 퍼마링크로 식별한 게시 노드의 승인 본문을 확인 (Stage 10) ──

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
      const want = norm(bodies[i]);
      await page.goto(url, { timeout: 45000 });
      await new Promise(r => setTimeout(r, 2000));
      const ui = Object.values(PLATFORM_UI).find(ui => ui.readbackHosts.includes(new URL(url).hostname));
      if (ui?.readbackPost) {
        const observed = await ui.readbackPost(page, url);
        const captionMatched = typeof observed?.text === 'string' && norm(observed.text) === want;
        const items = observed?.media ?? [];
        results.push({ url, matched: captionMatched && items.length > 0, captionMatched,
          media: { items, complete: observed?.mediaComplete === true, ...(observed?.stopReason ? { stopReason: observed.stopReason } : {}) } });
        continue;
      }
      const config = ui?.readbackSelectors;
      const text = await page.evaluate(({ target, config }) => {
        const url = new URL(target);
        if (!config) return null;
        const key = value => {
          const u = new URL(value, url.origin);
          const host = u.hostname === 'twitter.com' ? 'x.com' : u.hostname;
          const query = /facebook\.com$/.test(host) ? ['story_fbid', 'id'].map(k => u.searchParams.get(k) ?? '').join(':') : '';
          return u.protocol + '//' + host + ':' + u.port + u.pathname.replace(/\/+$/, '') + '?' + query;
        };
        const posts = [...document.querySelectorAll(config[0])].filter(node =>
          [...node.querySelectorAll('a[href]')].some(anchor => {
            try { return anchor.closest(config[0]) === node && key(anchor.getAttribute('href')) === key(target); }
            catch { return false; }
          }));
        if (posts.length !== 1) return null;
        return posts[0].querySelector(config[1])?.innerText ?? null;
      }, { target: url, config });
      results.push({ url, matched: want.length > 0 && typeof text === 'string' && norm(text) === want });
    }
    console.log(JSON.stringify({ status: 'READBACK_DONE', results, matched: results.every(r => r.matched) }));
  } catch {
    console.log(JSON.stringify({ status: 'READBACK_FAILED' }));
  }
}

// ── 부모 측 서브커맨드 ────────────────────────────────────────────────


function scriptOf(fn, ...args) {
  const platforms = Object.entries(PLATFORM_UI).map(([platform, ui]) => {
    const functions = Object.entries(ui).map(([name, value]) => `${JSON.stringify(name)}: ${typeof value === 'function' ? value.toString() : JSON.stringify(value)}`);
    return `${JSON.stringify(platform)}: {${functions.join(',\n')}}`;
  });
  return `const PLATFORM_UI = {${platforms.join(',\n')}};\nconst facebookIdentity = PLATFORM_UI.facebook.facebookIdentity;\nconst facebookPost = PLATFORM_UI.facebook.facebookPost;\nconst ownProfileHref = ${ownProfileHref.toString()};\n(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(', ')}).catch(() => { console.log(JSON.stringify({ status: 'EGO_ATTACH_FAILED' })); });`;
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
  const next = binding ?? { transport: TRANSPORT, executable, taskSpaceName: TASK_SPACE_NAME, egoVersion: '', identity: {} };
  if (!next.egoVersion) next.egoVersion = egoVersion(executable);
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

function scanDate(value) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function observationPostUrl(platform, value) {
  if (!httpUrl(value)) throw fail('INVALID_PAYLOAD');
  const url = new URL(value);
  const origins = { x: 'https://x.com', facebook: 'https://www.facebook.com', bluesky: 'https://bsky.app', threads: 'https://www.threads.com', instagram: 'https://www.instagram.com' };
  if (url.origin !== origins[platform] || url.username || url.password || url.hash) throw fail('INVALID_PAYLOAD');
  const paths = {
    x: /^\/[^/]+\/status\/\d+\/?$/,
    facebook: /^\/(?:[^/]+\/posts\/[^/]+|(?:permalink|story|photo)\.php|photo)\/?$/,
    bluesky: /^\/profile\/[^/]+\/post\/[^/]+\/?$/,
    threads: /^\/@[^/]+\/post\/[^/]+\/?$/,
    instagram: /^\/p\/[A-Za-z0-9_-]+\/?$/,
  };
  if (!paths[platform]?.test(url.pathname)) throw fail('INVALID_PAYLOAD');
  if (platform === 'facebook' && !url.pathname.includes('/posts/') && !url.searchParams.has('story_fbid') && !url.searchParams.has('fbid')) throw fail('INVALID_PAYLOAD');
  const retained = ['story_fbid', 'fbid', 'id'].filter(key => url.searchParams.has(key)).map(key => [key, url.searchParams.get(key)]);
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (platform === 'facebook') for (const [key, entry] of retained) url.searchParams.set(key, entry);
  return url.href;
}

export function validateScanPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('INVALID_PAYLOAD');
  const keys = Object.keys(payload);
  if (!['platform', 'cursor'].every(key => keys.includes(key)) || !keys.every(key => ['platform', 'cursor', 'since', 'until', 'jobDir', 'postUrl'].includes(key))) throw fail('INVALID_PAYLOAD');
  if (!PLATFORMS.includes(payload.platform) || payload.cursor !== null) throw fail('INVALID_PAYLOAD');
  if (payload.postUrl !== undefined) payload = { ...payload, postUrl: observationPostUrl(payload.platform, payload.postUrl) };
  if (payload.jobDir !== undefined && (typeof payload.jobDir !== 'string' || !isAbsolute(payload.jobDir) || resolve(payload.jobDir) !== payload.jobDir)) throw fail('INVALID_PAYLOAD');
  if (payload.since === undefined && payload.until === undefined) {
    const reference = new Date();
    return { ...payload, since: new Date(reference.getTime() - 86400000).toISOString(), until: reference.toISOString() };
  }
  const since = scanDate(payload.since);
  const until = scanDate(payload.until);
  if (!since || !until || since >= until) throw fail('INVALID_PAYLOAD');
  return payload;
}

function scanManifestDigest(serialized) {
  return createHash('sha256').update(serialized).digest('hex');
}

function scanReceiptPath(jobDir, env) {
  return join(stateDir(env), 'scan-manifests', `${scanManifestDigest(jobDir)}.json`);
}

function writeScanManifest(jobDir, manifest, env) {
  mkdirSync(jobDir, { recursive: true });
  const path = join(jobDir, 'scan-manifest.json');
  const temporary = `${path}.${process.pid}.tmp`;
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  try {
    writeFileSync(temporary, serialized, { flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch {}
  }
  const receipt = scanReceiptPath(jobDir, env);
  mkdirSync(dirname(receipt), { recursive: true, mode: 0o700 });
  const manifestDigest = scanManifestDigest(serialized);
  writeFileSync(receipt, JSON.stringify({ jobDir, manifestDigest }) + '\n', { mode: 0o600 });
  return { manifestPath: path, manifestDigest };
}

function readScanManifest(jobDir, env) {
  try {
    const serialized = readFileSync(join(jobDir, 'scan-manifest.json'), 'utf8');
    const receipt = JSON.parse(readFileSync(scanReceiptPath(jobDir, env), 'utf8'));
    if (!exactKeys(receipt, ['jobDir', 'manifestDigest']) || receipt.jobDir !== jobDir ||
        receipt.manifestDigest !== scanManifestDigest(serialized)) return null;
    const manifest = JSON.parse(serialized);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
        !PLATFORMS.includes(manifest.platform) || !validString(manifest.identity, 256) || !Array.isArray(manifest.candidates)) return null;
    return manifest;
  } catch { return null; }
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
}

function similarity(left, right) {
  const a = new Set(normalizeText(left).split(' ').filter(Boolean));
  const b = new Set(normalizeText(right).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.max(a.size, b.size);
}

function validCandidate(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && validString(value.id, 512) &&
    typeof value.url === 'string' && (value.url === '' || httpUrl(value.url)) && typeof value.text === 'string' &&
    (value.parentUrl === undefined || httpUrl(value.parentUrl));
}

export function compareCandidates(payload) {
  if (!payload || typeof payload !== 'object' || !Object.keys(payload).every(key => ['candidate', 'existing', 'targetPlatform', 'coverage', 'postLog'].includes(key)) ||
      !validCandidate(payload.candidate) || !Array.isArray(payload.existing) || payload.existing.some(item => !validCandidate(item)) ||
      (payload.targetPlatform !== undefined && !PLATFORMS.includes(payload.targetPlatform)) ||
      (payload.coverage !== undefined && (!payload.coverage || typeof payload.coverage !== 'object' || typeof payload.coverage.complete !== 'boolean')) ||
      (payload.postLog !== undefined && (!payload.targetPlatform || !Array.isArray(payload.postLog) || payload.postLog.some(item =>
        !item || !httpUrl(item.sourceUrl) || !PLATFORMS.includes(item.platform) ||
        !['POSTED', 'PARTIAL_POSTED', 'POST_UNKNOWN', 'POST_FAILED'].includes(item.status) ||
        !Array.isArray(item.urls) || item.urls.some(url => !httpUrl(url)))))) throw fail('INVALID_PAYLOAD');
  const normalized = normalizeText(payload.candidate.text);
  const exact = payload.existing.filter(item => (payload.candidate.url && item.url === payload.candidate.url) ||
    (normalized && normalizeText(item.text) === normalized));
  const details = exact.map(item => ({ kind: item.url === payload.candidate.url ? 'url' : 'normalized_text', ids: [item.id], urls: [item.url] }));
  const similar = payload.existing.filter(item => similarity(item.text, payload.candidate.text) >= 0.6);
  for (const item of similar) details.push({ kind: 'token_similarity', ids: [item.id], urls: [item.url] });
  const byUrl = new Map(payload.existing.filter(item => item.url).map(item => [item.url, item]));
  for (const root of payload.existing) {
    if (!root.url || byUrl.has(root.parentUrl)) continue;
    const chain = [root];
    const seen = new Set([root.url]);
    while (true) {
      const children = payload.existing.filter(item => item.parentUrl === chain.at(-1).url && !seen.has(item.url));
      if (children.length !== 1) break; // 분기된 대화를 임의 순서로 합치지 않는다.
      chain.push(children[0]);
      seen.add(children[0].url);
    }
    const text = chain.map(item => item.text).join(' ');
    if (chain.length > 1 && normalized && (normalizeText(text) === normalized || similarity(text, payload.candidate.text) >= 0.6)) {
      details.push({ kind: 'reply_chain', ids: chain.map(item => item.id), urls: chain.map(item => item.url) });
    }
  }
  const records = (payload.postLog ?? []).filter(item => item.sourceUrl === payload.candidate.url && item.platform === payload.targetPlatform);
  for (const record of records) {
    if (record.status === 'POSTED' && record.urls.length) details.push({ kind: 'posted_record', ids: [], urls: record.urls });
    if (['PARTIAL_POSTED', 'POST_UNKNOWN'].includes(record.status)) details.push({ kind: 'uncertain_posted_record', status: record.status, ids: [], urls: record.urls });
  }
  const duplicate = exact.length > 0 || details.some(item => item.kind === 'posted_record');
  return {
    status: 'COMPARISON_DONE', decision: duplicate ? 'duplicate' : details.length ? 'needs_review' : 'new',
    evidence: [...new Set(details.flatMap(item => item.ids))], details,
    targetPlatform: payload.targetPlatform ?? null, coverage: payload.coverage ?? null,
    absenceMeaning: 'NOT_FOUND_IN_OBSERVED_SCOPE',
  };
}

export async function scan(payload, env = process.env) {
  const referenceTime = new Date().toISOString();
  payload = validateScanPayload(payload);
  const binding = readBinding(env);
  const identity = binding?.identity?.[payload.platform];
  if (!binding || !identity) throw fail('EGO_NOT_BOUND');
  let observed;
  try {
    observed = await execute(binding.executable, scriptOf(childBootstrap, TASK_SPACE_NAME, payload.platform, { max: payload.postUrl ? 1 : 50, identity, scan: true, ...(payload.postUrl ? { postUrl: payload.postUrl } : {}) }), MAX_TIMEOUT_MS);
    stepFail(observed);
    if (!exactKeys(observed, ['status', 'posts', 'stopReason']) || observed.status !== 'BOOTSTRAP_OBSERVED' || !Array.isArray(observed.posts) ||
        !['POST_LIMIT', 'SCROLL_STALLED', 'TIME_LIMIT', ...POST_STEP_CODES].includes(observed.stopReason) || observed.posts.some(post =>
          !post || typeof post.text !== 'string' || (post.url !== null && !httpUrl(post.url)) ||
          (post.observationId !== undefined && !validString(post.observationId, 512)) ||
          (post.parentUrl !== undefined && !httpUrl(post.parentUrl)) ||
          (post.mediaComplete !== undefined && typeof post.mediaComplete !== 'boolean') ||
          (post.publisher !== null && !validString(post.publisher, 256)) || !Array.isArray(post.media))) throw fail('EGO_SCHEMA_INVALID');
  } catch (error) {
    observed = { posts: [], stopReason: error.reason ?? error.code ?? 'EGO_PROCESS_FAILED' };
  }
  const since = new Date(payload.since).getTime();
  const until = new Date(payload.until).getTime();
  const candidates = [];
  const review = [];
  const times = [];
  const seen = new Set();
  for (const post of observed.posts) {
    const id = post.id || post.url || post.observationId || `unidentified-${randomUUID()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const time = scanDate(post.time);
    if (time) times.push(time.getTime());
    const candidate = {
      id, url: post.url || '', text: post.text, publishedAt: time?.toISOString() ?? null, publisher: post.publisher ?? null,
      media: post.media.map((media, index) => ({ id: String(index + 1), sourceUrl: media?.sourceUrl, alt: media?.alt ?? null })),
      ...(post.observationId ? { observationId: post.observationId } : {}),
      ...(typeof post.mediaComplete === 'boolean' ? { mediaComplete: post.mediaComplete } : {}),
      ...(httpUrl(post.parentUrl) ? { parentUrl: post.parentUrl } : {}),
    };
    if (!time) { review.push({ ...candidate, reason: 'UNKNOWN_TIME' }); continue; }
    if (time.getTime() < since || time.getTime() >= until) continue;
    candidates.push(candidate);
  }
  const result = {
    status: 'SCAN_DONE', platform: payload.platform, identity, candidates, review,
    coverage: {
      requestedSince: payload.since, requestedUntil: payload.until, referenceTime, timezone: 'UTC',
      observedOldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
      observedNewest: times.length ? new Date(Math.max(...times)).toISOString() : null,
      complete: false, stopReason: observed.stopReason, observedCount: seen.size, unknownTimeCount: review.length,
      limitations: [['facebook', 'bluesky'].includes(payload.platform) ? 'DOM_WITH_PASSIVE_RESPONSE_TIME_WHEN_AVAILABLE' : 'PROFILE_DOM_ONLY', 'PINNED_OR_UNORDERED_POSTS', 'NO_VERIFIED_HISTORY_END', ...(payload.platform === 'instagram' ? ['INSTAGRAM_DOM_UNVERIFIED', 'OBSERVED_PHOTOS_ONLY'] : [])],
    },
    nextCursor: null,
    ...(payload.jobDir ? { jobDir: join(payload.jobDir, 'scans', randomUUID(), payload.platform) } : {}),
  };
  if (payload.jobDir) return { ...result, ...writeScanManifest(result.jobDir, result, env) };
  return result;
}

function httpUrl(value) {
  if (!validString(value, 2048)) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export async function fetchScannedMedia(payload, env = process.env) {
  const keys = ['jobDir', 'platform', 'candidateId', 'sourceUrl'];
  if (!(exactKeys(payload, keys) || exactKeys(payload, [...keys, 'altOverride'])) || !isAbsolute(payload.jobDir) ||
      !PLATFORMS.includes(payload.platform) || !validString(payload.candidateId, 512) || !httpUrl(payload.sourceUrl)) throw fail('INVALID_MEDIA');
  const sourceAddress = new URL(payload.sourceUrl);
  if (sourceAddress.protocol !== 'https:' || sourceAddress.username || sourceAddress.password) throw fail('INVALID_MEDIA');
  const binding = readBinding(env);
  const manifest = readScanManifest(payload.jobDir, env);
  if (!binding || !manifest || manifest.platform !== payload.platform || manifest.identity !== binding.identity[payload.platform]) throw fail('INVALID_MEDIA');
  const candidate = [...manifest.candidates, ...(manifest.review ?? [])].find(item => item?.id === payload.candidateId);
  const override = payload.altOverride;
  const sources = candidate?.media?.filter(item => item?.sourceUrl === payload.sourceUrl) ?? [];
  if (override === undefined && sources.length > 1) throw fail('INVALID_MEDIA');
  const source = sources.find(item => override === undefined || item.id === override?.mediaId);
  if (override !== undefined && (!exactKeys(override, ['manifestDigest', 'mediaId', 'alt']) ||
      override.manifestDigest !== scanManifestDigest(readFileSync(join(payload.jobDir, 'scan-manifest.json'), 'utf8')) ||
      override.mediaId !== source?.id || !validString(override.alt, 4096))) throw fail('INVALID_MEDIA');
  const alt = override?.alt ?? source?.alt;
  if (!candidate || !source || !httpUrl(candidate.url) || !validString(candidate.publisher, 256) || !validString(alt, 4096)) throw fail('INVALID_MEDIA');
  const postingJobDir = resolve(payload.jobDir, '../../..');
  if (dirname(dirname(payload.jobDir)) !== join(postingJobDir, 'scans') || !payload.jobDir.endsWith(`/${payload.platform}`)) throw fail('INVALID_MEDIA');
  const mediaDir = join(postingJobDir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const destination = join(mediaDir, `.fetch-${randomUUID()}`);
  try {
    const output = await execute(binding.executable, scriptOf(childFetchScanMedia, TASK_SPACE_NAME, payload.sourceUrl, destination), MAX_TIMEOUT_MS);
    stepFail(output);
    if (!exactKeys(output, ['status', 'path', 'sourceUrl', 'finalUrl', 'contentType']) || output.status !== 'MEDIA_FETCHED' ||
        output.path !== destination || output.sourceUrl !== payload.sourceUrl || !httpUrl(output.finalUrl) ||
        new URL(output.finalUrl).origin !== sourceAddress.origin || !validString(output.contentType, 128)) throw fail('EGO_SCHEMA_INVALID');
    const file = statSync(destination);
    if (!file.isFile()) throw fail('INVALID_MEDIA');
    return await materializeFetchedMedia({ jobDir: postingJobDir, media: [{
      sourcePath: destination, sourceUrl: payload.sourceUrl, finalUrl: output.finalUrl,
      sourcePostUrl: candidate.url, publisher: candidate.publisher, observedAt: manifest.coverage.referenceTime,
      alt, contentType: output.contentType, bytes: file.size,
    }] });
  } finally {
    try { unlinkSync(destination); } catch {}
  }
}

export function validatePostPayload(payload) {
  if (!exactKeys(payload, ['platform', 'format', 'body', 'media', 'link', 'visibility', 'identity'])) throw fail('INVALID_PAYLOAD');
  if (!PLATFORMS.includes(payload.platform)) throw fail('INVALID_PAYLOAD');
  if (!['single', 'thread'].includes(payload.format)) throw fail('INVALID_PAYLOAD');
  const instagram = payload.platform === 'instagram';
  if (typeof payload.body !== 'string' || (!instagram && !payload.body.trim()) || payload.body.includes('\0')) throw fail('INVALID_PAYLOAD');
  const parts = payload.body.split('\n=== POST ===\n').map(s => s.trim());
  const segments = instagram ? parts : parts.filter(s => s.length > 0);
  if (!segments.length || (payload.format === 'single' && segments.length !== 1)) throw fail('INVALID_PAYLOAD');
  if (!Array.isArray(payload.media) || payload.media.some(m =>
    !exactKeys(m, ['path', 'alt']) || !validString(m.path, 4096) || !isAbsolute(m.path) ||
    typeof m.alt !== 'string' || m.alt.includes('\0') || (['bluesky', 'instagram'].includes(payload.platform) && !m.alt.trim()))) throw fail('INVALID_PAYLOAD');
  if (typeof payload.link !== 'string' || payload.link.length > 2048) throw fail('INVALID_PAYLOAD');
  if (instagram) {
    if (payload.format !== 'single' || payload.media.length < 1 || payload.media.length > 20 ||
        payload.media.some(m => !/\.(jpe?g|png|webp)$/i.test(m.path))) throw fail('INVALID_PAYLOAD');
    // 로컬 초안 정책이며 Instagram 웹 UI의 실제 계수 단위는 미검증이다.
    if ([...(segments[0] + (payload.link ? '\n' + payload.link : ''))].length > 2200) throw fail('INVALID_PAYLOAD');
  }
  if (!['public', 'friends', 'keep'].includes(payload.visibility)) throw fail('INVALID_PAYLOAD');
  if (!validString(payload.identity, 256)) throw fail('INVALID_PAYLOAD');
  return segments;
}

export function postTimeoutMs(segmentCount) {
  // 세그먼트당 composer+게시+회수 왕복 예산. 상한은 하네스 Bash 전경 호출(600s) 아래.
  return Math.min(MAX_TIMEOUT_MS, Math.max(DEFAULT_TIMEOUT_MS, 60000 * segmentCount + 90000));
}

export async function post(payload, env = process.env) {
  if (payload?.platform === 'instagram') throw fail('INSTAGRAM_UNVERIFIED');
  const segments = validatePostPayload(payload);
  if (payload.platform === 'threads') throw fail('THREADS_UNVERIFIED');
  const binding = readBinding(env);
  if (!binding) throw fail('EGO_NOT_BOUND');
  if (binding.identity[payload.platform] !== payload.identity) throw fail('EGO_ACCOUNT_MISMATCH');
  const timeoutMs = postTimeoutMs(segments.length);
  let output;
  try {
    output = await execute(binding.executable, scriptOf(childPost, TASK_SPACE_NAME, payload.platform, segments, payload.media, payload.link, payload.visibility, payload.identity), timeoutMs);
  } catch (error) {
    // 실행을 넘긴 뒤 응답을 잃었으면 미게시를 증명할 수 없다.
    return { status: 'POST_UNKNOWN', urls: [], postedCount: 0, reason: error.reason ?? error.code ?? 'EGO_PROCESS_FAILED' };
  }
  stepFail(output);
  const urlsValid = Array.isArray(output?.urls) && output.urls.every(u => typeof u === 'string');
  if (['PARTIAL_POSTED', 'POST_UNKNOWN', 'POST_FAILED'].includes(output?.status)) {
    if (exactKeys(output, ['status', 'urls', 'postedCount', 'reason']) && urlsValid &&
        Number.isSafeInteger(output.postedCount) && output.postedCount >= 0 && output.postedCount <= segments.length &&
        output.urls.length <= output.postedCount && validString(output.reason, 128) && /^EGO_[A-Z_]+$/.test(output.reason) &&
        (output.status !== 'PARTIAL_POSTED' || output.postedCount > 0) &&
        (output.status !== 'POST_FAILED' || output.postedCount === 0)) return output;
  }
  if (exactKeys(output, ['status', 'urls', 'urlRecovered', 'identity']) && output.status === 'POSTED' && urlsValid &&
      typeof output.urlRecovered === 'boolean' && output.identity === payload.identity &&
      output.urls.length <= segments.length && output.urlRecovered === (output.urls.length === segments.length)) return output;
  return { status: 'POST_UNKNOWN', urls: [], postedCount: 0, reason: 'EGO_SCHEMA_INVALID' };
}

export async function readback(payload, env = process.env) {
  if (!exactKeys(payload, ['urls', 'bodies']) || !Array.isArray(payload.urls) || !Array.isArray(payload.bodies) ||
      payload.urls.some(u => !validString(u, 2048)) || !payload.urls.length || payload.urls.length !== payload.bodies.length ||
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
    if (command === 'scan') {
      emit(await scan(JSON.parse(await readStdin()), process.env));
      return;
    }
    if (command === 'compare') {
      emit(compareCandidates(JSON.parse(await readStdin())));
      return;
    }
    if (command === 'fetch-media') {
      emit(await fetchScannedMedia(JSON.parse(await readStdin()), process.env));
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
