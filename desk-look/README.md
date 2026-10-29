# desk-look

A Claude Code mod that makes the terminal UI look and work like the Code tab of the Claude desktop app. It changes only how the transcript and the area around the prompt are drawn; the engine is left as it is, and nothing changes in the desktop app.

- Prompt bubbles, desktop-style markdown (full-width tables, mermaid diagrams, alert boxes), tool calls folded into one clickable line, cards for subagents, plans, questions and each turn's edited files
- A band above the prompt with the repository, branch, `+N −M`, pull request checks, context usage, background tasks, and unread Slack messages when desk-slack is installed
- Side panes: diffs with line comments (`/desk-diff`), what ran this turn (`/desk-activity`), background tasks (`/desk-tasks`), the pull request (`/desk-pr`), Markdown preview (`/desk-preview`), context and usage limits (`/desk-context`) and recent sessions (`/desk-sessions`)
- English or Korean labels
- The Asana and Slack panes are separate plugins from the same marketplace, `desk-asana` and `desk-slack`; install them only if you use them

Screenshots, settings and details: https://github.com/KyongSik-Yoon/cc-desktop-mod

## What it runs, reads and sends

desk-look collects no data and makes no network request of its own. Everything it reads stays on your machine, except what is listed under "Sends".

**Runs** (each one by name, with its whole command written at the call; no shell and no inline scripts, from `hooks/register.tsx`, `hooks/ask.tsx` and the files they import):

- `git`: branch, diff stats and diffs for the current repository, the branch list when you pick a diff base, and the hidden lines of a file (from the working tree, or from a commit with `git cat-file`) when you click `N unmodified lines`; `git restore` only when you press `Revert` twice
- `gh` (GitHub) and `glab` (GitLab): read the current branch's pull request or merge request, and merge it only when you press `Merge` twice. They use the login you already have in those tools; desk-look never reads or passes a token
- `claude agents --json`: list the sessions open right now, for the status chips in `/desk-sessions`; `claude stop <id>`: only when you pick a running background session there, to take it into this window (its conversation is kept)
- `herdr pane list`, `herdr workspace focus` and `herdr tab focus`: only inside [herdr](https://herdr.dev), when you pick a session in `/desk-sessions` that is open in another terminal, to switch to the tab where it is open
- `wl-copy`: copy `cd <folder> && claude --resume <id>` to the clipboard from `/desk-sessions`, when switching this window to a session in another folder is blocked
- `claude plugin marketplace update` and `claude plugin update`: only when you run `/desk-update`, for desk-look and for desk-asana and desk-slack (a plugin that is not installed just fails and is not mentioned)
- `id -u` and `od -N 24`: find this session's temporary folder (`/tmp/claude-<uid>`) for pasted images and the preview's browser page, and read the first 24 bytes of each PNG for its size
- `head -c` and `tail -c`: read the start (working folder) and end (title) of a session file over 320 KB for `/desk-sessions`
- `mktemp -d`, `mkfifo`, `cat`, `tee` and `rm -rf`: the question and plan cards wait for your answer on a named pipe in a temporary folder (`cat` reads it, the card's buttons write the answer with `tee`; each press also writes a counter to a `touched` file there with `tee`, which a Remote Control session uses to tell you are still at the terminal) and removes the folder afterwards
- `xdg-open` (on macOS `open`): only when you press `o` in the preview pane, to open the document in your default browser. desk-look first writes the page to `/tmp/claude-<uid>/desk-look/<name>.html` (`$.fs.write`) and leaves it there for the browser. A page with mermaid diagrams makes the browser load mermaid from `cdn.jsdelivr.net`; the document itself goes nowhere

Those two folders are the only places desk-look writes files

**Reads**: while a shell command Claude runs takes longer than 3 seconds, every 3 seconds, Claude Code's child processes in `/proc` (`/proc/<pid>/task/<pid>/children`, `/proc/<pid>/stat`, `/proc/<pid>/io` and `/proc/uptime`), following only the shell that command started and the programs under it, for the CPU and I/O figures in the progress band (Linux only, nothing is kept after the turn); the output file of a background shell this turn started, every 3 seconds while `/desk-activity` is open and the shell runs, for its last line; the omarchy theme colors (`~/.local/state/omarchy/current/theme/colors.toml`), Markdown files you open in the preview pane, recent session files (`~/.claude/projects`) for `/desk-sessions`, session state files (`~/.claude/sessions`) to see whether Remote Control is attached to this session, the list of this session's pasted images (`/tmp/claude-<uid>/…/images`), herdr's `kitty_graphics` setting (`~/.config/herdr/config.toml`), the values desk-asana and desk-slack publish for it (the unread Slack count for the `✉` chip, whether they are loaded, and which of their panes `/desk-fold` folded), the conversation and usage data Claude Code hands to the mod, to draw the transcript, cards and panes, and the text you last selected on screen (`$.ui.selection`), only when you press `❝ quote` or run `/desk-quote`, to put it in the prompt.

**Sends**: only through `gh` and `glab`, to GitHub or GitLab, for the pull request reads and merges above. Diff line comments you write in `/desk-diff` are attached to your next prompt as context, so they go to Claude with that prompt like the rest of it.

## Hooks and what they do

Every hook below passes the event on with `next(e)` and only watches the result, except where it says otherwise.

- `ui.render`, `ui.scroll`: draw the transcript, cards, chips and panes in the desktop style
- `session.end`: after `/resume` or `/clear` in the same window, read the session's state again (the engine sends no `session.start` for the session it switches to)
- `session.start`, `session.append`, `turn.start`, `turn.step`, `turn.complete`: keep the folded tool lines, the end-of-turn card, the background tasks pane (an agent's model and token counts) and the PR chip up to date; at the end of a turn, open a Markdown file Claude wrote in the preview pane
- `prompt.submit`: note whether a prompt came from the terminal or Remote Control (for the question card), read background-task notifications, and attach pending diff line comments to a typed prompt as context (never to a slash command)
- `tool.call`: count each edit's added and removed lines for the end-of-turn card, and note each call's tool, start, end and result (the main conversation's and its agents') for the progress band and `/desk-activity`. For `AskUserQuestion` it shows the question card and returns the answer you pick (or hands the question to Claude Code's own dialog, or reports that you closed it). For desk-look's own `preview` tool it opens the preview pane and returns what it opened
- `classic.PreToolUse` (`ExitPlanMode` only): shows the plan card and opens the plan file in the preview pane; approving returns the call's own input with `allow`, so Claude Code runs the tool and leaves plan mode as its dialog would. Asking for changes refuses the call with what you wrote, and `9` hands it to the engine dialog
- `command.run`: handles desk-look's own `/desk-*` commands only

**Calls it makes on its own**, each after you press something: `/resume <id>` when you pick a session in `/desk-sessions`, after `/cd <folder>` when it is in another folder (if running them is blocked, it places `/resume <id>` in the prompt or copies a shell command instead), `TaskStop` when you press `■ Stop` twice on a background task, and switching the main view to an agent's transcript (or back) when you press `Open in main view` (`Main conversation`) in the background tasks pane. It also registers its `/desk-*` commands and the `preview` tool, and reads Claude Code's `language` setting. At the start of a turn, until MCP servers have connected (for at most 5 turns per session, and never again once it has decided), it lists Claude Code's tools (`$.tool.list`) to see whether an Asana or Slack MCP server is there without desk-asana or desk-slack, and if so says once where those panes went (remembered in its plugin store).

`hooks/vendor/lovely-mermaid.js` is [lovely-mermaid](https://github.com/xl0/lovely-mermaid) 0.3.3 (Apache-2.0, `hooks/vendor/LICENSE.lovely-mermaid`), bundled without minification, used to draw mermaid diagrams. It runs no programs and makes no requests.

## License

MIT
