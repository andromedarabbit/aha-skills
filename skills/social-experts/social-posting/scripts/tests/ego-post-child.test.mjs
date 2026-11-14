// 실제 CLI가 ego에 전송하는 자식 스크립트를 VM에서 실행한다. 외부 브라우저는 사용하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverExecutable } from '../ego-post.mjs';

const SCRIPT = fileURLToPath(new URL('../ego-post.mjs', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'ego-child-'));
test.after(() => rmSync(work, { recursive: true, force: true }));

function fakeRuntime(scenario, logPath) {
  let clock = 0, url = '', text = '', composer = false, clicked = 0, profileProbes = 0, editingAlt = false, activeAlt = 0, photoEditor = false;
  const altValues = Array(scenario.images ?? 1).fill('');
  const log = { gotos: [], clicked: 0, alt: '', alts: altValues };
  const persist = () => fs.writeFileSync(logPath, JSON.stringify(log));
  const attr = attrs => ({ getAttribute: key => attrs[key] ?? null });
  const editor = { focus() {}, get innerText() { return text; } };
  const postButton = { disabled: false, getAttribute: () => null, click() {
    clicked++; log.clicked = clicked; persist();
    if (scenario.clickThrows || clicked === scenario.clickThrowsOn) throw Object.assign(Error('lost click receipt'), { code: 'EGO_PAGE_UNRESPONSIVE' });
    if (!scenario.noEvidence) composer = false;
  } };
  const altButtons = altValues.map((_, index) => ({ click() {
    photoEditor = ['linkedin', 'facebook'].includes(scenario.platform);
    editingAlt = !photoEditor; activeAlt = index;
  } }));
  const editAlt = { getAttribute: () => null, click() { editingAlt = true; } };
  const donePhoto = { getAttribute: () => null, click() { photoEditor = false; } };
  const altInput = { get value() { return scenario.altReadMismatch ? '변경된 설명' : altValues[activeAlt]; }, set value(value) { altValues[activeAlt] = value; log.alt = value; persist(); } };
  const saveAlt = { click() { editingAlt = false; if (scenario.altLosesOnSave) altValues[activeAlt] = ''; }, getAttribute: () => null, innerText: 'Save' };
  const bodyNode = { innerText: scenario.targetText ?? '게시 본문' };
  const article = {
    querySelector(selector) {
      if (selector.includes('time')) return { closest: () => attr({ href: scenario.platform === 'bluesky' ? '/profile/me/post/1' : '/me/status/1' }) };
      if (selector.includes('a[')) return attr({ href: scenario.targetUrl ?? 'https://x.com/me/status/1' });
      return bodyNode;
    },
    querySelectorAll() { return [{ ...attr({ href: scenario.targetUrl ?? 'https://x.com/me/status/1' }), closest: () => article }]; },
    getAttribute: () => null,
  };
  const profileArticles = scenario.profilePosts?.map(({ text: body, href }) => ({
    querySelector(selector) {
      if (selector.includes('time')) return { closest: () => attr({ href }) };
      return { innerText: body };
    },
  }));
  const document = {
    body: { innerText: 'x'.repeat(300) },
    querySelector(selector) {
      if (selector.includes('AppTabBar_Profile_Link')) {
        profileProbes++;
        return profileProbes <= (scenario.profileDelay ?? 0) ? (scenario.reservedFirst ? attr({ href: '/home' }) : null) : attr({ href: '/me' });
      }
      if (selector.includes('input[autocomplete') || selector.includes('session[username')) return null;
      if (selector.endsWith('[aria-label="Edit photo"]')) return scenario.altUnavailable ? null : altButtons[0];
      if (selector.includes('[aria-label="Save"]')) return editingAlt ? saveAlt : null;
      if (selector.includes('[aria-label="Done"]')) return photoEditor ? donePhoto : null;
      if (selector.includes('textarea[aria-label="Alternative text"]')) return editingAlt ? altInput : null;
      if (selector.includes('[aria-label="Alternative text"]')) return photoEditor ? editAlt : null;
      if (selector.includes('altTextButton')) return scenario.altUnavailable ? null : altButtons[0];
      if (selector.includes('altTextInput')) return editingAlt ? altInput : null;
      if (selector.includes('altTextSave')) return editingAlt ? saveAlt : null;
      if (selector.includes('tweetButton') || selector.includes('share-actions__primary') || selector.includes('div[aria-label="Post"]') || selector === 'button[type="submit"]') return postButton;
      if (selector.includes('share-box') || selector.includes('New Post')) return { click() { composer = true; } };
      if (selector.includes('data-testid="reply"') || selector.includes('eply')) return { click() { composer = true; } };
      if (selector.includes('href^="/profile/"')) return attr({ href: '/profile/me' });
      if (selector.includes('tweetTextarea') || selector.includes('contenteditable')) {
        if (scenario.platform === 'linkedin' && selector === '.ql-editor[contenteditable="true"]') return null;
        return composer ? editor : null;
      }
      if (selector.includes('attachments') || selector.includes('blob:') || selector.includes('img[alt]') || selector.includes('share-confirmation')) return {};
      return null;
    },
    querySelectorAll(selector) {
      if (scenario.scopedAltOnly && (selector.includes('altTextSave') || selector.includes('[aria-label="Save"]') || selector.includes('[aria-label="Done"]')) && !selector.startsWith('div[role="dialog"]')) throw Error('alt save must stay inside editor dialog');
      if (selector.endsWith('[aria-label="Edit photo"]')) return scenario.altUnavailable ? [] : altButtons;
      if (selector.includes('[aria-label="Alternative text"]') || selector.includes('[aria-label="Save"]') || selector.includes('[aria-label="Done"]')) {
        const control = document.querySelector(selector);
        return control ? [control] : [];
      }
      if (selector === 'div[role="button"], button') return [{ innerText: 'your mind', click() { composer = true; } }];
      if (selector.includes('altTextButton')) return scenario.altUnavailable ? [] : altButtons;
      if (selector.includes('altTextSave')) return editingAlt ? [saveAlt] : [];
      if (selector.includes('a[data-testid]')) return [attr({ href: '/home' })];
      if (selector.includes('article') || selector.includes('feedItem') || selector.includes('data-urn')) return profileArticles ?? [article];
      return [];
    },
    execCommand(_command, _flag, value) { text = value; return true; },
  };
  const page = {
    async goto(next) {
      log.gotos.push(next); persist();
      if (scenario.replyFails && clicked && next.includes('/status/')) throw Object.assign(Error('navigation failed'), { code: 'EGO_PAGE_UNRESPONSIVE' });
      if (!/^https:\/\/[^/]+\//.test(next) || next.includes('https://x.comhttps:') || next.includes('https://bsky.apphttps:')) throw Error('bad URL');
      if (scenario.recoveryFails && clicked && !next.includes('/status/') && !next.includes('/post/')) throw Error('navigation failed');
      url = next.includes('facebook.com/me/') ? `https://www.facebook.com/profile.php?id=${scenario.facebookId ?? '111'}` : next;
      if (next.includes('/in/me/')) url = 'https://www.linkedin.com/in/me-slug/';
      if (next.includes('/compose/post')) composer = true;
    },
    async url() { return url; },
    async waitForFunction() {},
    async waitForSelector(selector, options) {
      const visible = !!document.querySelector(selector);
      if (visible !== (options.state === 'visible')) throw Error('selector state mismatch');
    },
    async evaluate(fn, arg) {
      return vm.runInNewContext(`(${fn.toString()})(arg)`, { document, arg, URL, Event: class {}, location: new URL(url) });
    },
    async fill(selector, value) {
      const input = document.querySelector(selector);
      if (!input) throw Error('missing input');
      input.value = value;
    },
    async setInputFiles() {},
    async snapshot() { return '게시 본문 unrelated reply'; },
    mouse: { async move() {}, async wheel() {} },
  };
  persist();
  return {
    taskSpace: async () => ({ pages: async () => [{ label: 'p1' }], page: () => page }),
    console,
    URL,
    Date: { now: () => clock },
    setTimeout: callback => { clock += 1000; callback(); },
  };
}

let nextId = 0;
function fixture(scenario = {}) {
  const id = nextId++;
  const logPath = join(work, `log-${id}.json`);
  const exe = join(work, `ego-${id}`);
  writeFileSync(exe, `#!${process.execPath}\nconst fs = require('node:fs'), vm = require('node:vm');\nif (process.argv[2] === '--version') { console.log('test'); process.exit(0); }\nconst runtime = (${fakeRuntime.toString()})(${JSON.stringify(scenario)}, ${JSON.stringify(logPath)});\nvm.runInNewContext(fs.readFileSync(0, 'utf8'), runtime);\n`);
  chmodSync(exe, 0o755);
  const state = join(work, `state-${id}`);
  return { exe, state, logPath };
}

function run(scenario, command = 'post', changes = {}) {
  const f = fixture(scenario);
  mkdirSync(f.state);
  const platform = scenario.platform ?? 'x';
  const identity = platform === 'facebook' ? 'profile.php?id=111' : platform === 'linkedin' ? 'me-slug' : 'me';
  writeFileSync(join(f.state, 'binding.json'), JSON.stringify({ transport: 'ego-post/1', executable: f.exe, taskSpaceName: 'social-posting-skill', egoVersion: 'test', identity: { [platform]: identity } }));
  const payload = command === 'readback' ? { urls: [scenario.requestUrl ?? 'https://x.com/me/status/1'], bodies: ['게시 본문'] } : { platform, format: 'single', body: '게시 본문', media: [], link: '', visibility: 'keep', identity, ...changes };
  const args = command === 'setup' ? ['setup', '--platform', platform, '--force'] : command === 'bootstrap' ? ['bootstrap', '--platform', platform, '--count', '1'] : [command];
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, SOCIAL_EGO_STATE_DIR: f.state }, timeout: 10000 });
  assert.equal(result.error, undefined, result.error?.message);
  return { output: JSON.parse(result.stdout), code: result.status, log: JSON.parse(readFileSync(f.logPath, 'utf8')) };
}

test('PATH의 ego-browser를 오버라이드 없이 찾는다', () => {
  const f = fixture();
  const exe = join(work, 'ego-browser');
  writeFileSync(exe, readFileSync(f.exe)); chmodSync(exe, 0o755);
  assert.equal(discoverExecutable({ PATH: work }), exe);
});
test('Facebook setup은 숫자 id를 신원에 보존한다', () => {
  assert.equal(run({ platform: 'facebook', facebookId: '222' }, 'setup').output.identity, 'profile.php?id=222');
});
test('Facebook 다른 숫자 id는 클릭 전에 차단한다', () => {
  const r = run({ platform: 'facebook', facebookId: '222' });
  assert.equal(r.output.reason, 'EGO_ACCOUNT_MISMATCH'); assert.equal(r.log.clicked, 0);
});
test('Facebook 같은 숫자 id는 게시 전 신원 확인을 통과한다', () => {
  assert.equal(run({ platform: 'facebook' }).output.status, 'POSTED');
});
test('Facebook bootstrap은 id가 포함된 프로필 URL로 간다', () => {
  assert.equal(run({ platform: 'facebook' }, 'bootstrap').log.gotos[0], 'https://www.facebook.com/profile.php?id=111');
});
test('X setup은 home 폴백이 아니라 늦게 뜨는 전용 프로필 링크를 기다린다', () => {
  assert.equal(run({ profileDelay: 2 }, 'setup').output.identity, 'me');
});
for (const platform of ['x', 'bluesky']) test(`${platform} 두 글 스레드의 답글은 절대 URL로 이동한다`, () => {
  const r = run({ platform, targetText: 'first' }, 'post', { format: 'thread', body: 'first\n=== POST ===\nsecond' });
  assert.equal(r.output.status, 'POSTED'); assert.equal(r.log.clicked, 2);
});
for (const platform of ['x', 'bluesky']) {
  const base = platform === 'x' ? 'https://x.com/me/status/' : 'https://bsky.app/profile/me/post/';
  const prefix = '같은 도입부를 반복하는 게시물입니다. '.repeat(4);
  const body = prefix + '이번 발표';
  test(`${platform} 답글은 같은 도입부의 과거 글이 아닌 전체 본문 일치 글로 간다`, () => {
    const r = run({ platform, profilePosts: [{ text: prefix + '지난 발표', href: base + 'OLD' }, { text: body, href: base + 'NEW' }] }, 'post', { format: 'thread', body: body + '\n=== POST ===\nsecond' });
    assert.equal(r.output.status, 'POSTED'); assert.equal(r.log.clicked, 2);
    assert.equal(r.log.gotos.includes(base + 'NEW'), true);
    assert.equal(r.log.gotos.includes(base + 'OLD'), false);
  });
  for (const texts of [[body, body], [prefix + '지난 발표']]) test(`${platform} 부모 본문 후보가 ${texts.length === 2 ? '중복되면' : '없으면'} 답글을 게시하지 않는다`, () => {
    const r = run({ platform, profilePosts: texts.map((text, i) => ({ text, href: base + i })) }, 'post', { format: 'thread', body: body + '\n=== POST ===\nsecond' });
    assert.equal(r.output.status, 'PARTIAL_POSTED'); assert.equal(r.output.postedCount, 1);
    assert.equal(r.log.clicked, 1); assert.deepEqual(r.output.urls, []);
  });
}

test('증거 확인 뒤 URL 이동 실패는 POSTED를 보존한다', () => {
  const r = run({ recoveryFails: true });
  assert.equal(r.output.status, 'POSTED'); assert.equal(r.output.urlRecovered, false);
});
test('스레드 첫 글 URL을 못 얻어도 게시 수를 보존한다', () => {
  const r = run({ recoveryFails: true }, 'post', { format: 'thread', body: 'first\n=== POST ===\nsecond' });
  assert.equal(r.output.status, 'PARTIAL_POSTED'); assert.equal(r.output.postedCount, 1);
});
for (const scenario of [{ noEvidence: true }, { clickThrows: true }]) test(`클릭 뒤 불명확한 결과는 POST_UNKNOWN ${JSON.stringify(scenario)}`, () => {
  const r = run(scenario); assert.equal(r.output.status, 'POST_UNKNOWN'); assert.equal(r.output.postedCount, 0); assert.equal(r.log.clicked, 1);
});
test('LinkedIn 대체 에디터가 남아 있으면 게시 증거로 보지 않는다', () => {
  assert.equal(run({ platform: 'linkedin', noEvidence: true }).output.status, 'POST_UNKNOWN');
});
for (const platform of ['x', 'bluesky']) test(`${platform} 이미지 alt를 실제 UI에 입력하고 검증한다`, () => {
  const r = run({ platform }, 'post', { media: [{ path: '/tmp/image.png', alt: '이미지 설명' }] });
  assert.equal(r.output.status, 'POSTED'); assert.equal(r.log.alt, '이미지 설명'); assert.equal(r.log.clicked, 1);
});
test('alt 저장 버튼은 미디어 에디터 dialog 안에서만 찾는다', () => {
  const r = run({ scopedAltOnly: true }, 'post', { media: [{ path: '/tmp/image.png', alt: '설명' }] });
  assert.equal(r.output.status, 'POSTED'); assert.equal(r.log.clicked, 1);
});
test('alt UI가 없으면 게시 클릭 전 실패한다', () => {
  const r = run({ altUnavailable: true }, 'post', { media: [{ path: '/tmp/image.png', alt: '설명' }] });
  assert.equal(r.output.status, 'POST_FAILED'); assert.equal(r.log.clicked, 0);
});
test('두 번째 클릭 결과가 불명이면 첫 글의 확인된 게시 수를 보존한다', () => {
  const r = run({ clickThrowsOn: 2, targetText: 'first' }, 'post', { format: 'thread', body: 'first\n=== POST ===\nsecond' });
  assert.equal(r.output.status, 'POST_UNKNOWN'); assert.equal(r.output.postedCount, 1); assert.equal(r.output.urls.length, 1);
});
test('답글 이동의 ego 네이티브 오류도 첫 글의 게시 수를 보존한다', () => {
  const r = run({ replyFails: true, targetText: 'first' }, 'post', { format: 'thread', body: 'first\n=== POST ===\nsecond' });
  assert.equal(r.output.status, 'PARTIAL_POSTED'); assert.equal(r.output.postedCount, 1); assert.equal(r.output.reason, 'EGO_PAGE_UNRESPONSIVE');
});
test('여러 이미지의 alt를 각각 적용한다', () => {
  const r = run({ images: 2 }, 'post', { media: [{ path: '/tmp/a.png', alt: '첫 이미지' }, { path: '/tmp/b.png', alt: '둘째 이미지' }] });
  assert.equal(r.output.status, 'POSTED'); assert.deepEqual(r.log.alts, ['첫 이미지', '둘째 이미지']);
});
test('alt 재확인 불일치는 게시 전에 차단한다', () => {
  const r = run({ altReadMismatch: true }, 'post', { media: [{ path: '/tmp/a.png', alt: '설명' }] });
  assert.equal(r.output.status, 'POST_FAILED'); assert.equal(r.log.clicked, 0);
});
for (const platform of ['linkedin', 'facebook']) test(`${platform} 사진 편집 UI에서 alt를 저장하고 재확인한다`, () => {
  const r = run({ platform, scopedAltOnly: true }, 'post', { media: [{ path: '/tmp/a.png', alt: '설명' }] });
  assert.equal(r.output.status, 'POSTED'); assert.equal(r.log.alt, '설명'); assert.equal(r.log.clicked, 1);
});
for (const platform of ['linkedin', 'facebook']) test(`${platform} alt UI 부재는 게시 전에 차단한다`, () => {
  const r = run({ platform, altUnavailable: true }, 'post', { media: [{ path: '/tmp/a.png', alt: '설명' }] });
  assert.equal(r.output.status, 'POST_FAILED'); assert.equal(r.log.clicked, 0);
});
test('Facebook id가 없거나 숫자가 아니면 setup을 거부한다', () => {
  for (const facebookId of ['', 'not-a-number']) assert.equal(run({ platform: 'facebook', facebookId }, 'setup').output.reason, 'EGO_IDENTITY_NOT_FOUND');
});
test('X 전용 프로필 링크도 예약 경로이면 계속 기다린다', () => {
  assert.equal(run({ profileDelay: 2, reservedFirst: true }, 'setup').output.identity, 'me');
});
test('readback은 다른 글 snapshot 문구로 대상의 다른 본문을 통과시키지 않는다', () => {
  assert.equal(run({ targetText: '다른 본문' }, 'readback').output.matched, false);
});
test('alt 저장 후 실제로 값이 보존되지 않으면 게시 전에 차단한다', () => {
  const r = run({ altLosesOnSave: true }, 'post', { media: [{ path: '/tmp/a.png', alt: '설명' }] });
  assert.equal(r.output.status, 'POST_FAILED'); assert.equal(r.log.clicked, 0);
});
for (const requestUrl of ['https://bsky.app/profile/me/post/1', 'https://www.linkedin.com/feed/update/urn:li:ugcPost:1/', 'https://www.facebook.com/permalink.php?story_fbid=1&id=111']) test(`readback은 플랫폼별 대상 본문을 검사한다: ${requestUrl}`, () => {
  assert.equal(run({ requestUrl, targetUrl: requestUrl }, 'readback').output.matched, true);
  assert.equal(run({ requestUrl, targetUrl: requestUrl, targetText: '다른 본문' }, 'readback').output.matched, false);
});
test('readback은 퍼마링크로 찾은 본문과 정확히 비교한다', () => {
  assert.equal(run({}, 'readback').output.matched, true);
  assert.equal(run({ targetUrl: 'https://x.com/me/status/2' }, 'readback').output.matched, false);
});
