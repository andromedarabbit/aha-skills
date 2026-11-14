import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vendor = join(skill, 'vendor/linkedincli');
const artifact = join(vendor, 'dist/index.js');
const text = '첫 줄 "따옴표"와 \'작은따옴표\'\\\n두 번째 줄 😀\n';
const secrets = { LINKEDIN_LI_AT: 'fake-cookie-only', LINKEDIN_JSESSIONID: '"ajax:fake-session"' };
const fixture = mkdtempSync(join(tmpdir(), 'linkedin-cli-test-'));
const preload = join(fixture, 'network.mjs');
writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
const timer = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => timer(fn, ms >= 2000 ? 5 : ms, ...args);
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://www.linkedin.com/voyager/api/')) throw new Error('unexpected host');
  appendFileSync(process.env.TEST_REQUESTS, JSON.stringify({ url, method: init.method, redirect: init.redirect, body: init.body, argv: process.argv }) + '\\n');
  const mode = process.env.TEST_MODE;
  if (mode === 'networkclose') throw new TypeError('fetch failed');
  if (mode === 'timeout') throw new DOMException('aborted', 'AbortError');
  if (mode === 'parsing') return { status: 201, headers: new Headers(), text: async () => { throw new Error('response parsing failed'); } };
  if (mode === 'hang') { setInterval(() => {}, 1000); return new Promise(() => {}); }
  if (mode === 'leakstdout') return new Response(JSON.stringify({ secret: 'fake-cookie-only' }));
  if (mode === 'leakbrowser') return new Response(JSON.stringify({ secret: 'synthetic-extra-cookie' }));
  if (mode === 'largestderr') return new Response(JSON.stringify({ message: 'x'.repeat(2 * 1024 * 1024) }), { status: 401 });
  if (mode === 'large') return new Response(JSON.stringify({ content: 'x'.repeat(2 * 1024 * 1024) }));
  if (mode === 'badjson') return new Response('not-json');
  if (mode === 'redirect') return new Response(null, { status: 307, headers: { location: 'https://www.linkedin.com/voyager/api/repeat' } });
  const status = Number(mode) || 200;
  return new Response(JSON.stringify(status >= 400 ? { message: 'fake-cookie-only must not escape' } : { ok: true, elements: [] }), { status });
};
`);
process.on('exit', () => rmSync(fixture, { recursive: true, force: true }));

function direct(command, mode = '200', input = text) {
  const log = join(fixture, `requests-${crypto.randomUUID()}`);
  const args = command === 'send'
    ? ['messaging', 'send', 'conversation-123', '--text-stdin']
    : command === 'me' ? ['profile', 'me'] : ['messaging', command, ...(command === 'messages' ? ['conversation-123'] : [])];
  const result = spawnSync(process.execPath, ['--import', preload, artifact, ...args], {
    env: { PATH: '/usr/bin:/bin', HOME: fixture, ...secrets, TEST_MODE: mode, TEST_REQUESTS: log },
    input, encoding: 'utf8', timeout: 3000, maxBuffer: 3 * 1024 * 1024,
  });
  const calls = (() => { try { return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } })();
  return { ...result, calls };
}

for (const mode of ['429', '503', 'networkclose', 'timeout', 'redirect', 'parsing']) {
  test(`실제 CLI ${mode}: POST 재시도와 리다이렉트 재전송 없음`, () => {
    const result = direct('send', mode);
    assert.equal(result.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(result.calls[0].redirect, 'manual');
    assert.equal(result.status, 1);
  });
}

test('실제 CLI stdin의 한글·다중줄·따옴표가 본문과 정확히 같고 argv에는 없음', () => {
  const result = direct('send');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, elements: [] });
  assert.equal(result.calls.length, 1);
  const body = JSON.parse(result.calls[0].body);
  assert.equal(body.eventCreate.value['com.linkedin.voyager.messaging.create.MessageCreate'].attributedBody.text, text);
  assert.equal(body.dedupeByClientGeneratedToken, false);
  assert.ok(!result.calls[0].argv.includes(text));
  assert.ok(!result.stdout.includes(text));
  assert.ok(!result.stderr.includes(text));
});

for (const command of ['me', 'conversations', 'messages']) {
  test(`실제 CLI ${command}: 성공 JSON과 실패 종료 코드 유지`, () => {
    const success = direct(command);
    assert.equal(success.status, 0, success.stderr);
    assert.deepEqual(JSON.parse(success.stdout), { ok: true, elements: [] });
    const failure = direct(command, '401');
    assert.equal(failure.status, 1);
    assert.equal(JSON.parse(failure.stderr).code, 'AUTH_ERROR');
  });
}

// 운영 자식에는 preload가 없다. 테스트 프로세스만 spawn 경계에서 합성 fetch를 주입한다.
async function wrapper({ mode = '200', request = { command: 'send', conversationId: 'conversation-123', text }, auth = secrets, copy, mutate } = {}) {
  const root = copy ? mkdtempSync(join(fixture, 'copy-')) : skill;
  if (copy) {
    cpSync(join(skill, 'scripts/cli.mjs'), join(root, 'scripts/cli.mjs'), { recursive: true });
    cpSync(vendor, join(root, 'vendor/linkedincli'), { recursive: true });
    mutate?.(join(root, 'vendor/linkedincli'));
  }
  const runner = join(fixture, `runner-${crypto.randomUUID()}.mjs`);
  const log = join(fixture, `wrapper-${crypto.randomUUID()}`);
  writeFileSync(runner, `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawn;
let children = 0;
cp.spawn = (exe, args, opts) => {
  children++;
  if (['NODE_OPTIONS', 'LINKEDIN_HTTP', 'LINKEDIN_DEBUG', 'LINKEDIN_FROM_CHROME', 'LINKEDIN_CURL_IMPERSONATE_BIN', 'POISON'].some(key => opts.env[key])) throw new Error('unsafe inherited environment');
  if (exe !== process.execPath || !args[0].startsWith('/')) throw new Error('unfixed executable');
  return original(exe, ['--import', ${JSON.stringify(preload)}, ...args], { ...opts, env: { ...opts.env, TEST_MODE: ${JSON.stringify(mode)}, TEST_REQUESTS: ${JSON.stringify(log)} } });
};
syncBuiltinESMExports();
const { runCli } = await import(${JSON.stringify(join(root, 'scripts/cli.mjs'))});
try {
 const data = await runCli({ ...JSON.parse(process.argv[2]), env: { ...process.env, ...${JSON.stringify(auth)}, NODE_OPTIONS: '--import=/tmp/never-load.mjs', LINKEDIN_HTTP: 'curl-impersonate', LINKEDIN_DEBUG: '1', LINKEDIN_FROM_CHROME: '1', LINKEDIN_CURL_IMPERSONATE_BIN: '/tmp/never-run', POISON: 'never' } });
 console.log(JSON.stringify({ data, children }));
} catch (error) { console.log(JSON.stringify({ code: error.code, message: error.message, children })); }
`);
  const result = spawnSync(process.execPath, [runner, JSON.stringify(request)], {
    env: { PATH: '/usr/bin:/bin', HOME: fixture }, encoding: 'utf8', timeout: 13000, maxBuffer: 3 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('wrapper는 고정 자식·환경 allowlist·stdin을 사용하고 JSON만 반환', async () => {
  assert.deepEqual(await wrapper(), { data: { ok: true, elements: [] }, children: 1 });
});

for (const mode of ['401', '429', 'badjson', 'large', 'largestderr', 'leakstdout', 'hang']) {
  test(`wrapper ${mode}: raw 출력 없이 제한된 실패 코드`, async () => {
    const start = Date.now();
    const result = await wrapper({ mode });
    if (mode === 'hang') assert.ok(Date.now() - start >= 9500 && Date.now() - start < 12000);
    assert.equal(result.code, 'CLI_FAILED');
    assert.equal(result.message, 'CLI_FAILED');
    assert.equal(result.children, 1);
    assert.ok(!JSON.stringify(result).includes(secrets.LINKEDIN_LI_AT));
  });
}

test('전체 Cookie 헤더의 부가 쿠키도 stdout에서 차단한다', async () => {
  const header = `li_at=${secrets.LINKEDIN_LI_AT}; JSESSIONID=${secrets.LINKEDIN_JSESSIONID}; bcookie=synthetic-extra-cookie`;
  const result = await wrapper({ mode: 'leakbrowser', auth: { ...secrets, LINKEDIN_COOKIE_HEADER: header } });
  assert.deepEqual(result, { code: 'CLI_FAILED', message: 'CLI_FAILED', children: 1 });
});

for (const [label, header] of [
  ['계정 쿠키 불일치', 'li_at=other; JSESSIONID="ajax:fake-session"'],
  ['중복 이름', 'li_at=fake-cookie-only; JSESSIONID="ajax:fake-session"; bcookie=one; bcookie=two'],
  ['잘못된 이름', 'li_at=fake-cookie-only; JSESSIONID="ajax:fake-session"; bad name=value'],
  ['헤더 주입', 'li_at=fake-cookie-only; JSESSIONID="ajax:fake-session"; bcookie=value\r\nInjected: yes'],
  ['크기 초과', 'x'.repeat(65537)],
]) test(`전체 Cookie 헤더 ${label}는 CLI 자식 시작 전에 거부한다`, async () => {
  const result = await wrapper({ auth: { ...secrets, LINKEDIN_COOKIE_HEADER: header } });
  assert.deepEqual(result, { code: 'CLI_FAILED', message: 'CLI_FAILED', children: 0 });
});

for (const target of ['dist/index.js', 'package.json', 'provenance.json', 'safe-send.patch', 'aside-cookies.patch']) {
  test(`무결성 불일치 ${target}: 자식 시작 0회`, async () => {
    const result = await wrapper({ copy: true, mutate(dir) {
      const path = join(dir, target);
      if (target.endsWith('.json')) {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        if (target === 'package.json') data.version = '9.9.9';
        else data.sourceCommit = '0'.repeat(40);
        writeFileSync(path, JSON.stringify(data));
        return;
      }
      writeFileSync(path, `${readFileSync(path, 'utf8')}\ncorrupt`);
    } });
    assert.equal(result.code, 'CLI_INTEGRITY');
    assert.equal(result.children, 0);
  });
}

test('해시로 고정한 벤더 파일은 저장소 공백 fixer가 바꾸지 않음', () => {
  const provenance = JSON.parse(readFileSync(join(vendor, 'provenance.json'), 'utf8'));
  for (const path of Object.keys(provenance.files)) {
    const content = readFileSync(join(vendor, path), 'utf8');
    assert.ok(content.endsWith('\n') && !content.endsWith('\n\n'), path);
    assert.ok(!/[\t ]+$/m.test(content), path);
  }
});

test('잘못된 명령과 인자는 자식 시작 전에 거부', async () => {
  for (const request of [{ command: 'login' }, { command: 'messages', conversationId: '../x' }, { command: 'send', conversationId: 'id', text: '' }]) {
    const result = await wrapper({ request });
    assert.equal(result.code, 'INVALID_ARGUMENT');
    assert.equal(result.children, 0);
  }
});
