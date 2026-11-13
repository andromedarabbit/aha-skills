import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const adapter = new URL('../aside-ui.mjs', import.meta.url).href;

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'linkedin-ui-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  const executable = join(dir, 'aside stub');
  const worker = join(dir, 'worker.mjs');
  writeFileSync(worker, `
const nativeTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn, delay, ...args) => {
  if (delay === 125000) delay = 2000;
  return nativeTimer(fn, delay, ...args);
};
try {
  const { readUiSnapshot } = await import(${JSON.stringify(adapter)});
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  console.log(JSON.stringify(await readUiSnapshot(JSON.parse(input))));
} catch (error) { console.log(JSON.stringify({ status: error.code || 'FAILED' })); }
`);
  writeFileSync(executable, `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
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
const context = {
  URL,
  console: { log: value => process.stdout.write(value + '\\n') },
  listBrowserTabs: async () => { record('list'); return state.tabs; },
  attachBrowserTab: async id => {
    record('attach:' + id);
    context.page = { url: () => (++urlReads > 1 ? state.afterUrl ?? state.url : state.url) };
  },
  snapshot: async () => { record('snapshot'); return state.snapshot; },
};
await vm.runInNewContext('(async () => {' + script + '})()', context, { timeout: 1000 });
`, { mode: 0o700 });
  const binding = { executable, host: 'local-host', account: 'personal', profileId: 'actual-profile-id', targetId: 'owned-tab' };
  let backend = { url: 'https://www.linkedin.com/messaging/', tabs: [{ targetId: 'owned-tab', url: 'https://www.linkedin.com/messaging/' }], snapshot: { tree: '대화 목록\n  한글 "문자열"\n', diff: '' } };
  const save = patch => { backend = { ...backend, ...patch }; writeFileSync(join(home, 'backend.json'), JSON.stringify(backend)); };
  save({});
  const run = (patch = {}) => {
    const result = spawnSync(process.execPath, [worker], {
      env: { HOME: home, PATH: '/invalid', ASIDE_API_TOKEN: 'must-not-inherit', ASIDE_DEBUG: '1', DAEMON_BASE_URL: 'http://wrong-host', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      input: JSON.stringify({ ...binding, ...patch }), encoding: 'utf8', timeout: 5000,
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
  copyFileSync(new URL('../aside-ui.mjs', import.meta.url), join(dir, 'aside-ui.mjs'));
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
  const replyEnv = { HOME: home, PATH: '/invalid', NODE_OPTIONS: '--no-warnings', ASIDE_API_TOKEN: 'must-not-inherit' };
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
      env: { HOME: home, PATH: '/invalid', NODE_OPTIONS: '--no-warnings', ASIDE_API_TOKEN: 'must-not-inherit' },
      input: JSON.stringify(input), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null };
  };
  return { binding, home, run, runReply, startReply, waitFor, save, records, snapshot: backend.snapshot };
}

test('고정 REPL 작업은 명시한 프로필·탭의 전체 snapshot만 읽는다', t => {
  const f = fixture(t);
  assert.deepEqual(f.run(), { status: 'OBSERVED', targetId: f.binding.targetId, origin: 'https://www.linkedin.com', snapshot: f.snapshot });
  const [call] = f.records('calls').map(JSON.parse);
  assert.deepEqual(call.args, ['repl', '--host', 'local-host', '--account', 'personal', '--profile', 'actual-profile-id', '--file', '-']);
  assert.ok(!call.args.includes(f.binding.targetId));
  for (const key of ['ASIDE_API_TOKEN', 'ASIDE_DEBUG', 'DAEMON_BASE_URL', 'NODE_TLS_REJECT_UNAUTHORIZED']) assert.equal(call.env[key], undefined);
  assert.equal(call.env.CI, '1');
  assert.equal(call.env.ASIDE_CLI_UPDATE_CHECK, '0');
  assert.deepEqual(f.records('operations'), ['list', 'attach:owned-tab', 'snapshot']);
  const script = readFileSync(join(f.home, 'script'), 'utf8');
  assert.doesNotMatch(script, /\blinkedin\.[A-Za-z]+\(|fetch\(|openTab\(|closeTab\(|\.click\(|\.fill\(|\.press\(|evaluate\(|fs\./);
});

test('호출 간 page나 ref를 재사용하지 않고 다시 연결한다', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 'OBSERVED');
  assert.equal(f.run().status, 'OBSERVED');
  assert.deepEqual(f.records('operations'), ['list', 'attach:owned-tab', 'snapshot', 'list', 'attach:owned-tab', 'snapshot']);
});

test('코드처럼 생긴 target ID도 stdin의 데이터로만 사용한다', t => {
  const f = fixture(t);
  const targetId = '\"); console.log("injected"); //';
  f.save({ tabs: [{ targetId, url: 'https://www.linkedin.com/messaging/' }] });
  assert.equal(f.run({ targetId }).status, 'OBSERVED');
  assert.equal(f.records('calls').length, 1);
  assert.equal(f.records('calls')[0].includes('injected'), false);
});

for (const patch of [
  { executable: 'aside' }, { executable: '/bin/aside\0' }, { host: '' }, { account: '' }, { profileId: '' }, { targetId: '' },
  { targetId: 'bad\nID' }, { code: 'fetch("https://example.com")' }, { text: '회신 본문' }, { command: 'send' },
]) test(`유효하지 않은 실행 입력은 자식 시작 전에 거부한다: ${Object.keys(patch)[0]}`, t => {
  const f = fixture(t);
  assert.equal(f.run(patch).status, 'INVALID_ARGUMENT');
  assert.deepEqual(f.records('calls'), []);
});

for (const [name, patch, expected, operations] of [
  ['탭 소실', { tabs: [] }, 'UI_TARGET_MISMATCH', ['list']],
  ['중복 target', { tabs: [{ targetId: 'owned-tab', url: 'https://www.linkedin.com/messaging/' }, { targetId: 'owned-tab', url: 'https://www.linkedin.com/messaging/' }] }, 'UI_TARGET_MISMATCH', ['list']],
  ['외부 origin', { tabs: [{ targetId: 'owned-tab', url: 'https://www.linkedin.com.evil.test/messaging/' }] }, 'UI_ORIGIN_MISMATCH', ['list']],
  ['메시지 유사 경로', { url: 'https://www.linkedin.com/messaging-evil/' }, 'UI_ORIGIN_MISMATCH', ['list', 'attach:owned-tab']],
  ['계정 로그인 화면', { url: 'https://www.linkedin.com/login' }, 'UI_ORIGIN_MISMATCH', ['list', 'attach:owned-tab']],
  ['snapshot 중 이동', { afterUrl: 'https://example.com/' }, 'UI_ORIGIN_MISMATCH', ['list', 'attach:owned-tab', 'snapshot']],
  ['snapshot 형식 불명', { snapshot: { text: '모르는 구조' } }, 'UI_UNSUPPORTED_RESPONSE', ['list', 'attach:owned-tab', 'snapshot']],
]) test(`${name}에서는 추측·대체 탭 없이 종료한다`, t => {
  const f = fixture(t); f.save(patch);
  assert.equal(f.run().status, expected);
  assert.deepEqual(f.records('operations'), operations);
  assert.equal(f.records('calls').length, 1);
});

for (const mode of ['stderr', 'stdout-limit', 'stderr-limit', 'invalid-json', 'invalid-utf8', 'timeout']) {
  test(`${mode}는 원문 노출이나 자동 재호출 없이 실패한다`, t => {
    const f = fixture(t); f.save({ mode });
    assert.equal(f.run().status, 'UI_OUTCOME_UNKNOWN');
    assert.equal(f.records('calls').length, 1);
  });
}

test('정상 inspect는 binding·승인 없이 목록 탭의 관측만 반환한다', t => {
  const f = fixture(t);
  const result = f.runReply();
  assert.equal(result.status, 0);
  assert.deepEqual(result.data, {
    status: 'OBSERVED', targetId: 'owned-tab', origin: 'https://www.linkedin.com', snapshot: f.snapshot,
    transport: 'aside-ui/1', accountVerified: false, bindingSaved: false,
  });
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
  const state = join(f.home, '.local/share/aha-skills/linkedin-replies');
  for (const name of ['jobs', 'locks', 'conversations']) assert.deepEqual(readdirSync(join(state, name)), []);
  assert.equal(existsSync(join(state, 'binding.json')), false);
});

test('target 없는 inspect는 메시지 경계의 탭 ID·origin·경로 구분만 제시하고 연결하지 않는다', t => {
  const f = fixture(t);
  const { targetId, ...input } = f.binding;
  f.save({ tabs: [
    { targetId, url: 'https://www.linkedin.com/messaging/', title: '사적 제목' },
    { targetId: 'other', url: 'https://example.com/private' },
    { targetId: 'thread', url: 'https://www.linkedin.com/messaging/thread/private/' },
  ] });
  const result = f.runReply(input);
  assert.equal(result.status, 0);
  assert.deepEqual(result.data, {
    status: 'TABS_OBSERVED', tabs: [
      { targetId, origin: 'https://www.linkedin.com', location: 'list' },
      { targetId: 'thread', origin: 'https://www.linkedin.com', location: 'subpath' },
    ],
    transport: 'aside-ui/1', accountVerified: false, bindingSaved: false,
  });
  assert.deepEqual(f.records('operations'), ['list']);
  assert.doesNotMatch(result.stdout, /사적 제목|example.com|private/);
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
});

test('목록 탭 0개는 관측 결과일 뿐 미응답 0건이나 연결 완료가 아니다', t => {
  const f = fixture(t); f.save({ tabs: [] });
  const { targetId, ...input } = f.binding;
  assert.deepEqual(f.runReply(input).data, {
    status: 'TABS_OBSERVED', tabs: [], transport: 'aside-ui/1', accountVerified: false, bindingSaved: false,
  });
  assert.deepEqual(f.records('operations'), ['list']);
});

for (const response of [
  { status: 'TABS_OBSERVED', tabs: [{ targetId: 'x', origin: 'https://example.com', location: 'list' }] },
  { status: 'TABS_OBSERVED', tabs: [{ targetId: 'x', origin: 'https://www.linkedin.com', location: 'list', title: 'private' }] },
  { status: 'TABS_OBSERVED', tabs: [{ targetId: 'x', origin: 'https://www.linkedin.com', location: 'list' }, { targetId: 'x', origin: 'https://www.linkedin.com', location: 'list' }] },
  { status: 'TABS_OBSERVED', tabs: [{ targetId: 'x', origin: 'https://www.linkedin.com', location: 'login' }] },
  { status: 'TABS_OBSERVED', tabs: [{ targetId: 'x', url: 'https://www.linkedin.com/messaging/' }] },
]) test('탭 발견 출력도 origin·중복·필드를 검증한다', t => {
  const f = fixture(t); f.save({ mode: 'response', response });
  const { targetId, ...input } = f.binding;
  assert.equal(f.runReply(input).data.status, 'UI_OUTCOME_UNKNOWN');
  assert.equal(f.records('calls').length, 1);
});

test('무인 inspect와 유효하지 않은 입력은 UI·인증·상태 쓰기 전에 차단한다', t => {
  const f = fixture(t);
  assert.equal(f.runReply(f.binding, 'unattended').data.status, 'BLOCKED_UNATTENDED');
  assert.equal(f.runReply({ ...f.binding, text: '전송하지 않을 본문' }).data.status, 'INVALID_ARGUMENT');
  assert.equal(existsSync(join(f.home, '.local')), false);
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
  assert.deepEqual(f.records('calls'), []);
});

for (const mode of ['invalid-json', 'stderr', 'stdout-limit', 'stderr-limit', 'timeout']) {
  test(`inspect의 ${mode}는 프로필 락을 남기고 다른 target·발견 단계로도 재호출하지 않는다`, t => {
    const f = fixture(t); f.save({ mode });
    const result = f.runReply();
    assert.equal(result.status, 1);
    const reasons = { 'invalid-json': 'UI_JSON_INVALID', stderr: 'UI_EXIT_FAILED', 'stdout-limit': 'UI_STDOUT_LIMIT', 'stderr-limit': 'UI_STDERR_LIMIT', timeout: 'UI_TIMEOUT' };
    assert.deepEqual(result.data, { status: 'UI_OUTCOME_UNKNOWN', reason: reasons[mode], profileLockRetained: true });
    assert.equal(result.stdout.includes('private diagnostic'), false);
    assert.equal(result.stderr, '');
    const lockDir = join(f.home, '.local/share/aha-skills/linkedin-replies/locks');
    assert.equal(readdirSync(lockDir).length, 1);
    assert.equal(f.runReply({ ...f.binding, targetId: 'new-tab' }).data.status, 'LOCKED');
    const { targetId, ...input } = f.binding;
    assert.equal(f.runReply(input).data.status, 'LOCKED');
    assert.equal(f.records('calls').length, 1);
    assert.equal(existsSync(join(f.home, 'auth-called')), false);
    if (mode.endsWith('-limit')) assert.equal(existsSync(join(f.home, 'timer-fired')), false);
    if (mode === 'timeout') assert.equal(existsSync(join(f.home, 'timer-fired')), true);
  });
}

test('이미 남은 구형 binding·unknown·sending·락은 inspect로 변경하지 않는다', t => {
  const f = fixture(t);
  const root = join(f.home, '.local/share/aha-skills/linkedin-replies');
  mkdirSync(join(root, 'jobs'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'locks', 'old-lock'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'conversations'), { mode: 0o700 });
  const files = ['binding.json', 'jobs/old.json', 'conversations/old.json'];
  const contents = ['{"profile":"Default","account":{"id":"legacy"}}', '{"state":"sending"}', '{"state":"unknown"}'];
  files.forEach((name, index) => writeFileSync(join(root, name), contents[index], { mode: 0o600 }));
  assert.equal(f.runReply().data.status, 'OBSERVED');
  files.forEach((name, index) => assert.equal(readFileSync(join(root, name), 'utf8'), contents[index]));
  assert.deepEqual(readdirSync(join(root, 'locks')), ['old-lock']);
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
});

for (const response of [
  null, [], { status: 'SENT' }, { status: 'NEEDS_AUTH', raw: 'private diagnostic' },
  { status: 'OBSERVED', targetId: 'wrong', origin: 'https://www.linkedin.com', snapshot: { tree: '', diff: '' } },
  { status: 'OBSERVED', targetId: 'owned-tab', origin: 'https://example.com', snapshot: { tree: '', diff: '' } },
]) test('스키마가 다른 출력은 계정 연결이나 조회 성공으로 취급하지 않는다', t => {
  const f = fixture(t); f.save({ mode: 'response', response });
  assert.equal(f.run().status, 'UI_OUTCOME_UNKNOWN');
  assert.equal(f.records('calls').length, 1);
});

for (const [url, location] of [
  ['https://www.linkedin.com/messaging', 'list'],
  ['https://www.linkedin.com/messaging/', 'list'],
  ['https://www.linkedin.com/messaging/?filter=private-query#private-fragment', 'list'],
  ['https://www.linkedin.com/messaging/thread/private-thread/', 'subpath'],
  ['https://www.linkedin.com/messaging/thread/private-thread/?filter=private-query#private-fragment', 'subpath'],
]) test(`메시지 URL의 허용 경계는 원문 없이 발견·snapshot에 동일하게 적용한다: ${location} ${url}`, t => {
  const f = fixture(t);
  f.save({ tabs: [{ targetId: 'owned-tab', url }], url });
  const { targetId, ...input } = f.binding;
  const result = f.runReply(input);
  assert.deepEqual(result.data.tabs, [{ targetId, origin: 'https://www.linkedin.com', location }]);
  assert.doesNotMatch(result.stdout, /private-|filter=|fragment/);
  assert.deepEqual(f.records('operations'), ['list']);
  assert.equal(f.runReply().data.status, 'OBSERVED');
});

for (const url of [
  'http://www.linkedin.com/messaging/', 'https://linkedin.com/messaging/',
  'https://www.linkedin.com:8443/messaging/', 'https://www.linkedin.com.evil.test/messaging/',
  'https://private-user:private-pass@www.linkedin.com/messaging/',
  'https://www.linkedin.com/messaging-evil/', 'https://www.linkedin.com/login?next=/messaging/',
  'https://www.linkedin.com/messaging/%2e%2e/login', 'not a URL',
]) test(`메시지 경계 밖 URL은 후보·snapshot에서 모두 거부한다: ${url}`, t => {
  const f = fixture(t); f.save({ tabs: [{ targetId: 'owned-tab', url }], url });
  const { targetId, ...input } = f.binding;
  assert.deepEqual(f.runReply(input).data.tabs, []);
  assert.equal(f.runReply().data.status, 'UI_ORIGIN_MISMATCH');
  assert.deepEqual(f.records('operations'), ['list', 'list']);
});

for (const [patch, reason] of [
  [{ executable: '/not-present/aside' }, 'UI_SPAWN_FAILED'],
  [{ mode: 'invalid-utf8' }, 'UI_UTF8_INVALID'],
  [{ mode: 'response', response: { status: 'SENT', raw: 'private diagnostic' } }, 'UI_SCHEMA_INVALID'],
]) test(`정상 runner는 원문 대신 실패 단계 ${reason}만 반환한다`, t => {
  const f = fixture(t);
  const { executable, ...backend } = patch; f.save(backend);
  const result = f.runReply(executable ? { ...f.binding, executable } : f.binding);
  assert.deepEqual(result.data, { status: 'UI_OUTCOME_UNKNOWN', reason, profileLockRetained: true });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /private diagnostic|not-present/);
  assert.equal(f.runReply().data.status, 'LOCKED');
});

for (const command of ['setup', 'scan']) test(`UI ${command}는 미활성 사유를 반환하고 legacy 인증·상태·UI에 진입하지 않는다`, t => {
  const f = fixture(t);
  const result = f.runReply({ transport: 'aside-ui/1' }, 'manual', command);
  assert.deepEqual(result.data, { status: 'UI_NOT_ACTIVATED' });
  assert.equal(existsSync(join(f.home, '.local')), false);
  assert.equal(existsSync(join(f.home, 'auth-called')), false);
  assert.deepEqual(f.records('calls'), []);
  assert.equal(f.runReply({ scope: 'Focused', period: 'two-weeks' }, 'manual', command).data.status, 'INVALID_ARGUMENT');
});

test('동시 inspect는 하나만 자식에 진입하고 최소 작업 메타데이터를 남긴다', async t => {
  const f = fixture(t); f.save({ mode: 'hold' });
  const first = f.startReply();
  try {
    await f.waitFor('ready');
    const root = join(f.home, '.local/share/aha-skills/linkedin-replies/locks');
    const [name] = readdirSync(root);
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

test('기존 빈 프로필 락은 소유 불명으로 보존하며 자식을 시작하지 않는다', t => {
  const f = fixture(t);
  const hash = createHash('sha256').update(JSON.stringify([f.binding.host, f.binding.account, f.binding.profileId])).digest('hex');
  const lock = join(f.home, '.local/share/aha-skills/linkedin-replies/locks', `ui-profile-${hash}`);
  mkdirSync(lock, { recursive: true, mode: 0o700 });
  assert.equal(f.runReply().data.status, 'LOCKED');
  assert.deepEqual(readdirSync(lock), []);
  assert.deepEqual(f.records('calls'), []);
});
