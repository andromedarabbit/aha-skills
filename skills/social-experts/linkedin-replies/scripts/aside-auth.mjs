#!/usr/bin/env node
import { createDecipheriv, createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * AES/PBKDF2 adapted from chromium-migrate/src/services/crypto.ts.
 * MIT License — Copyright (c) 2026 chromium-migrate contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const DOMAINS = ['linkedin.com', '.linkedin.com', 'www.linkedin.com', '.www.linkedin.com'];
const NAMES = ['li_at', 'JSESSIONID'];
const MAX_OUTPUT = 2 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });

function statIfPresent(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw fail('INVALID_PROFILE');
  }
}

export function resolveCookieDatabase(profile, home = homedir()) {
  if (typeof profile !== 'string' || !/^[\p{L}\p{N}_ -]{1,128}$/u.test(profile) || profile.trim() !== profile) throw fail('INVALID_PROFILE');
  try {
    const root = join(realpathSync(home), 'Library/Application Support/Aside');
    // 프로필과 sidecar 모두 심볼릭 링크를 허용하지 않아 경계 밖 DB를 열지 않는다.
    let current = realpathSync(home);
    for (const segment of ['Library', 'Application Support', 'Aside', profile]) {
      current = join(current, segment);
      const stat = statIfPresent(current);
      if (!stat?.isDirectory() || stat.isSymbolicLink() || realpathSync(current) !== current) throw fail('INVALID_PROFILE');
    }
    const profilePath = join(root, profile);
    const network = statIfPresent(join(profilePath, 'Network'));
    if (network && (!network.isDirectory() || network.isSymbolicLink())) throw fail('INVALID_PROFILE');
    const candidates = [join(profilePath, 'Network/Cookies'), join(profilePath, 'Cookies')].filter(path => statIfPresent(path));
    if (candidates.length !== 1) throw fail('INVALID_PROFILE');
    const path = candidates[0];
    if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw fail('INVALID_PROFILE');
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const stat = statIfPresent(`${path}${suffix}`);
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw fail('INVALID_PROFILE');
    }
    return path;
  } catch {
    throw fail('INVALID_PROFILE');
  }
}

export function readCookieSnapshot(path) {
  let db;
  let rows;
  try {
    db = new DatabaseSync(path, { readOnly: true, timeout: 250, allowExtension: false });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;');
    const versions = db.prepare("SELECT value FROM meta WHERE key = 'version' LIMIT 2").all();
    if (versions.length !== 1 || !/^[1-9][0-9]{0,3}$/.test(versions[0].value)) throw fail('NEEDS_AUTH');
    const version = Number(versions[0].value);
    const columns = new Set(db.prepare('PRAGMA table_info(cookies)').all().map(row => row.name));
    if (!['host_key', 'name', 'path', 'expires_utc', 'has_expires', 'top_frame_site_key', 'value', 'encrypted_value'].every(name => columns.has(name))) throw fail('NEEDS_AUTH');
    // Chromium은 partition key가 없는 일반 쿠키도 has_cross_site_ancestor=1로 저장한다.
    const optional = ['is_partitioned'].filter(name => columns.has(name));
    const query = db.prepare(`SELECT host_key, name, path, expires_utc, has_expires, top_frame_site_key,
      value, encrypted_value${optional.map(name => `, ${name}`).join('')}
      FROM cookies WHERE host_key IN (?, ?, ?, ?) ORDER BY rowid LIMIT 129`);
    query.setReadBigInts(true);
    rows = query.all(...DOMAINS);
    if (rows.length > 128 || NAMES.some(name => rows.filter(row => row.name === name).length !== 1)) throw fail('NEEDS_AUTH');
    const now = (BigInt(Date.now()) + 11644473600000n) * 1000n;
    const selected = [];
    const names = new Set();
    for (const row of rows) {
      if (typeof row.name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(row.name)) throw fail('NEEDS_AUTH');
      const eligible = row.path === '/' && row.top_frame_site_key === '' && optional.every(name => row[name] === 0n)
        && typeof row.expires_utc === 'bigint' && [0n, 1n].includes(row.has_expires)
        && (row.has_expires === 1n ? row.expires_utc > now : row.expires_utc === 0n);
      if (!eligible) {
        if (NAMES.includes(row.name)) throw fail('NEEDS_AUTH');
        row.encrypted_value?.fill?.(0);
        continue;
      }
      if (row.value !== '' || names.has(row.name)) throw fail('NEEDS_AUTH');
      names.add(row.name);
      if (!(row.encrypted_value instanceof Uint8Array) || row.encrypted_value.length < 19 || row.encrypted_value.length > 16384) throw fail('NEEDS_AUTH');
      selected.push(row);
    }
    db.exec('COMMIT;');
    return { version, rows: selected };
  } catch {
    for (const row of rows ?? []) row.encrypted_value?.fill?.(0);
    throw fail('NEEDS_AUTH');
  } finally {
    db?.close();
  }
}

export function decryptCookies(snapshot, password) {
  let key;
  const cookies = {};
  try {
    if (!Buffer.isBuffer(password) || password.length === 0 || password.length > 4096) throw fail('NEEDS_AUTH');
    key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    for (const row of snapshot.rows) {
      let plain;
      try {
        const blob = Buffer.from(row.encrypted_value);
        const prefix = blob.subarray(0, 3);
        if (!['v10', 'v11'].some(value => prefix.equals(Buffer.from(value))) || (blob.length - 3) % 16 !== 0) throw fail('NEEDS_AUTH');
        const cipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
        plain = Buffer.concat([cipher.update(blob.subarray(3)), cipher.final()]);
        let value = plain;
        if (snapshot.version >= 24) {
          const expected = createHash('sha256').update(row.host_key).digest();
          if (plain.length < 32 || !timingSafeEqual(plain.subarray(0, 32), expected)) throw fail('NEEDS_AUTH');
          value = plain.subarray(32);
        }
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
        if (!text || !/^[\x20-\x7e]+$/.test(text) || text.includes(';') || text.includes('\\')) throw fail('NEEDS_AUTH');
        if (row.name === 'li_at' && !/^[A-Za-z0-9._~-]+$/.test(text)) throw fail('NEEDS_AUTH');
        if (row.name === 'JSESSIONID' && !/^"?ajax:[A-Za-z0-9_-]+"?$/.test(text)) throw fail('NEEDS_AUTH');
        if (row.name === 'JSESSIONID' && text.startsWith('"') !== text.endsWith('"')) throw fail('NEEDS_AUTH');
        Object.defineProperty(cookies, row.name, { value: text, enumerable: true, writable: true, configurable: true });
      } finally {
        plain?.fill(0);
      }
    }
    return cookies;
  } catch {
    throw fail('NEEDS_AUTH');
  } finally {
    key?.fill(0);
  }
}

export function cliEnvironment(cookies, inherited = process.env) {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const key of ['HOME', 'LANG', 'LC_ALL', 'TZ', 'NODE_EXTRA_CA_CERTS']) {
    if (typeof inherited[key] === 'string') env[key] = inherited[key];
  }
  if (cookies) {
    env.LINKEDIN_LI_AT = cookies.li_at;
    env.LINKEDIN_JSESSIONID = cookies.JSESSIONID;
  }
  return env;
}

export function runKeychainHelper(executable, args, timeout = 2000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { env: cliEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [];
    let size = 0;
    let rejected = false;
    const stop = () => { rejected = true; child.kill('SIGKILL'); };
    const timer = setTimeout(stop, timeout);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 8192) { chunk.fill(0); stop(); return; }
      output.push(chunk);
    });
    child.stderr.on('data', chunk => { chunk.fill(0); stop(); });
    child.on('error', () => { rejected = true; });
    child.on('close', code => {
      clearTimeout(timer);
      const bytes = Buffer.concat(output);
      try {
        const encoded = bytes.toString('utf8').trim();
        if (rejected || code !== 0 || !encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw fail('NEEDS_AUTH');
        const secret = Buffer.from(encoded, 'base64');
        if (secret.length === 0 || secret.length > 4096 || secret.toString('base64') !== encoded) { secret.fill(0); throw fail('NEEDS_AUTH'); }
        resolvePromise(secret);
      } catch {
        reject(fail('NEEDS_AUTH'));
      } finally {
        bytes.fill(0);
        for (const chunk of output) chunk.fill(0);
      }
    });
  });
}

function readSafeStorage(interactive = false) {
  if (process.platform !== 'darwin') throw fail('NEEDS_AUTH');
  return runKeychainHelper('/usr/bin/osascript', ['-l', 'JavaScript', fileURLToPath(new URL('./keychain-read.js', import.meta.url)), ...(interactive ? ['authorize'] : [])], interactive ? 120000 : 2000);
}

function validRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  if (Object.keys(request).some(key => !['profile', 'command', 'conversationId', 'text', 'expectedAccountId'].includes(key))) return false;
  if (typeof request.profile !== 'string' || !['authorize', 'me', 'conversations', 'messages', 'send'].includes(request.command)) return false;
  const needsConversation = ['messages', 'send'].includes(request.command);
  if (needsConversation && (typeof request.conversationId !== 'string' || !/^[A-Za-z0-9_:(),.-]{1,1024}$/.test(request.conversationId))) return false;
  if (!needsConversation && request.conversationId !== undefined) return false;
  if (request.command !== 'send') return request.text === undefined && request.expectedAccountId === undefined;
  if (typeof request.expectedAccountId !== 'string' || !/^urn:li:fs_miniProfile:[A-Za-z0-9_-]+$/.test(request.expectedAccountId)) return false;
  return typeof request.text === 'string' && request.text.trim().length > 0 && Buffer.byteLength(request.text) <= 1024 * 1024 && !request.text.includes('\0');
}

export async function runAuthenticatedRequest(request, { home = homedir(), readPassword = readSafeStorage, runCli } = {}) {
  if (!validRequest(request)) return { status: 'INVALID_ARGUMENT' };
  let loadBrowserCookies;
  try {
    const cli = await import('./cli.mjs');
    runCli ??= cli.runCli;
    loadBrowserCookies = cli.loadBrowserCookies;
    if (typeof runCli !== 'function' || typeof loadBrowserCookies !== 'function') return { status: 'CLI_UNAVAILABLE' };
  } catch {
    return { status: 'CLI_UNAVAILABLE' };
  }
  let snapshot;
  let password;
  let cookies;
  let env;
  try {
    const interactive = request.command === 'authorize';
    const auth = await loadBrowserCookies(request.profile, { home, readCookies: async () => {
      snapshot = readCookieSnapshot(resolveCookieDatabase(request.profile, home));
      // 키체인 호출은 DB를 닫은 뒤 실행한다.
      password = await readPassword(interactive);
      if (interactive) {
        // 일회 허용만으로는 무인 실행할 수 없다. 별도 helper에서 UI 금지 재조회를 확인한다.
        password.fill(0);
        password = await readPassword(false);
      }
      cookies = decryptCookies(snapshot, password);
      return cookies;
    } });
    env = cliEnvironment(cookies);
    env.LINKEDIN_COOKIE_HEADER = auth.cookieHeader;
    let serialized;
    try {
      if (request.command === 'send') {
        // 계정 확인 뒤 쿠키를 다시 읽으면 다른 계정으로 POST할 수 있다.
        const account = await runCli({ command: 'me', env });
        try {
          const { normalizeAccount } = await import('./reply.mjs');
          if (normalizeAccount(account).id !== request.expectedAccountId) return { status: 'ACCOUNT_MISMATCH' };
        } catch {
          return { status: 'ACCOUNT_MISMATCH' };
        }
      }
      const result = await runCli({ command: interactive ? 'me' : request.command, conversationId: request.conversationId, text: request.text, env });
      serialized = JSON.stringify(result);
      if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_OUTPUT) throw fail('CLI_FAILED');
      const secrets = [password.toString('utf8'), ...Object.values(cookies).flatMap(value => [value, value.replaceAll('"', '')])];
      if (secrets.some(secret => secret && (serialized.includes(secret) || serialized.includes(JSON.stringify(secret).slice(1, -1))))) throw fail('CLI_FAILED');
      return { status: 'OK', data: JSON.parse(serialized) };
    } catch {
      return { status: 'CLI_FAILED' };
    }
  } catch (error) {
    if (error?.code === 'CLI_INTEGRITY') return { status: 'CLI_UNAVAILABLE' };
    return { status: error?.code === 'INVALID_PROFILE' ? 'INVALID_PROFILE' : 'NEEDS_AUTH' };
  } finally {
    password?.fill(0);
    for (const row of snapshot?.rows ?? []) row.encrypted_value.fill(0);
    if (env) { delete env.LINKEDIN_LI_AT; delete env.LINKEDIN_JSESSIONID; delete env.LINKEDIN_COOKIE_HEADER; }
    if (cookies) for (const name of Object.keys(cookies)) cookies[name] = '';
    // JS 문자열은 지울 수 없다. 인증 자식은 단일 요청 후 종료한다.
  }
}

async function main() {
  const inherited = cliEnvironment();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, inherited);
  const chunks = [];
  let size = 0;
  const expire = () => { process.stdout.write('{"status":"AUTH_TIMEOUT"}\n', () => process.exit(1)); };
  let timer = setTimeout(expire, 15000);
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_OUTPUT) throw fail('INVALID_ARGUMENT');
      chunks.push(chunk);
    }
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (validRequest(request) && (request.command === 'authorize' || request.command === 'send')) {
      clearTimeout(timer);
      // authorize: 승인 창 120초 + UI 금지 조회 2초 + CLI 10초보다 길고 부모 136초보다 짧다.
      // send: 키체인 2초 + CLI me·send 각 10초보다 길고 부모 31초보다 짧다. 나머지 명령은 한 번의 CLI 호출이라 기본 15초를 유지한다.
      timer = setTimeout(expire, request.command === 'authorize' ? 135000 : 30000);
    }
    const result = await runAuthenticatedRequest(request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === 'OK' ? 0 : 1;
  } catch {
    process.stdout.write('{"status":"INVALID_ARGUMENT"}\n');
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    for (const chunk of chunks) chunk.fill(0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
