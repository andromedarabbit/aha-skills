// 플랫폼별 UI 함수는 ego-post.mjs가 의존 helper와 함께 자식 실행 문자열에 넣는다.

export async function childAcquireIdentityX(spaceName) {
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
    await page.goto('https://x.com/home', { timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const url = await page.url();
    const u = new URL(url);
    if (u.hostname !== 'x.com' && u.hostname !== 'twitter.com') stop('EGO_ORIGIN_MISMATCH');
    // 프로필 탭(= 핸들 href)은 로그인 직후 렌더가 늦다 — 폴링으로 기다린다.
    // 실측(2026-11-14): 폴백 스캔이 사이드바 "홈" 링크(/home)를 프로필로 오탐한 사례가 있어
    // 예약 경로는 신원에서 제외한다.
    const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings', 'communities', 'grok', 'lists', 'bookmarks', 'profile', 'compose', 'intent', 'connect', 'hashtag']);
    let profileHref = null;
    const hrefDeadline = Date.now() + 10000;
    while (Date.now() < hrefDeadline && !profileHref) {
      const candidate = await page.evaluate(() => document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || null);
      const match = candidate && /^\/([A-Za-z0-9_]{1,20})$/.exec(candidate);
      if (match && !RESERVED.has(match[1].toLowerCase())) profileHref = candidate;
      if (profileHref) break;
      await new Promise(r => setTimeout(r, 600));
    }
    const probe = await page.evaluate(() => ({
      hasLogin: !!document.querySelector('input[autocomplete="username"], input[name="session[username_or_email]"]'),
      // 실측(2026-11-14): 로그아웃 상태의 x.com/home는 랜딩으로 리다이렉트되고 로그인 폼이
      // 아니라 "Sign in" 링크가 있다 — 링크 기반 탐지까지 병행한다.
      hasSignInLink: [...document.querySelectorAll('a, button')].some(e => /^(sign in|로그인)$/i.test((e.textContent || '').trim())),
    }));
    if (probe?.hasLogin || probe?.hasSignInLink) stop('EGO_NEEDS_LOGIN');
    const m = profileHref && /^\/([A-Za-z0-9_]{1,20})$/.exec(profileHref);
    if (!m || RESERVED.has(m[1].toLowerCase())) stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity: m[1] }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

export const profileUrl = id => 'https://x.com/' + id;

export function extractPosts(page) {
  return page.evaluate(() => [...document.querySelectorAll('article[data-testid="tweet"]')].map(a => {
    const text = (a.querySelector('[data-testid="tweetText"]')?.innerText ?? '').trim();
    const href = a.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href') || null;
    const time = a.querySelector('time')?.getAttribute('datetime') || null;
    const parent = a.querySelector('[data-testid="replyingTo"] a[href*="/status/"]');
    const parentHref = parent?.closest('article[data-testid="tweet"]') === a && !parent.closest('[data-testid="quoteTweet"]') ? parent.getAttribute('href') : null;
    return { text, href, time, parentHref, observationId: globalThis[Symbol.for('aha-skills.social-posting.observation-id')](a),
      media: [...a.querySelectorAll('[data-testid="tweetPhoto"] img[src]')].filter(img => img.closest('article[data-testid="tweet"]') === a && !img.closest('[data-testid="quoteTweet"]'))
        .map(img => ({ sourceUrl: img.currentSrc || img.src, alt: img.getAttribute('alt') || null })).filter(media => /^https?:\/\//.test(media.sourceUrl)) };
}).filter(p => p.text || (p.href && p.media?.length)));
}

export function postProfile(page, norm, sleep) {
  return {
    origin: 'https://x.com',
    composerUrl: 'https://x.com/compose/post',
    composerSelector: '[data-testid="tweetTextarea_0"]',
    fileInput: 'input[type="file"]',
    attachButton: '[data-testid="addMedia"]',
    mediaPreview: '[data-testid="attachments"]',
    postButton: '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]',
    evidence: async () => {
      const gone = await page.evaluate(() => !document.querySelector('[data-testid="tweetTextarea_0"]'));
      return gone;
    },
    profileUrl: id => 'https://x.com/' + id,
    findPermalink: async text => page.evaluate(want => {
      const matches = [];
      for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
        const t = norm((a.querySelector('[data-testid="tweetText"]')?.innerText ?? ''));
        if (t === want) {
          const href = a.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href');
          matches.push(href ?? null);
        }
      }
      return matches.length === 1 ? matches[0] : null;
      function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
    }, norm(text)),
    replyOpen: async permalink => {
      await page.goto(permalink, { timeout: 45000 });
      try { await page.waitForFunction(() => !!document.querySelector('[data-testid="tweetTextarea_0"], [data-testid="reply"]'), undefined, { timeout: 20000 }); } catch {}
      const clicked = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="reply"]');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) return false;
      await sleep(1200);
      return true;
    },
    altUI: { open: '[data-testid="attachments"] [data-testid="altTextButton"]', input: 'div[role="dialog"] [data-testid="altTextInput"]', save: 'div[role="dialog"] [data-testid="altTextSave"]' },
  };
}

export async function verifyPostIdentity(page, expectedIdentity, stop, loginCheck, sleep) {
  await page.goto('https://x.com/home', { timeout: 45000 });
  await sleep(2000);
  await loginCheck();
  const href = await page.evaluate(() => document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || null);
  const m = href && /^\/([A-Za-z0-9_]{1,20})$/.exec(href);
  if (!m) stop('EGO_NEEDS_LOGIN');
  if (m[1] !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
}

export const readbackHosts = ["x.com", "twitter.com"];

export const readbackSelectors = ["article[data-testid=\"tweet\"]", "[data-testid=\"tweetText\"]"];

export function publisher(url) {
  return /^\/([^/]+)\/status\//.exec(url.pathname)?.[1] ?? null;
}

export const parentPath = "^\\/[^/]+\\/status\\/\\d+\\/?$";
