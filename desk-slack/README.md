# desk-slack: Slack DMs in a Claude Code side pane

**English** | [한국어](README.ko.md)

desk-slack is a Claude Code plugin (mod) that opens the Slack DMs sent to you in a side pane next to the conversation. It comes from the same marketplace as [desk-look](../README.md), which redraws the Claude Code terminal to look like the Claude desktop app. It works on its own; with desk-look, the unread count shows as the `✉ N` chip in desk-look's band, `/desk-fold` folds its pane too and it follows desk-look's language.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install desk-slack --marketplace KyongSik-Yoon/cc-desktop-mod
```

It installs [desk-grant](../desk-grant/README.md) with it. It follows the latest Claude Code release, like desk-look. `/desk-update` from desk-look updates it too; without desk-look, run `claude plugin update desk-slack`.

## `/desk-slack`: Slack DMs

The DMs and group DMs other people sent you, kept as conversations like the Slack client, read through the Slack MCP server Claude Code already has connected (the claude.ai Slack connector; no token or setting of its own). Messages, @mentions and thread replies in channels are not included (thread replies in a DM are). With no Slack server, the pane says to connect Slack in `/mcp`.

- The list shows one row per conversation, most recent first: `●` when it has messages you have not opened in desk-slack, the people in it, the last message and how long ago. The first time, it fills in the last 3 days as already read
- Click a conversation for its latest 30 messages, both sides. Write in the box at the bottom and press Enter to reply there. `↻` (`r` in every view) reloads, `← Conversations` (`b`, also under the reply box) goes back
- Messages are drawn the way Slack shows them: bold, italic, strikethrough, code blocks, links and mentions, a date line where the day changes, the name once for messages one person sends in a row, and attachments as `📎 name · size`. A table pasted from a terminal (drawn with `│` and `─┼─`) is redrawn to fit the pane, or as one card per row when its columns would cut words
- Under a message with replies, `N replies` opens that thread (the message and its latest 30 replies), and a reply written there goes to the thread. `← name` (`b`) goes back to the conversation. When a conversation's last message is a thread reply, clicking it in the list opens that thread directly
- `✕` closes a conversation, and `Close all` at the top closes every conversation in the list (both need a second press within 5 seconds). A closed conversation comes back when a new message arrives in it
- `Hand to Claude` fills the prompt with the conversation's recent messages; `Open in Slack` opens it in Slack
- While any Claude Code session is running, desk-slack checks for new messages once a minute and sends a notification per conversation through your notification channel (`slackNotify` turns that off). With desk-look, the `✉ N` chip in its band shows the unread count and opens the pane. With several sessions open, one of them checks and the others share what it finds
- "Unread" is desk-slack's own: opening a conversation here does not mark it read in Slack, and reading it in Slack does not clear it here
- The Slack connector adds a "Sent using Claude" line to messages sent through it
- The Slack calls are allowed by [desk-grant](../desk-grant/README.md), installed with desk-slack, so no `permissions.allow` rules are needed. Without desk-grant, Claude Code turns desk-slack off and lists it under Errors in `/plugin`; if you had desk-slack before 0.70.0, run `/plugin install desk-grant@cc-desktop-mod` once (updating does not add it), then `/reload-plugins`. If desk-grant is older than desk-slack and does not allow one of its tools yet, desk-slack calls nothing (no checking, no notifications) and the pane says to update desk-grant. Old `mcp__claude_ai_Slack__…` rules can be removed

## What it runs, reads and sends

desk-slack collects no data and runs no programs. Everything it reads stays on your machine, except what is listed under "Sends".

**Reads**: Claude Code's `language` setting, and desk-look's language and `/desk-fold` state when desk-look is installed.

**Sends**: only to the Slack MCP server Claude Code already has connected (with Claude Code's own connection and login), through its five tools (`slack_search_public_and_private`, `slack_read_channel`, `slack_read_thread`, `slack_send_message`, `slack_read_user_profile`), which desk-grant allows for desk-slack only: once a minute, from one running session, it searches for DMs and group DMs sent to you since the last check; when you open a conversation or one of its threads it reads its latest 30 messages; when you submit a reply it sends it there; and it reads your Slack user ID once. It keeps the conversation list, your user ID and which session checks in its own plugin store (`$.store`), and raises a notification for new messages through your notification channel unless `slackNotify` is `off`. If desk-grant does not allow one of these tools (an older desk-grant), it calls nothing and the pane says to update desk-grant (found with `$.tool.check`). It publishes the unread count for desk-look's `✉` chip.

`hooks/shared/` is a copy of desk-look's Markdown renderer, used to draw messages; `hooks/shared/vendor/lovely-mermaid.js` is [lovely-mermaid](https://github.com/xl0/lovely-mermaid) 0.3.3 (Apache-2.0, `hooks/shared/vendor/LICENSE.lovely-mermaid`), bundled without minification. It runs no programs and makes no requests.

## Hooks and what they do

Every hook below passes the event on with `next(e)` and only watches the result, except where it says otherwise.

- `ui.render`: draws the `/desk-slack` pane
- `session.start`, `session.end`: register `/desk-slack`, start the once-a-minute check, and tell desk-look the plugin is loaded (again after `/resume` or `/clear` in the same window)
- `state.set` on desk-look's `lang` and `folded`: after desk-look's own write goes through, follow its language and fold or unfold this plugin's pane with `/desk-fold`
- `command.run`: handles `/desk-slack` only

## Settings

Search for `desk-slack` in `/config` to find these options.

- `language`: `auto` (default), `en`, `ko`. Language of the plugin's own labels. `auto` follows desk-look's language, or without desk-look Claude Code's `language` in `/config`: Korean when it names Korean, English otherwise
- `slackNotify`: `on` (default), `off`. Notify when a new Slack DM arrives (see `/desk-slack`). `off` keeps checking for the pane and desk-look's `✉` chip, without notifications

## License

MIT (`LICENSE`)
