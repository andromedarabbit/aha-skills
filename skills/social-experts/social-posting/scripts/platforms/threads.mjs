// 플랫폼별 UI 함수는 ego-post.mjs가 의존 helper와 함께 자식 실행 문자열에 넣는다.

export async function childAcquireIdentityThreads(spaceName) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    const inUse = error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE';
    console.log(JSON.stringify({ status: inUse ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error(), { code }); };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    await page.goto('https://www.threads.com/', { timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const url = new URL(await page.url());
    if (!['threads.com', 'www.threads.com'].includes(url.hostname)) stop('EGO_ORIGIN_MISMATCH');
    if (/^\/(login|accounts\/login)/.test(url.pathname)) stop('EGO_NEEDS_LOGIN');
    const href = await ownProfileHref(page, 'threads');
    const match = href && /^\/@([A-Za-z0-9._]{1,30})$/.exec(href);
    if (!match) stop('EGO_IDENTITY_NOT_FOUND');
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity: match[1] }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_SCHEMA_INVALID', 'EGO_IDENTITY_NOT_FOUND', 'EGO_EVAL_STOPPED'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

export const profileUrl = id => 'https://www.threads.com/@' + id;

export function extractPosts(page) {
  return page.evaluate(() => {
    const boundary = '[data-pressable-container="true"]';
    const roots = new Set(document.querySelectorAll('div[data-testid="thread"], article'));
    for (const anchor of document.querySelectorAll('a[href*="/post/"]')) {
      if (!anchor.querySelector('time[datetime]')) continue;
      const root = anchor.closest(boundary);
      if (root && !root.parentElement?.closest(boundary)) roots.add(root);
    }
    return [...roots].map(a => {
      const pressable = a.matches(boundary);
      let anchor;
      let text;
      if (pressable) {
        const links = [...a.querySelectorAll('a[href*="/post/"]')]
          .filter(link => link.closest(boundary) === a && link.querySelector('time[datetime]'));
        const hrefs = new Set(links.map(link => link.getAttribute('href')));
        if (hrefs.size !== 1) return null;
        anchor = links[0];
        text = '';
        for (let node = anchor; node && node !== a; node = node.parentElement) {
          const sibling = node.nextElementSibling;
          if (!sibling || sibling.closest(boundary) !== a) continue;
          const spans = [...sibling.querySelectorAll('span[dir="auto"]')]
            .filter(span => span.closest(boundary) === a && !span.closest('button, [role="button"], header'));
          const parts = spans.filter(span => !spans.some(outer => outer !== span && outer.contains(span))).map(span => {
            const clone = span.cloneNode(true);
            for (const control of clone.querySelectorAll('button, [role="button"]')) control.remove();
            return (clone.textContent ?? '').trim();
          }).filter(Boolean);
          if (parts.length) { text = parts.join('\n'); break; }
        }
      } else {
        text = (a.querySelector('[data-testid="thread-text"], [dir="auto"]')?.innerText ?? '').trim();
        anchor = a.querySelector('a[href*="/post/"] time')?.closest('a');
      }
      const href = anchor?.getAttribute('href') || null;
      const time = (pressable ? anchor?.querySelector('time[datetime]') : a.querySelector('time'))?.getAttribute('datetime') || null;
      const mediaSelector = pressable ? 'img[src]' : '[data-testid="thread-media"] img[src], [data-testid="media-container"] img[src]';
      return { text, href, time, observationId: globalThis[Symbol.for('aha-skills.social-posting.observation-id')](a),
        media: [...a.querySelectorAll(mediaSelector)]
          .filter(img => {
            if (img.closest(pressable ? boundary : 'div[data-testid="thread"], article') !== a || img.closest('[data-testid="quoted-thread"], [data-testid="quote"]')) return false;
            if (!pressable) return true;
            try {
              const media = new URL(img.closest('a[href]')?.getAttribute('href'), location.href);
              const post = new URL(href, location.href);
              return media.origin === post.origin && media.pathname.replace(/\/+$/, '') === post.pathname.replace(/\/+$/, '') + '/media';
            } catch { return false; }
          })
          .map(img => ({ sourceUrl: img.currentSrc || img.src, alt: img.getAttribute('alt') || null }))
          .filter(media => /^https?:\/\//.test(media.sourceUrl)) };
    }).filter(p => p && (p.text || (p.href && p.media?.length)));
});
}

export function postProfile(page, norm, sleep) {
  return {
    origin: 'https://www.threads.com',
    composerOpen: async () => {
      const clicked = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label*="New thread" i], button[aria-label*="New post" i], a[aria-label*="New thread" i]');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) return false;
      await sleep(1200);
      return true;
    },
    composerSelector: 'div[contenteditable="true"][role="textbox"]',
    attachButton: 'button[aria-label*="gallery" i], button[aria-label*="media" i], button[aria-label*="photo" i]',
    mediaPreview: 'img[src^="blob:"], img[alt]',
    postButton: 'button[type="submit"], button[aria-label="Post"]',
    evidence: async () => page.evaluate(() => !document.querySelector('div[contenteditable="true"][role="textbox"]')),
    profileUrl: id => 'https://www.threads.com/@' + id,
    findPermalink: async text => page.evaluate(want => {
      const matches = [];
      for (const item of document.querySelectorAll('div[data-testid="thread"], article')) {
        const body = String(item.querySelector('[data-testid="thread-text"], [dir="auto"]')?.innerText ?? '').replace(/\s+/g, ' ').trim();
        if (body === want) matches.push(item.querySelector('a[href*="/post/"] time')?.closest('a')?.getAttribute('href') ?? null);
      }
      return matches.length === 1 ? matches[0] : null;
    }, norm(text)),
    replyOpen: async permalink => {
      await page.goto(permalink, { timeout: 45000 });
      try { await page.waitForFunction(() => !!document.querySelector('button[aria-label*="Reply" i]'), undefined, { timeout: 20000 }); } catch {}
      const clicked = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label*="Reply" i]');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) return false;
      await sleep(1200);
      return true;
    },
    altUI: { open: 'div[role="dialog"] [data-testid="altTextButton"], div[role="dialog"] button[aria-label*="alt" i]', input: 'div[role="dialog"] [data-testid="altTextInput"], div[role="dialog"] textarea[aria-label*="alt" i]', save: 'div[role="dialog"] [data-testid="altTextSave"], div[role="dialog"] button[aria-label*="Done" i]' },
  };
}

export async function verifyPostIdentity(page, expectedIdentity, stop, loginCheck, sleep) {
  await page.goto('https://www.threads.com/', { timeout: 45000 });
  await sleep(2000);
  await loginCheck();
  const href = await ownProfileHref(page, 'threads');
  const match = href && /^\/@([A-Za-z0-9._]{1,30})$/.exec(href);
  if (!match) stop('EGO_NEEDS_LOGIN');
  if (match[1] !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
}

export const readbackHosts = ["threads.com", "www.threads.com"];

export const readbackSelectors = ["div[data-testid=\"thread\"], article", "[data-testid=\"thread-text\"], [dir=\"auto\"]"];

export function publisher(url) {
  return /^\/@([^/]+)\/post\//.exec(url.pathname)?.[1] ?? null;
}

export const ownProfileSelector = "nav a[href^=\"/@\"], [role=\"navigation\"] a[href^=\"/@\"]";

export const ownProfilePath = "^\\/@[A-Za-z0-9._]{1,30}\\/?$";
