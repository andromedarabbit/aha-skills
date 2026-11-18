// 플랫폼별 UI 함수는 ego-post.mjs가 의존 helper와 함께 자식 실행 문자열에 넣는다.

export async function childAcquireIdentityBluesky(spaceName) {
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
    await page.goto('https://bsky.app/', { timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const url = await page.url();
    const u = new URL(url);
    if (u.origin !== 'https://bsky.app') stop('EGO_ORIGIN_MISMATCH');
    if (/^\/login/.test(u.pathname)) stop('EGO_NEEDS_LOGIN');
    const href = await ownProfileHref(page, 'bluesky');
    const m = href && /^\/profile\/([^/?#]+)/.exec(href);
    if (!m) stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity: decodeURIComponent(m[1]) }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

export const profileUrl = id => 'https://bsky.app/profile/' + id;

export function extractPosts(page) {
  return page.evaluate(() => [...document.querySelectorAll('div[data-testid^="feedItem"]')].map(a => {
    const record = a.querySelector('div[data-testid="postText"]')?.innerText ?? '';
    const links = [...a.querySelectorAll('a[href*="/post/"]')].filter(link =>
      link.closest('div[data-testid^="feedItem"]') === a && !link.closest('[data-testid="quotePost"], [data-testid="postText"], [data-testid*="avatar" i]') &&
      (link.querySelector('time[datetime]') || link.getAttribute('aria-label') || link.getAttribute('data-tooltip')));
    const hrefs = new Set(links.map(link => {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        if (url.origin !== 'https://bsky.app' || url.username || url.password || !/^\/profile\/[^/]+\/post\/[^/]+\/?$/.test(url.pathname)) return null;
        return url.origin + url.pathname.replace(/\/+$/, '');
      } catch { return null; }
    }).filter(Boolean));
    const href = hrefs.size === 1 ? [...hrefs][0] : null;
    const time = hrefs.size <= 1 ? links.find(link => {
      if (!link.querySelector('time[datetime]')) return false;
      if (!link.getAttribute('href')) return !href;
      try { return new URL(link.getAttribute('href'), location.href).href.split(/[?#]/)[0].replace(/\/+$/, '') === href; } catch { return false; }
    })?.querySelector('time[datetime]')?.getAttribute('datetime') || null : null;
    const parent = a.querySelector('[data-testid="replyTo"] a[href*="/post/"]');
    const parentHref = parent?.closest('div[data-testid^="feedItem"]') === a && !parent.closest('[data-testid="quotePost"]') ? parent.getAttribute('href') : null;
    return { text: record.trim(), href, time, parentHref, observationId: globalThis[Symbol.for('aha-skills.social-posting.observation-id')](a), media: [...a.querySelectorAll('[data-testid="imageEmbed"] img[src], img[alt][src*="/img/feed_"]')].filter(img => img.closest('div[data-testid^="feedItem"]') === a && !img.closest('[data-testid="quotePost"]')).map(img => ({ sourceUrl: img.currentSrc || img.src, alt: img.getAttribute('alt') || null })).filter(media => /^https?:\/\//.test(media.sourceUrl)) };
}).filter(p => p.text || (p.href && p.media?.length)));
}

export function postProfile(page, norm, sleep) {
  return {
    origin: 'https://bsky.app',
    composerOpen: async () => {
      const clicked = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label*="포스트" i], button[aria-label*="ost" i][aria-label*="ew" i], a[aria-label*="포스트" i][href="/"], button[aria-label="New Post"]');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) return false;
      await sleep(1200);
      return true;
    },
    composerSelector: 'div[contenteditable="true"][role="textbox"]',
    attachButton: 'button[aria-label*="이미지" i], button[aria-label*="mage" i]',
    mediaPreview: 'img[src^="blob:"], img[alt]',
    postButton: 'button[type="submit"]',
    evidence: async () => {
      const gone = await page.evaluate(() => !document.querySelector('div[contenteditable="true"][role="textbox"]'));
      return gone;
    },
    profileUrl: id => 'https://bsky.app/profile/' + id,
    findPermalink: async text => page.evaluate(want => {
      const matches = [];
      for (const item of document.querySelectorAll('div[data-testid^="feedItem"]')) {
        const t = norm(item.querySelector('div[data-testid="postText"]')?.innerText ?? '');
        if (t === want) {
          const href = item.querySelector('a[href*="/post/"] time')?.closest('a')?.getAttribute('href');
          matches.push(href ?? null);
        }
      }
      return matches.length === 1 ? matches[0] : null;
      function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
    }, norm(text)),
    replyOpen: async permalink => {
      await page.goto(permalink, { timeout: 45000 });
      try { await page.waitForFunction(() => !!document.querySelector('button[aria-label*="답글" i], button[aria-label*="eply" i]'), undefined, { timeout: 20000 }); } catch {}
      const clicked = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label*="답글" i], button[aria-label*="eply" i]');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) return false;
      await sleep(1200);
      return true;
    },
    altUI: { open: 'div[role="dialog"] [data-testid="altTextButton"]', input: 'div[role="dialog"] [data-testid="altTextInput"]', save: 'div[role="dialog"] [data-testid="altTextSave"]' },
  };
}

export async function verifyPostIdentity(page, expectedIdentity, stop, loginCheck, sleep) {
  await page.goto('https://bsky.app/', { timeout: 45000 });
  await sleep(2000);
  await loginCheck();
  const href = await ownProfileHref(page, 'bluesky');
  const m = href && /^\/profile\/([^/?#]+)/.exec(href);
  if (!m) stop('EGO_NEEDS_LOGIN');
  if (decodeURIComponent(m[1]) !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
}

export const readbackHosts = ["bsky.app"];

export const readbackSelectors = ["div[data-testid^=\"feedItem\"]", "div[data-testid=\"postText\"]"];

export function publisher(url) {
  return /^\/profile\/([^/]+)\/post\//.exec(url.pathname)?.[1] ?? null;
}

export const parentPath = "^\\/profile\\/[^/]+\\/post\\/[^/]+\\/?$";

export const ownProfileSelector = "nav a[aria-label=\"Profile\"][href^=\"/profile/\"], [role=\"navigation\"] a[aria-label=\"Profile\"][href^=\"/profile/\"]";

export const ownProfilePath = "^\\/profile\\/[^/?#]+\\/?$";

export function rememberResponse(body, documentResponse, responseTimes) {
  const rememberBlueskyFeed = value => {
    if (!Array.isArray(value?.feed)) return;
    for (const entry of value.feed) {
      const post = entry?.post;
      const uri = typeof post?.uri === 'string' && /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]+)$/.exec(post.uri);
      const handle = post?.author?.handle;
      const createdAt = post?.record?.createdAt;
      if (!uri || uri[1] !== post.author?.did || typeof handle !== 'string' || !/^[a-z0-9.-]+\.[a-z0-9-]+$/i.test(handle) ||
          post.record?.$type !== 'app.bsky.feed.post' || typeof createdAt !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt)) continue;
      const time = new Date(createdAt);
      const day = new Date(createdAt.slice(0, 10));
      if (!Number.isFinite(time.getTime()) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== createdAt.slice(0, 10)) continue;
      const publishers = [handle, post.author.did];
      for (const publisher of publishers) responseTimes.set(`https://bsky.app/profile/${publisher}/post/${uri[2]}`, { time: time.toISOString(), publishers });
    }
};
  try { rememberBlueskyFeed(JSON.parse(body)); } catch {}
}

export function acceptResponse(url, type) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname.endsWith('.host.bsky.network') || url.hostname === 'public.api.bsky.app') ||
      url.pathname !== '/xrpc/app.bsky.feed.getAuthorFeed' || !['XHR', 'Fetch'].includes(type)) return false;
  return true;
}
