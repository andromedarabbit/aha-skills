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
    if (src.includes('data-event-urn')) {
      if (Array.isArray(state.threadQueue) && state.threadQueue.length) {
        const next = state.threadQueue.shift();
        if (state.persistQueue) writeFileSync(home + '/backend.json', JSON.stringify({ ...state, threadQueue: state.threadQueue }));
        return next;
      }
      return state.thread ?? null;
    }
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
try { await vm.runInNewContext('(async () => {' + script + '})()', context, { timeout: 1000 }); }
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
  return { binding, home, run, runReply, startReply, waitFor, save, records, snapshot: backend.snapshot, runScan };
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
    thread: { lastSenderIsOther: true, text: 'p1 요청 드립니다' },
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
  // A는 상대(other), B는 own — threadQueue는 개방 순서대로 serve된다.
  f.save({ threadQueue: [
    { lastSenderIsOther: true, text: 'p1 요청 드립니다' },
    { lastSenderIsOther: false, text: 'p2 확인했습니다' },
  ] });
  const result = f.runScan({ detailOpenCap: 2 });
  if (result.data?.coverage?.detailOpened !== 2) console.error('DBGY', JSON.stringify(result.data.review?.map(r => [r.name, r.reason])), JSON.stringify(result.stderr || '').slice(0, 300));
  assert.equal(result.data.status, 'OK');
  assert.equal(result.data.coverage.detailOpened, 2);
  assert.equal(result.data.coverage.openCap, 2);
  assert.equal(result.data.coverage.capExceeded, false);
  assert.equal(result.data.coverage.answeredCount, 1);
  assert.equal(result.data.candidates.length, 1);
  assert.deepEqual(result.data.candidates[0], {
    name: 'A', conversationUuid: '6f1c2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c',
    preview: 'p1', time: 'Nov 12',
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

test('proof 불일치는 LATEST_EVENT_UNPROVEN으로 후보에서 제외한다', t => {
  const f = detailSetup(t);
  f.save({
    fingerprint: { labels: ['Focused', 'Unread'], hasConversationList: true },
    filters: [{ label: 'Focused', checked: 'false' }],
    evaluateQueue: [
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }], total: 1 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }], total: 1 },
      { items: [{ index: 0, name: 'A', preview: 'p1', time: 'Nov 12' }], total: 1 },
    ],
    threadQueue: [
      { lastSenderIsOther: true, text: '전혀 다른 본문 내용' },
      { lastSenderIsOther: true, text: '전혀 다른 본문 안정 틱 판정' },
      { lastSenderIsOther: true, text: '전혀 다른 본문 세 번째 틱' },
    ],
  });
  const result = f.runScan({ detailOpenCap: 1 });
  assert.equal(result.data.candidates.length, 0);
  assert.equal(result.data.review.length, 1);
  assert.equal(result.data.review[0].reason, 'LATEST_EVENT_UNPROVEN');
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
