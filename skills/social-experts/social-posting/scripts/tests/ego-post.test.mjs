// ego-post.mjs — 프로세스·페이로드·부모 CLI 결과 계약 검증.
// ego-post-child.test.mjs는 실제로 전송된 자식 코드를 VM DOM에서 별도로 실행한다.
// 실제 플랫폼 셀렉터의 유효성은 브라우저 실측이 필요하다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ego-post.mjs');
const source = readFileSync(SCRIPT, 'utf8');
const mod = await import(SCRIPT);

// --- fixtures ---------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), 'ego-post-test-'));
const stateDir = join(work, 'state');
mkdirSync(stateDir, { recursive: true });

// 가짜 ego 실행파일: spawn 인자는 ['nodejs'], 스크립트는 stdin으로 온다(둘 다 기록).
// 일반 응답은 stdin을 끝까지 읽어 EPIPE 경합을 피한다. '#!' 스크립트는 입력 소비도 직접 정의한다.
function fakeEgo(name, respond) {
  const path = join(work, `${name}.sh`);
  const body = respond.startsWith('#!')
    ? respond
    : `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${respond.replace(/'/g, `'\\''`)}'\n`;
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

function bindingFor(executable, identity = { x: 'me' }) {
  return { transport: 'ego-post/1', executable, taskSpaceName: 'social-posting-skill', egoVersion: '0.6.3.14-test', identity };
}

function writeBinding(b) {
  writeFileSync(join(stateDir, 'binding.json'), JSON.stringify(b));
}

function runCli(args, stdin = '', extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, SOCIAL_EGO_STATE_DIR: stateDir, NO_COLOR: '1', ...extraEnv },
    timeout: 30000,
  });
}

function cliJson(result) {
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `stdout은 정확히 JSON 1줄이어야 한다: ${result.stdout}`);
  return JSON.parse(lines[0]);
}

const basePayload = {
  platform: 'x',
  format: 'single',
  body: '게시 본문',
  media: [],
  link: '',
  visibility: 'keep',
  identity: 'me',
};

// --- ① 프로세스 계약 (execute) ----------------------------------------------

test('execute: stdout JSON 파싱', async () => {
  const exe = fakeEgo('stdout-ok', '{"ok":true}');
  assert.deepEqual(await mod.execute(exe, 'ignored', 10000), { ok: true });
});

test('fakeEgo: 정상 응답 stub은 큰 stdin도 끝까지 소비한다', async () => {
  const exe = fakeEgo('large-stdin', '{"ok":true}');
  assert.deepEqual(await mod.execute(exe, 'x'.repeat(2 * 1024 * 1024), 10000), { ok: true });
});

test('execute: 입력을 닫은 자식은 유효한 JSON을 출력해도 EGO_STDIN_FAILED', async () => {
  const exe = fakeEgo('closed-stdin', `#!/bin/sh
exec 0<&-
printf '%s\\n' '{"ok":true}'
sleep 30
`);
  await assert.rejects(() => mod.execute(exe, 'x'.repeat(2 * 1024 * 1024), 10000), /EGO_STDIN_FAILED/);
});

test('execute: stderr JSON 재배선(0.6.3.14 계약) — notice 줄만 허용', async () => {
  const exe = fakeEgo('stderr-ok', `#!/bin/sh
cat >/dev/null
echo '[ego-browser:notice] hello' >&2
printf '%s\\n' '{"ok":2}' >&2
`);
  assert.deepEqual(await mod.execute(exe, 'ignored', 10000), { ok: 2 });
});

test('execute: stderr에 JSON 2줄 → EGO_JSON_INVALID', async () => {
  const exe = fakeEgo('stderr-bad', `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"a":1}' >&2
printf '%s\\n' '{"b":2}' >&2
`);
  await assert.rejects(() => mod.execute(exe, 'ignored', 10000), /EGO_JSON_INVALID/);
});

test('execute: JSON 아님 → EGO_JSON_INVALID', async () => {
  const exe = fakeEgo('garbage', 'not json at all');
  await assert.rejects(() => mod.execute(exe, 'ignored', 10000), /EGO_JSON_INVALID/);
});

test('execute: 자식 exit != 0 → EGO_CONNECT_FAILED', async () => {
  const exe = fakeEgo('exit1', `#!/bin/sh
cat >/dev/null
exit 3
`);
  await assert.rejects(() => mod.execute(exe, 'ignored', 10000), /EGO_CONNECT_FAILED/);
});

test('execute: 타임아웃 → EGO_TIMEOUT (프로세스 그룹 kill)', async () => {
  const exe = fakeEgo('sleepy', `#!/bin/sh
sleep 30
`);
  await assert.rejects(() => mod.execute(exe, 'ignored', 5000), /EGO_TIMEOUT/);
});

test('execute: 실행파일 없음 → 거부 (절대경로 검증)', async () => {
  await assert.throws(() => mod.execute('ego-browser', 'x', 10000), /INVALID_ARGUMENT/);
  await assert.throws(() => mod.execute('/nonexistent/ego', 'x', 1000), /INVALID_ARGUMENT/);
});

// --- ② 순수 로직 --------------------------------------------------------------

test('validatePostPayload: 정상 single/thread', () => {
  assert.equal(mod.validatePostPayload(basePayload).length, 1);
  assert.equal(mod.validatePostPayload({ ...basePayload, format: 'thread', body: 'a\n\n=== POST ===\n\nb' }).length, 2);
});

test('validatePostPayload: 거부 사례', () => {
  assert.throws(() => mod.validatePostPayload({ ...basePayload, platform: 'instagram' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, format: 'single', body: 'a\n\n=== POST ===\n\nb' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, media: [{ path: 'rel/plot.png', alt: '' }] }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, visibility: 'secret' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, extra: 1 }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, identity: '' }), /INVALID_PAYLOAD/);
});

test('postTimeoutMs: 세그먼트 수에 비례, 상한 570s', () => {
  assert.equal(mod.postTimeoutMs(1), 150000);
  assert.equal(mod.postTimeoutMs(3), 270000);
  assert.equal(mod.postTimeoutMs(25), 570000);
});

test('validateScanPayload: timezone 범위와 cursor를 엄격히 검증한다', () => {
  const payload = { platform: 'x', since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00+00:00', cursor: null };
  assert.deepEqual(mod.validateScanPayload(payload), payload);
  assert.throws(() => mod.validateScanPayload({ ...payload, since: '2026-11-15T00:00:00Z', until: '2026-11-14T00:00:00Z' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validateScanPayload({ ...payload, since: '2026-11-14' }), /INVALID_PAYLOAD/);
});

test('compareCandidates: URL/정규화 본문 일치는 duplicate, 유사 본문은 needs_review다', () => {
  const candidate = { id: 'source', url: 'https://x.com/me/1', text: '발행 파이프라인의 실패를 줄였습니다' };
  assert.equal(mod.compareCandidates({ candidate, existing: [{ id: 'url', url: candidate.url, text: '다른 본문' }] }).decision, 'duplicate');
  assert.equal(mod.compareCandidates({ candidate, existing: [{ id: 'similar', url: 'https://bsky.app/a', text: '발행 파이프라인 실패를 줄였습니다' }] }).decision, 'needs_review');
  assert.equal(mod.compareCandidates({ candidate, existing: [{ id: 'other', url: 'https://bsky.app/b', text: '전혀 다른 소식' }] }).decision, 'new');
});

test('CLI scan: bound identity와 관찰 범위를 보존하고 완료를 가장하지 않는다', () => {
  writeBinding(bindingFor(fakeEgo('scan', '{"status":"BOOTSTRAP_OBSERVED","posts":[{"text":"최근 글","url":"https://x.com/me/1","time":"2026-11-14T12:00:00Z"}]}')));
  const r = runCli(['scan'], JSON.stringify({ platform: 'x', since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null }));
  assert.equal(r.status, 0, r.stderr);
  const out = cliJson(r);
  assert.equal(out.status, 'SCAN_DONE');
  assert.equal(out.identity, 'me');
  assert.equal(out.candidates.length, 1);
  assert.equal(out.coverage.complete, false);
});

test('discoverExecutable: SOCIAL_EGO_EXECUTABLE 절대경로 우선', () => {
  assert.equal(mod.discoverExecutable({ SOCIAL_EGO_EXECUTABLE: '/opt/ego/ego-browser' }), '/opt/ego/ego-browser');
  assert.equal(mod.discoverExecutable({ SOCIAL_EGO_EXECUTABLE: 'relative/path' }), null);
});

// --- ③ CLI end-to-end (가짜 실행파일) ----------------------------------------

test('CLI post: POSTED → exit 0, JSON 1줄', () => {
  writeBinding(bindingFor(fakeEgo('posted', '{"status":"POSTED","urls":["https://x.com/me/1"],"urlRecovered":true,"identity":"me"}')));
  const r = runCli(['post'], JSON.stringify(basePayload));
  assert.equal(r.status, 0, r.stderr);
  const out = cliJson(r);
  assert.equal(out.status, 'POSTED');
  assert.deepEqual(out.urls, ['https://x.com/me/1']);
});

test('CLI post: POSTED + URL 회수 실패 → 여전히 exit 0 (게시는 성립, 재시도 유입 차단)', () => {
  writeBinding(bindingFor(fakeEgo('no-url', '{"status":"POSTED","urls":[],"urlRecovered":false,"identity":"me"}')));
  const r = runCli(['post'], JSON.stringify(basePayload));
  assert.equal(r.status, 0);
  assert.equal(cliJson(r).urlRecovered, false);
});

test('CLI post: PARTIAL_POSTED → exit 1 (부분 게시는 실패)', () => {
  writeBinding(bindingFor(fakeEgo('partial', '{"status":"PARTIAL_POSTED","urls":["https://x.com/me/1"],"postedCount":1,"reason":"EGO_EVIDENCE_MISSING"}')));
  const r = runCli(['post'], JSON.stringify({ ...basePayload, format: 'thread', body: 'a\n\n=== POST ===\n\nb' }));
  assert.equal(r.status, 1);
  assert.equal(cliJson(r).status, 'PARTIAL_POSTED');
});

test('CLI post: 자식 단계 실패(EGO_NEEDS_LOGIN) → POST_FAILED exit 1', () => {
  writeBinding(bindingFor(fakeEgo('login', '{"status":"EGO_NEEDS_LOGIN"}')));
  const r = runCli(['post'], JSON.stringify(basePayload));
  assert.equal(r.status, 1);
  assert.equal(cliJson(r).reason, 'EGO_NEEDS_LOGIN');
});

test('CLI post: binding 신원과 payload 신원 불일치 → 실행파일 호출 없이 EGO_ACCOUNT_MISMATCH', () => {
  const exe = fakeEgo('never', '{"status":"POSTED","urls":[],"urlRecovered":false,"identity":"me"}');
  writeBinding(bindingFor(exe));
  const r = runCli(['post'], JSON.stringify({ ...basePayload, identity: 'someone-else' }));
  assert.equal(r.status, 1);
  assert.equal(cliJson(r).reason, 'EGO_ACCOUNT_MISMATCH');
});

test('CLI post: binding 없음 → EGO_NOT_BOUND', () => {
  rmSync(join(stateDir, 'binding.json'), { force: true });
  const r = runCli(['post'], JSON.stringify(basePayload));
  assert.equal(r.status, 1);
  assert.equal(cliJson(r).reason, 'EGO_NOT_BOUND');
});

test('CLI post: 잘못된 페이로드 → INVALID_PAYLOAD exit 1', () => {
  writeBinding(bindingFor(fakeEgo('posted', '{"status":"POSTED","urls":[],"urlRecovered":false,"identity":"me"}')));
  const r = runCli(['post'], JSON.stringify({ platform: 'x' }));
  assert.equal(r.status, 1);
  assert.equal(cliJson(r).reason, 'INVALID_PAYLOAD');
});

test('CLI setup: 신원 획득 → binding 저장, 재실행은 cached (실행파일 재호출 없음)', () => {
  const exe = fakeEgo('identity', `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' '0.6.3.14-test'; exit 0; fi
echo "call" >>'${join(work, 'setup-calls.log').replace(/'/g, `'\\''`)}'
cat >/dev/null
printf '%s\\n' '{"status":"IDENTITY_ACQUIRED","identity":"me"}'
`);
  rmSync(join(stateDir, 'binding.json'), { force: true });
  // binding이 없을 때 setup은 discoverExecutable로 간다 — 가짜 실행파일을 환경으로 지정
  const r1 = runCli(['setup', '--platform', 'x'], '', { SOCIAL_EGO_EXECUTABLE: exe });
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(cliJson(r1).identity, 'me');
  const saved = JSON.parse(readFileSync(join(stateDir, 'binding.json'), 'utf8'));
  assert.equal(saved.transport, 'ego-post/1');
  assert.equal(saved.identity.x, 'me');
  assert.equal(saved.executable, exe);
  const r2 = runCli(['setup', '--platform', 'x']);
  assert.equal(cliJson(r2).cached, true);
  assert.equal(readFileSync(join(work, 'setup-calls.log'), 'utf8').trim().split('\n').length, 1, 'cached 실행은 ego를 호출하지 않는다');
});

test('CLI readback: READBACK_DONE 결과 전달', () => {
  writeBinding(bindingFor(fakeEgo('readback', '{"status":"READBACK_DONE","results":[{"url":"https://x.com/me/1","matched":true}],"matched":true}')));
  const r = runCli(['readback'], JSON.stringify({ urls: ['https://x.com/me/1'], bodies: ['게시 본문'] }));
  assert.equal(r.status, 0);
  assert.equal(cliJson(r).matched, true);
});

test('CLI readback: URL과 본문 배열 길이가 다르면 INVALID_PAYLOAD', () => {
  writeBinding(bindingFor(fakeEgo('readback-count', '{"status":"READBACK_DONE","results":[],"matched":true}')));
  for (const bodies of [[], ['하나', '둘']]) {
    const r = runCli(['readback'], JSON.stringify({ urls: ['https://x.com/me/status/1'], bodies }));
    assert.equal(r.status, 1);
    assert.equal(cliJson(r).reason, 'INVALID_PAYLOAD');
  }
});

test('CLI readback: 페이로드 스키마 위반 → INVALID_PAYLOAD', () => {
  writeBinding(bindingFor(fakeEgo('readback', '{"status":"READBACK_DONE","results":[],"matched":true}')));
  const r = runCli(['readback'], JSON.stringify({ urls: [] }));
  assert.equal(r.status, 1);
  assert.equal(cliJson(r).reason, 'INVALID_PAYLOAD');
});

// --- ④ 고정 스크립트 무결성 (금지 API·소스 스캔) ---------------------------

test('소스에 ego 소유·양도 API가 없다 (사용자 스페이스 보호)', () => {
  // ego-ui.mjs와 같은 금지 목록. 메서드 호출 형태(.finish())만 본다 — 모듈 안의
  // 부모 측 내부 헬퍼 finish(…)와 구분하기 위해서다.
  assert.equal(/claimTaskSpace|takeOverTaskSpace|listTaskSpaces|handOff/.test(source), false);
  assert.equal(/\.finish\s*\(/.test(source), false);
});

test('고정 스크립트는 데이터 주입만 받는다 — spawn 인자는 정확히 nodejs 1개', () => {
  assert.equal(/spawn\(executable, \['nodejs'\]/.test(source), true);
});

test('POST_STEP_CODES·EGO_FAILURE_REASONS 열거 일관성', () => {
  assert.equal(mod.POST_STEP_CODES.includes('EGO_ACCOUNT_MISMATCH'), true);
  assert.equal(mod.POST_STEP_CODES.includes('EGO_MEDIA_FAILED'), true);
  assert.equal(mod.EGO_FAILURE_REASONS.includes('EGO_TIMEOUT'), true);
  assert.equal(new Set(mod.POST_STEP_CODES).size, mod.POST_STEP_CODES.length, '단계 코드 중복 없음');
});

test('CLI post: 자식 프로세스 응답을 잃으면 POST_UNKNOWN이며 재게시를 단정하지 않는다', () => {
  writeBinding(bindingFor(fakeEgo('lost-response', '#!/bin/sh\ncat >/dev/null\nexit 3\n')));
  const r = runCli(['post'], JSON.stringify(basePayload));
  assert.equal(r.status, 1);
  assert.deepEqual(cliJson(r), { status: 'POST_UNKNOWN', urls: [], postedCount: 0, reason: 'EGO_CONNECT_FAILED' });
});

test('CLI post: 잘못된 게시 결과 스키마는 안전 재시도 가능한 실패가 아닌 POST_UNKNOWN', () => {
  writeBinding(bindingFor(fakeEgo('bad-result', '{"status":"POSTED","urls":[]}')));
  const r = runCli(['post'], JSON.stringify(basePayload));
  assert.equal(r.status, 1);
  assert.equal(cliJson(r).status, 'POST_UNKNOWN');
});

test('validatePostPayload: alt는 문자열이어야 하고 Bluesky는 비어 있을 수 없다', () => {
  for (const alt of [null, {}, 12]) assert.throws(() => mod.validatePostPayload({ ...basePayload, media: [{ path: '/tmp/image.png', alt }] }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, platform: 'bluesky', media: [{ path: '/tmp/image.png', alt: '' }] }), /INVALID_PAYLOAD/);
});

// 정리
test.after?.(() => rmSync(work, { recursive: true, force: true }));
process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }); } catch {} });
