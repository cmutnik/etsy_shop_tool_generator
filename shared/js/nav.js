// Copyright (c) 2025 cmutnik
// Site navigation: lists every live tool in the page header (from tools/registry.json) and marks the current one.
// No dependencies. Add a tool to the registry and it appears on every page; nothing to edit here.

const root = new URL('../../', import.meta.url);       // the site root, wherever the site is hosted

/** Is `pathname` inside the tool whose page is at `toolUrl`? (Matches /tools/stamp/ and /tools/stamp/index.html.) */
export function isCurrent(pathname, toolUrl) {
  const base = new URL(toolUrl, 'http://x').pathname.replace(/index\.html$/, '');
  const here = pathname.replace(/index\.html$/, '');
  return here === base || here.startsWith(base);
}

export function renderNav(nav, tools, pathname) {
  nav.replaceChildren(...tools.filter(t => t.status === 'live' && t.path).map(t => {
    const url = new URL('tools/' + t.path, root);
    const a = document.createElement('a');
    a.href = url.href;
    a.textContent = t.title;
    if (isCurrent(pathname, url.pathname)) a.setAttribute('aria-current', 'page');
    return a;
  }));
}

async function init() {
  const nav = document.getElementById('toolnav');
  if (!nav) return;
  try {
    const tools = await (await fetch(new URL('tools/registry.json', root))).json();
    renderNav(nav, tools, location.pathname);
  } catch { /* offline file:// or a missing registry: the brand link still goes home */ }
}
if (typeof document !== 'undefined') init();
