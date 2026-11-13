import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const skillDir = fileURLToPath(new URL('../..', import.meta.url));
const replyPath = join(skillDir, 'scripts/reply.mjs');
const header = 'LinkedIn 승인';
const sendRule = '수동 job이며 계정·대화·참여자·최신 메시지 fingerprint·본문 해시·job ID·session ID·일회 challenge에 결합된 미사용 승인 영수증이 일치할 때만 전송한다.';

function run(args) {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-replies-contract-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  for (const name of ['linkedin', 'linkedincli', 'security', 'osascript', 'aside', 'orca', 'curl']) {
    writeFileSync(join(bin, name), '#!/bin/sh\nprintf called > "$HOME/external-call"\nexit 93\n', { mode: 0o700 });
  }
  try {
    const result = spawnSync(process.execPath, [replyPath, ...args], {
      cwd: root,
      env: { HOME: home, PATH: bin },
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(readdirSync(home), [], '외부 CLI 호출이나 상태 파일 쓰기가 없어야 한다');
    return JSON.parse(result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const command of ['setup', 'prepare', 'send']) {
  test(`unattended ${command} is denied before side effects`, () => {
    const result = run(['--mode', 'unattended', command]);
    assert.equal(result.status, 'BLOCKED_UNATTENDED');
    assert.equal(result.mode, 'unattended');
    assert.equal(result.command, command);
  });
}

for (const mode of ['unattended', 'manual']) {
  test(`${mode} scan without binding is not an empty inbox`, () => {
    const result = run(['--mode', mode, 'scan']);
    assert.equal(result.status, 'NEEDS_SETUP');
    assert.equal(Object.hasOwn(result, 'candidates'), false);
    assert.equal(Object.hasOwn(result, 'complete'), false);
  });
}

for (const command of ['setup', 'prepare', 'send']) {
  test(`manual ${command} requires explicit request input`, () => {
    const result = run(['--mode', 'manual', command]);
    assert.equal(result.status, 'INVALID_ARGUMENT');
  });
}

for (const args of [[], ['scan'], ['--mode', 'auto', 'scan'], ['--mode', 'manual', 'publish'], ['--mode', 'manual', 'scan', 'send'], ['--mode', 'manual', 'scan', '--cookie', 'secret-test-marker']]) {
  test(`invalid arguments are rejected without echoing input: ${args.length}`, () => {
    const result = run(args);
    assert.equal(result.status, 'INVALID_ARGUMENT');
    assert.equal(JSON.stringify(result).includes('secret-test-marker'), false);
  });
}

function assertDocumentContract(text, contract) {
  assert.equal(contract.approvalHeader, header);
  assert.equal(contract.approvalChoice, '전송');
  assert.equal(contract.sendRule, sendRule);
  assert.ok(text.includes(`header는 \`${header}\``), '승인 header 계약이 달라졌다');
  assert.ok(text.includes(sendRule), '전송 가능 판정 문구가 달라졌다');
}

test('skill and runtime share exact approval and sending contracts', async () => {
  const { CONTRACT } = await import('../reply.mjs');
  const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  assertDocumentContract(skill, CONTRACT);
  assert.match(skill, /context: inline/);
  assert.match(skill, /node>=24/);
});

test('approval contract mutations are detected', async () => {
  const { CONTRACT } = await import('../reply.mjs');
  const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  assert.throws(() => assertDocumentContract(skill.replaceAll(header, '다른 승인'), CONTRACT));
  assert.throws(() => assertDocumentContract(skill.replace(sendRule, '항상 전송한다.'), CONTRACT));
  assert.throws(() => assertDocumentContract(skill, { ...CONTRACT, approvalHeader: '다른 승인' }));
  assert.throws(() => assertDocumentContract(skill, { ...CONTRACT, sendRule: '항상 전송한다.' }));
});

test('state path is a fixed convention, not a configurable input', async () => {
  const { STATE_DIR } = await import('../reply.mjs');
  assert.equal(STATE_DIR, join((await import('node:os')).homedir(), '.local/share/aha-skills/linkedin-replies'));
});

test('test entrypoint discovers node test files without bats', () => {
  const runner = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'run.sh'), 'utf8');
  assert.match(runner, /set -euo pipefail/);
  assert.match(runner, /node --test .*\/\*\.test\.mjs/);
  assert.equal(runner.includes('bats'), false);
});
