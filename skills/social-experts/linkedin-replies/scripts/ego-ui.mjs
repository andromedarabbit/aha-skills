import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

const MAX_OUTPUT = 2 * 1024 * 1024;
const TIMEOUT_MS = 125000;
const ORIGIN = 'https://www.linkedin.com';
const fail = (code, reason) => Object.assign(new Error, { code, reason });

// 단계별 사유 코드(KTD15). ce-debug에서 확인한 오류 합침을 반복하지 않기 위해
// 허용 코드 목록을 어댑터와 runner 양쪽에 명시적으로 나열한다.
export const EGO_STEP_CODES = Object.freeze([
  'EGO_SPACE_FAILED', 'EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_TAB_NOT_FOUND',
  'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_ATTACH_FAILED', 'EGO_SNAPSHOT_FAILED',
  'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_FINGERPRINT_MISMATCH',
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

// ego 스크립트는 마지막에 정확히 한 번 JSON을 출력한다. 그 외 stdout 출력은
// EGO_JSON_INVALID로 안전 실패한다(KTD2). ego 앱·서비스 도달 실패로 추정되는
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
      if (stderrSize > MAX_OUTPUT) abort('EGO_STDERR_LIMIT');
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (signal) { finish('EGO_EXIT_FAILED'); return; }
      if (code !== 0) { finish('EGO_CONNECT_FAILED'); return; }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output)); }
      catch { finish('EGO_UTF8_INVALID'); return; }
      let value;
      try { value = JSON.parse(text); }
      catch { finish('EGO_JSON_INVALID'); return; }
      finish(null, value);
    });
    child.stdin.end(script, 'utf8');
  });
}

// 스페이스 확보는 LinkedIn 계정 확인을 대신하지 않는다.
export async function observeEgoPages(binding) {
  if (validateEgoInput(binding) !== 'pages') throw fail('INVALID_ARGUMENT');
  const script = `await (${observePages.toString()})(${JSON.stringify(binding.taskSpaceName)}, ${messageLocation.toString()});`;
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
  const script = `await (${observePage.toString()})(${JSON.stringify(binding.pageLabel)}, ${JSON.stringify(binding.taskSpaceName)}, ${messageLocation.toString()}, ${loginPath.toString()}, ${authForm.toString()});`;
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
    const meUrl2 = await page.url();
    // 신원 다리의 경계: 정확한 origin만 허용하고, 로그인 화면은 별도 사유로 구분한다(리뷰 #3·6).
    if (new URL(meUrl2).origin !== 'https://www.linkedin.com') stop('EGO_ORIGIN_MISMATCH');
    if (login(meUrl2)) stop('EGO_NEEDS_LOGIN');
    const slug = /^\/in\/([^/]+)/.exec(new URL(meUrl2).pathname)?.[1] ?? null;
    if (!slug || slug === 'me') stop('EGO_SCHEMA_INVALID');
    const rawId = await page.evaluate(() => {
      const el = document.querySelector('[id*="ACoAAA"]');
      const m = /ACoAAA[A-Za-z0-9]+/.exec(el?.id || '');
      return m ? m[0] : null;
    });
    if (!/^ACoAAA[A-Za-z0-9]{10,}$/.test(String(rawId))) stop('EGO_SCHEMA_INVALID');
    await page.goto(messagingUrl, { timeout: 45000 });
    const currentUrl = await page.url();
    if (!classify(currentUrl)) stop(login(currentUrl) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
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
  const script = `await (${acquireIdentity.toString()})(${JSON.stringify(binding.taskSpaceName)}, 'https://www.linkedin.com/in/me/', 'https://www.linkedin.com/messaging/', ${messageLocation.toString()}, ${loginPath.toString()});`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && EGO_STEP_CODES.includes(output.status)) throw fail(output.status);
  const fp = output?.fingerprint;
  if (!exactKeys(output, ['status', 'slug', 'profileId', 'messaging', 'fingerprint']) || output.status !== 'IDENTITY_ACQUIRED' ||
      !validString(output.slug, 128) || !/^ACoAAA[A-Za-z0-9]{10,}$/.test(String(output.profileId)) ||
      !['list', 'subpath'].includes(output.messaging) ||
      !fp || !exactKeys(fp, ['labels', 'hasConversationList']) || !Array.isArray(fp.labels) || !fp.labels.length ||
      fp.labels.some(label => !validString(label, 64)) || typeof fp.hasConversationList !== 'boolean') {
    throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
  }
  return output;
}

// scan 고정 작업(U9·U10): fingerprint 검사 → 필터 발견 → lazy append 목록 순회.
// 상세 개방·클릭·입력 없이 목록 관측만 한다. deadline 초과 시 부분 관측으로 정상 종료한다.
async function scanList(spaceName, messagingUrl, expectedFingerprintJson, deadlineMs, classify, login) {
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
    const currentUrl = await page.url();
    if (!classify(currentUrl)) stop(login(currentUrl) ? 'EGO_NEEDS_LOGIN' : 'EGO_ORIGIN_MISMATCH');
    // 이동 비용을 순회 예산에서 제외해 부모 125초 상한과의 산수 충돌을 피한다(리뷰 #8).
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
      return {
        total: rows.length,
        items: rows.slice(0, 100).map(li => ({
          name: (li.querySelector('h2,h3,heading,[role="heading"]')?.textContent ?? li.textContent ?? '').trim().slice(0, 120),
          preview: (li.querySelector('p,[role="paragraph"]')?.textContent ?? '').trim().slice(0, 200),
          time: (li.querySelector('[class*="time"],time')?.textContent ?? '').trim().slice(0, 40),
        })),
      };
    });
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
      const previous = views[views.length - 1];
      views.push(view.items);
      totals.push(view.total);
      if (previous && view.items.length === previous.length) {
        stableRounds += 1;
        if (stableRounds >= 2 && view.total === view.items.length) { complete = true; break; }
      } else stableRounds = 0;
      if (Date.now() + 1500 >= deadline) break;
      await page.mouse.move(200, 300);
      await page.mouse.wheel(0, 800);
      // lazy append 렌더 지연 이후에 안정성을 재측정한다(리뷰 #5).
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    const lastItems = views[views.length - 1] ?? [];
    console.log(JSON.stringify({
      status: 'SCAN_OBSERVED', filters, items: lastItems,
      itemCount: lastItems.length, complete,
      scrollRounds: Math.max(0, views.length - 1),
    }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SNAPSHOT_FAILED', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_FINGERPRINT_MISMATCH'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_SNAPSHOT_FAILED' }));
  }
}

// scan 목록 관측(부모 검증): fingerprint 일치를 강제하고 항목·필터 형식을 검증한다(U9·U10).
export async function scanEgoList(binding) {
  if (!exactKeys(binding, ['executable', 'taskSpaceName', 'fingerprint', 'deadlineMs'])) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.taskSpaceName, 512) || binding.taskSpaceName.startsWith('-')) throw fail('INVALID_ARGUMENT');
  const fp = binding.fingerprint;
  if (!fp || !exactKeys(fp, ['labels', 'hasConversationList']) || !Array.isArray(fp.labels) || !fp.labels.length ||
      fp.labels.some(label => !validString(label, 64)) || typeof fp.hasConversationList !== 'boolean') throw fail('INVALID_ARGUMENT');
  if (!Number.isSafeInteger(binding.deadlineMs) || binding.deadlineMs < 5000 || binding.deadlineMs > 115000) throw fail('INVALID_ARGUMENT');
  const script = `await (${scanList.toString()})(${JSON.stringify(binding.taskSpaceName)}, 'https://www.linkedin.com/messaging/', ${JSON.stringify(fp)}, ${JSON.stringify(binding.deadlineMs)}, ${messageLocation.toString()}, ${loginPath.toString()});`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && EGO_STEP_CODES.includes(output.status)) throw fail(output.status);
  if (!exactKeys(output, ['status', 'filters', 'items', 'itemCount', 'complete', 'scrollRounds']) || output.status !== 'SCAN_OBSERVED' ||
      !Array.isArray(output.filters) || output.filters.some(f => !f || typeof f.label !== 'string' || typeof f.checked !== 'string') ||
      !Array.isArray(output.items) || output.items.length !== output.itemCount ||
      output.items.some(item => !item || !exactKeys(item, ['name', 'preview', 'time']) ||
        typeof item.name !== 'string' || typeof item.preview !== 'string' || typeof item.time !== 'string') ||
      !Number.isSafeInteger(output.itemCount) || typeof output.complete !== 'boolean' || !Number.isSafeInteger(output.scrollRounds)) {
    throw fail('EGO_OUTCOME_UNKNOWN', 'EGO_SCHEMA_INVALID');
  }
  return output;
}
