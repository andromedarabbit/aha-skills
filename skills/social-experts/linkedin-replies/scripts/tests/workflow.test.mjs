import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const self = 'urn:li:fs_miniProfile:self';
const other = 'urn:li:fs_miniProfile:other';
const member = id => ({ 'com.linkedin.voyager.messaging.MessagingMember': { miniProfile: { entityUrn: id, firstName: id === self ? '본인' : '상대', lastName: '' } } });
const thread = { entityUrn: 'urn:li:fs_conversation:one', participants: [member(self), member(other)] };
const event = (id = 'incoming', sender = other, text = '문의합니다', at = 1000) => ({ entityUrn: `urn:li:fs_event:(one,${id})`, createdAt: at, from: member(sender), eventContent: { 'com.linkedin.voyager.messaging.event.MessageEvent': { attributedBody: { text }, attachments: [] } } });

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'linkedin-workflow-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  for (const name of ['reply.mjs', 'record-approval.mjs']) {
    const path = new URL(`../${name}`, import.meta.url);
    if (existsSync(path)) copyFileSync(path, join(dir, name));
  }
  writeFileSync(join(dir, 'aside-auth.mjs'), `
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
let text = ''; for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
appendFileSync(process.env.HOME + '/calls', JSON.stringify({ ...input, inherited: { NODE_OPTIONS: process.env.NODE_OPTIONS, LINKEDIN_FROM_CHROME: process.env.LINKEDIN_FROM_CHROME, ARBITRARY_SECRET: process.env.ARBITRARY_SECRET } }) + '\\n');
const b = JSON.parse(readFileSync(process.env.HOME + '/backend.json', 'utf8'));
let data;
if (['me', 'authorize'].includes(input.command)) data = b.me;
if (input.command === 'conversations') data = b.conversations;
if (input.command === 'messages') {
  if (b.holdMessages) {
    writeFileSync(process.env.HOME + '/ready', '');
    const deadline = Date.now() + 5000;
    while (!existsSync(process.env.HOME + '/release')) {
      if (Date.now() > deadline) throw new Error('release timed out');
      await new Promise(r => setTimeout(r, 10));
    }
  }
  data = b.messages;
}
if (input.command === 'send') {
  if (b.crashBeforePost) { process.kill(process.ppid, 'SIGKILL'); process.exit(0); }
  appendFileSync(process.env.HOME + '/posts', 'POST\\n');
  if (b.crashAfterPost) { process.kill(process.ppid, 'SIGKILL'); process.exit(0); }
  if (b.failSend) process.exit(1);
  data = b.send ?? {};
}
if (b.failure) { process.stdout.write(JSON.stringify({ status: b.failure })); process.exit(1); }
process.stdout.write(JSON.stringify({ status: 'OK', data }));
`);
  let backend = { me: { miniProfile: member(self)['com.linkedin.voyager.messaging.MessagingMember'].miniProfile }, conversations: { elements: [thread] }, messages: { elements: [event()] } };
  const save = patch => { backend = { ...backend, ...patch }; writeFileSync(join(home, 'backend.json'), JSON.stringify(backend)); };
  save({});
  const env = { HOME: home, PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', LINKEDIN_FROM_CHROME: 'true', ARBITRARY_SECRET: 'must-not-inherit' };
  const raw = (command, input = {}, mode = 'manual') => spawnSync(process.execPath, [join(dir, 'reply.mjs'), '--mode', mode, command], { env, input: JSON.stringify(input), encoding: 'utf8', timeout: 10000 });
  const start = (command, input) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(dir, 'reply.mjs'), '--mode', 'manual', command], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', () => { try { assert.equal(err, ''); resolve(JSON.parse(out)); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify(input));
  });
  const run = (command, input = {}, mode = 'manual') => {
    const r = raw(command, input, mode);
    assert.equal(r.error, undefined);
    assert.equal(r.stderr, '');
    return JSON.parse(r.stdout);
  };
  const hook = payload => {
    const r = spawnSync(process.execPath, [join(dir, 'record-approval.mjs')], { env, input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000 });
    assert.equal(r.error, undefined);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  };
  const calls = () => existsSync(join(home, 'calls')) ? readFileSync(join(home, 'calls'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  const setup = () => {
    assert.equal(run('setup', { profile: 'Profile 1' }).status, 'CONFIRM_ACCOUNT');
    assert.equal(run('scan').status, 'NEEDS_SETUP');
    assert.equal(run('setup', { profile: 'Profile 1', accountId: self }).status, 'OK');
  };
  const prepare = text => run('prepare', { conversationId: 'one', sessionId: 'session-one', text });
  const approve = (p, answer = '전송', mutate = x => x) => hook(mutate({ hook_event_name: 'PostToolUse', session_id: 'session-one', tool_name: 'AskUserQuestion', tool_input: { questions: [p.question] }, tool_response: { answers: { [p.question.question]: answer } } }));
  return { dir, home, run, raw, start, save, calls, setup, prepare, approve, hook, state: join(home, '.local/share/aha-skills/linkedin-replies') };
}

test('setup requires confirmation of the actual account and scans remain read-only', t => {
  const f = fixture(t);
  f.setup();
  const result = f.run('scan', {}, 'unattended');
  assert.equal(result.status, 'OK');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.coverage.completeness, 'unknown');
  assert.deepEqual(f.calls().map(x => x.command), ['authorize', 'me', 'me', 'conversations', 'messages']);
  assert.ok(f.calls().every(x => Object.keys(x.inherited).length === 0));
  assert.equal(statSync(f.state).mode & 0o777, 0o700);
  for (const name of readdirSync(f.state)) if (statSync(join(f.state, name)).isFile()) assert.equal(statSync(join(f.state, name)).mode & 0o777, 0o600);
});

test('무인 setup과 UI 허용 위조 입력은 인증·binding 없이 거부한다', t => {
  const f = fixture(t);
  assert.equal(f.run('setup', { profile: 'Profile 1' }, 'unattended').status, 'BLOCKED_UNATTENDED');
  assert.equal(f.run('setup', { profile: 'Profile 1', interactive: true }).status, 'INVALID_ARGUMENT');
  assert.equal(f.run('scan', { command: 'authorize' }, 'unattended').status, 'INVALID_ARGUMENT');
  assert.deepEqual(f.calls(), []);
  assert.equal(existsSync(join(f.state, 'binding.json')), false);
});

test('최초 승인 실패는 binding을 남기지 않는다', t => {
  const f = fixture(t);
  f.save({ failure: 'NEEDS_AUTH' });
  assert.equal(f.run('setup', { profile: 'Profile 1' }).status, 'NEEDS_AUTH');
  assert.deepEqual(f.calls().map(x => x.command), ['authorize']);
  assert.equal(existsSync(join(f.state, 'binding.json')), false);
});

test('account mismatch stops before conversations and an authentication error is not empty inbox', t => {
  const f = fixture(t); f.setup();
  const before = f.calls().length;
  f.save({ me: { miniProfile: { entityUrn: other, firstName: '다른 계정', lastName: '' } } });
  assert.equal(f.run('scan').status, 'ACCOUNT_MISMATCH');
  assert.deepEqual(f.calls().slice(before).map(x => x.command), ['me']);
  f.save({ failure: 'NEEDS_AUTH' });
  assert.equal(f.run('scan', {}, 'unattended').status, 'NEEDS_AUTH');
});

test('exact hook approval sends exact multiline body once and removes temporary text', t => {
  const f = fixture(t); f.setup();
  const text = '안녕하세요.\n"문의" 감사합니다.\n마지막 공백  ';
  const p = f.prepare(text);
  assert.equal(p.status, 'OK');
  assert.equal(p.question.header, 'LinkedIn 승인');
  assert.ok(p.question.question.includes(text));
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'APPROVAL_REQUIRED');
  f.approve(p);
  f.save({ send: event('server-created', self, text, 2000) });
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'SENT');
  assert.notEqual(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'SENT');
  const sent = f.calls().filter(x => x.command === 'send');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, text);
  const walk = dir => readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);
  assert.ok(walk(f.state).every(path => !readFileSync(path, 'utf8').includes(text)));
});

for (const [name, mutate] of [
  ['session', x => ({ ...x, session_id: 'other-session' })],
  ['event', x => ({ ...x, hook_event_name: 'PreToolUse' })],
  ['header', x => { x.tool_input.questions[0].header = '게시 승인'; return x; }],
  ['body', x => { x.tool_input.questions[0].question += '수정'; return x; }],
  ['choice', x => { x.tool_response.answers[x.tool_input.questions[0].question] = '전송할게요'; return x; }],
  ['multiple', x => { x.tool_input.questions.push(structuredClone(x.tool_input.questions[0])); return x; }],
]) test(`hook ${name} mutation cannot approve`, t => {
  const f = fixture(t); f.setup(); const p = f.prepare('회신'); f.approve(p, '전송', mutate);
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'APPROVAL_REQUIRED');
  assert.equal(f.calls().filter(x => x.command === 'send').length, 0);
});

for (const [name, messages] of [
  ['incoming changed', [event('new', other, '추가 문의', 3000)]],
  ['already answered', [event('reply', self, '다른 기기에서 회신', 3000)]],
]) test(`latest recheck ${name} prevents sending`, t => {
  const f = fixture(t); f.setup(); const p = f.prepare('회신'); f.approve(p);
  f.save({ messages: { elements: messages } });
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'STALE');
  assert.equal(f.calls().filter(x => x.command === 'send').length, 0);
});

test('unknown outcome blocks even a newly prepared job for the conversation', t => {
  const f = fixture(t); f.setup(); const p = f.prepare('회신'); f.approve(p);
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'UNKNOWN');
  assert.equal(f.prepare('새 회신').status, 'UNKNOWN');
  assert.equal(f.calls().filter(x => x.command === 'send').length, 1);
});

test('a new manual preview invalidates old approval; cancellation and session end remove text', t => {
  const f = fixture(t); f.setup();
  const p = f.prepare('이전 본문'); f.approve(p);
  const q = f.prepare('바꾼 본문');
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'STALE');
  f.approve(q, '취소');
  assert.equal(f.run('send', { jobId: q.jobId, sessionId: 'session-one' }).status, 'STALE');
  const r = f.prepare('세션 종료 본문');
  f.hook({ hook_event_name: 'SessionEnd', session_id: 'session-one' });
  assert.equal(f.run('send', { jobId: r.jobId, sessionId: 'session-one' }).status, 'STALE');
});

test('two send processes admit only one attempt under the conversation lock', async t => {
  const f = fixture(t); f.setup(); const p = f.prepare('동시 회신'); f.approve(p);
  f.save({ holdMessages: true, send: event('created', self, '동시 회신', 2000) });
  const first = f.start('send', { jobId: p.jobId, sessionId: 'session-one' });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(join(f.home, 'ready')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.ok(existsSync(join(f.home, 'ready')), '첫 전송의 락 확보와 대화 조회 진입을 확인해야 한다.');
    assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'LOCKED');
  } finally {
    writeFileSync(join(f.home, 'release'), '');
    assert.equal((await first).status, 'SENT');
  }
  assert.equal(readFileSync(join(f.home, 'posts'), 'utf8'), 'POST\n');
});

for (const [name, option, expectedPosts] of [['before POST', 'crashBeforePost', 0], ['after POST', 'crashAfterPost', 1]]) {
  test(`crash ${name} leaves durable sending and blocks new jobs without retry`, t => {
    const f = fixture(t); f.setup(); const p = f.prepare('중단 회신'); f.approve(p); f.save({ [option]: true });
    assert.equal(f.raw('send', { jobId: p.jobId, sessionId: 'session-one' }).signal, 'SIGKILL');
    const ledgerFile = readdirSync(join(f.state, 'conversations'))[0];
    assert.equal(JSON.parse(readFileSync(join(f.state, 'conversations', ledgerFile))).state, 'sending');
    assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'UNKNOWN');
    assert.equal(f.prepare('재시도 금지').status, 'UNKNOWN');
    const posts = existsSync(join(f.home, 'posts')) ? readFileSync(join(f.home, 'posts'), 'utf8').trim().split('\n').length : 0;
    assert.equal(posts, expectedPosts);
    assert.equal(readdirSync(join(f.state, 'locks')).length, 1, '크래시 락을 자동 탈취하지 않는다');
  });
}

for (const [name, mutate] of [
  ['account', j => { j.account.name = '변경'; }],
  ['participants', j => { j.participants[0].name = '변경'; }],
  ['fingerprint', j => { j.fingerprint = '0'.repeat(64); }],
  ['challenge', j => { j.challenge = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; }],
]) test(`changing approved ${name} cannot reuse a receipt`, t => {
  const f = fixture(t); f.setup(); const p = f.prepare('회신'); f.approve(p);
  const path = join(f.state, 'jobs', `${p.jobId}.json`);
  const job = JSON.parse(readFileSync(path)); mutate(job); writeFileSync(path, JSON.stringify(job));
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'APPROVAL_REQUIRED');
  assert.equal(f.calls().filter(x => x.command === 'send').length, 0);
});

test('새 연결과 승인 질문은 실제 실행 경로 버전을 포함한다', t => {
  const f = fixture(t); f.setup();
  const link = JSON.parse(readFileSync(join(f.state, 'binding.json')));
  assert.equal(link.transport, 'linkedincli/1');
  const p = f.prepare('회신');
  assert.equal(JSON.parse(readFileSync(join(f.state, 'jobs', `${p.jobId}.json`))).transport, 'linkedincli/1');
  assert.ok(p.question.question.includes('실행 경로: linkedincli/1\n'));
});

for (const transport of [undefined, 'aside-ui/1', 'unknown/1']) {
  test(`기존 또는 미지원 binding은 인증 fallback 없이 거부한다: ${transport}`, t => {
    const f = fixture(t); f.setup();
    const path = join(f.state, 'binding.json');
    const link = JSON.parse(readFileSync(path));
    if (transport === undefined) delete link.transport;
    else link.transport = transport;
    writeFileSync(path, JSON.stringify(link));
    const before = f.calls().length;
    assert.equal(f.run('scan').status, 'NEEDS_SETUP');
    assert.equal(f.run('scan', {}, 'unattended').status, 'NEEDS_SETUP');
    assert.equal(f.prepare('새 회신').status, 'NEEDS_SETUP');
    assert.equal(f.calls().length, before);
    assert.equal(readFileSync(path, 'utf8'), JSON.stringify(link));
  });
}

for (const transport of [undefined, 'aside-ui/1']) {
  test(`실행 경로가 다른 승인 job은 승인 생성과 전송을 차단한다: ${transport}`, t => {
    const f = fixture(t); f.setup();
    const p = f.prepare('회신'); f.approve(p);
    const path = join(f.state, 'jobs', `${p.jobId}.json`);
    const job = JSON.parse(readFileSync(path));
    if (transport === undefined) delete job.transport;
    else job.transport = transport;
    writeFileSync(path, JSON.stringify(job));
    const before = f.calls().length;
    assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'APPROVAL_REQUIRED');
    assert.equal(f.calls().length, before);
    job.state = 'pending';
    writeFileSync(path, JSON.stringify(job));
    rmSync(join(f.state, 'jobs', `${p.jobId}.approval.json`));
    f.approve(p);
    assert.equal(existsSync(join(f.state, 'jobs', `${p.jobId}.approval.json`)), false);
    f.hook({ hook_event_name: 'SessionEnd', session_id: 'session-one' });
    assert.equal(JSON.parse(readFileSync(path)).state, 'stale');
    assert.equal(existsSync(join(f.state, 'jobs', `${p.jobId}.txt`)), false);
  });
}

for (const state of ['sending', 'unknown']) {
  test(`실행 경로가 없는 기존 ${state} 기록도 정리나 새 job으로 우회하지 않는다`, t => {
    const f = fixture(t); f.setup();
    const p = f.prepare('회신'); f.approve(p);
    assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'UNKNOWN');
    const path = join(f.state, 'jobs', `${p.jobId}.json`);
    const job = JSON.parse(readFileSync(path));
    delete job.transport; job.state = state;
    writeFileSync(path, JSON.stringify(job));
    const ledgerPath = join(f.state, 'conversations', readdirSync(join(f.state, 'conversations'))[0]);
    const ledger = JSON.parse(readFileSync(ledgerPath)); ledger.state = state;
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    const before = f.calls().length;
    f.hook({ hook_event_name: 'SessionEnd', session_id: 'session-one' });
    assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'UNKNOWN');
    assert.equal(f.prepare('새 회신').status, 'UNKNOWN');
    assert.equal(f.calls().length, before);
    assert.equal(JSON.parse(readFileSync(path)).state, state);
    assert.equal(JSON.parse(readFileSync(ledgerPath)).state, state);
  });
}

test('unattended result can only resume through a fresh manual preview and approval', t => {
  const f = fixture(t); f.setup();
  assert.equal(f.run('scan', {}, 'unattended').status, 'OK');
  assert.equal(f.run('prepare', { conversationId: 'one', sessionId: 'session-one', text: '위조 승인' }, 'unattended').status, 'BLOCKED_UNATTENDED');
  const p = f.prepare('사용자가 새로 요청한 회신');
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }, 'unattended').status, 'BLOCKED_UNATTENDED');
  assert.equal(f.run('send', { jobId: p.jobId, sessionId: 'session-one' }).status, 'APPROVAL_REQUIRED');
  assert.equal(f.run('scan', {}, 'unattended').status, 'OK');
  assert.equal(f.calls().filter(x => x.command === 'send').length, 0);
});
