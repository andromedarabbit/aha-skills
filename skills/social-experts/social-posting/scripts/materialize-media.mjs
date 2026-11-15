#!/usr/bin/env node
import { copyFile, lstat, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, isAbsolute, join } from 'node:path';

const fail = code => Object.assign(new Error(code), { code });
const validText = value => typeof value === 'string' && value.trim() && !value.includes('\0');

async function regularFile(path) {
  if (!isAbsolute(path)) throw fail('INVALID_MEDIA');
  const link = await lstat(path).catch(() => null);
  if (!link || link.isSymbolicLink() || !link.isFile()) throw fail('INVALID_MEDIA');
  const file = await stat(path).catch(() => null);
  if (!file || !file.isFile() || file.size < 1) throw fail('INVALID_MEDIA');
  return file;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function materializeMedia(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isAbsolute(payload.jobDir) || !Array.isArray(payload.media)) throw fail('INVALID_MEDIA');
  const mediaDir = join(payload.jobDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const result = [];
  for (const item of payload.media) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !validText(item.sourcePath) || !validText(item.alt)) throw fail('INVALID_MEDIA');
    const file = await regularFile(item.sourcePath);
    const digest = await sha256(item.sourcePath);
    const extension = extname(item.sourcePath).toLowerCase();
    if (!/^[.]([a-z0-9]{1,10})$/.test(extension)) throw fail('INVALID_MEDIA');
    const path = join(mediaDir, `${digest}${extension}`);
    const destination = await lstat(path).catch(() => null);
    if (destination) {
      if (!destination.isFile() || destination.isSymbolicLink() || await sha256(path) !== digest) throw fail('INVALID_MEDIA');
    } else {
      const temporary = `${path}.${process.pid}.tmp`;
      try {
        await copyFile(item.sourcePath, temporary);
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    }
    result.push({ path, alt: item.alt, sha256: digest, bytes: file.size });
  }
  return result;
}

async function main() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    process.stdout.write(JSON.stringify(await materializeMedia(JSON.parse(Buffer.concat(chunks).toString('utf8')))) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'FAILED', reason: error?.code ?? 'INVALID_MEDIA' }) + '\n');
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
