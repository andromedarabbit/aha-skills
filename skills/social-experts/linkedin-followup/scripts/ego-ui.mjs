import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

const MAX_OUTPUT = 2 * 1024 * 1024;
// read fullText 검증 상한: 자르지 않은 원문이 이보다 길면 조용히 자르지 않고 스키마 실패로 멈춘다.
// shortcut: LinkedIn 메시지 길이 제한(약 8,000자)보다 넉넉히 잡은 값 — 실측으로 더 긴 원문이 나오면 올린다.
const FULL_TEXT_MAX = 20000;
const TIMEOUT_MS = 125000;
const ORIGIN = 'https://www.linkedin.com';
const fail = (code, reason) => Object.assign(new Error, { code, reason });

// 단계별 사유 코드(KTD15). ce-debug에서 확인한 오류 합침을 반복하지 않기 위해
// 허용 코드 목록을 어댑터와 runner 양쪽에 명시적으로 나열한다.
export const EGO_STEP_CODES = Object.freeze([
  'EGO_SPACE_FAILED', 'EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_TAB_NOT_FOUND',
  'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_ATTACH_FAILED', 'EGO_SNAPSHOT_FAILED',
  'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_FINGERPRINT_MISMATCH', 'EGO_THREAD_NOT_OBSERVED',
]);
export const EGO_FAILURE_REASONS = Object.freeze([
  'EGO_SPAWN_FAILED', 'EGO_PROCESS_FAILED', 'EGO_STDIN_FAILED', 'EGO_STDOUT_FAILED', 'EGO_STDERR_FAILED',
  'EGO_TIMEOUT', 'EGO_STDOUT_LIMIT', 'EGO_STDERR_LIMIT', 'EGO_EXIT_FAILED', 'EGO_CONNECT_FAILED',
  'EGO_UTF8_INVALID', 'EGO_JSON_INVALID', 'EGO_SCHEMA_INVALID',
]);

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validString(value, limit) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
}

// binding은 ego 자원 경계(executable·TaskSpace 이름, snapshot 시 Page 라벨)만 받는다.
// Aside 전용 키와 임의 추가 키는 자식 시작 전에 거부한다.
export function validateEgoInput(binding) {
  const keys = ['executable', 'taskSpaceName'];
  const hasPage = Object.hasOwn(binding ?? {}, 'pageLabel');
  if (hasPage) keys.push('pageLabel');
  if (!exactKeys(binding, keys)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  for (const key of keys.filter(key => key !== 'executable')) {
    if (!validString(binding[key], 512) || binding[key].startsWith('-')) throw fail('INVALID_ARGUMENT');
  }
  return hasPage ? 'snapshot' : 'pages';
}

// ego 스크립트는 마지막에 정확히 한 번 JSON을 출력한다. 2026-11-14 실측(0.6.3.14): 파이프 스크립트의
// console.log·process.stdout.write는 모두 stderr로 우회되고 stdout은 비어 있다. 따라서 stdout에 내용이
// 있으면 그것만 엄격히 검증하고(미래 계약 변경 대비), 비어 있으면 stderr에서 줄 단위로 페이로드를 찾는다 —
// 정확히 한 줄만 JSON이어야 하고 그 외 비어 있지 않은 줄은 [ego-browser:notice] 공지뿐이어야 한다(가이드
// §327 전제). 그 외 출력은 EGO_JSON_INVALID로 안전 실패한다(KTD2). ego 앱·서비스 도달 실패로 추정되는
// 자식 실패는 EGO_CONNECT_FAILED로 보고하되 앱 미실행으로 단정하지 않는다(KTD18).
function execute(binding, script) {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CI: '1', NO_COLOR: '1' };
  for (const key of ['HOME', 'LANG', 'LC_ALL', 'TZ']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binding.executable, ['nodejs'], { env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { reject(fail('EGO_OUTCOME_UNKNOWN', 'EGO_SPAWN_FAILED')); return; }
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
      if (reason) { reject(fail('EGO_OUTCOME_UNKNOWN', reason)); return; }
      resolve(value);
    };
    const abort = reason => {
      if (settled) return;
      // CLI 종료는 브라우저 작업의 취소 증거가 아니다. 호출 측에서 자동 재시도하지 않는다.
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
      finish(reason);
    };
    const timer = setTimeout(() => abort('EGO_TIMEOUT'), TIMEOUT_MS);
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

// 스페이스 확보는 LinkedIn 계정 확인을 대신하지 않는다.
export async function observeEgoPages(binding) {
  if (validateEgoInput(binding) !== 'pages') throw fail('INVALID_ARGUMENT');
  // ego CLI는 파이프 스크립트를 sloppy CJS eval로 돌린다 — `await (`로 시작하면 식별자 호출로 파싱돼
  // ReferenceError로 죽는다(2026-11-14 첫 실측). async IIFE + .catch로 감싸 어떤 모드에서도 안전하게 만든다.
  const script = `(${observePages.toString()})(${JSON.stringify(binding.taskSpaceName)}, ${messageLocation.toString()}).catch(() => { console.log(JSON.stringify({ status: 'EGO_SNAPSHOT_FAILED' })); });`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && EGO_STEP_CODES.includes(output.status)) throw fail(output.status);
  if (!exactKeys(output, ['status', 'pages']) || output.status !== 'PAGES_OBSERVED' || !Array.isArray(output.pages)) throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
  const seen = new Set();
  for (const page of output.pages) {
    if (!exactKeys(page, ['label', 'origin', 'location']) || !validString(page.label, 512) || page.label.startsWith('-') ||
        page.origin !== ORIGIN || !['list', 'subpath'].includes(page.location) || seen.has(page.label)) throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
    seen.add(page.label);
  }
  return output;
}

// 지정 Page의 전체 snapshot만 읽는다. 이동·입력·클릭·API 호출은 없다.
export async function readEgoPageSnapshot(binding) {
  if (validateEgoInput(binding) !== 'snapshot') throw fail('INVALID_ARGUMENT');
  const script = `(${observePage.toString()})(${JSON.stringify(binding.pageLabel)}, ${JSON.stringify(binding.taskSpaceName)}, ${messageLocation.toString()}, ${loginPath.toString()}, ${authForm.toString()}).catch(() => { console.log(JSON.stringify({ status: 'EGO_SNAPSHOT_FAILED' })); });`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && EGO_STEP_CODES.includes(output.status)) throw fail(output.status);
  if (!exactKeys(output, ['status', 'pageLabel', 'origin', 'snapshot']) || output.status !== 'OBSERVED' ||
      output.pageLabel !== binding.pageLabel || output.origin !== ORIGIN ||
      typeof output.snapshot !== 'string' || !output.snapshot.length) throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
  return output;
}

// 이하 고정 스크립트 함수들. toString()으로 ego 자식에 전달되므로 바깥 변수에 의존하지 않는다.
// 임의 작업·코드 입력은 없으며 입력은 데이터로만 주입된다.

// 부모·스크립트가 같은 규약을 공유하는 URL 판정: credentials 없는 정확한 HTTPS
// www.linkedin.com origin의 /messaging·/messaging/ 하위만 조회 대상이다(KTD11).
function messageLocation(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== 'https://www.linkedin.com' || url.username || url.password) return null;
  if (url.pathname === '/messaging' || url.pathname === '/messaging/') return 'list';
  return url.pathname.startsWith('/messaging/') ? 'subpath' : null;
}

// 로그인·세션 만료 계열 경로(KTD18). 판정은 경로 구조만 쓰며 원문 URL은 반환하지 않는다.
// G0 관측 전까지의 보수적 목록이며 실제 만료 화면 확인 뒤 조정한다.
function loginPath(value) {
  if (typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password) return false;
  const path = url.pathname;
  return path === '/login' || path.startsWith('/login/') ||
    path === '/authwall' || path.startsWith('/authwall/') ||
    path.startsWith('/checkpoint') || path.startsWith('/u/login');
}

// snapshot에서 인증 폼을 찾는다(KTD18 (b)). 내용 텍스트가 아니라 접근성 트리의 역할 행
// 구조만 본다. G1 실관측 전의 보수적 휴리스틱이며 실제 로그인 화면 확인 뒤 조정한다.
function authForm(snapshot) {
  if (typeof snapshot !== 'string') return false;
  return /(^|\n)\s*(?:password\b|textbox\s+"[^"]*password)/i.test(snapshot);
}

async function observePages(spaceName, classify) {
  let task;
  try {
    task = await taskSpace(spaceName);
  } catch (error) {
    // claim·listTaskSpaces로 소유를 확인하지 않는다. 사용자 소유 스페이스 보호(KTD16).
    const nameInUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: nameInUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    if (!Array.isArray(pages)) stop('EGO_TABS_FAILED');
    const observed = [];
    for (const page of pages) {
      if (!page || typeof page.label !== 'string') stop('EGO_TABS_FAILED');
      const location = classify(await page.url());
      if (location) observed.push({ label: page.label, origin: 'https://www.linkedin.com', location });
    }
    console.log(JSON.stringify({ status: 'PAGES_OBSERVED', pages: observed }));
  } catch {
    console.log(JSON.stringify({ status: 'EGO_TABS_FAILED' }));
  }
}

async function observePage(pageLabel, spaceName, classify, login, authFormDetect) {
  let task;
  try {
    task = await taskSpace(spaceName);
  } catch (error) {
    const nameInUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: nameInUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  const checkUrl = value => {
    if (!classify(value)) {
      stop(login(value) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
    }
  };
  try {
    let pages;
    try {
      pages = await task.pages();
    } catch {
      stop('EGO_TABS_FAILED');
    }
    if (!Array.isArray(pages)) stop('EGO_TABS_FAILED');
    const matches = pages.filter(page => page?.label === pageLabel);
    if (matches.length !== 1) stop('EGO_TAB_NOT_FOUND');
    checkUrl(await matches[0].url());
    let page;
    try {
      page = task.page(pageLabel);
      checkUrl(await page.url());
    } catch (error) { stop(error?.code ?? 'EGO_ATTACH_FAILED'); }
    const observed = await page.snapshot();
    checkUrl(await page.url());
    if (authFormDetect(observed)) stop('EGO_NEEDS_LOGIN');
    if (observed === null || observed === undefined) stop('EGO_SNAPSHOT_FAILED');
    if (typeof observed !== 'string') stop('EGO_SCHEMA_INVALID');
    if (!observed.length) stop('EGO_SNAPSHOT_FAILED');
    console.log(JSON.stringify({
      status: 'OBSERVED', pageLabel, origin: 'https://www.linkedin.com', snapshot: observed,
    }));
  } catch (error) {
    const codes = ['EGO_TABS_FAILED', 'EGO_TAB_NOT_FOUND', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_ATTACH_FAILED', 'EGO_SNAPSHOT_FAILED', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_SNAPSHOT_FAILED' }));
  }
}

// setup(온보딩) 고정 작업(KTD21): /in/me → slug·ACoAAA ID, /messaging → 인증·구조.
// 대화 클릭·입력·전송 없음. /messaging/ 접속의 부수 스레드 개방은 승인 설명 대상(G2).
async function acquireIdentity(spaceName, meUrl, messagingUrl, classify, login) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const nameInUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: nameInUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    if (!Array.isArray(pages)) stop('EGO_TABS_FAILED');
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    if (!page) stop('EGO_ATTACH_FAILED');
    await page.goto(meUrl, { timeout: 45000 });
    // /in/me는 SPA 리다이렉트로 slug 확정이 늦는다(G2 실측) — 리다이렉트 완료를 기다리고 게이트는 유지한다.
    try { await page.waitForFunction(() => /^\/in\/(?!me\/?$)[^/]+/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
    const meUrl2 = await page.url();
    // 신원 다리의 경계: 정확한 origin만 허용하고, 로그인 화면은 별도 사유로 구분한다(리뷰 #3·6).
    if (new URL(meUrl2).origin !== 'https://www.linkedin.com') stop('EGO_ORIGIN_MISMATCH');
    if (login(meUrl2)) stop('EGO_NEEDS_LOGIN');
    const slug = /^\/in\/([^/]+)/.exec(new URL(meUrl2).pathname)?.[1] ?? null;
    if (!slug || slug === 'me') stop('EGO_SCHEMA_INVALID');
    const rawId = await page.evaluate(() => {
      const runs = [...document.querySelectorAll('[id*="ACoAAA"]')]
        .map(el => /ACoAAA[A-Za-z0-9]+/.exec(el?.id || '')?.[0])
        .filter(Boolean);
      if (!runs.length) return null;
      // 실측(2026-11-14): /in/me의 id는 `com.linkedin.sdui.profile.card.ref<ACoAAA…><섹션명>` 형태라
      // 탐욕 실행이 섹션 접미사(Topcard 등)까지 삼킨다. 전 실행의 최장 공통 접두사가 참 ID다.
      let prefix = runs[0];
      for (const run of runs) {
        let i = 0;
        while (i < prefix.length && i < run.length && prefix[i] === run[i]) i += 1;
        prefix = prefix.slice(0, i);
      }
      return prefix;
    });
    if (!/^ACoAAA[A-Za-z0-9]{24,34}$/.test(String(rawId))) stop('EGO_SCHEMA_INVALID');
    await page.goto(messagingUrl, { timeout: 45000 });
    const currentUrl = await page.url();
    if (!classify(currentUrl)) stop(login(currentUrl) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
    // fingerprint 질의 전 렌더 대기 — scanList와 같은 패턴(측정 기계 통일 — 리뷰 #1).
    try { await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 200, undefined, { timeout: 20000 }); } catch {}
    // fingerprint은 scan과 동일한 DOM 질의로 계산한다(측정 기계 통일 — 리뷰 #1).
    const fingerprint = await page.evaluate(() => {
      const labels = [...new Set(
        [...document.querySelectorAll('[role="radiogroup"] button')].map(b => (b.textContent || '').trim()).filter(Boolean)
      )].sort();
      return { labels, hasConversationList: [...document.querySelectorAll('ul')].some(u => /conversation/i.test(u.getAttribute('aria-label') || '')) };
    });
    if (!fingerprint || !Array.isArray(fingerprint.labels) || !fingerprint.labels.length || typeof fingerprint.hasConversationList !== 'boolean') stop('EGO_SCHEMA_INVALID');
    console.log(JSON.stringify({
      status: 'IDENTITY_ACQUIRED', slug, profileId: rawId,
      messaging: classify(currentUrl), fingerprint,
    }));
  } catch (error) {
    const codes = ['EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SNAPSHOT_FAILED', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_SNAPSHOT_FAILED' }));
  }
}

// setup 첫 단계: 계정·구조 확보(CONFIRM_ACCOUNT 제시용). 상태 저장 없이 관측만 반환한다.
export async function acquireEgoIdentity(binding) {
  if (!exactKeys(binding, ['executable', 'taskSpaceName'])) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.taskSpaceName, 512) || binding.taskSpaceName.startsWith('-')) throw fail('INVALID_ARGUMENT');
  const script = `(${acquireIdentity.toString()})(${JSON.stringify(binding.taskSpaceName)}, 'https://www.linkedin.com/in/me/', 'https://www.linkedin.com/messaging/', ${messageLocation.toString()}, ${loginPath.toString()}).catch(() => { console.log(JSON.stringify({ status: 'EGO_SNAPSHOT_FAILED' })); });`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && EGO_STEP_CODES.includes(output.status)) throw fail(output.status);
  const fp = output?.fingerprint;
  if (!exactKeys(output, ['status', 'slug', 'profileId', 'messaging', 'fingerprint']) || output.status !== 'IDENTITY_ACQUIRED' ||
      !validString(output.slug, 128) || !/^ACoAAA[A-Za-z0-9]{24,34}$/.test(String(output.profileId)) ||
      !['list', 'subpath'].includes(output.messaging) ||
      !fp || !exactKeys(fp, ['labels', 'hasConversationList']) || !Array.isArray(fp.labels) || !fp.labels.length ||
      fp.labels.some(label => !validString(label, 64)) || typeof fp.hasConversationList !== 'boolean') {
    throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
  }
  return output;
}

// scan 고정 작업(U9·U10): fingerprint 검사 → 필터 발견 → lazy append 목록 순회.
// 상세 개방·클릭·입력 없이 목록 관측만 한다. deadline 초과 시 부분 관측으로 정상 종료한다.
async function scanList(spaceName, messagingUrl, expectedFingerprintJson, deadlineMs, classify, login, ownerSlug, ownerProfileId) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const nameInUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: nameInUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    if (!Array.isArray(pages)) stop('EGO_TABS_FAILED');
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    if (!page) stop('EGO_ATTACH_FAILED');
    // 수동 응답 관측 준비(2026-11-16): Network 도메인을 켜고, 페이지가 스스로 수신한 messaging API 응답
    // 본문만 읽는다. 새 요청을 만들지 않고 쿼리 식별자·해시를 굳히지 않으며, 어떤 관측 실패도
    // captureCount 0으로 내려보내 DOM 증명 계층이 이어받는다(KTD13 — 판정 불명은 부분 종료가 우선).
    let netCapture = false;
    try { await page.cdp('Network.enable', {}); netCapture = true; } catch {}
    const captureBodies = [];
    const capturePending = new Map();
    const captureSeen = new Set();
    const matchMessagingUrl = value => typeof value === 'string' && value.includes('/voyager/api/') &&
      (/messaging/i.test(value) || value.includes('voyagerMessagingGraphQL'));
    const drainCapture = async () => {
      if (!netCapture) return;
      try {
        const evs = await page.events();
        for (const e of Array.isArray(evs) ? evs : []) {
          const requestId = e?.params?.requestId;
          const method = e?.method;
          if (method === 'Network.responseReceived' && typeof requestId === 'string' && !captureSeen.has(requestId) &&
              matchMessagingUrl(e?.params?.response?.url)) capturePending.set(requestId, e.params.response.url);
          if (method === 'Network.loadingFinished' && typeof requestId === 'string' &&
              capturePending.has(requestId) && !captureSeen.has(requestId)) {
            captureSeen.add(requestId);
            if (captureBodies.length >= 8) continue;
            try {
              const body = await page.cdp('Network.getResponseBody', { requestId });
              const text = body?.base64Encoded ? Buffer.from(String(body?.body ?? ''), 'base64').toString('utf8') : String(body?.body ?? '');
              if (text) captureBodies.push(text);
            } catch {}
          }
        }
      } catch { netCapture = false; }
    };
    // 대화·메시지 객체를 셰이프 방식으로 찾는다: 대화는 uuid 식별자 + 이벤트 배열을 함께 갖는 노드,
    // 메시지는 conversationUrn(uuid)을 가진 단독 노드(normalized+json included 레이아웃 대응).
    // 본문·발신자는 알려진 키만 좁게 읽고, urn·URL·긴 base64 모양 문자열은 본문 후보에서 제외한다.
    const textOf = value => {
      if (typeof value === 'string') {
        // JSON 문자열 본문(normalized+json)은 1회 파싱해 재시도한다.
        if (value.startsWith('{"')) {
          try { return textOf(JSON.parse(value)); } catch { return ''; }
        }
        if (/^(urn:|https?:\/\/|[A-Za-z0-9+/=]{80,})$/.test(value.trim())) return '';
        return value.trim() ? value : '';
      }
      if (!value || typeof value !== 'object') return '';
      for (const key of ['text', 'body', 'messageBody', 'attributedBody']) {
        if (value[key] !== undefined) {
          const got = textOf(value[key]);
          if (got) return got;
        }
      }
      const content = value.eventContent;
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        for (const v of Object.values(content)) {
          if (!v || typeof v !== 'object') continue;
          for (const key of ['attributedBody', 'body', 'text', 'messageBody']) {
            if (v[key] !== undefined) {
              const got = textOf(v[key]);
              if (got) return got;
            }
          }
        }
      }
      return '';
    };
    const timestampOf = ev => {
      for (const key of ['deliveredAt', 'createdAt']) {
        const value = ev?.[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
      }
      return null;
    };
    const senderOf = ev => {
      const out = { slug: null, id: null };
      const dig = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 4) return;
        if (Array.isArray(node)) { for (const x of node) dig(x, depth + 1); return; }
        if (typeof node.publicIdentifier === 'string' && node.publicIdentifier && !out.slug) out.slug = node.publicIdentifier;
        if (!out.id) {
          for (const key of ['entityUrn', 'objectUrn']) {
            const value = node[key];
            if (typeof value !== 'string') continue;
            if (value.startsWith('ACoAAA')) { out.id = value; break; }
            const m = /ACoAAA[A-Za-z0-9]+/.exec(value);
            if (m) { out.id = m[0]; break; }
          }
        }
        for (const v of Object.values(node)) dig(v, depth + 1);
      };
      const from = ev?.from ?? ev?.sender ?? ev?.actor ?? ev?.senderUrn ?? ev?.actorUrn;
      if (typeof from === 'string') dig({ entityUrn: from }, 0);
      else dig(from, 0);
      return out.slug || out.id ? out : null;
    };
    const extractConversations = text => {
      let data;
      try { data = JSON.parse(text); } catch { return []; }
      const conversations = new Map();
      const uuidFrom = value => {
        if (typeof value !== 'string') return null;
        const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(value);
        return m ? m[0] : null;
      };
      const eventsOf = node => {
        for (const key of ['events', 'backendMessages']) {
          if (Array.isArray(node[key]) && node[key].length && node[key].every(x => x && typeof x === 'object')) return node[key];
        }
        // 실측(2026-11-16) GraphQL 형태: 대화 노드의 messages는 객체이고 배열은 messages.elements에 있다.
        for (const key of ['messages']) {
          const nested = node[key];
          if (nested && typeof nested === 'object' && !Array.isArray(nested) &&
              Array.isArray(nested.elements) && nested.elements.length && nested.elements.every(x => x && typeof x === 'object')) return nested.elements;
          if (Array.isArray(node[key]) && node[key].length && node[key].every(x => x && typeof x === 'object')) return node[key];
        }
        return node.lastEvent && typeof node.lastEvent === 'object' ? [node.lastEvent] : null;
      };
      // 실측(2026-11-16): 대화 uuid는 conversationUrl의 스레드 seg(2-+base64url(uuid_n))에 있다 — DOM 계층과
      // 같은 규칙. entityUrn·backendUrn에는 uuid가 없다. 구형 형태(conversationUrn 등)는 키 기반으로 보조한다.
      const segUuidOf = node => {
        const seg = /\/messaging\/thread\/([^/]+)/.exec(String(node.conversationUrl ?? ''))?.[1] ?? null;
        if (!seg || !seg.startsWith('2-')) return null;
        try {
          const decoded = Buffer.from(seg.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
          const candidate = decoded.split('_')[0];
          return /^[0-9a-f-]{16,64}$/i.test(candidate) ? candidate : null;
        } catch { return null; }
      };
      const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 12) return;
        if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
        const evs = eventsOf(node);
        const uuid = segUuidOf(node) ?? uuidFrom(node.conversationUuid) ?? uuidFrom(node.conversationUrn) ??
          uuidFrom(node.entityUrn) ?? uuidFrom(node.dashEntityUrn) ?? uuidFrom(node.backendUrn);
        if (evs && uuid) {
          const entry = conversations.get(uuid) ?? { uuid, events: [], node };
          if (!entry.node) entry.node = node;
          for (const ev of evs) if (ev && typeof ev === 'object') entry.events.push(ev);
          conversations.set(uuid, entry);
          return;
        }
        // 대화 노드가 아니면서 conversationUrn을 가진 메시지 단독 노드도 수집한다.
        if (!evs && uuid) {
          const lastSender = senderOf(node);
          const body = textOf(node);
          if (lastSender || body) {
            const entry = conversations.get(uuid) ?? { uuid, events: [] };
            entry.events.push(node);
            conversations.set(uuid, entry);
          }
        }
        for (const v of Object.values(node)) walk(v, depth + 1);
      };
      walk(data, 0);
      // 이벤트 정렬: 타임스탬프가 있으면 오름차순, 없으면 배열 순서를 유지한다. 마지막(최신)이 판정 대상이다.
      for (const entry of conversations.values()) {
        const withStamp = entry.events.every(ev => timestampOf(ev) !== null);
        if (withStamp) entry.events.sort((a, b) => timestampOf(a) - timestampOf(b));
        entry.last = entry.events[entry.events.length - 1] ?? null;
      }
      return [...conversations.values()];
    };
    const captured = [];
    const ownerMatches = sender => {
      if (!sender) return null;
      if (ownerSlug && typeof ownerSlug === 'string' && sender.slug === ownerSlug) return true;
      if (ownerProfileId && typeof ownerProfileId === 'string' && sender.id === ownerProfileId) return true;
      if ((ownerSlug && sender.slug) || (ownerProfileId && sender.id)) return false;
      return null;
    };
    await page.goto(messagingUrl, { timeout: 45000 });
    const currentUrl = await page.url();
    if (!classify(currentUrl)) stop(login(currentUrl) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
    try { await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 200, undefined, { timeout: 20000 }); } catch {}
    await drainCapture();
    // 이동 비용을 순회 예산에서 제외해 부모 상한과의 산수 충돌을 피한다(리뷰 #8).
    const deadline = Date.now() + deadlineMs;
    const fingerprint = await page.evaluate(expected => {
      const labels = [...new Set(
        [...document.querySelectorAll('[role="radiogroup"] button')].map(b => (b.textContent || '').trim()).filter(Boolean)
      )].sort();
      return { labels, hasConversationList: [...document.querySelectorAll('ul')].some(u => /conversation/i.test(u.getAttribute('aria-label') || '')) };
    }, expectedFingerprintJson);
    if (!fingerprint || fingerprint.labels?.join('|') !== expectedFingerprintJson.labels?.join('|') ||
        fingerprint.hasConversationList !== expectedFingerprintJson.hasConversationList) stop('EGO_FINGERPRINT_MISMATCH');
    const filters = await page.evaluate(() => [...document.querySelectorAll('[role="radiogroup"] button')].map(b => ({
      label: (b.textContent || '').trim(), checked: b.getAttribute('aria-checked'),
    })));
    if (!Array.isArray(filters) || !filters.length) stop('EGO_SCHEMA_INVALID');
    const readItems = () => page.evaluate(() => {
      const list = [...document.querySelectorAll('ul')].find(u => /conversation/i.test(u.getAttribute('aria-label') || ''));
      if (!list) return { items: [], total: 0 };
      const rows = [...list.querySelectorAll(':scope > li')];
      // 실측(2026-11-14): 목록 ul에는 헤딩 없는 행(스페이서)과 "Load more conversations" 버튼 행도 li로 있다.
      // 헤딩이 있고 preview·time 중 하나라도 비어 있지 않은 행만 대화 항목으로 삼고, DOM 행 인덱스를 보존한다.
      return {
        total: rows.length,
        items: rows.slice(0, 100).map((li, index) => ({
          index,
          name: (li.querySelector('h2,h3,heading,[role="heading"]')?.textContent ?? '').trim().slice(0, 120),
          preview: (li.querySelector('p,[role="paragraph"]')?.textContent ?? '').trim().slice(0, 200),
          time: (li.querySelector('[class*="time"],time')?.textContent ?? '').trim().slice(0, 40),
        })).filter(item => item.name && (item.preview.length || item.time.length)),
      };
    });
    const resolved = new Map();
    const resolveVisible = items => {
    // 캡처 본문 → 대화 추출 → DOM 항목 매칭 → 방향 판정. 이름 일치 1건이 1차, 정규화 본문↔프리뷰 접두
    // 일치(openThread의 want 규칙과 동일)가 2차이며, 0건·2건 이상은 모호로 보고 캡처하지 않는다.
    const normalizeForMatch = value => String(value ?? '').replace(/\s+/g, ' ').trim()
      .replace(/^InMail\s*(?:•\s*)?/i, '')
      .replace(/^[^:]{1,60}:\s*/, '');
    if (netCapture && ownerSlug) {
      const extracted = [];
      for (const text of captureBodies) for (const conv of extractConversations(text)) extracted.push(conv);
      const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      const nameOf = conv => {
        // 실측 형태: 1:1 목록 행의 표시 이름은 소유자를 제외한 참가자의 member 이름이다.
        const members = Array.isArray(conv.node?.conversationParticipants) ? conv.node.conversationParticipants : [];
        const names = [];
        for (const p of members) {
          const member = p?.participantType?.member;
          const first = typeof member?.firstName === 'string' ? member.firstName : '';
          const last = typeof member?.lastName === 'string' ? member.lastName : '';
          const full = `${first} ${last}`.trim();
          if (!full) continue;
          const urns = [p.entityUrn, p.hostIdentityUrn, p.backendUrn].filter(v => typeof v === 'string').join(' ');
          const m = /ACoAAA[A-Za-z0-9]+/.exec(urns);
          if (m && ownerProfileId && m[0] === ownerProfileId) continue;
          names.push(full);
        }
        if (names.length === 1) return names[0];
        for (const ev of conv.events) {
          const from = ev.from ?? ev.sender ?? ev.actor;
          if (!from || typeof from !== 'object') continue;
          for (const v of Object.values(from)) {
            if (!v || typeof v !== 'object') continue;
            const first = typeof v.firstName === 'string' ? v.firstName : '';
            const last = typeof v.lastName === 'string' ? v.lastName : '';
            const full = `${first} ${last}`.trim();
            if (full) return full;
          }
        }
        for (const key of ['conversationName', 'name', 'title', 'headlineText']) {
          if (typeof conv.node?.[key] === 'string' && conv.node[key].trim()) return conv.node[key];
        }
        return null;
      };
      for (const item of items) {
        const wantPreview = normalizeForMatch(item.preview);
        if (!wantPreview && !norm(item.name)) continue;
        const nameMatches = norm(item.name) ? extracted.filter(conv => norm(nameOf(conv)) === norm(item.name)) : [];
        const previewMatches = wantPreview ? extracted.filter(conv => {
          const body = normalizeForMatch(textOf(conv.last));
          return body.startsWith(wantPreview);
        }) : [];
        let match = null;
        if (nameMatches.length === 1) match = nameMatches[0];
        else if (nameMatches.length === 0 && previewMatches.length === 1) match = previewMatches[0];
        if (!match || !match.last) continue;
        // 입증(증명): 캡처한 마지막 본문이 목록 프리뷰와 접두 일치해야 한다 — DOM 증명과 같은 규칙.
        const proof = normalizeForMatch(textOf(match.last)).startsWith(wantPreview);
        if (wantPreview && !proof) continue;
        const sender = senderOf(match.last);
        const isOwner = ownerMatches(sender);
        if (isOwner === null) continue;
        const direction = isOwner ? 'self' : 'other';
        const recentEvents = match.events.slice(-12);
        const directionComplete = recentEvents.every(ev => ownerMatches(senderOf(ev)) !== null);
        const readableEvents = directionComplete ? recentEvents
          .map(ev => ({ event: { senderIsOther: !ownerMatches(senderOf(ev)), text: textOf(ev).slice(0, 300) }, timestamp: timestampOf(ev) }))
          .filter(({ event }) => event.text) : [];
        const recentReadable = readableEvents.slice(-12);
        const events = recentReadable.map(item => item.event);
        const eventTimestamps = recentReadable.map(item => item.timestamp);
        resolved.set(item.index, {
          conversationUuid: match.uuid,
          lastSenderIsOther: direction === 'other',
          senderSlug: sender.slug,
          events,
          eventTimestamps,
          observedEventCount: match.events.length,
          truncatedFromOldest: match.events.length > 12,
          unreadableEventCount: directionComplete ? recentEvents.length - readableEvents.length : recentEvents.length,
        });
      }
    }

    };
    const views = [];
    let totals = [];
    let stableRounds = 0;
    let complete = false;
    while (Date.now() < deadline) {
      const view = await readItems();
      // 형식 불명 관측은 실패로 올리지 않고 부분 종료한다(KTD13 — 판정 불명은 partial이 우선).
      if (!view || !Array.isArray(view.items)) break;
      const currentUrl2 = await page.url();
      if (!classify(currentUrl2)) stop(login(currentUrl2) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
      await drainCapture();
      resolveVisible(view.items);
      const previous = views[views.length - 1];
      views.push(view.items);
      totals.push(view.total);
      if (previous && view.items.length === previous.length) {
        stableRounds += 1;
        if (stableRounds >= 2 && view.total === view.items.length) { complete = true; break; }
      } else stableRounds = 0;
      // 수신 응답 관측이 켜져 있으면 payload가 순회 근거다. 행 개수가 두 뷰 연속 동일하면 더 이상 늘어나지
      // 않는다는 뜻이고, 기존 total===items.length 조건은 행이 계속 갱신되는 실환경에서 발동하지 않았다
      // (2026-11-16 실측 — 목록 단계가 매번 순회 예산 100초를 전부 태우는 것이 병목이었다). 캡처로 해소 못한
      // 항목은 상세 개방 계층이 이어받는다.
      if (netCapture && resolved.size > 0 && previous && view.items.length === previous.length) { complete = true; break; }
      if (Date.now() + 1500 >= deadline) break;
      await page.mouse.move(200, 300);
      await page.mouse.wheel(0, 800);
      // lazy append 렌더 지연 이후에 안정성을 재측정한다(리뷰 #5).
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    const lastItems = views[views.length - 1] ?? [];
    await drainCapture();
    resolveVisible(lastItems);
    const items = lastItems.map(item => ({ ...item, capture: resolved.get(item.index) ?? null }));
    console.log(JSON.stringify({
      status: 'SCAN_OBSERVED', filters, items,
      itemCount: lastItems.length, complete,
      scrollRounds: Math.max(0, views.length - 1),
      captureCount: resolved.size,
    }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SNAPSHOT_FAILED', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_FINGERPRINT_MISMATCH'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_SNAPSHOT_FAILED' }));
  }
}

// scan 목록 관측(부모 검증): fingerprint 일치를 강제하고 항목·필터·캡처 형식을 검증한다(U9·U10).
export async function scanEgoList(binding) {
  if (!exactKeys(binding, ['executable', 'taskSpaceName', 'fingerprint', 'deadlineMs', 'ownerSlug', 'ownerProfileId'])) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.taskSpaceName, 512) || binding.taskSpaceName.startsWith('-')) throw fail('INVALID_ARGUMENT');
  const fp = binding.fingerprint;
  if (!fp || !exactKeys(fp, ['labels', 'hasConversationList']) || !Array.isArray(fp.labels) || !fp.labels.length ||
      fp.labels.some(label => !validString(label, 64)) || typeof fp.hasConversationList !== 'boolean') throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.deadlineMs) || binding.deadlineMs < 5000 || binding.deadlineMs > 115000) throw fail('INVALID_ARGUMENT');
  if (binding.ownerSlug !== null && !validString(binding.ownerSlug, 128)) throw fail('INVALID_ARGUMENT');
  if (binding.ownerProfileId !== null && !validString(binding.ownerProfileId, 64)) throw fail('INVALID_ARGUMENT');
  const script = `(${scanList.toString()})(${JSON.stringify(binding.taskSpaceName)}, 'https://www.linkedin.com/messaging/', ${JSON.stringify(fp)}, ${JSON.stringify(binding.deadlineMs)}, ${messageLocation.toString()}, ${loginPath.toString()}, ${JSON.stringify(binding.ownerSlug)}, ${JSON.stringify(binding.ownerProfileId)}).catch(() => { console.log(JSON.stringify({ status: 'EGO_SNAPSHOT_FAILED' })); });`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && EGO_STEP_CODES.includes(output.status)) throw fail(output.status);
  const captureOk = capture => {
    if (capture === null) return true;
    if (!exactKeys(capture, ['conversationUuid', 'lastSenderIsOther', 'senderSlug', 'events', 'eventTimestamps', 'observedEventCount', 'truncatedFromOldest', 'unreadableEventCount'])) return false;
    if (typeof capture.conversationUuid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(capture.conversationUuid)) return false;
    if (typeof capture.lastSenderIsOther !== 'boolean') return false;
    if (capture.senderSlug !== null && !validString(capture.senderSlug, 128)) return false;
    if (!Number.isSafeInteger(capture.observedEventCount) || capture.observedEventCount < 1 ||
        typeof capture.truncatedFromOldest !== 'boolean' || !Number.isSafeInteger(capture.unreadableEventCount) || capture.unreadableEventCount < 0) return false;
    return Array.isArray(capture.events) && capture.events.length <= 12 &&
      Array.isArray(capture.eventTimestamps) && capture.eventTimestamps.length === capture.events.length &&
      capture.eventTimestamps.every(time => time === null || (typeof time === 'number' && Number.isFinite(time))) &&
      capture.events.every(e => exactKeys(e, ['senderIsOther', 'text']) && typeof e.senderIsOther === 'boolean' &&
        typeof e.text === 'string' && e.text.length <= 300);
  };
  if (!exactKeys(output, ['status', 'filters', 'items', 'itemCount', 'complete', 'scrollRounds', 'captureCount']) || output.status !== 'SCAN_OBSERVED' ||
      !Array.isArray(output.filters) || output.filters.some(f => !f || typeof f.label !== 'string' || typeof f.checked !== 'string') ||
      !Array.isArray(output.items) || output.items.length !== output.itemCount ||
      output.items.some(item => !item || !exactKeys(item, ['index', 'name', 'preview', 'time', 'capture']) ||
        !Number.isSafeInteger(item.index) || item.index < 0 || item.index > 199 ||
        typeof item.name !== 'string' || typeof item.preview !== 'string' || typeof item.time !== 'string' || !captureOk(item.capture)) ||
      !Number.isSafeInteger(output.itemCount) || typeof output.complete !== 'boolean' || !Number.isSafeInteger(output.scrollRounds) ||
      !Number.isSafeInteger(output.captureCount)) {
    throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
  }
  return output;
}

// 상세 계층 고정 작업(KTD22): 목록 항목 클릭 → 스레드 개방 → 대화 UUID·최근 발신자·입증 추출.
// 클릭 1회, 개방 실패는 호출 측에서 항목 단위로 처리한다. 읽음 부작용은 상한·자체 기록으로 통제된다.
async function openThread(spaceName, messagingUrl, itemIndex, itemHeading, previewPrefix, deadlineMs, classify, login) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const nameInUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: nameInUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    if (!Array.isArray(pages)) stop('EGO_TABS_FAILED');
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    if (!page) stop('EGO_ATTACH_FAILED');
    await page.goto(messagingUrl, { timeout: 45000 });
    const listUrl = await page.url();
    if (!classify(listUrl)) stop(login(listUrl) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
    try { await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 200, undefined, { timeout: 20000 }); } catch {}
    // 항목 검증 후 클릭 1회
    const clickResult = await page.evaluate(({ index, heading }) => {
      const list = [...document.querySelectorAll('ul')].find(u => /conversation/i.test(u.getAttribute('aria-label') || ''));
      if (!list) return { code: 'NO_LIST' };
      const li = list.querySelectorAll(':scope > li')[index];
      if (!li) return { code: 'NO_LI' };
      const found = (li.querySelector('h2,h3,heading,[role="heading"]')?.textContent ?? '').trim();
      if (found !== heading) return { code: 'HEADING_MISMATCH' };
      // 실측(2026-11-14): li 자체 클릭은 내비게이션을 일으키지 않는다 — 행의 링크 래퍼를 클릭한다.
      const target = li.querySelector('[class*="conversation-listitem__link"], a[href], [role="link"]') ?? li;
      target.click();
      return { code: 'CLICKED' };
    }, { index: itemIndex, heading: itemHeading });
    // 목록 렌더 폴링: /messaging/ 전환 직후엔 대화 목록 ul이 아직 없다(2026-11-14 실측 NO_LIST).
    // 자동 개방이 목록을 가려도 가장 이른 렌더 창을 잡아 클릭한다. 데이터 부재(evaluate null)는 즉시 실패로 마친다.
    let listReady = false;
    const listDeadline = Date.now() + Math.min(15000, Number(deadlineMs) || 15000);
    while (Date.now() < listDeadline) {
      const probe = await page.evaluate(() => {
        const list = [...document.querySelectorAll('ul')].find(u => /conversation/i.test(u.getAttribute('aria-label') || ''));
        return list ? { rows: list.querySelectorAll(':scope > li').length } : { rows: 0 };
      });
      if (!probe) break;
      if (probe.rows >= 1) { listReady = true; break; }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!listReady) stop('EGO_SNAPSHOT_FAILED');

    // 실측(2026-11-14 첫 scan): /messaging/ 접속 시 직전 활성 스레드가 자동 개방돼 있어 렌더 대기만으로는
    // 직전 스레드의 이벤트·URL을 읽는 래스가 생긴다. 클릭 뒤 폴링으로 대기한다: URL이 스레드 경로이고
    // 마지막 이벤트 텍스트가 목록 미리보기 본문과 접두 일치해야(입증) 성공이며, 이미 열린 스레드는 즉시 통과한다.
    const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    let want = normalize(previewPrefix)
      .replace(/^InMail\s*(?:•\s*)?/i, '')
      .replace(/^[^:]{1,60}:\s*/, '');
    // scan 고정 상한(토큰 최소화): 후보 이벤트는 행당 본문 300자·최신 12개. read의 입력 상한은 readEgo가 별도로 둔다.
    const EVENT_TEXT_MAX = 300;
    const EVENT_MAX = 12;
    let conversationUuid = null;
    let lastSenderIsOther = false;
    let proofMatch = false;
    let lastEventReadable = false;
    let threadSeg = null;
    let events = [];
    let eventIds = [];
    let observedEventCount = 0;
    let truncatedFromOldest = false;
    let unreadableEventCount = 0;
    let segSeen = false;
    let prevUuid = null;
    let stableTicks = 0;
    const openDeadline = Date.now() + Math.min(20000, Number(deadlineMs) || 20000);
    while (Date.now() < openDeadline) {
      const threadUrl = await page.url();
      if (!classify(threadUrl)) stop(login(threadUrl) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
      const seg = /\/messaging\/thread\/([^/]+)/.exec(new URL(threadUrl).pathname)?.[1] ?? null;
      // 스레드 seg는 `2-` + base64url(<대화UUID>_<n>)이다(G1 실측). `2-`를 벗기고 디코딩해야 UUID가 나온다.
      if (seg && seg.startsWith('2-')) {
        segSeen = true;
        let uuid = null;
        try {
          const decoded = Buffer.from(seg.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
          const candidate = decoded.split('_')[0];
          if (/^[0-9a-f-]{16,64}$/i.test(candidate)) uuid = candidate;
        } catch {}
        if (uuid) {
          // 행 수 안정화(2틱): 최신 메시지의 늦은 렌더를 기다린다 — 즉시 추출은 이전분을 누락할 수 있다
          // (2026-11-15 실측). deadline 잔여분 안에서만 대기한다.
          let rowStable = 0;
          let prevRows = -1;
          const rowDeadline = Math.min(Date.now() + 5000, openDeadline);
          while (Date.now() < rowDeadline) {
            const rc = await page.evaluate(() => [...document.querySelectorAll('.msg-s-event-listitem[data-event-urn]')].length);
            if (rc == null) stop('EGO_EVAL_STOPPED');
            rowStable = rc === prevRows ? rowStable + 1 : 1;
            prevRows = rc;
            if (rowStable >= 2) break;
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          // 실측(2026-11-14, KTD19 반증): data-event-urn의 프로필 세그먼트는 메시지 발신자가 아니라
          // 수신함 소유자(나)다. 메시지 행(.msg-s-event-listitem)의 `--other` 클래스가 실제 발신 신호다 —
          // 상대 메시지에는 붙고 내 메시지에는 없다(그룹 스레드의 타 멤버 메시지에도 붙는다).
          const thread = await page.evaluate(({ eventTextMax, eventMax }) => {
            const extract = row => {
              const isOther = /(^|\s)msg-s-event-listitem--other(\s|$)/.test(String(row.className || ''));
              // 블록 경계 공백 복원: 이 편집기는 문단을 블록으로 만들고 textContent 직렬화가 경계
              // 공백을 유실한다(2026-11-15 실측: "connecting.You're"). 블록별 텍스트를 공백으로 이어 붙인다.
              // 이벤트 컨테이너 textContent는 'View <이름>'s profile … 시각 … 이모지 액션 바'가 앞에 붙는다.
              // 복제본에서 헤더·액션 마크업을 떼고 버블 본문만 남긴다.
              const clone = row.cloneNode(true);
              for (const el of clone.querySelectorAll('[class*="listitem__link"], [class*="message-group__meta"], [class*="actions-container"], [class*="emoji-popular"], [class*="a11y-text"]')) el.remove();
              const parts = clone.children.length ? [...clone.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean) : [(clone.textContent || '').replace(/\s+/g, ' ').trim()];
              return { senderIsOther: isOther, text: parts.join(' ').slice(0, eventTextMax), eventId: row.getAttribute('data-event-urn') || null };
            };
            const rows = [...document.querySelectorAll('.msg-s-event-listitem[data-event-urn]')];
            const all = rows.map(extract);
            const last = rows[rows.length - 1];
            const lastIsOther = !!last && /(^|\s)msg-s-event-listitem--other(\s|$)/.test(String(last.className || ''));
            const lastText = all.length ? all[all.length - 1].text : '';
            // renderedCount는 관측된 이벤트 총수이자 스텁·테스트 분기 마커다.
            const readableEventCount = all.filter(e => e.text).length;
            const unreadableEventCount = all.slice(-eventMax).filter(e => !e.text).length;
            return { lastSenderIsOther: lastIsOther, text: lastText, renderedCount: all.length,
              readableEventCount, unreadableEventCount, events: all.slice(-eventMax).filter(e => e.text) };
          }, { eventTextMax: EVENT_TEXT_MAX, eventMax: EVENT_MAX });
          if (thread && typeof thread.text === 'string') {
            conversationUuid = uuid;
            lastSenderIsOther = thread.lastSenderIsOther;
            proofMatch = normalize(thread.text).startsWith(want);
            // 가독 판정(2026-11-17 실측): InMail 제목형 프리뷰는 버블에 렌더되지 않아 접두 입증이
            // 구조적으로 실패한다. 마지막 버블 내용이 읽혔으면 DOM 발신자 판정을 그대로 신뢰한다.
            lastEventReadable = normalize(thread.text).length > 0;
            threadSeg = seg;
            observedEventCount = thread.renderedCount;
            truncatedFromOldest = thread.renderedCount > EVENT_MAX;
            unreadableEventCount = thread.unreadableEventCount;
            const readableEvents = lastEventReadable && Array.isArray(thread.events) ? thread.events.slice(-EVENT_MAX) : [];
            events = readableEvents.map(({ senderIsOther: sender, text }) => ({ senderIsOther: sender, text }));
            eventIds = readableEvents.map(event => event.eventId);
            if (proofMatch) break;
            // 같은 UUID에서 세 틱 연속 입증 실패면 이미 열린 스레드가 그것이라는 뜻이다 — 대기 없이 UNPROVEN으로 마친다.
            if (uuid === prevUuid) { stableTicks += 1; if (stableTicks >= 3) break; }
            else { prevUuid = uuid; stableTicks = 1; }
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!segSeen) stop('EGO_ATTACH_FAILED');
    console.log(JSON.stringify({
      status: 'THREAD_OBSERVED', conversationUuid,
      lastSenderIsOther, proofMatch, lastEventReadable, threadSeg, events, eventIds,
      observedEventCount, truncatedFromOldest, unreadableEventCount,
    }));
  } catch (error) {
    const codes = ['EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SNAPSHOT_FAILED', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_TAB_NOT_FOUND'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

// 상세 계층 부모 검증: openThread 결과의 UUID·발신자·입증 형식을 강제한다(U11).
export async function openEgoThread(binding) {
  if (!exactKeys(binding, ['executable', 'taskSpaceName', 'itemIndex', 'itemHeading', 'previewPrefix', 'deadlineMs'])) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.taskSpaceName, 512) || binding.taskSpaceName.startsWith('-')) throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.itemIndex) || binding.itemIndex < 0 || binding.itemIndex > 199) throw fail('INVALID_ARGUMENT');
  if (typeof binding.itemHeading !== 'string' || !binding.itemHeading.length || binding.itemHeading.length > 120) throw fail('INVALID_ARGUMENT');
  if (typeof binding.previewPrefix !== 'string' || binding.previewPrefix.length > 200) throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.deadlineMs) || binding.deadlineMs < 5000 || binding.deadlineMs > 60000) throw fail('INVALID_ARGUMENT');
  const script = `(${openThread.toString()})(${JSON.stringify(binding.taskSpaceName)}, 'https://www.linkedin.com/messaging/', ${JSON.stringify(binding.itemIndex)}, ${JSON.stringify(binding.itemHeading)}, ${JSON.stringify(binding.previewPrefix)}, ${JSON.stringify(binding.deadlineMs)}, ${messageLocation.toString()}, ${loginPath.toString()}).catch(() => { console.log(JSON.stringify({ status: 'EGO_SNAPSHOT_FAILED' })); });`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && EGO_STEP_CODES.includes(output.status)) throw fail(output.status);
  const uuidOk = typeof output.conversationUuid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(output.conversationUuid);
  const segOk = typeof output.threadSeg === 'string' && /^2-[A-Za-z0-9_-]{2,254}={0,2}$/.test(output.threadSeg);
  const eventsOk = Array.isArray(output.events) && output.events.length <= 12 &&
    output.events.every(e => exactKeys(e, ['senderIsOther', 'text']) && typeof e.senderIsOther === 'boolean' &&
      typeof e.text === 'string' && e.text.length <= 300);
  const eventIdsOk = Array.isArray(output.eventIds) && output.eventIds.length === output.events?.length &&
    output.eventIds.every(id => id === null || (typeof id === 'string' && id.length <= 2048 &&
      ![...id].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)));
  if (!exactKeys(output, ['status', 'conversationUuid', 'lastSenderIsOther', 'proofMatch', 'lastEventReadable', 'threadSeg', 'events', 'eventIds', 'observedEventCount', 'truncatedFromOldest', 'unreadableEventCount']) || output.status !== 'THREAD_OBSERVED' ||
      !uuidOk || !segOk || !eventsOk || !eventIdsOk || typeof output.lastSenderIsOther !== 'boolean' ||
      typeof output.proofMatch !== 'boolean' || typeof output.lastEventReadable !== 'boolean' ||
      !Number.isSafeInteger(output.observedEventCount) || output.observedEventCount < output.events.length ||
      typeof output.truncatedFromOldest !== 'boolean' || !Number.isSafeInteger(output.unreadableEventCount) || output.unreadableEventCount < 0) throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
  const { eventIds, ...result } = output;
  return { ...result, eventIdentities: eventIds.map(id => id === null ? null : createHash('sha256').update(id).digest('hex')) };
}

// 승인된 본문의 UI 전송(KTD6): 대화 개방 → 전송 직전 기준 재검증 → 빈 composer 확인 → 본문 삽입·정확한
// readback → 전송 버튼 1회 클릭 → 새 자기 발신 이벤트 증거. 클릭 이전 단계의 실패는 안전 차단이고,
// 클릭 뒤 증거 부족은 SEND_UNKNOWN(결과 불명)이다.
async function sendThread(spaceName, messagingUrl, conversationName, conversationUuid, expectedBody, deadlineMs, classify, login) {

  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const nameInUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: nameInUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    if (!Array.isArray(pages)) stop('EGO_TABS_FAILED');
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    if (!page) stop('EGO_ATTACH_FAILED');
    await page.goto(messagingUrl, { timeout: 45000 });
    const listUrl = await page.url();
    if (!classify(listUrl)) stop(login(listUrl) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
    let listReady = false;
    const listDeadline = Date.now() + Math.min(15000, Number(deadlineMs) || 15000);
    while (Date.now() < listDeadline) {
      const probe = await page.evaluate(() => {
        const list = [...document.querySelectorAll('ul')].find(u => /conversation/i.test(u.getAttribute('aria-label') || ''));
        return list ? { rows: list.querySelectorAll(':scope > li').length } : { rows: 0 };
      });
      if (!probe) break;
      if (probe.rows >= 1) { listReady = true; break; }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!listReady) stop('EGO_SNAPSHOT_FAILED');
    const clickResult = await page.evaluate(({ heading }) => {
      const list = [...document.querySelectorAll('ul')].find(u => /conversation/i.test(u.getAttribute('aria-label') || ''));
      if (!list) return { code: 'NO_LIST' };
      for (const li of list.querySelectorAll(':scope > li')) {
        const found = (li.querySelector('h2,h3,heading,[role="heading"]')?.textContent ?? '').trim();
        if (found === heading) {
          (li.querySelector('[class*="conversation-listitem__link"], a[href], [role="link"]') ?? li).click();
          return { code: 'CLICKED' };
        }
      }
      return { code: 'NO_MATCH' };
    }, { heading: conversationName });
    if (!clickResult || clickResult.code !== 'CLICKED') stop('THREAD_NOT_MATCHED');
    // URL의 스레드 UUID가 대상과 일치할 때까지 폴링한다(다른 스레드면 대상 불일치).
    let threadReady = false;
    const readyDeadline = Date.now() + Math.min(20000, Number(deadlineMs) || 20000);
    while (Date.now() < readyDeadline) {
      const u = await page.url();
      if (!classify(u)) stop(login(u) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
      const seg = /\/messaging\/thread\/([^/]+)/.exec(new URL(u).pathname)?.[1] ?? null;
      if (seg && seg.startsWith('2-')) {
        let uuid = null;
        try {
          const decoded = Buffer.from(seg.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
          const candidate = decoded.split('_')[0];
          if (/^[0-9a-f-]{16,64}$/i.test(candidate)) uuid = candidate;
        } catch {}
        if (uuid) {
          if (uuid !== conversationUuid) stop('THREAD_NOT_MATCHED');
          const count = await page.evaluate(() => [...document.querySelectorAll('.msg-s-event-listitem[data-event-urn]')].length);
          if (count >= 1) { threadReady = true; break; }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!threadReady) stop('EGO_ATTACH_FAILED');
    // 전송 직전 기준 재검증(KTD6): 마지막 이벤트가 여전히 상대 발신이어야 한다 — 아니면 미응답이 해소된 것이다.
    const pre = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.msg-s-event-listitem[data-event-urn]')];
      const last = items[items.length - 1];
      return { isOther: !!last && /(^|\s)msg-s-event-listitem--other(\s|$)/.test(String(last.className || '')) };
    });
    if (!pre || pre.isOther !== true) stop('CRITERIA_CHANGED');
    // 기존 composer 잔여 본문: 승인된 본문과 블록 구조까지 정확히 일치하는 잔여분만은 이전 시도가 남긴
    // 것이므로 네이티브 키보드로 정리한다 — 그 외 내용은 덮지 않는 원칙은 유지한다.
    const composer = await page.evaluate(expectedText => {
      const box = document.querySelector('[role="textbox"], [contenteditable="true"]');
      if (!box) return { found: false };
      const blocks = [...box.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (!blocks.length) blocks.push((box.textContent || '').replace(/\s+/g, ' ').trim());
      const want = String(expectedText).split('\n').map(line => line.replace(/\s+/g, ' ').trim());
      const match = blocks.length === want.length && blocks.every((b, i) => b === want[i]);
      return { found: true, text: blocks.join('\n'), match, marker: 'initialCheck' };
    }, expectedBody);
    if (!composer || composer.found !== true) stop('EGO_SCHEMA_INVALID');
    if (String(composer.text ?? '').trim()) {
      if (composer.match !== true) stop('COMPOSER_NOT_EMPTY');
      try {
        await page.focus('[role="textbox"], [contenteditable="true"]');
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');
      } catch { stop('EGO_ATTACH_FAILED'); }
      const cleared = await page.evaluate(expectedText => {
        const box = document.querySelector('[role="textbox"], [contenteditable="true"]');
        if (!box) return { found: false };
        const blocks = [...box.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
        if (!blocks.length) blocks.push((box.textContent || '').replace(/\s+/g, ' ').trim());
        const want = String(expectedText).split('\n').map(line => line.replace(/\s+/g, ' ').trim());
        const match = blocks.length === want.length && blocks.every((b, i) => b === want[i]);
        return { found: true, text: blocks.join('\n'), match, marker: 'verifyCleared' };
      }, expectedBody);
      if (!cleared || typeof cleared.text !== 'string' || cleared.text.trim()) stop('COMPOSER_NOT_EMPTY');
    }
    // 본문 삽입: 네이티브 keyboard.insertText(신뢰 입력). execCommand는 비신뢰 이벤트라 LinkedIn 에디터
    // 모델이 등록하지 않는다(2026-11-15 실측 — DOM에 텍스트가 보여도 전송 UI가 렌더되지 않았다).
    try {
      await page.focus('[role="textbox"], [contenteditable="true"]');
      // 줄바꿈은 Shift+Enter로 편집기 방식대로 넣는다 — insertText의 \n은 블록으로 확장돼
      // innerText가 부풀려진다(2026-11-15 실측: \n\n → \n\n\n\n\n). 연속 빈 줄은 경계 수만큼 누른다.
      const lines = String(expectedBody).split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (i > 0) await page.keyboard.press('Shift+Enter');
        if (lines[i]) await page.keyboard.insertText(lines[i]);
      }
    } catch { stop('EGO_ATTACH_FAILED'); }
    // readback: 블록 구조가 승인된 본문과 정확히 일치해야 전송 동작을 한다.
    const readback = await page.evaluate(expectedText => {
      const box = document.querySelector('[role="textbox"], [contenteditable="true"]');
      if (!box) return { found: false };
      const blocks = [...box.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (!blocks.length) blocks.push((box.textContent || '').replace(/\s+/g, ' ').trim());
      const want = String(expectedText).split('\n').map(line => line.replace(/\s+/g, ' ').trim());
      const match = blocks.length === want.length && blocks.every((b, i) => b === want[i]);
      return { found: true, text: blocks.join('\n'), match, marker: 'verifyReadback' };
    }, expectedBody);
    if (!readback || readback.found !== true || readback.match !== true) stop('READBACK_MISMATCH');
    // 전송 동작: 이 UI 변형에는 전송 버튼이 없다 — composer 힌트가 "Press Enter to Send"이므로(2026-11-15
    // 사용자 실측) Enter 1회로 전송한다. 클릭과 같은 전송 동작이므로 이전 실패는 BLOCKED, 이후 불명은 UNKNOWN이다.
    try {
      await page.keyboard.press('Enter');
    } catch { stop('SEND_BUTTON_NOT_FOUND'); }
    // 성공 증거 폴링: 마지막 이벤트가 내 발신이고 본문이 일치해야 한다.
    const evidenceDeadline = Date.now() + Math.min(20000, Number(deadlineMs) || 20000);
    let nullTicks = 0;
    while (Date.now() < evidenceDeadline) {
      const post = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.msg-s-event-listitem[data-event-urn]')];
        const last = items[items.length - 1];
        const isOther = !!last && /(^|\s)msg-s-event-listitem--other(\s|$)/.test(String(last.className || ''));
        let text = '';
        if (last) {
          const clone = last.cloneNode(true);
          for (const el of clone.querySelectorAll('[class*="listitem__link"], [class*="message-group__meta"], [class*="actions-container"], [class*="emoji-popular"], [class*="a11y-text"]')) el.remove();
          const parts = clone.children.length ? [...clone.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean) : [(clone.textContent || '').replace(/\s+/g, ' ').trim()];
          text = parts.join(' ').slice(0, 400);
        }
        const urn = last ? String(last.getAttribute('data-event-urn') || '') : '';
        return { isOther, text, urn };
      });
      if (post && post.isOther === false && typeof post.text === 'string' && post.text) {
        const want = String(expectedBody).replace(/\s+/g, ' ').trim();
        if (post.text === want) {
          console.log(JSON.stringify({ status: 'SEND_OBSERVED', messageUrn: post.urn || null }));
          return;
        }
        nullTicks = 0;
      } else {
        nullTicks += 1;
        if (nullTicks >= 2) break;
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    console.log(JSON.stringify({ status: 'SEND_UNKNOWN' }));
  } catch (error) {
    const codes = ['THREAD_NOT_MATCHED', 'CRITERIA_CHANGED', 'COMPOSER_NOT_EMPTY', 'READBACK_MISMATCH', 'SEND_BUTTON_NOT_FOUND', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_TAB_NOT_FOUND', 'EGO_SNAPSHOT_FAILED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

const EGO_SEND_BLOCK_CODES = Object.freeze(['THREAD_NOT_MATCHED', 'CRITERIA_CHANGED', 'COMPOSER_NOT_EMPTY', 'READBACK_MISMATCH', 'SEND_BUTTON_NOT_FOUND']);

export async function sendEgoThread(binding) {
  if (!exactKeys(binding, ['executable', 'taskSpaceName', 'conversationName', 'conversationUuid', 'expectedBody', 'deadlineMs'])) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.taskSpaceName, 512) || binding.taskSpaceName.startsWith('-')) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.conversationName, 120)) throw fail('INVALID_ARGUMENT');
  if (typeof binding.conversationUuid !== 'string' || !/^[0-9a-f-]{16,64}$/i.test(binding.conversationUuid)) throw fail('INVALID_ARGUMENT');
  if (typeof binding.expectedBody !== 'string' || !binding.expectedBody.trim() || binding.expectedBody.includes('\0') || Buffer.byteLength(binding.expectedBody) > 1024 * 1024) throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.deadlineMs) || binding.deadlineMs < 5000 || binding.deadlineMs > 60000) throw fail('INVALID_ARGUMENT');
  const script = `(${sendThread.toString()})(${JSON.stringify(binding.taskSpaceName)}, 'https://www.linkedin.com/messaging/', ${JSON.stringify(binding.conversationName)}, ${JSON.stringify(binding.conversationUuid)}, ${JSON.stringify(binding.expectedBody)}, ${JSON.stringify(binding.deadlineMs)}, ${messageLocation.toString()}, ${loginPath.toString()}).catch(() => { console.log(JSON.stringify({ status: 'EGO_ATTACH_FAILED' })); });`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && (EGO_STEP_CODES.includes(output.status) || EGO_SEND_BLOCK_CODES.includes(output.status) || output.status === 'SEND_UNKNOWN')) throw fail(output.status);
  if (!exactKeys(output, ['status', 'messageUrn']) || output.status !== 'SEND_OBSERVED' ||
      (output.messageUrn !== null && !validString(output.messageUrn, 200))) throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
  return output;
}

// 대화 전체 읽기(KTD25): scan이 관측해 기록한 threadSeg(URL 경로 세그먼트)로 스레드에 직행한다.
// 목록 클릭 순회가 없어 무관한 스레드를 개방하는 부작용이 없고, URL 합성도 하지 않는다.
async function readThread(spaceName, threadUrl, maxEventChars, maxEvents, deadlineMs, classify, login) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const nameInUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: nameInUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    if (!Array.isArray(pages)) stop('EGO_TABS_FAILED');
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    if (!page) stop('EGO_ATTACH_FAILED');
    await page.goto(threadUrl, { timeout: 45000 });
    const current = await page.url();
    if (!classify(current)) stop(login(current) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
    // 렌더 안정화: 최소 1행 이후 행 수가 3틱 연속 동일해야 추출한다 — 이 화면은 오래된 메시지를
    // 늦게 렌더한다(2026-11-15 실측: 1행에서 추출해 이전 메시지를 누락, 실제 2행). deadlineMs 내에서만 대기.
    let ready = false;
    let lastCount = 0;
    let stableTicks = 0;
    const readyDeadline = Date.now() + Math.min(20000, Number(deadlineMs) || 20000);
    while (Date.now() < readyDeadline) {
      const probe = await page.evaluate(() => [...document.querySelectorAll('.msg-s-event-listitem[data-event-urn]')].length);
      if (probe == null) stop('EGO_EVAL_STOPPED');
      if (probe >= 1) {
        ready = true;
        stableTicks = probe === lastCount ? stableTicks + 1 : 1;
        lastCount = probe;
        if (stableTicks >= 3) break;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!ready) stop('EGO_SNAPSHOT_FAILED');
    const extraction = await page.evaluate(eventTextMax => {
      const extract = row => {
        const isOther = /(^|\s)msg-s-event-listitem--other(\s|$)/.test(String(row.className || ''));
        // 이벤트 컨테이너 textContent는 헤더·시각·액션 바가 앞에 붙는다 — 복제본에서 떼고 버블 본문만 남긴다.
        const clone = row.cloneNode(true);
        for (const el of clone.querySelectorAll('[class*="listitem__link"], [class*="message-group__meta"], [class*="actions-container"], [class*="emoji-popular"], [class*="a11y-text"]')) el.remove();
        const parts = clone.children.length ? [...clone.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean) : [(clone.textContent || '').replace(/\s+/g, ' ').trim()];
              const text = parts.join(' ');
              return { senderIsOther: isOther, text: eventTextMax == null ? text : text.slice(0, eventTextMax) };
      };
      const rows = [...document.querySelectorAll('.msg-s-event-listitem[data-event-urn]')];
      const renderedCount = rows.length;
      const events = rows.map(extract).filter(e => e.text);
      return { renderedCount, events };
    }, maxEventChars);
    if (!extraction || !Array.isArray(extraction.events)) stop('EGO_SNAPSHOT_FAILED');
    const returned = extraction.events.slice(-maxEvents);
    console.log(JSON.stringify({
      status: 'THREAD_READ', events: returned,
      renderedCount: extraction.renderedCount, returnedCount: returned.length,
      truncatedFromOldest: extraction.renderedCount > returned.length,
    }));
  } catch (error) {
    const codes = ['EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SNAPSHOT_FAILED', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_TAB_NOT_FOUND'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

export async function readEgoThread(binding) {
  if (!exactKeys(binding, ['executable', 'taskSpaceName', 'threadSeg', 'maxEventChars', 'maxEvents', 'deadlineMs'])) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.taskSpaceName, 512) || binding.taskSpaceName.startsWith('-')) throw fail('INVALID_ARGUMENT');
  if (typeof binding.threadSeg !== 'string' || !/^2-[A-Za-z0-9_-]{2,254}={0,2}$/.test(binding.threadSeg)) throw fail('INVALID_ARGUMENT');
  if (binding.maxEventChars !== null && (!Number.isSafeInteger(binding.maxEventChars) || binding.maxEventChars < 40 || binding.maxEventChars > 1000)) throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.maxEvents) || binding.maxEvents < 1 || binding.maxEvents > 50) throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.deadlineMs) || binding.deadlineMs < 5000 || binding.deadlineMs > 60000) throw fail('INVALID_ARGUMENT');
  const threadUrl = `https://www.linkedin.com/messaging/thread/${binding.threadSeg}/`;
  const script = `(${readThread.toString()})(${JSON.stringify(binding.taskSpaceName)}, ${JSON.stringify(threadUrl)}, ${JSON.stringify(binding.maxEventChars)}, ${JSON.stringify(binding.maxEvents)}, ${JSON.stringify(binding.deadlineMs)}, ${messageLocation.toString()}, ${loginPath.toString()}).catch(() => { console.log(JSON.stringify({ status: 'EGO_ATTACH_FAILED' })); });`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && EGO_STEP_CODES.includes(output.status)) throw fail(output.status);
  const eventsOk = Array.isArray(output.events) && output.events.length <= 50 &&
    output.events.every(e => exactKeys(e, ['senderIsOther', 'text']) && typeof e.senderIsOther === 'boolean' &&
      typeof e.text === 'string' && e.text.length >= 1 && e.text.length <= (binding.maxEventChars ?? FULL_TEXT_MAX));
  if (!exactKeys(output, ['status', 'events', 'renderedCount', 'returnedCount', 'truncatedFromOldest']) || output.status !== 'THREAD_READ' ||
      !Number.isSafeInteger(output.renderedCount) || output.renderedCount < 0 || output.renderedCount > 1999 ||
      !Number.isSafeInteger(output.returnedCount) || output.returnedCount < 0 || output.returnedCount > 50 ||
      output.renderedCount < output.returnedCount ||
      output.truncatedFromOldest !== (output.renderedCount > output.returnedCount)) throw Object.assign(fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID'), { detail: JSON.stringify(output).slice(0, 160) });
  if (!eventsOk) throw Object.assign(fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID'), { detail: JSON.stringify(output).slice(0, 160) });
  return output;
}

// messengerMessages 캡처: 스레드 페이지가 자체 요청한 GraphQL 엔드포인트를 performance API로 관측해
// 같은 세션에서 재호출한다 — URL을 합성하지 않는다. 비공식 API 응답 읽기이므로 수동 호출에서만 쓰고,
// 응답 원문은 저장하지 않고 events만 돌린다(2026-11-15 probe9-11 실측).
async function captureThread(spaceName, threadUrl, selfProfileId, maxEventChars, maxEvents, deadlineMs, classify, login) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const nameInUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: nameInUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    if (!Array.isArray(pages)) stop('EGO_TABS_FAILED');
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    if (!page) stop('EGO_ATTACH_FAILED');
    await page.goto(threadUrl, { timeout: 45000 });
    const current = await page.url();
    if (!classify(current)) stop(login(current) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
    await new Promise(resolve => setTimeout(resolve, 2000));
    let endpoint = null;
    const capDeadline = Date.now() + Math.min(4000, Number(deadlineMs) || 4000);
    while (!endpoint && Date.now() < capDeadline) {
      const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(u => u.includes('messengerMessages')));
      endpoint = Array.isArray(urls) && urls.length ? urls[0] : null;
      if (!endpoint) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!endpoint) { console.log(JSON.stringify({ status: 'CAPTURE_NO_ENDPOINT' })); return; }
    const csrf = await page.evaluate(() => (document.cookie.match(/(?:^|;)\s*JSESSIONID=([^;]+)/) || [])[1] || null);
    if (!csrf) { console.log(JSON.stringify({ status: 'CAPTURE_NO_CSRF' })); return; }
    const res = await page.fetch(endpoint, { headers: { accept: 'application/vnd.linkedin.normalized+json+2.1', 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' }, timeout: 15000 });
    if (!res || res.ok !== true || typeof res.body !== 'string') { console.log(JSON.stringify({ status: 'CAPTURE_FETCH_FAILED' })); return; }
    let body = null;
    try { body = JSON.parse(res.body); } catch { body = null; }
    const included = body && Array.isArray(body.included) ? body.included : [];
    const msgs = included.filter(e => e && e.$type === 'com.linkedin.messenger.Message');
    const events = msgs
      .map(m => ({
        deliveredAt: Number(m.deliveredAt) || 0,
        senderIsOther: !String(m['*sender'] || '').includes(selfProfileId),
        text: (t => maxEventChars == null ? t : t.slice(0, maxEventChars))(String((m.body && m.body.text) || '').replace(/\s+/g, ' ').trim()),
      }))
      .filter(e => e.text)
      .sort((a, b) => a.deliveredAt - b.deliveredAt);
    const returned = events.slice(-maxEvents);
    console.log(JSON.stringify({
      status: 'CAPTURED', events: returned.map(({ deliveredAt, ...rest }) => rest),
      renderedCount: events.length, returnedCount: returned.length,
      truncatedFromOldest: events.length > returned.length,
    }));
  } catch (error) {
    const codes = ['EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SNAPSHOT_FAILED', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_TAB_NOT_FOUND'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

export async function captureEgoThread(binding) {
  if (!exactKeys(binding, ['executable', 'taskSpaceName', 'threadSeg', 'selfProfileId', 'maxEventChars', 'maxEvents', 'deadlineMs'])) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.taskSpaceName, 512) || binding.taskSpaceName.startsWith('-')) throw fail('INVALID_ARGUMENT');
  if (typeof binding.threadSeg !== 'string' || !/^2-[A-Za-z0-9_-]{2,254}={0,2}$/.test(binding.threadSeg)) throw fail('INVALID_ARGUMENT');
  if (typeof binding.selfProfileId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(binding.selfProfileId)) throw fail('INVALID_ARGUMENT');
  if (binding.maxEventChars !== null && (!Number.isSafeInteger(binding.maxEventChars) || binding.maxEventChars < 40 || binding.maxEventChars > 1000)) throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.maxEvents) || binding.maxEvents < 1 || binding.maxEvents > 50) throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.deadlineMs) || binding.deadlineMs < 5000 || binding.deadlineMs > 60000) throw fail('INVALID_ARGUMENT');
  const threadUrl = `https://www.linkedin.com/messaging/thread/${binding.threadSeg}/`;
  const script = `(${captureThread.toString()})(${JSON.stringify(binding.taskSpaceName)}, ${JSON.stringify(threadUrl)}, ${JSON.stringify(binding.selfProfileId)}, ${JSON.stringify(binding.maxEventChars)}, ${JSON.stringify(binding.maxEvents)}, ${JSON.stringify(binding.deadlineMs)}, ${messageLocation.toString()}, ${loginPath.toString()}).catch(() => { console.log(JSON.stringify({ status: 'EGO_ATTACH_FAILED' })); });`;
  const output = await execute(binding, script);
  const captureCodes = ['CAPTURE_NO_ENDPOINT', 'CAPTURE_NO_CSRF', 'CAPTURE_FETCH_FAILED'];
  if (exactKeys(output, ['status']) && (EGO_STEP_CODES.includes(output.status) || captureCodes.includes(output.status))) throw Object.assign(fail(output.status), { detail: String(output.diagTmp ?? output.reason ?? '') || null });
  const eventsOk = Array.isArray(output.events) && output.events.length <= 50 &&
    output.events.every(e => exactKeys(e, ['senderIsOther', 'text']) && typeof e.senderIsOther === 'boolean' &&
      typeof e.text === 'string' && e.text.length >= 1 && e.text.length <= (binding.maxEventChars ?? FULL_TEXT_MAX));
  if (!exactKeys(output, ['status', 'events', 'renderedCount', 'returnedCount', 'truncatedFromOldest']) || output.status !== 'CAPTURED' ||
      !Number.isSafeInteger(output.renderedCount) || output.renderedCount < 0 || output.renderedCount > 1999 ||
      !Number.isSafeInteger(output.returnedCount) || output.returnedCount < 0 || output.returnedCount > 50 ||
      output.renderedCount < output.returnedCount ||
      output.truncatedFromOldest !== (output.renderedCount > output.returnedCount) || !eventsOk) throw Object.assign(fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID'), { detail: JSON.stringify(output).slice(0, 160) });
  return output;
}
