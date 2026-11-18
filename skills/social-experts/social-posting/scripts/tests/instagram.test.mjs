import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as instagram from '../platforms/instagram.mjs';

// 합성 DOM은 선택자·직렬화 경계를 검사하며 실제 Instagram UI를 입증하지 않는다.
function photoFeed(posts, grid = false, options = {}) {
  let detailed = !grid;
  let visibleCount = options.initialVisible ?? posts.length;
  let observationError = false;
  const roots = posts.map(post => {
    let slide = 0;
    const attr = values => ({ getAttribute: name => values[name] ?? null });
    const time = { ...attr({ datetime: post.time }), closest: selector => selector === 'article' ? root : anchor };
    const anchor = { ...attr({ href: post.href }), closest: () => root, querySelector: () => post.time ? time : null };
    const author = { ...attr({ href: `/${post.author ?? 'source'}/` }), closest: () => root };
    const caption = { innerText: post.text ?? '', closest: () => root };
    const comment = { innerText: post.comment ?? '댓글', closest: () => root };
    const commentTime = { ...attr({ datetime: post.commentTime }), closest: () => root };
    const images = (post.slides ?? [[]]).map(items => items.map(image => ({
      ...attr({ alt: image.alt }), currentSrc: image.url, src: image.url,
      closest: selector => selector === 'article' ? root : image.noise ? {} : null,
      getClientRects: () => image.hidden ? [] : [{}],
    })));
    const next = { disabled: false, ...attr({}), click() {
      if (post.observeError) { observationError = true; return; }
      if (post.stalled) return;
      if (post.asyncSlide) { setImmediate(() => { slide++; }); return; }
      slide++;
    } };
    const root = {
      querySelector(selector) {
        if (selector === 'header a[href]') return author;
        if (selector === 'h1') return post.text === undefined ? null : caption;
        if (selector === 'time[datetime]') return post.time ? time : post.commentTime ? commentTime : null;
        if (selector.includes('dir="auto"')) return comment;
        if (selector.includes('Next')) return slide < images.length - 1 ? next : null;
        if (selector.includes('Go back')) return slide ? {} : null;
        if (selector === 'video') return post.video ? {} : null;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'a[href]') return post.href ? [anchor] : [];
        if (selector.includes('img[src]')) return images[slide] ?? [];
        return [];
      },
      contains: () => true,
    };
    return root;
  });
  const ids = new WeakMap(roots.map((root, index) => [root, `post-${index}`]));
  const context = vm.createContext({
    document: { querySelectorAll(selector) {
      if (selector === 'article') {
        if (observationError) throw Object.assign(Error('관찰 중단'), { code: 'EGO_EVAL_STOPPED' });
        return detailed ? roots : [];
      }
      if (selector === 'main a[href]') return posts.slice(0, visibleCount).map(post => ({ getAttribute: key => key === 'href' ? post.href : null }));
      return [];
    } },
    location: { href: 'https://www.instagram.com/source/' }, URL, crypto: webcrypto,
    [Symbol.for('aha-skills.social-posting.observation-id')]: node => ids.get(node),
  });
  const serialized = Object.entries(instagram).map(([key, value]) => `${JSON.stringify(key)}:${typeof value === 'function' ? value.toString() : JSON.stringify(value)}`);
  let clock = 0;
  const child = vm.createContext({ URL, Symbol,
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (callback, delay) => setImmediate(() => { clock += delay; callback(); }),
    PLATFORM_UI: vm.runInNewContext(`({instagram:{${serialized.join(',')}}})`),
  });
  const page = { evaluate: async (fn, arg) => vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)})`, context),
    url: async () => context.location.href,
    goto: async url => {
      context.location.href = url; detailed = !grid || /^\/p\//.test(new URL(url).pathname);
      if (grid) delete context[Symbol.for('aha-skills.social-posting.observation-id')];
    },
    waitForSelector: async () => {}, waitForFunction: async () => {},
    mouse: { move: async () => {}, wheel: async () => { if (!detailed) visibleCount = posts.length; } },
    fork: () => photoFeed(posts, false).page,
    close: async () => {},
  };
  // 플랫폼 함수도 import 없는 실제 자식 형태로 호출한다.
  child.page = page;
  vm.runInContext(`PLATFORM_UI = {instagram:{${serialized.join(',')}}}`, child);
  return { page, context, run: expression => vm.runInContext(expression, child) };
}

const photo = (id, extra = {}) => ({ url: `https://images.test/${id}.jpg`, alt: id, ...extra });

test('프로필 격자의 사진 permalink를 열어 읽고 지정 상세만 보존한다', async () => {
  const fixture = photoFeed([{ href: '/p/grid-one/', text: '하나', slides: [[photo('one')]] },
    { href: '/p/grid-two/', text: '둘', slides: [[photo('two')]] }], true);
  const posts = JSON.parse(JSON.stringify(await fixture.run('PLATFORM_UI.instagram.extractPosts(page, undefined, page.fork())')));
  assert.deepEqual(posts.map(post => post.text), ['하나', '둘']);
  assert.equal(await fixture.page.url(), 'https://www.instagram.com/source/');
});

test('사진 피드 캡션·게시자·정확 시각과 실제 관찰 사진만 함께 추출한다', async () => {
  const fixture = photoFeed([{ href: '/p/older/', text: '본문', time: '2026-11-01T10:00:00Z',
    slides: [[photo('first'), photo('avatar', { noise: true }), photo('hidden', { hidden: true })], [photo('second')]] },
  { href: '/p/recent/', text: '', author: 'other', time: '2026-11-18T01:00:00Z', slides: [[photo('only')]] }]);
  const posts = JSON.parse(JSON.stringify(await fixture.run('PLATFORM_UI.instagram.extractPosts(page)')));
  assert.equal(posts.length, 2);
  assert.equal(posts[0].publisher, 'source');
  assert.equal(posts[0].text, '본문');
  assert.equal(posts[0].time, '2026-11-01T10:00:00Z');
  assert.deepEqual(posts[0].media.map(image => image.alt), ['first', 'second']);
  assert.equal(posts[1].text, '');
  assert.equal(posts[1].publisher, 'other');
});

test('중단된 carousel은 관찰 사진만 남기며 전체 확인으로 바꾸지 않는다', async () => {
  const fixture = photoFeed([{ href: '/p/partial/', text: '', stalled: true, slides: [[photo('one')], [photo('two')]] }]);
  const [post] = JSON.parse(JSON.stringify(await fixture.run('PLATFORM_UI.instagram.extractPosts(page)')));
  assert.equal(post.time, null);
  assert.deepEqual(post.media.map(image => image.alt), ['one']);
  assert.equal(post.mediaComplete, false);
});

test('동영상은 사진 피드로 수집하지 않는다', async () => {
  const fixture = photoFeed([{ href: '/p/video/', text: '영상', video: true, slides: [[photo('thumbnail')]] }]);
  await assert.rejects(fixture.run('PLATFORM_UI.instagram.extractPosts(page, undefined, page.fork())'), error => error.code === 'EGO_EVIDENCE_MISSING');
});

test('readback은 지정 permalink의 빈 캡션과 사진만 읽고 다른 게시물 문장을 쓰지 않는다', async () => {
  const fixture = photoFeed([{ href: '/p/target/', text: '', slides: [[photo('target')]] },
    { href: '/p/other/', text: '댓글과 같은 문장', slides: [[photo('other')]] }]);
  const result = JSON.parse(JSON.stringify(await fixture.run("PLATFORM_UI.instagram.readbackPost(page, 'https://www.instagram.com/p/target/')")));
  assert.equal(result.text, '');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].alt, 'target');
  assert.equal(await fixture.run("PLATFORM_UI.instagram.readbackPost(page, 'https://www.instagram.com/p/missing/')"), null);
});

function composerFixture(options = {}) {
  const count = options.count ?? 1;
  const log = { paths: [], stages: [], clicked: 0, gotos: [] };
  let currentUrl = 'https://www.instagram.com/';
  let stage = 'select', files = [], caption = '', alts = Array(count).fill('');
  let previewsReady = !options.delayedPreview;
  const images = Array.from({ length: count }, (_, index) => ({
    width: 8, height: 6, naturalWidth: 8, naturalHeight: 6,
    src: `blob:photo-${options.reverse ? count - 1 - index : index}.jpg`,
    get complete() { return index === 0 || previewsReady; },
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: options.crop ? 6 : 8, bottom: 6, width: options.crop ? 6 : 8, height: 6 }),
    parentElement: options.clipped ? { getBoundingClientRect: () => ({ left: 0, top: 0, right: 6, bottom: 6 }), parentElement: null, clipped: true } : null,
  }));
  class Input {
    constructor(index) { this.index = index; }
    get value() { return alts[this.index]; }
    set value(value) { alts[this.index] = options.altFails ? '' : value; }
    dispatchEvent() {}
  }
  const altInputs = alts.map((_, index) => new Input(index));
  const attrs = (values, extra = {}) => ({ getAttribute: name => values[name] ?? null, ...extra });
  const next = attrs({}, { innerText: 'Next', disabled: false, click() {
    stage = stage === 'select' ? 'edit' : 'caption'; log.stages.push(stage);
  } });
  const box = { focus() {}, get innerText() { return caption; } };
  const channel = attrs({ 'aria-label': 'Share to Facebook', 'aria-checked': options.crossShare ? 'true' : 'false' });
  const heading = { innerText: options.foreignSuccess ? 'New post' : 'Your post has been shared.', getClientRects: () => options.hiddenSuccess ? [] : [{}] };
  const dialog = {
    isConnected: true,
    querySelector(selector) {
      if (selector.includes('input[type="file"]')) return { files };
      if (selector.includes('contenteditable')) return stage === 'caption' ? box : null;
      if (selector.includes('h2')) return stage === 'shared' ? heading : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('img[')) return options.partial ? images.slice(0, -1) : images;
      if (selector.includes('button') && !selector.includes('checkbox')) return [next];
      if (selector.includes('checkbox') || selector.includes('switch')) return [channel];
      if (selector.includes('input[')) return stage === 'caption' ? altInputs : [];
      if (selector === 'a[href]') return options.permalink ? [attrs({ href: '/p/new/' })] : [];
      return [];
    },
    get innerText() { return 'Share to Facebook'; },
  };
  const share = attrs({}, { disabled: false, click() {
    log.clicked++;
    if (options.clickThrows) throw Error('lost click response');
    if (!options.noEvidence) stage = 'shared';
  } });
  const document = {
    querySelectorAll: selector => selector === 'div[role="dialog"]' ? [dialog] : selector.includes('svg[aria-label="New post"]') ? [{ closest: () => ({ click() { stage = 'select'; } }) }] : [],
    querySelector: selector => selector.includes('[aria-label="Share"]') ? (stage === 'caption' ? share : null) : selector === 'div[role="dialog"]' ? dialog : dialog.querySelector(selector),
    createElement() {
      let image;
      return { width: 0, height: 0, getContext: () => ({
        drawImage(value) { image = value; },
        getImageData: () => ({ data: new Uint8Array([Number(/photo-(\d+)/.exec(image.src ?? image.name)?.[1] ?? 0)]) }),
      }) };
    },
    execCommand(_command, _flag, value) { caption = options.captionMismatch ? '잘린 캡션' : value; return true; },
  };
  const context = vm.createContext({ document, URL, Symbol, Uint8Array,
    crypto: { subtle: { digest: async (_algorithm, bytes) => bytes.buffer } },
    createImageBitmap: async file => ({ width: 8, height: 6, name: file.name, close() {} }),
    HTMLInputElement: Input, Event: class {},
    getComputedStyle: node => ({ objectFit: 'cover', overflowX: node.clipped ? 'hidden' : 'visible', overflowY: 'visible' }),
  });
  const page = {
    async setInputFiles(_selector, paths) {
      log.paths = paths; files = paths.map(path => ({ name: path.split('/').at(-1) }));
      if (options.delayedPreview) setImmediate(() => { previewsReady = true; });
    },
    async waitForSelector() {},
    async goto(url) { currentUrl = url; log.gotos.push(url); },
    async url() { return currentUrl; },
    evaluate: async (fn, argument) => vm.runInContext(`(${fn.toString()})(${JSON.stringify(argument)})`, context),
  };
  const serialized = Object.entries(instagram).map(([key, value]) => `${JSON.stringify(key)}:${typeof value === 'function' ? value.toString() : JSON.stringify(value)}`);
  let clock = 0;
  const child = vm.createContext({ page, URL, Symbol, ownProfileHref: async () => options.identity ?? '/me',
    Date: class extends Date { static now() { return clock; } },
    sleep: async delay => { clock += delay; await new Promise(setImmediate); },
    norm: value => String(value ?? '').replace(/\s+/g, ' ').trim() });
  vm.runInContext(`PLATFORM_UI = {instagram:{${serialized.join(',')}}}; cfg = PLATFORM_UI.instagram.postProfile(page, norm, sleep);`, child);
  const media = Array.from({ length: count }, (_, index) => ({ path: `/synthetic/photo-${index}.jpg`, alt: `설명 ${index}` }));
  return { log, media, child, page, context, get alts() { return alts; },
    async prepare() { child.media = media; return vm.runInContext("cfg.prepareMedia(media, code => { throw Object.assign(Error(code), {code}); })", child); },
    async verify() { return vm.runInContext("cfg.verifyBeforeShare(media, '', 'me', code => { throw Object.assign(Error(code), {code}); })", child); },
    shared() { stage = 'shared'; },
  };
}

for (const count of [1, 20]) test(`${count}장 실제 파일 순서와 alt를 편집 후 대조한다`, async () => {
  const fixture = composerFixture({ count });
  await fixture.prepare();
  await fixture.verify();
  assert.deepEqual(fixture.log.paths, fixture.media.map(image => image.path));
  assert.deepEqual(fixture.log.stages, ['edit', 'caption']);
  assert.deepEqual(fixture.alts, fixture.media.map(image => image.alt));
  fixture.shared();
  assert.equal(await vm.runInContext('cfg.evidence()', fixture.child), true);
});

for (const options of [{ count: 2, partial: true }, { count: 2, reverse: true }, { crop: true }, { clipped: true }, { altFails: true }, { crossShare: true }, { identity: '/other' }]) {
  test(`사진·순서·잘림·alt·공유·신원 불일치는 Share 전 거부한다 ${JSON.stringify(options)}`, async () => {
    const fixture = composerFixture(options);
    const code = options.identity ? 'EGO_ACCOUNT_MISMATCH' : options.crossShare ? 'EGO_READBACK_MISMATCH' : 'EGO_MEDIA_FAILED';
    await assert.rejects(async () => { await fixture.prepare(); await fixture.verify(); }, error => error.code === code);
  });
}

test('다른 위치의 성공 문구를 현재 피드 게시 증거로 쓰지 않는다', async () => {
  const fixture = composerFixture({ foreignSuccess: true });
  await fixture.prepare(); await fixture.verify(); fixture.shared();
  assert.equal(await vm.runInContext('cfg.evidence()', fixture.child), false);
});

const work = mkdtempSync(join(tmpdir(), 'instagram-vm-'));
const script = fileURLToPath(new URL('../ego-post.mjs', import.meta.url));
const modulePath = new URL('../platforms/instagram.mjs', import.meta.url).href;
test.after(() => rmSync(work, { recursive: true, force: true }));
let serial = 0;

// 공개 Instagram post는 차단한다. 실제 X childPost 전송 본문은 유지하고 가짜 VM의 호출 데이터만 바꾼다.
function transmitted(scenario = {}, command = 'post', changes = {}) {
  const directory = join(work, String(serial++));
  mkdirSync(directory);
  const executable = join(directory, 'ego');
  const logPath = join(directory, 'events.json');
  const sourcePath = join(directory, 'transmitted.js');
  const bootstrap = command === 'scan' || command === 'bootstrap';
  const program = `#!${process.execPath}
const fs = require('node:fs'), vm = require('node:vm'), webcrypto = require('node:crypto').webcrypto;
(async () => {
  const instagram = await import(${JSON.stringify(modulePath)});
  const photoFeed = ${photoFeed.toString()};
  const composerFixture = ${composerFixture.toString()};
  const options = ${JSON.stringify(scenario)};
  const fixture = ${bootstrap || command === 'readback' ? 'photoFeed(options.posts ?? [], options.grid ?? false, options)' : 'composerFixture(options)'};
  const page = fixture.page;
  const originalAll = fixture.context.document.querySelectorAll;
  let profileReads = 0;
  const own = { getAttribute: key => key === 'href' ? (options.identitySwitch && profileReads++ > 0 ? '/other/' : options.identity ?? '/me/') : null, getClientRects: () => [{}] };
  fixture.context.document.querySelectorAll = selector => /nav|navigation/.test(selector) ? [own] : originalAll(selector);
  const gotos = [];
  const goto = page.goto.bind(page);
  page.goto = async url => { gotos.push(url); await goto(options.login ? 'https://www.instagram.com/accounts/login/' : options.redirect ?? url); };
  let clock = 0;
  const log = fixture.log ?? { detailPages: 0, detailClosed: 0, profileClosed: 0 };
  if (!fixture.log) page.close = async () => { log.profileClosed++; };
  process.on('exit', () => fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({ ...log, gotos })));
  let source = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(${JSON.stringify(sourcePath)}, source);
  ${command === 'post' ? `const marker = ')("social-posting-skill", "x", ';
  const start = source.lastIndexOf(marker);
  const end = source.lastIndexOf(').catch(() => {');
  if (start < 0 || end < start) throw Error('missing actual childPost invocation');
  const args = JSON.parse('[' + source.slice(start + 2, end) + ']');
  args[1] = 'instagram'; args[2] = [options.body ?? '게시 본문'];
  source = source.slice(0, start + 2) + args.map(value => JSON.stringify(value)).join(', ') + source.slice(end);` : ''}
  const runtime = { console: options.responseLoss ? { log() {} } : console, URL, Symbol, Buffer, taskSpace: async () => ({ pages: async () => [{ label: 'one' }], page: () => page,
      newPage: async () => { log.detailPages++; const detail = page.fork(); detail.close = async () => { log.detailClosed++; }; return detail; },
    }),
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (callback, delay) => setImmediate(() => { clock += Math.min(delay, 1000); callback(); }),
    clearTimeout: handle => clearImmediate(handle),
  };
  await vm.runInNewContext(source, runtime);
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
  writeFileSync(executable, program); chmodSync(executable, 0o755);
  writeFileSync(join(directory, 'binding.json'), JSON.stringify({ transport: 'ego-post/1', executable, taskSpaceName: 'social-posting-skill', egoVersion: 'test', identity: { instagram: 'me', x: 'me' } }));
  const media = Array.from({ length: scenario.count ?? 1 }, (_, index) => ({ path: `/synthetic/photo-${index}.jpg`, alt: `설명 ${index}` }));
  const payload = command === 'post' ? { platform: 'x', format: 'single', body: '게시 본문', media, link: '', visibility: 'keep', identity: 'me' }
    : command === 'readback' ? { urls: ['https://www.instagram.com/p/target/'], bodies: [scenario.body ?? '게시 본문'] }
      : { platform: 'instagram', since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null, ...changes };
  const args = command === 'setup' ? ['setup', '--platform', 'instagram', '--force'] : command === 'bootstrap' ? ['bootstrap', '--platform', 'instagram', '--count', '2'] : [command];
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', input: JSON.stringify(payload), env: { ...process.env, SOCIAL_EGO_STATE_DIR: directory }, timeout: 10000 });
  assert.equal(result.error, undefined, result.error?.message);
  return { output: JSON.parse(result.stdout), code: result.status,
    log: existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : {},
    source: existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '', media };
}

test('관찰 중단 전 사진과 캡션은 scan에 남고 원래 중단 사유를 보존한다', () => {
  const result = transmitted({ posts: [{ href: '/p/target/', text: '먼저 읽은 캡션',
    time: '2026-11-14T12:00:00Z', observeError: true, slides: [[photo('one')], [photo('two')]] }] }, 'scan');
  assert.equal(result.output.coverage.stopReason, 'EGO_EVAL_STOPPED');
  assert.equal(result.output.candidates.length, 1);
  assert.equal(result.output.candidates[0].text, '먼저 읽은 캡션');
  assert.equal(result.output.candidates[0].media.length, 1);
});

test('프로필은 상세 조회와 분리해 다음 스크롤의 세 번째 게시물도 수집하고 보조 페이지만 닫는다', () => {
  const result = transmitted({ grid: true, initialVisible: 2, posts: ['one', 'two', 'three'].map(id => ({
    href: `/p/${id}/`, text: id, time: '2026-11-14T12:00:00Z', slides: [[photo(id)]],
  })) }, 'scan');
  assert.deepEqual(result.output.candidates.map(item => item.text), ['one', 'two', 'three']);
  assert.equal(result.log.detailPages, 1);
  assert.equal(result.log.detailClosed, 1);
  assert.equal(result.log.profileClosed, 0);
  assert.ok(result.log.gotos.every(url => !new URL(url).pathname.startsWith('/p/')));
});

test('상세 페이지에서 관찰이 중단돼도 앞 게시물과 부분 사진을 보존하고 보조 페이지만 닫는다', () => {
  const result = transmitted({ grid: true, posts: [
    { href: '/p/first/', text: '앞 글', time: '2026-11-14T12:00:00Z', slides: [[photo('first')]] },
    { href: '/p/partial/', text: '부분 글', time: '2026-11-14T12:00:00Z', observeError: true, slides: [[photo('one')], [photo('two')]] },
  ] }, 'scan');
  assert.deepEqual(result.output.candidates.map(item => item.text), ['앞 글', '부분 글']);
  assert.equal(result.output.coverage.stopReason, 'EGO_EVAL_STOPPED');
  assert.equal(result.log.detailPages, 1);
  assert.equal(result.log.detailClosed, 1);
  assert.equal(result.log.profileClosed, 0);
});

test('read-back도 중단 전에 읽은 대상 캡션과 부분 사진 및 사유를 보존한다', () => {
  const result = transmitted({ body: '관찰한 캡션', posts: [{ href: '/p/target/', text: '관찰한 캡션',
    observeError: true, slides: [[photo('one')], [photo('two')]] }] }, 'readback');
  assert.equal(result.output.status, 'READBACK_DONE');
  assert.equal(result.output.results[0].captionMatched, true);
  assert.equal(result.output.results[0].media.items.length, 1);
  assert.equal(result.output.results[0].media.complete, false);
  assert.equal(result.output.results[0].media.stopReason, 'EGO_EVAL_STOPPED');
});

for (const command of ['scan', 'readback']) test(`다음 이벤트 루프에 바뀌는 carousel을 기다린다: ${command}`, () => {
  const result = transmitted({ posts: [{ href: '/p/target/', text: '게시 본문',
    time: '2026-11-14T12:00:00Z', asyncSlide: true, slides: [[photo('one')], [photo('two')]] }] }, command);
  const media = command === 'scan' ? result.output.candidates[0].media : result.output.results[0].media.items;
  assert.equal(media.length, 2);
});

test('지연된 여러 사진 미리보기가 준비된 뒤에만 Share를 한 번 누른다', () => {
  const result = transmitted({ count: 20, delayedPreview: true, permalink: true });
  assert.equal(result.output.status, 'POSTED', JSON.stringify(result.output));
  assert.equal(result.log.paths.length, 20);
  assert.equal(result.log.clicked, 1);
});

test('실제 setup 전송 문자열은 타인 작성자가 아닌 로그인 본인 신원을 사용한다', () => {
  const result = transmitted({}, 'setup');
  assert.equal(result.code, 0);
  assert.equal(result.output.identity, 'me');
  assert.match(result.source, /childAcquireIdentityInstagram/);
});

test('실제 profile scan은 상세 이동으로 document 상태가 초기화되어도 사진 피드를 읽는다', () => {
  const result = transmitted({ grid: true, posts: [
    { href: '/p/one/', text: '하나', time: '2026-11-14T12:00:00Z', slides: [[photo('one')]] },
    { href: '/p/two/', text: '둘', time: '2026-11-14T13:00:00Z', slides: [[photo('two')]] },
  ] }, 'scan');
  assert.deepEqual(result.output.candidates.map(item => item.text), ['하나', '둘']);
  assert.equal(result.output.coverage.complete, false);
});

test('실제 scan 문자열은 빈 캡션·작성자·기간·시간 미상을 보존한다', () => {
  const result = transmitted({ posts: [
    { href: '/p/pinned/', text: '고정 과거 글', time: '2026-11-01T00:00:00Z', slides: [[photo('old')]] },
    { href: '/p/target/', text: '', author: 'other', time: '2026-11-14T12:00:00Z', slides: [[photo('source')]] },
    { href: '/p/unknown/', text: '시각 미상', commentTime: '2026-11-14T12:00:00Z', slides: [[photo('unknown')]] },
  ] }, 'scan');
  assert.equal(result.output.status, 'SCAN_DONE');
  assert.deepEqual(result.output.candidates.map(item => [item.text, item.publisher]), [['', 'other']]);
  assert.equal(result.output.identity, 'me');
  assert.equal(result.output.review[0].reason, 'UNKNOWN_TIME');
  assert.equal(result.output.coverage.complete, false);
  assert.match(result.source, /"instagram":/);
});

for (const count of [1, 20]) test(`실제 childPost 문자열: ${count}장 빈 캡션 피드는 사진→편집→캡션 뒤 Share 1회다`, () => {
  const result = transmitted({ count, body: '', permalink: true });
  assert.equal(result.output.status, 'POSTED', JSON.stringify(result.output));
  assert.deepEqual(result.log.paths, result.media.map(image => image.path));
  assert.deepEqual(result.log.stages, ['edit', 'caption']);
  assert.equal(result.log.clicked, 1);
  assert.equal(result.output.urlRecovered, true);
  assert.match(result.source, /async function childPost/);
});

for (const options of [{ count: 2, partial: true }, { count: 2, reverse: true }, { crop: true }, { clipped: true }, { altFails: true }, { crossShare: true }, { captionMismatch: true }, { identitySwitch: true }]) {
  test(`실제 childPost 문자열: Share 전 실패는 클릭 0회다 ${JSON.stringify(options)}`, () => {
    const result = transmitted(options);
    assert.equal(result.output.status, 'POST_FAILED', JSON.stringify(result.output));
    assert.equal(result.output.reason, options.identitySwitch ? 'EGO_ACCOUNT_MISMATCH' : options.captionMismatch || options.crossShare ? 'EGO_READBACK_MISMATCH' : 'EGO_MEDIA_FAILED');
    assert.equal(result.log.clicked, 0);
  });
}

for (const [options, status] of [[{}, 'POSTED'], [{ clickThrows: true }, 'POST_UNKNOWN'], [{ responseLoss: true }, 'POST_UNKNOWN'], [{ noEvidence: true }, 'POST_UNKNOWN'], [{ foreignSuccess: true }, 'POST_UNKNOWN'], [{ hiddenSuccess: true }, 'POST_UNKNOWN']]) {
  test(`실제 childPost 문자열: URL 미회수·클릭 후 불명은 재전송하지 않는다 ${JSON.stringify(options)}`, () => {
    const result = transmitted(options);
    assert.equal(result.output.status, status, JSON.stringify(result.output));
    assert.equal(result.log.clicked, 1);
    if (status === 'POSTED') assert.equal(result.output.urlRecovered, false);
  });
}

test('실제 readback 문자열은 빈 캡션도 대상 사진 근거가 있어야 일치한다', () => {
  const result = transmitted({ body: '', posts: [
    { href: '/p/target/', text: '', slides: [[photo('one')], [photo('two')]], stalled: true },
    { href: '/p/other/', text: '다른 글', slides: [[photo('foreign')]] },
  ] }, 'readback');
  assert.equal(result.output.matched, true, JSON.stringify(result.output));
  assert.equal(result.output.results[0].captionMatched, true);
  assert.equal(result.output.results[0].media.complete, false);
  assert.equal(result.output.results[0].media.items.length, 1);
});

test('실제 bootstrap 문자열은 사진 전용 글을 보존하되 캡션 샘플로 만들지 않는다', () => {
  const result = transmitted({ posts: [
    { href: '/p/photo/', slides: [[photo('only-photo')]] },
    { href: '/p/caption/', text: '실제 캡션\n둘째 문단', slides: [[photo('caption-photo')]] },
  ] }, 'bootstrap');
  assert.equal(result.code, 0);
  assert.equal(result.output.posts.length, 1);
  assert.equal(result.output.posts[0].text, '실제 캡션\n둘째 문단');
});

for (const [options, reason] of [
  [{ login: true }, 'EGO_NEEDS_LOGIN'],
  [{ redirect: 'https://other.test/' }, 'EGO_ORIGIN_MISMATCH'],
  [{ identity: '/other/' }, 'EGO_ACCOUNT_MISMATCH'],
  [{ posts: [] }, 'EGO_EVIDENCE_MISSING'],
]) test(`실제 scan 문자열은 접근·신원 실패를 빈 정상 조회로 숨기지 않는다 ${reason}`, () => {
  const result = transmitted(options, 'scan');
  assert.equal(result.output.coverage.complete, false);
  assert.equal(result.output.coverage.stopReason, reason);
  assert.equal(result.output.coverage.observedCount, 0);
});

for (const target of [
  { href: '/p/target/', text: '다른 캡션', comment: '원하는 캡션', slides: [[photo('target')]] },
  { href: '/p/target/', text: '원하는 캡션', slides: [[]] },
  { href: '/p/not-target/', text: '원하는 캡션', slides: [[photo('not-target')]] },
]) test(`실제 readback 문자열은 이웃 글·댓글의 같은 문장이나 사진으로 대상을 입증하지 않는다 ${target.href}`, () => {
  const result = transmitted({ body: '원하는 캡션', posts: [target,
    { href: '/p/recommendation/', text: '원하는 캡션', slides: [[photo('recommendation')]] },
  ] }, 'readback');
  assert.equal(result.output.status, 'READBACK_DONE');
  assert.equal(result.output.matched, false);
});
