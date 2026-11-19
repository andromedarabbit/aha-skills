// shortcut: Instagram DOM은 합성 fixture만 확인했다. 실제 웹 UI에서 대상 근거가 없으면 중단하며 실환경 검증 뒤 선택자를 교정한다.

export const profileUrl = id => 'https://www.instagram.com/' + encodeURIComponent(id) + '/';
export const ownProfileSelector = 'nav a:has(svg[aria-label="Profile"]), nav a:has(svg[aria-label="프로필"]), nav a:has(img[alt$="profile picture"]), [role="navigation"] a:has(svg[aria-label="Profile"]), [role="navigation"] a:has(img[alt$="profile picture"])';
export const ownProfilePath = '^\\/[A-Za-z0-9._]{1,30}\\/?$';
export const readbackHosts = ['instagram.com', 'www.instagram.com'];
export const readbackSelectors = ['article', 'h1'];

export async function childAcquireIdentityInstagram(spaceName) {
  let task;
  try { task = await taskSpace(spaceName); }
  catch (error) {
    console.log(JSON.stringify({ status: error?.error_code === 'EGO_TASK_SPACE_NAME_IN_USE' ? 'EGO_SPACE_NAME_IN_USE' : 'EGO_SPACE_FAILED' }));
    return;
  }
  const stop = code => { throw Object.assign(new Error(), { code }); };
  try {
    const pages = await task.pages();
    const page = pages.length ? task.page(pages[0].label) : await task.newPage();
    const identity = await PLATFORM_UI.instagram.verifyPostIdentity(page, null, stop, async () => {}, ms => new Promise(resolve => setTimeout(resolve, ms)));
    console.log(JSON.stringify({ status: 'IDENTITY_ACQUIRED', identity }));
  } catch (error) {
    const codes = ['EGO_SPACE_NAME_IN_USE', 'EGO_TABS_FAILED', 'EGO_ATTACH_FAILED', 'EGO_ORIGIN_MISMATCH', 'EGO_NEEDS_LOGIN', 'EGO_IDENTITY_NOT_FOUND', 'EGO_ACCOUNT_MISMATCH'];
    console.log(JSON.stringify({ status: codes.includes(error?.code) ? error.code : 'EGO_ATTACH_FAILED' }));
  }
}

export async function verifyPostIdentity(page, expectedIdentity, stop, loginCheck, sleep) {
  await page.goto('https://www.instagram.com/', { timeout: 45000 });
  await sleep(1500);
  const url = new URL(await page.url());
  if (url.origin !== 'https://www.instagram.com') stop('EGO_ORIGIN_MISMATCH');
  if (/^\/(accounts|challenge|checkpoint)(\/|$)/.test(url.pathname)) stop('EGO_NEEDS_LOGIN');
  await loginCheck();
  const href = await ownProfileHref(page, 'instagram');
  const match = href && /^\/([A-Za-z0-9._]{1,30})\/?$/.exec(href);
  if (!match || /^(accounts|explore|direct|reels|stories|p|create|about|legal|web|challenge)$/i.test(match[1])) stop('EGO_IDENTITY_NOT_FOUND');
  if (expectedIdentity !== null && match[1] !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
  return match[1];
}

export async function verifyPublicAccount(page, identity, stop, sleep) {
  await page.goto('https://www.instagram.com/accounts/account_privacy/', { timeout: 45000 });
  await sleep(800);
  const url = new URL(await page.url());
  if (url.origin !== 'https://www.instagram.com' || url.pathname !== '/accounts/account_privacy/') stop('EGO_VISIBILITY_FAILED');
  const href = await ownProfileHref(page, 'instagram');
  if (href?.replace(/^\/|\/$/g, '') !== identity) stop('EGO_ACCOUNT_MISMATCH');
  const publicAccount = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('[aria-label="Private account"], [aria-label="비공개 계정"]')]
      .filter(node => node.getClientRects().length);
    if (controls.length !== 1) return false;
    const control = controls[0];
    return control.checked === undefined ? control.getAttribute('aria-checked') === 'false' : control.checked === false && control.getAttribute('aria-checked') !== 'true';
  });
  if (!publicAccount) stop('EGO_VISIBILITY_FAILED');
  await PLATFORM_UI.instagram.verifyPostIdentity(page, identity, stop, async () => {}, sleep);
}

export async function setVisibility(page, visibility, stop, sleep) {
  if (!['private', 'public'].includes(visibility)) stop('EGO_VISIBILITY_FAILED');
  const selected = await page.evaluate(visibility => {
    const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
    if (dialogs.length !== 1) return null;
    const dialog = dialogs[0];
    const buttons = [...dialog.querySelectorAll('[aria-label="Audience"], [aria-label="공개 대상"]')]
      .filter(node => node.getClientRects().length);
    if (buttons.length !== 1) return null;
    const button = buttons[0];
    const label = String(button.innerText ?? '').trim();
    if (!/^(Everyone|모든 사람|Close Friends|친한 친구)$/.test(label)) return null;
    const pattern = visibility === 'private' ? '^(Close Friends|친한 친구)$' : '^(Everyone|모든 사람)$';
    globalThis[Symbol.for('aha-skills.social-posting.instagram-audience')] = { dialog, button, pattern };
    if (new RegExp(pattern).test(label)) return true;
    button.click(); return false;
  }, visibility);
  if (selected === null) stop('EGO_VISIBILITY_FAILED');
  if (!selected) {
    await sleep(300);
    const changed = await page.evaluate(() => {
      const proof = globalThis[Symbol.for('aha-skills.social-posting.instagram-audience')];
      if (!proof?.dialog.isConnected) return false;
      const menuId = proof.button.getAttribute('aria-controls');
      const menu = menuId && document.getElementById(menuId);
      if (!menu?.getClientRects().length) return false;
      const choices = [...menu.querySelectorAll('[role="radio"], [role="menuitemradio"]')]
        .filter(node => node.getClientRects().length && new RegExp(proof.pattern).test(String(node.innerText ?? '').trim()));
      if (choices.length !== 1 || choices[0].disabled || choices[0].getAttribute('aria-disabled') === 'true') return false;
      choices[0].click(); return true;
    });
    if (!changed) stop('EGO_VISIBILITY_FAILED');
    await sleep(300);
  }
  if (!await PLATFORM_UI.instagram.verifyAudience(page)) stop('EGO_VISIBILITY_FAILED');
}

export function verifyAudience(page) {
  return page.evaluate(() => {
    const proof = globalThis[Symbol.for('aha-skills.social-posting.instagram-audience')];
    const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
    if (!proof || dialogs.length !== 1 || dialogs[0] !== proof.dialog || !proof.dialog.isConnected) return false;
    const buttons = [...proof.dialog.querySelectorAll('[aria-label="Audience"], [aria-label="공개 대상"]')]
      .filter(node => node.getClientRects().length);
    return buttons.length === 1 && buttons[0] === proof.button && new RegExp(proof.pattern).test(String(buttons[0].innerText ?? '').trim());
  });
}

export function observePosts(page) {
  return page.evaluate(() => {
    // 프로필에서 상세로 이동하면 이전 document의 관찰 상태가 사라진다.
    const key = Symbol.for('aha-skills.social-posting.observation-id');
    if (typeof globalThis[key] !== 'function') {
      const nodes = new WeakMap();
      const session = crypto.randomUUID();
      let next = 0;
      globalThis[key] = node => {
        if (!nodes.has(node)) nodes.set(node, `instagram-${session}-${++next}`);
        return nodes.get(node);
      };
    }
    return [...document.querySelectorAll('article')].map(root => {
      if (root.querySelector('video')) return null;
      const scoped = node => node?.closest('article') === root;
      const author = root.querySelector('header a[href]');
      const publisher = scoped(author) && /^\/([A-Za-z0-9._]{1,30})\/?$/.exec(author.getAttribute('href') ?? '')?.[1];
      const links = [...root.querySelectorAll('a[href]')].filter(link => {
        if (!scoped(link)) return false;
        try { const u = new URL(link.getAttribute('href'), location.href); return u.origin === 'https://www.instagram.com' && /^\/p\/[A-Za-z0-9_-]+\/?$/.test(u.pathname); }
        catch { return false; }
      });
      const hrefs = [...new Set(links.map(link => new URL(link.getAttribute('href'), location.href).pathname.replace(/\/+$/, '')))];
      if (hrefs.length > 1 || !publisher) return null;
      const caption = root.querySelector('h1');
      const times = links.map(link => link.querySelector('time[datetime]')).filter(scoped);
      const time = times.length === 1 ? times[0] : null;
      const media = [...root.querySelectorAll('div._aagu img[src]')]
        .filter(image => scoped(image) && image.getClientRects().length && !image.closest('header, h1, ul ul, [role="dialog"] article article'))
        .map(image => ({ sourceUrl: image.currentSrc || image.src, alt: image.getAttribute('alt') || null }))
        .filter(image => /^https:\/\//.test(image.sourceUrl));
      if (!media.length) return null;
      return { text: scoped(caption) ? String(caption.innerText ?? '') : '', href: hrefs[0] ?? null,
        time: scoped(time) ? time.getAttribute('datetime') : null, publisher,
        observationId: globalThis[Symbol.for('aha-skills.social-posting.observation-id')](root), media,
        hasNext: !!root.querySelector('button[aria-label="Next"], button[aria-label="다음"]') };
    }).filter(Boolean);
  });
}

export async function extractPosts(page, deadline = Date.now() + 60000, detailPage = null) {
  const currentUrl = new URL(await page.url());
  if (currentUrl.origin !== 'https://www.instagram.com') throw Object.assign(Error('unexpected origin'), { code: 'EGO_ORIGIN_MISMATCH' });
  if (/^\/(accounts|challenge|checkpoint)(\/|$)/.test(currentUrl.pathname)) throw Object.assign(Error('login required'), { code: 'EGO_NEEDS_LOGIN' });
  let posts = await PLATFORM_UI.instagram.observePosts(page);
  if (/^\/p\//.test(currentUrl.pathname)) posts = posts.filter(post => post.href === currentUrl.pathname.replace(/\/+$/, ''));
  if (!posts.length && /^\/[A-Za-z0-9._]{1,30}\/?$/.test(currentUrl.pathname)) {
    const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('main a[href]')].map(anchor => {
      try {
        const url = new URL(anchor.getAttribute('href'), location.href);
        return url.origin === 'https://www.instagram.com' && /^\/p\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? url.href : null;
      } catch { return null; }
    }).filter(Boolean))].slice(0, 50));
    if (links.length && !detailPage) throw Object.assign(Error('detail page required'), { code: 'EGO_ATTACH_FAILED' });
    for (const href of links) {
      if (Date.now() >= deadline) break;
      try {
        await detailPage.goto(href, { timeout: Math.max(1, Math.min(45000, deadline - Date.now())) });
        await detailPage.waitForSelector('article', { state: 'visible', timeout: Math.max(1, Math.min(15000, deadline - Date.now())) });
        posts.push(...await PLATFORM_UI.instagram.extractPosts(detailPage, deadline));
      } catch (error) {
        if (error?.code === 'EGO_EVIDENCE_MISSING') continue;
        posts.push(...(error.observedPosts ?? []));
        error.observedPosts = posts;
        throw error;
      }
    }
    if (posts.length) return posts;
  }
  if (!posts.length) throw Object.assign(Error('photo feed not observed'), { code: 'EGO_EVIDENCE_MISSING' });
  try {
    for (const post of posts) {
      const seen = new Set(post.media.map(image => image.sourceUrl));
      post.mediaComplete = false;
      for (let step = 0; step < 19 && post.hasNext && Date.now() < deadline; step++) {
        const clicked = await page.evaluate(id => {
          const roots = [...document.querySelectorAll('article')].filter(root => globalThis[Symbol.for('aha-skills.social-posting.observation-id')](root) === id);
          if (roots.length !== 1) return false;
          const button = roots[0].querySelector('button[aria-label="Next"], button[aria-label="다음"]');
          if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
          button.click(); return true;
        }, post.observationId);
        if (!clicked) break;
        const slideDeadline = Math.min(deadline, Date.now() + 3000);
        let current = null;
        let fresh = [];
        while (Date.now() < slideDeadline) {
          await new Promise(resolve => setTimeout(resolve, 100));
          current = (await PLATFORM_UI.instagram.observePosts(page)).find(item => item.observationId === post.observationId && item.href === post.href);
          if (!current) break;
          fresh = current.media.filter(image => !seen.has(image.sourceUrl));
          if (fresh.length) break;
        }
        if (!fresh.length) break;
        for (const image of fresh) { seen.add(image.sourceUrl); post.media.push(image); }
        post.hasNext = current.hasNext;
      }
    }
  } catch (error) {
    error.observedPosts = posts;
    throw error;
  } finally {
    for (const post of posts) delete post.hasNext;
  }
  return posts;
}

export async function readbackPost(page, target) {
  const url = new URL(target);
  if (!['https://www.instagram.com', 'https://instagram.com'].includes(url.origin) || !/^\/p\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
  const key = url.pathname.replace(/\/+$/, '');
  let posts;
  try {
    posts = await PLATFORM_UI.instagram.extractPosts(page);
  } catch (error) {
    if (!error.observedPosts?.length) {
      if (error?.code === 'EGO_EVIDENCE_MISSING') return null;
      throw error;
    }
    posts = error.observedPosts.map(post => ({ ...post, stopReason: error.code ?? 'EGO_ATTACH_FAILED' }));
  }
  const matches = posts.filter(post => post.href === key);
  if (matches.length !== 1) return null;
  const audience = await page.evaluate(key => {
    const roots = [...document.querySelectorAll('article')].filter(root => [...root.querySelectorAll('a[href]')]
      .some(anchor => anchor.closest('article') === root && anchor.getAttribute('href')?.replace(/\/+$/, '') === key));
    if (roots.length !== 1) return 'unknown';
    const markers = [...roots[0].querySelectorAll('header [aria-label="Close Friends"], header [aria-label="친한 친구"], header [aria-label="Everyone"], header [aria-label="모든 사람"]')]
      .filter(node => node.closest('article') === roots[0] && node.getClientRects().length);
    if (markers.length !== 1) return 'unknown';
    return /^(Close Friends|친한 친구)$/.test(markers[0].getAttribute('aria-label')) ? 'close_friends' : 'public';
  }, key).catch(() => 'unknown');
  return { ...matches[0], audience };
}

export function publisher() { return null; }

export function inspectMedia(page, includeFiles = false) {
  return page.evaluate(async includeFiles => {
    const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
    if (dialogs.length !== 1) return null;
    const dialog = dialogs[0];
    const fingerprint = async image => {
      const width = image.naturalWidth ?? image.width;
      const height = image.naturalHeight ?? image.height;
      if (!width || !height) throw Error('image not decoded');
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const digest = await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, width, height).data);
      return { width, height, digest: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
    };
    const previews = [];
    for (const image of dialog.querySelectorAll('img[src^="blob:"]')) {
      if (!image.complete || !image.getClientRects().length) continue;
      const observed = await fingerprint(image);
      const rect = image.getBoundingClientRect();
      const fit = getComputedStyle(image).objectFit;
      if (!rect.width || !rect.height || (fit !== 'contain' && Math.abs(rect.width / rect.height - observed.width / observed.height) > 0.01)) return null;
      for (let parent = image.parentElement; parent && parent !== dialog; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (/hidden|clip|auto|scroll/.test(style.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) return null;
        if (/hidden|clip|auto|scroll/.test(style.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) return null;
      }
      previews.push(observed);
    }
    const files = [];
    if (includeFiles) {
      const input = dialog.querySelector('input[type="file"]');
      if (!input?.files?.length) return null;
      for (const file of input.files) {
        const bitmap = await createImageBitmap(file);
        try { files.push({ name: file.name, ...await fingerprint(bitmap) }); }
        finally { bitmap.close(); }
      }
    }
    return { files, previews };
  }, includeFiles);
}

export function postProfile(page, norm, sleep) {
  let expected = [];
  let permalink = null;
  const altSelector = 'input[placeholder="Write alt text..."], input[aria-label="Write alt text"], input[placeholder="대체 텍스트 작성..."]';
  const mediaMatches = snapshot => snapshot?.previews?.length === expected.length && expected.every((file, index) => {
    const image = snapshot.previews[index];
    return image.digest === file.digest && image.width === file.width && image.height === file.height;
  });
  const next = async stop => {
    const clicked = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
      if (dialogs.length !== 1) return false;
      const buttons = [...dialogs[0].querySelectorAll('button, [role="button"]')]
        .filter(button => /^(Next|다음)$/.test(String(button.innerText ?? '').trim()));
      if (buttons.length !== 1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return false;
      buttons[0].click(); return true;
    });
    if (!clicked) stop('EGO_MEDIA_FAILED');
    await sleep(600);
  };
  return {
    origin: 'https://www.instagram.com',
    composerSelector: 'div[role="dialog"] [contenteditable="true"][role="textbox"]',
    postButton: 'div[role="dialog"] button[aria-label="Share"], div[role="dialog"] [role="button"][aria-label="Share"], div[role="dialog"] button[aria-label="공유"]',
    profileUrl: PLATFORM_UI.instagram.profileUrl,
    composerOpen: async () => {
      const clicked = await page.evaluate(() => {
        const icons = [...document.querySelectorAll('svg[aria-label="New post"], svg[aria-label="새 게시물"]')];
        const buttons = [...new Set(icons.map(icon => icon.closest('button, a, [role="button"]')).filter(Boolean))];
        if (buttons.length !== 1) return false;
        buttons[0].click(); return true;
      });
      if (clicked) await sleep(800);
      return clicked;
    },
    prepareMedia: async (media, stop) => {
      if (!media.length || media.length > 20) stop('EGO_MEDIA_FAILED');
      try {
        await page.setInputFiles('div[role="dialog"] input[type="file"]', media.map(image => image.path));
        const deadline = Date.now() + 20000;
        await page.waitForSelector('div[role="dialog"] img[src^="blob:"]', { state: 'visible', timeout: 20000 });
        let snapshot;
        while (Date.now() < deadline) {
          snapshot = await PLATFORM_UI.instagram.inspectMedia(page, true);
          if (!snapshot) stop('EGO_MEDIA_FAILED');
          if (snapshot.files.length === media.length && snapshot.previews.length === media.length) break;
          await sleep(100);
        }
        expected = snapshot?.files ?? [];
        if (expected.length !== media.length || expected.some((file, index) => file.name !== media[index].path.split('/').at(-1)) || !mediaMatches(snapshot)) stop('EGO_MEDIA_FAILED');
        await next(stop); // 사진 선택 → 편집 → 캡션. 사진 변환·자동 잘림은 하지 않는다.
        await next(stop);
        await page.evaluate(selector => {
          const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
          if (dialogs.length !== 1 || dialogs[0].querySelectorAll(selector).length) return;
          const buttons = [...dialogs[0].querySelectorAll('button, [role="button"]')].filter(button => /^(Accessibility|접근성)$/.test(String(button.innerText ?? '').trim()));
          if (buttons.length === 1) buttons[0].click();
        }, altSelector);
        await sleep(300);
        const filled = await page.evaluate(({ selector, descriptions }) => {
          const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
          if (dialogs.length !== 1) return false;
          const inputs = [...dialogs[0].querySelectorAll(selector)];
          if (inputs.length !== descriptions.length) return false;
          for (let index = 0; index < inputs.length; index++) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inputs[index], descriptions[index]);
            inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
          }
          return inputs.every((input, index) => input.value === descriptions[index]);
        }, { selector: altSelector, descriptions: media.map(image => image.alt) });
        if (!filled) stop('EGO_MEDIA_FAILED');
      } catch { stop('EGO_MEDIA_FAILED'); }
    },
    verifyBeforeShare: async (media, body, expectedIdentity, stop) => {
      if (!await PLATFORM_UI.instagram.verifyAudience(page)) stop('EGO_VISIBILITY_FAILED');
      if (!mediaMatches(await PLATFORM_UI.instagram.inspectMedia(page))) stop('EGO_MEDIA_FAILED');
      const ready = await page.evaluate(({ selector, descriptions, body }) => {
        const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
        if (dialogs.length !== 1) return false;
        const dialog = dialogs[0];
        const box = dialog.querySelector('[contenteditable="true"][role="textbox"]');
        if (!box || String(box.innerText ?? '').replace(/\r\n/g, '\n') !== body) return false;
        const inputs = [...dialog.querySelectorAll(selector)];
        if (inputs.length !== descriptions.length || !inputs.every((input, index) => input.value === descriptions[index])) return false;
        const controls = [...dialog.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"]')];
        const channels = controls.filter(input => /Facebook|Threads/i.test(input.getAttribute('aria-label') ?? input.closest('label')?.innerText ?? ''));
        if (!channels.length || controls.some(input => input.checked === true || input.getAttribute('aria-checked') !== 'false' && input.checked !== false)) return false;
        globalThis[Symbol.for('aha-skills.social-posting.instagram-share-dialog')] = dialog;
        return true;
      }, { selector: altSelector, descriptions: media.map(image => image.alt), body });
      if (!ready) stop('EGO_READBACK_MISMATCH');
      if (new URL(await page.url()).origin !== 'https://www.instagram.com') stop('EGO_ORIGIN_MISMATCH');
      const href = await ownProfileHref(page, 'instagram');
      if (href?.replace(/^\/|\/$/g, '') !== expectedIdentity) stop('EGO_ACCOUNT_MISMATCH');
    },
    clickShare: async (selector, identity) => page.evaluate(({ selector, identity, profileSelector }) => {
      const proof = globalThis[Symbol.for('aha-skills.social-posting.instagram-audience')];
      const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
      const buttons = proof ? [...proof.dialog.querySelectorAll('[aria-label="Audience"], [aria-label="공개 대상"]')].filter(node => node.getClientRects().length) : [];
      if (!proof || dialogs.length !== 1 || dialogs[0] !== proof.dialog || !proof.dialog.isConnected ||
          buttons.length !== 1 || buttons[0] !== proof.button || !new RegExp(proof.pattern).test(String(buttons[0].innerText ?? '').trim())) return 'visibility-failed';
      const identities = new Set([...document.querySelectorAll(profileSelector)].filter(node => node.getClientRects().length)
        .map(node => node.getAttribute('href')?.replace(/^\/|\/$/g, '')));
      if (identities.size !== 1 || !identities.has(identity)) return 'account-failed';
      const controls = [...proof.dialog.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"]')];
      if (!controls.length || controls.some(node => node.checked === true || node.getAttribute('aria-checked') !== 'false' && node.checked !== false)) return 'readback-failed';
      const button = document.querySelector(selector);
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      button.click(); return true;
    }, { selector, identity, profileSelector: PLATFORM_UI.instagram.ownProfileSelector }),
    evidence: async () => {
      const result = await page.evaluate(() => {
        const dialog = globalThis[Symbol.for('aha-skills.social-posting.instagram-share-dialog')];
        if (!dialog?.isConnected || dialog.querySelector('[contenteditable="true"][role="textbox"]')) return null;
        const heading = dialog.querySelector('h2, [role="heading"]');
        if (!heading?.getClientRects().length) return null;
        const text = String(heading.innerText ?? '').trim();
        if (!/^(Your post has been shared\.?|게시물이 공유되었습니다\.?)$/.test(text)) return null;
        const hrefs = [...dialog.querySelectorAll('a[href]')].map(anchor => anchor.getAttribute('href')).filter(href => /^\/p\/[A-Za-z0-9_-]+\/?$/.test(href ?? ''));
        return { href: hrefs.length === 1 ? hrefs[0] : null };
      });
      if (!result) return false;
      permalink = result.href;
      return true;
    },
    findPermalink: async () => permalink,
  };
}
