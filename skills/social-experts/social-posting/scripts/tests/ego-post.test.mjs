// ego-post.mjs — 프로세스·페이로드·부모 CLI 결과 계약 검증.
// ego-post-child.test.mjs는 실제로 전송된 자식 코드를 VM DOM에서 별도로 실행한다.
// 실제 플랫폼 셀렉터의 유효성은 브라우저 실측이 필요하다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ego-post.mjs');
const platformDir = join(dirname(SCRIPT), 'platforms');
const source = [SCRIPT, ...readdirSync(platformDir).filter(name => name.endsWith('.mjs')).map(name => join(platformDir, name))]
  .map(path => readFileSync(path, 'utf8')).join('\n');
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

test('validatePostPayload: Threads 단일·스레드 페이로드를 허용한다', () => {
  assert.equal(mod.validatePostPayload({ ...basePayload, platform: 'threads' }).length, 1);
  assert.equal(mod.validatePostPayload({ ...basePayload, platform: 'threads', format: 'thread', body: 'a\n=== POST ===\nb' }).length, 2);
});

test('validatePostPayload: 거부 사례', () => {
  assert.throws(() => mod.validatePostPayload({ ...basePayload, platform: 'instagram' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, format: 'single', body: 'a\n\n=== POST ===\n\nb' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, media: [{ path: 'rel/plot.png', alt: '' }] }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, visibility: 'secret' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, extra: 1 }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, identity: '' }), /INVALID_PAYLOAD/);
});

test('validatePostPayload: Instagram 사진 피드는 빈 캡션·1~20장·필수 alt를 지원한다', () => {
  const photo = { path: '/tmp/photo.png', alt: '사진 설명' };
  const payload = { ...basePayload, platform: 'instagram', visibility: 'private', body: '', media: [photo] };
  assert.deepEqual(mod.validatePostPayload(payload), ['']);
  for (const path of ['/tmp/photo.jpg', '/tmp/photo.JPEG', '/tmp/photo.webp']) {
    assert.equal(mod.validatePostPayload({ ...payload, media: [{ ...photo, path }] }).length, 1);
  }
  assert.equal(mod.validatePostPayload({ ...payload, media: Array(20).fill(photo) }).length, 1);
  for (const media of [[], Array(21).fill(photo), [{ ...photo, path: '/tmp/movie.mp4' }], [{ ...photo, path: '/tmp/animated.gif' }], [{ ...photo, alt: ' ' }], [{ ...photo, alt: 12 }]]) {
    assert.throws(() => mod.validatePostPayload({ ...payload, media }), /INVALID_PAYLOAD/);
  }
  for (const body of ['a\n=== POST ===\nb', '\n=== POST ===\n']) {
    assert.throws(() => mod.validatePostPayload({ ...payload, body }), /INVALID_PAYLOAD/);
  }
  assert.throws(() => mod.validatePostPayload({ ...payload, format: 'thread' }), /INVALID_PAYLOAD/);
  for (const platform of ['x', 'linkedin', 'facebook', 'bluesky', 'threads']) {
    assert.throws(() => mod.validatePostPayload({ ...payload, platform }), /INVALID_PAYLOAD/);
  }
});

test('validatePostPayload: Instagram 캡션은 링크·개행 포함 2200 codepoint 로컬 정책이다', () => {
  const payload = { ...basePayload, platform: 'instagram', visibility: 'private', media: [{ path: '/tmp/photo.png', alt: '사진 설명' }] };
  for (const body of ['가'.repeat(2200), '😊'.repeat(2200), 'é'.repeat(1100), 'a\nb' + 'x'.repeat(2197)]) {
    assert.equal(mod.validatePostPayload({ ...payload, body }).length, 1);
    assert.throws(() => mod.validatePostPayload({ ...payload, body: body + 'x' }), /INVALID_PAYLOAD/);
  }
  const link = 'https://example.com';
  const body = 'x'.repeat(2200 - 1 - link.length);
  assert.equal(mod.validatePostPayload({ ...payload, body, link }).length, 1);
  assert.throws(() => mod.validatePostPayload({ ...payload, body: body + 'x', link }), /INVALID_PAYLOAD/);
  assert.ok(mod.PLATFORMS.includes('instagram'));
  assert.deepEqual(mod.validateScanPayload({ platform: 'instagram', cursor: null, postUrl: 'https://www.instagram.com/p/photo_1/?tracking=1' }).postUrl, 'https://www.instagram.com/p/photo_1');
  assert.throws(() => mod.validateScanPayload({ platform: 'instagram', cursor: null, postUrl: 'https://www.instagram.com/reel/movie_1/' }), /INVALID_PAYLOAD/);
});

test('Instagram 입력의 생략 범위만 private이고 임의 범위/해시/승인 표식은 거부한다', () => {
  const payload = { ...basePayload, platform: 'instagram', visibility: 'private', media: [{ path: '/tmp/photo.png', alt: '설명' }] };
  const { visibility, ...withoutVisibility } = payload;
  assert.deepEqual(mod.validatePostPayload(withoutVisibility), ['게시 본문']);
  for (const value of ['keep', 'friends', '', null, false, ['private']]) assert.throws(() => mod.validatePostPayload({ ...payload, visibility: value }), /INVALID_PAYLOAD/);
  for (const sha256 of [null, false, ['a'.repeat(64)], 'A'.repeat(64), 'short']) assert.throws(() => mod.validatePostPayload({ ...payload, media: [{ ...payload.media[0], sha256 }] }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...payload, visibility: 'public' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...payload, verified: true }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validatePostPayload({ ...basePayload, visibility: 'private' }), /INVALID_PAYLOAD/);
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
  assert.throws(() => mod.validateScanPayload({ ...payload, until: payload.since }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validateScanPayload({ ...payload, cursor: 'unverified-resume' }), /INVALID_PAYLOAD/);
  assert.throws(() => mod.validateScanPayload({ platform: 'x', since: payload.since, cursor: null }), /INVALID_PAYLOAD/);
  for (const postUrl of ['https://attacker.test/me/status/1', 'https://x.com/home', 'https://me:secret@x.com/me/status/1', 'http://x.com/me/status/1']) {
    assert.throws(() => mod.validateScanPayload({ ...payload, postUrl }), /INVALID_PAYLOAD/);
  }
  assert.equal(mod.validateScanPayload({ ...payload, postUrl: 'https://x.com/author/status/42?tracking=1' }).postUrl, 'https://x.com/author/status/42');
});

test('compareCandidates: URL/정규화 본문 일치는 duplicate, 유사 본문은 needs_review다', () => {
  const candidate = { id: 'source', url: 'https://x.com/me/1', text: '발행 파이프라인의 실패를 줄였습니다' };
  assert.equal(mod.compareCandidates({ candidate, existing: [{ id: 'url', url: candidate.url, text: '다른 본문' }] }).decision, 'duplicate');
  assert.equal(mod.compareCandidates({ candidate, existing: [{ id: 'similar', url: 'https://bsky.app/a', text: '발행 파이프라인 실패를 줄였습니다' }] }).decision, 'needs_review');
  assert.equal(mod.compareCandidates({ candidate, existing: [{ id: 'other', url: 'https://bsky.app/b', text: '전혀 다른 소식' }] }).decision, 'new');
});

test('compareCandidates: 빈 정규화 본문은 다른 URL의 사진 글을 합치지 않는다', () => {
  for (const text of ['', '   ', '!!!']) {
    const candidate = { id: 'photo1', url: 'https://x.com/me/status/1', text };
    const existing = [{ id: 'photo2', url: 'https://bsky.app/profile/me/post/2', text }];
    assert.equal(mod.compareCandidates({ candidate, existing }).decision, 'new');
    assert.equal(mod.compareCandidates({ candidate, existing: [{ ...existing[0], url: candidate.url }] }).decision, 'duplicate');
  }
});

test('compareCandidates: scan 후보·확인된 parent 묶음·게시 기록과 coverage를 연결한다', () => {
  const candidate = { id: 'source', url: 'https://x.com/me/status/1', text: '첫 이야기 둘째 이야기 마지막 이야기', media: [], publishedAt: null, publisher: 'me' };
  const existing = [
    { id: 'b1', url: 'https://bsky.app/profile/me/post/1', text: '첫 이야기' },
    { id: 'b2', url: 'https://bsky.app/profile/me/post/2', text: '둘째 이야기', parentUrl: 'https://bsky.app/profile/me/post/1' },
    { id: 'b3', url: 'https://bsky.app/profile/me/post/3', text: '마지막 이야기', parentUrl: 'https://bsky.app/profile/me/post/2' },
  ];
  const coverage = { complete: false, stopReason: 'SCROLL_STALLED', unknownTimeCount: 1 };
  const payload = { candidate, existing, targetPlatform: 'bluesky', coverage };
  const result = mod.compareCandidates(payload);
  assert.equal(result.decision, 'needs_review');
  assert.deepEqual(result.coverage, coverage);
  assert.equal(result.absenceMeaning, 'NOT_FOUND_IN_OBSERVED_SCOPE');
  assert.ok(result.details.some(item => item.kind === 'reply_chain' && item.ids.join(',') === 'b1,b2,b3'));
  const logged = mod.compareCandidates({ ...payload, postLog: [{ sourceUrl: candidate.url, platform: 'bluesky', status: 'POSTED', urls: existing.map(item => item.url) }] });
  assert.equal(logged.decision, 'duplicate');
  assert.ok(logged.details.some(item => item.kind === 'posted_record'));
  for (const status of ['POST_UNKNOWN', 'PARTIAL_POSTED']) {
    const uncertain = mod.compareCandidates({ ...payload, existing: [], postLog: [{ sourceUrl: candidate.url, platform: 'bluesky', status, urls: [existing[0].url] }] });
    assert.equal(uncertain.decision, 'needs_review');
  }
  const unrelated = mod.compareCandidates({ ...payload, existing: existing.map(({ parentUrl, ...item }) => item) });
  assert.ok(!unrelated.details.some(item => item.kind === 'reply_chain'));
});

test('post: Threads는 바인딩 확인과 실행보다 먼저 명시적으로 차단한다', async () => {
  await assert.rejects(() => mod.post({ ...basePayload, platform: 'threads' }, { SOCIAL_EGO_STATE_DIR: join(work, 'unbound-threads') }), /THREADS_UNVERIFIED/);
});

function instagramJob(visibility = 'private', approved = false) {
  const job = mkdtempSync(join(work, 'instagram-job-'));
  mkdirSync(join(job, 'drafts'));
  const image = join(job, 'photo.png');
  writeFileSync(image, 'synthetic-photo');
  const sha256 = createHash('sha256').update(readFileSync(image)).digest('hex');
  const draft = `---\nplatform: instagram\nformat: single\nvisibility: ${visibility}\nmedia:\n  - path: ${JSON.stringify(image)}\n    alt: 사진 설명\n    sha256: ${sha256}\n---\n게시 본문\n`;
  writeFileSync(join(job, 'drafts/instagram.md'), draft);
  writeFileSync(join(job, 'job-state.md'), '---\nplatforms: [instagram, x]\naccounts: {instagram: me, x: me}\nsource: {type: topic, topic: test}\n---\n');
  if (approved) writeFileSync(join(job, 'receipt.json'), JSON.stringify({
    approved_digests: { instagram: createHash('sha256').update(draft).digest('hex') },
    approved_accounts: '{instagram: me, x: me}', approved_via: 'posttooluse-hook', approved_at: new Date().toISOString(), posted_x: 'https://x.com/me/status/1',
  }));
  return { job, image, payload: { ...basePayload, platform: 'instagram', visibility, media: [{ path: image, alt: '사진 설명', sha256 }] } };
}

test('직접 Instagram post는 현재 작업이 없으면 브라우저 전에 거부한다', () => {
  const { payload } = instagramJob();
  writeBinding(bindingFor(fakeEgo('instagram-no-job', '{"status":"POSTED","urls":[],"urlRecovered":false,"identity":"me"}'), { instagram: 'me' }));
  const result = runCli(['post'], JSON.stringify(payload), { SOCIAL_POSTING_JOB: '', TMPDIR: work });
  assert.equal(result.status, 1);
  assert.equal(cliJson(result).reason, 'INSTAGRAM_JOB_REQUIRED');
});

test('직접 private는 사람 영수증 없이 동결 사본을 전달하고 승인 키를 만들지 않는다', () => {
  const { job, image, payload } = instagramJob();
  const transmitted = join(work, 'instagram-private-source');
  writeBinding(bindingFor(fakeEgo('instagram-private', `#!/bin/sh
cat > '${transmitted}'
printf '%s\\n' '{"status":"POSTED","urls":[],"urlRecovered":false,"identity":"me"}'
`), { instagram: 'me' }));
  delete payload.visibility;
  const result = runCli(['post'], JSON.stringify(payload), { SOCIAL_POSTING_JOB: job });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(cliJson(result).audience.authorization, 'policy');
  assert.ok(!readFileSync(transmitted, 'utf8').includes(JSON.stringify(image)), '원본 대신 새 동결 사진 경로 전달');
  assert.throws(() => readFileSync(join(job, 'receipt.json')), { code: 'ENOENT' });
});

for (const approved of [false, true]) test(`직접 public은 실제 승인 대상과 같을 때만 실행한다: approved=${approved}`, () => {
  const { job, payload } = instagramJob('public', approved);
  const marker = join(job, 'called');
  writeBinding(bindingFor(fakeEgo('instagram-public', `#!/bin/sh
cat >/dev/null
printf called > '${marker}'
printf '%s\\n' '{"status":"POSTED","urls":[],"urlRecovered":false,"identity":"me"}'
`), { instagram: 'me' }));
  const result = runCli(['post'], JSON.stringify(payload), { SOCIAL_POSTING_JOB: job });
  assert.equal(result.status, approved ? 0 : 1, result.stdout + result.stderr);
  if (approved) assert.equal(cliJson(result).audience.authorization, 'human_approval');
  if (!approved) {
    assert.equal(cliJson(result).reason, 'INSTAGRAM_APPROVAL_REQUIRED');
    assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
  }
});

for (const change of ['caption', 'alt', 'bytes', 'accounts', 'visibility', 'approved-boolean', 'old-receipt']) test(`직접 public 승인 결합: ${change} 변경은 브라우저 0회`, () => {
  const { job, image, payload } = instagramJob('public', true);
  if (change === 'caption') payload.body += ' 변경';
  if (change === 'alt') payload.media[0].alt += ' 변경';
  if (change === 'bytes') writeFileSync(image, 'changed-photo');
  if (change === 'accounts') writeFileSync(join(job, 'job-state.md'), '---\nplatforms: [instagram, x]\naccounts: {instagram: me, x: other}\n---\n');
  if (change === 'visibility') payload.visibility = 'private';
  if (change === 'approved-boolean') payload.approved = true;
  if (change === 'old-receipt') writeFileSync(join(job, 'receipt.json'), '{}');
  const marker = join(job, 'called');
  writeBinding(bindingFor(fakeEgo('instagram-altered', `#!/bin/sh
cat >/dev/null
printf called > '${marker}'
printf '%s\\n' '{"status":"POSTED","urls":[],"urlRecovered":false,"identity":"me"}'
`), { instagram: 'me' }));
  const result = runCli(['post'], JSON.stringify(payload), { SOCIAL_POSTING_JOB: job });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
});

test('CLI scan: bound identity와 관찰 범위를 보존하고 완료를 가장하지 않는다', () => {
  writeBinding(bindingFor(fakeEgo('scan', '{"status":"BOOTSTRAP_OBSERVED","stopReason":"SCROLL_STALLED","posts":[{"text":"최근 글","url":"https://x.com/me/status/1","publisher":"me","media":[],"time":"2026-11-14T12:00:00Z"}]}')));
  const r = runCli(['scan'], JSON.stringify({ platform: 'x', since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null }));
  assert.equal(r.status, 0, r.stderr);
  const out = cliJson(r);
  assert.equal(out.status, 'SCAN_DONE');
  assert.equal(out.identity, 'me');
  assert.equal(out.candidates.length, 1);
  assert.equal(out.coverage.complete, false);
});

test('scan: 관찰한 이미지 URL·alt를 job manifest에만 보관한다', () => {
  const jobDir = join(work, 'scan-manifest');
  writeBinding(bindingFor(fakeEgo('scan-media', JSON.stringify({
    status: 'BOOTSTRAP_OBSERVED', stopReason: 'SCROLL_STALLED', posts: [{
      text: '사진 글', url: 'https://x.com/me/2', publisher: 'me', time: '2026-11-14T12:00:00Z',
      media: [{ sourceUrl: 'https://cdn.example.test/photo.png', alt: '사진 설명' }],
    }],
  }))));
  const r = runCli(['scan'], JSON.stringify({
    platform: 'x', since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null, jobDir,
  }));
  assert.equal(r.status, 0, r.stderr);
  const result = cliJson(r);
  assert.deepEqual(result.candidates[0].media, [{ id: '1', sourceUrl: 'https://cdn.example.test/photo.png', alt: '사진 설명' }]);
  const serialized = readFileSync(result.manifestPath, 'utf8');
  assert.equal(JSON.parse(serialized).candidates[0].publisher, 'me');
  assert.equal(result.manifestDigest, createHash('sha256').update(serialized).digest('hex'));
  assert.equal(result.manifestPath, join(result.jobDir, 'scan-manifest.json'));
});

test('fetchScannedMedia: scan 영수증에 바인딩한 사진만 로그인 브라우저로 내려받아 보관한다', async () => {
  const rootJobDir = join(work, 'media-fetch');
  const downloaded = join(work, 'fetched-image');
  const sourceUrl = 'https://cdn.example.test/photo.png';
  const env = { SOCIAL_EGO_STATE_DIR: stateDir, HOME: work };
  writeFileSync(downloaded, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=', 'base64'));
  const scanner = fakeEgo('scan-media-fetch', JSON.stringify({
    status: 'BOOTSTRAP_OBSERVED', stopReason: 'SCROLL_STALLED', posts: [{
      text: '사진 글', url: 'https://x.com/me/status/1', publisher: 'me', time: '2026-11-14T12:00:00Z',
      media: [{ sourceUrl, alt: null }],
    }],
  }));
  writeBinding(bindingFor(scanner));
  const { jobDir } = await mod.scan({
    platform: 'x', since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null, jobDir: rootJobDir,
  }, env);
  const fetcher = fakeEgo('fetch-media', `#!/bin/sh
script=$(cat)
printf '%s' "$script" | grep -q "redirect: 'error'" || exit 1
printf '%s' "$script" | grep -q "credentials: 'same-origin'" || exit 1
path=$(printf '%s' "$script" | sed -n 's/.*,[ ]*"\\([^" ]*\\/media\\/\\.fetch-[^" ]*\\)".*/\\1/p')
cp ${JSON.stringify(downloaded)} "$path"
printf '%s\\n' '{"status":"MEDIA_FETCHED","path":"'"$path"'","sourceUrl":"${sourceUrl}","finalUrl":"${sourceUrl}","contentType":"image/png"}'
`);
  writeBinding(bindingFor(fetcher));
  const original = readFileSync(join(jobDir, 'scan-manifest.json'), 'utf8');
  const manifestDigest = createHash('sha256').update(original).digest('hex');
  await assert.rejects(() => mod.fetchScannedMedia({ jobDir, platform: 'x', candidateId: 'https://x.com/me/status/1', sourceUrl }, env), /INVALID_MEDIA/);
  const [media] = await mod.fetchScannedMedia({ jobDir, platform: 'x', candidateId: 'https://x.com/me/status/1', sourceUrl,
    altOverride: { manifestDigest, mediaId: '1', alt: '설명' } }, env);
  assert.equal(media.provenance.sourcePostUrl, 'https://x.com/me/status/1');
  assert.equal(dirname(media.path), join(rootJobDir, 'media'));
  assert.equal(media.provenanceSha256, createHash('sha256').update(readFileSync(media.provenancePath)).digest('hex'));
  mkdirSync(join(rootJobDir, 'drafts'));
  writeFileSync(join(rootJobDir, 'drafts/x.md'), `---\nplatform: x\nformat: single\nmedia:\n  - path: ${JSON.stringify(media.path)}\n    alt: 설명\n    source: scan\n    sha256: ${media.sha256}\n    provenance: ${JSON.stringify(media.provenancePath)}\n    provenance_sha256: ${media.provenanceSha256}\n---\n원본 사진을 준비한 초안\n`);
  const checked = spawnSync('uv', ['run', '--script', join(dirname(SCRIPT), 'check-drafts.py'), rootJobDir, '--platform', 'x'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).media[0].path, media.path);
  const [described] = await mod.fetchScannedMedia({ jobDir, platform: 'x', candidateId: 'https://x.com/me/status/1', sourceUrl,
    altOverride: { manifestDigest, mediaId: '1', alt: '보완한 설명' } }, env);
  assert.equal(described.alt, '보완한 설명');
  assert.equal(readFileSync(join(jobDir, 'scan-manifest.json'), 'utf8'), original);
  for (const override of [{ manifestDigest: '0'.repeat(64), mediaId: '1', alt: '설명' }, { manifestDigest, mediaId: '2', alt: '다른 사진 설명' }]) {
    await assert.rejects(() => mod.fetchScannedMedia({ jobDir, platform: 'x', candidateId: 'https://x.com/me/status/1', sourceUrl, altOverride: override }, env), /INVALID_MEDIA/);
  }
  const redirected = fakeEgo('fetch-redirected', readFileSync(fetcher, 'utf8').replace(`"finalUrl":"${sourceUrl}"`, '"finalUrl":"https://other.example.test/photo.png"'));
  const selected = { jobDir, platform: 'x', candidateId: 'https://x.com/me/status/1', sourceUrl, altOverride: { manifestDigest, mediaId: '1', alt: '설명' } };
  writeBinding(bindingFor(redirected));
  await assert.rejects(() => mod.fetchScannedMedia(selected, env), /EGO_SCHEMA_INVALID/);
  writeBinding(bindingFor(fakeEgo('expired-media', '{"status":"EGO_MEDIA_FAILED"}')));
  await assert.rejects(() => mod.fetchScannedMedia(selected, env), /EGO_MEDIA_FAILED/);
  writeBinding(bindingFor(fetcher));
  writeFileSync(join(jobDir, 'scan-manifest.json'), JSON.stringify({
    platform: 'x', identity: 'me', candidates: [{
      id: 'attacker', url: 'https://x.com/me/status/2', publisher: 'me',
      media: [{ sourceUrl: 'http://127.0.0.1/private.png', alt: '설명' }],
    }],
  }));
  await assert.rejects(() => mod.fetchScannedMedia({
    jobDir, platform: 'x', candidateId: 'attacker', sourceUrl: 'http://127.0.0.1/private.png',
  }, env), /INVALID_MEDIA/);
});

test('fetchScannedMedia: 같은 URL의 두 번째 사진 ID를 선택하고 없는 ID·다른 URL·digest 변조는 거부한다', async () => {
  const sourceUrl = 'https://cdn.test/shared.png';
  const candidateId = 'https://x.com/author/status/1';
  const env = { SOCIAL_EGO_STATE_DIR: stateDir };
  writeBinding(bindingFor(fakeEgo('scan-shared-media', JSON.stringify({
    status: 'BOOTSTRAP_OBSERVED', stopReason: 'SCROLL_STALLED', posts: [{
      text: '동일 URL의 사진 두 장', url: candidateId, publisher: 'author', time: '2026-11-14T12:00:00Z',
      media: [{ sourceUrl, alt: '첫 사진 설명' }, { sourceUrl, alt: null }],
    }],
  }))));
  const observed = await mod.scan({ platform: 'x', since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null, jobDir: join(work, 'shared-media-id') }, env);
  assert.deepEqual(observed.candidates[0].media.map(item => item.id), ['1', '2']);
  const fetcher = fakeEgo('fetch-shared-media', `#!${process.execPath}
const fs = require('node:fs');
const script = fs.readFileSync(0, 'utf8');
const destination = script.match(/"([^"\\n]*\\/media\\/\\.fetch-[^"\\n]*)"/)[1];
fs.writeFileSync(destination, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=', 'base64'));
console.log(JSON.stringify({ status: 'MEDIA_FETCHED', path: destination, sourceUrl: ${JSON.stringify(sourceUrl)}, finalUrl: ${JSON.stringify(sourceUrl)}, contentType: 'image/png' }));
`);
  writeBinding(bindingFor(fetcher));
  const payload = { jobDir: observed.jobDir, platform: 'x', candidateId, sourceUrl,
    altOverride: { manifestDigest: observed.manifestDigest, mediaId: '2', alt: '둘째 사진 보완 설명' } };
  const [second] = await mod.fetchScannedMedia(payload, env);
  assert.equal(second.alt, '둘째 사진 보완 설명');
  await assert.rejects(() => mod.fetchScannedMedia({ jobDir: observed.jobDir, platform: 'x', candidateId, sourceUrl }, env), /INVALID_MEDIA/);
  for (const invalid of [
    { ...payload, altOverride: { ...payload.altOverride, mediaId: '3' } },
    { ...payload, sourceUrl: 'https://cdn.test/not-observed.png' },
    { ...payload, altOverride: { ...payload.altOverride, manifestDigest: '0'.repeat(64) } },
  ]) await assert.rejects(() => mod.fetchScannedMedia(invalid, env), /INVALID_MEDIA/);
  assert.equal(createHash('sha256').update(readFileSync(observed.manifestPath)).digest('hex'), observed.manifestDigest);
});

test('fetchScannedMedia: 기존 alt가 다른 중복 URL은 실행 전에 거부하고 digest와 사진 ID로 선택한다', async () => {
  const sourceUrl = 'https://cdn.test/duplicate.png';
  const candidateId = 'https://x.com/author/status/2';
  const env = { SOCIAL_EGO_STATE_DIR: stateDir };
  writeBinding(bindingFor(fakeEgo('scan-ambiguous-alt', JSON.stringify({
    status: 'BOOTSTRAP_OBSERVED', stopReason: 'SCROLL_STALLED', posts: [{
      text: '서로 다른 사진 설명', url: candidateId, publisher: 'author', time: '2026-11-14T12:00:00Z',
      media: [{ sourceUrl, alt: '첫 사진 설명' }, { sourceUrl, alt: '둘째 사진 설명' }],
    }],
  }))));
  const observed = await mod.scan({ platform: 'x', cursor: null, since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', jobDir: join(work, 'ambiguous-alt') }, env);
  const calls = join(work, 'ambiguous-fetch-calls');
  const fetcher = fakeEgo('fetch-ambiguous-alt', `#!${process.execPath}
const fs = require('node:fs');
const script = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(calls)}, 'fetch\\n');
const destination = script.match(/"([^"\\n]*\\/media\\/\\.fetch-[^"\\n]*)"/)[1];
fs.writeFileSync(destination, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=', 'base64'));
console.log(JSON.stringify({ status: 'MEDIA_FETCHED', path: destination, sourceUrl: ${JSON.stringify(sourceUrl)}, finalUrl: ${JSON.stringify(sourceUrl)}, contentType: 'image/png' }));
`);
  writeBinding(bindingFor(fetcher));
  const payload = { jobDir: observed.jobDir, platform: 'x', candidateId, sourceUrl };
  await assert.rejects(() => mod.fetchScannedMedia(payload, env), /INVALID_MEDIA/);
  assert.throws(() => readFileSync(calls), { code: 'ENOENT' });
  const [selected] = await mod.fetchScannedMedia({ ...payload,
    altOverride: { manifestDigest: observed.manifestDigest, mediaId: '2', alt: '둘째 사진 설명' } }, env);
  assert.equal(selected.alt, '둘째 사진 설명');
  assert.equal(selected.provenance.publisher, 'author');
  assert.equal(readFileSync(calls, 'utf8'), 'fetch\n');
  assert.equal(createHash('sha256').update(readFileSync(observed.manifestPath)).digest('hex'), observed.manifestDigest);
});

test('scan: 기간 경계·시간 미상·실제 게시자를 분리하고 기본 24시간을 고정한다', async () => {
  writeBinding(bindingFor(fakeEgo('scan-boundaries', JSON.stringify({ status: 'BOOTSTRAP_OBSERVED', stopReason: 'SCROLL_STALLED', posts: [
    { text: '시작', url: 'https://x.com/other/status/1', publisher: 'other', media: [{ sourceUrl: 'https://cdn.test/photo.png', alt: null }], parentUrl: 'https://x.com/other/status/0', time: '2026-11-14T09:00:00+09:00' },
    { text: '시작 직전', url: 'https://x.com/other/status/before-start', publisher: 'other', media: [], time: '2026-11-13T23:59:59.999Z' },
    { text: '시작 직후', url: 'https://x.com/other/status/after-start', publisher: 'other', media: [], time: '2026-11-14T00:00:00.001Z' },
    { text: '끝 직전', url: 'https://x.com/other/status/before-end', publisher: 'other', media: [], time: '2026-11-14T23:59:59.999Z' },
    { text: '끝', url: 'https://x.com/other/status/2', publisher: 'other', media: [], time: '2026-11-15T00:00:00Z' },
    { text: '끝 직후', url: 'https://x.com/other/status/after-end', publisher: 'other', media: [], time: '2026-11-15T00:00:00.001Z' },
    { text: '미상', url: 'https://x.com/other/status/3', publisher: 'other', media: [], time: null },
  ] }))));
  const env = { SOCIAL_EGO_STATE_DIR: stateDir };
  const out = await mod.scan({ platform: 'x', since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null }, env);
  assert.deepEqual(out.candidates.map(post => post.text), ['시작', '시작 직후', '끝 직전']);
  assert.equal(out.candidates[0].publisher, 'other');
  assert.equal(out.candidates[0].parentUrl, 'https://x.com/other/status/0');
  assert.equal(out.candidates[0].media[0].alt, null);
  assert.equal(out.review[0].reason, 'UNKNOWN_TIME');
  assert.equal(out.review[0].parentUrl, undefined);
  const defaults = await mod.scan({ platform: 'x', cursor: null }, env);
  assert.equal(Date.parse(defaults.coverage.requestedUntil) - Date.parse(defaults.coverage.requestedSince), 86400000);
  assert.ok(Math.abs(Date.parse(defaults.coverage.referenceTime) - Date.now()) < 5000);
  assert.equal(defaults.coverage.timezone, 'UTC');
});

test('scan: 플랫폼별 manifest와 사진 provenance는 실행·플랫폼 경로별로 보존된다', async () => {
  const identities = { x: 'me', facebook: 'me', bluesky: 'me', threads: 'me', instagram: 'me' };
  const env = { SOCIAL_EGO_STATE_DIR: stateDir };
  const paths = [];
  const rootJobDir = join(work, 'shared-job');
  for (const platform of Object.keys(identities)) {
    const jobDir = rootJobDir;
    writeBinding(bindingFor(fakeEgo(`scan-${platform}`, JSON.stringify({ status: 'BOOTSTRAP_OBSERVED', stopReason: 'SCROLL_STALLED', posts: [{ text: platform, url: `https://example.test/${platform}`, publisher: 'actual', time: '2026-11-14T12:00:00Z', media: [{ sourceUrl: `https://cdn.test/${platform}.jpg`, alt: '사진' }] }] })), identities));
    const result = await mod.scan({ platform, since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null, jobDir }, env);
    assert.ok(result.jobDir.startsWith(join(rootJobDir, 'scans') + '/'));
    assert.ok(result.jobDir.endsWith('/' + platform));
    paths.push(result.jobDir);
  }
  for (const [i, platform] of Object.keys(identities).entries()) {
    const manifest = JSON.parse(readFileSync(join(paths[i], 'scan-manifest.json'), 'utf8'));
    assert.equal(manifest.platform, platform);
    assert.equal(manifest.candidates[0].media[0].sourceUrl, `https://cdn.test/${platform}.jpg`);
    const sourceUrl = `https://cdn.test/${platform}.jpg`;
    const fetcher = fakeEgo(`fetch-saved-${platform}`, `#!${process.execPath}
const fs = require('node:fs');
const script = fs.readFileSync(0, 'utf8');
const destination = script.match(/"([^"\\n]*\\/media\\/\\.fetch-[^"\\n]*)"/)[1];
fs.writeFileSync(destination, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=', 'base64'));
console.log(JSON.stringify({ status: 'MEDIA_FETCHED', path: destination, sourceUrl: ${JSON.stringify(sourceUrl)}, finalUrl: ${JSON.stringify(sourceUrl)}, contentType: 'image/png' }));
`);
    writeBinding(bindingFor(fetcher, identities));
    const [media] = await mod.fetchScannedMedia({ jobDir: paths[i], platform, candidateId: manifest.candidates[0].id, sourceUrl }, env);
    assert.equal(media.provenance.sourcePostUrl, `https://example.test/${platform}`);
  }
  assert.equal(new Set(paths).size, 5);
  assert.throws(() => mod.validateScanPayload({ platform: 'x', cursor: null, jobDir: 'relative-job' }), /INVALID_PAYLOAD/);
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
