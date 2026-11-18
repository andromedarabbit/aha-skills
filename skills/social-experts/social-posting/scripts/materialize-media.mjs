#!/usr/bin/env node
import { copyFile, link, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
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

async function storeFile(mediaDir, sourcePath, extension) {
  const file = await regularFile(sourcePath);
  const digest = await sha256(sourcePath);
  if (!/^[.]([a-z0-9]{1,10})$/.test(extension)) throw fail('INVALID_MEDIA');
  const path = join(mediaDir, `${digest}${extension}`);
  const destination = await lstat(path).catch(() => null);
  if (destination) {
    if (!destination.isFile() || destination.isSymbolicLink() || await sha256(path) !== digest) throw fail('INVALID_MEDIA');
  } else {
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await copyFile(sourcePath, temporary);
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  return { path, sha256: digest, bytes: file.size };
}

async function writeProvenance(mediaDir, digest, provenance) {
  const serialized = JSON.stringify(provenance, null, 2) + '\n';
  const provenanceSha256 = createHash('sha256').update(serialized).digest('hex');
  const path = join(mediaDir, `${digest}.${provenanceSha256}.provenance.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, serialized, { flag: 'wx' });
    await link(temporary, path);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    await regularFile(path);
    const existing = await readFile(path, 'utf8').catch(() => null);
    if (existing !== serialized) throw fail('INVALID_MEDIA');
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { provenancePath: path, provenanceSha256 };
}

export async function materializeMedia(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isAbsolute(payload.jobDir) || !Array.isArray(payload.media)) throw fail('INVALID_MEDIA');
  const mediaDir = join(payload.jobDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const result = [];
  for (const item of payload.media) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !validText(item.sourcePath) || !validText(item.alt)) throw fail('INVALID_MEDIA');
    const stored = await storeFile(mediaDir, item.sourcePath, extname(item.sourcePath).toLowerCase());
    result.push({ ...stored, alt: item.alt });
  }
  return result;
}

const IMAGE_TYPES = Object.freeze({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' });

function validHttpUrl(value) {
  if (!validText(value) || value.length > 2048) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export async function materializeFetchedMedia(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isAbsolute(payload.jobDir) || !Array.isArray(payload.media)) throw fail('INVALID_MEDIA');
  const mediaDir = join(payload.jobDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const result = [];
  for (const item of payload.media) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !validText(item.sourcePath) || !validHttpUrl(item.sourceUrl) || !validHttpUrl(item.finalUrl) || !validHttpUrl(item.sourcePostUrl) ||
        !validText(item.publisher) || !validText(item.alt) || !IMAGE_TYPES[item.contentType] ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 10 * 1024 * 1024 ||
        !validText(item.observedAt) || Number.isNaN(new Date(item.observedAt).getTime())) throw fail('INVALID_MEDIA');
    const source = await regularFile(item.sourcePath);
    if (source.size !== item.bytes || source.size > 10 * 1024 * 1024) throw fail('INVALID_MEDIA');
    const bytes = await readFile(item.sourcePath);
    const signatureMatches = {
      'image/png': bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      'image/jpeg': bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
      'image/gif': ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')),
      'image/webp': bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    };
    if (!signatureMatches[item.contentType]) throw fail('INVALID_MEDIA');
    const stored = await storeFile(mediaDir, item.sourcePath, IMAGE_TYPES[item.contentType]);
    const provenance = {
      sourceUrl: item.sourceUrl, finalUrl: item.finalUrl, sourcePostUrl: item.sourcePostUrl, publisher: item.publisher,
      observedAt: item.observedAt, alt: item.alt, contentType: item.contentType,
      sha256: stored.sha256, bytes: stored.bytes,
    };
    const receipt = await writeProvenance(mediaDir, stored.sha256, provenance);
    result.push({ ...stored, alt: item.alt, ...receipt, provenance });
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
