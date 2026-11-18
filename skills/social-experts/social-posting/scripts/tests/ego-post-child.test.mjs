// 실제 CLI가 ego에 전송하는 자식 스크립트를 VM에서 실행한다. 외부 브라우저는 사용하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareCandidates, discoverExecutable } from '../ego-post.mjs';

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
  const scanArticles = scenario.scanPosts?.map(post => {
    const anchor = { ...attr({ href: post.href, 'aria-label': post.timestampLabel, 'data-tooltip': post.timestampTooltip }),
      closest: selector => (scenario.threadsPressable && selector.includes('pressable-container')) || (scenario.platform === 'bluesky' && selector.includes('feedItem')) ? node : null,
      querySelector: selector => selector.includes('time') && post.time ? time : null,
    };
    const time = { ...attr({ datetime: post.time, 'data-utime': post.utime }), closest: () => anchor };
    const body = { ...attr({ dir: 'auto' }), innerText: post.text ?? '', textContent: post.text ?? '',
      closest(selector) { return scenario.threadsPressable ? (selector.includes('pressable-container') ? node : null) : this; },
      contains: () => false,
      cloneNode() { return { innerText: post.text ?? '', textContent: post.text ?? '', querySelectorAll: () => [] }; },
    };
    const header = { innerText: '@actual\n12h\nPinned' };
    const headerSpans = ['@actual', '12h', 'Pinned'].map(text => ({ innerText: text, textContent: text,
      getAttribute: key => key === 'dir' ? 'auto' : null, closest: selector => selector.includes('header') ? header : node }));
    const nestedPressable = { matches: selector => selector.includes('[data-pressable-container="true"]') };
    const quotedText = { innerText: '인용 글 본문', textContent: '인용 글 본문', closest: selector => selector.includes('pressable-container') ? nestedPressable : null };
    const content = { ...body, closest: selector => selector.includes('pressable-container') ? node : null };
    const bodyLink = { ...attr({ href: 'https://example.test/details' }), innerText: '자세히', textContent: '자세히' };
    const translate = { ...attr({ role: 'button' }), innerText: 'Translate', textContent: 'Translate' };
    const richBody = { ...attr({ dir: 'auto' }), innerText: `${post.text ?? ''}\nTranslate`, textContent: `${post.text ?? ''}Translate`,
      children: [content, bodyLink, translate], childNodes: [content, bodyLink, translate],
      contains: element => [content, bodyLink, translate].includes(element),
      closest: selector => selector.includes('pressable-container') ? node : null,
      querySelector: selector => /button/.test(selector) ? translate : null,
      cloneNode() {
        let value = `${post.text ?? ''}\nTranslate`;
        return {
          get innerText() { return value; }, get textContent() { return value; },
          querySelectorAll(selector) {
            const matches = [];
            if (/button/.test(selector)) matches.push({ remove() { value = value.replace(/\n?Translate/g, ''); } });
            if (/(^|,)\s*a(?:\[|,|$)/.test(selector)) matches.push({ remove() { value = value.replace('자세히', ''); } });
            return matches;
          },
        };
      },
    };
    const node = {
      querySelector(selector) {
        if (scenario.threadsNoise && selector === 'header') return header;
        if (scenario.threadsNoise && (selector.includes('dir="auto"') || selector.includes('thread-text'))) return selector.includes('thread-text') && !selector.includes('dir="auto"') ? null : headerSpans[0];
        if (selector.includes('replyingTo') || selector.includes('replyTo')) return post.parentHref ? { ...attr({ href: post.parentHref }), closest: selector => selector.includes('quote') ? null : node } : null;
        if (selector.includes('time') || selector.includes('abbr')) return post.time || post.utime ? time : null;
        if (selector.includes('a[')) return anchor;
        return body;
      },
      querySelectorAll(selector) {
        if (scenario.threadsNoise && /span|dir="auto"/.test(selector)) return [...headerSpans, richBody, quotedText];
        if (scenario.threadsPressable && /span|dir="auto"/.test(selector)) return [body];
        if (scenario.threadsPressable && selector.includes('a[')) return [anchor];
        if (scenario.platform === 'bluesky' && selector.includes('a[')) return [anchor, ...extraLinks];
        if (!selector.includes('img')) return [];
        return images.filter(image => selector.split(',').some(branch => {
          const [container, leaf] = branch.trim().split(/\s+/);
          if (!leaf) return container === 'img[src]';
          return leaf === 'img[src]' && image.closest(container);
        }));
      },
      matches(selector) { return selector.split(',').some(branch => branch.trim() === rootSelector); },
      getAttribute: key => scenario.threadsPressable && key === 'data-pressable-container' ? 'true' : null,
      contains: element => [anchor, time, body, content, richBody, quotedText, ...headerSpans].includes(element),
    };
    const extraLinks = (post.links ?? []).map(link => ({
      ...attr({ href: link.href, 'aria-label': link.label, 'data-tooltip': link.tooltip }),
      closest(selector) {
        if (selector.includes('feedItem')) return link.scope === 'nested' ? {} : node;
        if (selector.includes('quotePost') && link.scope === 'quote') return {};
        if (selector.includes('postText') && link.scope === 'body') return body;
        if (selector.includes('avatar') && link.scope === 'avatar') return {};
        return null;
      },
      querySelector: () => null,
    }));
    const rootSelector = scenario.threadsPressable ? '[data-pressable-container="true"]' : scenario.platform === 'bluesky' ? 'div[data-testid^="feedItem"]' : scenario.platform === 'threads' ? 'article' : 'article[data-testid="tweet"]';
    const images = [];
    function container(selector, parentElement = node) { return { parentElement, matches: wanted => wanted.split(',').some(branch => branch.trim() === selector) }; }
    function linkContainer(href, parentElement = node) {
      return { ...attr({ href }), parentElement,
        matches: selector => selector.split(',').some(branch => ['a', 'a[href]'].includes(branch.trim()) || (branch.trim() === 'a[href^="/@"]' && href.startsWith('/@'))) };
    }
    const attachmentSelector = scenario.platform === 'threads' ? '[data-testid="thread-media"]' : scenario.platform === 'bluesky' ? '[data-testid="imageEmbed"]' : scenario.platform === 'facebook' ? 'a[href*="/photo"]' : '[data-testid="tweetPhoto"]';
    function addImages(media, parentElement) {
      for (const image of media ?? []) images.push({
        ...attr({ alt: image.alt }), src: image.sourceUrl, parentElement,
        closest(selector) {
          let ancestor = this.parentElement;
          while (ancestor && !ancestor.matches(selector)) ancestor = ancestor.parentElement;
          return ancestor ?? null;
        },
      });
    }
    if (scenario.threadsPressable) {
      const bodyArea = { closest: selector => selector.includes('pressable-container') ? node : null,
        querySelectorAll: selector => selector.includes('span') ? (scenario.threadsNoise ? [richBody, content, quotedText] : [body]) : [] };
      header.parentElement = node;
      header.nextElementSibling = bodyArea;
      anchor.parentElement = { parentElement: header };
      nestedPressable.parentElement = node;
    }
    addImages(post.decorativeMedia, scenario.threadsPressable ? linkContainer('/@actual') : container('[data-testid="author-and-text"]'));
    addImages(post.media, scenario.threadsPressable ? linkContainer(`${post.href}/media`) : container(attachmentSelector));
    if (scenario.threadsPressable) {
      addImages(post.foreignMedia, linkContainer('/@actual/post/other/media'));
      addImages(post.externalMedia, linkContainer('https://other.test/@actual/post/abc/media'));
    }
    addImages(post.quotedMedia, scenario.threadsPressable ? linkContainer('/@quoted/post/nested/media', nestedPressable)
      : container(attachmentSelector, container(scenario.platform === 'threads' ? '[data-testid="quoted-thread"]' : scenario.platform === 'bluesky' ? '[data-testid="quotePost"]' : '[data-testid="quoteTweet"]')));
    addImages(post.nestedMedia, container(attachmentSelector, { parentElement: node, matches: selector => selector === rootSelector }));
    return node;
  });
  let scanProbes = 0;
  const ownHrefs = scenario.ownProfileHrefs ?? (scenario.platform === 'bluesky' ? ['/profile/me'] : scenario.platform === 'threads' ? ['/@me'] : null);
  const navigation = { querySelectorAll: () => ownProfileLinks };
  const ownProfileLinks = ownHrefs?.map((href, index) => ({
    ...attr({ href, ...(scenario.threadsNavOnly ? {} : { 'aria-label': 'Profile', 'data-testid': 'bottomBarProfileBtn' }) }),
    textContent: index ? 'Profile' : 'ProfileProfile', innerText: 'Profile',
    closest: selector => /nav|navigation/.test(selector) ? navigation : null,
    getClientRects: () => [{ width: 100, height: 40 }], getBoundingClientRect: () => ({ width: 100, height: 40 }),
  }));
  const feedProfile = { ...attr({ href: scenario.platform === 'threads' ? '/@stranger' : '/profile/did:plc:stranger', 'data-testid': 'profileLink', 'aria-label': 'View profile' }),
    textContent: 'stranger', innerText: 'stranger', closest: () => null };
  const identityLinks = selector => {
    if (!ownProfileLinks) return null;
    if (/^(nav|\[role="navigation"\])$/.test(selector)) return [navigation];
    if (!/\/profile\/|\/@|Profile|profile|nav|navigation/.test(selector)) return null;
    if (scenario.threadsNavOnly && !/nav|navigation/.test(selector) && /aria-label|data-testid/.test(selector)) return [];
    if (scenario.ownProfileHrefs && (selector.includes('did:plc:') || !/nav|navigation|Profile|bottomBarProfileBtn/.test(selector))) return [feedProfile, ...ownProfileLinks];
    return ownProfileLinks;
  };
  const document = {
    body: { innerText: 'x'.repeat(300) },
    querySelector(selector) {
      const identity = identityLinks(selector);
      if (identity) return identity[0] ?? null;
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
      if (selector.includes('tweetButton') || selector.includes('share-actions__primary') || selector.includes('div[aria-label="Post"]') || selector.includes('aria-label="Post"') || selector === 'button[type="submit"]') return postButton;
      if (selector.includes('share-box') || selector.includes('New Post') || selector.includes('New thread')) return { click() { composer = true; } };
      if (selector.includes('data-testid="reply"') || selector.includes('eply')) return { click() { composer = true; } };
      if (selector.includes('href^="/@"')) return attr({ href: '/@me' });
      if (selector.includes('href^="/profile/"')) return attr({ href: '/profile/me' });
      if (selector.includes('tweetTextarea') || selector.includes('contenteditable')) {
        if (scenario.platform === 'linkedin' && selector === '.ql-editor[contenteditable="true"]') return null;
        return composer ? editor : null;
      }
      if (selector.includes('attachments') || selector.includes('blob:') || selector.includes('img[alt]') || selector.includes('share-confirmation')) return {};
      return null;
    },
    querySelectorAll(selector) {
      const identity = identityLinks(selector);
      if (identity) return identity;
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
      if (scenario.threadsPressable && selector.includes('a[href*="/post/"]')) {
        log.pressableQueries = (log.pressableQueries ?? 0) + 1; persist();
        return scanArticles.map(node => node.querySelector('a[href*="/post/"]'));
      }
      if (scenario.threadsPressable && !selector.includes('pressable-container') && (selector.includes('article') || selector.includes('data-testid="thread"'))) return [];
      if (selector.includes('pressable-container')) {
        log.pressableQueries = (log.pressableQueries ?? 0) + 1; persist();
        return scanArticles ?? [];
      }
      if (selector.includes('article') || selector.includes('feedItem') || selector.includes('data-urn') || selector.includes('thread')) {
        scanProbes++;
        if (scenario.scanFailure || (scenario.scanFailureAfterFirst && scanProbes > 1)) throw Error('profile unavailable');
        return scanArticles ?? profileArticles ?? [article];
      }
      return [];
    },
    execCommand(_command, _flag, value) { text = value; return true; },
  };
  const domContext = vm.createContext({ document, URL, crypto: require('node:crypto').webcrypto, Event: class {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) });
  let networkEnabled = false, responseRound = 0;
  const bufferedEvents = [];
  const responses = scenario.responses ?? [];
  const enqueueResponses = () => {
    if (!networkEnabled) return;
    for (const [index, response] of responses.entries()) {
      const requestId = String(index);
      if ((response.receivedRound ?? 0) === responseRound) bufferedEvents.push({ method: 'Network.responseReceived', params: {
        requestId, type: response.type ?? 'XHR', response: { url: response.url ?? 'https://www.facebook.com/api/graphql/', mimeType: response.mimeType ?? 'application/json' },
      } });
      if ((response.finishedRound ?? response.receivedRound ?? 0) === responseRound) bufferedEvents.push({ method: 'Network.loadingFinished', params: { requestId } });
    }
  };
  const page = {
    async cdp(method, params) {
      log.network ??= [];
      log.network.push(method); persist();
      if (method === 'Network.enable') { networkEnabled = true; return {}; }
      if (method === 'Network.disable') { networkEnabled = false; if (scenario.pendingCleanup) return new Promise(() => {}); return {}; }
      if (method === 'Network.getResponseBody' && scenario.pendingBody) return new Promise(() => {});
      if (method !== 'Network.getResponseBody') throw Error('unexpected CDP method');
      const response = responses[Number(params.requestId)];
      if (!response || response.bodyFailure) throw Error('content evicted from inspector cache');
      if (responseRound < (response.finishedRound ?? response.receivedRound ?? 0)) throw Error('body requested before loadingFinished');
      return { body: response.body, base64Encoded: response.base64Encoded ?? false };
    },
    async events() {
      const events = bufferedEvents.splice(0);
      log.eventReads = (log.eventReads ?? 0) + 1; persist();
      if ((scenario.pendingEvents && networkEnabled && log.eventReads > 1) || (scenario.pendingCleanupEvents && !networkEnabled)) return new Promise(() => {});
      return events;
    },
    async goto(next) {
      if (scenario.responses) { log.networkBeforeGoto = networkEnabled; enqueueResponses(); }
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
      domContext.arg = arg;
      domContext.location = new URL(url);
      return vm.runInContext(`(${fn.toString()})(arg)`, domContext);
    },
    async fill(selector, value) {
      const input = document.querySelector(selector);
      if (!input) throw Error('missing input');
      input.value = value;
    },
    async setInputFiles() {},
    async snapshot() { return '게시 본문 unrelated reply'; },
    mouse: { async move() {}, async wheel() { responseRound++; enqueueResponses(); } },
  };
  if (scenario.noObservationApi) { delete page.events; delete page.cdp; }
  persist();
  return {
    taskSpace: async () => ({ pages: async () => [{ label: 'p1' }], page: () => page }),
    console,
    URL,
    Buffer,
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (callback, delay) => setImmediate(() => {
      clock += scenario.clockStep ?? (delay > 2500 ? delay : 1000);
      log.clock = clock;
      if (delay > 2500) { log.deadlineWaits ??= []; log.deadlineWaits.push(delay); }
      persist(); callback();
    }),
    clearTimeout: handle => clearImmediate(handle),
  };
}

let nextId = 0;
function fixture(scenario = {}) {
  const id = nextId++;
  const logPath = join(work, `log-${id}.json`);
  const exe = join(work, `ego-${id}`);
  writeFileSync(exe, `#!${process.execPath}\nconst fs = require('node:fs'), vm = require('node:vm');\nif (process.argv[2] === '--version') { console.log('test'); process.exit(0); }\nconst runtime = (${fakeRuntime.toString()})(${JSON.stringify(scenario)}, ${JSON.stringify(logPath)});\nconst keepAlive = ${scenario.deadlineFixture ? 'setInterval(() => {}, 1000)' : 'null'};\nPromise.resolve(vm.runInNewContext(fs.readFileSync(0, 'utf8'), runtime)).finally(() => clearInterval(keepAlive));\n`);
  chmodSync(exe, 0o755);
  const state = join(work, `state-${id}`);
  return { exe, state, logPath };
}

function run(scenario, command = 'post', changes = {}) {
  const f = fixture(scenario);
  writeFileSync(f.logPath, JSON.stringify({ gotos: [], clicked: 0 }));
  mkdirSync(f.state);
  const platform = scenario.platform ?? 'x';
  const identity = platform === 'facebook' ? 'profile.php?id=111' : platform === 'linkedin' ? 'me-slug' : 'me';
  writeFileSync(join(f.state, 'binding.json'), JSON.stringify({ transport: 'ego-post/1', executable: f.exe, taskSpaceName: 'social-posting-skill', egoVersion: 'test', identity: { [platform]: identity } }));
  const payload = command === 'scan'
    ? { platform, since: '2026-11-14T00:00:00Z', until: '2026-11-15T00:00:00Z', cursor: null, ...changes }
    : command === 'readback' ? { urls: [scenario.requestUrl ?? 'https://x.com/me/status/1'], bodies: ['게시 본문'] } : { platform, format: 'single', body: '게시 본문', media: [], link: '', visibility: 'keep', identity, ...changes };
  const args = command === 'setup' ? ['setup', '--platform', platform, '--force'] : command === 'bootstrap' ? ['bootstrap', '--platform', platform, '--count', '1'] : [command];
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, SOCIAL_EGO_STATE_DIR: f.state }, timeout: 10000 });
  assert.equal(result.error, undefined, result.error?.message);
  return { output: JSON.parse(result.stdout), code: result.status, log: JSON.parse(readFileSync(f.logPath, 'utf8')) };
}

// DOM fixture 검증이며 실페이지 셀렉터가 검증됐다는 뜻은 아니다.
for (const [platform, url] of Object.entries({
  x: 'https://x.com/me/status/1',
  linkedin: 'https://www.linkedin.com/feed/update/urn:li:ugcPost:1',
  facebook: 'https://www.facebook.com/me/posts/1',
  bluesky: 'https://bsky.app/profile/me/post/1',
  threads: 'https://www.threads.com/@me/post/1',
})) test(`${platform}: 실제 전송 문자열의 setup·bootstrap·readback은 독립 VM에서 실행된다`, () => {
  const setup = run({ platform }, 'setup');
  assert.equal(setup.code, 0);
  assert.equal(setup.output.status, 'BOUND');
  assert.equal(setup.output.identity, platform === 'facebook' ? 'profile.php?id=111' : platform === 'linkedin' ? 'me-slug' : 'me');
  const bootstrap = run({ platform, scanPosts: [{ text: '게시 본문', href: url, time: '2026-11-14T12:00:00Z' }] }, 'bootstrap');
  assert.equal(bootstrap.code, 0);
  assert.equal(bootstrap.output.status, 'BOOTSTRAP_OBSERVED');
  assert.equal(bootstrap.output.posts[0].text, '게시 본문');
  const readback = run({ platform, requestUrl: url, targetUrl: url }, 'readback');
  assert.equal(readback.code, 0);
  assert.equal(readback.output.matched, true);
});
for (const platform of ['x', 'bluesky']) test(`${platform} scan: DOM 부모 링크를 manifest와 reply_chain 비교까지 보존한다`, () => {
  const base = platform === 'x' ? 'https://x.com/author/status/' : 'https://bsky.app/profile/author/post/';
  const parts = ['alpha bravo charlie delta', 'echo foxtrot golf hotel', 'india juliet kilo lima'];
  const scanPosts = parts.map((text, index) => ({ text, href: base + (index + 1), parentHref: index ? base + index + '?tracking=1#parent' : undefined, time: '2026-11-14T12:00:00Z' }));
  const observed = run({ platform, scanPosts: [...scanPosts].reverse() }, 'scan', { jobDir: join(work, `parent-chain-${platform}`) });
  assert.equal(observed.code, 0);
  const manifest = JSON.parse(readFileSync(observed.output.manifestPath, 'utf8'));
  assert.equal(manifest.candidates.length, 3);
  const candidate = { id: 'source', url: 'https://source.test/1', text: parts.join(' ') };
  for (const item of manifest.candidates) assert.equal(compareCandidates({ candidate, existing: [item] }).decision, 'new');
  const result = compareCandidates({ candidate, existing: manifest.candidates });
  assert.equal(result.decision, 'needs_review');
  assert.deepEqual(result.details, [{ kind: 'reply_chain', ids: [1, 2, 3].map(id => base + id), urls: [1, 2, 3].map(id => base + id) }]);
  assert.equal(manifest.candidates.find(item => item.url === base + 1).parentUrl, undefined);
  assert.equal(manifest.candidates.find(item => item.url === base + 2).parentUrl, base + 1);
  const unlinked = run({ platform, scanPosts: scanPosts.map(({ parentHref, ...post }) => post) }, 'scan');
  assert.equal(compareCandidates({ candidate, existing: unlinked.output.candidates }).decision, 'new');
  assert.equal(observed.log.clicked, 0);
});

for (const platform of ['x', 'bluesky']) test(`${platform} scan: 다른 출처·프로필 링크·자기 자신은 parent로 추측하지 않는다`, () => {
  const base = platform === 'x' ? 'https://x.com/author/status/' : 'https://bsky.app/profile/author/post/';
  const parents = ['https://other.test/author/status/9', platform === 'x' ? '/author' : '/profile/author', base + 3];
  const scanPosts = parents.map((parentHref, i) => ({ text: `관찰 ${i}`, href: base + (i + 1), parentHref, time: '2026-11-14T12:00:00Z' }));
  const result = run({ platform, scanPosts }, 'scan');
  assert.equal(result.output.candidates.length, 3);
  assert.ok(result.output.candidates.every(item => item.parentUrl === undefined));
  assert.equal(result.log.clicked, 0);
});

for (const platform of ['x', 'linkedin', 'facebook', 'bluesky', 'threads']) test(`${platform} scan: 링크 없는 같은 노드 재관찰은 멈추고 동일 본문의 다른 노드는 보존한다`, () => {
  const scanPosts = [1, 2].map(() => ({ text: '링크 미상 동일 본문', time: '2026-11-14T12:00:00Z' }));
  const result = run({ platform, scanPosts }, 'scan');
  assert.equal(result.output.candidates.length, 2);
  assert.equal(new Set(result.output.candidates.map(item => item.id)).size, 2);
  assert.equal(result.output.coverage.observedCount, 2);
  assert.equal(result.output.coverage.stopReason, 'SCROLL_STALLED');
  assert.ok(result.output.candidates.every(item => item.id === item.observationId && item.url === ''));
  assert.equal(result.log.clicked, 0);
});

for (const platform of ['x', 'threads']) test(`${platform} scan: 첨부 사진 4장만 보존하고 프로필·이모지·인용 사진을 제외한다`, () => {
  const media = Array.from({ length: 4 }, (_, i) => ({ sourceUrl: `https://cdn.test/photo${i + 1}.jpg`, alt: `사진 ${i + 1}` }));
  const result = run({ platform, scanPosts: [{
    text: '사진 첨부 글', href: platform === 'x' ? '/author/status/1' : '/@author/post/1', time: '2026-11-14T12:00:00Z', media,
    decorativeMedia: [{ sourceUrl: 'https://cdn.test/avatar.jpg', alt: '프로필' }, { sourceUrl: 'https://cdn.test/emoji.svg', alt: '이모지' }],
    quotedMedia: [{ sourceUrl: 'https://cdn.test/quoted.jpg', alt: '인용 사진' }],
  }] }, 'scan');
  assert.deepEqual(result.output.candidates[0].media, media.map((image, i) => ({ id: String(i + 1), ...image })));
  assert.equal(result.log.clicked, 0);
});

test('Bluesky scan: 같은 feedItem 사진만 보존하고 인용·중첩 feedItem 사진을 제외한다', () => {
  const media = [{ sourceUrl: 'https://cdn.test/own.jpg', alt: '직접 첨부 사진' }];
  const r = run({ platform: 'bluesky', scanPosts: [{
    text: '바깥 글', href: '/profile/author/post/1', time: '2026-11-14T12:00:00Z', media,
    quotedMedia: [{ sourceUrl: 'https://cdn.test/quoted.jpg', alt: '인용 사진' }],
    nestedMedia: [{ sourceUrl: 'https://cdn.test/nested.jpg', alt: '다른 feedItem 사진' }],
  }] }, 'scan');
  assert.equal(r.code, 0);
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].publisher, 'author');
  assert.deepEqual(r.output.candidates[0].media, [{ id: '1', ...media[0] }]);
  assert.equal(r.log.clicked, 0);
});

for (const pending of ['pendingEvents', 'pendingBody', 'pendingCleanup', 'pendingCleanupEvents']) test(`Facebook scan deadline: ${pending} 정지에도 DOM 후보와 시간 미상 글을 반환한다`, () => {
  const r = run({ platform: 'facebook', deadlineFixture: true, [pending]: true, scanPosts: [
    { href: '/other/posts/122', text: '확인한 글', time: '2026-11-14T11:00:00Z' },
    { href: '/other/posts/123', text: '시간 미상 글' },
  ], responses: pending === 'pendingBody' ? [facebookResponse(undefined, { receivedRound: 1 })] : [] }, 'scan');
  assert.equal(r.code, 0);
  assert.deepEqual(r.output.candidates.map(post => post.text), ['확인한 글']);
  assert.deepEqual(r.output.review.map(post => [post.text, post.reason]), [['시간 미상 글', 'UNKNOWN_TIME']]);
  assert.equal(r.output.coverage.observedCount, 2);
  assert.equal(r.output.coverage.complete, false);
  assert.equal(r.output.nextCursor, null);
  assert.equal(r.output.coverage.stopReason, pending === 'pendingEvents' || pending === 'pendingBody' ? 'TIME_LIMIT' : 'SCROLL_STALLED');
  assert.equal(r.log.network.filter(method => method === 'Network.disable').length, 1);
  if (pending === 'pendingBody') assert.equal(r.log.network.filter(method => method === 'Network.getResponseBody').length, 1);
  if (pending === 'pendingCleanupEvents') assert.equal(r.log.eventReads, 6);
  assert.equal(r.log.clock, 60000);
  assert.equal(r.log.clicked, 0);
});

for (const scanFailure of [false, true]) test(`Facebook scan cleanup: ${scanFailure ? '실패' : '정상'} 종료에서도 관찰을 한 번 해제한다`, () => {
  const r = run({ platform: 'facebook', scanFailure, scanPosts: [{ href: '/other/posts/123', text: '글' }] }, 'scan');
  assert.deepEqual(r.log.network, ['Network.enable', 'Network.disable']);
  assert.equal(r.log.eventReads, scanFailure ? 2 : 6);
  assert.equal(r.output.coverage.stopReason, scanFailure ? 'EGO_ATTACH_FAILED' : 'SCROLL_STALLED');
  assert.equal(r.output.coverage.complete, false);
});

test('scan: 지정한 타인 게시물 URL만 관찰하고 로그인 identity와 작성자를 구분한다', () => {
  const postUrl = 'https://x.com/author/status/42';
  const r = run({ platform: 'x', scanPosts: [
    { text: '옆 글', href: '/other/status/41', time: '2026-11-14T12:00:00Z' },
    { text: '원본', href: '/author/status/42', time: '2026-11-14T12:00:00Z' },
  ] }, 'scan', { postUrl });
  assert.equal(r.code, 0);
  assert.equal(r.output.identity, 'me');
  assert.deepEqual(r.output.candidates.map(item => item.publisher), ['author']);
  assert.equal(r.log.gotos[0], postUrl);
  assert.equal(r.log.clicked, 0);
});

test('Facebook scan은 사진 전용 글의 unix 시각과 실제 게시자를 추출한다', () => {
  const r = run({ platform: 'facebook', scanPosts: [{ href: '/other/posts/123?tracking=1', utime: '1794657600', media: [{ sourceUrl: 'https://cdn.test/photo.jpg', alt: '사진' }] }] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.000Z');
  assert.equal(r.output.candidates[0].publisher, 'other');
  assert.equal(r.output.candidates[0].url, 'https://www.facebook.com/other/posts/123');
  assert.equal(r.output.candidates[0].text, '');
  assert.equal(r.log.clicked, 0);
});
test('Facebook scan은 URL 정규화로 제거한 원본 id도 작성자 결합에 보존한다', () => {
  const r = run({ platform: 'facebook', scanPosts: [{ href: '/photo?id=222', text: '사진 글', time: '2026-11-14T12:00:00Z' }] }, 'scan');
  assert.equal(r.code, 0);
  assert.equal(r.output.candidates[0].url, 'https://www.facebook.com/photo');
  assert.equal(r.output.candidates[0].publisher, 'profile.php?id=222');
  assert.equal(r.log.clicked, 0);
});

function blueskyPost(changes = {}) {
  return { uri: 'at://did:plc:author/app.bsky.feed.post/abc', author: { did: 'did:plc:author', handle: 'author.test' },
    record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-14T12:00:00.777Z' },
    indexedAt: '2026-11-14T12:00:01.054Z', ...changes };
}
function blueskyResponse(post = blueskyPost(), changes = {}) {
  return { type: 'Fetch', url: 'https://puffball.us-east.host.bsky.network/xrpc/app.bsky.feed.getAuthorFeed?actor=author.test',
    body: JSON.stringify({ feed: [{ post, reason: { $type: 'app.bsky.feed.defs#reasonPin' } }] }), ...changes };
}
const blueskyDOMPost = { href: '/profile/author.test/post/abc', text: '첫 문단\n\n둘째 문단', timestampLabel: 'November 14, 2026 at 9:00 PM' };

test('Bluesky 수신 응답: time 태그 없는 실제 timestamp anchor와 직계 createdAt을 결합한다', () => {
  const media = [{ sourceUrl: 'https://cdn.test/own.jpg', alt: '직접 첨부 사진' }];
  const r = run({ platform: 'bluesky', scanPosts: [{ ...blueskyDOMPost, media, parentHref: '/profile/author.test/post/parent' }],
    responses: [blueskyResponse()] }, 'scan');
  assert.equal(r.code, 0);
  assert.equal(r.output.candidates.length, 1);
  const post = r.output.candidates[0];
  assert.equal(post.url, 'https://bsky.app/profile/author.test/post/abc');
  assert.equal(post.publisher, 'author.test');
  assert.equal(post.publishedAt, '2026-11-14T12:00:00.777Z');
  assert.equal(post.text, blueskyDOMPost.text);
  assert.deepEqual(post.media, [{ id: '1', ...media[0] }]);
  assert.equal(post.parentUrl, 'https://bsky.app/profile/author.test/post/parent');
  assert.equal(r.output.identity, 'me');
  assert.deepEqual(r.output.review, []);
  assert.equal(r.log.networkBeforeGoto, true);
  assert.equal(r.log.clicked, 0);
});

for (const variant of ['late', 'base64', 'did', 'public', 'tooltip', 'legacy']) test(`Bluesky 수신 응답: ${variant} 경로도 같은 글만 보강한다`, () => {
  let response = blueskyResponse();
  let post = { ...blueskyDOMPost };
  if (variant === 'late') response.finishedRound = 2;
  if (variant === 'base64') response = { ...response, body: Buffer.from(response.body).toString('base64'), base64Encoded: true };
  if (variant === 'did') post.href = '/profile/did:plc:author/post/abc';
  if (variant === 'public') response.url = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed';
  if (variant === 'tooltip') post = { ...post, timestampLabel: undefined, timestampTooltip: '2026년 11월 14일 오후 9:00' };
  if (variant === 'legacy') post = { ...post, timestampLabel: undefined, time: '2026-11-14T12:00:00Z' };
  const r = run({ platform: 'bluesky', scanPosts: [post], responses: [response] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.777Z');
  assert.equal(r.output.candidates[0].publisher, variant === 'did' ? 'did:plc:author' : 'author.test');
  assert.equal(r.output.coverage.observedCount, 1);
  assert.equal(r.output.coverage.unknownTimeCount, 0);
  assert.deepEqual(r.output.review, []);
  assert.equal(r.log.network.filter(method => method === 'Network.getResponseBody').length, 1);
});

for (const [name, response] of [
  ['다른 ID', blueskyResponse(blueskyPost({ uri: 'at://did:plc:author/app.bsky.feed.post/other' }))],
  ['다른 handle', blueskyResponse(blueskyPost({ author: { did: 'did:plc:author', handle: 'stranger.test' } }))],
  ['DID 불일치', blueskyResponse(blueskyPost({ author: { did: 'did:plc:stranger', handle: 'author.test' } }))],
  ['다른 collection', blueskyResponse(blueskyPost({ uri: 'at://did:plc:author/app.bsky.feed.repost/abc' }))],
  ['다른 record type', blueskyResponse(blueskyPost({ record: { $type: 'app.bsky.feed.repost', createdAt: '2026-11-14T12:00:00Z' } }))],
  ['invalid createdAt', blueskyResponse(blueskyPost({ record: { $type: 'app.bsky.feed.post', createdAt: 'not a date' } }))],
  ['존재하지 않는 날짜', blueskyResponse(blueskyPost({ record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-31T12:00:00Z' } }))],
  ['시간대 없는 시각', blueskyResponse(blueskyPost({ record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-14T12:00:00' } }))],
  ['indexedAt만 존재', blueskyResponse(blueskyPost({ record: { $type: 'app.bsky.feed.post' } }))],
  ['중첩 인용만 존재', blueskyResponse(blueskyPost({ record: { $type: 'app.bsky.feed.post' }, embed: { post: blueskyPost() } }))],
  ['repost reason 시각만 존재', blueskyResponse(blueskyPost({ record: { $type: 'app.bsky.feed.post' } }), { body: JSON.stringify({ feed: [{ post: blueskyPost({ record: { $type: 'app.bsky.feed.post' } }), reason: { indexedAt: '2026-11-14T12:00:00Z' } }] }) })],
  ['임의 호스트', blueskyResponse(undefined, { url: 'https://other.test/xrpc/app.bsky.feed.getAuthorFeed' })],
  ['호스트 접미사 위장', blueskyResponse(undefined, { url: 'https://host.bsky.network.evil.test/xrpc/app.bsky.feed.getAuthorFeed' })],
  ['HTTP', blueskyResponse(undefined, { url: 'http://puffball.us-east.host.bsky.network/xrpc/app.bsky.feed.getAuthorFeed' })],
  ['다른 endpoint', blueskyResponse(undefined, { url: 'https://puffball.us-east.host.bsky.network/xrpc/app.bsky.feed.getFeed' })],
  ['자격증명 URL', blueskyResponse(undefined, { url: 'https://user:pass@puffball.us-east.host.bsky.network/xrpc/app.bsky.feed.getAuthorFeed' })],
  ['다른 port', blueskyResponse(undefined, { url: 'https://puffball.us-east.host.bsky.network:444/xrpc/app.bsky.feed.getAuthorFeed' })],
  ['endpoint 접미사', blueskyResponse(undefined, { url: 'https://puffball.us-east.host.bsky.network/xrpc/app.bsky.feed.getAuthorFeed/extra' })],
  ['feed 바깥 중첩 post', blueskyResponse(undefined, { body: JSON.stringify({ data: { feed: [{ post: blueskyPost() }] } }) })],
  ['Document', blueskyResponse(undefined, { type: 'Document' })],
  ['비JSON', blueskyResponse(undefined, { body: 'not JSON' })],
  ['본문 회수 실패', blueskyResponse(undefined, { bodyFailure: true })],
  ['응답 없음', null],
]) test(`Bluesky 수신 응답: ${name}은 UNKNOWN_TIME을 유지한다`, () => {
  const r = run({ platform: 'bluesky', scanPosts: [blueskyDOMPost], responses: response ? [response] : [] }, 'scan');
  assert.deepEqual(r.output.candidates, []);
  assert.equal(r.output.review.length, 1);
  assert.equal(r.output.review[0].url, 'https://bsky.app/profile/author.test/post/abc');
  assert.equal(r.output.review[0].reason, 'UNKNOWN_TIME');
  assert.equal(r.output.review[0].publishedAt, null);
  assert.equal(r.output.coverage.observedCount, 1);
  assert.equal(r.log.clicked, 0);
});

for (const scope of ['quote', 'nested', 'body', 'avatar']) test(`Bluesky timestamp anchor: ${scope} 링크를 대상 글로 사용하지 않는다`, () => {
  const r = run({ platform: 'bluesky', scanPosts: [{ ...blueskyDOMPost, href: undefined, timestampLabel: undefined,
    links: [{ href: blueskyDOMPost.href, label: blueskyDOMPost.timestampLabel, scope }] }], responses: [blueskyResponse()] }, 'scan');
  assert.deepEqual(r.output.candidates, []);
  assert.equal(r.output.review[0].url, '');
  assert.equal(r.output.review[0].reason, 'UNKNOWN_TIME');
});

test('Bluesky timestamp anchor: 다른 owned URL은 모호하여 거부하고 quote·nested 링크는 무시한다', () => {
  const noisy = ['quote', 'nested', 'body', 'avatar'].map(scope => ({ href: '/profile/stranger.test/post/other', label: blueskyDOMPost.timestampLabel, scope }));
  const good = run({ platform: 'bluesky', scanPosts: [{ ...blueskyDOMPost, links: noisy }], responses: [blueskyResponse()] }, 'scan');
  assert.equal(good.output.candidates.length, 1);
  const ambiguous = run({ platform: 'bluesky', scanPosts: [{ ...blueskyDOMPost, links: [...noisy, { href: '/profile/author.test/post/other', label: blueskyDOMPost.timestampLabel }] }], responses: [blueskyResponse()] }, 'scan');
  assert.deepEqual(ambiguous.output.candidates, []);
  assert.equal(ambiguous.output.review[0].url, '');
  assert.equal(ambiguous.output.review[0].reason, 'UNKNOWN_TIME');
});

test('Bluesky 수신 응답: 24시간 범위는 createdAt 밀리초의 [since, until)로 판정한다', () => {
  const since = '2026-11-14T12:00:00.777Z', until = '2026-11-15T12:00:00.777Z';
  for (const [createdAt, count] of [
    ['2026-11-14T12:00:00.776Z', 0], [since, 1], ['2026-11-15T12:00:00.776Z', 1], [until, 0],
  ]) {
    const r = run({ platform: 'bluesky', scanPosts: [blueskyDOMPost], responses: [blueskyResponse(blueskyPost({
      record: { $type: 'app.bsky.feed.post', createdAt },
    }))] }, 'scan', { since, until });
    assert.equal(r.output.candidates.length, count, createdAt);
    assert.equal(r.output.review.length, 0);
    assert.equal(r.output.coverage.observedNewest, createdAt);
  }
});

test('Bluesky 수신 응답: 관찰 API가 없어도 DOM의 본문·사진·부모와 UNKNOWN_TIME을 보존한다', () => {
  const media = [{ sourceUrl: 'https://cdn.test/own.jpg', alt: '직접 사진' }];
  const r = run({ platform: 'bluesky', noObservationApi: true, scanPosts: [{ ...blueskyDOMPost, media,
    parentHref: '/profile/author.test/post/parent' }], responses: [blueskyResponse()] }, 'scan');
  assert.deepEqual(r.output.candidates, []);
  assert.equal(r.output.review[0].reason, 'UNKNOWN_TIME');
  assert.equal(r.output.review[0].text, blueskyDOMPost.text);
  assert.equal(r.output.review[0].url, 'https://bsky.app/profile/author.test/post/abc');
  assert.deepEqual(r.output.review[0].media, [{ id: '1', ...media[0] }]);
  assert.equal(r.output.review[0].parentUrl, 'https://bsky.app/profile/author.test/post/parent');
});

for (const scanFailure of [false, true]) test(`Bluesky scan cleanup: ${scanFailure ? '실패' : '정상'} 종료에서도 관찰을 한 번 해제한다`, () => {
  const r = run({ platform: 'bluesky', scanFailure, scanPosts: [blueskyDOMPost] }, 'scan');
  assert.deepEqual(r.log.network, ['Network.enable', 'Network.disable']);
  assert.equal(r.output.coverage.stopReason, scanFailure ? 'EGO_ATTACH_FAILED' : 'SCROLL_STALLED');
});

for (const pending of ['pendingEvents', 'pendingBody', 'pendingCleanup', 'pendingCleanupEvents']) test(`Bluesky scan deadline: ${pending}에도 UNKNOWN_TIME과 cleanup을 보존한다`, () => {
  const r = run({ platform: 'bluesky', deadlineFixture: true, [pending]: true, scanPosts: [blueskyDOMPost],
    responses: pending === 'pendingBody' ? [blueskyResponse(undefined, { receivedRound: 1 })] : [] }, 'scan');
  assert.equal(r.code, 0);
  assert.deepEqual(r.output.candidates, []);
  assert.equal(r.output.review[0].reason, 'UNKNOWN_TIME');
  assert.equal(r.output.coverage.complete, false);
  assert.equal(r.output.nextCursor, null);
  assert.equal(r.log.network.filter(method => method === 'Network.disable').length, 1);
  assert.equal(r.log.clock, 60000);
});

function facebookStory(changes = {}) {
  return { __typename: 'Story', post_id: '123', permalink_url: 'https://www.facebook.com/other/posts/123',
    actors: [{ id: '456', url: 'https://www.facebook.com/other', __typename: 'User' }], creation_time: 1794657600, ...changes };
}

function facebookResponse(story = facebookStory(), changes = {}) {
  return { body: JSON.stringify({ data: { node: story } }), ...changes };
}

test('Facebook 수신 응답: 이동 전에 관찰을 준비하고 같은 Story의 epoch 초를 UTC로 보강한다', () => {
  const r = run({ platform: 'facebook', scanPosts: [{ href: '/other/posts/123', text: '응답 시각으로 확인한 글' }],
    responses: [facebookResponse()] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.000Z');
  assert.equal(r.output.candidates[0].publisher, 'other');
  assert.equal(r.output.review.length, 0);
  assert.equal(r.log.networkBeforeGoto, true);
  assert.equal(r.log.clicked, 0);
});

test('Facebook 수신 응답: node_v2 HTML wrapper와 timestamp.story의 시각을 같은 Story에 결합한다', () => {
  const timestamp = { id: 'opaque-story', url: 'https://www.facebook.com/other/posts/123', creation_time: 1794657600,
    actors: facebookStory().actors };
  const story = facebookStory({ id: 'opaque-story', creation_time: undefined, comet_sections: { timestamp: { story: timestamp } } });
  const envelope = { require: [['Loader', null, null, [{ __bbox: { require: [['Renderer', null, null,
    [null, { __bbox: { result: { data: { node_v2: story } } } }]] ] } }]]] };
  const r = run({ platform: 'facebook', scanPosts: [{ href: '/other/posts/123', text: 'HTML에서 읽은 글' }],
    responses: [{ type: 'Document', url: 'https://www.facebook.com/profile.php?id=111', mimeType: 'text/html',
      body: `<script type="application/json" data-sjs>${JSON.stringify(envelope)}</script>` }] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.000Z');
});

test('Facebook 수신 응답: timeline edges의 typed Story 시각을 대상 DOM 글에 결합한다', () => {
  const body = JSON.stringify({ data: { node: { timeline_list_feed_units: { edges: [{ node: facebookStory() }] } } } });
  const r = run({ platform: 'facebook', scanPosts: [{ href: '/other/posts/123', text: '타임라인 글' }], responses: [{ body }] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.000Z');
});

test('Facebook 수신 응답: responseReceived 뒤 loadingFinished가 늦어져도 같은 글 한 건만 보강한다', () => {
  const r = run({ platform: 'facebook', scanPosts: [{ href: '/other/posts/123', text: '늦은 응답' }],
    responses: [facebookResponse(undefined, { receivedRound: 0, finishedRound: 2 })] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.000Z');
  assert.equal(r.output.coverage.observedCount, 1);
  assert.equal(r.output.coverage.unknownTimeCount, 0);
  assert.deepEqual(r.output.review, []);
  assert.equal(r.log.network.filter(method => method === 'Network.getResponseBody').length, 1);
});

test('Facebook 수신 응답: 줄 단위 GraphQL 응답에서 대상 Story만 보강한다', () => {
  const unrelated = facebookResponse(facebookStory({ post_id: '999', permalink_url: 'https://www.facebook.com/other/posts/999', creation_time: 1794654000 }));
  const r = run({ platform: 'facebook', scanPosts: [{ href: '/other/posts/123', text: '분할 응답 글' }],
    responses: [{ body: `${unrelated.body}\n${facebookResponse().body}\n` }] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.000Z');
  assert.equal(r.output.coverage.observedCount, 1);
});

test('Facebook 수신 응답: 문자열과 base64, Document의 JSON script는 같은 사진 전용 후보를 만든다', () => {
  const response = facebookResponse();
  const media = [{ sourceUrl: 'https://cdn.test/photo.jpg', alt: '사진' }];
  const variants = [response,
    { ...response, body: Buffer.from(response.body).toString('base64'), base64Encoded: true },
    { ...response, type: 'Document', url: 'https://www.facebook.com/other', mimeType: 'text/html',
      body: `<html><script type="application/json" data-sjs>${response.body}</script></html>` },
  ];
  for (const variant of variants) {
    const r = run({ platform: 'facebook', scanPosts: [{ href: '/other/posts/123', media }], responses: [variant] }, 'scan');
    assert.equal(r.output.candidates.length, 1);
    assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.000Z');
    assert.equal(r.output.candidates[0].text, '');
    assert.deepEqual(r.output.candidates[0].media, [{ id: '1', ...media[0] }]);
  }
});

for (const [name, story] of [
  ['다른 게시물 ID', facebookStory({ post_id: '999' })],
  ['다른 permalink', facebookStory({ permalink_url: 'https://www.facebook.com/other/posts/999' })],
  ['다른 작성자', facebookStory({ actors: [{ id: 'stranger', url: 'https://www.facebook.com/stranger' }] })],
  ['장치 생성시각', { __typename: 'Device', creation_time: 1794657600 }],
  ['중첩 인용', facebookStory({ creation_time: undefined, attached_story: facebookStory({ post_id: '999', permalink_url: 'https://www.facebook.com/other/posts/999' }) })],
]) test(`Facebook 수신 응답: ${name}의 시각을 대상 글에 섞지 않는다`, () => {
  const r = run({ platform: 'facebook', scanPosts: [{ href: '/other/posts/123', text: '대상 글' }], responses: [facebookResponse(story)] }, 'scan');
  assert.deepEqual(r.output.candidates, []);
  assert.equal(r.output.review.length, 1);
  assert.equal(r.output.review[0].reason, 'UNKNOWN_TIME');
  assert.equal(r.output.coverage.unknownTimeCount, 1);
  assert.ok(r.log.network?.includes('Network.getResponseBody'), '완료된 응답 본문 회수 경로에 도달해야 한다');
  assert.equal(r.log.clicked, 0);
});

for (const [name, response, noObservationApi] of [
  ['비JSON', { body: 'not JSON' }],
  ['잘린 JSON', { body: '{"data":{"node":' }],
  ['알 수 없는 구조', { body: JSON.stringify({ payload: { creation_time: 1794657600 } }) }],
  ['본문 회수 실패', facebookResponse(undefined, { bodyFailure: true })],
  ['관찰 API 부재', facebookResponse(), true],
]) test(`Facebook 수신 응답: ${name}에서도 기존 후보와 시간 미상 글을 보존한다`, () => {
  const r = run({ platform: 'facebook', noObservationApi, scanPosts: [
    { href: '/other/posts/122', text: '이미 확인한 글', time: '2026-11-14T11:00:00Z' },
    { href: '/other/posts/123', text: '시간 미상 글' },
  ], responses: [response] }, 'scan');
  assert.deepEqual(r.output.candidates.map(item => item.text), ['이미 확인한 글']);
  assert.equal(r.output.review.length, 1);
  assert.equal(r.output.review[0].text, '시간 미상 글');
  assert.equal(r.output.review[0].reason, 'UNKNOWN_TIME');
  assert.equal(r.output.coverage.observedCount, 2);
  assert.equal(r.output.coverage.complete, false);
  assert.equal(r.output.nextCursor, null);
  if (!noObservationApi) assert.ok(r.log.network?.includes('Network.getResponseBody'), '완료된 응답 본문 회수 경로에 도달해야 한다');
});

test('Facebook 수신 응답: 관찰을 추가해도 기존 60초 deadline을 넘겨 수집하지 않는다', () => {
  const r = run({ platform: 'facebook', clockStep: 30000,
    scanPosts: [{ href: '/other/posts/123', text: '수집한 글' }], responses: [facebookResponse()] }, 'scan');
  assert.equal(r.output.coverage.stopReason, 'TIME_LIMIT');
  assert.equal(r.output.coverage.complete, false);
  assert.equal(r.output.candidates.length, 1);
});

test('Bluesky scan은 사진과 같은 도입부의 서로 다른 글을 보존하고 URL 중복만 제거한다', () => {
  const text = '동일한 도입부 '.repeat(20);
  const posts = ['1', '2', '2?tracking=1'].map(id => ({ text, href: `/profile/actual/post/${id}`, time: '2026-11-14T12:00:00Z', media: [{ sourceUrl: 'https://cdn.test/image.jpg', alt: '사진' }] }));
  const r = run({ platform: 'bluesky', scanPosts: posts }, 'scan');
  assert.equal(r.output.candidates.length, 2);
  assert.equal(r.output.candidates[0].publisher, 'actual');
  assert.equal(r.output.candidates[0].media.length, 1);
  assert.equal(r.output.coverage.stopReason, 'SCROLL_STALLED');
  assert.equal(r.output.coverage.complete, false);
});
test('시간 미상 글은 최근 글로 단정하지 않고 검토 목록에 보존한다', () => {
  const r = run({ platform: 'facebook', scanPosts: [{ text: '시간을 못 읽은 글', href: '/other/posts/123' }] }, 'scan');
  assert.equal(r.output.candidates.length, 0);
  assert.equal(r.output.review[0].reason, 'UNKNOWN_TIME');
  assert.equal(r.output.review[0].publisher, 'other');
  assert.equal(r.output.coverage.unknownTimeCount, 1);
});
test('고정글·시간 역전과 50건 상한을 수집 완료로 취급하지 않는다', () => {
  const posts = Array.from({ length: 55 }, (_, i) => ({ text: `글 ${i}`, href: `/me/status/${i}`, time: i === 0 ? '2020-01-01T00:00:00Z' : '2026-11-14T12:00:00Z' }));
  const r = run({ scanPosts: posts }, 'scan');
  assert.equal(r.output.candidates.length, 49);
  assert.equal(r.output.coverage.stopReason, 'POST_LIMIT');
  assert.equal(r.output.coverage.complete, false);
  assert.equal(r.output.nextCursor, null);
});
test('scan 접근 실패는 빈 정상 결과로 숨지 않는다', () => {
  const r = run({ scanPosts: [], scanFailure: true }, 'scan');
  assert.equal(r.output.coverage.stopReason, 'EGO_ATTACH_FAILED');
  assert.equal(r.output.coverage.complete, false);
});

test('scan은 관찰 시간 상한과 일부 수집 뒤 접근 실패를 구분한다', () => {
  const scanPosts = [{ href: '/me/status/1', text: '읽은 글', time: '2026-11-14T12:00:00Z' }];
  const timed = run({ scanPosts, clockStep: 30000 }, 'scan');
  assert.equal(timed.output.coverage.stopReason, 'TIME_LIMIT');
  assert.equal(timed.output.candidates.length, 1);
  const failed = run({ scanPosts, scanFailureAfterFirst: true }, 'scan');
  assert.equal(failed.output.coverage.stopReason, 'EGO_ATTACH_FAILED');
  assert.equal(failed.output.candidates.length, 1);
});

test('bootstrap은 사진 전용 글을 보이스 원문에 넣지 않고 본문 개행을 보존한다', () => {
  const text = '첫 문단\n\n둘째 문단';
  const r = run({ scanPosts: [
    { href: '/me/status/photo', media: [{ sourceUrl: 'https://cdn.test/photo.jpg', alt: '사진' }] },
    { href: '/me/status/text', text, time: '2026-11-14T12:00:00Z' },
  ] }, 'bootstrap');
  assert.deepEqual(Object.keys(r.output).sort(), ['posts', 'status']);
  assert.equal(r.output.posts.length, 1);
  assert.equal(r.output.posts[0].text, text);
});

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
test('Threads setup은 handle을 읽지만 직접 게시는 실행 전에 차단한다', () => {
  assert.equal(run({ platform: 'threads' }, 'setup').output.identity, 'me');
  const r = run({ platform: 'threads' });
  assert.equal(r.output.status, 'POST_FAILED');
  assert.equal(r.output.reason, 'THREADS_UNVERIFIED');
  assert.equal(r.code, 1);
  assert.deepEqual(r.log, { gotos: [], clicked: 0 });
});
test('Threads 신원: 속성 없는 navigation own 링크의 반응형 중복은 같은 본인으로 읽는다', () => {
  const r = run({ platform: 'threads', threadsNavOnly: true, ownProfileHrefs: ['/@me', '/@me'] }, 'setup');
  assert.equal(r.output.identity, 'me');
  assert.equal(r.log.clicked, 0);
});

test('Threads 신원: navigation의 서로 다른 own handle은 본인으로 바인딩하지 않는다', () => {
  const r = run({ platform: 'threads', threadsNavOnly: true, ownProfileHrefs: ['/@me', '/@other'] }, 'setup');
  assert.equal(r.output.reason, 'EGO_IDENTITY_NOT_FOUND');
});

test('Threads scan: article 없는 실제 pressable 경계에서 permalink·시각·본문을 읽는다', () => {
  const text = '첫 문단\n\n둘째 문단';
  const r = run({ platform: 'threads', threadsPressable: true, scanPosts: [
    { href: '/@actual/post/abc', text, time: '2026-11-14T12:00:00Z' },
  ] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].text, text);
  assert.equal(r.output.candidates[0].url, 'https://www.threads.com/@actual/post/abc');
  assert.equal(r.output.candidates[0].publisher, 'actual');
  assert.equal(r.output.candidates[0].publishedAt, '2026-11-14T12:00:00.000Z');
  assert.equal(r.log.clicked, 0);
});

test('Threads scan: header·Pinned·Translate·중첩 인용을 제외하고 본문 링크 문구는 보존한다', () => {
  const text = '첫 문단\n\n자세히';
  const r = run({ platform: 'threads', threadsPressable: true, threadsNoise: true,
    scanPosts: [{ href: '/@actual/post/abc', text, time: '2026-11-14T12:00:00Z' }],
  }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.equal(r.output.candidates[0].text, text);
  assert.doesNotMatch(r.output.candidates[0].text, /@actual|12h|Pinned|Translate|인용 글/);
  assert.match(r.output.candidates[0].text, /자세히/);
  assert.ok(r.log.pressableQueries > 0, '실제 pressable 추출 분기에 도달해야 한다');
});

test('Threads scan: 같은 글 media 사진만 보존하고 프로필·다른 글·다른 사이트·중첩 글 사진은 제외한다', () => {
  const media = [{ sourceUrl: 'https://cdn.test/body-photo.jpg', alt: '본문 사진' }];
  const r = run({ platform: 'threads', threadsPressable: true, scanPosts: [{
    href: '/@actual/post/abc', text: '사진이 있는 글', time: '2026-11-14T12:00:00Z', media,
    decorativeMedia: [{ sourceUrl: 'https://cdn.test/avatar.jpg', alt: '프로필 사진' }],
    foreignMedia: [{ sourceUrl: 'https://cdn.test/other-post.jpg', alt: '다른 글 사진' }],
    externalMedia: [{ sourceUrl: 'https://cdn.test/external-post.jpg', alt: '다른 사이트 사진' }],
    quotedMedia: [{ sourceUrl: 'https://cdn.test/nested.jpg', alt: '중첩 글 사진' }],
  }] }, 'scan');
  assert.equal(r.output.candidates.length, 1);
  assert.deepEqual(r.output.candidates[0].media, [{ id: '1', ...media[0] }]);
  assert.ok(r.log.pressableQueries > 0);
});

test('Threads scan: 게시물을 관찰하지 못한 프로필은 정상 빈 이력으로 숨기지 않는다', () => {
  const r = run({ platform: 'threads', scanPosts: [] }, 'scan');
  assert.equal(r.output.coverage.complete, false);
  assert.notEqual(r.output.coverage.stopReason, 'SCROLL_STALLED');
  assert.equal(r.output.coverage.observedCount, 0);
  assert.equal(r.log.clicked, 0);
});

test('Bluesky 신원: 같은 own Profile href의 반응형 중복은 한 신원으로 읽는다', () => {
  assert.equal(run({ platform: 'bluesky', ownProfileHrefs: ['/profile/me', '/profile/me'] }, 'setup').output.identity, 'me');
});

test('Bluesky 신원은 앞선 피드 작성자가 아니라 own Profile 링크를 setup과 게시 직전 모두 사용한다', () => {
  const scenario = { platform: 'bluesky', ownProfileHrefs: ['/profile/me'] };
  const setup = run(scenario, 'setup');
  assert.equal(setup.output.identity, 'me');
  const posted = run(scenario);
  assert.equal(posted.output.status, 'POSTED');
  assert.equal(posted.log.clicked, 1);
});

for (const ownProfileHrefs of [[], ['/profile/me', '/profile/other']]) test(`Bluesky 신원: own Profile 링크가 ${ownProfileHrefs.length ? '모호하면' : '없으면'} setup과 게시를 차단한다`, () => {
  const scenario = { platform: 'bluesky', ownProfileHrefs };
  assert.equal(run(scenario, 'setup').output.reason, 'EGO_IDENTITY_NOT_FOUND');
  const posted = run(scenario);
  assert.equal(posted.output.status, 'POST_FAILED');
  assert.equal(posted.log.clicked, 0);
});

test('Bluesky 신원: 확인된 own Profile이 바인딩과 다르면 클릭 전에 차단한다', () => {
  const scenario = { platform: 'bluesky', ownProfileHrefs: ['/profile/other'] };
  assert.equal(run(scenario, 'setup').output.identity, 'other');
  const r = run(scenario);
  assert.equal(r.output.reason, 'EGO_ACCOUNT_MISMATCH');
  assert.equal(r.log.clicked, 0);
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
for (const requestUrl of ['https://bsky.app/profile/me/post/1', 'https://www.linkedin.com/feed/update/urn:li:ugcPost:1/', 'https://www.facebook.com/permalink.php?story_fbid=1&id=111', 'https://www.threads.com/@me/post/1']) test(`readback은 플랫폼별 대상 본문을 검사한다: ${requestUrl}`, () => {
  assert.equal(run({ requestUrl, targetUrl: requestUrl }, 'readback').output.matched, true);
  assert.equal(run({ requestUrl, targetUrl: requestUrl, targetText: '다른 본문' }, 'readback').output.matched, false);
});
test('readback은 퍼마링크로 찾은 본문과 정확히 비교한다', () => {
  assert.equal(run({}, 'readback').output.matched, true);
  assert.equal(run({ targetUrl: 'https://x.com/me/status/2' }, 'readback').output.matched, false);
});
