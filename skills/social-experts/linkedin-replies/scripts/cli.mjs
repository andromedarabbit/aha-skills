#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../vendor/linkedincli');
const PROVENANCE_HASH = '1057245f01de51cc5519e65e798108924a7e23c82d12ac08a48914339c1d101c';
const MAX_OUTPUT = 2 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function verifyArtifact() {
  try {
    const bytes = readFileSync(join(ROOT, 'provenance.json'));
    if (hash(bytes) !== PROVENANCE_HASH) throw fail('CLI_INTEGRITY');
    const provenance = JSON.parse(bytes);
    if (provenance.sourceCommit !== '88f775ef95c5b8ad1d3b6d1056f94ef92282b8bb' || provenance.packageName !== '@bcharleson/linkedincli' || provenance.version !== '0.1.6') throw fail('CLI_INTEGRITY');
    for (const [path, expected] of Object.entries(provenance.files)) {
      const full = join(ROOT, path);
      const stat = lstatSync(full);
      if (!stat.isFile() || stat.isSymbolicLink() || hash(readFileSync(full)) !== expected) throw fail('CLI_INTEGRITY');
    }
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    if (pkg.name !== provenance.packageName || pkg.version !== provenance.version || !isAbsolute(process.execPath)) throw fail('CLI_INTEGRITY');
    return join(ROOT, 'dist/index.js');
  } catch {
    throw fail('CLI_INTEGRITY');
  }
}

export async function loadBrowserCookies(profile, source) {
  const { loadLinkedInCookiesFromChrome } = await import(pathToFileURL(verifyArtifact()).href);
  return loadLinkedInCookiesFromChrome(profile, source);
}

export async function runCli({ command, conversationId, text, env } = {}) {
  if (!['me', 'conversations', 'messages', 'send'].includes(command)) throw fail('INVALID_ARGUMENT');
  const needsConversation = ['messages', 'send'].includes(command);
  if (needsConversation && (typeof conversationId !== 'string' || !/^[A-Za-z0-9_:(),.-]{1,1024}$/.test(conversationId))) throw fail('INVALID_ARGUMENT');
  if (!needsConversation && conversationId !== undefined) throw fail('INVALID_ARGUMENT');
  if (command !== 'send' && text !== undefined) throw fail('INVALID_ARGUMENT');
  if (command === 'send' && (typeof text !== 'string' || !text.trim() || text.includes('\0') || Buffer.byteLength(text) > 1024 * 1024)) throw fail('INVALID_ARGUMENT');
  if (!env || !['LINKEDIN_LI_AT', 'LINKEDIN_JSESSIONID'].every(key => typeof env[key] === 'string' && env[key].length > 0 && env[key].length <= 16384 && !/[\r\n\0]/.test(env[key]))) throw fail('CLI_FAILED');
  const secrets = [env.LINKEDIN_LI_AT, env.LINKEDIN_JSESSIONID, env.LINKEDIN_JSESSIONID.replaceAll('"', '')];
  if (env.LINKEDIN_COOKIE_HEADER !== undefined) {
    const header = env.LINKEDIN_COOKIE_HEADER;
    if (typeof header !== 'string' || Buffer.byteLength(header) > 65536) throw fail('CLI_FAILED');
    const cookies = new Map();
    for (const pair of header.split('; ')) {
      const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([\x20-\x7e]+)$/.exec(pair);
      if (!match || /[;\\]/.test(match[2]) || cookies.has(match[1])) throw fail('CLI_FAILED');
      cookies.set(match[1], match[2]);
      secrets.push(match[2], match[2].replaceAll('"', ''));
    }
    if (cookies.get('li_at') !== env.LINKEDIN_LI_AT || cookies.get('JSESSIONID') !== env.LINKEDIN_JSESSIONID) throw fail('CLI_FAILED');
  }
  const artifact = verifyArtifact();
  // 사용자 HOME의 저장 인증과 opt-in 전송 우회 설정을 읽지 않는다.
  const childEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/dev/null' };
  for (const key of ['LANG', 'LC_ALL', 'TZ', 'NODE_EXTRA_CA_CERTS', 'LINKEDIN_LI_AT', 'LINKEDIN_JSESSIONID', 'LINKEDIN_COOKIE_HEADER']) {
    if (typeof env[key] === 'string') childEnv[key] = env[key];
  }
  const args = command === 'me' ? ['profile', 'me'] : ['messaging', command];
  if (needsConversation) args.push(conversationId);
  if (command === 'send') args.push('--text-stdin');

  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(process.execPath, [artifact, ...args], { cwd: ROOT, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(fail('CLI_FAILED')); return; }
    const chunks = [];
    let size = 0;
    let stopped = false;
    const stop = () => { stopped = true; child.kill('SIGKILL'); };
    const timer = setTimeout(stop, 10000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_OUTPUT) { chunk.fill(0); stop(); return; }
      chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      size += chunk.length;
      chunk.fill(0);
      if (size > MAX_OUTPUT) stop();
    });
    child.stdin.on('error', stop);
    child.on('error', () => { stopped = true; });
    child.on('close', code => {
      clearTimeout(timer);
      const bytes = Buffer.concat(chunks);
      try {
        if (stopped || code !== 0) throw fail('CLI_FAILED');
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (secrets.some(secret => secret && (raw.includes(secret) || raw.includes(JSON.stringify(secret).slice(1, -1))))) throw fail('CLI_FAILED');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') throw fail('CLI_FAILED');
        resolve(data);
      } catch {
        reject(fail('CLI_FAILED'));
      } finally {
        bytes.fill(0);
        for (const chunk of chunks) chunk.fill(0);
        delete childEnv.LINKEDIN_LI_AT;
        delete childEnv.LINKEDIN_JSESSIONID;
        delete childEnv.LINKEDIN_COOKIE_HEADER;
        secrets.fill('');
      }
    });
    child.stdin.end(command === 'send' ? text : undefined);
  });
}
