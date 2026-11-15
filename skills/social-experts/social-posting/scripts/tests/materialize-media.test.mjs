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
