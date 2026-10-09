// Today View for Google Tasks
//
// Adds a "Today" item to the tasks.google.com sidebar. Selecting it opens
// "All tasks" and hides everything except overdue tasks and tasks due today.
//
// Works purely on the page DOM: no sign-in, no API calls, no data leaves the
// browser. Google's class names are obfuscated, so elements are located by
// ARIA roles and tag names instead.

(() => {
  'use strict';

  const TODAY_ID = 'gtt-today-item';
  const HIDDEN = 'gtt-hidden';
  const ACTIVE = 'gtt-active';
  const INACTIVE = 'gtt-inactive';
  // Classes for stacking the lists into one "Today" card; see mergeColumns().
  const MERGE_CLASSES = ['gtt-merged', 'gtt-card', 'gtt-card-first', 'gtt-card-last', 'gtt-card-body', 'gtt-title', 'gtt-list-tag'];
  const STAR_ICON = /^star(_border|_outline)?$/;

  const lang = document.documentElement.lang || navigator.language || 'en';

  let active = false;
  let switching = false; // true while we programmatically click "All tasks"
  let filterTimer = null;
  let lookup = null;
  let lookupDay = null;

  // --- Date classification ---

  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

  // Every way Google Tasks might render a date on or before today, in the
  // page language ("Today", "Yesterday", "3 days ago", "Wed, Sep 24",
  // "Sep 24, 2025"), mapped to 'today' or 'past'. Rebuilt when the day changes.
  function getLookup() {
    const now = new Date();
    const day = now.toDateString();
    if (lookup && lookupDay === day) return lookup;

    const map = new Map();
    const add = (text, kind) => {
      const key = norm(text);
      if (!map.has(key)) map.set(key, kind);
    };

    // Both "yesterday" / "last week" and "1 day ago" / "1 week ago" styles.
    for (const numeric of ['auto', 'always']) {
      const rtf = new Intl.RelativeTimeFormat(lang, { numeric });
      add(rtf.format(0, 'day'), 'today');
      for (let n = 1; n <= 31; n++) add(rtf.format(-n, 'day'), 'past');
      for (let n = 1; n <= 52; n++) add(rtf.format(-n, 'week'), 'past');
      for (let n = 1; n <= 12; n++) add(rtf.format(-n, 'month'), 'past');
      for (let n = 1; n <= 10; n++) add(rtf.format(-n, 'year'), 'past');
    }

    // Short ("Wed, Sep 24"), long ("Wednesday, September 24") and numeric
    // ("9/24") styles, each with and without weekday / year.
    const base = [
      { month: 'short', day: 'numeric' },
      { weekday: 'short', month: 'short', day: 'numeric' },
      { month: 'long', day: 'numeric' },
      { weekday: 'long', month: 'long', day: 'numeric' },
      { month: 'numeric', day: 'numeric' },
    ];
    const yearless = base.map((o) => new Intl.DateTimeFormat(lang, o));
    const withYear = base.map((o) => new Intl.DateTimeFormat(lang, { ...o, year: 'numeric' }));

    for (let i = 0; i <= 730; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const kind = i === 0 ? 'today' : 'past';
      // Google omits the year only for dates in the current year.
      if (d.getFullYear() === now.getFullYear()) yearless.forEach((f) => add(f.format(d), kind));
      withYear.forEach((f) => add(f.format(d), kind));
    }

    lookup = map;
    lookupDay = day;
    return map;
  }

  // Returns 'today', 'past' or null (future / not a date). Trailing
  // ", ..." parts (e.g. a time) are dropped one at a time so
  // "Today, 1:30 PM" resolves. A year is never dropped: an unknown
  // "Sep 29, 2028" is in the future, not today's "Sep 29".
  function classify(text) {
    const map = getLookup();
    let t = norm(text);
    while (t) {
      if (map.has(t)) return map.get(t);
      const i = t.lastIndexOf(',');
      if (i < 0 || /^\d{4}$/.test(t.slice(i + 1).trim())) return null;
      t = t.slice(0, i).trim();
    }
    return null;
  }

  // --- DOM lookup ---

  const findStarIcon = (root) => [...root.querySelectorAll('*')].find(
    (el) => el.children.length === 0 && STAR_ICON.test(el.textContent.trim())
  );

  // The Tasks sidebar menu is the one whose second item is "Starred". The
  // star check keeps us out of Google Calendar's other menus.
  function findSidebarMenu() {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      const items = menu.querySelectorAll('[role="menuitem"]:not(#' + TODAY_ID + ')');
      if (items.length >= 2 && findStarIcon(items[1])) return menu;
    }
    return null;
  }

  // Highest ancestor of the menu that holds no list headings (h2), i.e. the
  // whole sidebar including the "Lists" section.
  function findSidebar(menu) {
    let el = menu;
    while (el.parentElement && !el.parentElement.querySelector('h2')) el = el.parentElement;
    return el;
  }

  // Highest ancestor of a list heading that contains no other heading and
  // not the sidebar, i.e. that list's whole column.
  function columnFor(h2, menu) {
    let el = h2;
    while (
      el.parentElement &&
      el.parentElement.querySelectorAll('h2').length === 1 &&
      !(menu && el.parentElement.contains(menu))
    ) {
      el = el.parentElement;
    }
    return el;
  }

  // A task list has rows with an html-blob title; other lists on the page
  // (e.g. Calendar's "My calendars") don't.
  function findTaskList(column) {
    for (const list of column.querySelectorAll('[role="list"]')) {
      if (list.querySelector(':scope > [role="listitem"] html-blob')) return list;
    }
    return null;
  }

  // --- Filtering ---

  // The element in the row (other than the title) that reads as a date on or
  // before today, or null.
  function dueDateLabel(item, title) {
    for (const el of item.querySelectorAll('*')) {
      if (el.contains(title) || title.contains(el)) continue;
      if (classify(el.textContent)) return el;
    }
    return null;
  }

  // Hides irrelevant tasks in one list; returns the visible ones as
  // { item, label } where label is the due-date element (null when the task
  // is shown because of its "Past" / "Today" section).
  function filterList(list) {
    const items = [...list.querySelectorAll(':scope > [role="listitem"]')];
    const headers = items.map((item) => item.querySelector('h3'));
    // Lists sorted by date are grouped under headers like "Past", "Today",
    // "Tomorrow". Anything above the "Today" header is overdue.
    const todayIdx = headers.findIndex((h) => h && classify(h.textContent) === 'today');

    let inRelevantSection = false;
    const shown = [];
    items.forEach((item, idx) => {
      const h3 = headers[idx];
      if (h3) {
        inRelevantSection = Boolean(
          classify(h3.textContent) ||
          (todayIdx >= 0 && idx < todayIdx) ||
          /^(past|overdue)$/i.test(h3.textContent.trim())
        );
        if (!inRelevantSection) item.classList.add(HIDDEN);
        return;
      }
      const title = item.querySelector('html-blob');
      if (!title) return; // not a task row
      const label = dueDateLabel(item, title);
      if (inRelevantSection || label) shown.push({ item, label });
      else item.classList.add(HIDDEN);
    });
    return shown;
  }

  // Hides the "Completed" section: the part of the column holding a task
  // list other than the main one. Google renders that list even while the
  // section is collapsed, so this needs no "Completed" text.
  function hideCompleted(column, mainList) {
    for (const list of column.querySelectorAll('[role="list"]')) {
      if (list.contains(mainList) || mainList.contains(list)) continue;
      let section = list;
      while (section.parentElement && !section.parentElement.contains(mainList)) {
        section = section.parentElement;
      }
      section.classList.add(HIDDEN);
    }
  }

  // --- New tasks ---

  // An undated task being edited shows a pair of quick "Today" / "Tomorrow"
  // buttons. (A lone "Today" button is the date chip of a scheduled task.)
  function quickTodayButton(row) {
    return [...row.querySelectorAll('[role="button"]')].find((b) =>
      classify(b.textContent) === 'today' &&
      b.parentElement.querySelectorAll(':scope > [role="button"]').length > 1
    );
  }

  // The "Add a task" button of the list containing the row.
  function addTaskButton(row) {
    for (let el = row; el; el = el.parentElement) {
      const btn = el.querySelector('[jsname="MhySTb"]');
      if (btn) return btn;
    }
    return null;
  }

  // Pressing Enter in a new task's title normally saves it undated and opens
  // another new task. In the Today view, save it with today's date instead,
  // then open the next new task.
  window.addEventListener('keydown', (e) => {
    if (!active || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const title = e.target instanceof HTMLTextAreaElement ? e.target : null;
    const row = title && title.closest('[role="listitem"]');
    const todayBtn = row && quickTodayButton(row);
    if (!todayBtn || !title.value.trim()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // The quick button ignores clicks while the title has focus, so leave the
    // title first, as a real mouse click would. That also saves the title.
    todayBtn.tabIndex = -1;
    todayBtn.focus();
    setTimeout(() => {
      todayBtn.click();
      setTimeout(() => {
        const add = addTaskButton(row);
        if (add) add.click();
      }, 300);
    }, 100);
  }, true);

  // Clicking away from a new task's title also saves it; date it too.
  window.addEventListener('focusout', (e) => {
    if (!active) return;
    const title = e.target instanceof HTMLTextAreaElement ? e.target : null;
    const row = title && title.closest('[role="listitem"]');
    const todayBtn = row && quickTodayButton(row);
    if (!todayBtn || !title.value.trim() || row.contains(e.relatedTarget)) return;
    todayBtn.click();
  }, true);

  function clearFilter() {
    for (const cls of [HIDDEN, ...MERGE_CLASSES]) {
      document.querySelectorAll('.' + cls).forEach((el) => el.classList.remove(cls));
    }
  }

  // Shows several lists as one "Today" card: the first list's header (titled
  // "Today", with its "Add a task") on top, then each list's due tasks with
  // its own header hidden. Styling only: Google's rows stay in their own
  // lists so completing, editing and dragging keep working.
  function mergeColumns(columns) {
    const container = columns[0].column.parentElement;
    if (!columns.every((c) => c.column.parentElement === container)) return;
    container.classList.add('gtt-merged');
    columns.forEach(({ column, h2, list, shown }, i) => {
      column.classList.add('gtt-card');
      shown.forEach(({ item, label }) => label && tagWithList(item, label, h2.textContent.trim()));
      if (i === 0) column.classList.add('gtt-card-first');
      if (i === columns.length - 1) column.classList.add('gtt-card-last');
      for (const part of column.children) {
        if (part.contains(list)) part.classList.add('gtt-card-body');
        else if (part.contains(h2) && i > 0) part.classList.add(HIDDEN);
      }
    });
    const { h2 } = columns[0];
    h2.classList.add('gtt-title');
    h2.dataset.gttTitle = todayLabel();
    // The first list's options menu would act on that list only.
    if (h2.nextElementSibling) h2.nextElementSibling.classList.add(HIDDEN);
  }

  // Shows which list a task comes from, as a chip after its due date. The
  // date chip sits in a flex row of chips; CSS draws the tag as that row's
  // ::after, so no elements are added to Google's rows.
  function tagWithList(item, label, listName) {
    // label may be the chip, something inside it, or the strip around it.
    const chip = label.closest('[role="button"]') || label.querySelector('[role="button"]') || label;
    for (let el = chip.parentElement; el && el !== item; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.display.includes('flex') && style.flexDirection === 'row') {
        el.classList.add('gtt-list-tag');
        el.dataset.gttList = listName;
        return;
      }
    }
  }

  function applyFilter() {
    clearFilter();
    const menu = findSidebarMenu();
    const columns = [];
    for (const h2 of document.querySelectorAll('h2')) {
      const column = columnFor(h2, menu);
      const list = findTaskList(column);
      if (!list) continue;
      columns.push({ column, h2, list, shown: filterList(list) });
      hideCompleted(column, list);
    }
    // With several lists, keep the first (it hosts the header and "Add a
    // task") plus any list with something due, merged into one card.
    if (columns.length > 1) {
      const kept = columns.filter((c, i) => i === 0 || c.shown.length > 0);
      columns.filter((c) => !kept.includes(c)).forEach((c) => c.column.classList.add(HIDDEN));
      mergeColumns(kept);
    }
    markSidebar();
  }

  function scheduleFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => active && applyFilter(), 150);
  }

  // --- Sidebar ---

  function markSidebar() {
    const menu = findSidebarMenu();
    const today = menu && menu.querySelector('#' + TODAY_ID);
    if (!today) return;
    const others = [...menu.querySelectorAll('[role="menuitem"]')].filter((i) => i !== today);
    others.forEach((i) => i.classList.remove(INACTIVE));
    if (!active) {
      today.classList.remove(ACTIVE);
      return;
    }
    // Borrow the native selection colour from "All tasks", which is selected
    // underneath us, so the highlight matches light and dark themes.
    const bg = getComputedStyle(others[0]).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      today.style.setProperty('--gtt-active-bg', bg);
    }
    today.classList.add(ACTIVE);
    others.forEach((i) => i.classList.add(INACTIVE));
  }

  function activate() {
    const menu = findSidebarMenu();
    if (!menu) return;
    active = true;
    // Show every list; the observer re-filters once it has rendered.
    switching = true;
    menu.querySelector('[role="menuitem"]:not(#' + TODAY_ID + ')').click();
    switching = false;
    scheduleFilter();
  }

  function deactivate() {
    active = false;
    clearTimeout(filterTimer);
    clearFilter();
    markSidebar();
  }

  function calendarIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z');
    svg.appendChild(path);
    return svg;
  }

  function todayLabel() {
    const word = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(0, 'day');
    return word.charAt(0).toLocaleUpperCase(lang) + word.slice(1);
  }

  // Clones "Starred" so the new item matches Google's styling exactly.
  function buildTodayItem(template) {
    const item = template.cloneNode(true);
    item.id = TODAY_ID;
    // Detach from Google's event handling so clicks don't open Starred.
    for (const el of [item, ...item.querySelectorAll('*')]) {
      ['jsaction', 'jscontroller', 'jsname', 'aria-selected', 'aria-current'].forEach((a) => el.removeAttribute(a));
    }
    item.style.backgroundColor = '';

    const icon = findStarIcon(item);
    if (icon) {
      icon.textContent = '';
      icon.appendChild(calendarIcon());
    }

    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    let labelled = false;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      node.textContent = labelled ? '' : todayLabel(); // drop any count badge
      labelled = true;
    }

    const onActivate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!active) activate();
    };
    item.addEventListener('click', onActivate);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onActivate(e);
    });
    return item;
  }

  function injectTodayItem() {
    const menu = findSidebarMenu();
    if (!menu || menu.querySelector('#' + TODAY_ID)) return;
    const items = menu.querySelectorAll('[role="menuitem"]');
    // items[0] is "All tasks", items[1] is "Starred".
    items[1].after(buildTodayItem(items[1]));
    markSidebar();
  }

  // --- Init ---

  // Leaving Today: any click on another sidebar view or list.
  document.addEventListener('click', (e) => {
    if (!active || switching) return;
    const menu = findSidebarMenu();
    if (!menu) return;
    const target = e.target;
    if (target.closest('#' + TODAY_ID)) return;
    if (findSidebar(menu).contains(target) && target.closest('[role="menuitem"], [role="option"]')) {
      deactivate();
    }
  }, true);

  // Google Tasks is a single-page app: re-inject the item when the sidebar
  // re-renders, and re-filter when tasks load or change.
  new MutationObserver(() => {
    injectTodayItem();
    if (active) scheduleFilter();
  }).observe(document.body, { childList: true, subtree: true });

  injectTodayItem();
})();
