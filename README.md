# cc-desktop-mod: Claude desktop look for the Claude Code terminal

**English** | [한국어](README.ko.md)

**desk-look** is a Claude Code plugin (mod) that makes the Claude Code CLI terminal UI look like the Code tab of the Claude desktop app: prompt bubbles, full-width markdown tables, mermaid diagrams, folded tool calls, subagent cards, a plan card, a checklist, a diff pane, a pull request bar for GitHub and GitLab, and a context usage meter.
It is a Claude Code function-hook plugin: the engine stays as it is, and only the way things are drawn on screen changes.

![desk-look in the Claude Code terminal: a prompt bubble, folded tool calls, a markdown table, a mermaid flowchart, a note box and the edited-files card](docs/screenshot.png)

## desk-look

| Area | Terminal default | desk-look |
|---|---|---|
| Your prompt | A line starting with `>` | A gray bubble (a pill for one line, a box with rounded corners for several). Left (default) or right, set in the config |
| Answers | `●` bullet + engine markdown | A markdown renderer in the desktop prose style |
| Tables | Grid tables | Full-width tables with a gray header and row separators |
| mermaid | Code block | Box diagrams ([lovely-mermaid](https://github.com/xl0/lovely-mermaid)) with arrowheads that touch the boxes |
| `> [!NOTE]` alerts | Blockquote | A box with a border colored by alert type |
| Tool calls | One row per call + a result block | Consecutive calls fold into one line, `Ran 2 commands, edited a file +3 −1 ›`, that expands on click. Expanded, edit diffs show right away (file line numbers, three lines of context) |
| Subagents | One `Ran an agent` line; notifications and messages only expand with ctrl+o | A card per agent (type and description; tool count, tokens, time and changed lines; click for the result). Background notifications read `✓ description completed · 5s`; click an agent message `◆ name first line ›` to expand it in place |
| End of turn | A duration line | A card of the files edited that turn, `Edited N files +N −M` (click a file row to open the `/desk-diff` pane at that file), and `⧉ copy` at the right edge to copy the answer |
| Plan (ExitPlanMode) | Folded into one line with other tools | A card of its own, `◇ Plan Approved` (it also shows waiting, rejected and interrupted), with the plan as markdown. A long plan shows its start and expands with `Show all`. The approval dialog is the engine's own |
| Tasks | Tool lines | A checklist card above the prompt, `Tasks 2/5` (✓ done, ◉ in progress, ○ to do). Only in sessions that have `TodoWrite` or `TaskCreate` |
| Above the prompt | — | A rounded gray band like the chin under the desktop prompt: `repo  branch` on the left, `+N −M` on the right. Once context passes half, a `◑ 62%` chip sits next to the band (caution color from 75%, warning color from 90%); click it for the `/desk-context` pane |
| Progress | `✻ Simmering… (12s · ↓ 300 tokens)` | `●·· Running…  2m 29s` (a word that matches the work, clay-colored dots) |
| Code blocks | No way to copy | Hover to see `⧉ copy` at the right of the top border; click to copy the same way `/copy` does |
| Questions (AskUserQuestion) | A list under the prompt | A question card right above the prompt. With an empty prompt, pick by number alone (`1`-`8` options, `0` submit, `9` the default dialog); multi-select with ☐/☑; `Other` takes two clicks to type (the first selects the row); hover an option for its preview. A notification goes out when the card opens, as the engine dialog does (`preferredNotifChannel`). The transcript records `Asked question → answer` |
| Command output | Plain text | Output with tables, headings, code or quotes renders as markdown, like an answer |
| Mode indicator | Dim text at the bottom right of the prompt | A pill chip (with the omarchy theme) |
| Hint line | `? for shortcuts` | While a question card is open, ends with the keys that answer it (`pick by number · 9 default dialog · Esc cancel`) |
| PR bar | — | A chip next to the band for the current branch's pull request: `#12 ✓ 5/5`, `✗ 1` failing, `● 3/5` running, `◆ 2` unresolved review threads. GitHub PRs through `gh`, GitLab merge requests (`!7`, pipeline jobs, unresolved discussions) through `glab`. Click it for the `/desk-pr` pane |
| `/desk-pr` | — | A right-side pane with the PR or MR: state, `base ← head`, `+N −M`, review decision and merge state, failing and running checks (passing ones folded), unresolved review threads. `Hand to Claude` next to a failing check or a review thread fills the prompt with it. Read-only: nothing is merged, approved or posted |
| `/desk-diff [file]` | — | A right-side pane with per-file diffs and three scopes, like the desktop diff panel: `Uncommitted`, `Branch` (the whole branch since it left the base branch, via `merge-base`) and `Commits` (per commit: click a commit to expand its diff). Give a file name (the end of the path is enough) to scroll to it, or `branch` / `commits` to open in that scope. Click a file's header row to fold or unfold its diff. Uncommitted files have `Revert`: press it twice within 5 seconds to `git restore` (not offered for new files) |
| `/desk-sessions` | — | A right-side pane with recent sessions grouped by project. A search box at the top (title and folder; Enter opens the first result). Click a row or run `/desk-sessions <number>` to switch |
| `/desk-context` | The `/context` grid | A right-side pane with a context bar (tokens / window, auto-compact point), a per-category breakdown (the same categories as `/context`; a local estimate, so no API requests), 5-hour and 7-day usage limits with time until reset, and the session cost. `↻` recalculates |

Tool lines, agent cards, agent messages, session rows, question options, the context and PR chips, commit rows, and file rows in the end-of-turn card and the diff pane are buttons across the whole row, so clicking the description or the `›` works too (Claude Code 2.1.295+; older versions only take the leading part).

The mod's own labels are in English or Korean: the `language` setting picks one, and by default follows Claude Code's own language setting.

Nothing changes in the Code tab of the desktop app (the `desktop` surface).

### Install

At the prompt of a Claude Code terminal session:

```
/plugin install desk-look --marketplace KyongSik-Yoon/cc-desktop-mod
```

Answer `y` when asked to add the marketplace, and pick the user scope.

### Settings

Search for `desk-look` in `/config` to find these options.

| Option | Values | Description |
|---|---|---|
| `language` | `auto` (default), `en`, `ko` | Language of the mod's own labels, panes, toasts and the text it puts in the prompt. `auto` follows Claude Code's `language` in `/config` when the session starts: Korean when it names Korean, English otherwise |
| `bubbleSide` | `left` (default), `right` | Where your prompt bubble sits. The attachment lines the engine draws under the bubble (`└ 1 skill available` and so on) can't be moved by a plugin and always sit on the left, so `left` keeps them aligned. `right` is like the desktop app |
| `askNotify` | `on` (default), `off` | Notify when a question card opens. The engine dialog notifies when it opens, but the engine sends nothing while the card is showing, so the card sends it itself (2.1.295+) |
| `prBar` | `on` (default), `off` | The PR chip next to the band. It reads the current branch's PR with `gh` (GitHub) or `glab` (GitLab) at session start and after each turn, at most once every 30 seconds; without either tool, or in a repository on neither host, it stays hidden and is not asked again for that branch; network errors are retried after the next turn. `/desk-pr` opens regardless of this setting |
| `contextChip` | `auto` (default), `always`, `off` | The context chip next to the band above the prompt. `auto` shows it only from 50% (a status line or another plugin often shows context all the time already), `always` always shows it, `off` hides it. The `/desk-context` pane opens regardless of this setting |

### Update

```bash
claude plugin update desk-look
```

Then run `/reload-plugins` in your session.

### Switching sessions

Click a row in the `/desk-sessions` pane, or give a number as in `/desk-sessions 3`:

- **A session in the same folder**: the current window switches to that session right away (runs `/resume <id>`). If running it is blocked, the command is placed in the prompt; press Enter.
- **A session in another folder**: copies `cd <folder> && claude --resume <id>` to the clipboard (`wl-copy`).

### Behavior by environment

- **Colors**: uses engine theme keys (`text`, `inactive`, `claude` …), so both light and dark themes are followed.
- **Gray bubble fill**: drawn only when the [omarchy](https://omarchy.org) theme (`~/.local/state/omarchy/current/theme/colors.toml`) can be read; a theme change is picked up within 3 seconds. Elsewhere the bubble is a rounded border. The rounded ends use Nerd Font half-circle glyphs and Symbols for Legacy Computing blocks. The chin band above the prompt works the same way: without the theme it draws only the chips, with no gray band.
- **Image thumbnails**: drawn above the bubble only in kitty and Ghostty outside a multiplexer (tmux, zellij, herdr).
- **Question card**: used only in sessions with a single terminal attached. When a remote client (mobile or web) is attached, or an option has a preview, the engine's default question dialog opens instead. Esc stops the turn, so it also cancels the question.
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

`desk-look/.claude-plugin/types/` holds type definitions the engine lays down again every time it loads the mod, so it isn't committed.

## Third party

- `desk-look/hooks/vendor/lovely-mermaid.js`: a bundle of [lovely-mermaid](https://github.com/xl0/lovely-mermaid), Apache-2.0 (`LICENSE.lovely-mermaid`)
