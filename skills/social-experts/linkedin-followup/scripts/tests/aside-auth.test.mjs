import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  resolveCookieDatabase, readCookieSnapshot, decryptCookies, cliEnvironment,
  runKeychainHelper, runAuthenticatedRequest,
} from '../aside-auth.mjs';

const PASSWORD = 'synthetic-SAFE-STORAGE-MARKER';
const LI_AT = 'synthetic-LI-AT-MARKER';
const JSESSIONID = '"ajax:synthetic-JSESSIONID-MARKER"';
const FUTURE = (BigInt(Date.now()) + 86400000n + 11644473600000n) * 1000n;
const modulePath = fileURLToPath(new URL('../aside-auth.mjs', import.meta.url));

function encrypted(value, { version = 24, prefix = 'v10', host = '.linkedin.com', digestHost = host, padding = true } = {}) {
  const key = pbkdf2Sync(PASSWORD, 'saltysalt', 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
  cipher.setAutoPadding(padding);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const plain = version >= 24 ? Buffer.concat([createHash('sha256').update(digestHost).digest(), bytes]) : bytes;
  return Buffer.concat([Buffer.from(prefix), cipher.update(plain), cipher.final()]);
}

function fixture(t, { version = 24, rows, wal = false } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'linkedin-auth-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const profile = join(home, 'Library/Application Support/Aside/Profile 1');
  mkdirSync(join(profile, 'Network'), { recursive: true });
  const path = join(profile, 'Network/Cookies');
  const db = new DatabaseSync(path);
  if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  db.exec(`CREATE TABLE meta(key TEXT, value TEXT);
    CREATE TABLE cookies(host_key TEXT, name TEXT, path TEXT, expires_utc INTEGER,
      has_expires INTEGER, top_frame_site_key TEXT, has_cross_site_ancestor INTEGER,
      value TEXT, encrypted_value BLOB);`);
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('version', String(version));
  const input = rows ?? [
    { name: 'li_at', encrypted_value: encrypted(LI_AT, { version }) },
    { name: 'JSESSIONID', encrypted_value: encrypted(JSESSIONID, { version, prefix: 'v11' }) },
  ];
  const insert = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of input) insert.run(row.host_key ?? '.linkedin.com', row.name, row.path ?? '/', row.expires_utc ?? FUTURE,
    row.has_expires ?? 1, row.top_frame_site_key ?? '', row.has_cross_site_ancestor ?? 1, row.value ?? '', row.encrypted_value);
  if (!wal) db.close();
  else t.after(() => db.close());
  return { home, profile, path, db: wal ? db : null };
}

const errorCode = code => error => error?.code === code && !String(error).includes(PASSWORD);

for (const version of [23, 24]) {
  for (const ancestor of [0, 1]) {
    test(`합성 DB ${version}: 빈 partition key·ancestor ${ancestor}의 v10/v11 복호화와 host digest`, t => {
      const f = fixture(t, { version, rows: [
        { name: 'li_at', has_cross_site_ancestor: ancestor, encrypted_value: encrypted(LI_AT, { version }) },
        { name: 'JSESSIONID', has_cross_site_ancestor: ancestor, encrypted_value: encrypted(JSESSIONID, { version, prefix: 'v11' }) },
      ] });
      const snapshot = readCookieSnapshot(resolveCookieDatabase('Profile 1', f.home));
      assert.equal(snapshot.version, version);
      assert.deepEqual(decryptCookies(snapshot, Buffer.from(PASSWORD)), { li_at: LI_AT, JSESSIONID });
    });
  }
}

for (const partitioned of [0, 1, 2, null]) {
  test(`is_partitioned ${partitioned}는 정확히 0일 때만 허용한다`, t => {
    const f = fixture(t);
    const db = new DatabaseSync(f.path);
    try {
      db.exec('ALTER TABLE cookies ADD COLUMN is_partitioned INTEGER');
      db.prepare('UPDATE cookies SET is_partitioned = ?').run(partitioned);
    } finally {
      db.close();
    }
    if (partitioned === 0) {
      assert.equal(readCookieSnapshot(f.path).rows.length, 2);
      return;
    }
    assert.throws(() => readCookieSnapshot(f.path), errorCode('NEEDS_AUTH'));
  });
}

test('유사 도메인은 선택하지 않고 필요한 쿠키가 없으면 중단한다', t => {
  const f = fixture(t, { rows: [
    { name: 'li_at', host_key: 'evil-linkedin.com', encrypted_value: encrypted(LI_AT) },
    { name: 'JSESSIONID', host_key: 'linkedin.com.evil.test', encrypted_value: encrypted(JSESSIONID) },
  ] });
  assert.throws(() => readCookieSnapshot(f.path), errorCode('NEEDS_AUTH'));
});

for (const [label, row] of [
  ['중복', { name: 'li_at' }],
  ['partition', { name: 'li_at', top_frame_site_key: 'https://example.test', has_cross_site_ancestor: 0 }],
  ['cross-site partition', { name: 'li_at', top_frame_site_key: 'https://example.test', has_cross_site_ancestor: 1 }],
  ['만료', { name: 'li_at', expires_utc: 1n }],
  ['경로 모호성', { name: 'li_at', path: '/other' }],
  ['평문 저장', { name: 'li_at', value: 'plaintext-not-allowed' }],
]) {
  test(`${label} 쿠키는 추측하지 않는다`, t => {
    const base = [
      { name: 'li_at', encrypted_value: encrypted(LI_AT) },
      { name: 'JSESSIONID', encrypted_value: encrypted(JSESSIONID) },
    ];
    if (label === '중복') base.push({ ...row, encrypted_value: encrypted(LI_AT) });
    else base[0] = { ...base[0], ...row };
    const f = fixture(t, { rows: base });
    assert.throws(() => readCookieSnapshot(f.path), errorCode('NEEDS_AUTH'));
  });
}

test('세션 쿠키는 만료 flag와 일치할 때만 허용한다', t => {
  const f = fixture(t, { rows: [
    { name: 'li_at', expires_utc: 0n, has_expires: 0, encrypted_value: encrypted(LI_AT) },
    { name: 'JSESSIONID', encrypted_value: encrypted(JSESSIONID) },
  ] });
  assert.equal(readCookieSnapshot(f.path).rows.length, 2);
});

for (const [label, blob] of [
  ['다른 host digest', encrypted(LI_AT, { digestHost: 'www.linkedin.com' })],
  ['미지원 prefix', encrypted(LI_AT, { prefix: 'v20' })],
  ['상위 비트가 다른 prefix', Buffer.concat([Buffer.from([0xf6, 0x31, 0x30]), encrypted(LI_AT).subarray(3)])],
  ['UTF8 BOM', encrypted(`﻿${LI_AT}`)],
  ['잘린 블록', Buffer.from('v10short')],
  ['잘못된 padding', encrypted(Buffer.alloc(16, 0), { padding: false })],
  ['invalid UTF8', encrypted(Buffer.from([0xff, 0xfe]))],
  ['헤더 주입', encrypted('token\r\nCookie: bad')],
]) {
  test(`${label} 복호화 거부`, t => {
    const f = fixture(t, { rows: [
      { name: 'li_at', encrypted_value: blob },
      { name: 'JSESSIONID', encrypted_value: encrypted(JSESSIONID) },
    ] });
    assert.throws(() => decryptCookies(readCookieSnapshot(f.path), Buffer.from(PASSWORD)), errorCode('NEEDS_AUTH'));
  });
}

test('배포 CLI의 Chrome reader를 Aside source로 호출해 전체 Cookie 헤더를 만든다', async t => {
  const f = fixture(t, { rows: [
    { name: 'li_at', encrypted_value: encrypted(LI_AT) },
    { name: 'JSESSIONID', encrypted_value: encrypted(JSESSIONID) },
    { name: 'bcookie', encrypted_value: encrypted('synthetic-browser-id') },
    { name: 'lidc', encrypted_value: encrypted('synthetic-datacenter') },
    { name: 'unrelated', host_key: 'evil-linkedin.com', encrypted_value: encrypted('must-not-send') },
    { name: 'expired', expires_utc: 1n, encrypted_value: encrypted('must-not-send') },
    { name: 'scoped', path: '/other', encrypted_value: encrypted('must-not-send') },
    { name: 'partitioned', top_frame_site_key: 'https://example.test', encrypted_value: encrypted('must-not-send') },
  ] });
  let cookieHeader;
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'me' }, {
    home: f.home, readPassword: async () => Buffer.from(PASSWORD),
    runCli: async ({ env }) => {
      assert.equal(env.LINKEDIN_LI_AT, LI_AT);
      assert.equal(env.LINKEDIN_JSESSIONID, JSESSIONID);
      cookieHeader = env.LINKEDIN_COOKIE_HEADER;
      return { account: 'synthetic' };
    },
  });
  assert.deepEqual(result, { status: 'OK', data: { account: 'synthetic' } });
  assert.equal(cookieHeader, `li_at=${LI_AT}; JSESSIONID=${JSESSIONID}; bcookie=synthetic-browser-id; lidc=synthetic-datacenter`);
  assert.ok(!cookieHeader.includes('must-not-send'));
});

for (const [label, row] of [
  ['중복 부가 쿠키', { name: 'bcookie', encrypted_value: encrypted('second-browser-id') }],
  ['잘못된 이름', { name: 'bad;name', encrypted_value: encrypted('other') }],
  ['부가 쿠키 헤더 주입', { name: 'other', encrypted_value: encrypted('bad\r\nInjected: value') }],
  ['부가 쿠키 host digest 불일치', { name: 'other', encrypted_value: encrypted('other', { digestHost: 'www.linkedin.com' }) }],
]) test(`${label}는 전체 Cookie 헤더 생성 전에 중단한다`, async t => {
  const f = fixture(t, { rows: [
    { name: 'li_at', encrypted_value: encrypted(LI_AT) },
    { name: 'JSESSIONID', encrypted_value: encrypted(JSESSIONID) },
    { name: 'bcookie', encrypted_value: encrypted('first-browser-id') },
    row,
  ] });
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'me' }, {
    home: f.home, readPassword: async () => Buffer.from(PASSWORD),
    runCli: async () => { throw new Error('must not call'); },
  });
  assert.deepEqual(result, { status: 'NEEDS_AUTH' });
});

test('쿠키 행 상한을 넘으면 키체인·CLI 호출 없이 중단한다', async t => {
  const f = fixture(t, { rows: [
    { name: 'li_at', encrypted_value: encrypted(LI_AT) },
    { name: 'JSESSIONID', encrypted_value: encrypted(JSESSIONID) },
    ...Array.from({ length: 127 }, (_, i) => ({ name: `extra-${i}`, encrypted_value: encrypted('synthetic-extra') })),
  ] });
  const calls = [];
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'me' }, {
    home: f.home,
    readPassword: async () => { calls.push('keychain'); return Buffer.from(PASSWORD); },
    runCli: async () => { calls.push('cli'); return {}; },
  });
  assert.deepEqual(result, { status: 'NEEDS_AUTH' });
  assert.deepEqual(calls, []);
});

test('프로필 traversal·symlink·두 Cookies 위치를 거부한다', t => {
  const f = fixture(t);
  for (const profile of ['../Profile 1', '.', '..', '/tmp/test', 'a/b', 'a\\b', '']) {
    assert.throws(() => resolveCookieDatabase(profile, f.home), errorCode('INVALID_PROFILE'));
  }
  const root = join(f.home, 'Library/Application Support/Aside');
  symlinkSync(f.profile, join(root, 'Linked Profile'));
  assert.throws(() => resolveCookieDatabase('Linked Profile', f.home), errorCode('INVALID_PROFILE'));
  symlinkSync(f.path, join(f.profile, 'Cookies'));
  assert.throws(() => resolveCookieDatabase('Profile 1', f.home));
});

test('Network·Cookies·WAL sidecar symlink를 거부한다', t => {
  const f = fixture(t);
  symlinkSync(join(f.home, 'outside-wal'), `${f.path}-wal`);
  assert.throws(() => resolveCookieDatabase('Profile 1', f.home), errorCode('INVALID_PROFILE'));
});

test('WAL snapshot의 meta와 두 쿠키를 읽으며 원본 DB 내용을 바꾸지 않는다', t => {
  const f = fixture(t, { wal: true });
  const before = readFileSync(f.path);
  const walBefore = readFileSync(`${f.path}-wal`);
  f.db.exec('BEGIN IMMEDIATE');
  f.db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('25', 'version');
  f.db.prepare('UPDATE cookies SET encrypted_value = ? WHERE name = ?').run(encrypted('uncommitted'), 'li_at');
  const snapshot = readCookieSnapshot(f.path);
  assert.equal(snapshot.version, 24);
  assert.equal(decryptCookies(snapshot, Buffer.from(PASSWORD)).li_at, LI_AT);
  assert.deepEqual(readFileSync(f.path), before);
  assert.deepEqual(readFileSync(`${f.path}-wal`), walBefore);
  f.db.exec('ROLLBACK');
});

test('WAL writer 커밋 중에도 version과 쿠키는 같은 snapshot이다', async t => {
  const f = fixture(t, { wal: true });
  f.db.prepare('UPDATE cookies SET encrypted_value = ? WHERE name = ?').run(encrypted('token-version24'), 'li_at');
  const control = new SharedArrayBuffer(4);
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData.path, { timeout: 250 });
    const control = new Int32Array(workerData.control);
    parentPort.postMessage('ready');
    let i = 0;
    while (Atomics.load(control, 0) === 0) {
      const version = i++ % 2 ? 24 : 25;
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(version), 'version');
      db.prepare('UPDATE cookies SET encrypted_value = ? WHERE name = ?').run(workerData.values[version], 'li_at');
      db.exec('COMMIT');
    }
    db.close();
  `, { eval: true, workerData: { path: f.path, control, values: { 24: encrypted('token-version24'), 25: encrypted('token-version25') } } });
  await once(worker, 'message');
  try {
    for (let i = 0; i < 40; i++) {
      const snapshot = readCookieSnapshot(f.path);
      assert.equal(decryptCookies(snapshot, Buffer.from(PASSWORD)).li_at, `token-version${snapshot.version}`);
    }
  } finally {
    const exit = once(worker, 'exit');
    Atomics.store(new Int32Array(control), 0, 1);
    await exit;
  }
});

test('존재하지 않거나 잘못된 DB는 새로 만들거나 대체하지 않는다', t => {
  const f = fixture(t);
  assert.throws(() => readCookieSnapshot(join(f.home, 'missing.db')), errorCode('NEEDS_AUTH'));
  writeFileSync(join(f.home, 'bad.db'), 'not sqlite');
  assert.throws(() => readCookieSnapshot(join(f.home, 'bad.db')), errorCode('NEEDS_AUTH'));
});

test('읽기 권한 거절은 fallback 없이 실패한다', t => {
  const f = fixture(t);
  chmodSync(f.path, 0o000);
  try {
    assert.throws(() => readCookieSnapshot(f.path), errorCode('NEEDS_AUTH'));
  } finally {
    chmodSync(f.path, 0o600);
  }
});

test('WAL sidecar가 없고 디렉터리가 읽기 전용이면 원본을 복제하지 않고 실패한다', t => {
  const f = fixture(t);
  const writer = new DatabaseSync(f.path);
  writer.exec('PRAGMA journal_mode=WAL');
  writer.close();
  const directory = join(f.profile, 'Network');
  const before = readFileSync(f.path);
  chmodSync(f.path, 0o400);
  chmodSync(directory, 0o500);
  try {
    assert.throws(() => readCookieSnapshot(f.path), errorCode('NEEDS_AUTH'));
    assert.deepEqual(readFileSync(f.path), before);
  } finally {
    chmodSync(directory, 0o700);
    chmodSync(f.path, 0o600);
  }
});

test('env allowlist는 상속 인증·대체 transport·Node preload를 버린다', () => {
  const env = cliEnvironment({ li_at: LI_AT, JSESSIONID }, {
    HOME: '/synthetic/home', PATH: '/untrusted/bin', LANG: 'ko_KR.UTF-8',
    LINKEDIN_LI_AT: 'old-secret', LINKEDIN_JSESSIONID: 'old-session', LINKEDIN_FROM_CHROME: '1', LINKEDIN_COOKIE_HEADER: 'poison=secret',
    CHROME_PATH: 'evil', NODE_OPTIONS: '--import evil', HTTP_PROXY: 'evil', HTTPS_PROXY: 'evil',
    NODE_EXTRA_CA_CERTS: '/synthetic/CA bundle.pem', NODE_TLS_REJECT_UNAUTHORIZED: '0', ALL_PROXY: 'evil', SSL_CERT_FILE: 'evil', ARBITRARY_SECRET: PASSWORD,
  });
  assert.equal(env.LINKEDIN_LI_AT, LI_AT);
  assert.equal(env.LINKEDIN_JSESSIONID, JSESSIONID);
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/synthetic/CA bundle.pem');
  assert.equal(cliEnvironment({ li_at: LI_AT, JSESSIONID }, {}).NODE_EXTRA_CA_CERTS, undefined);
  for (const key of ['LINKEDIN_FROM_CHROME', 'LINKEDIN_COOKIE_HEADER', 'CHROME_PATH', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'SSL_CERT_FILE', 'ARBITRARY_SECRET']) assert.equal(env[key], undefined);
  assert.equal(env.HOME, '/synthetic/home');
  assert.notEqual(env.PATH, '/untrusted/bin');
});

test('키체인 helper 대역의 거절·timeout·출력 초과는 비밀 없는 고정 오류다', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'linkedin-helper-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let index = 0;
  for (const script of [
    `process.stderr.write(${JSON.stringify(PASSWORD)}); process.exit(1)`,
    'setInterval(() => {}, 1000)',
    `process.stdout.write('x'.repeat(20000))`,
    `process.stdout.write('not-base64!')`,
    `process.stdout.write(Buffer.from([0xc1, 0x51, 0x3d, 0x3d]))`,
  ]) {
    const path = join(dir, `helper-${index++}.mjs`);
    writeFileSync(path, script);
    await assert.rejects(runKeychainHelper(process.execPath, [path], 100), errorCode('NEEDS_AUTH'));
  }
  const success = join(dir, 'success.mjs');
  const audit = join(dir, 'audit.json');
  writeFileSync(success, `import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(audit)}, JSON.stringify({ argv: process.argv, env: process.env }));
    process.stdout.write(Buffer.from(${JSON.stringify(PASSWORD)}).toString('base64'));`);
  const password = await runKeychainHelper(process.execPath, [success]);
  assert.equal(password.toString(), PASSWORD);
  assert.ok(!readFileSync(audit, 'utf8').includes(PASSWORD));
  assert.ok(!readFileSync(audit, 'utf8').includes(LI_AT));
  password.fill(0);
});

test('JXA helper는 Aside 한 항목만 요청하며 별도 도구·ACL 변경이 없다', () => {
  const helper = readFileSync(new URL('../keychain-read.js', import.meta.url), 'utf8');
  assert.match(helper, /ObjC\.import\(['"]Security['"]\)/);
  assert.match(helper, /ObjC\.import\(['"]LocalAuthentication['"]\)/);
  assert.match(helper, /kSecUseAuthenticationUIAllow/);
  assert.match(helper, /kSecUseAuthenticationContext/);
  assert.match(helper, /kSecUseAuthenticationUIFail/);
  assert.match(helper, /Aside Safe Storage/);
  assert.match(helper, /['"]Aside['"]/);
  assert.doesNotMatch(helper, /doShellScript|\/usr\/bin\/security|SecItemAdd|SecItemUpdate/);
});

test('인증 요청은 쿠키를 CLI env로만 넘기며 결과와 오류의 비밀을 차단한다', async t => {
  const browserCookie = 'synthetic-extra-auth-cookie';
  const f = fixture(t, { rows: [
    { name: 'li_at', encrypted_value: encrypted(LI_AT) },
    { name: 'JSESSIONID', encrypted_value: encrypted(JSESSIONID) },
    { name: 'bcookie', encrypted_value: encrypted(browserCookie) },
  ] });
  const before = readFileSync(f.path);
  let calls = 0;
  const dependencies = {
    home: f.home,
    readPassword: async () => Buffer.from(PASSWORD),
    runCli: async ({ command, conversationId, text, env }) => {
      calls++;
      assert.equal(command, 'messages');
      assert.equal(conversationId, 'conversation-1');
      assert.equal(text, undefined);
      assert.equal(env.LINKEDIN_LI_AT, LI_AT);
      assert.equal(env.LINKEDIN_JSESSIONID, JSESSIONID);
      assert.equal(env.ARBITRARY_SECRET, undefined);
      return { messages: [] };
    },
  };
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'messages', conversationId: 'conversation-1' }, dependencies);
  assert.deepEqual(result, { status: 'OK', data: { messages: [] } });
  assert.equal(calls, 1);
  for (const secret of [PASSWORD, LI_AT, JSESSIONID, browserCookie]) {
    const leaked = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'me' }, { ...dependencies, runCli: async () => ({ raw: secret }) });
    assert.equal(leaked.status, 'CLI_FAILED');
    assert.ok(!JSON.stringify(leaked).includes(secret));
  }
  const failed = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'me' }, { ...dependencies, runCli: async () => { throw new Error(LI_AT); } });
  assert.deepEqual(failed, { status: 'CLI_FAILED' });
  assert.deepEqual(readFileSync(f.path), before);
  for (const secret of [PASSWORD, LI_AT, JSESSIONID, browserCookie]) assert.ok(!readFileSync(f.path).includes(Buffer.from(secret)));
});

for (const normalized of [false, true]) test(`키체인 실패·단일 쿠키 조회·동일 env 전송·비밀 정리: ${normalized ? '참조 형식' : '직접 형식'}`, async t => {
  const f = fixture(t);
  let called = false;
  const denied = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'me' }, {
    home: f.home,
    readPassword: async () => { throw new Error(PASSWORD); },
    runCli: async () => { called = true; },
  });
  assert.deepEqual(denied, { status: 'NEEDS_AUTH' });
  assert.equal(called, false);
  const password = Buffer.from(PASSWORD);
  let capturedEnv;
  let passwordReads = 0;
  const commands = [];
  const expectedAccountId = 'urn:li:fs_miniProfile:self';
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'send', conversationId: 'one', text: '줄1\n줄2', expectedAccountId }, {
    home: f.home, readPassword: async () => { passwordReads++; return password; },
    runCli: async ({ command, text, env }) => {
      commands.push(command);
      if (command === 'me') {
        capturedEnv = env;
        const db = new DatabaseSync(f.path);
        try { db.exec('DELETE FROM cookies'); } finally { db.close(); }
        const miniProfile = { entityUrn: expectedAccountId, firstName: '본인', lastName: '' };
        return normalized ? { data: { '*miniProfile': expectedAccountId }, included: [miniProfile] } : { miniProfile };
      }
      assert.equal(command, 'send');
      assert.equal(text, '줄1\n줄2');
      assert.equal(env, capturedEnv);
      assert.equal(env.LINKEDIN_LI_AT, LI_AT);
      assert.equal(env.LINKEDIN_JSESSIONID, JSESSIONID);
      return { sent: true };
    },
  });
  assert.deepEqual(result, { status: 'OK', data: { sent: true } });
  assert.deepEqual(commands, ['me', 'send']);
  assert.equal(passwordReads, 1);
  assert.ok(password.every(byte => byte === 0));
  assert.equal(capturedEnv.LINKEDIN_LI_AT, undefined);
  assert.equal(capturedEnv.LINKEDIN_JSESSIONID, undefined);
  assert.equal(capturedEnv.LINKEDIN_COOKIE_HEADER, undefined);
});

for (const [name, account] of [
  ['다른 계정', { miniProfile: { entityUrn: 'urn:li:fs_miniProfile:other' } }],
  ['다른 URN 체계', { miniProfile: { entityUrn: 'urn:li:fsd_profile:self' } }],
  ['참조한 다른 계정', { data: { '*miniProfile': 'urn:li:fs_miniProfile:other' }, included: [{ entityUrn: 'urn:li:fs_miniProfile:self', firstName: '본인', lastName: '' }, { entityUrn: 'urn:li:fs_miniProfile:other', firstName: '본인', lastName: '' }] }],
  ['미해결 참조', { data: { '*miniProfile': 'urn:li:fs_miniProfile:self' }, included: [] }],
  ['중복 참조', { data: { '*miniProfile': 'urn:li:fs_miniProfile:self' }, included: [{ entityUrn: 'urn:li:fs_miniProfile:self', firstName: '본인', lastName: '' }, { entityUrn: 'urn:li:fs_miniProfile:self', firstName: '본인', lastName: '' }] }],
  ['이름 누락', { miniProfile: { entityUrn: 'urn:li:fs_miniProfile:self' } }],
  ['알 수 없는 응답', {}],
  ['응답 누락', undefined],
]) test(`전송 인증의 /me가 ${name}이면 POST하지 않는다`, async t => {
  const f = fixture(t);
  const commands = [];
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'send', conversationId: 'one', text: '보내지 않습니다.', expectedAccountId: 'urn:li:fs_miniProfile:self' }, {
    home: f.home, readPassword: async () => Buffer.from(PASSWORD),
    runCli: async ({ command }) => { commands.push(command); return account; },
  });
  assert.deepEqual(result, { status: 'ACCOUNT_MISMATCH' });
  assert.deepEqual(commands, ['me']);
});

test('전송 인증의 /me 조회 실패는 POST 없이 끝난다', async t => {
  const f = fixture(t);
  const commands = [];
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'send', conversationId: 'one', text: '보내지 않습니다.', expectedAccountId: 'urn:li:fs_miniProfile:self' }, {
    home: f.home, readPassword: async () => Buffer.from(PASSWORD),
    runCli: async ({ command }) => { commands.push(command); throw new Error(LI_AT); },
  });
  assert.deepEqual(result, { status: 'CLI_FAILED' });
  assert.deepEqual(commands, ['me']);
});

test('최초 authorize는 승인 뒤 별도 UI 금지 재조회가 성공해야 /me를 호출한다', async t => {
  const f = fixture(t);
  const reads = [];
  const passwords = [];
  const commands = [];
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'authorize' }, {
    home: f.home,
    readPassword: async interactive => {
      reads.push(interactive);
      if (!interactive) assert.ok(passwords[0].every(byte => byte === 0));
      const password = Buffer.from(PASSWORD);
      passwords.push(password);
      return password;
    },
    runCli: async ({ command }) => { commands.push(command); return { account: 'synthetic' }; },
  });
  assert.deepEqual(result, { status: 'OK', data: { account: 'synthetic' } });
  assert.deepEqual(reads, [true, false]);
  assert.deepEqual(commands, ['me']);
  assert.ok(passwords.every(password => password.every(byte => byte === 0)));
});

for (const failAt of [1, 2]) test(`최초 승인 ${failAt === 1 ? '취소·거절·timeout' : '일회 허용 후 UI 금지 실패'}는 LinkedIn 호출 전에 중단한다`, async t => {
  const f = fixture(t);
  const reads = [];
  let calls = 0;
  const result = await runAuthenticatedRequest({ profile: 'Profile 1', command: 'authorize' }, {
    home: f.home,
    readPassword: async interactive => {
      reads.push(interactive);
      if (reads.length === failAt) throw new Error(PASSWORD);
      return Buffer.from(PASSWORD);
    },
    runCli: async () => { calls++; },
  });
  assert.deepEqual(result, { status: 'NEEDS_AUTH' });
  assert.deepEqual(reads, failAt === 1 ? [true] : [true, false]);
  assert.equal(calls, 0);
});

test('일반 조회·전송은 UI 금지를 명시하고 authorize 입력으로 바꿀 수 없다', async t => {
  const f = fixture(t);
  const reads = [];
  for (const command of ['me', 'conversations', 'messages', 'send']) {
    const result = await runAuthenticatedRequest({ profile: 'Profile 1', command,
      ...(['messages', 'send'].includes(command) ? { conversationId: 'one' } : {}),
      ...(command === 'send' ? { text: '회신', expectedAccountId: 'urn:li:fs_miniProfile:self' } : {}),
    }, {
      home: f.home,
      readPassword: async interactive => { reads.push(interactive); return Buffer.from(PASSWORD); },
      runCli: async () => ({ miniProfile: { entityUrn: 'urn:li:fs_miniProfile:self', firstName: '본인', lastName: '' } }),
    });
    assert.equal(result.status, 'OK');
  }
  assert.deepEqual(reads, [false, false, false, false]);
});

test('불허 command·누락된 대화·부정확한 본문은 인증 전에 거부한다', async () => {
  for (const request of [
    { profile: 'Profile 1', command: 'login' },
    { profile: 'Profile 1', command: 'authorize', text: '전송 불가' },
    { profile: 'Profile 1', command: 'me', interactive: true },
    { profile: 'Profile 1', command: 'messages' },
    { profile: 'Profile 1', command: 'send', conversationId: 'one' },
    { profile: 'Profile 1', command: 'me', text: 'unexpected' },
    { profile: 'Profile 1', command: 'me', expectedAccountId: 'urn:li:fs_miniProfile:self' },
    { profile: 'Profile 1', command: 'send', conversationId: 'one', text: '승인 계정 누락' },
    { profile: 'Profile 1', command: 'send', conversationId: 'one', text: '다른 URN 체계', expectedAccountId: 'urn:li:fsd_profile:self' },
  ]) assert.deepEqual(await runAuthenticatedRequest(request, { readPassword: () => { throw new Error('must not read'); } }), { status: 'INVALID_ARGUMENT' });
});

test('운영 auth 자식은 runner import가 멈춰도 전체 종료 상한을 지킨다', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'linkedin-auth-timeout-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'aside-auth.mjs');
  writeFileSync(path, readFileSync(modulePath));
  writeFileSync(join(dir, 'cli.mjs'), 'await new Promise(() => {}); export function runCli() {}');
  const start = Date.now();
  const child = spawnSync(process.execPath, [path], {
    input: JSON.stringify({ profile: 'Profile 1', command: 'me' }),
    env: { HOME: dir }, encoding: 'utf8', timeout: 18000,
  });
  assert.equal(child.status, 1);
  assert.deepEqual(JSON.parse(child.stdout), { status: 'AUTH_TIMEOUT' });
  assert.ok(Date.now() - start < 18000);
  for (const secret of [PASSWORD, LI_AT, JSESSIONID]) assert.ok(!`${child.stdout}${child.stderr}`.includes(secret));
});

test('운영 stdin 입구는 CLI 부재 시 인증 없이 비밀 없는 오류로 끝난다', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'linkedin-auth-missing-cli-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'aside-auth.mjs');
  writeFileSync(path, readFileSync(modulePath));
  const child = spawnSync(process.execPath, [path], {
    input: JSON.stringify({ profile: 'Profile 1', command: 'me' }),
    env: { HOME: '/synthetic/nonexistent', NODE_NO_WARNINGS: '1', LINKEDIN_LI_AT: LI_AT, ARBITRARY_SECRET: PASSWORD },
    encoding: 'utf8', timeout: 2000,
  });
  assert.equal(child.status, 1);
  assert.deepEqual(JSON.parse(child.stdout), { status: 'CLI_UNAVAILABLE' });
  for (const secret of [PASSWORD, LI_AT, JSESSIONID]) assert.ok(!`${child.stdout}${child.stderr}`.includes(secret));
});
