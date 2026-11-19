// 플랫폼별 UI 함수는 ego-post.mjs가 의존 helper와 함께 자식 실행 문자열에 넣는다.

export function facebookIdentity(url) {
  if (!['www.facebook.com', 'facebook.com'].includes(url.hostname) || url.protocol !== 'https:') return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/profile.php') {
    const ids = url.searchParams.getAll('id');
    return ids.length === 1 && /^\d+$/.test(ids[0]) ? `profile.php?id=${ids[0]}` : null;
  }
  if (!/^\/[A-Za-z0-9.]+$/.test(path) || /^\/(me|login|checkpoint)$/i.test(path)) return null;
  return path.slice(1);
}

export async function childAcquireIdentityFacebook(spaceName) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error, { code }); };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    await page.goto('https://www.facebook.com/me/', { timeout: 45000 });
    try { await page.waitForFunction(() => !/^\/me\/?$/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
    const url = await page.url();
    const u = new URL(url);
    if (u.hostname !== 'www.facebook.com' && u.hostname !== 'facebook.com') stop('EGO_ORIGIN_MISMATCH');
    if (/^\/(login|checkpoint)/.test(u.pathname)) stop('EGO_NEEDS_LOGIN');
    const identity = facebookIdentity(u);
    if (!identity) stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

export const profileUrl = id => 'https://www.facebook.com/' + id;

export function extractPosts(page) {
  return page.evaluate(() => [...document.querySelectorAll('div[data-ad-comet-preview], div[role="article"]')].map(a => {
    const story = a.querySelector('div[data-ad-preview="message"], div[dir="auto"] > span')?.closest('div[dir="auto"]');
    const text = (story?.innerText ?? '').trim();
    const href = a.querySelector('a[href*="/posts/"], a[href*="story_fbid"], a[href*="/photo"]')?.getAttribute('href') || null;
    const stamp = a.querySelector('time[datetime], abbr[data-utime]');
    const unixTime = stamp?.getAttribute('data-utime');
    const time = stamp?.getAttribute('datetime') || (/^\d{10}$/.test(unixTime ?? '') ? new Date(Number(unixTime) * 1000).toISOString() : null);
    const publisherHref = a.querySelector('h2 a[href], h3 a[href], [data-testid="post-author"] a[href]')?.getAttribute('href') || null;
    return { text, href, time, publisherHref, observationId: globalThis[Symbol.for('aha-skills.social-posting.observation-id')](a), media: [...a.querySelectorAll('a[href*="/photo"] img[src], a[href*="fbid="] img[src]')].map(img => ({ sourceUrl: img.currentSrc || img.src, alt: img.getAttribute('alt') || null })).filter(media => /^https?:\/\//.test(media.sourceUrl)) };
}).filter(p => p.text || (p.href && p.media?.length)));
}

export function postProfile(page, norm, sleep) {
  return {
    origin: 'https://www.facebook.com',
    composerOpen: async () => {
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('div[role="button"], button')].find(b => /생각|your mind|하고 있는지/i.test(b.innerText || b.getAttribute('aria-label') || ''));
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) return false;
      await sleep(1500);
      return true;
    },
    composerSelector: 'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
    attachButton: 'div[aria-label*="사진" i][role="button"], div[aria-label*="hoto" i][role="button"]',
    mediaPreview: 'img[src^="blob:"], img[alt]',
    postButton: 'div[aria-label="게시"][role="button"], div[aria-label="Post"][role="button"], button[type="submit"]',
    evidence: async () => {
      const gone = await page.evaluate(() => !document.querySelector('div[role="dialog"] div[role="textbox"][contenteditable="true"]'));
      return gone;
    },
    profileUrl: id => 'https://www.facebook.com/' + id,
    findPermalink: async text => page.evaluate(want => {
      const matches = [];
      for (const a of document.querySelectorAll('div[role="article"]')) {
        const story = a.querySelector('div[data-ad-preview="message"], div[dir="auto"] > span')?.closest('div[dir="auto"]');
        const t = norm(story?.innerText ?? '');
        if (t === want) {
          const href = a.querySelector('a[href*="/posts/"], a[href*="story_fbid"]')?.getAttribute('href');
          matches.push(href ?? null);
        }
      }
      return matches.length === 1 ? matches[0] : null;
      function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
    }, norm(text)),
    altUI: {
      open: 'div[role="dialog"] div[role="button"][aria-label="Edit photo"]',
      edit: 'div[role="dialog"][aria-label="Edit photo"] div[role="button"][aria-label="Alternative text"]',
      input: 'div[role="dialog"] textarea[aria-label="Alternative text"]',
      save: 'div[role="dialog"]:has(textarea[aria-label="Alternative text"]) div[role="button"][aria-label="Save"]',
      done: 'div[role="dialog"][aria-label="Edit photo"] div[role="button"][aria-label="Done"]',
    },
  };
}

export async function verifyPostIdentity(page, expectedIdentity, stop, loginCheck, sleep) {
  await page.goto('https://www.facebook.com/me/', { timeout: 45000 });
  try { await page.waitForFunction(() => !/^\/me\/?$/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
  await loginCheck();
  const identity = facebookIdentity(new URL(await page.url()));
  if (!identity) stop('EGO_IDENTITY_NOT_FOUND');
  if (identity !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
}

export const readbackHosts = ["www.facebook.com", "facebook.com"];

export const readbackSelectors = ["div[role=\"article\"]", "div[data-ad-preview=\"message\"]"];

export function publisher(url, owner) {
  return /^\/([^/]+)\/posts\//.exec(url.pathname)?.[1] ?? (owner ? `profile.php?id=${owner}` : null);
}

export function facebookPost(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.facebook.com', 'facebook.com'].includes(url.hostname) || url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '');
    const post = /^\/([^/]+)\/posts\/([^/]+)$/.exec(path);
    const id = post?.[2] ?? url.searchParams.get('story_fbid');
    if (!post && !(/^\/(?:permalink|story)\.php$/.test(path) && id)) return null;
    const owner = url.searchParams.get('id');
    url.hostname = 'www.facebook.com';
    url.pathname = path;
    url.hash = '';
    url.search = '';
    if (!post) {
      url.searchParams.set('story_fbid', id);
      if (owner) url.searchParams.set('id', owner);
    }
    return { url: url.href, id, publisher: post?.[1] ?? (owner ? `profile.php?id=${owner}` : null) };
  } catch { return null; }
}

export function rememberResponse(body, documentResponse, responseTimes) {
  const rememberStory = story => {
    if (story?.__typename !== 'Story' || typeof story.post_id !== 'string' || !/^\d+$/.test(story.post_id) || !Array.isArray(story.actors) || story.actors.length !== 1) return;
    const post = facebookPost(story.permalink_url);
    if (!post || (/^\d+$/.test(post.id) && post.id !== story.post_id)) return;
    const actor = story.actors[0];
    let publisher;
    try { publisher = facebookIdentity(new URL(actor.url)); } catch { return; }
    if (!publisher || ![publisher, `profile.php?id=${actor.id}`].includes(post.publisher)) return;
    let seconds = story.creation_time;
    if (!Number.isSafeInteger(seconds)) {
      const timestamp = story.comet_sections?.timestamp?.story;
      const timestampPost = facebookPost(timestamp?.url);
      if (!story.id || timestamp?.id !== story.id || timestampPost?.url !== post.url || !Array.isArray(timestamp.actors) || timestamp.actors.length !== 1 ||
          timestamp.actors[0].id !== actor.id || timestamp.actors[0].url !== actor.url) return;
      seconds = timestamp.creation_time;
    }
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8640000000000) return;
    responseTimes.set(post.url, { time: new Date(seconds * 1000).toISOString(), publishers: [publisher, `profile.php?id=${actor.id}`] });
};
const parseEnvelope = (value, depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 30) return;
  if (Array.isArray(value)) {
    for (const entry of value) parseEnvelope(entry, depth + 1);
    return;
  }
  const data = value.data ?? value.result?.data;
  if (data && typeof data === 'object') {
    rememberStory(data.node_v2);
    rememberStory(data.node);
    const edges = data.node?.timeline_list_feed_units?.edges;
    if (Array.isArray(edges)) for (const edge of edges) rememberStory(edge?.node);
  }
  if (value.__bbox) parseEnvelope(value.__bbox, depth + 1);
  if (Array.isArray(value.require)) parseEnvelope(value.require, depth + 1);
};
const documents = documentResponse
  ? [...body.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)].map(match => match[1])
  : body.split(/\r?\n/);
for (const document of documents) {
  try { parseEnvelope(JSON.parse(document)); } catch {}
}
}

export function acceptResponse(url, type) {
  if (url.protocol !== 'https:' || !['www.facebook.com', 'facebook.com'].includes(url.hostname)) return false;
  if (type !== 'Document' && !(['XHR', 'Fetch'].includes(type) && /^\/api\/graphql\/?$/.test(url.pathname))) return false;
  return true;
}

export async function setVisibility(page, visibility, stop, sleep) {
  if (visibility === 'keep') return;
  const opened = await page.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;
    const b = dialog.querySelector('div[role="button"][aria-label*="공개" i], div[role="button"][aria-label*="친구" i], div[role="button"][aria-haspopup]');
    if (!b) return false;
    b.click();
    return true;
  });
  if (!opened) stop('EGO_VISIBILITY_FAILED');
  await sleep(800);
  const picked = await page.evaluate(wantSource => {
    const re = new RegExp(wantSource, 'i');
    const items = [...document.querySelectorAll('div[role="menuitemradio"], span[dir="auto"]')];
    const item = items.find(el => re.test(el.innerText || el.textContent || ''));
    if (!item) return false;
    (item.closest('div[role="menuitemradio"]') ?? item).click();
    return true;
  }, visibility === 'public' ? '공개|Public' : '친구|Friends');
  if (!picked) stop('EGO_VISIBILITY_FAILED');
  await sleep(600);
}
