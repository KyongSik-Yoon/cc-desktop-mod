# desk-look

A Claude Code mod that makes the terminal UI look and work like the Code tab of the Claude desktop app. It changes only how the transcript and the area around the prompt are drawn; the engine is left as it is, and nothing changes in the desktop app.

- Prompt bubbles, desktop-style markdown (full-width tables, mermaid diagrams, alert boxes), tool calls folded into one clickable line, cards for subagents, plans, questions and each turn's edited files
- A band above the prompt with the repository, branch, `+N −M`, pull request checks, context usage and background tasks
- Side panes: diffs with line comments (`/desk-diff`), background tasks (`/desk-tasks`), the pull request (`/desk-pr`), Markdown preview (`/desk-preview`), context and usage limits (`/desk-context`) and recent sessions (`/desk-sessions`)
- English or Korean labels

Screenshots, settings and details: https://github.com/KyongSik-Yoon/cc-desktop-mod

## What it runs

desk-look sends nothing over the network itself and collects no data. It runs these local commands:

- `git`: branch, diff stats and diffs for the current repository; `git restore` only when you press `Revert` twice
- `gh` (GitHub) and `glab` (GitLab): read the current branch's pull request or merge request; merge it only when you press `Merge` twice. These tools use your own login
- `wl-copy`: copy a resume command to the clipboard from `/desk-sessions`
- `claude plugin`: update desk-look when you run `/desk-update`
- Short `sh` scripts that list this session's pasted images and recent sessions, check whether Remote Control is attached to this session (`~/.claude/sessions`), check herdr's `kitty_graphics` setting, and pass question-card answers through a temporary folder it creates and removes

It also reads files: the omarchy theme colors (`~/.local/state/omarchy/current/theme/colors.toml`), Markdown files you open in the preview pane, and Claude Code's own session and usage data.

`hooks/vendor/lovely-mermaid.js` is a bundle of [lovely-mermaid](https://github.com/xl0/lovely-mermaid) (Apache-2.0, `hooks/vendor/LICENSE.lovely-mermaid`) used to draw mermaid diagrams.

## License

MIT
