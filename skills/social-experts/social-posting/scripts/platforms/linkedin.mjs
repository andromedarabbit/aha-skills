// 플랫폼별 UI 함수는 ego-post.mjs가 의존 helper와 함께 자식 실행 문자열에 넣는다.

export async function childAcquireIdentityLinkedin(spaceName) {
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
    await page.goto('https://www.linkedin.com/in/me/', { timeout: 45000 });
    // /in/me는 SPA 리다이렉트로 slug 확정이 늦다(linkedin-followup G2 실측) — 리다이렉트 완료를 기다린다.
    try { await page.waitForFunction(() => /^\/in\/(?!me\/?$)[^/]+/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
    const url = await page.url();
    const u = new URL(url);
    if (u.origin !== 'https://www.linkedin.com') stop('EGO_ORIGIN_MISMATCH');
    if (/^\/(login|authwall|checkpoint)/.test(u.pathname)) stop('EGO_NEEDS_LOGIN');
    const slug = /^\/in\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
    if (!slug || slug === 'me') stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity: slug }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

export const profileUrl = id => 'https://www.linkedin.com/in/' + id + '/recent-activity/all/';

export function extractPosts(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-urn*="ugcPost:"]')].map(a => ({
    observationId: globalThis[Symbol.for('aha-skills.social-posting.observation-id')](a),
    text: (a.querySelector('.update-components-text, [dir="ltr"] span')?.innerText ?? '').trim(),
    href: a.querySelector('a[href*="ugcPost"]')?.getAttribute('href') || null,
    time: a.querySelector('time')?.getAttribute('datetime') || null,
    media: [...a.querySelectorAll('img[src]')].map(img => ({ sourceUrl: img.currentSrc || img.src, alt: img.getAttribute('alt') || null })).filter(media => /^https?:\/\//.test(media.sourceUrl)),
})).filter(p => p.text || (p.href && p.media?.length)));
}

export function postProfile(page, norm, sleep) {
  return {
    origin: 'https://www.linkedin.com',
    composerOpen: async () => {
      const clicked = await page.evaluate(() => {
        const b = document.querySelector('button[data-test-id="share-box-trigger"], button[class*="share-box"]') ||
          [...document.querySelectorAll('button')].find(b => /start a post|게시물 작성|무엇을/i.test(b.innerText || ''));
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) return false;
      await sleep(1500);
      return true;
    },
    composerSelector: '.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]',
    attachButton: 'button[data-test-id="media-add-media"], button[aria-label*="미디어" i], button[aria-label*="Add media" i]',
    mediaPreview: '.share-confirmation, img.preview-image, div[class*="feed-image"]',
    postButton: 'button[class*="share-actions__primary-action"], button.artdeco-button--primary',
    evidence: async () => {
      const gone = await page.evaluate(() => !document.querySelector('.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]'));
      return gone;
    },
    profileUrl: id => 'https://www.linkedin.com/in/' + id + '/recent-activity/all/',
    findPermalink: async text => page.evaluate(want => {
      const matches = [];
      for (const a of document.querySelectorAll('[data-urn*="ugcPost:"]')) {
        const t = norm(a.querySelector('.update-components-text')?.innerText ?? (a.querySelector('[dir="ltr"]')?.innerText ?? ''));
        if (t === want) {
          const href = a.querySelector('a[href*="ugcPost"]')?.getAttribute('href');
          matches.push(href ?? null);
        }
      }
      return matches.length === 1 ? matches[0] : null;
      function norm(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
    }, norm(text)),
    altUI: {
      open: 'div[role="dialog"] button[aria-label="Edit photo"]',
      edit: 'div[role="dialog"][aria-label="Photo editor"] button[aria-label="Alternative text"]',
      input: 'div[role="dialog"] textarea[aria-label="Alternative text"]',
      save: 'div[role="dialog"]:has(textarea[aria-label="Alternative text"]) button[aria-label="Save"]',
      done: 'div[role="dialog"][aria-label="Photo editor"] button[aria-label="Done"]',
    },
  };
}

export async function verifyPostIdentity(page, expectedIdentity, stop, loginCheck, sleep) {
  await page.goto('https://www.linkedin.com/in/me/', { timeout: 45000 });
  try { await page.waitForFunction(() => /^\/in\/(?!me\/?$)[^/]+/.test(location.pathname), undefined, { timeout: 20000 }); } catch {}
  const slug = /^\/in\/([^/]+)/.exec(new URL(await page.url()).pathname)?.[1];
  if (!slug || slug === 'me') stop('EGO_NEEDS_LOGIN');
  if (slug !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
}

export const readbackHosts = ["www.linkedin.com"];

export const readbackSelectors = ["[data-urn*=\"ugcPost:\"], [data-urn*=\"activity:\"]", ".update-components-text"];

export function publisher(url) {
  return null;
}
