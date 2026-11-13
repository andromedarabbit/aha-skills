import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

const MAX_OUTPUT = 2 * 1024 * 1024;
const TIMEOUT_MS = 125000;
const ORIGIN = 'https://www.linkedin.com';
const fail = (code, reason) => Object.assign(new Error(code), { code, reason });
const failures = new Set(['UI_TARGET_MISMATCH', 'UI_ORIGIN_MISMATCH', 'UI_UNSUPPORTED_RESPONSE']);
export const UI_FAILURE_REASONS = Object.freeze([
  'UI_SPAWN_FAILED', 'UI_PROCESS_FAILED', 'UI_STDIN_FAILED', 'UI_STDOUT_FAILED', 'UI_STDERR_FAILED',
  'UI_TIMEOUT', 'UI_STDOUT_LIMIT', 'UI_STDERR_LIMIT', 'UI_EXIT_FAILED',
  'UI_UTF8_INVALID', 'UI_JSON_INVALID', 'UI_SCHEMA_INVALID',
]);

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validString(value, limit) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
}

export function validateUiInput(binding) {
  const keys = ['executable', 'host', 'account', 'profileId'];
  const hasTarget = Object.hasOwn(binding ?? {}, 'targetId');
  if (hasTarget) keys.push('targetId');
  if (!exactKeys(binding, keys)) throw fail('INVALID_ARGUMENT');
  if (!validString(binding.executable, 4096) || !isAbsolute(binding.executable)) throw fail('INVALID_ARGUMENT');
  for (const key of keys.filter(key => key !== 'executable')) {
    if (!validString(binding[key], 512) || binding[key].startsWith('-')) throw fail('INVALID_ARGUMENT');
  }
  return hasTarget ? 'snapshot' : 'tabs';
}

export async function listUiTabs(binding) {
  if (validateUiInput(binding) !== 'tabs') throw fail('INVALID_ARGUMENT');
  const output = await execute(binding, `await (${observeTabs.toString()})(${messageLocation.toString()});`);
  if (exactKeys(output, ['status']) && failures.has(output.status)) throw fail(output.status);
  if (!exactKeys(output, ['status', 'tabs']) || output.status !== 'TABS_OBSERVED' || !Array.isArray(output.tabs)) throw fail('UI_OUTCOME_UNKNOWN', 'UI_SCHEMA_INVALID');
  const seen = new Set();
  for (const tab of output.tabs) {
    if (!exactKeys(tab, ['targetId', 'origin', 'location']) || !validString(tab.targetId, 512) || tab.targetId.startsWith('-') ||
        tab.origin !== ORIGIN || !['list', 'subpath'].includes(tab.location) || seen.has(tab.targetId)) throw fail('UI_OUTCOME_UNKNOWN', 'UI_SCHEMA_INVALID');
    seen.add(tab.targetId);
  }
  return output;
}

// CLI 프로필 지정은 LinkedIn 계정 확인을 대신하지 않는다.
export async function readUiSnapshot(binding) {
  if (validateUiInput(binding) !== 'snapshot') throw fail('INVALID_ARGUMENT');
  const script = `await (${observeList.toString()})(${JSON.stringify({ targetId: binding.targetId })}, ${messageLocation.toString()});`;
  const output = await execute(binding, script);
  if (exactKeys(output, ['status']) && failures.has(output.status)) throw fail(output.status);
  if (!exactKeys(output, ['status', 'targetId', 'origin', 'snapshot']) || output.status !== 'OBSERVED' ||
      output.targetId !== binding.targetId || output.origin !== ORIGIN ||
      !exactKeys(output.snapshot, ['tree', 'diff']) || typeof output.snapshot.tree !== 'string' || typeof output.snapshot.diff !== 'string') {
    throw fail('UI_OUTCOME_UNKNOWN', 'UI_SCHEMA_INVALID');
  }
  return output;
}

function execute(binding, script) {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CI: '1', NO_COLOR: '1', ASIDE_CLI_UPDATE_CHECK: '0' };
  for (const key of ['HOME', 'LANG', 'LC_ALL', 'TZ']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binding.executable, [
        'repl', '--host', binding.host, '--account', binding.account,
        '--profile', binding.profileId, '--file', '-',
      ], { env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { reject(fail('UI_OUTCOME_UNKNOWN', 'UI_SPAWN_FAILED')); return; }
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
      if (reason) { reject(fail('UI_OUTCOME_UNKNOWN', reason)); return; }
      resolve(value);
    };
    const abort = reason => {
      if (settled) return;
      // CLI 종료는 브라우저 작업의 취소 증거가 아니다. 호출 측에서 자동 재시도하지 않는다.
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
      finish(reason);
    };
    const timer = setTimeout(() => abort('UI_TIMEOUT'), TIMEOUT_MS);
    child.on('spawn', () => { spawned = true; });
    child.on('error', () => abort(spawned ? 'UI_PROCESS_FAILED' : 'UI_SPAWN_FAILED'));
    child.stdin.on('error', () => abort('UI_STDIN_FAILED'));
    child.stdout.on('error', () => abort('UI_STDOUT_FAILED'));
    child.stderr.on('error', () => abort('UI_STDERR_FAILED'));
    child.stdout.on('data', chunk => {
      if (settled) return;
      stdoutSize += chunk.length;
      if (stdoutSize > MAX_OUTPUT) { abort('UI_STDOUT_LIMIT'); return; }
      output.push(chunk);
    });
    child.stderr.on('data', chunk => {
      if (settled) return;
      stderrSize += chunk.length;
      if (stderrSize > MAX_OUTPUT) abort('UI_STDERR_LIMIT');
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal) { finish('UI_EXIT_FAILED'); return; }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output)); }
      catch { finish('UI_UTF8_INVALID'); return; }
      let value;
      try { value = JSON.parse(text); }
      catch { finish('UI_JSON_INVALID'); return; }
      finish(null, value);
    });
    child.stdin.end(script, 'utf8');
  });
}

// 독립 REPL에 함수 자체를 전달하므로 바깥 변수에 의존하지 않는다.
function messageLocation(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== 'https://www.linkedin.com' || url.username || url.password) return null;
  if (url.pathname === '/messaging' || url.pathname === '/messaging/') return 'list';
  return url.pathname.startsWith('/messaging/') ? 'subpath' : null;
}

async function observeTabs(classify) {
  try {
    const openTabs = await listBrowserTabs();
    if (!Array.isArray(openTabs)) throw new Error();
    const tabs = [];
    for (const tab of openTabs) {
      if (typeof tab?.targetId !== 'string' || typeof tab.url !== 'string') throw new Error();
      const location = classify(tab.url);
      if (!location) continue;
      tabs.push({ targetId: tab.targetId, origin: 'https://www.linkedin.com', location });
    }
    console.log(JSON.stringify({ status: 'TABS_OBSERVED', tabs }));
  } catch { console.log(JSON.stringify({ status: 'UI_UNSUPPORTED_RESPONSE' })); }
}

async function observeList(expected, classify) {
  const stop = code => { throw Object.assign(new Error(), { code }); };
  const checkUrl = value => { if (!classify(value)) stop('UI_ORIGIN_MISMATCH'); };
  try {
    const openTabs = await listBrowserTabs();
    if (!Array.isArray(openTabs)) stop('UI_UNSUPPORTED_RESPONSE');
    const matching = openTabs.filter(tab => tab?.targetId === expected.targetId);
    if (matching.length !== 1) stop('UI_TARGET_MISMATCH');
    checkUrl(matching[0].url);
    await attachBrowserTab(expected.targetId);
    checkUrl(await page.url());
    const observed = await snapshot(page, { interactive: true });
    checkUrl(await page.url());
    if (!observed || typeof observed.tree !== 'string' || typeof observed.diff !== 'string') stop('UI_UNSUPPORTED_RESPONSE');
    console.log(JSON.stringify({
      status: 'OBSERVED', targetId: expected.targetId, origin: 'https://www.linkedin.com',
      snapshot: { tree: observed.tree, diff: observed.diff },
    }));
  } catch (error) {
    const codes = ['UI_TARGET_MISMATCH', 'UI_ORIGIN_MISMATCH', 'UI_UNSUPPORTED_RESPONSE'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'UI_UNSUPPORTED_RESPONSE' }));
  }
}
