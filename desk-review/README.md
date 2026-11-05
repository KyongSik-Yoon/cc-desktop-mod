# desk-review: simplify, review, and read the report beside the chat

**English** | [한국어](README.ko.md)

desk-review is a Claude Code plugin (mod) with one skill and one side pane. `/desk-review:simplify-review` runs `/simplify` on your changes and then `/code-review medium` on the result, so the review also sees what the cleanup changed. Its report opens in a side pane: every cleanup fixed or skipped and every finding found or dismissed, each with its file, line and reason. Press an item to read the current source around that line, and open the file in desk-look's diff pane from there, without leaving Claude Code. It comes from the same marketplace as [desk-look](../README.md) and needs it for the diff pane.

## Install

At the prompt of a Claude Code terminal session (desk-look comes along if it is not installed yet):

```
/plugin install desk-review@cc-desktop-mod
```

It follows the latest Claude Code release, like desk-look. desk-look's `/desk-update` updates it too.

## Use

- `/desk-review:simplify-review [target]`: cleanup, then review, then the report in the pane. Without a target it looks at the current diff; a target is passed on to both skills
- `/desk-review`: opens the last report again

In the pane, from the top: the one-line summary with the counts, `1. Cleanup`, `2. Review`, `3. Not verified` and `4. Next`. An empty section says `None`. Press an item to unfold it: the source around its line, read from the file as it is now (not as it was when the report was written), with line numbers and highlighting. `◫ Open in diff` opens desk-look's diff pane at that file; a file with no uncommitted change is not in the diff, and desk-look says so. Without the pane (the tool refused or missing), the skill writes the same report as a Markdown file instead, which desk-look opens in its preview pane.

## Settings

`/plugin configure desk-review@cc-desktop-mod`:

- `language`: `auto` (default), `en`, `ko`. `auto` follows desk-look's language

## What it runs and reads

- Runs no programs and sends nothing over the network
- Reads the file of an item when you unfold it, and desk-look's language

## Hooks and tools

- Tool `review_report` (`mcp__desk-review__review_report`): the skill gives it the report; the `tool.call` hook checks it, keeps it and opens the pane. A report with a missing reason, an unknown status or no line is refused with what to fix
- `command.run` (`desk-review`): opens the last report
- `ui.render` (`Pane`, `desk-review`): draws the report
- `session.start`, `state.set` (desk-look's `lang`): register the tool and command, and follow desk-look's language
- Writes its state `diffAt` when you press `◫ Open in diff`; desk-look's `state.set` hook on it opens the diff pane

## License

MIT
