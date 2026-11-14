#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const STATE_DIR = join(homedir(), '.local/share/aha-skills/linkedin-replies');
export const CONTRACT = Object.freeze({
  approvalHeader: 'LinkedIn 승인',
  approvalChoice: '전송',
  sendRule: '수동 job이며 계정·대화·참여자·최신 메시지 fingerprint·본문 해시·job ID·session ID·일회 challenge에 결합된 미사용 승인 영수증이 일치할 때만 전송한다.',
});

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function profile(value) {
  if (!value || typeof value.entityUrn !== 'string' || !/^urn:li:fs_miniProfile:[A-Za-z0-9_-]+$/.test(value.entityUrn)) throw new Error('UNSUPPORTED_RESPONSE');
  if (typeof value.firstName !== 'string' || typeof value.lastName !== 'string') throw new Error('UNSUPPORTED_RESPONSE');
  return { id: value.entityUrn, name: `${value.firstName} ${value.lastName}`.trim() };
}

export function normalizeAccount(raw) {
  if (raw?.data === undefined) return profile(raw?.miniProfile);
  const reference = raw?.data?.['*miniProfile'];
  if (raw.miniProfile !== undefined || typeof reference !== 'string' || !Array.isArray(raw.included)) throw new Error('UNSUPPORTED_RESPONSE');
  const matches = raw.included.filter(value => value?.entityUrn === reference);
  if (matches.length !== 1) throw new Error('UNSUPPORTED_RESPONSE');
  return profile(matches[0]);
}

function elements(raw) {
  if (!Array.isArray(raw?.elements)) throw new Error('UNSUPPORTED_RESPONSE');
  return raw.elements;
}

function participant(raw) {
  return profile(raw?.['com.linkedin.voyager.messaging.MessagingMember']?.miniProfile);
}

function threadIdentity(raw) {
  const match = /^urn:li:fs_conversation:([A-Za-z0-9_-]+)$/.exec(raw?.entityUrn);
  if (!match || !Array.isArray(raw.participants)) throw new Error('UNSUPPORTED_RESPONSE');
  const participants = raw.participants.map(participant).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (participants.length < 2 || new Set(participants.map((p) => p.id)).size !== participants.length) throw new Error('UNSUPPORTED_RESPONSE');
  return { conversationId: match[1], participants };
}

// shortcut: 합성 legacy 응답만 검증했다. 허가된 읽기 smoke 후 실제 형식 fixture를 추가한다.
export function normalizeThread(account, raw, messages) {
  let identity;
  try {
    identity = threadIdentity(raw);
    if (!identity.participants.some((p) => p.id === account.id)) throw new Error('UNSUPPORTED_RESPONSE');
    if (raw.disabled === true || raw.readOnly === true || raw.archived === true) throw new Error('UNSUPPORTED_RESPONSE');
    const seen = new Set();
    const events = elements(messages).map((value) => {
      if (typeof value?.entityUrn !== 'string' || !/^urn:li:fs_event:/.test(value.entityUrn) || seen.has(value.entityUrn)) throw new Error('UNSUPPORTED_RESPONSE');
      seen.add(value.entityUrn);
      if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || value.deleted === true) throw new Error('UNSUPPORTED_RESPONSE');
      const sender = participant(value.from);
      if (!identity.participants.some((p) => p.id === sender.id)) throw new Error('UNSUPPORTED_RESPONSE');
      const content = value.eventContent?.['com.linkedin.voyager.messaging.event.MessageEvent'];
      if (!content || Object.keys(value.eventContent).length !== 1 || content.deleted === true) throw new Error('UNSUPPORTED_RESPONSE');
      const text = content.attributedBody?.text;
      if (typeof text !== 'string' || !text.trim() || !Array.isArray(content.attachments) || content.attachments.length > 0) throw new Error('UNSUPPORTED_RESPONSE');
      return { id: value.entityUrn, senderId: sender.id, at: value.createdAt, text };
    }).sort((a, b) => b.at - a.at);
    if (!events.length || (events[1] && events[0].at === events[1].at)) throw new Error('UNSUPPORTED_RESPONSE');
    const latest = events[0];
    return {
      ...identity,
      status: latest.senderId === account.id ? 'answered' : 'candidate',
      latest,
      messages: events,
      fingerprint: digest({ accountId: account.id, conversationId: identity.conversationId, participants: identity.participants.map((p) => p.id), latest }),
    };
  } catch {
    return { status: 'review', ...(identity || {}), reason: 'UNSUPPORTED_OR_AMBIGUOUS_THREAD' };
  }
}

export async function scanRecent(account, request) {
  const listed = elements(await request('conversations'));
  const candidates = [];
  const review = [];
  const counts = new Map();
  for (const raw of listed) {
    if (typeof raw?.entityUrn === 'string') counts.set(raw.entityUrn, (counts.get(raw.entityUrn) || 0) + 1);
  }
  let inspected = 0;
  let oldest = null;
  let newest = null;
  for (const raw of listed) {
    try {
      const { conversationId } = threadIdentity(raw);
      if (counts.get(raw.entityUrn) !== 1) throw new Error('DUPLICATE_CONVERSATION');
      const normalized = normalizeThread(account, raw, await request('messages', conversationId));
      if (normalized.status === 'review') {
        review.push(normalized);
        continue;
      }
      inspected++;
      for (const message of normalized.messages) {
        oldest = oldest === null ? message.at : Math.min(oldest, message.at);
        newest = newest === null ? message.at : Math.max(newest, message.at);
      }
      if (normalized.status === 'candidate') candidates.push(normalized);
    } catch {
      review.push({ status: 'review', reason: 'CONVERSATION_READ_FAILED' });
    }
  }
  return {
    status: 'OK', account, candidates, review,
    coverage: { listed: listed.length, inspected, oldest, newest, completeness: review.length ? 'partial' : 'unknown', reason: 'CLI가 반환한 첫 목록만 검사했으며 전체 inbox 조회를 보장하지 않습니다.' },
  };
}

const fail = code => Object.assign(new Error(code), { code });
const MAX_INPUT = 2 * 1024 * 1024;
const TRANSPORT = 'linkedincli/1';

function privateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw fail('UNSAFE_STATE');
}

function ensureState() {
  let current = realpathSync(homedir());
  for (const part of ['.local', 'share', 'aha-skills', 'linkedin-replies']) {
    current = join(current, part);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UNSAFE_STATE');
  }
  privateDirectory(STATE_DIR);
  for (const name of ['jobs', 'locks', 'conversations']) {
    const path = join(STATE_DIR, name);
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    privateDirectory(path);
  }
}

function readPrivate(path, json = true) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > MAX_INPUT) throw fail('UNSAFE_STATE');
    const text = readFileSync(fd, 'utf8');
    return json ? JSON.parse(text) : text;
  } finally { closeSync(fd); }
}

function durableWrite(path, value, json = true) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, json ? JSON.stringify(value) : value, { flag: 'wx', mode: 0o600, flush: true });
    renameSync(temporary, path);
    const fd = openSync(join(path, '..'), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } finally { rmSync(temporary, { force: true }); }
}

function binding() {
  if (!existsSync(STATE_DIR)) throw fail('NEEDS_SETUP');
  privateDirectory(STATE_DIR);
  const path = join(STATE_DIR, 'binding.json');
  if (!existsSync(path)) throw fail('NEEDS_SETUP');
  const result = readPrivate(path);
  if (result.transport !== TRANSPORT) throw fail('NEEDS_SETUP');
  if (typeof result.profile !== 'string' || typeof result.account?.id !== 'string') throw fail('UNSAFE_STATE');
  return result;
}

function childEnvironment() {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', NODE_NO_WARNINGS: '1' };
  for (const key of ['HOME', 'LANG', 'LC_ALL', 'TZ', 'NODE_EXTRA_CA_CERTS']) if (typeof process.env[key] === 'string') env[key] = process.env[key];
  return env;
}

async function authenticated(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./aside-auth.mjs', import.meta.url))], { env: childEnvironment(), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    let size = 0;
    let stopped = false;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const stop = () => { stopped = true; kill(); };
    const timer = setTimeout(stop, request.command === 'authorize' ? 136000 : request.command === 'send' ? 31000 : 16000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_INPUT) { stop(); return; } output.push(chunk); });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => { stopped = true; });
    child.on('close', code => {
      clearTimeout(timer);
      kill();
      try {
        if (stopped) throw fail('AUTH_TIMEOUT');
        const value = JSON.parse(Buffer.concat(output).toString('utf8'));
        if (code !== 0 || value.status !== 'OK') {
          const allowed = ['INVALID_PROFILE', 'NEEDS_AUTH', 'CLI_UNAVAILABLE', 'CLI_FAILED', 'AUTH_TIMEOUT', 'ACCOUNT_MISMATCH'];
          throw fail(allowed.includes(value.status) ? value.status : 'CLI_FAILED');
        }
        resolve(value.data);
      } catch (error) { reject(error?.code ? error : fail('CLI_FAILED')); }
      finally { for (const chunk of output) chunk.fill(0); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

async function currentAccount(link) {
  const account = normalizeAccount(await authenticated({ profile: link.profile, command: 'me' }));
  if (account.id !== link.account.id) throw fail('ACCOUNT_MISMATCH');
  return account;
}

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const session = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const jobPath = id => join(STATE_DIR, 'jobs', `${id}.json`);
const bodyPath = id => join(STATE_DIR, 'jobs', `${id}.txt`);
const receiptPath = id => join(STATE_DIR, 'jobs', `${id}.approval.json`);
const conversationKey = job => digest([job.account.id, job.conversationId]);
const ledgerPath = job => join(STATE_DIR, 'conversations', `${conversationKey(job)}.json`);

function approvalBinding(job) {
  const { mode, transport, profile, account, conversationId, participants, fingerprint, bodyHash, jobId, sessionId, challenge } = job;
  return { mode, transport, profile, account, conversationId, participants, fingerprint, bodyHash, jobId, sessionId, challenge };
}

function readJob(id) {
  if (!uuid(id)) throw fail('INVALID_ARGUMENT');
  privateDirectory(STATE_DIR);
  privateDirectory(join(STATE_DIR, 'jobs'));
  const job = readPrivate(jobPath(id));
  if (job.jobId !== id || job.mode !== 'manual' || !session(job.sessionId) || !uuid(job.challenge) || typeof job.account?.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(job.conversationId) || !Array.isArray(job.participants) || !/^[0-9a-f]{64}$/.test(job.fingerprint) || !/^[0-9a-f]{64}$/.test(job.bodyHash) || !['pending', 'approved', 'stale', 'sending', 'sent', 'unknown'].includes(job.state)) throw fail('UNSAFE_STATE');
  return job;
}

function textFor(job) {
  const text = readPrivate(bodyPath(job.jobId), false);
  if (digest(text) !== job.bodyHash) throw fail('STALE');
  return text;
}

function approvalQuestion(job, text) {
  return {
    header: CONTRACT.approvalHeader,
    question: `실행 경로: ${job.transport}\n발신 계정: ${JSON.stringify(job.account)}\n대화 ID: ${job.conversationId}\n참여자: ${JSON.stringify(job.participants)}\n최종 본문 전체:\n${text}\n\njob ID: ${job.jobId}\nsession ID: ${job.sessionId}\nchallenge: ${job.challenge}\n이 본문을 이 대화에 전송할까요?`,
    multiSelect: false,
    options: [{ label: CONTRACT.approvalChoice, description: '표시한 계정·대화·본문으로 한 번 전송합니다.' }, { label: '수정', description: '이 승인을 폐기하고 새 초안을 준비합니다.' }, { label: '취소', description: '답장하지 않고 단기 본문을 삭제합니다.' }],
  };
}

function eraseBody(job) {
  rmSync(bodyPath(job.jobId), { force: true });
  rmSync(receiptPath(job.jobId), { force: true });
}

function stale(job) {
  job.state = 'stale';
  durableWrite(jobPath(job.jobId), job);
  eraseBody(job);
}

function unresolved(job) {
  privateDirectory(join(STATE_DIR, 'conversations'));
  if (!existsSync(ledgerPath(job))) return null;
  const ledger = readPrivate(ledgerPath(job));
  if (ledger.accountId !== job.account.id || ledger.conversationId !== job.conversationId || !['sending', 'unknown', 'sent'].includes(ledger.state)) throw fail('UNSAFE_STATE');
  // 남은 sending은 성공 여부를 추정하지 않고 unknown과 동일하게 차단한다. 락은 자동 탈취하지 않는다.
  if (['sending', 'unknown'].includes(ledger.state)) throw fail('UNKNOWN');
  return ledger;
}

async function locked(job, action) {
  privateDirectory(join(STATE_DIR, 'locks'));
  const path = join(STATE_DIR, 'locks', conversationKey(job));
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw fail('LOCKED'); throw error; }
  try { return await action(); }
  finally { rmdirSync(path); }
}

async function selectedThread(link, account, conversationId) {
  const threads = elements(await authenticated({ profile: link.profile, command: 'conversations' })).filter(raw => raw.entityUrn === `urn:li:fs_conversation:${conversationId}`);
  if (threads.length !== 1) throw fail('STALE');
  const thread = normalizeThread(account, threads[0], await authenticated({ profile: link.profile, command: 'messages', conversationId }));
  if (thread.status !== 'candidate') throw fail('STALE');
  return thread;
}

async function prepare(input) {
  if (Object.keys(input).some(key => !['conversationId', 'sessionId', 'text'].includes(key)) || typeof input.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(input.conversationId) || !session(input.sessionId) || typeof input.text !== 'string' || !input.text.trim() || input.text.includes('\0') || Buffer.byteLength(input.text) > 1024 * 1024) throw fail('INVALID_ARGUMENT');
  const link = binding();
  ensureState();
  const identity = { account: link.account, conversationId: input.conversationId };
  unresolved(identity);
  return locked(identity, async () => {
    const ledger = unresolved(identity);
    const account = await currentAccount(link);
    const thread = await selectedThread(link, account, input.conversationId);
    if (ledger?.fingerprint === thread.fingerprint) throw fail('STALE');
    for (const name of readdirSync(join(STATE_DIR, 'jobs')).filter(name => /^[0-9a-f-]{36}\.json$/.test(name))) {
      const old = readJob(name.slice(0, -5));
      if (old.account.id === account.id && old.conversationId === input.conversationId && ['pending', 'approved'].includes(old.state)) stale(old);
    }
    const job = { mode: 'manual', transport: link.transport, profile: link.profile, account, conversationId: thread.conversationId, participants: thread.participants, fingerprint: thread.fingerprint, bodyHash: digest(input.text), jobId: randomUUID(), sessionId: input.sessionId, challenge: randomUUID(), state: 'pending' };
    durableWrite(bodyPath(job.jobId), input.text, false);
    durableWrite(jobPath(job.jobId), job);
    return { status: 'OK', jobId: job.jobId, question: approvalQuestion(job, input.text) };
  });
}

export async function observeHook(payload) {
  if (!session(payload?.session_id) || !existsSync(STATE_DIR)) return;
  ensureState();
  if (payload.hook_event_name === 'SessionEnd') {
    for (const name of readdirSync(join(STATE_DIR, 'jobs')).filter(name => /^[0-9a-f-]{36}\.json$/.test(name))) {
      const job = readJob(name.slice(0, -5));
      if (job.sessionId !== payload.session_id) continue;
      if (['pending', 'approved'].includes(job.state)) await locked(job, () => stale(readJob(job.jobId)));
      if (['sent', 'unknown', 'sending', 'stale'].includes(job.state)) eraseBody(job);
    }
    return;
  }
  if (payload.hook_event_name !== 'PostToolUse' || payload.tool_name !== 'AskUserQuestion') return;
  const questions = payload.tool_input?.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return;
  const question = questions[0];
  if (question.header !== CONTRACT.approvalHeader || typeof question.question !== 'string') return;
  const match = /\njob ID: ([0-9a-f-]{36})\nsession ID: ([A-Za-z0-9_-]+)\nchallenge: ([0-9a-f-]{36})\n이 본문을 이 대화에 전송할까요\?$/.exec(question.question);
  if (!match || !uuid(match[1]) || match[2] !== payload.session_id) return;
  const candidate = readJob(match[1]);
  await locked(candidate, () => {
    const job = readJob(match[1]);
    if (job.transport !== TRANSPORT || job.sessionId !== payload.session_id || job.state !== 'pending' || job.challenge !== match[3]) return;
    const expected = approvalQuestion(job, textFor(job));
    if (question.question !== expected.question || question.multiSelect !== false || JSON.stringify(question.options) !== JSON.stringify(expected.options)) return;
    const answer = payload.tool_response?.answers?.[question.question];
    if (answer === '수정' || answer === '취소') { stale(job); return; }
    if (answer !== CONTRACT.approvalChoice) return;
    const receipt = { binding: digest(approvalBinding(job)), questionHash: digest(expected), sessionId: payload.session_id, challenge: job.challenge };
    durableWrite(receiptPath(job.jobId), receipt);
    job.state = 'approved';
    durableWrite(jobPath(job.jobId), job);
  });
}

function successEvent(raw, job, text) {
  // shortcut: 합성 legacy create 응답만 지원한다. 실응답을 관측하기 전 다른 형식은 unknown이다.
  if (typeof raw?.entityUrn !== 'string' || !raw.entityUrn.startsWith(`urn:li:fs_event:(${job.conversationId},`) || !raw.entityUrn.endsWith(')')) return null;
  try {
    if (participant(raw.from).id !== job.account.id || raw.eventContent?.['com.linkedin.voyager.messaging.event.MessageEvent']?.attributedBody?.text !== text) return null;
    return raw.entityUrn;
  } catch { return null; }
}

async function send(input) {
  if (Object.keys(input).some(key => !['jobId', 'sessionId'].includes(key)) || !uuid(input.jobId) || !session(input.sessionId)) throw fail('INVALID_ARGUMENT');
  const initial = readJob(input.jobId);
  unresolved(initial);
  return locked(initial, async () => {
    const job = readJob(input.jobId);
    unresolved(job);
    if (job.sessionId !== input.sessionId) throw fail('APPROVAL_REQUIRED');
    if (job.state === 'stale' || job.state === 'sent') throw fail('STALE');
    if (['sending', 'unknown'].includes(job.state)) throw fail('UNKNOWN');
    if (job.transport !== TRANSPORT || job.state !== 'approved' || !existsSync(receiptPath(job.jobId))) throw fail('APPROVAL_REQUIRED');
    const receipt = readPrivate(receiptPath(job.jobId));
    let text;
    try { text = textFor(job); } catch { stale(job); throw fail('STALE'); }
    if (receipt.binding !== digest(approvalBinding(job)) || receipt.questionHash !== digest(approvalQuestion(job, text)) || receipt.sessionId !== job.sessionId || receipt.challenge !== job.challenge) throw fail('APPROVAL_REQUIRED');
    const link = binding();
    if (link.profile !== job.profile || link.account.id !== job.account.id) { stale(job); throw fail('STALE'); }
    try {
      const account = await currentAccount(link);
      const thread = await selectedThread(link, account, job.conversationId);
      if (thread.fingerprint !== job.fingerprint) throw fail('STALE');
    } catch (error) { stale(job); throw error; }
    const ledger = { accountId: job.account.id, conversationId: job.conversationId, jobId: job.jobId, fingerprint: job.fingerprint, state: 'sending' };
    // ledger를 먼저 fsync한다. 이후 어느 지점에서 죽어도 새 job으로 전송을 재시도할 수 없다.
    durableWrite(ledgerPath(job), ledger);
    job.state = 'sending';
    durableWrite(jobPath(job.jobId), job);
    rmSync(receiptPath(job.jobId), { force: true });
    try {
      const response = await authenticated({ profile: job.profile, command: 'send', conversationId: job.conversationId, text, expectedAccountId: job.account.id });
      const eventId = successEvent(response, job, text);
      job.state = eventId ? 'sent' : 'unknown';
      if (eventId) ledger.eventId = eventId;
    } catch { job.state = 'unknown'; }
    ledger.state = job.state;
    durableWrite(ledgerPath(job), ledger);
    durableWrite(jobPath(job.jobId), job);
    eraseBody(job);
    return { status: job.state === 'sent' ? 'SENT' : 'UNKNOWN', jobId: job.jobId, ...(ledger.eventId ? { eventId: ledger.eventId } : {}) };
  });
}

async function inspectUi(input) {
  const { validateUiInput, listUiTabs, readUiSnapshot, UI_FAILURE_REASONS } = await import('./aside-ui.mjs');
  const operation = validateUiInput(input);
  ensureState();
  // target·실행 파일·transport 버전을 바꿔도 같은 프로필의 남은 락을 우회하지 못한다.
  const path = join(STATE_DIR, 'locks', `ui-profile-${digest([input.host, input.account, input.profileId])}`);
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw fail('LOCKED'); throw error; }
  let phase = 'UI_STATE_FAILED';
  try {
    durableWrite(join(path, 'operation.json'), { operation, attemptId: randomUUID(), startedAt: new Date().toISOString(), ownerPid: process.pid });
    const fd = openSync(join(STATE_DIR, 'locks'), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    phase = 'UI_OPERATION_FAILED';
    const observation = await (operation === 'tabs' ? listUiTabs(input) : readUiSnapshot(input));
    phase = 'UI_STATE_FAILED';
    rmSync(join(path, 'operation.json'));
    rmdirSync(path);
    return { ...observation, transport: 'aside-ui/1', accountVerified: false, bindingSaved: false };
  } catch (error) {
    // 메타데이터 유무·PID는 브라우저 작업의 종료 증거가 아니다.
    const allowed = ['UI_TARGET_MISMATCH', 'UI_ORIGIN_MISMATCH', 'UI_UNSUPPORTED_RESPONSE'];
    return {
      status: allowed.includes(error?.code) ? error.code : 'UI_OUTCOME_UNKNOWN',
      reason: UI_FAILURE_REASONS.includes(error?.reason) ? error.reason : phase,
      profileLockRetained: true,
    };
  }
}

async function inspectEgo(input) {
  const { validateEgoInput, observeEgoPages, readEgoPageSnapshot, EGO_FAILURE_REASONS, EGO_STEP_CODES } = await import('./ego-ui.mjs');
  const operation = validateEgoInput(input);
  ensureState();
  // 스페이스·실행 파일을 바꿔도 같은 ego 연결의 남은 락을 우회하지 못한다(KTD17).
  const path = join(STATE_DIR, 'locks', `ego-profile-${digest([input.executable, input.taskSpaceName])}`);
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw fail('LOCKED'); throw error; }
  let phase = 'UI_STATE_FAILED';
  try {
    durableWrite(join(path, 'operation.json'), { operation, attemptId: randomUUID(), startedAt: new Date().toISOString(), ownerPid: process.pid });
    const fd = openSync(join(STATE_DIR, 'locks'), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    phase = 'UI_OPERATION_FAILED';
    const observation = await (operation === 'pages' ? observeEgoPages(input) : readEgoPageSnapshot(input));
    phase = 'UI_STATE_FAILED';
    rmSync(join(path, 'operation.json'));
    rmdirSync(path);
    return { ...observation, transport: 'ego-ui/1', accountVerified: false, bindingSaved: false };
  } catch (error) {
    // 메타데이터 유무·PID는 브라우저 작업의 종료 증거가 아니다.
    const allowed = ['UI_TARGET_MISMATCH', 'UI_ORIGIN_MISMATCH', 'UI_UNSUPPORTED_RESPONSE', ...EGO_STEP_CODES];
    return {
      status: allowed.includes(error?.code) ? error.code : 'EGO_OUTCOME_UNKNOWN',
      reason: EGO_FAILURE_REASONS.includes(error?.reason) ? error.reason : phase,
      profileLockRetained: true,
    };
  }
}

const SIDE_EFFECT_NOTE = '/messaging/ 접속 시 마지막 활성 스레드가 자동 개방될 수 있으며(2026-11-13 관측) 이 부작용의 읽음 영향은 아직 미확정입니다. 이 설명에 대한 동의 없이는 계정 연결(binding 저장)을 진행하지 않습니다.';

async function setupEgo(input) {
  let acquired = null;
  const { acquireEgoIdentity, EGO_STEP_CODES, EGO_FAILURE_REASONS } = await import('./ego-ui.mjs');
  const firstStep = input.accountId === undefined;
  const keys = firstStep ? ['transport', 'executable', 'taskSpaceName'] : ['transport', 'executable', 'taskSpaceName', 'accountId', 'profileId'];
  if (Object.keys(input).some(key => !keys.includes(key)) || firstStep && !['ego-ui/1'].includes(input.transport) ||
      typeof input.executable !== 'string' || !input.executable.startsWith('/') || input.executable.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(input.executable) || typeof input.taskSpaceName !== 'string' ||
      !input.taskSpaceName || input.taskSpaceName.startsWith('-') || input.taskSpaceName.length > 512) throw fail('INVALID_ARGUMENT');
  ensureState();
  const path = join(STATE_DIR, 'locks', `ego-profile-${digest([input.executable, input.taskSpaceName])}`);
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw fail('LOCKED'); throw error; }
  let phase = 'UI_STATE_FAILED';
  try {
    durableWrite(join(path, 'operation.json'), { operation: 'setup', attemptId: randomUUID(), startedAt: new Date().toISOString(), ownerPid: process.pid });
    const fd = openSync(join(STATE_DIR, 'locks'), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    phase = 'UI_OPERATION_FAILED';
    const identity = await acquireEgoIdentity({ executable: input.executable, taskSpaceName: input.taskSpaceName });
    rmSync(join(path, 'operation.json'));
    rmdirSync(path);
    acquired = identity;
  } catch (error) {
    const allowed = [...EGO_STEP_CODES];
    return {
      status: allowed.includes(error?.code) ? error.code : 'EGO_OUTCOME_UNKNOWN',
      reason: EGO_FAILURE_REASONS.includes(error?.reason) ? error.reason : phase,
      profileLockRetained: true,
    };
  }
  if (firstStep) {
    return {
      status: 'CONFIRM_ACCOUNT', transport: 'ego-ui/1', taskSpaceName: input.taskSpaceName,
      account: { slug: acquired.slug, profileId: acquired.profileId },
      fingerprint: acquired.fingerprint, sideEffect: SIDE_EFFECT_NOTE,
    };
  }
  if (input.accountId !== acquired.slug || input.profileId !== acquired.profileId) throw fail('ACCOUNT_MISMATCH');
  let egoVersion = null;
  try {
    const probe = spawnSync(input.executable, ['--version'], { env: childEnvironment(), encoding: 'utf8', timeout: 10000 });
    egoVersion = probe.status === 0 && typeof probe.stdout === 'string' ? probe.stdout.split('\n')[0].trim().slice(0, 64) || null : null;
  } catch { egoVersion = null; }
  ensureState();
  durableWrite(join(STATE_DIR, 'binding.json'), {
    transport: 'ego-ui/1', executable: input.executable, taskSpaceName: input.taskSpaceName,
    egoVersion, account: { slug: acquired.slug, profileId: acquired.profileId }, fingerprint: acquired.fingerprint,
  });
  return { status: 'OK', transport: 'ego-ui/1', account: { slug: acquired.slug, profileId: acquired.profileId } };
}

function egoBinding() {
  if (!existsSync(STATE_DIR)) throw fail('NEEDS_SETUP');
  privateDirectory(STATE_DIR);
  const path = join(STATE_DIR, 'binding.json');
  if (!existsSync(path)) throw fail('NEEDS_SETUP');
  const result = readPrivate(path);
  if (result.transport !== 'ego-ui/1') throw fail('NEEDS_SETUP');
  if (typeof result.executable !== 'string' || !result.executable.startsWith('/') || typeof result.taskSpaceName !== 'string' || !result.taskSpaceName ||
      typeof result.account?.slug !== 'string' || !result.fingerprint?.labels) throw fail('UNSAFE_STATE');
  return result;
}

// G2 통과 뒤 활성 전환 지점: run()의 scan 가드를 두 줄로 교체한다 —
// `if (command === 'scan' && input.transport === 'ego-ui/1') return scanEgo(input);` +
// `if (command === 'scan' && input.transport === 'aside-ui/1') throw fail('UI_NOT_ACTIVATED');` (aside 차단 유지).
// 합성 검증은 이 함수를 직접 호출해 수행한다(진입점은 아직 가드로 막혀 있어 테스트만의 유일한 구동 경로).
export async function scanEgo(input) {
  const { scanEgoList, EGO_STEP_CODES, EGO_FAILURE_REASONS } = await import('./ego-ui.mjs');
  if (Object.keys(input).some(key => !['transport', 'executable', 'taskSpaceName', 'detailOpenCap'].includes(key)) ||
      input.transport !== 'ego-ui/1' || typeof input.executable !== 'string' || !input.executable.startsWith('/') ||
      input.executable.length > 4096 || /[\x00-\x1f\x7f]/.test(input.executable) || typeof input.taskSpaceName !== 'string' ||
      !input.taskSpaceName || input.taskSpaceName.startsWith('-') || input.taskSpaceName.length > 512) throw fail('INVALID_ARGUMENT');
  const cap = input.detailOpenCap ?? 10;
  if (!Number.isSafeInteger(cap) || cap < 0 || cap > 25) throw fail('INVALID_ARGUMENT');
  const link = egoBinding();
  if (link.executable !== input.executable || link.taskSpaceName !== input.taskSpaceName) throw fail('NEEDS_SETUP');
  ensureState();
  const path = join(STATE_DIR, 'locks', `ego-profile-${digest([input.executable, input.taskSpaceName])}`);
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw fail('LOCKED'); throw error; }
  let phase = 'UI_STATE_FAILED';
  let observed = null;
  const review = [];
  let recordWriteFailed = false;
  const candidates = [];
  const answeredNames = [];
  let capExceeded = false;
  let detailOpened = 0;
  try {
    durableWrite(join(path, 'operation.json'), { operation: 'scan', attemptId: randomUUID(), startedAt: new Date().toISOString(), ownerPid: process.pid });
    const fd = openSync(join(STATE_DIR, 'locks'), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    phase = 'UI_OPERATION_FAILED';
    observed = await scanEgoList({ executable: link.executable, taskSpaceName: link.taskSpaceName, fingerprint: link.fingerprint, deadlineMs: 100000 });
    // 관측 기록은 락 안에서 쓴다(KTD20). 원문 대신 preview·time 해시만 저장해 변경을 감지한다.
    const slug = link.account?.slug ?? null;
    for (const item of observed.items) {
      const previewHash = digest([item.preview, item.time]);
      const recordPath = join(STATE_DIR, 'conversations', `ego-obs-${digest(['ego-observation', slug, item.name])}.json`);
      let previous = null;
      try { previous = readPrivate(recordPath); } catch { previous = null; }
      const changed = !previous || previous.previewHash !== previewHash;
      try {
        durableWrite(recordPath, { name: item.name, previewHash, observedAt: new Date().toISOString(), changed });
      } catch { recordWriteFailed = true; }
      review.push({ ...item, previewHash, status: 'review', reason: 'DETAIL_NOT_PERMITTED', changed });
    }
    // 상세 계층(KTD22–24): 개방 대상 선정(기록 없음·변경 우선) → cap 내 순차 개방 → 판정·UUID 키 승격.
    const { openEgoThread } = await import('./ego-ui.mjs');
    const recordsDir = join(STATE_DIR, 'conversations');
    const order = review.map((item, index) => ({ item, index }))
      .sort((a, b) => (b.item.changed === true) - (a.item.changed === true));
    for (const { item, index } of order) {
      if (detailOpened >= cap) {
        capExceeded = true;
        item.status = 'review';
        item.reason = 'OPEN_CAP_EXCEEDED';
        continue;
      }
      let opened;
      try {
        opened = await openEgoThread({ executable: link.executable, taskSpaceName: link.taskSpaceName,
          itemIndex: item.index, itemHeading: item.name, previewPrefix: item.preview, deadlineMs: 20000 });
      } catch (error) {
        if (['EGO_NEEDS_LOGIN', 'EGO_ORIGIN_MISMATCH', 'EGO_SPACE_NAME_IN_USE'].includes(error?.code)) throw error;
        item.status = 'review';
        item.reason = `THREAD_OPEN_FAILED:${error?.code ?? String(error?.message || error).slice(0, 60)}`;
        continue;
      }
      detailOpened += 1;
      item.conversationUuid = opened.conversationUuid;
      item.lastSenderIsOther = opened.lastSenderIsOther;
      if (opened.proofMatch !== true) { item.status = 'review'; item.reason = 'LATEST_EVENT_UNPROVEN'; continue; }
      if (opened.lastSenderIsOther !== true) {
        item.status = 'answered';
        answeredNames.push(item.name);
      } else {
        item.status = 'candidate';
        candidates.push({ name: item.name, conversationUuid: opened.conversationUuid,
          preview: item.preview, time: item.time });
      }
      // UUID 키 승격(KTD23): 이름 키 기록 제거, UUID 키로 기록.
      const uuidPath = join(recordsDir, `ego-obs-${digest(['ego-observation', slug, 'uuid', opened.conversationUuid])}.json`);
      durableWrite(uuidPath, { uuid: opened.conversationUuid, name: item.name, previewHash: item.previewHash, lastSenderKind: opened.lastSenderIsOther ? 'other' : 'self', status: item.status, observedAt: new Date().toISOString() });
      rmSync(join(recordsDir, `ego-obs-${digest(['ego-observation', slug, item.name])}.json`), { force: true });
    }
    rmSync(join(path, 'operation.json'));
    rmdirSync(path);
    observed.recordWriteFailed = recordWriteFailed;
  } catch (error) {
    const allowed = [...EGO_STEP_CODES];
    return {
      status: allowed.includes(error?.code) ? error.code : 'EGO_OUTCOME_UNKNOWN',
      reason: EGO_FAILURE_REASONS.includes(error?.reason) ? error.reason : phase,
      profileLockRetained: true,
    };
  }
  const finalReview = review.filter(item => item.status === 'review');
  const openFailedCount = finalReview.filter(item => String(item.reason ?? '').startsWith('THREAD_OPEN_FAILED')).length;
  const reason = capExceeded ? '개방 상한 초과분은 미개방 검토 필요입니다'
    : openFailedCount > 0 && detailOpened === 0 ? '상세 개방이 실패해 발신자 판정을 확정하지 못했습니다'
    : openFailedCount > 0 ? '일부 항목의 상세 개방이 실패했습니다'
    : '상세 개방으로 발신자를 확정했습니다';
  return {
    status: 'OK', transport: 'ego-ui/1', candidates, review: finalReview,
    filters: observed.filters, complete: observed.complete,
    coverage: { listed: observed.itemCount, detailOpened, openCap: cap, capExceeded,
      answeredCount: answeredNames.length,
      recordWriteFailed: observed.recordWriteFailed,
      completeness: observed.complete && !capExceeded && finalReview.length === 0 && detailOpened > 0 ? 'complete' : 'partial',
      reason },
  };
}

async function run(args, input) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: { mode: { type: 'string' } }, allowPositionals: true });
  } catch {
    return { status: 'INVALID_ARGUMENT', message: 'scan/setup/prepare/send/inspect와 --mode manual|unattended만 지정하세요.' };
  }

  const mode = parsed.values.mode;
  const [command] = parsed.positionals;
  if (!['manual', 'unattended'].includes(mode) || parsed.positionals.length !== 1 || !['scan', 'setup', 'prepare', 'send', 'inspect'].includes(command)) {
    return { status: 'INVALID_ARGUMENT', message: '동작 하나와 --mode manual|unattended를 명시하세요.' };
  }
  if (mode === 'unattended' && command !== 'scan') {
    return { status: 'BLOCKED_UNATTENDED', mode, command, message: '무인 단계에서는 scan 한 번만 허용하며 질문·승인 생성·전송은 금지합니다.' };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_ARGUMENT');
  if (command === 'inspect') return input.taskSpaceName !== undefined ? inspectEgo(input) : inspectUi(input);
  if (command === 'setup' && input.transport === 'ego-ui/1') return setupEgo(input);
  if (command === 'scan' && input.transport === 'ego-ui/1') return scanEgo(input);
  if (command === 'scan' && input.transport === 'aside-ui/1') throw fail('UI_NOT_ACTIVATED');
  // 빈 입력 scan(SKILL.md의 `scan < /dev/null`)은 저장된 ego binding을 그대로 사용한다 — 무인 정기 회차의 정상 입구.
  if (command === 'scan' && !Object.keys(input).length) {
    const bindingPath = join(STATE_DIR, 'binding.json');
    if (existsSync(bindingPath)) {
      const saved = readPrivate(bindingPath);
      if (saved.transport === 'ego-ui/1') {
        if (typeof saved.executable !== 'string' || !saved.executable.startsWith('/') ||
            typeof saved.taskSpaceName !== 'string' || !saved.taskSpaceName) throw fail('UNSAFE_STATE');
        return scanEgo({ transport: 'ego-ui/1', executable: saved.executable, taskSpaceName: saved.taskSpaceName });
      }
    }
  }
  if (command === 'setup' && input.transport === 'aside-ui/1') throw fail('UI_NOT_ACTIVATED');
  if (command === 'setup') {
    if (Object.keys(input).some(key => !['profile', 'accountId'].includes(key)) || typeof input.profile !== 'string' || !/^[\p{L}\p{N}_ -]{1,128}$/u.test(input.profile) || input.profile.trim() !== input.profile) throw fail('INVALID_ARGUMENT');
    const account = normalizeAccount(await authenticated({ profile: input.profile, command: input.accountId === undefined ? 'authorize' : 'me' }));
    if (input.accountId === undefined) return { status: 'CONFIRM_ACCOUNT', profile: input.profile, account };
    if (input.accountId !== account.id) throw fail('ACCOUNT_MISMATCH');
    ensureState();
    durableWrite(join(STATE_DIR, 'binding.json'), { transport: TRANSPORT, profile: input.profile, account });
    return { status: 'OK', profile: input.profile, account };
  }
  if (command === 'scan') {
    if (Object.keys(input).length) throw fail('INVALID_ARGUMENT');
    const link = binding();
    const account = await currentAccount(link);
    return scanRecent(account, (command, conversationId) => authenticated({ profile: link.profile, command, ...(conversationId ? { conversationId } : {}) }));
  }
  if (command === 'prepare') return prepare(input);
  return send(input);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks = [];
  let size = 0;
  const timer = setTimeout(() => { process.stdout.write('{"status":"INPUT_TIMEOUT"}\n', () => process.exit(1)); }, 5000);
  let result;
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_INPUT) throw fail('INVALID_ARGUMENT');
      chunks.push(chunk);
    }
    clearTimeout(timer);
    const text = Buffer.concat(chunks).toString('utf8');
    result = await run(process.argv.slice(2), text ? JSON.parse(text) : {});
  } catch (error) {
    const allowed = ['NEEDS_SETUP', 'INVALID_ARGUMENT', 'UNSAFE_STATE', 'ACCOUNT_MISMATCH', 'UNSUPPORTED_RESPONSE', 'INVALID_PROFILE', 'NEEDS_AUTH', 'CLI_UNAVAILABLE', 'CLI_FAILED', 'AUTH_TIMEOUT', 'STALE', 'UNKNOWN', 'LOCKED', 'APPROVAL_REQUIRED', 'UI_NOT_ACTIVATED'];
    result = { status: allowed.includes(error?.code || error?.message) ? error.code || error.message : 'FAILED' };
  } finally { clearTimeout(timer); for (const chunk of chunks) chunk.fill(0); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = ['OK', 'CONFIRM_ACCOUNT', 'SENT', 'TABS_OBSERVED', 'OBSERVED', 'PAGES_OBSERVED'].includes(result.status) ? 0 : 1;
}
