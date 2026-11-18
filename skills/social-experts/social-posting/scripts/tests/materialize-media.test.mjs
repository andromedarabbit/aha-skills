import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(new URL('..', import.meta.url).pathname, 'materialize-media.mjs');
const mod = await import(SCRIPT);
const work = mkdtempSync(join(tmpdir(), 'social-media-test-'));

test('materializeMedia: regular file을 content hash 이름으로 원자적으로 복사한다', async () => {
  const source = join(work, 'photo.png');
  const jobDir = join(work, 'job');
  writeFileSync(source, 'image-bytes');
  const [media] = await mod.materializeMedia({ jobDir, media: [{ sourcePath: source, alt: '설명' }] });
  assert.match(media.path, /\/media\/[a-f0-9]{64}\.png$/);
  assert.equal(media.alt, '설명');
  assert.equal(readFileSync(media.path, 'utf8'), 'image-bytes');
});

test('materializeMedia: relative path와 symlink는 거부한다', async () => {
  const source = join(work, 'target.jpg');
  writeFileSync(source, 'image-bytes');
  const link = join(work, 'link.jpg');
  rmSync(link, { force: true });
  symlinkSync(source, link);
  await assert.rejects(() => mod.materializeMedia({ jobDir: join(work, 'job2'), media: [{ sourcePath: 'relative.jpg', alt: '설명' }] }), /INVALID_MEDIA/);
  await assert.rejects(() => mod.materializeMedia({ jobDir: join(work, 'job2'), media: [{ sourcePath: link, alt: '설명' }] }), /INVALID_MEDIA/);
});

test('materializeFetchedMedia: 다운로드 파일의 MIME·크기·출처를 검사해 보관한다', async () => {
  const source = join(work, 'download');
  const jobDir = join(work, 'job3');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  writeFileSync(source, png);
  const [media] = await mod.materializeFetchedMedia({
    jobDir,
    media: [{
      sourcePath: source,
      sourceUrl: 'https://cdn.example.test/photo',
      finalUrl: 'https://cdn.example.test/photo.png',
      sourcePostUrl: 'https://social.example.test/post/1',
      publisher: 'publisher',
      observedAt: '2026-11-15T00:00:00.000Z',
      alt: '설명',
      contentType: 'image/png',
      bytes: png.length,
    }],
  });
  assert.match(media.path, /\/media\/[a-f0-9]{64}\.png$/);
  assert.equal(JSON.parse(readFileSync(media.provenancePath, 'utf8')).sha256, media.sha256);
  assert.deepEqual(JSON.parse(readFileSync(media.provenancePath, 'utf8')).sourceUrl, 'https://cdn.example.test/photo');
  await assert.rejects(() => mod.materializeFetchedMedia({
    jobDir,
    media: [{
      sourcePath: source, sourceUrl: 'https://cdn.example.test/photo', finalUrl: 'https://cdn.example.test/photo.png', sourcePostUrl: 'https://social.example.test/post/1',
      publisher: 'publisher', observedAt: '2026-11-15T00:00:00.000Z', alt: '설명', contentType: 'text/html', bytes: png.length,
    }],
  }), /INVALID_MEDIA/);
  await assert.rejects(() => mod.materializeFetchedMedia({
    jobDir,
    media: [{
      sourcePath: source, sourceUrl: 'https://cdn.example.test/photo', finalUrl: 'https://cdn.example.test/photo.png', sourcePostUrl: 'https://social.example.test/post/1',
      publisher: 'publisher', observedAt: '2026-11-15T00:00:00.000Z', alt: '설명', contentType: 'image/png', bytes: 12,
    }],
  }), /INVALID_MEDIA/);
  for (const observedAt of [null, 1]) {
    await assert.rejects(() => mod.materializeFetchedMedia({
      jobDir,
      media: [{
        sourcePath: source, sourceUrl: 'https://cdn.example.test/photo', finalUrl: 'https://cdn.example.test/photo.png', sourcePostUrl: 'https://social.example.test/post/1',
        publisher: 'publisher', observedAt, alt: '설명', contentType: 'image/png', bytes: png.length,
      }],
    }), /INVALID_MEDIA/);
  }
  const [other] = await mod.materializeFetchedMedia({
    jobDir,
    media: [{
      sourcePath: source, sourceUrl: 'https://cdn.example.test/other', finalUrl: 'https://cdn.example.test/other.png', sourcePostUrl: 'https://social.example.test/post/2',
      publisher: 'other', observedAt: '2026-11-15T00:00:00.000Z', alt: '다른 설명', contentType: 'image/png', bytes: png.length,
    }],
  });
  assert.equal(other.path, media.path);
  assert.notEqual(other.provenancePath, media.provenancePath);
  assert.equal(JSON.parse(readFileSync(other.provenancePath, 'utf8')).publisher, 'other');
  assert.equal(JSON.parse(readFileSync(media.provenancePath, 'utf8')).sourceUrl, 'https://cdn.example.test/photo');
  writeFileSync(source, '<html>oops</html>');
  await assert.rejects(() => mod.materializeFetchedMedia({
    jobDir,
    media: [{ ...media.provenance, sourcePath: source, bytes: 17 }],
  }), /INVALID_MEDIA/);
});
