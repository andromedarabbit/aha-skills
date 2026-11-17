import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const adapter = new URL('../ego-ui.mjs', import.meta.url).href;

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'linkedin-ego-ui-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  const executable = join(dir, 'ego-browser stub');
  const worker = join(dir, 'worker.mjs');
  writeFileSync(worker, `
const nativeTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn, delay, ...args) => {
  if (delay === 125000) delay = 2000;
  return nativeTimer(fn, delay, ...args);
};
try {
  const { observeEgoPages, readEgoPageSnapshot } = await import(${JSON.stringify(adapter)});
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const binding = JSON.parse(input);
  const result = Object.hasOwn(binding, 'pageLabel') ? await readEgoPageSnapshot(binding) : await observeEgoPages(binding);
  console.log(JSON.stringify(result));
} catch (error) { console.log(JSON.stringify({ status: error.code || 'FAILED', err: String(error && error.message || error).slice(0, 160) })); }
`);
  writeFileSync(executable, `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
if (process.argv[2] === '--version') { console.log('ego-browser stub 1.0.0'); process.exit(0); }

const home = process.env.HOME;
let script = ''; for await (const chunk of process.stdin) script += chunk;
appendFileSync(home + '/calls', JSON.stringify({ args: process.argv.slice(2), env: process.env }) + '\\n');
writeFileSync(home + '/script', script);
const state = JSON.parse(readFileSync(home + '/backend.json'));
if (state.mode === 'hold' || state.mode === 'crash-parent') {
  writeFileSync(home + '/ready', '1');
  if (state.mode === 'crash-parent') process.kill(process.ppid, 'SIGKILL');
  const deadline = Date.now() + 5000;
  while (true) {
    try { readFileSync(home + '/release'); break; } catch {}
    if (Date.now() > deadline) process.exit(1);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  writeFileSync(home + '/late-completed', '1');
  if (state.mode === 'crash-parent') process.exit(0);
}
if (state.mode === 'timeout') { setInterval(() => {}, 1000); await new Promise(() => {}); }
if (state.mode === 'stderr') { process.stderr.write('private diagnostic'); process.exit(1); }
if (state.mode === 'noisy-json') { console.log('[ego-browser:notice] update available'); console.log(JSON.stringify(state.response)); process.exit(0); }
if (state.mode === 'response-stderr') { console.error('[ego-browser:notice] update available'); console.error(JSON.stringify(state.response)); process.exit(0); }
if (state.mode === 'stderr-junk') { console.error('unrecognized diagnostic line'); console.error(JSON.stringify(state.response)); process.exit(0); }
if (state.mode === 'stdout-limit' || state.mode === 'stderr-limit') {
  const stream = state.mode === 'stdout-limit' ? process.stdout : process.stderr;
  await new Promise(resolve => stream.write('x'.repeat(2097153), resolve));
  setInterval(() => {}, 1000); await new Promise(() => {});
}
if (state.mode === 'invalid-json') { console.log('private diagnostic'); process.exit(0); }
if (state.mode === 'invalid-utf8') { process.stdout.write(Buffer.from([0xff])); process.exit(0); }
if (state.mode === 'response') { console.log(JSON.stringify(state.response)); process.exit(0); }
let urlReads = 0;
const record = operation => appendFileSync(home + '/operations', operation + '\\n');
let currentUrl = null;
const pageStub = (label, baseUrl) => ({
  label,
  url: () => {
    urlReads += 1;
    const after = state.afterUrl !== undefined && urlReads > (state.urlReadsBeforeAfter ?? 2);
    record('url:' + (after ? 'after' : 'before'));
    return after ? state.afterUrl : (currentUrl ?? baseUrl ?? state.url);
  },
  goto: async target => {
    record('goto:' + new URL(target).pathname);
    currentUrl = Array.isArray(state.urlSequence) && state.urlSequence.length ? state.urlSequence.shift() : target;
  },
  waitForLoadState: async () => {},
  waitForFunction: async () => {},
  fetch: async () => { record('fetch'); return state.fetchResponse ?? { ok: false, status: 599, body: '' }; },
  focus: async () => { record('focus'); },
  keyboard: {
    press: async key => { record('key:' + key); },
    insertText: async text => { record('insertText'); },
  },
  evaluate: async fn => {
    record('evaluate');
    // 폴링 코드와 큐의 정렬을 피한다: evaluate 대상 함수 소스로 종별을 판정해 고정 응답을 serve하고,
    // readItems(목록 순회 시나리오)만 큐 기반으로 둔다.
    const src = String(fn);
    if (src.includes("code: 'CLICKED'")) {
      const click = state.click ?? null;
      if (click && click.__setUrl) currentUrl = click.__setUrl;
      return click ? (click.__ret ?? 'CLICKED') : { code: 'NO_LIST' };
    }
    // 추출 evaluate(openThread·readThread 공용)는 cloneNode·data-event-urn을 모두 포함하므로
    // 마커(renderedCount)로 먼저 판정해야 한다. 그렇지 않으면 아래 cloneNode 분기(sendThread
    // 증거 evaluate·구 thread evaluate용)가 잘못 serve한다.
    if (src.includes('getEntriesByType')) return state.resourceUrls ?? null;
    if (src.includes('JSESSIONID')) return state.csrf ?? 'ajax:fixture-csrf';
    if (src.includes('renderedCount')) {
      if (Array.isArray(state.readEventsQueue) && state.readEventsQueue.length) {
        const next = state.readEventsQueue.shift();
        if (state.persistQueue) writeFileSync(home + '/backend.json', JSON.stringify({ ...state, readEventsQueue: state.readEventsQueue }));
        return next;
      }
      return state.readEvents ?? null;
    }
    if (src.includes('cloneNode')) {
      if (Array.isArray(state.threadQueue) && state.threadQueue.length) {
        const next = state.threadQueue.shift();
        if (state.persistQueue) writeFileSync(home + '/backend.json', JSON.stringify({ ...state, threadQueue: state.threadQueue }));
        return next;
      }
      return state.thread ?? null;
    }
    if (src.includes('isOther')) return state.pre ?? { isOther: true };
    if (src.includes('data-event-urn')) {
      if (Array.isArray(state.rowCountSequence) && state.rowCountSequence.length) {
        const next = state.rowCountSequence.shift();
        if (state.persistQueue) writeFileSync(home + '/backend.json', JSON.stringify({ ...state, rowCountSequence: state.rowCountSequence }));
        return next;
      }
      return state.eventCount ?? 2;
    }
    if (src.includes('initialCheck')) return state.composerBlocks ?? { found: true, text: '', match: true };
    if (src.includes('verifyCleared')) return state.clearedBlocks ?? { found: true, text: '', match: true };
    if (src.includes('verifyReadback')) return state.readbackBlocks ?? { found: true, text: '', match: true };
    if (src.includes("li').length")) return state.listProbe ?? { rows: 2 };
    if (src.includes('ACoAAA')) return state.acoid ?? null;
    if (src.includes('hasConversationList')) return state.fingerprint ?? null;
    if (src.includes('aria-checked')) return state.filters ?? [];
    let value;
    if (Array.isArray(state.evaluateQueue) && state.evaluateQueue.length) {
      value = state.evaluateQueue.shift();
      if (state.persistQueue) writeFileSync(home + '/backend.json', JSON.stringify({ ...state, evaluateQueue: state.evaluateQueue }));
    } else value = state.evaluateResult ?? null;
    if (value && typeof value === 'object' && '__setUrl' in value) {
      currentUrl = value.__setUrl;
      return value.__ret ?? 'CLICKED';
    }
    return value;
  },
  snapshot: async () => { record('snapshot'); return state.snapshot; },
  cdp: async (method, params) => {
    record('cdp:' + method);
    if (method === 'Network.enable') {
      if (state.cdpEnableError) throw new Error('cdp unavailable');
      return {};
    }
    if (method === 'Network.getResponseBody') {
      const map = state.cdpBody ?? {};
      const got = map[params?.requestId];
      if (got === undefined) throw new Error('no body');
      return got;
    }
    return {};
  },
  events: async () => {
    record('events');
    if (state.eventsThrow) throw new Error('events unavailable');
    if (Array.isArray(state.eventsQueue) && state.eventsQueue.length) {
      const next = state.eventsQueue.shift();
      if (state.persistQueue) writeFileSync(home + '/backend.json', JSON.stringify({ ...state, eventsQueue: state.eventsQueue }));
      return next;
    }
    return state.cdpEvents ?? [];
  },
  mouse: { move: async () => { record('mouse-move'); }, wheel: async () => { record('wheel'); } },
});
const task = {
  spaceId: 'skill-space-1',
  pages: async () => { record('pages'); return state.pages.map(page => pageStub(page.label, page.url)); },
  page: label => {
    record('attach:' + label);
    const found = state.pages.find(page => page.label === label);
    return pageStub(label, found?.url ?? state.url);
  },
  tabs: async () => { record('tabs'); return []; },
  newPage: async () => { record('newPage'); return pageStub('pn'); },
  adopt: async () => { record('adopt'); return pageStub('pa'); },
  finish: async () => { record('finish'); return 'finished'; },
  handOff: async () => { record('handOff'); return 'handed off'; },
};
const context = {
  URL,
  setTimeout,
  Buffer,
  console: { log: value => process.stdout.write(value + '\\n') },
  taskSpace: async name => {
    record('taskSpace:' + name);
    if (state.spaceBehavior === 'name-in-use') throw Object.assign(new Error('name in use'), { error_code: 'EGO_TASK_SPACE_NAME_IN_USE' });
    if (state.spaceBehavior === 'space-fail') throw new Error('ego internal failure');
    return task;
  },
  takeOverTaskSpace: async id => { record('takeOver:' + id); return 'taken over'; },
  claimTaskSpace: async id => { record('claim:' + id); return 'claimed'; },
  listTaskSpaces: async () => { record('listTaskSpaces'); return []; },
};
try { await vm.runInNewContext('(async () => {' + script + '})()', context, { timeout: 30000 }); }
catch (error) { console.log(JSON.stringify({ status: 'EGO_ATTACH_FAILED', diag: String(error && error.message || error).slice(0, 120) })); }
`, { mode: 0o700 });
  const binding = { executable, taskSpaceName: 'linkedin-replies-skill', pageLabel: 'p1' };
  let backend = { url: 'https://www.linkedin.com/messaging/', pages: [{ label: 'p1', url: 'https://www.linkedin.com/messaging/' }], snapshot: '대화 목록\n  한글 "문자열"\n' };
  const save = patch => { backend = { ...backend, ...patch }; writeFileSync(join(home, 'backend.json'), JSON.stringify(backend)); };
  save({});
  const run = (patch = {}) => {
    const result = spawnSync(process.execPath, [worker], {
      env: { HOME: home, PATH: '/invalid', ASIDE_API_TOKEN: 'must-not-inherit', EGO_API_TOKEN: 'must-not-inherit', NODE_TLS_REJECT_UNAUTHORIZED: '0', DAEMON_BASE_URL: 'http://wrong-host' },
      input: JSON.stringify({ ...binding, ...patch }), encoding: 'utf8', timeout: 8000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes('private diagnostic'), false);
    return JSON.parse(result.stdout);
  };
  const records = name => existsSync(join(home, name)) ? readFileSync(join(home, name), 'utf8').trim().split('\n') : [];
  const runner = join(dir, 'reply.mjs');
  copyFileSync(new URL('../reply.mjs', import.meta.url), runner);
  copyFileSync(new URL('../ego-ui.mjs', import.meta.url), join(dir, 'ego-ui.mjs'));
  writeFileSync(join(dir, 'aside-auth.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.HOME + '/auth-called', '1'); throw new Error('AUTH_MUST_NOT_RUN');`);
  const preload = join(dir, 'timer.mjs');
  writeFileSync(preload, `
import { writeFileSync } from 'node:fs';
const nativeTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn, delay, ...args) => {
  if (delay !== 125000) return nativeTimer(fn, delay, ...args);
  return nativeTimer(() => { writeFileSync(process.env.HOME + '/timer-fired', '1'); fn(...args); }, 2000);
};
`);
  const replyEnv = { HOME: home, PATH: '/invalid', NODE_OPTIONS: '--no-warnings', ASIDE_API_TOKEN: 'must-not-inherit', EGO_API_TOKEN: 'must-not-inherit' };
  const startReply = (input = binding) => {
    const child = spawn(process.execPath, ['--import', preload, runner, '--mode', 'manual', 'inspect'], { env: replyEnv });
    const done = new Promise((resolve, reject) => {
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
    });
    child.stdin.end(JSON.stringify(input));
    return { child, done };
  };
  const waitFor = async name => {
    const deadline = Date.now() + 5000;
    while (!existsSync(join(home, name))) {
      assert.ok(Date.now() < deadline, `stub did not write ${name}`);
      await delay(10);
    }
  };
  const runReply = (input = binding, mode = 'manual', command = 'inspect') => {
    const result = spawnSync(process.execPath, ['--import', preload, runner, '--mode', mode, command], {
      env: replyEnv, input: JSON.stringify(input), encoding: 'utf8', timeout: 8000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null };
  };
  const scanWorker = join(dir, 'scan-worker.mjs');
  writeFileSync(scanWorker, `
const nativeTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn, delay, ...args) => {
  if (delay === 125000) delay = 2000;
  return nativeTimer(fn, delay, ...args);
};
try {
  const { scanEgo } = await import(${JSON.stringify(join(dir, 'reply.mjs'))});
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  console.log(JSON.stringify(await scanEgo(JSON.parse(input))));
} catch (error) { console.log(JSON.stringify({ status: error.code || 'FAILED', err: String(error && error.message || error).slice(0, 200) })); }
`);
  const runScan = (input = {}) => {
    const result = spawnSync(process.execPath, [scanWorker], {
      env: { HOME: home, PATH: '/invalid', NODE_OPTIONS: '--no-warnings', ASIDE_API_TOKEN: 'must-not-inherit', EGO_API_TOKEN: 'must-not-inherit' },
      input: JSON.stringify({ transport: 'ego-ui/1', executable, taskSpaceName: 'linkedin-replies-skill', ...input }), encoding: 'utf8', timeout: 20000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null };
  };
  const readWorker = join(dir, 'read-worker.mjs');
  writeFileSync(readWorker, `
try {
  const { readEgo } = await import(${JSON.stringify(join(dir, 'reply.mjs'))});
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  console.log(JSON.stringify(await readEgo(JSON.parse(input))));
} catch (error) { console.log(JSON.stringify({ status: error.code || 'FAILED', err: String(error && error.message || error).slice(0, 200) })); }
`);
  const runRead = (input = {}) => {
    const result = spawnSync(process.execPath, [readWorker], {
      env: { HOME: home, PATH: '/invalid', NODE_OPTIONS: '--no-warnings', ASIDE_API_TOKEN: 'must-not-inherit', EGO_API_TOKEN: 'must-not-inherit' },
      input: JSON.stringify({ transport: 'ego-ui/1', executable, taskSpaceName: 'linkedin-replies-skill', conversationUuid: '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c', ...input }), encoding: 'utf8', timeout: 20000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null };
  };
  return { binding, home, run, runReply, startReply, waitFor, save, records, snapshot: backend.snapshot, runScan, runRead };
}

const egoLockPath = f => join(f.home, '.local/share/aha-skills/linkedin-replies/locks', `ego-profile-${createHash('sha256').update(JSON.stringify([f.binding.executable, f.binding.taskSpaceName])).digest('hex')}`);

test('고정 nodejs 작업은 ego 자원 경계만 데이터로 전달한다', t => {
  const f = fixture(t);
  assert.deepEqual(f.run(), { status: 'OBSERVED', pageLabel: 'p1', origin: 'https://www.linkedin.com', snapshot: f.snapshot });
  const [call] = f.records('calls').map(JSON.parse);
  assert.deepEqual(call.args, ['nodejs']);
  for (const key of ['ASIDE_API_TOKEN', 'EGO_API_TOKEN', 'DAEMON_BASE_URL', 'NODE_TLS_REJECT_UNAUTHORIZED']) assert.equal(call.env[key], undefined);
  assert.equal(call.env.CI, '1');
  assert.equal(call.env.NO_COLOR, '1');
  assert.deepEqual(f.records('operations'), ['taskSpace:linkedin-replies-skill', 'pages', 'url:before', 'attach:p1', 'url:before', 'snapshot', 'url:before']);
  const script = readFileSync(join(f.home, 'script'), 'utf8');
  assert.doesNotMatch(script, /\blinkedin\.[A-Za-z]+\(|fetch\(|newPage\(|adopt\(|\.click\(|\.fill\(|\.press\(|evaluate\(|goto\(|finish\(|handOff\(|fs\./);
});

test('Page 발견 작업은 라벨·origin·경로 구분만 관측한다', t => {
  const f = fixture(t);
  assert.deepEqual(f.run({ pageLabel: undefined }), { status: 'PAGES_OBSERVED', pages: [{ label: 'p1', origin: 'https://www.linkedin.com', location: 'list' }] });
  assert.deepEqual(f.records('operations'), ['taskSpace:linkedin-replies-skill', 'pages', 'url:before']);
  const script = readFileSync(join(f.home, 'script'), 'utf8');
  assert.doesNotMatch(script, /\blinkedin\.[A-Za-z]+\(|fetch\(|newPage\(|adopt\(|\.click\(|\.fill\(|\.press\(|evaluate\(|goto\(|finish\(|handOff\(|fs\./);
});

test('코드처럼 생긴 스페이스·Page 라벨도 stdin의 데이터로만 사용한다', t => {
  const f = fixture(t);
  const space = '"); console.log("injected"); //';
  assert.equal(f.run({ taskSpaceName: space }).status, 'OBSERVED');
  assert.equal(f.records('calls').length, 1);
  assert.equal(f.records('calls')[0].includes('injected'), false);
  const label = '"); process.exit(9); //';
  f.save({ pages: [{ label, url: 'https://www.linkedin.com/messaging/' }] });
  assert.equal(f.run({ pageLabel: label }).status, 'OBSERVED');
  assert.equal(f.records('calls').length, 2);
});

for (const patch of [
  { executable: 'ego-browser' }, { executable: '/bin/ego\0' }, { taskSpaceName: '' }, { taskSpaceName: '-skill' },
  { pageLabel: '' }, { pageLabel: '-p1' }, { host: 'local-host' }, { targetId: 'owned-tab' },
  { code: 'fetch("https://example.com")' }, { text: '회신 본문' }, { command: 'send' },
]) test(`유효하지 않은 실행 입력은 자식 시작 전에 거부한다: ${Object.keys(patch)[0]}`, t => {
  const f = fixture(t);
  assert.equal(f.run(patch).status, 'INVALID_ARGUMENT');
  assert.deepEqual(f.records('calls'), []);
});

test('무인 inspect와 유효하지 않은 입력은 UI·인증·상태 쓰기 전에 차단한다', t => {
  const f = fixture(t);
  assert.equal(f.runReply(f.binding, 'unattended').data.status, 'BLOCKED_UNATTENDED');
  assert.equal(f.runReply({ ...f.binding, text: '전송하지 않을 본문' }).data.status, 'INVALID_ARGUMENT');
  assert.equal(existsSync(join(f.home, '.local')), false);
  assert.deepEqual(f.records('calls'), []);
});

test('정상 inspect는 binding·승인 없이 스페이스 Page 관측만 반환한다', t => {
  const f = fixture(t);
  const { pageLabel, ...input } = f.binding;
  const result = f.runReply(input);
  assert.equal(result.status, 0);
  assert.deepEqual(result.data, {
    status: 'PAGES_OBSERVED', pages: [{ label: 'p1', origin: 'https://www.linkedin.com', location: 'list' }],
    transport: 'ego-ui/1', accountVerified: false, bindingSaved: false,
  });
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
  const state = join(f.home, '.local/share/aha-skills/linkedin-replies');
  for (const name of ['jobs', 'locks', 'conversations']) assert.deepEqual(readdirSync(join(state, name)), []);
  assert.equal(existsSync(join(state, 'binding.json')), false);
});

test('Page 0개는 관측 결과일 뿐 미응답 0건이나 연결 완료가 아니다', t => {
  const f = fixture(t); f.save({ pages: [] });
  const { pageLabel, ...input } = f.binding;
  assert.deepEqual(f.runReply(input).data, {
    status: 'PAGES_OBSERVED', pages: [], transport: 'ego-ui/1', accountVerified: false, bindingSaved: false,
  });
  assert.deepEqual(f.records('operations'), ['taskSpace:linkedin-replies-skill', 'pages']);
});

test('Page 발견은 메시지 경계의 라벨·origin·경로 구분만 제시한다', t => {
  const f = fixture(t);
  f.save({ pages: [
    { label: 'p1', url: 'https://www.linkedin.com/messaging/', title: '사적 제목' },
    { label: 'p2', url: 'https://example.com/private' },
    { label: 'p3', url: 'https://www.linkedin.com/messaging/thread/private-thread/' },
    { label: 'p4', url: 'https://www.linkedin.com/login' },
  ] });
  const { pageLabel, ...input } = f.binding;
  const result = f.runReply(input);
  assert.equal(result.status, 0);
  assert.deepEqual(result.data.pages, [
    { label: 'p1', origin: 'https://www.linkedin.com', location: 'list' },
    { label: 'p3', origin: 'https://www.linkedin.com', location: 'subpath' },
  ]);
  assert.doesNotMatch(result.stdout, /사적 제목|example.com|private-thread|login/);
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
});

test('관측 라운드에서 finish·handOff·claim·listTaskSpaces를 호출하지 않는다', t => {
  const f = fixture(t);
  f.run();
  const { pageLabel, ...input } = f.binding;
  f.runReply(input);
  const operations = f.records('operations').join('\n');
  assert.equal(operations.includes('finish'), false);
  assert.equal(operations.includes('handOff'), false);
  assert.equal(operations.includes('claim'), false);
  assert.equal(operations.includes('listTaskSpaces'), false);
  assert.equal(operations.includes('takeOver'), false);
  assert.equal(operations.includes('newPage'), false);
  assert.equal(operations.includes('adopt'), false);
});

for (const [name, patch, expected] of [
  ['스페이스 실패', { spaceBehavior: 'space-fail' }, 'EGO_SPACE_FAILED'],
  ['사용자 소유 스페이스', { spaceBehavior: 'name-in-use' }, 'EGO_SPACE_NAME_IN_USE'],
  ['Page 목록 실패', { pages: 'not-an-array' }, 'EGO_TABS_FAILED'],
  ['Page 미발견', { pages: [{ label: 'p2', url: 'https://www.linkedin.com/messaging/' }] }, 'EGO_TAB_NOT_FOUND'],
  ['중복 라벨', { pages: [{ label: 'p1', url: 'https://www.linkedin.com/messaging/' }, { label: 'p1', url: 'https://www.linkedin.com/messaging/' }] }, 'EGO_TAB_NOT_FOUND'],
  ['외부 origin', { pages: [{ label: 'p1', url: 'https://www.linkedin.com.evil.test/messaging/' }] }, 'EGO_ORIGIN_MISMATCH'],
  ['메시지 유사 경로', { pages: [{ label: 'p1', url: 'https://www.linkedin.com/messaging-evil/' }] }, 'EGO_ORIGIN_MISMATCH'],
  ['로그인 화면', { pages: [{ label: 'p1', url: 'https://www.linkedin.com/login' }] }, 'EGO_NEEDS_LOGIN'],
  ['authwall', { pages: [{ label: 'p1', url: 'https://www.linkedin.com/authwall' }] }, 'EGO_NEEDS_LOGIN'],
  ['checkpoint', { pages: [{ label: 'p1', url: 'https://www.linkedin.com/checkpoint/challenge' }] }, 'EGO_NEEDS_LOGIN'],
  ['snapshot 중 이동', { afterUrl: 'https://example.com/' }, 'EGO_ORIGIN_MISMATCH'],
  ['snapshot 실패', { snapshot: null }, 'EGO_SNAPSHOT_FAILED'],
  ['빈 snapshot', { snapshot: '' }, 'EGO_SNAPSHOT_FAILED'],
  ['snapshot 형식 불명', { snapshot: { text: 'unknown shape' } }, 'EGO_SCHEMA_INVALID'],
]) test(`${name}에서는 추측·대체 Page 없이 단계별 사유로 종료한다`, t => {
  const f = fixture(t); f.save(patch);
  assert.equal(f.run().status, expected);
  assert.equal(f.records('calls').length, 1);
});

test('서로 다른 실패 단계는 서로 다른 사유 코드로 구분된다(오류 합침 회귀)', t => {
  const f = fixture(t);
  const observed = new Set();
  for (const patch of [
    { spaceBehavior: 'space-fail' }, { spaceBehavior: 'name-in-use' }, { pages: 'not-an-array' },
    { pages: [{ label: 'p2', url: 'https://www.linkedin.com/messaging/' }] },
    { pages: [{ label: 'p1', url: 'https://www.linkedin.com.evil.test/messaging/' }] },
    { pages: [{ label: 'p1', url: 'https://www.linkedin.com/login' }] },
    { snapshot: null }, { snapshot: '' }, { snapshot: { text: '모르는 구조' } },
  ]) {
    f.save({ spaceBehavior: null, ...patch });
    observed.add(f.run().status);
  }
  f.save({});
  assert.ok(observed.size >= 6, `서로 다른 진단이 ${observed.size}개뿐이다: ${[...observed].join(', ')}`);
});

test('인증 폼 구조가 관측되면 URL이 메시지 경계여도 로그인 필요로 구분한다', t => {
  const f = fixture(t);
  f.save({ snapshot: 'Messaging\n  textbox "Email or phone"\n  textbox "Password" placeholder\n  button "Sign in"\n' });
  assert.equal(f.run().status, 'EGO_NEEDS_LOGIN');
  const g = fixture(t);
  g.save({ snapshot: 'Conversation List\n  text: textbox "Password" placeholder 문구가 본문에 등장\n' });
  assert.equal(g.run().status, 'OBSERVED');
});

test('URL 허용 경계는 발견·snapshot에 동일하게 적용한다', t => {
  const f = fixture(t);
  for (const [url, location] of [
    ['https://www.linkedin.com/messaging', 'list'],
    ['https://www.linkedin.com/messaging/', 'list'],
    ['https://www.linkedin.com/messaging/?filter=private-query#private-fragment', 'list'],
    ['https://www.linkedin.com/messaging/thread/private-thread/', 'subpath'],
    ['https://www.linkedin.com/messaging/thread/private-thread/?filter=private-query#private-fragment', 'subpath'],
  ]) {
    f.save({ pages: [{ label: 'p1', url }], url });
    const { pageLabel, ...input } = f.binding;
    const result = f.runReply(input);
    assert.deepEqual(result.data.pages, [{ label: 'p1', origin: 'https://www.linkedin.com', location }]);
    assert.doesNotMatch(result.stdout, /private-|filter=|fragment/);
    assert.equal(f.run().status, 'OBSERVED');
  }
  assert.equal(f.records('calls').length, 10);
});

test('메시지 경계 밖 URL은 발견에서 제외되고 snapshot에서 사유를 구분한다', t => {
  const f = fixture(t);
  for (const [url, expected] of [
    ['http://www.linkedin.com/messaging/', 'EGO_ORIGIN_MISMATCH'],
    ['https://linkedin.com/messaging/', 'EGO_ORIGIN_MISMATCH'],
    ['https://www.linkedin.com:8443/messaging/', 'EGO_ORIGIN_MISMATCH'],
    ['https://www.linkedin.com.evil.test/messaging/', 'EGO_ORIGIN_MISMATCH'],
    ['https://private-user:private-pass@www.linkedin.com/messaging/', 'EGO_ORIGIN_MISMATCH'],
    ['https://www.linkedin.com/messaging-evil/', 'EGO_ORIGIN_MISMATCH'],
    ['https://www.linkedin.com/login?next=/messaging/', 'EGO_NEEDS_LOGIN'],
    ['https://www.linkedin.com/messaging/%2e%2e/login', 'EGO_NEEDS_LOGIN'],
    ['not a URL', 'EGO_ORIGIN_MISMATCH'],
  ]) {
    f.save({ pages: [{ label: 'p1', url }], url });
    const { pageLabel, ...input } = f.binding;
    assert.deepEqual(f.runReply(input).data.pages, []);
    assert.equal(f.run().status, expected);
  }
  assert.equal(f.records('calls').length, 18);
});

for (const response of [
  { status: 'PAGES_OBSERVED', pages: [{ label: 'x', origin: 'https://example.com', location: 'list' }] },
  { status: 'PAGES_OBSERVED', pages: [{ label: 'x', origin: 'https://www.linkedin.com', location: 'list', title: 'private' }] },
  { status: 'PAGES_OBSERVED', pages: [{ label: 'x', origin: 'https://www.linkedin.com', location: 'list' }, { label: 'x', origin: 'https://www.linkedin.com', location: 'list' }] },
  { status: 'PAGES_OBSERVED', pages: [{ label: 'x', origin: 'https://www.linkedin.com', location: 'login' }] },
  { status: 'PAGES_OBSERVED', pages: [{ label: '-x', origin: 'https://www.linkedin.com', location: 'list' }] },
  { status: 'OBSERVED', pageLabel: 'wrong', origin: 'https://www.linkedin.com', snapshot: '내용' },
  { status: 'OBSERVED', pageLabel: 'p1', origin: 'https://example.com', snapshot: '내용' },
  { status: 'OBSERVED', pageLabel: 'p1', origin: 'https://www.linkedin.com', snapshot: 42 },
  { status: 'OBSERVED', pageLabel: 'p1', origin: 'https://www.linkedin.com', snapshot: '내용', extra: 1 },
  { status: 'SENT' },
  { status: 'NEEDS_AUTH', raw: 'private diagnostic' },
]) test('스키마가 다른 출력은 계정 연결이나 조회 성공으로 취급하지 않는다', t => {
  const f = fixture(t); f.save({ mode: 'response', response });
  const result = f.runReply();
  assert.equal(result.data.status, 'EGO_OUTCOME_UNKNOWN');
  assert.equal(result.data.reason, 'EGO_SCHEMA_INVALID');
  assert.equal(result.stdout.includes('private diagnostic'), false);
  assert.equal(f.records('calls').length, 1);
});

test('스크립트의 단계 코드는 허용 목록으로만 전파한다', t => {
  const f = fixture(t); f.save({ mode: 'response', response: { status: 'EGO_TABS_FAILED' } });
  const result = f.runReply();
  assert.deepEqual(result.data, { status: 'EGO_TABS_FAILED', reason: 'UI_OPERATION_FAILED', profileLockRetained: true });
  assert.equal(f.records('calls').length, 1);
  const g = fixture(t); g.save({ mode: 'response', response: { status: 'NOT_A_PLANNED_CODE' } });
  assert.deepEqual(g.runReply().data, { status: 'EGO_OUTCOME_UNKNOWN', reason: 'EGO_SCHEMA_INVALID', profileLockRetained: true });
});

for (const [patch, reason] of [
  [{ executable: '/not-present/ego-browser' }, 'EGO_SPAWN_FAILED'],
  [{ mode: 'invalid-utf8' }, 'EGO_UTF8_INVALID'],
  [{ mode: 'invalid-json' }, 'EGO_JSON_INVALID'],
  [{ mode: 'noisy-json' }, 'EGO_JSON_INVALID'],
  [{ mode: 'stderr' }, 'EGO_CONNECT_FAILED'],
  [{ mode: 'timeout' }, 'EGO_TIMEOUT'],
  [{ mode: 'stdout-limit' }, 'EGO_STDOUT_LIMIT'],
  [{ mode: 'stderr-limit' }, 'EGO_STDERR_LIMIT'],
]) test(`정상 runner는 원문 대신 실패 단계 ${reason}만 반환하고 락을 보존한다`, t => {
  const f = fixture(t);
  const { executable, ...backend } = patch; f.save(backend);
  const input = executable ? { ...f.binding, executable } : f.binding;
  const result = f.runReply(input);
  assert.deepEqual(result.data, { status: 'EGO_OUTCOME_UNKNOWN', reason, profileLockRetained: true });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /private diagnostic|not-present|notice/);
  assert.equal(existsSync(egoLockPath({ home: f.home, binding: input })), true);
  assert.equal(f.runReply(input).data.status, 'LOCKED');
  assert.equal(f.records('calls').length, executable ? 0 : 1);
});

const SNAPSHOT_OK = { status: 'OBSERVED', pageLabel: 'p1', origin: 'https://www.linkedin.com', snapshot: '대화 목록' };

// 2026-11-14 실측(0.6.3.14): 파이프 스크립트의 console.log·process.stdout.write는 stderr로 우회되고 stdout은 비어 있다.
test('페이로드가 stderr로 우회돼도 notice 외 정확히 한 줄 JSON이면 성공한다', t => {
  const f = fixture(t); f.save({ mode: 'response-stderr', response: SNAPSHOT_OK });
  const result = f.runReply();
  assert.equal(result.data.status, 'OBSERVED');
  assert.equal(result.data.snapshot, '대화 목록');
});

test('stderr의 비 JSON·비 notice 줄은 EGO_JSON_INVALID로 안전 실패한다', t => {
  const f = fixture(t); f.save({ mode: 'stderr-junk', response: SNAPSHOT_OK });
  assert.deepEqual(f.runReply().data, { status: 'EGO_OUTCOME_UNKNOWN', reason: 'EGO_JSON_INVALID', profileLockRetained: true });
});

// ego CLI는 파이프 스크립트를 sloppy CJS eval로 돌린다 — `await (`로 시작하는 스크립트는 식별자 호출로
// 파싱돼 ReferenceError로 자식이 비정상 종료한다(2026-11-14 첫 실측). 모든 고정 스크립트는 IIFE + .catch 형태여야 한다.
test('생성한 고정 스크립트는 top-level await 없이 IIFE + .catch 형태다', t => {
  const f = fixture(t);
  f.runReply();
  const script = readFileSync(join(f.home, 'script'), 'utf8');
  assert.equal(script.startsWith('('), true);
  assert.equal(script.startsWith('await ('), false);
  assert.match(script, /\.catch\(/);
});

test('Aside 락이 남아 있어도 ego 락은 독립 네임스페이스로 획득한다', t => {
  const f = fixture(t);
  const locks = join(f.home, '.local/share/aha-skills/linkedin-replies/locks');
  mkdirSync(join(locks, 'ui-profile-arbitrary'), { recursive: true, mode: 0o700 });
  const asideHash = createHash('sha256').update(JSON.stringify(['local-host', 'personal', 'actual-profile-id'])).digest('hex');
  mkdirSync(join(locks, `ui-profile-${asideHash}`), { recursive: true, mode: 0o700 });
  const { pageLabel, ...input } = f.binding;
  assert.equal(f.runReply(input).data.status, 'PAGES_OBSERVED');
  assert.deepEqual(readdirSync(locks).filter(name => name.startsWith('ui-profile-')), [`ui-profile-${asideHash}`, 'ui-profile-arbitrary']);
  f.save({ mode: 'stderr' });
  assert.equal(f.runReply().data.status, 'EGO_OUTCOME_UNKNOWN');
  assert.equal(readdirSync(locks).filter(name => name.startsWith('ui-profile-')).length, 2);
  assert.equal(existsSync(egoLockPath(f)), true);
});

test('기존 빈 ego 락은 소유 불명으로 보존하며 자식을 시작하지 않는다', t => {
  const f = fixture(t);
  mkdirSync(egoLockPath(f), { recursive: true, mode: 0o700 });
  assert.equal(f.runReply().data.status, 'LOCKED');
  assert.deepEqual(readdirSync(egoLockPath(f)), []);
  assert.deepEqual(f.records('calls'), []);
});

test('이미 남은 구형 binding·unknown·sending·락은 ego inspect로 변경하지 않는다', t => {
  const f = fixture(t);
  const root = join(f.home, '.local/share/aha-skills/linkedin-replies');
  mkdirSync(join(root, 'jobs'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'locks', 'old-lock'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'conversations'), { mode: 0o700 });
  const files = ['binding.json', 'jobs/old.json', 'conversations/old.json'];
  const contents = ['{"profile":"Default","account":{"id":"legacy"}}', '{"state":"sending"}', '{"state":"unknown"}'];
  files.forEach((name, index) => writeFileSync(join(root, name), contents[index], { mode: 0o600 }));
  const { pageLabel, ...input } = f.binding;
  assert.equal(f.runReply(input).data.status, 'PAGES_OBSERVED');
  files.forEach((name, index) => assert.equal(readFileSync(join(root, name), 'utf8'), contents[index]));
  assert.deepEqual(readdirSync(join(root, 'locks')), ['old-lock']);
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
});

test('aside scan·setup은 미활성이고 ego scan은 활성 경로로 넘어간다', t => {
  const f = fixture(t);
  for (const command of ['scan', 'setup']) {
    const result = f.runReply({ transport: 'aside-ui/1' }, 'manual', command);
    assert.deepEqual(result.data, { status: 'UI_NOT_ACTIVATED' });
    assert.equal(existsSync(join(f.home, '.local')), false);
    assert.equal(existsSync(join(f.home, 'auth-called')), false);
  }
  assert.equal(f.runReply({ transport: 'ego-ui/1' }, 'manual', 'scan').data.status, 'INVALID_ARGUMENT');
  assert.deepEqual(f.records('calls'), []);
  assert.equal(f.runReply({ scope: 'Focused', period: 'two-weeks' }, 'manual', 'setup').data.status, 'INVALID_ARGUMENT');
});

test('ego setup은 잘못된 입력을 상태 쓰기 전에 거부한다', t => {
  const f = fixture(t);
  assert.equal(f.runReply({ transport: 'ego-ui/1' }, 'manual', 'setup').data.status, 'INVALID_ARGUMENT');
  assert.equal(f.runReply({ transport: 'ego-ui/1', executable: f.binding.executable, taskSpaceName: '-bad' }, 'manual', 'setup').data.status, 'INVALID_ARGUMENT');
  assert.equal(f.runReply({ transport: 'ego-ui/1', executable: f.binding.executable, taskSpaceName: 's', extra: 1 }, 'manual', 'setup').data.status, 'INVALID_ARGUMENT');
  assert.equal(existsSync(join(f.home, '.local')), false);
  assert.deepEqual(f.records('calls'), []);
});

const setupFixture = (t, patch = {}) => {
  const f = fixture(t);
  f.save({
    urlSequence: ['https://www.linkedin.com/in/test-slug/', 'https://www.linkedin.com/messaging/thread/test-thread/'],
    acoid: 'ACoAAA0123456789abcdefghijklmnopqrst',
    fingerprint: { labels: ['Focused', 'Unread'], hasConversationList: true },
    snapshot: 'radiogroup\n  text "Focused"\n  text "Unread"\n  unordered_list "Conversation List" [ref=26]\n',
    ...patch,
  });
  return f;
};

const setupInput = f => ({ transport: 'ego-ui/1', executable: f.binding.executable, taskSpaceName: 'linkedin-replies-skill' });

test('ego setup 첫 단계는 계정·구조를 확보해 확인만 요청하고 저장하지 않는다', t => {
  const f = setupFixture(t);
  const result = f.runReply(setupInput(f), 'manual', 'setup');
  assert.equal(result.status, 0);
  assert.equal(result.data.status, 'CONFIRM_ACCOUNT');
  assert.deepEqual(result.data.account, { slug: 'test-slug', profileId: 'ACoAAA0123456789abcdefghijklmnopqrst' });
  assert.deepEqual(result.data.fingerprint, { labels: ['Focused', 'Unread'], hasConversationList: true });
  assert.ok(result.data.sideEffect.includes('자동 개방'), '부수 개방 설명이 승인 응답에 있어야 한다');
  assert.equal(existsSync(join(f.home, '.local/share/aha-skills/linkedin-replies/binding.json')), false);
  assert.deepEqual(f.records('operations').filter(op => op.startsWith('goto:')), ['goto:/in/me/', 'goto:/messaging/']);
  assert.equal(f.records('operations').includes('evaluate'), true);
  assert.deepEqual(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')), []);
});

test('ego setup 확인 단계는 재관측 일치 시에만 binding을 저장한다', t => {
  const f = setupFixture(t);
  const confirm = { ...setupInput(f), accountId: 'test-slug', profileId: 'ACoAAA0123456789abcdefghijklmnopqrst' };
  const result = f.runReply(confirm, 'manual', 'setup');
  assert.equal(result.status, 0);
  assert.deepEqual(result.data, { status: 'OK', transport: 'ego-ui/1', account: { slug: 'test-slug', profileId: 'ACoAAA0123456789abcdefghijklmnopqrst' } });
  const binding = JSON.parse(readFileSync(join(f.home, '.local/share/aha-skills/linkedin-replies/binding.json'), 'utf8'));
  assert.deepEqual(binding.account, { slug: 'test-slug', profileId: 'ACoAAA0123456789abcdefghijklmnopqrst' });
  assert.equal(binding.transport, 'ego-ui/1');
  assert.equal(binding.taskSpaceName, 'linkedin-replies-skill');
  assert.equal(binding.egoVersion, 'ego-browser stub 1.0.0');
  assert.deepEqual(binding.fingerprint, { labels: ['Focused', 'Unread'], hasConversationList: true });
  assert.deepEqual(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')), []);
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
});

test('ego setup 확인 단계의 계정 불일치는 저장 없이 중단한다', t => {
  const f = setupFixture(t);
  const confirm = { ...setupInput(f), accountId: 'other-slug', profileId: 'ACoAAA0123456789abcdefghijklmnopqrst' };
  assert.equal(f.runReply(confirm, 'manual', 'setup').data.status, 'ACCOUNT_MISMATCH');
  assert.equal(existsSync(join(f.home, '.local/share/aha-skills/linkedin-replies/binding.json')), false);
});

test('ACoAAA 미관측은 EGO_SCHEMA_INVALID로 락을 남기고 재호출을 막는다', t => {
  const f = setupFixture(t, { acoid: null });
  const result = f.runReply(setupInput(f), 'manual', 'setup');
  assert.deepEqual(result.data, { status: 'EGO_SCHEMA_INVALID', reason: 'UI_OPERATION_FAILED', profileLockRetained: true });
  assert.equal(existsSync(join(f.home, '.local/share/aha-skills/linkedin-replies/binding.json')), false);
  assert.equal(f.runReply(setupInput(f), 'manual', 'setup').data.status, 'LOCKED');
  assert.equal(f.records('calls').length, 1);
});

test('/messaging/ 접속이 로그인 화면이면 EGO_NEEDS_LOGIN으로 중단한다', t => {
  const f = setupFixture(t, { urlSequence: ['https://www.linkedin.com/in/test-slug/', 'https://www.linkedin.com/login'] });
  const result = f.runReply(setupInput(f), 'manual', 'setup');
  assert.equal(result.data.status, 'EGO_NEEDS_LOGIN');
  assert.equal(result.data.profileLockRetained, true);
  assert.equal(existsSync(join(f.home, '.local/share/aha-skills/linkedin-replies/binding.json')), false);
});

test('구조 fingerprint의 라벨이 비면 저장 없이 실패한다', t => {
  const f = setupFixture(t, { fingerprint: { labels: [], hasConversationList: false } });
  const result = f.runReply(setupInput(f), 'manual', 'setup');
  assert.equal(result.data.status, 'EGO_SCHEMA_INVALID');
});

test('setup confirm 단계의 profileId 불일치는 저장 없이 ACCOUNT_MISMATCH로 중단한다', t => {
  const f = setupFixture(t);
  const confirm = { ...setupInput(f), accountId: 'test-slug', profileId: 'ACoAAAanotherperson00000' };
  assert.equal(f.runReply(confirm, 'manual', 'setup').data.status, 'ACCOUNT_MISMATCH');
  assert.equal(existsSync(join(f.home, '.local/share/aha-skills/linkedin-replies/binding.json')), false);
});

test('setup /in/me가 로그인 화면이면 EGO_NEEDS_LOGIN, 이종 origin이면 EGO_ORIGIN_MISMATCH로 구분한다', t => {
  const f = setupFixture(t, { urlSequence: ['https://www.linkedin.com/login', 'https://www.linkedin.com/messaging/'] });
  assert.equal(f.runReply(setupInput(f), 'manual', 'setup').data.status, 'EGO_NEEDS_LOGIN');
  const g = setupFixture(t, { urlSequence: ['https://attacker.example/in/victim/', 'https://www.linkedin.com/messaging/'] });
  assert.equal(g.runReply(setupInput(g), 'manual', 'setup').data.status, 'EGO_ORIGIN_MISMATCH');
});

test('빈 TaskSpace의 첫 setup은 newPage로 진행된다', t => {
  const f = setupFixture(t, { pages: [] });
  const result = f.runReply(setupInput(f), 'manual', 'setup');
  assert.equal(result.data.status, 'CONFIRM_ACCOUNT');
  assert.equal(f.records('operations').includes('newPage'), true);
});

test('동시 inspect는 하나만 자식에 진입하고 최소 작업 메타데이터를 남긴다', async t => {
  const f = fixture(t); f.save({ mode: 'hold' });
  const first = f.startReply();
  try {
    await f.waitFor('ready');
    const root = join(f.home, '.local/share/aha-skills/linkedin-replies/locks');
    const [name] = readdirSync(root).filter(entry => entry.startsWith('ego-profile-'));
    const metadata = JSON.parse(readFileSync(join(root, name, 'operation.json'), 'utf8'));
    assert.deepEqual(Object.keys(metadata).sort(), ['attemptId', 'operation', 'ownerPid', 'startedAt']);
    assert.equal(metadata.operation, 'snapshot');
    assert.equal(metadata.ownerPid, first.child.pid);
    assert.match(metadata.attemptId, /^[a-f0-9-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(metadata.startedAt)));
    assert.equal(f.runReply().data.status, 'LOCKED');
    assert.equal(f.records('calls').length, 1);
  } finally { writeFileSync(join(f.home, 'release'), '1'); }
  const completed = await first.done;
  assert.equal(JSON.parse(completed.stdout).status, 'OBSERVED');
  assert.equal(completed.stderr, '');
  assert.deepEqual(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')), []);
});

test('관측 부모 강제 종료 후 자식이 늦게 끝나도 다음 inspect는 락을 탈취하지 않는다', async t => {
  const f = fixture(t); f.save({ mode: 'crash-parent' });
  const first = f.startReply();
  try {
    const crashed = await first.done;
    assert.equal(crashed.signal, 'SIGKILL');
    assert.equal(f.runReply().data.status, 'LOCKED');
  } finally { writeFileSync(join(f.home, 'release'), '1'); }
  await f.waitFor('late-completed');
  assert.equal(f.runReply().data.status, 'LOCKED');
  assert.equal(f.records('calls').length, 1);
});

test('오류 코드 목록은 계획(KTD15)의 단계·실행 상한 코드를 전부 담는다', async t => {
  const { EGO_STEP_CODES, EGO_FAILURE_REASONS } = await import('../ego-ui.mjs');
  for (const code of ['EGO_SPACE_FAILED', 'EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_TAB_NOT_FOUND', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_ATTACH_FAILED', 'EGO_SNAPSHOT_FAILED', 'EGO_SCHEMA_INVALID', 'EGO_EVAL_STOPPED', 'EGO_FINGERPRINT_MISMATCH']) {
    assert.ok(EGO_STEP_CODES.includes(code), `단계 코드 누락: ${code}`);
  }
  for (const reason of ['EGO_SPAWN_FAILED', 'EGO_TIMEOUT', 'EGO_STDOUT_LIMIT', 'EGO_UTF8_INVALID', 'EGO_JSON_INVALID', 'EGO_SCHEMA_INVALID', 'EGO_EXIT_FAILED', 'EGO_CONNECT_FAILED']) {
    assert.ok(EGO_FAILURE_REASONS.includes(reason), `실행 사유 누락: ${reason}`);
  }
  assert.equal(Object.isFrozen(EGO_STEP_CODES), true);
  assert.equal(Object.isFrozen(EGO_FAILURE_REASONS), true);
});

const scanSetup = (t) => {
  const f = setupFixture(t);
  const confirm = { ...setupInput(f), accountId: 'test-slug', profileId: 'ACoAAA0123456789abcdefghijklmnopqrst' };
  assert.equal(f.runReply(confirm, 'manual', 'setup').data.status, 'OK');
  f.save({
    urlSequence: ['https://www.linkedin.com/messaging/'],
    fingerprint: { labels: ['Focused', 'Unread'], hasConversationList: true },
    filters: [{ label: 'Focused', checked: 'false' }, { label: 'Unread', checked: 'true' }],
    evaluateQueue: [
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }, { index: 2, name: 'C', preview: 'p3', time: 'Oct 28' }], total: 3 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }, { index: 2, name: 'C', preview: 'p3', time: 'Oct 28' }, { index: 3, name: 'D', preview: 'p4', time: 'Oct 13' }, { index: 4, name: 'E', preview: 'p5', time: 'Sep 25' }], total: 5 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }, { index: 2, name: 'C', preview: 'p3', time: 'Oct 28' }, { index: 3, name: 'D', preview: 'p4', time: 'Oct 13' }, { index: 4, name: 'E', preview: 'p5', time: 'Sep 25' }], total: 5 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }, { index: 2, name: 'C', preview: 'p3', time: 'Oct 28' }, { index: 3, name: 'D', preview: 'p4', time: 'Oct 13' }, { index: 4, name: 'E', preview: 'p5', time: 'Sep 25' }], total: 5 },
    ],
  });
  return f;
};

test('ego scan은 목록 순회 뒤 상세 개방을 시도하고 개방 불가 항목만 개별 실패로 남긴다', t => {
  const f = scanSetup(t);
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.complete, true);
  assert.equal(result.data.coverage.listed, 5);
  assert.equal(result.data.coverage.detailOpened, 0);
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.data.review.length, 5);
  for (const item of result.data.review) {
    assert.equal(item.status, 'review');
    assert.match(item.reason, /^THREAD_OPEN_FAILED:/, 'stub 큐 불일치는 항목 단위 개방 실패로 처리된다');
    assert.equal(item.changed, true);
  }
  assert.equal(f.records('operations').filter(op => op === 'wheel').length, 3);
  const obsDir = join(f.home, '.local/share/aha-skills/linkedin-replies/conversations');
  assert.equal(readdirSync(obsDir).filter(name => name.startsWith('ego-obs-')).length, 5);
  assert.deepEqual(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')), []);
});

// 실측 URL 규칙(G1): 스레드 seg는 `2-` + base64url(<대화UUID>_<n>)이다.
const threadSeg = '2-' + Buffer.from('6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c_100').toString('base64url');
const detailSetup = (t, extra = {}) => {
  const f = scanSetup(t);
  f.save({
    persistQueue: true,
    urlSequence: ['https://www.linkedin.com/messaging/'],
    fingerprint: { labels: ['Focused', 'Unread'], hasConversationList: true },
    filters: [{ label: 'Focused', checked: 'false' }],
    listProbe: { rows: 2 },
    click: { __setUrl: `https://www.linkedin.com/messaging/thread/${threadSeg}/`, __ret: { code: 'CLICKED' } },
    readEvents: { lastSenderIsOther: true, text: 'p1 요청 드립니다', renderedCount: 1, events: [{ senderIsOther: true, text: 'p1 요청 드립니다' }] },
    evaluateQueue: [
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }], total: 2 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }], total: 2 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }], total: 2 },
    ],
    ...extra,
  });
  return f;
};

test('ego scan 상세 계층은 발신자 대조로 후보·answered를 판정하고 UUID 키로 승격한다', t => {
  const f = detailSetup(t);
  // A는 상대(other), B는 own — readEventsQueue는 개방 순서대로 serve된다.
  f.save({ readEventsQueue: [
    { lastSenderIsOther: true, text: 'p1 요청 드립니다', renderedCount: 1, events: [{ senderIsOther: true, text: 'p1 요청 드립니다' }] },
    { lastSenderIsOther: false, text: 'p2 확인했습니다', renderedCount: 1, events: [{ senderIsOther: false, text: 'p2 확인했습니다' }] },
  ] });
  const result = f.runScan({ detailOpenCap: 2 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.coverage.detailOpened, 2);
  assert.equal(result.data.coverage.openCap, 2);
  assert.equal(result.data.coverage.capExceeded, false);
  assert.equal(result.data.coverage.answeredCount, 1);
  assert.equal(result.data.candidates.length, 1);
  assert.deepEqual(result.data.candidates[0], {
    name: 'A', conversationUuid: '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c',
    preview: 'p1', time: 'Nov 12',
    events: [{ senderIsOther: true, text: 'p1 요청 드립니다' }],
  });
  assert.equal(result.data.review.length, 0, 'answered는 review에서 제외된다');
  const obsDir = join(f.home, '.local/share/aha-skills/linkedin-replies/conversations');
  const files = readdirSync(obsDir).filter(name => name.startsWith('ego-obs-'));
  // 이름 키(A·B)는 승격 시 제거, UUID 키는 A·B가 같은 스레드로 개방돼 하나로 합쳐진다
  assert.equal(files.length, 1, '이름 키는 승격 시 제거되고 UUID 키만 남는다');
  assert.match(files[0], /ego-obs-[0-9a-f]{64}\.json$/);
  const promoted = JSON.parse(readFileSync(join(obsDir, files[0]), 'utf8'));
  assert.equal(promoted.uuid, '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c');
  assert.ok(promoted.lastSenderKind, '기록에 발신자 종별이 있다');
});

test('상세 개방 상한 초과분은 OPEN_CAP_EXCEEDED로 미개방 반환한다', t => {
  const f = detailSetup(t);
  const result = f.runScan({ detailOpenCap: 1 });
  assert.equal(result.data.coverage.detailOpened, 1);
  assert.equal(result.data.coverage.capExceeded, true);
  assert.equal(result.data.review.length, 1);
  assert.equal(result.data.review[0].reason, 'OPEN_CAP_EXCEEDED');
  assert.equal(result.data.candidates.length, 1, 'A(sender≠own)는 cap 내 개방돼 후보가 된다');
});

const promotedRecordPath = f => join(f.home, '.local/share/aha-skills/linkedin-replies/conversations',
  `ego-obs-${createHash('sha256').update(JSON.stringify(['ego-observation', 'test-slug', 'uuid', '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c'])).digest('hex')}.json`);

test('ego scan 상세 개방은 후보 events와 관측 threadSeg를 기록에 남긴다', t => {
  const f = detailSetup(t);
  f.save({ readEvents: { lastSenderIsOther: true, text: 'p1 요청 드립니다', renderedCount: 2, events: [
    { senderIsOther: true, text: 'p1 요청 드립니다' }, { senderIsOther: false, text: '네 확인했습니다' },
  ] } });
  const result = f.runScan({ detailOpenCap: 1 });
  assert.equal(result.data.status, 'OK');
  assert.deepEqual(result.data.candidates[0].events, [
    { senderIsOther: true, text: 'p1 요청 드립니다' }, { senderIsOther: false, text: '네 확인했습니다' },
  ]);
  const record = JSON.parse(readFileSync(promotedRecordPath(f), 'utf8'));
  assert.equal(record.uuid, '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c');
  assert.equal(record.threadSeg, threadSeg, '관측한 원 seg가 기록된다 — read의 직행 내비게이션 근거');
  assert.equal('events' in record, false, '레코드에 메시지 본문을 저장하지 않는다');
});

test('answered·미입증 스레드는 events를 비워 반환하고 기록은 식별자만 남긴다', t => {
  const f = detailSetup(t);
  // B(own 발신)는 answered로 판정된다 — events는 후보에만 붙는다.
  f.save({ readEvents: { lastSenderIsOther: false, text: 'p1 요청 드립니다', renderedCount: 1, events: [{ senderIsOther: false, text: '내가 보낸 답장' }] } });
  const result = f.runScan({ detailOpenCap: 1 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.data.coverage.answeredCount, 1);
  const record = JSON.parse(readFileSync(promotedRecordPath(f), 'utf8'));
  assert.equal(record.threadSeg, threadSeg, 'answered에도 seg는 식별자로 기록된다');
  assert.equal('events' in record, false);
  assert.equal(JSON.stringify(record).includes('내가 보낸 답장'), false, '본문은 기록에 남지 않는다');
});

test('read는 기록된 threadSeg로 스레드 URL에 직행한다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  f.save({ readEvents: { renderedCount: 3, events: [
    { senderIsOther: true, text: '첫 인사' }, { senderIsOther: false, text: '네 확인했습니다' }, { senderIsOther: true, text: 'p1 요청 드립니다' },
  ] } });
  const gotosBefore = f.records('operations').filter(op => op.startsWith('goto:')).length;
  const result = f.runRead();
  assert.equal(result.status, 0);
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.transport, 'ego-ui/1');
  assert.equal(result.data.conversationUuid, '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c');
  assert.equal(result.data.name, 'A');
  assert.deepEqual(result.data.events, [
    { senderIsOther: true, text: '첫 인사' }, { senderIsOther: false, text: '네 확인했습니다' }, { senderIsOther: true, text: 'p1 요청 드립니다' },
  ]);
  assert.equal(result.data.source, 'dom', 'auto는 캡처 실패 시 DOM 결과를 반환한다');
  assert.deepEqual(result.data.history, { renderedCount: 3, returnedCount: 3, truncatedFromOldest: false, scope: 'dom-rendered',
    note: '스크롤 lazy-load분은 미포함 — 렌더된 메시지만 반환합니다' });
  const readGotos = f.records('operations').filter(op => op.startsWith('goto:')).slice(gotosBefore);
  assert.deepEqual(readGotos, [`goto:/messaging/thread/${threadSeg}/`, `goto:/messaging/thread/${threadSeg}/`],
    '목록 클릭 순회 없이 기록된 seg로 직행한다 — auto는 캡처 시도와 DOM 폴백 두 번');
  assert.deepEqual(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')), [], '성공 시 락을 해제한다');
});

test('기록 없는 UUID는 EGO_THREAD_NOT_OBSERVED로 자식을 시작하지 않는다', t => {
  const f = scanSetup(t);
  const result = f.runRead({ conversationUuid: 'aaaaaab1-4d5e-4f6a-8b7c-9d0e1f2a3b4c' });
  assert.equal(result.data.status, 'EGO_THREAD_NOT_OBSERVED');
  assert.match(result.data.message, /scan/);
  assert.equal(f.records('calls').length, 1, 'setup 1회 외 read용 자식 호출은 없다');
  assert.deepEqual(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')), []);
});

test('구형 기록(threadSeg 없음)도 EGO_THREAD_NOT_OBSERVED로 안전 종료한다', t => {
  const f = scanSetup(t);
  mkdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/conversations'), { recursive: true });
  writeFileSync(promotedRecordPath(f), JSON.stringify({ uuid: '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c', name: 'A', previewHash: 'x', lastSenderKind: 'other' }), { mode: 0o600 });
  const result = f.runRead();
  assert.equal(result.data.status, 'EGO_THREAD_NOT_OBSERVED');
  assert.equal(f.records('calls').length, 1);
});

test('read는 남은 ego 락에서 LOCKED로 막힌다', t => {
  const f = scanSetup(t);
  mkdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/conversations'), { recursive: true });
  writeFileSync(promotedRecordPath(f), JSON.stringify({ uuid: '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c', threadSeg, name: 'A' }), { mode: 0o600 });
  mkdirSync(egoLockPath(f), { recursive: true });
  const result = f.runRead();
  assert.equal(result.data.status, 'LOCKED');
  assert.equal(f.records('calls').length, 1);
});

test('무인 read는 BLOCKED_UNATTENDED로 차단된다', t => {
  const f = scanSetup(t);
  const result = f.runReply({}, 'unattended', 'read');
  assert.equal(result.data.status, 'BLOCKED_UNATTENDED');
  assert.equal(f.records('calls').length, 1);
});

for (const patch of [{ extra: 1 }, { conversationUuid: 'short' }, { transport: 'aside-ui/1' }, { maxEventChars: 10 }, { maxEvents: 0 }]) {
  test(`read의 잘못된 입력은 자식 시작 전에 거부한다: ${Object.keys(patch)[0]}`, t => {
    const f = scanSetup(t);
    const result = f.runRead(patch);
    assert.equal(result.data.status, 'INVALID_ARGUMENT');
    assert.equal(f.records('calls').length, 1, 'setup 1회 외 거부 경로의 자식 호출은 없다');
  });
}

test('read 실패(로그인 화면)는 EGO_NEEDS_LOGIN과 락 유지다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  f.save({ urlSequence: ['https://www.linkedin.com/login'] });
  const result = f.runRead();
  assert.equal(result.data.status, 'EGO_NEEDS_LOGIN');
  assert.equal(result.data.profileLockRetained, true);
  assert.ok(existsSync(egoLockPath(f)), '실패 시 락이 유지된다');
  const again = f.runRead();
  assert.equal(again.data.status, 'LOCKED', '남은 락은 재호출도 막는다');
});

test('read는 렌더 상한을 초과한 이력을 최신 n개로 잘라 보고한다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  // 마지막 이벤트 본문은 목록 미리보기('p1')로 입증돼야 후보 승격·기록이 일어난다.
  const events = Array.from({ length: 19 }, (_, i) => ({ senderIsOther: i % 2 === 0, text: `메시지 ${i + 1}` }));
  events.push({ senderIsOther: true, text: 'p1 요청 드립니다' });
  f.save({ readEvents: { renderedCount: 20, events } });
  const result = f.runRead();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.events.length, 12, '기본 상한 12개');
  assert.equal(result.data.events[11].text, 'p1 요청 드립니다', '가장 최신 이벤트가 마지막이다');
  assert.deepEqual(result.data.history.renderedCount, 20);
  assert.deepEqual(result.data.history.returnedCount, 12);
  assert.equal(result.data.history.truncatedFromOldest, true);
});

test('read는 caps 입력을 받아 이벤트 수·본문 길이를 조정한다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  const events = Array.from({ length: 19 }, (_, i) => ({ senderIsOther: true, text: `긴 본문 메시지 ${i + 1} `.repeat(5) }));
  events.push({ senderIsOther: true, text: 'p1 요청 드립니다' });
  f.save({ readEvents: { renderedCount: 20, events } });
  const result = f.runRead({ maxEvents: 3, maxEventChars: 40 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.events.length, 3);
  assert.equal(result.data.history.returnedCount, 3);
  assert.equal(result.data.history.truncatedFromOldest, true);
});

test('read는 행 수가 안정될 때까지 대기해 늦게 렌더된 메시지를 놓치지 않는다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  f.save({
    readEvents: { renderedCount: 2, events: [{ senderIsOther: true, text: '먼저 온 메시지' }, { senderIsOther: true, text: '나중에 온 메시지' }] },
    rowCountSequence: [1, 1, 2, 2, 2],
  });
  const result = f.runRead({ maxEvents: 10, maxEventChars: 300 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.events.length, 2, '안정화 후 2건을 반환한다');
  assert.equal(result.data.history.renderedCount, 2);
});

test('read는 행 수가 이미 안정하면 곧바로 추출한다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  f.save({
    readEvents: { renderedCount: 1, events: [{ senderIsOther: true, text: '단일 메시지' }] },
    rowCountSequence: [1, 1, 1],
  });
  const result = f.runRead({ maxEvents: 10, maxEventChars: 300 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.events.length, 1);
});

const SELF_PROFILE = 'ACoAAA0123456789abcdefghijklmnopqrst';
const OTHER_PROFILE = 'ACoAADG6kd0BZCxhJWn0ZqSbc_6p-EIzWeayGT0';
const captureMessage = (deliveredAt, self, text) => ({
  $type: 'com.linkedin.messenger.Message', deliveredAt,
  '*sender': `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${self ? SELF_PROFILE : OTHER_PROFILE}`,
  body: { text },
});
const CAPTURE_URL = 'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.abc&variables=(x:1)';

test('read auto는 messengerMessages 캡처를 우선하고 교차 검증해 채택한다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  f.save({
    resourceUrls: [CAPTURE_URL],
    fetchResponse: { ok: true, status: 200, body: JSON.stringify({ included: [
      captureMessage(1000, false, '먼저 온 캡처 메시지'),
      captureMessage(2000, false, '나중에 온 캡처 메시지'),
    ] }) },
    readEvents: { renderedCount: 1, events: [{ senderIsOther: true, text: '나중에 온 캡처 메시지' }] },
  });
  const result = f.runRead({ maxEvents: 10, maxEventChars: 300 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.source, 'capture');
  assert.equal(result.data.events.length, 2);
  assert.equal(result.data.events[0].text, '먼저 온 캡처 메시지');
  assert.equal(result.data.history.scope, 'api-capture');
});

test('read auto는 캡처 실패 시 DOM 결과로 폴백한다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  f.save({
    resourceUrls: [],
    readEvents: { renderedCount: 1, events: [{ senderIsOther: true, text: '단일 메시지' }] },
  });
  const result = f.runRead({ maxEvents: 10, maxEventChars: 300 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.source, 'dom');
  assert.match(String(result.data.crossCheck), /CAPTURE_NO_ENDPOINT/);
});

test('read auto는 캡처와 DOM 마지막 이벤트가 불일치하면 DOM 결과를 반환한다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  f.save({
    resourceUrls: [CAPTURE_URL],
    fetchResponse: { ok: true, status: 200, body: JSON.stringify({ included: [captureMessage(1000, false, '캡처의 마지막')] }) },
    readEvents: { renderedCount: 1, events: [{ senderIsOther: true, text: 'DOM의 마지막' }] },
  });
  const result = f.runRead({ maxEvents: 10, maxEventChars: 300 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.source, 'dom');
  assert.match(String(result.data.crossCheck), /불일치/);
});

test('read capture 명시는 실패 시 폴백 없이 실패를 반환한다', t => {
  const f = detailSetup(t);
  assert.equal(f.runScan({ detailOpenCap: 1 }).data.status, 'OK');
  f.save({ resourceUrls: [] });
  const result = f.runRead({ source: 'capture', maxEvents: 10, maxEventChars: 300 });
  assert.equal(result.data.status, 'CAPTURE_NO_ENDPOINT');
});

test('InMail 제목형 프리뷰는 내용이 읽히면 DOM 발신자 판정으로 후보 승격한다', t => {
  // 실측(2026-11-17): InMail 제목은 스레드 버블에 렌더되지 않아 접두 입증이 구조적으로 실패한다.
  // 접두 입증 실패여도 렌더 버블이 읽히면(마지막 행 발신자 클래스 판독 성공) 판정한다.
  const f = detailSetup(t, {
    evaluateQueue: [
      { items: [{ index: 0, name: 'A', preview: 'InMail • 국내 커머스 CTO 포지션 제안(confidential)', time: 'Nov 2' }], total: 1 },
      { items: [{ index: 0, name: 'A', preview: 'InMail • 국내 커머스 CTO 포지션 제안(confidential)', time: 'Nov 2' }], total: 1 },
      { items: [{ index: 0, name: 'A', preview: 'InMail • 국내 커머스 CTO 포지션 제안(confidential)', time: 'Nov 2' }], total: 1 },
    ],
    readEvents: { lastSenderIsOther: true, text: '안녕하세요 재훈님, 인사드립니다.', renderedCount: 1, events: [{ senderIsOther: true, text: '안녕하세요 재훈님, 인사드립니다.' }] },
  });
  const result = f.runScan({ detailOpenCap: 1 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.candidates.length, 1);
  assert.equal(result.data.candidates[0].events.length, 1, '가독 판정 승격 후보에도 이벤트가 붙는다');
  assert.equal(result.data.review.length, 0);
});

test('InMail 제목형 프리뷰는 내용이 읽히면 DOM 판정으로 answered 처리한다(마지막 발신자=나)', t => {
  // 실제 케이스(김충수, 2026-11-17 read 실측): 렌더 이벤트 1건이 내 발신("예 감사합니다!")이고
  // 목록 프리뷰는 InMail 제목이라 접두 입증이 실패했던 스레드.
  const f = detailSetup(t, {
    evaluateQueue: [
      { items: [{ index: 0, name: 'A', preview: '국내 커머스 CTO 포지션 제안(confidential)', time: 'Nov 2' }], total: 1 },
      { items: [{ index: 0, name: 'A', preview: '국내 커머스 CTO 포지션 제안(confidential)', time: 'Nov 2' }], total: 1 },
      { items: [{ index: 0, name: 'A', preview: '국내 커머스 CTO 포지션 제안(confidential)', time: 'Nov 2' }], total: 1 },
    ],
    readEvents: { lastSenderIsOther: false, text: '예 감사합니다!', renderedCount: 1, events: [{ senderIsOther: false, text: '예 감사합니다!' }] },
  });
  const result = f.runScan({ detailOpenCap: 1 });
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.data.review.length, 0);
  assert.equal(result.data.coverage.answeredCount, 1);
});

test('렌더된 내용을 읽지 못하면 LATEST_EVENT_UNPROVEN 검토 필요로 남는다', t => {
  // 유지되는 가드: 버블이 아예 읽히지 않으면(예: 마지막 이벤트가 이모지 반응) 판정하지 않는다.
  const f = detailSetup(t, {
    evaluateQueue: [
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }], total: 1 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }], total: 1 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }], total: 1 },
    ],
    readEvents: { lastSenderIsOther: false, text: '', renderedCount: 3, events: [] },
  });
  const result = f.runScan({ detailOpenCap: 1 });
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.data.review.length, 1);
  assert.equal(result.data.review[0].reason, 'LATEST_EVENT_UNPROVEN');
});

const BODY = '승인된 본문입니다';
const CONV_UUID = '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c';
const sendSetup = (t, extra = {}) => {
  const f = scanSetup(t);
  f.save({
    persistQueue: true,
    listProbe: { rows: 2 },
    click: { __setUrl: `https://www.linkedin.com/messaging/thread/${threadSeg}/`, __ret: { code: 'CLICKED' } },
    eventCount: 2,
    pre: { isOther: true },
    composerBlocks: { found: true, text: '', match: true },
    readbackBlocks: { found: true, text: BODY, match: true },
    threadQueue: [{ isOther: false, text: BODY }],
    ...extra,
  });
  return f;
};

const prepareJob = (t, f) => {
  const prepared = f.runReply({ conversationId: CONV_UUID, sessionId: 'sess-1', text: BODY, conversationName: 'Jingyu Kim' }, 'manual', 'prepare');
  assert.equal(prepared.data.status, 'OK');
  assert.ok(prepared.data.question, '승인 질문이 반환된다');
  return prepared.data;
};

const approve = (t, f, question, answer = '전송') => {
  // 실제 훅 진입점(record-approval.mjs)을 fixture HOME으로 실행해 영수증을 남긴다.
  const payload = {
    hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', session_id: 'sess-1',
    tool_input: { questions: [question] },
    tool_response: { answers: { [question.question]: answer } },
  };
  const hook = spawnSync(process.execPath, [new URL('../record-approval.mjs', import.meta.url).pathname], {
    env: { HOME: f.home, PATH: '/invalid' }, input: JSON.stringify(payload), encoding: 'utf8', timeout: 8000,
  });
  assert.equal(hook.error, undefined);
  assert.equal(hook.status, 0);
};

test('ego send 승인 경로는 클릭 한 번과 자기 발신 증거로 SENT를 반환한다', async t => {
  const f = sendSetup(t);
  const { jobId, question } = prepareJob(t, f);
  await approve(t, f, question);
  console.error('LOCKS-BEFORE', JSON.stringify(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks'))));
  const result = f.runReply({ jobId, sessionId: 'sess-1' }, 'manual', 'send');
  if (result.data.status !== 'SENT') console.error('DBGS', JSON.stringify(result.data), JSON.stringify(f.records('calls').length));
  assert.equal(result.data.status, 'SENT');
  assert.equal(result.data.jobId, jobId);
  const job = JSON.parse(readFileSync(join(f.home, '.local/share/aha-skills/linkedin-replies/jobs', jobId + '.json'), 'utf8'));
  assert.equal(job.state, 'sent');
  const ledgerDir = join(f.home, '.local/share/aha-skills/linkedin-replies/conversations');
  const ledgerNames = readdirSync(ledgerDir).filter(name => name.endsWith('.json'));
  assert.equal(ledgerNames.length, 1, '전송 ledger가 남는다');
  const ledger = JSON.parse(readFileSync(join(ledgerDir, ledgerNames[0]), 'utf8'));
  assert.equal(ledger.state, 'sent');
  // 락은 해제되고 클릭은 정확히 한 번(스텁의 sendClick은 고정 응답) 기록된다
  assert.deepEqual(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')).filter(n => n.startsWith('ego-profile-')), []);
});

test('전송 직전 기준 변화는 BLOCKED로 차단하고 ledger를 제거해 재준비를 허용한다', async t => {
  const f = sendSetup(t, { pre: { isOther: false } });
  const { jobId, question } = prepareJob(t, f);
  await approve(t, f, question);
  const result = f.runReply({ jobId, sessionId: 'sess-1' }, 'manual', 'send');
  assert.equal(result.data.status, 'BLOCKED');
  assert.equal(result.data.reason, 'CRITERIA_CHANGED');
  const job = JSON.parse(readFileSync(join(f.home, '.local/share/aha-skills/linkedin-replies/jobs', jobId + '.json'), 'utf8'));
  assert.equal(job.state, 'stale');
  const ledgerDir = join(f.home, '.local/share/aha-skills/linkedin-replies/conversations');
  assert.equal(readdirSync(ledgerDir).filter(name => name.endsWith('.json')).length, 0, 'ledger가 제거된다');
});

test('composer에 기존 내용이 있으면 READBACK·클릭 없이 차단한다', async t => {
  const f = sendSetup(t, { composerBlocks: { found: true, text: '남의 초안', match: false } });
  const { jobId, question } = prepareJob(t, f);
  await approve(t, f, question);
  const result = f.runReply({ jobId, sessionId: 'sess-1' }, 'manual', 'send');
  assert.equal(result.data.status, 'BLOCKED');
  assert.equal(result.data.reason, 'COMPOSER_NOT_EMPTY');
});

test('composer의 승인 본문 잔여분만은 네이티브 키보드로 정리한 뒤 전송을 진행한다', async t => {
  const f = sendSetup(t, { composerBlocks: { found: true, text: BODY, match: true } });
  const { jobId, question } = prepareJob(t, f);
  await approve(t, f, question);
  const result = f.runReply({ jobId, sessionId: 'sess-1' }, 'manual', 'send');
  assert.equal(result.data.status, 'SENT');
  const ops = f.records('operations');
  assert.ok(ops.includes('insertText'), '네이티브 insertText 기록이 남는다');
  assert.ok(ops.includes('key:ControlOrMeta+A'), '전체선택 단축키 기록이 남는다');
  assert.ok(ops.includes('key:Backspace'), '삭제 키 기록이 남는다');
});

test('다중 문단 본문은 Shift+Enter로 줄바꿈을 넣어 전송한다', async t => {
  const multi = '첫 문단입니다\n\n둘째 문단입니다';
  // 실제 DOM 증거 추출은 공백을 정규화해 반환하므로 스텁도 평문을 serve한다.
  const flat = multi.replace(/\s+/g, ' ');
  const f = sendSetup(t, { readbackBlocks: { found: true, text: multi, match: true }, threadQueue: [{ isOther: false, text: flat }] });
  const prepared = f.runReply({ conversationId: CONV_UUID, sessionId: 'sess-1', text: multi, conversationName: 'Jingyu Kim' }, 'manual', 'prepare');
  assert.equal(prepared.data.status, 'OK');
  await approve(t, f, prepared.data.question);
  const result = f.runReply({ jobId: prepared.data.jobId, sessionId: 'sess-1' }, 'manual', 'send');
  assert.equal(result.data.status, 'SENT');
  const ops = f.records('operations');
  assert.ok(ops.includes('key:Shift+Enter'), 'Shift+Enter 기록이 남는다');
  assert.ok(ops.filter(op => op === 'insertText').length >= 2, '문단별 insertText가 남는다');
});

test('readback 불일치는 클릭 없이 차단한다', async t => {
  const f = sendSetup(t, { readbackBlocks: { found: true, text: '다른 본문', match: false } });
  const { jobId, question } = prepareJob(t, f);
  await approve(t, f, question);
  const result = f.runReply({ jobId, sessionId: 'sess-1' }, 'manual', 'send');
  assert.equal(result.data.status, 'BLOCKED');
  assert.equal(result.data.reason, 'READBACK_MISMATCH');
});

test('클릭 뒤 증거 부족은 UNKNOWN으로 남기고 ledger를 유지한다', async t => {
  const f = sendSetup(t, { threadQueue: [{ isOther: false, text: '다른 내용' }, { isOther: false, text: '다른 내용 2' }] });
  const { jobId, question } = prepareJob(t, f);
  await approve(t, f, question);
  const result = f.runReply({ jobId, sessionId: 'sess-1' }, 'manual', 'send');
  assert.equal(result.data.status, 'UNKNOWN');
  assert.deepEqual(result.data.verification, { checked: true, sent: false, note: 'seg 기록 없음' });
  const job = JSON.parse(readFileSync(join(f.home, '.local/share/aha-skills/linkedin-replies/jobs', jobId + '.json'), 'utf8'));
  assert.equal(job.state, 'unknown');
  const ledgerDir = join(f.home, '.local/share/aha-skills/linkedin-replies/conversations');
  const ledger = JSON.parse(readFileSync(join(ledgerDir, readdirSync(ledgerDir)[0]), 'utf8'));
  assert.equal(ledger.state, 'unknown');
  assert.deepEqual(readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')).filter(n => n.startsWith('ego-profile-')), []);
});

test('UNKNOWN은 read 확인 관측으로 sent 여부를 덧붙인다', async t => {
  const f = sendSetup(t, { threadQueue: [{ isOther: true, text: '다른 내용' }], readEvents: { renderedCount: 1, events: [{ senderIsOther: false, text: BODY }] } });
  // scan이 승격한 것처럼 seg 기록을 심는다 — 확인 관측이 이 seg로 스레드를 읽는다.
  const recDir = join(f.home, '.local/share/aha-skills/linkedin-replies/conversations');
  mkdirSync(recDir, { recursive: true });
  const seg = '2-OWNiMGNhZGUtYmVlZi00MTQxLThlYmItZDkwMGVhYjViZmIyXzEwMA==';
  const recKey = createHash('sha256').update(JSON.stringify(['ego-observation', 'test-slug', 'uuid', CONV_UUID])).digest('hex');
  writeFileSync(join(recDir, `ego-obs-${recKey}.json`), JSON.stringify({ uuid: CONV_UUID, name: 'Jingyu Kim', threadSeg: seg, status: 'candidate' }), { mode: 0o600 });
  const { jobId, question } = prepareJob(t, f);
  await approve(t, f, question);
  const result = f.runReply({ jobId, sessionId: 'sess-1' }, 'manual', 'send');
  assert.equal(result.data.status, 'UNKNOWN');
  assert.deepEqual(result.data.verification, { checked: true, sent: true });
});

test('영수증 없는 send는 자식을 시작하지 않고 APPROVAL_REQUIRED로 막는다', t => {
  const f = sendSetup(t);
  const { jobId } = prepareJob(t, f);
  const callsBefore = f.records('calls').length;
  const result = f.runReply({ jobId, sessionId: 'sess-1' }, 'manual', 'send');
  assert.equal(result.data.status, 'APPROVAL_REQUIRED');
  assert.equal(f.records('calls').length, callsBefore, '브라우저 자식 0회');
});

test('빈 입력 scan은 저장된 ego binding으로 무인 정상 입구를 제공한다', t => {
  // 라우팅 입증이 목적 — stub을 즉시 실패 모드로 두고 ego scan 경로로 들어왔음을 사유로 확인한다.
  const f = scanSetup(t);
  f.save({ mode: 'stderr' });
  const result = f.runReply({}, 'unattended', 'scan');
  assert.deepEqual(result.data, { status: 'EGO_OUTCOME_UNKNOWN', reason: 'EGO_CONNECT_FAILED', profileLockRetained: true });
});

test('ego scan은 잘린 목록(total>items)에서 complete를 보고하지 않는다', t => {
  const f = scanSetup(t);
  f.save({ evaluateQueue: [
    { items: [{ index: 0, name: 'A', preview: 'p', time: 't' }], total: 3 },
    { items: [{ index: 0, name: 'A', preview: 'p', time: 't' }], total: 3 },
    { items: [{ index: 0, name: 'A', preview: 'p', time: 't' }], total: 3 },
    { items: [{ index: 0, name: 'A', preview: 'p', time: 't' }], total: 3 },
  ] });
  const result = f.runScan();
  if (result.data.status !== 'OK') console.error('DBGT', JSON.stringify(result.data));
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.complete, false, '잘린 목록은 완료로 보고하지 않는다');
});

test('ego scan은 빈 편지함 안정 상태에서 complete로 정상 종료한다', t => {
  const f = scanSetup(t);
  f.save({ evaluateQueue: [
    { items: [], total: 0 },
    { items: [], total: 0 },
    { items: [], total: 0 },
    { items: [], total: 0 },
  ] });
  const result = f.runScan();

  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.complete, true);
  assert.equal(result.data.coverage.listed, 0);
});

test('ego scan 재실행은 미변경 항목의 재개방 대상 표시를 changed:false로 둔다', t => {
  const f = scanSetup(t);
  assert.equal(f.runScan().data.status, 'OK');
  const second = f.runScan();
  assert.equal(second.data.status, 'OK');
  for (const item of second.data.review) assert.equal(item.changed, false);
});

test('ego scan은 fingerprint 불일치를 명시 실패로 반환하고 락을 남긴다', t => {
  const f = scanSetup(t);
  f.save({ fingerprint: { labels: ['Focused'], hasConversationList: true } });
  const result = f.runScan();
  assert.deepEqual(result.data, { status: 'EGO_FINGERPRINT_MISMATCH', reason: 'UI_OPERATION_FAILED', profileLockRetained: true });
  const locks = readdirSync(join(f.home, '.local/share/aha-skills/linkedin-replies/locks')).filter(n => n.startsWith('ego-profile-'));
  assert.equal(locks.length, 1);
  assert.equal(f.runScan().data.status, 'LOCKED');
});

test('ego scan은 로그인 화면에서 EGO_NEEDS_LOGIN으로 중단한다', t => {
  const f = scanSetup(t);
  f.save({ urlSequence: ['https://www.linkedin.com/login'] });
  assert.equal(f.runScan().data.status, 'EGO_NEEDS_LOGIN');
});

test('ego binding이 없거나 구형이면 scanEgo는 NEEDS_SETUP으로 종료한다', t => {
  const f = setupFixture(t);
  assert.equal(f.runScan().data.status, 'NEEDS_SETUP');
});

test('scanEgo의 잘못된 입력·binding 불일치는 거부되고 aside scan은 여전히 차단된다', t => {
  const f = scanSetup(t);
  assert.equal(f.runScan({ executable: 'relative-path' }).data.status, 'INVALID_ARGUMENT');
  assert.equal(f.runScan({ taskSpaceName: 'different-skill' }).data.status, 'NEEDS_SETUP');
  assert.deepEqual(f.runReply({ transport: 'aside-ui/1' }, 'manual', 'scan').data, { status: 'UI_NOT_ACTIVATED' });
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
});

// ── 수동 응답 관측 계층(1.12.0): Network.enable로 켠 도메인의 버퍼 이벤트에서 페이지가 스스로
// 수신한 messaging API 응답만 읽어 발신자를 확정한다. 관측에 실패한 항목은 기존 DOM 증명으로 폴백한다.
const captureUuidA = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const captureUuidB = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const OWNER_ID = 'ACoAAA0123456789abcdefghijklmnopqrst';
const OTHER_ID = 'ACoAAAzzzzzzzzzzzzzzzzzzzzzzzzzzz';
const capMsg = ({ uuid = captureUuidA, slug = 'other-slug', id = OTHER_ID, body = 'p1 요청 드립니다',
  firstName = '', lastName = '', withFrom = true, urnOnly = false } = {}) => ({
  conversationUrn: `urn:li:fsd_conversation:${uuid}`,
  deliveredAt: 1730000000000,
  body: { text: body },
  ...(withFrom ? { from: { miniProfile: { publicIdentifier: slug,
    entityUrn: urnOnly ? `urn:li:fs_miniProfile:${id}` : `urn:li:member:${id}`, firstName, lastName } } } : {}),
});
const capPair = requestId => [
  { method: 'Network.responseReceived', params: { requestId, response: { url: 'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.deadbeef&variables=(mailbox)' } } },
  { method: 'Network.loadingFinished', params: { requestId } },
];
const nameRecordPath = (f, name) => join(f.home, '.local/share/aha-skills/linkedin-replies/conversations',
  `ego-obs-${createHash('sha256').update(JSON.stringify(['ego-observation', 'test-slug', name])).digest('hex')}.json`);
// 캡처 테스트용 2항목 뷰 — A(상대 발신 프리뷰 p1)·B(own 발신 프리뷰 p2). 안정 완료를 위해 동일 뷰 4회.
const captureSetup = t => {
  const f = scanSetup(t);
  const view = { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }], total: 2 };
  f.save({ evaluateQueue: [view, view, view, view] });
  return f;
};

test('수신 응답 관측은 상세 개방 없이 후보·answered를 판정하고 이름 키 기록에 출처를 남긴다', t => {
  const f = captureSetup(t);
  f.save({ eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ uuid: captureUuidA, body: 'p1 요청 드립니다', firstName: 'A' }),
    capMsg({ uuid: captureUuidB, slug: 'test-slug', id: OWNER_ID, body: 'p2 확인했습니다', firstName: 'B' }),
  ] }) } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.coverage.detailOpened, 0, '캡처로 판정된 항목은 상세 개방하지 않는다');
  assert.equal(result.data.coverage.capturedCount, 2);
  assert.equal(result.data.candidates.length, 1);
  assert.deepEqual(result.data.candidates[0], { name: 'A', conversationUuid: captureUuidA,
    preview: 'p1', time: 'Nov 12', events: [{ senderIsOther: true, text: 'p1 요청 드립니다' }] });
  assert.equal(result.data.review.length, 0);
  assert.equal(result.data.coverage.answeredCount, 1, '소유자 발신은 answered로 판정된다');
  assert.equal(result.data.coverage.completeness, 'complete', '개방 0회여도 캡처 해소면 complete다');
  const ops = f.records('operations');
  assert.ok(ops.includes('cdp:Network.enable'));
  assert.ok(ops.indexOf('cdp:Network.enable') < ops.indexOf('goto:/messaging/', ops.indexOf('cdp:Network.enable')), 'enable은 goto보다 앞선다');
  assert.equal(f.records('calls').length, 2, 'setup 외 목록 자식 1회면 충분하다');
  const record = JSON.parse(readFileSync(nameRecordPath(f, 'A'), 'utf8'));
  assert.equal(record.source, 'capture');
  assert.equal(record.uuid, captureUuidA);
  assert.equal(record.lastSenderKind, 'other');
  assert.equal('threadSeg' in record, false, '캡처분은 seg 승격이 없다');
  assert.equal('events' in record, false, '본문은 기록에 남지 않는다');
});

test('캡처는 발신자 urn 비교로도 방향을 판정한다', t => {
  const f = scanSetup(t);
  f.save({ eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ slug: 'not-owner-slug', id: OWNER_ID, body: 'p1 제가 보낸 메시지', firstName: 'A' }),
  ] }) } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.data.coverage.answeredCount, 1);
});

test('캡처에 없는 항목만 상세 개방으로 폴백한다', t => {
  const f = captureSetup(t);
  f.save({ eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ body: 'p1 요청 드립니다', firstName: 'A' }),
  ] }) } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.coverage.capturedCount, 1);
  assert.equal(result.data.candidates.length, 1);
  assert.equal(result.data.review.length, 1);
  assert.match(result.data.review[0].reason, /^THREAD_OPEN_FAILED:/);
});

for (const [label, patch] of [
  ['cdp 사용 불가', { cdpEnableError: true }],
  ['events 사용 불가', { eventsThrow: true }],
  ['응답 미발견', { eventsQueue: [capPair('r1')], cdpBody: {} }],
  ['응답이 JSON이 아님', { eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: 'not-json' } } }],
  ['응답 셰이프 불명', { eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: '{"unrelated":1}' } } }],
  ['발신자 식별 불가(InMail)', { eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ withFrom: false, body: 'p1 요청 드립니다' }),
  ] }) } } }],
  ['이름 충돌', { eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ body: 'p1 요청 드립니다', firstName: 'A' }),
    capMsg({ uuid: captureUuidB, body: 'p1 요청 드립니다', firstName: 'A' }),
  ] }) } } }],
]) test(`관측 실패·불명 항목은 캡처 없이 DOM 증명으로 폴백한다: ${label}`, t => {
  const f = captureSetup(t);
  f.save(patch);
  const result = f.runScan();
  assert.equal(result.data.status, 'OK', '관측 실패는 scan 실패가 아니다');
  assert.equal(result.data.coverage.capturedCount, 0);
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.data.review.length, 2);
  assert.match(result.data.review[0].reason, /^(THREAD_OPEN_FAILED|OPEN_CAP_EXCEEDED)/);
});

test('같은 requestId 재수신은 중복 수집하지 않는다', t => {
  const f = scanSetup(t);
  f.save({ cdpEvents: capPair('r1').concat(capPair('r2')), cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ body: 'p1 요청 드립니다', firstName: 'A' }),
  ] }) } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.coverage.capturedCount, 1);
  assert.deepEqual(result.data.candidates[0].events, [{ senderIsOther: true, text: 'p1 요청 드립니다' }]);
});

test('base64 응답 본문도 디코딩해 파싱한다', t => {
  const f = scanSetup(t);
  f.save({ eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: true,
    body: Buffer.from(JSON.stringify({ included: [capMsg({ body: 'p1 요청 드립니다', firstName: 'A' })] })).toString('base64') } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.coverage.capturedCount, 1);
  assert.equal(result.data.candidates.length, 1);
});

test('캡처의 과도한 senderSlug는 부모 스키마 검증으로 거부된다', t => {
  const f = scanSetup(t);
  f.save({ eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ slug: 'x'.repeat(200), body: 'p1 요청 드립니다', firstName: 'A' }),
  ] }) } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'EGO_OUTCOME_UNKNOWN');
  assert.equal(result.data.reason, 'EGO_SCHEMA_INVALID');
  assert.equal(result.data.profileLockRetained, true);
});

test('실측 형태(2026-11-16) 페이로드는 seg uuid·참가자 이름·sender urn으로 판정한다', t => {
  const realSegOf = uuid => '2-' + Buffer.from(`${uuid}_100`).toString('base64url');
  const capConvReal = ({ uuid = captureUuidA, name = 'A', selfSent = false, body = 'p1 요청 드립니다' } = {}) => ({
    notificationStatus: 'ACTIVE',
    conversationParticipants: [
      { entityUrn: `urn:li:msg_messagingParticipant:(urn:li:fsd_profile:x-${name})`,
        participantType: { member: { firstName: name, lastName: '', profileUrl: `https://www.linkedin.com/in/other-${name}` } } },
      { entityUrn: `urn:li:msg_messagingParticipant:${OWNER_ID}`,
        participantType: { member: { firstName: '재훈', lastName: '최', profileUrl: 'https://www.linkedin.com/in/x' } } },
    ],
    conversationUrl: `https://www.linkedin.com/messaging/thread/${realSegOf(uuid)}/`,
    messages: { _type: 'com.linkedin.messenger.Messages', elements: [
      { deliveredAt: 1730000000000, body: { text: body },
        sender: { entityUrn: selfSent ? `urn:li:msg_messagingParticipant:${OWNER_ID}` : `urn:li:msg_messagingParticipant:ACoAAAother01${name}` } },
    ] },
  });
  const f = captureSetup(t);
  f.save({ eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ data: { messengerConversationsBySyncToken: { elements: [
    capConvReal({ uuid: captureUuidA, name: 'A', selfSent: false, body: 'p1 요청 드립니다' }),
    capConvReal({ uuid: captureUuidB, name: 'B', selfSent: true, body: 'p2 확인했습니다' }),
  ] } } }) } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.coverage.detailOpened, 0, '실측 형태에서도 상세 개방 없이 판정한다');
  assert.equal(result.data.coverage.capturedCount, 2);
  assert.equal(result.data.candidates.length, 1);
  assert.equal(result.data.candidates[0].name, 'A');
  assert.equal(result.data.candidates[0].conversationUuid, captureUuidA);
  assert.equal(result.data.coverage.answeredCount, 1);
});

test('캡처가 보이는 항목을 모두 해소하면 안정 라운드에서 조기 종료한다', t => {
  // load-more 행으로 total > items.length인 상태(기존 안정 조건 불발)에서도 조기 종료해야 한다.
  const f = captureSetup(t);
  const view = { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }, { index: 1, name: 'B', preview: 'p2', time: 'Nov 2' }], total: 3 };
  f.save({ evaluateQueue: [view, view, view, view], eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ uuid: captureUuidA, body: 'p1 요청 드립니다', firstName: 'A' }),
    capMsg({ uuid: captureUuidB, slug: 'test-slug', id: OWNER_ID, body: 'p2 확인했습니다', firstName: 'B' }),
  ] }) } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.complete, true, '캡처 활성 시 행 개수 안정이면 순회 완료로 본다');
  assert.equal(result.data.coverage.capturedCount, 2);
  assert.equal(result.data.coverage.detailOpened, 0);
  const wheels = f.records('operations').filter(op => op === 'wheel').length;
  assert.ok(wheels <= 2, `조기 종료로 순회가 짧아진다: wheel ${wheels}회`);
});

test('scan 목록 스크립트는 수동 관측 계약을 소스 수준에서 따른다', t => {
  // 전량 캡처 시나리오로 돌려 상세 개방 자식이 없게 한다 — 마지막으로 기록된 자식 스크립트가 scanList다.
  const f = captureSetup(t);
  f.save({ eventsQueue: [capPair('r1')], cdpBody: { r1: { base64Encoded: false, body: JSON.stringify({ included: [
    capMsg({ uuid: captureUuidA, body: 'p1 요청 드립니다', firstName: 'A' }),
    capMsg({ uuid: captureUuidB, slug: 'test-slug', id: OWNER_ID, body: 'p2 확인했습니다', firstName: 'B' }),
  ] }) } } });
  const result = f.runScan();
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.coverage.detailOpened, 0);
  const script = readFileSync(join(f.home, 'script'), 'utf8');
  const enableAt = script.indexOf('Network.enable');
  assert.ok(enableAt >= 0, 'Network.enable이 스크립트에 있다');
  assert.ok(enableAt < script.indexOf('timeout: 45000'), 'Network.enable은 goto보다 앞선다');
  assert.doesNotMatch(script, /page\.fetch\(|queryId/, '능동 재요청·queryId 고정은 없다');
  assert.doesNotMatch(script, /\b[0-9a-f]{32}\b/, '해시 리터럴을 굳히지 않는다');
  assert.match(script, /^\(/);
  assert.match(script, /\.catch\(/);
});
