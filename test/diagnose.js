// Paste into the DevTools console on the Google Tasks page (with the Today
// view active) and share the output. It reports page structure only: task
// titles (html-blob) and any text over 40 characters are masked as «N chars».
(() => {
  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  const maskIf = (s, secret) => (secret || s.length > 40 ? `«${s.length} chars»` : s);
  const count = (s) => document.querySelectorAll(s).length;

  const describe = (el, depth = 0, max = 8, inTitle = false) => {
    if (depth > max) return '';
    inTitle = inTitle || el.tagName === 'HTML-BLOB';
    const titleText = clean((el.closest('[role="listitem"]')?.querySelector('html-blob')?.textContent) || '');
    const attrs = ['role', 'aria-label', 'class']
      .filter((a) => el.hasAttribute(a))
      .map((a) => {
        const v = clean(el.getAttribute(a));
        return `${a}="${a === 'aria-label' ? maskIf(v, inTitle || (titleText && v.includes(titleText))) : v.slice(0, 30)}"`;
      });
    const text = el.children.length === 0 && el.textContent.trim() ? ' ' + maskIf(clean(el.textContent), inTitle) : '';
    return '  '.repeat(depth) + `<${el.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>${text}\n` +
      [...el.children].map((c) => describe(c, depth + 1, max, inTitle)).join('');
  };

  const out = {
    url: location.origin + location.pathname,
    lang: document.documentElement.lang,
    todayActive: Boolean(document.querySelector('#gtt-today-item.gtt-active')),
    iframes: [...document.querySelectorAll('iframe')].map((f) => (f.src || '(no src)').split('?')[0]),
    counts: Object.fromEntries(['[role="menu"]', '[role="menuitem"]', '[role="list"]', '[role="listitem"]',
      'h2', 'h3', 'html-blob', '.gtt-hidden'].map((s) => [s, count(s)])),
    h3: [...new Set([...document.querySelectorAll('h3')].map((h) => maskIf(clean(h.textContent))))].slice(0, 15),
  };

  // Hidden task rows are the interesting ones (e.g. overdue tasks we missed).
  const rows = [...document.querySelectorAll('[role="listitem"]')].filter((r) => r.querySelector('html-blob'));
  const hidden = rows.filter((r) => r.classList.contains('gtt-hidden'));
  const sample = (hidden.length ? hidden : rows).slice(0, 4);

  console.log(JSON.stringify(out, null, 2) +
    `\n\n--- ${hidden.length ? 'hidden' : 'first'} task rows ---\n` + sample.map((r) => describe(r)).join('\n'));
})();
