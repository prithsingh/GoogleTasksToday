# Today View for Google Tasks

Chrome extension that adds a **Today** item to the Google Tasks sidebar — both [Calendar's Tasks view](https://calendar.google.com/calendar/u/0/r/tasks) and [tasks.google.com](https://tasks.google.com).
Selecting it shows only overdue tasks and tasks due today, across all your lists.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/today-view-for-google-tas/opkaepelieojhoenmghbhgkoaokncfce)**

- No sign-in, no API access, no permissions — a content script that filters the page you already see.
- Date labels are matched in the page's language via `Intl` (e.g. "Today", "Yesterday", "3 days ago", "Wed, Sep 24").
- Due tasks from every list appear together in one **Today** card, each tagged with its list name; completed tasks are hidden and the view re-filters as tasks change.
- Tasks added in the Today view (**Add a task**, type a title, then Enter or click away) are dated today.
- Clicking any other sidebar view or list returns to the normal view.

## Install (unpacked)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open (or reload) https://calendar.google.com/calendar/u/0/r/tasks and click **Today** in the sidebar.

## Test

```sh
./test/run.sh
```

Loads `test/fixture.html` — a mock of the Google Tasks DOM — in headless Chrome and prints PASS/FAIL per check.

## How it works

Google's class names are obfuscated, so `content.js` locates elements by ARIA roles and tags:

| Element | Selector |
|---|---|
| Sidebar views | `[role="menu"]` whose 2nd `[role="menuitem"]` has a `star_border` icon (All tasks, Starred) |
| List column | highest ancestor of an `h2` containing no other `h2` |
| Tasks | `[role="list"] > [role="listitem"]`, title in `html-blob` |
| Due date | a `div[aria-label]` in the task whose text is a date |
| Date-sorted sections | `h3` headers ("Past", "Today", …) |
| New task | `textarea` title + quick "Today"/"Tomorrow" `[role="button"]` pair; "Add a task" is `[jsname="MhySTb"]` |

The Tasks UI inside Google Calendar is an iframe from `tasks.google.com/embed/`, so the content script runs in all frames.

If Google changes this markup the filter can break; update the selectors in `content.js` and the fixture.

## License

[MIT](LICENSE)
