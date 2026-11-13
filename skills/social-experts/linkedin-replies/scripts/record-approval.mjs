#!/usr/bin/env node
import { observeHook } from './reply.mjs';

// 훅 실패는 승인을 만들지 않는다. 원시 입력·오류·본문은 출력하지 않는다.
const timer = setTimeout(() => process.exit(0), 5000);
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('INPUT_LIMIT');
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  for (const chunk of chunks) chunk.fill(0);
  await observeHook(payload);
} catch { /* 승인 없이는 send가 실패한다. */ }
finally { clearTimeout(timer); }
