# desk-look

A Claude Code mod that makes the terminal UI look and work like the Code tab of the Claude desktop app. It changes only how the transcript and the area around the prompt are drawn; the engine is left as it is, and nothing changes in the desktop app.

- Prompt bubbles, desktop-style markdown (full-width tables, mermaid diagrams, alert boxes), tool calls folded into one clickable line, cards for subagents, plans, questions and each turn's edited files
- A band above the prompt with the repository, branch, `+N −M`, pull request checks, context usage and background tasks
- Side panes: diffs with line comments (`/desk-diff`), background tasks (`/desk-tasks`), the pull request (`/desk-pr`), Markdown preview (`/desk-preview`), context and usage limits (`/desk-context`) and recent sessions (`/desk-sessions`)
- English or Korean labels

Screenshots, settings and details: https://github.com/KyongSik-Yoon/cc-desktop-mod

## What it runs, reads and sends

desk-look makes no network requests itself and collects no data. Everything it reads stays on your machine, except what is listed under "Sends".

**Runs** (fixed programs, from `hooks/register.tsx`, `hooks/ask.tsx` and the files they import):

- `git`: branch, diff stats and diffs for the current repository; `git restore` only when you press `Revert` twice
- `gh` (GitHub) and `glab` (GitLab): read the current branch's pull request or merge request, and merge it only when you press `Merge` twice. They use the login you already have in those tools; desk-look never reads or passes a token
- `wl-copy`: copy a `claude --resume` command to the clipboard from `/desk-sessions`
- `claude plugin marketplace update` and `claude plugin update`: only when you run `/desk-update`
- Short `sh` scripts with fixed text: list this session's pasted images (`/tmp/claude-<uid>/…/images`) and recent session files (`~/.claude/projects`), check whether Remote Control is attached to this session (`~/.claude/sessions`), check herdr's `kitty_graphics` setting, and pass question-card answers through a temporary folder made with `mktemp -d` and removed with `rm -rf` afterwards

**Reads**: the omarchy theme colors (`~/.local/state/omarchy/current/theme/colors.toml`), Markdown files you open in the preview pane, and the conversation and usage data Claude Code hands to the mod, to draw the transcript, cards and panes.

**Sends**: only through `gh` and `glab`, to GitHub or GitLab, for the pull request reads and merges above. Diff line comments you write in `/desk-diff` are attached to your next prompt as context, so they go to Claude with that prompt like the rest of it.

## Hooks and what they do

Every hook below passes the event on with `next(e)` and only watches the result, except where it says otherwise.

- `ui.render`, `ui.scroll`: draw the transcript, cards, chips and panes in the desktop style
- `session.start`, `session.append`, `turn.start`, `turn.step`, `turn.complete`: keep the folded tool lines, the end-of-turn card, agent token counts and the PR chip up to date; at the end of a turn, open a Markdown file Claude wrote in the preview pane
- `prompt.submit`: note whether a prompt came from the terminal or Remote Control (for the question card), read background-task notifications, and attach pending diff line comments to a typed prompt as context (never to a slash command)
- `tool.call`: count each edit's added and removed lines for the end-of-turn card. For `AskUserQuestion` it shows the question card and returns the answer you pick (or hands the question to Claude Code's own dialog, or reports that you closed it). For desk-look's own `preview` tool it opens the preview pane and returns what it opened
- `agent.spawn`: record the agent for the background tasks pane; the spawn itself is passed on unchanged, and no permission or mode is changed
- `command.run`: handles desk-look's own `/desk-*` commands only

**Calls it makes on its own**, each after you press something: `/resume <id>` when you pick a session in the same folder in `/desk-sessions` (or it places the command in the prompt for you), and `TaskStop` when you press `■ Stop` twice on a background task. It also registers its `/desk-*` commands and the `preview` tool, and reads Claude Code's `language` setting.

`hooks/vendor/lovely-mermaid.js` is [lovely-mermaid](https://github.com/xl0/lovely-mermaid) 0.3.3 (Apache-2.0, `hooks/vendor/LICENSE.lovely-mermaid`), bundled without minification, used to draw mermaid diagrams. It runs no programs and makes no requests.

## License

MIT
