// Records the DOM elements you interact with, so the add-task / set-date flow
// can be automated. Paste into the DevTools console, do the steps by hand,
// then run gttDump() and share the output.
//
// Privacy: text in task titles, inputs and editable fields, and any text over
// 40 characters, is masked as «N chars». Name the test task "gtt test".
(() => {
  const log = [];
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const secret = (el) => Boolean(el.closest && el.closest('html-blob, input, textarea, [contenteditable="true"]'));
  const mask = (s, hide) => (hide || s.length > 40 ? `«${s.length} chars»` : s);

  const one = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const hide = secret(el);
    const bits = [el.tagName.toLowerCase()];
    for (const a of ['role', 'aria-label', 'aria-haspopup', 'aria-expanded', 'aria-selected', 'jsname', 'type', 'contenteditable', 'data-date']) {
      if (el.hasAttribute(a)) bits.push(`${a}="${mask(clean(el.getAttribute(a)), hide && a === 'aria-label')}"`);
    }
    const text = clean(el.textContent);
    if (text && el.children.length < 3) bits.push(`text="${mask(text, hide)}"`);
    return '<' + bits.join(' ') + '>';
  };
  const path = (el) => {
    const parts = [];
    for (let i = 0; el && el !== document.body && i < 6; el = el.parentElement, i++) {
      parts.push(one(el));
      if (el.matches('[role="listitem"], [role="dialog"], [role="menu"], [role="grid"]')) break;
    }
    return parts.join('\n      ↑ ');
  };
  const tree = (el, depth = 0, lines = []) => {
    if (depth > 5 || lines.length > 60) return lines;
    lines.push('      ' + '  '.repeat(depth) + one(el));
    [...el.children].forEach((c) => tree(c, depth + 1, lines));
    return lines;
  };
  const t0 = performance.now();
  const add = (kind, body) => log.push(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${kind}\n    ${body}`);

  for (const type of ['click', 'focusin']) {
    document.addEventListener(type, (e) => add(type, path(e.target)), true);
  }
  document.addEventListener('keydown', (e) => {
    if (['Enter', 'Escape', 'Tab'].includes(e.key)) add(`key ${e.key}`, path(e.target));
  }, true);

  const POPUP = '[role="dialog"], [role="grid"], [role="menu"], [role="listbox"], [role="alertdialog"]';
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const popup = n.matches(POPUP) ? n : n.querySelector(POPUP);
        if (popup) add('popup opened', '\n' + tree(popup).join('\n'));
        const row = n.matches('[role="listitem"]') ? n : null;
        if (row && row.querySelector('html-blob, input, textarea, [contenteditable]')) add('task row added', '\n' + tree(row).join('\n'));
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.gttDump = () => {
    const text = log.join('\n\n');
    console.log(text);
    return `${log.length} events logged above — copy them from the console.`;
  };
  console.log('Recording. Add a task named "gtt test", set its date to Today, then run gttDump().');
})();
