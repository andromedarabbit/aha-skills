#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8'));
if (process.versions.node.split('.')[0] !== '24') throw new Error('Node.js 24가 필요합니다.');
if (provenance.sourceCommit !== '88f775ef95c5b8ad1d3b6d1056f94ef92282b8bb' || provenance.version !== '0.1.6') throw new Error('고정 출처가 다릅니다.');
for (const [path, expected] of Object.entries(provenance.files)) {
  if (path === 'dist/index.js') continue;
  if (hash(readFileSync(join(root, path))) !== expected) throw new Error(`빌드 입력 무결성 불일치: ${path}`);
}
const dir = mkdtempSync(join(tmpdir(), 'linkedincli-build-'));
try {
  cpSync(join(root, 'upstream'), join(dir, 'source'), { recursive: true });
  const cwd = join(dir, 'source');
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, npm_config_cache: join(dir, 'npm-cache') };
  for (const [exe, args] of [
    ['/usr/bin/git', ['apply', '--unidiff-zero', join(root, 'safe-send.patch')]],
    ['/usr/bin/git', ['apply', '--unidiff-zero', join(root, 'aside-cookies.patch')]],
    ['npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--userconfig=/dev/null']],
  ]) {
    const result = spawnSync(exe, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`빌드 준비 실패: ${exe}`);
  }
  const { build } = await import(pathToFileURL(join(cwd, 'node_modules/esbuild/lib/main.js')));
  const result = await build({
    absWorkingDir: cwd, entryPoints: ['src/index.ts'], bundle: true, platform: 'node',
    format: 'esm', target: 'node24', minify: true, write: false, outfile: 'dist/index.js',
    // 여러 줄 문자열의 공백을 보존하면서 저장소 공백 fixer와 충돌하지 않게 한다.
    supported: { 'template-literal': false },
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const bytes = result.outputFiles[0].contents;
  if (hash(bytes) !== provenance.files['dist/index.js']) throw new Error('재현 빌드 산출물 해시가 다릅니다.');
  writeFileSync(join(root, 'dist/index.js'), bytes);
  console.log('고정 소스·lock·패치로 재현한 CLI 해시가 일치합니다.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
