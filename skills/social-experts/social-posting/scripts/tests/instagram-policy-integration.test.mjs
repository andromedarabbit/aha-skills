// 승인 훅부터 실제 ego-post 부모까지 연결하고 브라우저 실행파일만 대체한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const uvCache = process.env.UV_CACHE_DIR || join(homedir(), '.cache', 'uv');
const digest = value => createHash('sha256').update(value).digest('hex');

function fixture(t, visibility) {
  const root = mkdtempSync(join(tmpdir(), 'instagram-policy-integration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const job = join(root, 'job');
  const home = join(root, 'home');
  const temp = join(root, 'tmp');
  const state = join(root, 'state');
  for (const path of [join(job, 'drafts'), home, temp, state]) mkdirSync(path, { recursive: true });
  const photo = join(job, 'photo.png');
  writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=', 'base64'));
  const draft = join(job, 'drafts/instagram.md');
  writeFileSync(draft, `---\nplatform: instagram\nformat: single\n${visibility ? `visibility: ${visibility}\n` : ''}media:\n  - path: ./photo.png\n    alt: 합성 사진 설명\n    sha256: ${digest(readFileSync(photo))}\n---\n통합 테스트 캡션\n`);
  const jobState = join(job, 'job-state.md');
  writeFileSync(jobState, '---\nstage: 8\nplatforms: [instagram, x]\naccounts: {instagram: photo-owner, x: other-owner}\nsource: {type: topic, topic: synthetic}\n---\n');
  const receipt = join(job, 'receipt.json');
  const calls = join(root, 'ego-calls.jsonl');
  const executable = join(root, 'fake-ego.cjs');
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const script = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), script }) + '\\n');
console.log(JSON.stringify({ status: 'POSTED', urls: ['https://www.instagram.com/p/offline_test/'], urlRecovered: true, identity: 'photo-owner' }));
`);
  chmodSync(executable, 0o755);
  writeFileSync(join(state, 'binding.json'), JSON.stringify({
    transport: 'ego-post/1', executable, taskSpaceName: 'social-posting-skill',
    egoVersion: '0.6.3.14-test', identity: { instagram: 'photo-owner' },
  }));
  const env = {
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: home, TMPDIR: temp,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    UV_CACHE_DIR: uvCache, UV_OFFLINE: '1', UV_PYTHON_DOWNLOADS: 'never',
    UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR || join(homedir(), '.local/share/uv/python'),
    SOCIAL_EGO_STATE_DIR: state, SOCIAL_POSTING_JOB: job, NO_COLOR: '1',
  };
  function run(script, args = [], input = '') {
    const result = spawnSync('bash', [join(scripts, script), ...args], {
      cwd: root, env, input, encoding: 'utf8', timeout: 60000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stdout + result.stderr);
    return result;
  }
  return {
    photo, draft, jobState, receipt,
    calls: () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
    hook(answer = '게시') {
      const question = [
        '게시 대상: instagram', '계정: photo-owner', '캡션: 통합 테스트 캡션',
        `사진 1: photo.png, alt: 합성 사진 설명, sha256: ${digest(readFileSync(photo))}`,
        `공개 범위: ${visibility ?? 'private'}`,
      ].join('\n');
      const event = {
        hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ header: '게시 승인', question, options: [
          { label: '게시', description: '표시한 Instagram 초안 게시' },
          { label: '수정', description: '초안 수정' },
          { label: '취소', description: '게시 취소' },
        ], multiSelect: false }] },
        tool_response: { answers: { [question]: answer } },
      };
      const result = run('record-approval.sh', [], JSON.stringify(event));
      assert.equal(result.status, 0, result.stdout + result.stderr);
    },
    publish: () => run('publish.sh', ['--job', job, '--platform', 'instagram']),
  };
}

function approved(f) {
  f.hook();
  assert.ok(existsSync(f.receipt), '실제 훅이 public 승인 영수증을 생성해야 한다');
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
  assert.equal(receipt.approved_via, 'posttooluse-hook');
  assert.equal(receipt.approved_digests.instagram, digest(readFileSync(f.draft)));
  assert.equal(receipt.approved_accounts, '{instagram: photo-owner, x: other-owner}');
  assert.ok(Number.isFinite(Date.parse(receipt.approved_at)));
  assert.deepEqual(f.calls(), []);
  return readFileSync(f.receipt, 'utf8');
}

function posted(f, authorization, requested) {
  const result = f.publish();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout.split('\n').find(line => line.startsWith('{')));
  assert.equal(output.status, 'POSTED');
  assert.equal(output.identity, 'photo-owner');
  assert.equal(output.audience.authorization, authorization, 'fake ego가 아닌 실제 부모가 정책/승인 결과를 붙여야 한다');
  assert.equal(output.audience.requested, requested);
  const calls = f.calls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['nodejs']);
  assert.ok(calls[0].script.length > 0, 'fake ego는 실제 자식 스크립트 stdin을 끝까지 소비해야 한다');
  assert.ok(!calls[0].script.includes(JSON.stringify(f.photo)), '원본 사진 대신 동결 사본을 실행층에 전달해야 한다');
}

for (const visibility of [undefined, 'private']) {
  test(`훅→실제 부모: ${visibility ?? '생략'} private는 무승인 실행하고 사람 승인 영수증을 만들지 않는다`, t => {
    const f = fixture(t, visibility);
    assert.equal(existsSync(f.receipt), false);
    posted(f, 'policy', 'private');
    assert.equal(existsSync(f.receipt), false);
    f.hook();
    assert.equal(existsSync(f.receipt), false, 'private에 게시 답변을 보내도 가짜 사람 승인을 기록하면 안 된다');
  });
}

for (const answer of [undefined, '취소']) {
  test(`훅→실제 부모: public ${answer ?? '무승인'}은 fake ego 0회`, t => {
    const f = fixture(t, 'public');
    if (answer) f.hook(answer);
    const result = f.publish();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /승인 digest/);
    assert.equal(existsSync(f.receipt), false);
    assert.deepEqual(f.calls(), []);
  });
}

test('훅→receipt→publish→실제 부모: public은 AskUserQuestion 승인 뒤에만 실행한다', t => {
  const f = fixture(t, 'public');
  const before = approved(f);
  posted(f, 'human_approval', 'public');
  assert.equal(readFileSync(f.receipt, 'utf8'), before, '게시는 훅의 승인 영수증을 재작성하면 안 된다');
});

for (const change of ['photo', 'alt', 'accounts']) {
  test(`실제 훅 승인 후 ${change} 변조는 fake ego 전에 거부한다`, t => {
    const f = fixture(t, 'public');
    const before = approved(f);
    if (change === 'photo') writeFileSync(f.photo, 'changed synthetic bytes');
    if (change === 'alt') writeFileSync(f.draft, readFileSync(f.draft, 'utf8').replace('합성 사진 설명', '승인 뒤 다른 설명'));
    if (change === 'accounts') writeFileSync(f.jobState, readFileSync(f.jobState, 'utf8').replace('x: other-owner', 'x: changed-owner'));
    const result = f.publish();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, change === 'accounts' ? /승인 시점 계정 매핑/ : change === 'alt' ? /승인 digest/ : /하드 제약 위반/);
    assert.deepEqual(f.calls(), []);
    assert.equal(readFileSync(f.receipt, 'utf8'), before);
  });
}
