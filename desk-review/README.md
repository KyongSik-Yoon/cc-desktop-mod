# desk-review: simplify, review, and read the report beside the chat

**English** | [한국어](README.ko.md)

desk-review is a Claude Code plugin (mod) with one skill and one side pane. `/desk-review:simplify-review` runs `/simplify` on your changes and then `/code-review medium` on the result, so the review also sees what the cleanup changed. Its report opens in a side pane: every cleanup fixed or skipped and every finding found or dismissed, each with its file, line and reason. Press an item to open its file in desk-look's diff pane, as a `Changes` tab beside the report. It comes from the same marketplace as [desk-look](../README.md) and needs it for the diff pane.

## Install

At the prompt of a Claude Code terminal session (desk-look comes along if it is not installed yet):

```
/plugin install desk-review@cc-desktop-mod
```

It follows the latest Claude Code release, like desk-look. desk-look's `/desk-update` updates it too.

## Use

- `/desk-review:simplify-review [target]`: cleanup, then review, then the report in the pane. Without a target it looks at the current diff; a target is passed on to both skills
- `/desk-review`: opens the last report again

In the pane, from the top: the one-line summary with the counts, `1. Cleanup`, `2. Review`, `3. Not verified` and `4. Next`. An empty section says `None`. Each item is one line of status, folder, file name and line, with its reason below; a bar in the status colour groups the two. The pane carries no code: it is narrow, so press the item and desk-look's diff pane opens at that file as a `Changes` tab beside this one. desk-look looks for the file in your uncommitted changes, then in the branch's changes, and else unfolds the last commit that changed it in the commits view, so an item whose change is already committed (or merged) still opens. It lands on the item's line: the lines around it are unfolded even outside the diff, and its number is marked. Without the pane (the tool refused or missing), the skill writes the same report as a Markdown file instead, which desk-look opens in its preview pane.

## Settings

`/plugin configure desk-review@cc-desktop-mod`:

- `language`: `auto` (default), `en`, `ko`. `auto` follows desk-look's language

## What it runs and reads

- Runs no program and reads no file of yours; it reads desk-look's language
- Sends nothing over the network

## Hooks and tools

- Tool `review_report` (`mcp__desk-review__review_report`): the skill gives it the report; the `tool.call` hook checks it, keeps it and opens the pane. A report with a missing reason, an unknown status or no line is refused with what to fix
- `command.run` (`desk-review`): opens the last report
- `ui.render` (`Pane`, `desk-review`): draws the report
- `session.start`, `state.set` (desk-look's `lang`): register the tool and command, and follow desk-look's language
- Writes its state `diffAt` when you press an item; desk-look's `state.set` hook on it opens the diff pane

## License

MIT
