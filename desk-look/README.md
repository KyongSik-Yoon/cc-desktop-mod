# desk-look

A Claude Code mod that makes the terminal UI look and work like the Code tab of the Claude desktop app. It changes only how the transcript and the area around the prompt are drawn; the engine is left as it is, and nothing changes in the desktop app.

- Prompt bubbles, desktop-style markdown (full-width tables, mermaid diagrams, alert boxes), tool calls folded into one clickable line, cards for subagents, plans, questions and each turn's edited files
- A band above the prompt with the repository, branch, `+N −M`, pull request checks, context usage and background tasks
- Side panes: diffs with line comments (`/desk-diff`), background tasks (`/desk-tasks`), the pull request (`/desk-pr`), your Asana tasks (`/desk-asana`), Markdown preview (`/desk-preview`), context and usage limits (`/desk-context`) and recent sessions (`/desk-sessions`)
- English or Korean labels

Screenshots, settings and details: https://github.com/KyongSik-Yoon/cc-desktop-mod

## What it runs, reads and sends

desk-look makes no network requests itself and collects no data. Everything it reads stays on your machine, except what is listed under "Sends".

**Runs** (each one by name, with its whole command written at the call; no shell and no inline scripts, from `hooks/register.tsx`, `hooks/ask.tsx` and the files they import):

- `git`: branch, diff stats and diffs for the current repository; `git restore` only when you press `Revert` twice
- `gh` (GitHub) and `glab` (GitLab): read the current branch's pull request or merge request, and merge it only when you press `Merge` twice. They use the login you already have in those tools; desk-look never reads or passes a token
- `wl-copy`: copy a `claude --resume` command to the clipboard from `/desk-sessions`
- `claude plugin marketplace update` and `claude plugin update`: only when you run `/desk-update`
- `id -u` and `od -N 24`: find this session's temporary folder (`/tmp/claude-<uid>`) for pasted images, and read the first 24 bytes of each PNG for its size
- `head -c` and `tail -c`: read the start (working folder) and end (title) of a session file over 320 KB for `/desk-sessions`
- `mktemp -d`, `mkfifo`, `cat`, `tee` and `rm -rf`: the question card waits for your answer on a named pipe in a temporary folder (`cat` reads it, the card's buttons write the answer with `tee`; each press also writes a counter to a `touched` file there with `tee`, which a Remote Control session uses to tell you are still at the terminal) and removes the folder afterwards. This folder is the only place desk-look writes files

**Reads**: the omarchy theme colors (`~/.local/state/omarchy/current/theme/colors.toml`), Markdown files you open in the preview pane, recent session files (`~/.claude/projects`) for `/desk-sessions`, session state files (`~/.claude/sessions`) to see whether Remote Control is attached to this session, the list of this session's pasted images (`/tmp/claude-<uid>/…/images`), herdr's `kitty_graphics` setting (`~/.config/herdr/config.toml`), and the conversation and usage data Claude Code hands to the mod, to draw the transcript, cards and panes.

**Sends**: only through `gh` and `glab`, to GitHub or GitLab, for the pull request reads and merges above, and through the Asana MCP server Claude Code already has connected (with Claude Code's own connection and login), only when you open `/desk-asana` or press something in it: it reads your tasks, a task's details and comments, and people matching a name you search for, and adds a comment, changes the assignee or sets a dropdown field when you submit or press those. Diff line comments you write in `/desk-diff` are attached to your next prompt as context, so they go to Claude with that prompt like the rest of it.

## Hooks and what they do

Every hook below passes the event on with `next(e)` and only watches the result, except where it says otherwise.

- `ui.render`, `ui.scroll`: draw the transcript, cards, chips and panes in the desktop style
- `session.start`, `session.append`, `turn.start`, `turn.step`, `turn.complete`: keep the folded tool lines, the end-of-turn card, the background tasks pane (an agent's model and token counts) and the PR chip up to date; at the end of a turn, open a Markdown file Claude wrote in the preview pane
- `prompt.submit`: note whether a prompt came from the terminal or Remote Control (for the question card), read background-task notifications, and attach pending diff line comments to a typed prompt as context (never to a slash command)
- `tool.call`: count each edit's added and removed lines for the end-of-turn card. For `AskUserQuestion` it shows the question card and returns the answer you pick (or hands the question to Claude Code's own dialog, or reports that you closed it). For desk-look's own `preview` tool it opens the preview pane and returns what it opened
- `command.run`: handles desk-look's own `/desk-*` commands only
- `ui.press`, `ui.input`: take the presses and submits in the `/desk-asana` pane that call Asana, so the calls run from desk-look's hook (see `tool.check`)
- `tool.check`: answers `allow` for a call desk-look itself made (`next.origin` is desk-look) to one of the Asana tools the `/desk-asana` pane uses (`get_my_tasks`, `get_task`, `add_comment`, `update_tasks`, `search_objects`, and the claude.ai connector's `asana_search_tasks`, `asana_get_task`, `asana_get_stories_for_task`, `asana_create_task_story`, `asana_update_task`, `asana_typeahead_search`). Claude Code otherwise asks for a plugin's own MCP calls too, and auto mode refuses them because no prompt asked for them. Every other call, including Claude's own Asana calls, is passed on unchanged

**Calls it makes on its own**, each after you press something: `/resume <id>` when you pick a session in the same folder in `/desk-sessions` (or it places the command in the prompt for you), `TaskStop` when you press `■ Stop` twice on a background task, and switching the main view to an agent's transcript (or back) when you press `Open in main view` (`Main conversation`) in the background tasks pane. It also registers its `/desk-*` commands and the `preview` tool, and reads Claude Code's `language` setting.

`hooks/vendor/lovely-mermaid.js` is [lovely-mermaid](https://github.com/xl0/lovely-mermaid) 0.3.3 (Apache-2.0, `hooks/vendor/LICENSE.lovely-mermaid`), bundled without minification, used to draw mermaid diagrams. It runs no programs and makes no requests.

## License

MIT
