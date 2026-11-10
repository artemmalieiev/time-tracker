# Time Tracker

A personal Chrome extension (Manifest V3) for tracking time on tasks. The UI is in Russian, and the CSV export is in English. Repo: https://github.com/artemmalieiev/time-tracker (branch `main`).

## Working agreements

- Commit and push only when asked. Commit messages follow the `git:commit-message-create` skill.
- Do not publish to the Chrome Web Store. The extension is not ready yet. Publishing would also require removing `key` from the manifest.
- Never change or remove `key` in `src/manifest.json`. It pins the extension ID `cnlbkpefkmajpofoffbjfmioohjlbjbp` so stored data survives reloads from any folder.
- Code follows the `typescript:conventions` skill strictly (see below). Lint passing does not mean a rule is followed.
- Reply to the user in Russian.

## Commands

Node 22.18+ is required (`build.ts` runs through Node type stripping).

```sh
npm run build    # esbuild → dist/extension (the unpacked extension) and dist/tests
npm run compile  # tsc for tsconfig.json (browser) and tsconfig.node.json (tests, build.ts)
npm run lint     # eslint 10 flat config + typescript-eslint type-checked + jsdoc
npm test         # node dist/tests/index.js; run build first
```

Run all four after every change. TypeScript is pinned to `~6.0.3` because typescript-eslint does not support newer versions.

Install for manual testing: `chrome://extensions` → Developer mode → Load unpacked → `dist/extension`, then press reload after each build.

## Layout

- `src/manifest.json`: permissions `storage`, `unlimitedStorage`, `identity`, `identity.email`, `alarms`, `downloads`. Minimum Chrome 116.
- `src/background.ts`: the service worker.
  - Toolbar badge while a task runs: a white `●` on red `#d92b21`, like a record button.
  - Badge while tasks are paused: `❚❚` on gray `#6b7280`.
  - Hourly `auto-backup` alarm.
  - The worker never counts time itself.
- `src/popup.*`: the toolbar popup.
  - A stopwatch dial for the running task, a list of paused tasks and the new-task form.
  - While a task runs, the form folds behind «Начать другую задачу».
  - «Завершить» finishes the task immediately, then shows a finish panel for public time («Сохранить» / «Пропустить»).
  - Chrome caps popup height at 600px, so keep the UI compact.
- `src/app.*`: the journal page.
  - Periods: day, week (Monday start), month, last month and a custom range. A project filter.
  - A summary total and project bars, both showing tracked time.
  - A table with the columns Дата, Проект, Задача, Статус, Начало, Конец, Время, Публичное, plus a «Итого» footer row.
  - An edit dialog, manual entries, delete, backup and restore controls and the CSV export.
- `src/lib/storage.ts`: data model, every mutation (`mutate` with a write queue), backup and restore, `entryDuration` and `reportDuration`.
- `src/lib/time.ts`: ranges, parsing and formatting with date-fns 4 and the `ru` locale.
- `src/lib/autobackup.ts`: daily automatic backup.
- `src/lib/user.ts`: `getEmail()` and `getKey()`. The key is the email from `chrome.identity.getProfileUserInfo`, or `'local'`.
- `src/lib/dom.ts`: `el()` and `byId()` helpers.
- `src/ambient-types/native-extensions.d.ts`: types for Chrome's built-in Translator and LanguageDetector APIs.
- `src/tests/`: tests with plain `node:assert` and no framework. `chrome-mock.ts` mocks the chrome API, and `index.ts` runs the suites one after another.
- `build.ts`: esbuild with target chrome116. It copies HTML, JSON and PNG files, and fonts go to `fonts/[name]-[hash]`.

## Data model

Everything lives in `chrome.storage.local` with snake_case keys.

- `entries` holds an array of `Entry`:
  - `id`, `title`, `description`, `project`, `status` (`'running' | 'paused' | 'done'`), `user_email`, `created_at`, `updated_at`;
  - `segments`: an array of `{ start, end }`, where `end` is `null` while the segment runs;
  - `public_duration`: milliseconds, or `null` when not set.
- Durations always come from the segment timestamps, so closing Chrome loses nothing.
- At most one task runs at a time. Starting or resuming a task pauses the others.
- Every read is filtered by the current user, and project names come only from that user's entries.
- `upgrade()` migrates version 1 entries (camelCase: `createdAt`, `userEmail` and so on). It also sets a missing `public_duration` to `null`. The next write saves the new shape.
- `auto_backup` holds the automatic backup metadata. The legacy key `autoBackup` is migrated.

### Public time

- Public time is optional, per task. The CSV reports it instead of tracked time.
- `reportDuration(entry, range, now)`:
  - with no public time, it returns tracked time;
  - for a task spanning several days, it splits public time in proportion to the tracked time inside the range;
  - for a zero-length task, all of it goes to the day the task started.
- The «Публичное» column shows the value, dimmed when it is not set.
- The summary total and the project bars stay on tracked time.
- `parsePublicDuration(hours, minutes)` in `time.ts` is shared by the popup and the edit dialog. Both fields empty gives `null`. It rejects non-digits and minutes above 59.

## Backups

- `createBackup()` builds a JSON file `{ app: 'time-tracker', version: 2, exported_at, user, projects, entries }`.
- `restoreBackup()`:
  - merges by `id`, and the newer `updated_at` wins;
  - reassigns entries to the current user and keeps only one task running;
  - accepts version 1 and version 2 files.
- Automatic backups:
  - the alarm fires hourly, and a file is written at most once a day and only when the data changed;
  - files go to `Downloads/time-tracker-backups/time-tracker-backup_yyyy-MM-dd_HH-mm.json`;
  - the newest 14 files are kept.

## Duration formats

- `formatDurationWords` is used in the journal: `1ч 30 мин`, `45 мин`, `2ч`, joined with non-breaking spaces.
- `formatDurationEnglish` is used in the CSV: `1h 30 min`, `45 min`, `2h`.
- `formatTimer` is used on the popup dial: `1:05:09`.
- `formatDuration` is used in the popup paused list: `1:05`.

## CSV export

- Columns: `Date, Project, Title, Description, Status, Duration`, with a final `Total` row.
- Duration comes from `reportDuration`, so public time takes priority.
- Optional translation into English uses Chrome's Translator API, with the source language detected by LanguageDetector.

## Design: "stopwatch dial"

- Tokens are defined on `:root` in `src/common.css`, each with a dark-mode value.

  | Token | Light | Dark | Use |
  |---|---|---|---|
  | `--dial` | `#eef1f4` | `#13171c` | page background |
  | `--face` | `#ffffff` | `#1b2027` | card surface |
  | `--ink` | `#1c2128` | `#e7ebef` | text |
  | `--muted` | `#5d6773` | `#97a1ad` | secondary text |
  | `--rule` | `#d5dbe1` | `#2b323b` | dividers |
  | `--signal` | `#d92b21` | `#ff5247` | running |
  | `--hold` | `#b06d00` | `#e3a33a` | paused |
  | `--data` | `#2a78d6` | `#3987e5` | chart bars |

- Fonts:
  - Golos Text (400/500/600) for text and Unbounded 600 for numerals;
  - only Latin and Cyrillic woff2 files load, through custom `@font-face` rules, which keeps the build around 144 KB.
- The dial is the one loud element. Everything else stays quiet.
- The app icon is a blue clock. The toolbar badge carries the run state.

## TypeScript conventions (from the `typescript:conventions` skill)

- Syntax:
  - no destructuring and no `new X().y`;
  - type assertions use angle brackets (`<T>value`);
  - no explicit return types;
  - snake_case JSON keys and unquoted object keys;
  - no default exports and no module-level constant hoisting.
- Functions:
  - named function declarations and named function expressions;
  - no functions created inside loops.
- Interfaces: members are in alphabetical order.
- Type guards take `any`, and each guard check is separate.
- Async code:
  - listeners are never `async`; call the async function with `.catch(console.warn)`;
  - no `return await`.
- Errors:
  - always bind the catch variable, and no empty catch blocks;
  - attach data with `new Error(msg, { cause })`.
- Match the style of the file being edited.

## Verifying UI without Chrome

Earlier sessions took headless Chrome screenshots of `dist/extension` with a mock `chrome` API served over `python3 -m http.server`. That harness lived in the session scratchpad and is not in the repo.
- Rebuild it if needed. Headless Chrome defaults to dark mode, and `--blink-settings=preferredColorScheme=1` forces light mode.
- Use a window at least 520px wide.
