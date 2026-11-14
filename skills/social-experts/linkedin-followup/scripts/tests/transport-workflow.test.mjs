import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash, pbkdf2Sync, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { rootCertificates } from 'node:tls';
import { fileURLToPath } from 'node:url';

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = resolve(scripts, '../vendor/linkedincli/dist/index.js');
const self = 'urn:li:fs_miniProfile:self';
const other = 'urn:li:fs_miniProfile:other';
const password = 'synthetic-transport-safe-storage';
const liAt = 'synthetic-transport-li-at';
const jsessionid = '"ajax:synthetic-transport-session"';
const sessionId = 'transport-session';
const member = id => ({ 'com.linkedin.voyager.messaging.MessagingMember': { miniProfile: { entityUrn: id, firstName: id === self ? '본인' : '상대', lastName: '' } } });
const event = (id, sender, text, at) => ({ entityUrn: `urn:li:fs_event:(one,${id})`, createdAt: at, from: member(sender), eventContent: { 'com.linkedin.voyager.messaging.event.MessageEvent': { attributedBody: { text }, attachments: [] } } });

function fixture(t, { extraCA = false } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'linkedin-transport-workflow-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  const profile = join(home, 'Library/Application Support/Aside/Profile 1/Network');
  mkdirSync(profile, { recursive: true });
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const cookiePath = join(profile, 'Cookies');
  const db = new DatabaseSync(cookiePath);
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
  const otherCookie = Buffer.concat([Buffer.from('v10'), cipher.update(Buffer.concat([createHash('sha256').update('.linkedin.com').digest(), Buffer.from(`${liAt}-other`)])), cipher.final()]).toString('base64');
  try {
    db.exec(`CREATE TABLE meta(key TEXT, value TEXT);
      CREATE TABLE cookies(host_key TEXT, name TEXT, path TEXT, expires_utc INTEGER,
        has_expires INTEGER, top_frame_site_key TEXT, has_cross_site_ancestor INTEGER,
        value TEXT, encrypted_value BLOB);`);
    db.prepare('INSERT INTO meta VALUES (?, ?)').run('version', '24');
    const insert = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const expires = (BigInt(Date.now()) + 86400000n + 11644473600000n) * 1000n;
    for (const [name, value, prefix] of [['li_at', liAt, 'v10'], ['JSESSIONID', jsessionid, 'v11'], ['bcookie', 'synthetic-transport-browser-id', 'v10'], ['lidc', 'synthetic-transport-datacenter', 'v11']]) {
      const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
      const plain = Buffer.concat([createHash('sha256').update('.linkedin.com').digest(), Buffer.from(value)]);
      const encrypted = Buffer.concat([Buffer.from(prefix), cipher.update(plain), cipher.final()]);
      insert.run('.linkedin.com', name, '/', expires, 1, '', 1, '', encrypted);
      plain.fill(0);
      encrypted.fill(0);
    }
  } finally {
    db.close();
    key.fill(0);
  }
  const log = join(dir, 'requests.jsonl');
  const backend = join(dir, 'backend.json');
  const preload = join(dir, 'synthetic-transport.mjs');
  const caPath = join(dir, 'synthetic CA.pem');
  if (extraCA) writeFileSync(caPath, rootCertificates[0]);
  writeFileSync(backend, JSON.stringify({ sendStatus: 200 }));
  writeFileSync(preload, `
import cp from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { syncBuiltinESMExports } from 'node:module';
import { getCACertificates } from 'node:tls';
const log = ${JSON.stringify(log)};
const preload = ${JSON.stringify(preload)};
const artifact = ${JSON.stringify(artifact)};
const backend = ${JSON.stringify(backend)};
const record = value => appendFileSync(log, JSON.stringify(value) + '\\n');
// 테스트 HOME의 합성 DB만 읽으며 실제 키체인 프로세스는 시작하지 않는다.
Object.defineProperty(process, 'platform', { value: 'darwin' });
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => {
  if ([2000, 15000, 16000, 30000, 31000, 120000, 135000, 136000].includes(delay)) record({ kind: 'timeout', script: process.argv[1], delay });
  const state = JSON.parse(readFileSync(backend, 'utf8'));
  return nativeSetTimeout(callback, delay === 120000 && state.keychainFailure === 'timeout' ? 100 : delay, ...args);
};
const nativeSpawn = cp.spawn;
cp.spawn = (exe, args, options) => {
  if (exe === '/usr/bin/osascript') {
    const interactive = args.length === 4 && args[3] === 'authorize';
    if (JSON.stringify(args) !== JSON.stringify(['-l', 'JavaScript', ${JSON.stringify(join(scripts, 'keychain-read.js'))}, ...(interactive ? ['authorize'] : [])])) throw new Error('unexpected keychain helper');
    record({ kind: 'keychain', helper: args[2], interactive });
    const state = JSON.parse(readFileSync(backend, 'utf8'));
    const denied = state.keychainFailure === 'denied' || (state.keychainFailure === 'once' && !interactive);
    return nativeSpawn(process.execPath, ['--import', preload, '-e', state.keychainFailure === 'timeout' ? 'setInterval(() => {}, 1000)' : denied ? 'process.exit(1)' : ${JSON.stringify(`process.stdout.write('${Buffer.from(password).toString('base64')}\\n')`)}], options);
  }
  if (exe !== process.execPath || ![${JSON.stringify(join(scripts, 'aside-auth.mjs'))}, artifact].includes(args[0])) throw new Error('unexpected subprocess');
  record({ kind: 'child', script: args[0] });
  return nativeSpawn(exe, ['--import', preload, ...args], options);
};
syncBuiltinESMExports();
globalThis.fetch = async (url, init) => {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://www.linkedin.com' || process.argv[1] !== artifact) throw new Error('unexpected network caller');
  if (init.redirect !== 'manual' || !init.headers.cookie.includes('li_at=' + ${JSON.stringify(liAt)}) || init.headers['csrf-token'] !== ${JSON.stringify(jsessionid.replaceAll('"', ''))}) throw new Error('synthetic authentication mismatch');
  if (!init.headers.cookie.includes('bcookie=synthetic-transport-browser-id') || !init.headers.cookie.includes('lidc=synthetic-transport-datacenter')) throw new Error('browser cookie header missing');
  if (${extraCA} && (process.env.NODE_EXTRA_CA_CERTS !== ${JSON.stringify(caPath)} || !getCACertificates('extra').some(cert => new X509Certificate(cert).fingerprint256 === ${JSON.stringify(new X509Certificate(rootCertificates[0]).fingerprint256)}))) throw new Error('extra CA not loaded at CLI startup');
  const accountId = init.headers.cookie.includes('li_at=' + ${JSON.stringify(`${liAt}-other`)}) ? ${JSON.stringify(other)} : ${JSON.stringify(self)};
  record({ kind: 'request', accountId, artifact: process.argv[1], method: init.method, path: parsed.pathname, search: parsed.search, body: init.body, argv: process.argv });
  const state = JSON.parse(readFileSync(backend, 'utf8'));
  if (state.switchAfterMessages && init.method === 'GET' && parsed.pathname === '/voyager/api/messaging/conversations/one/events') {
    const db = new DatabaseSync(${JSON.stringify(cookiePath)});
    try { db.prepare("UPDATE cookies SET encrypted_value = ? WHERE name = 'li_at'").run(Buffer.from(${JSON.stringify(otherCookie)}, 'base64')); }
    finally { db.close(); }
    delete state.switchAfterMessages;
    writeFileSync(backend, JSON.stringify(state));
    record({ kind: 'account-switch' });
  }
  const member = ${member.toString()};
  const self = ${JSON.stringify(self)};
  const other = ${JSON.stringify(other)};
  const event = ${event.toString()};
  let data;
  if (init.method === 'GET' && parsed.pathname === '/voyager/api/me') data = { data: { '*miniProfile': accountId }, included: [member(accountId)['com.linkedin.voyager.messaging.MessagingMember'].miniProfile] };
  else if (init.method === 'GET' && parsed.pathname === '/voyager/api/messaging/conversations') data = { elements: [{ entityUrn: 'urn:li:fs_conversation:one', participants: [member(self), member(other)] }] };
  else if (init.method === 'GET' && parsed.pathname === '/voyager/api/messaging/conversations/one/events') data = { elements: [event('incoming', other, '문의합니다', 1000)] };
  else if (init.method === 'POST' && parsed.pathname === '/voyager/api/messaging/conversations/one/events' && parsed.search === '?action=create') {
    const status = JSON.parse(readFileSync(backend, 'utf8')).sendStatus;
    if (status !== 200) return new Response(JSON.stringify({ message: 'synthetic failure' }), { status });
    const text = JSON.parse(init.body).eventCreate.value['com.linkedin.voyager.messaging.create.MessageCreate'].attributedBody.text;
    // 합성 direct legacy event다. 실제 LinkedIn 성공 응답과의 호환성 근거가 아니다.
    data = event('server-created', accountId, text, 2000);
  } else throw new Error('unexpected synthetic endpoint');
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
};
`);
  const env = { HOME: home, PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', ...(extraCA ? { NODE_EXTRA_CA_CERTS: caPath } : {}) };
  const run = (command, input = {}) => {
    const result = spawnSync(process.execPath, ['--import', preload, join(scripts, 'reply.mjs'), '--mode', 'manual', command], {
      env, input: JSON.stringify(input), encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.error, undefined);
    assert.ok([0, 1].includes(result.status), result.stderr);
    assert.equal(result.stderr, '');
    const data = JSON.parse(result.stdout);
    assert.equal(result.status, ['OK', 'CONFIRM_ACCOUNT', 'SENT'].includes(data.status) ? 0 : 1, `unexpected exit code for ${data.status}`);
    return data;
  };
  const entries = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const requests = () => entries().filter(entry => entry.kind === 'request');
  const posts = () => requests().filter(entry => entry.method === 'POST');
  const setup = () => {
    const account = run('setup', { profile: 'Profile 1' });
    assert.equal(account.status, 'CONFIRM_ACCOUNT');
    assert.equal(account.account.id, self);
    assert.equal(run('scan').status, 'NEEDS_SETUP');
    assert.equal(run('setup', { profile: 'Profile 1', accountId: self }).status, 'OK');
    const scan = run('scan');
    assert.equal(scan.status, 'OK');
    assert.equal(scan.candidates.length, 1);
    assert.equal(scan.candidates[0].conversationId, 'one');
    assert.equal(posts().length, 0);
  };
  const prepare = text => {
    const prepared = run('prepare', { conversationId: 'one', sessionId, text });
    assert.equal(prepared.status, 'OK');
    return prepared;
  };
  const approve = prepared => {
    const payload = { hook_event_name: 'PostToolUse', session_id: sessionId, tool_name: 'AskUserQuestion', tool_input: { questions: [prepared.question] }, tool_response: { answers: { [prepared.question.question]: '전송' } } };
    const result = spawnSync(process.execPath, ['--import', preload, join(scripts, 'record-approval.mjs')], {
      env, input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '');
    const job = JSON.parse(readFileSync(join(home, '.local/share/aha-skills/linkedin-replies/jobs', `${prepared.jobId}.json`), 'utf8'));
    assert.equal(job.state, 'approved');
  };
  return { home, run, setup, prepare, approve, entries, requests, posts,
    switchAfterMessages() { writeFileSync(backend, JSON.stringify({ sendStatus: 200, switchAfterMessages: true })); },
    setStatus(status) { writeFileSync(backend, JSON.stringify({ sendStatus: status })); },
    setKeychainFailure(keychainFailure) { writeFileSync(backend, JSON.stringify({ sendStatus: 200, keychainFailure })); },
  };
}

test('추가 CA는 정상 진입점부터 배포 CLI 시작 시점까지 전달된다', t => {
  const f = fixture(t, { extraCA: true });
  f.setup();
  const prepared = f.prepare('추가 CA를 사용하는 합성 회신');
  f.approve(prepared);
  assert.equal(f.run('send', { jobId: prepared.jobId, sessionId }).status, 'SENT');
  assert.equal(f.posts().length, 1);
});

test('최초 승인·별도 UI 금지 재조회·계정 확인 후에만 binding을 저장한다', t => {
  const f = fixture(t);
  const first = f.run('setup', { profile: 'Profile 1' });
  assert.equal(first.status, 'CONFIRM_ACCOUNT');
  assert.equal(existsSync(join(f.home, '.local/share/aha-skills/linkedin-replies/binding.json')), false);
  assert.deepEqual(f.entries().filter(x => x.kind === 'keychain').map(x => x.interactive), [true, false]);
  assert.deepEqual(f.requests().map(x => [x.method, x.path]), [['GET', '/voyager/api/me']]);
  const delays = f.entries().filter(x => x.kind === 'timeout').map(x => x.delay);
  for (const delay of [120000, 2000, 135000, 136000]) assert.ok(delays.includes(delay));
  assert.equal(f.run('setup', { profile: 'Profile 1', accountId: self }).status, 'OK');
  assert.equal(f.run('scan').status, 'OK');
  assert.ok(f.entries().filter(x => x.kind === 'keychain').slice(1).every(x => x.interactive === false));
  assert.ok(f.entries().filter(x => x.kind === 'timeout').some(x => x.delay === 16000));
  assert.equal(f.posts().length, 0);
});

for (const failure of ['denied', 'once', 'timeout']) test(`최초 ${failure}는 배포 CLI 호출·binding 저장 전에 중단한다`, t => {
  const f = fixture(t);
  f.setKeychainFailure(failure);
  assert.equal(f.run('setup', { profile: 'Profile 1' }).status, 'NEEDS_AUTH');
  assert.deepEqual(f.entries().filter(x => x.kind === 'keychain').map(x => x.interactive), failure === 'once' ? [true, false] : [true]);
  assert.deepEqual(f.requests(), []);
  assert.equal(existsSync(join(f.home, '.local/share/aha-skills/linkedin-replies/binding.json')), false);
});

test('승인 훅부터 실제 배포 CLI까지 연결해 정확한 본문을 한 번만 POST한다', t => {
  const f = fixture(t);
  f.setup();
  const text = '안녕하세요.\n"문의"와 \'작은따옴표\' 감사합니다. 😀\n마지막 공백  ';
  const prepared = f.prepare(text);
  assert.ok(prepared.question.question.includes(text));
  f.approve(prepared);
  const result = f.run('send', { jobId: prepared.jobId, sessionId });
  assert.equal(result.status, 'SENT');
  assert.equal(result.eventId, 'urn:li:fs_event:(one,server-created)');
  assert.equal(f.posts().length, 1);
  const [post] = f.posts();
  assert.equal(post.artifact, artifact);
  assert.equal(post.path, '/voyager/api/messaging/conversations/one/events');
  assert.equal(post.search, '?action=create');
  const body = JSON.parse(post.body);
  assert.equal(body.eventCreate.value['com.linkedin.voyager.messaging.create.MessageCreate'].attributedBody.text, text);
  assert.equal(body.dedupeByClientGeneratedToken, false);
  assert.ok(!post.argv.includes(text));
  assert.ok(f.requests().every(request => request.artifact === artifact));
  assert.ok(['/voyager/api/me', '/voyager/api/messaging/conversations', '/voyager/api/messaging/conversations/one/events'].every(path => f.requests().some(request => request.method === 'GET' && request.path === path)));
  const keychainReads = f.entries().filter(entry => entry.kind === 'keychain');
  assert.equal(keychainReads[0].interactive, true);
  assert.ok(keychainReads.slice(1).every(entry => entry.interactive === false));
  assert.ok(f.entries().some(entry => entry.kind === 'child' && entry.script === join(scripts, 'aside-auth.mjs')));
  assert.ok(f.entries().some(entry => entry.kind === 'child' && entry.script === artifact));
  // send는 me·POST 두 번의 CLI 자식을 감싸므로 전용 31초 부모 상한을 쓴다.
  assert.ok(f.entries().some(entry => entry.kind === 'timeout' && entry.delay === 31000));
  assert.notEqual(f.run('send', { jobId: prepared.jobId, sessionId }).status, 'SENT');
  assert.equal(f.posts().length, 1);
});

test('최종 대화 조회 뒤 쿠키 계정이 바뀌면 다른 계정의 POST는 0회다', t => {
  const f = fixture(t);
  f.setup();
  const prepared = f.prepare('승인한 계정으로만 보냅니다.');
  f.approve(prepared);
  const before = f.requests().length;
  f.switchAfterMessages();
  assert.equal(f.run('send', { jobId: prepared.jobId, sessionId }).status, 'UNKNOWN');
  assert.equal(f.entries().filter(entry => entry.kind === 'account-switch').length, 1);
  assert.equal(f.posts().length, 0);
  const rechecks = f.requests().slice(before);
  assert.equal(rechecks[0].accountId, self);
  assert.equal(rechecks.at(-1).path, '/voyager/api/me');
  assert.equal(rechecks.at(-1).accountId, other);
  assert.equal(f.run('send', { jobId: prepared.jobId, sessionId }).status, 'UNKNOWN');
  assert.equal(f.run('prepare', { conversationId: 'one', sessionId, text: '재시도 금지' }).status, 'UNKNOWN');
  assert.equal(f.posts().length, 0);
});

test('실제 체인에서 승인 없는 send는 POST를 시작하지 않는다', t => {
  const f = fixture(t);
  f.setup();
  const prepared = f.prepare('승인 전에는 보내지 않습니다.');
  const before = f.requests().length;
  assert.equal(f.run('send', { jobId: prepared.jobId, sessionId }).status, 'APPROVAL_REQUIRED');
  assert.equal(f.posts().length, 0);
  assert.equal(f.requests().length, before);
});

test('실제 CLI의 POST 429는 한 번만 시도하고 UNKNOWN 이후 새 job도 차단한다', t => {
  const f = fixture(t);
  f.setup();
  const prepared = f.prepare('429 이후 자동으로 다시 보내지 않습니다.');
  f.approve(prepared);
  f.setStatus(429);
  assert.equal(f.run('send', { jobId: prepared.jobId, sessionId }).status, 'UNKNOWN');
  assert.equal(f.posts().length, 1);
  assert.equal(f.run('prepare', { conversationId: 'one', sessionId, text: '다시 보내지 않습니다.' }).status, 'UNKNOWN');
  assert.equal(f.run('send', { jobId: prepared.jobId, sessionId }).status, 'UNKNOWN');
  assert.equal(f.posts().length, 1);
});
