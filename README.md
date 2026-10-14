# cc-desktop-mod: Claude desktop look for the Claude Code terminal

**English** | [한국어](README.ko.md)

**desk-look** is a Claude Code plugin (mod) that makes the Claude Code CLI terminal UI look and work like the Code tab of the Claude desktop app.
It is a Claude Code function-hook plugin: the engine stays as it is, and only the way things are drawn on screen changes. Nothing changes in the Code tab of the desktop app (the `desktop` surface).

![desk-look in action: a prompt, tool calls folded into one line, the edited-files card, the Markdown preview opening by itself when the turn ends, and a line comment in the diff pane](docs/demo.gif)

**At a glance**

- **A transcript that reads like the desktop app**: prompt bubbles, desktop-style markdown with full-width tables, mermaid diagrams and alert boxes, tool calls folded into one clickable line, a card per subagent, a plan card, a question card, and a card of the files each turn edited
- **A status band above the prompt**: repo, branch and `+N −M`, plus chips for the pull request's checks, context usage and running background tasks, and a task checklist
- **Six side panes**, each opened by a command or by clicking a chip: diffs (`/desk-diff`), background tasks (`/desk-tasks`), the pull request (`/desk-pr`), Markdown preview (`/desk-preview`), context and usage limits (`/desk-context`) and recent sessions (`/desk-sessions`)
- **Diff line comments**: click a line number in `/desk-diff` to comment on a line or a range; the comments go to Claude with your next prompt
- **Markdown preview**: a document Claude writes in a turn opens in the preview pane when the turn ends
- **GitHub and GitLab**: PRs through `gh`, merge requests through `glab`
- **English or Korean** labels, following Claude Code's own language setting by default

## Commands

| Command | What it does |
|---|---|
| `/desk-diff [file\|branch\|commits]` | Diff pane: uncommitted changes, the whole branch, or per commit |
| `/desk-tasks [number]` | Background tasks pane: agents, background shells and monitors |
| `/desk-pr` | The current branch's pull request or merge request, with a merge button |
| `/desk-preview [file]` | Markdown preview pane: a document drawn like the transcript |
| `/desk-context` | Context breakdown, usage limits and session cost |
| `/desk-sessions [number]` | Recent sessions by project, with search; switch to one |
| `/desk-update` | Update desk-look to the latest version |

## The transcript

![desk-look in the Claude Code terminal: a prompt bubble, folded tool calls, a markdown table, a mermaid flowchart, a note box and the edited-files card](docs/screenshot.png)

| Area | Terminal default | desk-look |
|---|---|---|
| Your prompt | A line starting with `>` | A gray bubble (a pill for one line, a box with rounded corners for several), left (default) or right. Pasted images show as thumbnails above it |
| Answers | `●` bullet + engine markdown | A markdown renderer in the desktop prose style |
| Tables | Grid tables | Full-width tables with a gray header and row separators |
| mermaid | Code block | Box diagrams ([lovely-mermaid](https://github.com/xl0/lovely-mermaid)) with arrowheads that touch the boxes |
| `> [!NOTE]` alerts | Blockquote | A box with a border colored by alert type |
| Code blocks | No way to copy | Hover to see `⧉ copy` at the right of the top border; click to copy the same way `/copy` does |
| Tool calls | One row per call + a result block | Consecutive calls fold into one line, `Ran 2 commands, edited a file +3 −1 ›`, that expands on click. Expanded, edit diffs show right away (file line numbers, three lines of context), in the desktop diff style when the terminal theme is known |
| Subagents | One `Ran an agent` line; notifications and messages only expand with ctrl+o | A card per agent (type and description; tool count, tokens, time and changed lines; click for the result). Background notifications read `✓ description completed · 5s`; click an agent message `◆ name first line ›` to expand it in place |
| Plan (ExitPlanMode) | Folded into one line with other tools | A card of its own, `◇ Plan Approved` (it also shows waiting, rejected and interrupted), with the plan as markdown. A long plan shows its start and expands with `Show all`. The approval dialog is the engine's own |
| Questions (AskUserQuestion) | A list under the prompt | A question card right above the prompt. With an empty prompt, pick by number alone (`1`-`8` options, `0` submit, `9` the default dialog); multi-select with ☐/☑; `Other` takes two clicks to type (the first selects the row); hover an option for its preview. A notification goes out when the card opens, as the engine dialog does (`preferredNotifChannel`). The transcript records `Asked question → answer` |
| End of turn | A duration line | A card of the files edited that turn, `Edited N files +N −M` (click a file row to open the `/desk-diff` pane at that file), and `⧉ copy` at the right edge to copy the answer |
| Command output | Plain text | Output with tables, headings, code or quotes renders as markdown, like an answer |

![A question card above the prompt: numbered options, Other, and the default dialog](docs/ask.png)

## Around the prompt

| Area | Terminal default | desk-look |
|---|---|---|
| Chin band | — | A rounded gray band like the chin under the desktop prompt: `repo  branch` on the left, `+N −M` on the right (click it for the `/desk-diff` pane), and `✎ N` while diff line comments wait for your next prompt |
| PR chip | — | The current branch's pull request: `#12 ✓ 5/5`, `✗ 1` failing, `● 3/5` running, `◆ 2` unresolved review threads. GitLab merge requests show as `!7` with pipeline jobs and unresolved discussions. Click it for the `/desk-pr` pane |
| Context chip | — | Once context passes half, `◑ 62%` (caution color from 75%, warning color from 90%). Click it for the `/desk-context` pane |
| Tasks chip | `1 shell still running` | While background tasks run, `⋯ 2`. Click it for the `/desk-tasks` pane |
| Checklist | Tool lines | A card above the prompt, `Tasks 2/5` (✓ done, ◉ in progress, ○ to do). Only in sessions that have `TodoWrite` or `TaskCreate` |
| Progress | `✻ Simmering… (12s · ↓ 300 tokens)` | `●·· Running…  2m 29s` (a word that matches the work, clay-colored dots) |
| Mode indicator | Dim text at the bottom right of the prompt | A pill chip (with the omarchy theme) |
| Hint line | `? for shortcuts` | While a question card is open, ends with the keys that answer it (`pick by number · 9 default dialog · Esc cancel`) |

## Side panes

Each pane opens on the right of the terminal, next to the transcript.

### `/desk-diff [file]`: diffs

![The /desk-diff pane in Branch scope: files folded or expanded, with syntax and word highlighting](docs/diff.png)

Per-file diffs in three scopes, like the desktop diff panel:

- `Uncommitted`, `Branch` (the whole branch since it left the base branch, via `merge-base`) and `Commits` (click a commit to expand its diff)
- Give a file name (the end of the path is enough) to scroll to it, or `branch` / `commits` to open in that scope
- Click a file's header row to fold or unfold its diff; `z` folds or unfolds them all (in `Commits`, every commit at once; several commits can stay open)
- Uncommitted files have `Revert`: press it twice within 5 seconds to `git restore` (not offered for new files)
- Drawn like the desktop diff panel when the terminal theme is known (Omarchy): a header band per file, full-width green and red rows with a colored edge, one line-number column, syntax colors on removed lines too, changed words in a darker tint, and unchanged stretches as `N unmodified lines`. Only the rows near the visible part are drawn, so a diff of thousands of lines scrolls as fast as a short one. Edits made this session outside git show each edit on its own, split by `· next edit`. Without a known theme, the engine's diff is used as before
- Line comments, like the desktop diff panel's: click a line number to open a comment field under it, click another line number in the same file to make it a range, and press Enter to keep the comment. Kept comments stay under their lines (`✕` removes one) and as a `✎ N` chip in the chin band, and go with your next prompt as context Claude reads (the file and lines, the lines themselves, and your comment), then clear. Slash commands don't take them. Needs a known theme, like the drawing above

![Line comments in /desk-diff: a kept comment on lines 19–20, an open comment field on line 12, picked line numbers in blue](docs/comments.png)

### `/desk-tasks [number]`: background tasks

![The /desk-tasks pane with a running monitor, background shell and agent](docs/tasks.png)

Like the desktop's Background tasks: this session's agents, background shells (`run_in_background`, Ctrl+B or a timed-out command) and monitors, under `Running` and `Done`.

- **Agents** show their model, tokens, tool uses and what they are doing now (`Fetching`). `View transcript` shows the prompt, their messages, their tool calls folded as in the transcript, and their report
- **Shells and monitors** show their command. `View details` shows status, runtime, the result line and the end of the output (once it finishes)
- `■ Stop` stops a running task after a second press within 5 seconds
- `z` folds `Done`, `c` clears finished tasks from the list, `Remove` clears one
- Click a card or give its number to open it

### `/desk-pr`: pull request

The current branch's PR (GitHub, through `gh`) or MR (GitLab, through `glab`):

- State, `base ← head`, `+N −M`, review decision and merge state
- Failing and running checks (passing ones folded) and unresolved review threads
- `Hand to Claude` next to a failing check or a review thread fills the prompt with it
- `Merge` merges it after a second press within 5 seconds, only at the head commit the pane showed (a newer push makes the merge fail). While checks are still running it reads `Merge when pipeline succeeds` (GitLab) or `Merge when checks pass` (GitHub) and sets auto-merge instead. It shows only on an open, non-draft PR with no failing checks that the host reports as mergeable. The merge method is the repository's: GitLab follows the MR's squash setting; GitHub uses merge, else squash, else rebase, whichever the repository allows. The remote source branch is deleted (on GitHub, after an auto-merge only if the repository deletes head branches); the local branch is left alone
- Nothing else is changed: no approvals, comments or `Ready for review`

### `/desk-preview [file]`: Markdown preview

![The /desk-preview pane: a front matter box, a warning box, a table and a mermaid flowchart](docs/preview.png)

- Draws a Markdown document with the transcript's own renderer: bordered tables, mermaid diagrams, alert boxes, code blocks with `⧉ copy`. Headings are set apart (`#` in the accent color, `#` and `##` underlined), and YAML front matter becomes a small key/value box at the top
- Opens three ways: the `◫ preview` chip at the end of a tool line that wrote or edited a `.md` file (a folded group line names the file, `◫ NOTES.md`), the `◫` next to a `.md` row in the end-of-turn card, and `/desk-preview <file>` (no file reopens the last one)
- A document Claude writes in a turn opens by itself when the turn ends, not while it is still being written. Files under a `.claude/` folder (memory, plans, skills) never open by themselves; `previewAutoOpen` turns this off
- Follows the document: later writes and edits reload it. `r` reloads by hand, `d` opens the document in the diff pane
- Claude can open it too (the `preview` tool), for example when asked to show a README
- Documents over 90,000 characters are drawn up to that point, with a note. The desktop app keeps its own Markdown

### `/desk-context`: context and usage

<img src="docs/context.png" alt="The /desk-context pane: context bar, per-category breakdown, usage limits and session cost" width="540">

Replaces the `/context` grid:

- A context bar (tokens / window, the auto-compact point)
- A per-category breakdown, the same categories as `/context` (a local estimate, so no API requests)
- 5-hour and 7-day usage limits with time until reset, and the session cost
- `↻` recalculates

### `/desk-sessions [number]`: recent sessions

Recent sessions grouped by project, with a search box at the top (title and folder; Enter opens the first result). Click a row or give its number:

- **A session in the same folder**: the current window switches to that session right away (runs `/resume <id>`). If running it is blocked, the command is placed in the prompt; press Enter.
- **A session in another folder**: copies `cd <folder> && claude --resume <id>` to the clipboard (`wl-copy`).

---

Tool lines, agent cards, agent messages, background task cards, session rows, question options, the context, PR and tasks chips, commit rows, and file rows in the end-of-turn card and the diff pane are buttons across the whole row, so clicking the description or the `›` works too.

## Install

desk-look follows the latest Claude Code release and is tested only there; keep Claude Code up to date. On an older version, parts the engine can't draw yet fall back to its default look.

At the prompt of a Claude Code terminal session:

```
/plugin install desk-look --marketplace KyongSik-Yoon/cc-desktop-mod
```

Answer `y` when asked to add the marketplace, and pick the user scope.

## Settings

Search for `desk-look` in `/config` to find these options.

| Option | Values | Description |
|---|---|---|
| `language` | `auto` (default), `en`, `ko` | Language of the mod's own labels, panes, toasts and the text it puts in the prompt. `auto` follows Claude Code's `language` in `/config` when the session starts: Korean when it names Korean, English otherwise |
| `bubbleSide` | `left` (default), `right` | Where your prompt bubble sits. The attachment lines the engine draws under the bubble (`└ 1 skill available` and so on) can't be moved by a plugin and always sit on the left, so `left` keeps them aligned. `right` is like the desktop app |
| `askNotify` | `on` (default), `off` | Notify when a question card opens. The engine dialog notifies when it opens, but the engine sends nothing while the card is showing, so the card sends it itself |
| `prBar` | `on` (default), `off` | The PR chip next to the band. It reads the current branch's PR with `gh` (GitHub) or `glab` (GitLab) at session start and after each turn, at most once every 30 seconds, and, while a check (GitLab: a pipeline job) of an open PR is still running, between turns too: every 15 seconds, doubling up to every 2 minutes while nothing changes (a check that never reports, such as one waiting for a runner, would otherwise keep asking); without either tool, or in a repository on neither host, it stays hidden and is not asked again for that branch; network errors are retried after the next turn. `/desk-pr` opens regardless of this setting |
| `previewAutoOpen` | `on` (default), `off` | Open a Markdown document Claude writes in the preview pane when the turn ends. `off` leaves it to the `◫` chips and `/desk-preview` |
| `contextChip` | `auto` (default), `always`, `off` | The context chip next to the band above the prompt. `auto` shows it only from 50% (a status line or another plugin often shows context all the time already), `always` always shows it, `off` hides it. The `/desk-context` pane opens regardless of this setting |

## Update

Run `/desk-update` at the prompt, or from a shell:

```bash
claude plugin update desk-look
```

Then run `/reload-plugins` in your session.

## Behavior by environment

- **Colors**: uses engine theme keys (`text`, `inactive`, `claude` …), so both light and dark themes are followed.
- **Gray bubble fill**: drawn only when the [omarchy](https://omarchy.org) theme (`~/.local/state/omarchy/current/theme/colors.toml`) can be read; a theme change is picked up within 3 seconds. Elsewhere the bubble is a rounded border. The rounded ends use Nerd Font half-circle glyphs and Symbols for Legacy Computing blocks; where the terminal draws images (see below), the corners of a multi-line bubble are small images instead, so they come out properly round. The chin band above the prompt works the same way: without the theme it draws only the chips, with no gray band.
- **Image thumbnails and round bubble corners**: drawn in kitty and Ghostty, not inside tmux or zellij. Inside herdr they need both `kitty_graphics = true` under `[experimental]` in herdr's `config.toml` and `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` for Claude Code, which otherwise asks the terminal's name and gets herdr's.
- **Question card**: used only in sessions with a single terminal attached. With Remote Control on, the card opens only when your last message came from the terminal, and if nobody touches it for a minute it hands over to the engine's default question dialog so the mobile or web app can answer; a last message from the app opens the default dialog right away. Esc stops the turn, so it also cancels the question.
- **Diff colors in 256-color terminals**: the blended row and word tints are used only when `COLORTERM` is `truecolor` or `24bit` outside tmux. Elsewhere (tmux turns the engine's colors down to 256) the diff uses colors from the xterm 256-color palette, so changed words still stand out from their row.
- **Links**: inside a multiplexer that doesn't pass OSC 8 hyperlinks through, the URL is appended dimly after the name.

## Development

```bash
cd desk-look
claude plugin validate .   # check the manifest and hook modules
claude plugin test .       # run tests/*.test.tsx
```

Add the local folder as a marketplace as is, and changes in the repo only need `/reload-plugins`.

```bash
claude plugin marketplace add ~/dev/git-repo/cc-desktop-mod
```

`.claude/skills/desk-release-check` gathers the Claude Code release notes and the plugin API diff since the last check, to find what desk-look can use or drop. `CLAUDE.md` holds the repository's conventions (latest Claude Code only, a GitHub release for every version).

`desk-look/.claude-plugin/types/` holds type definitions the engine lays down again every time it loads the mod, so it isn't committed.

## Third party

- `desk-look/hooks/vendor/lovely-mermaid.js`: a bundle of [lovely-mermaid](https://github.com/xl0/lovely-mermaid), Apache-2.0 (`LICENSE.lovely-mermaid`)

## License

MIT (`LICENSE`)
