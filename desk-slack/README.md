# desk-slack: Slack DMs in a Claude Code side pane

**English** | [한국어](README.ko.md)

desk-slack is a Claude Code plugin (mod) that opens the Slack DMs sent to you in a side pane next to the conversation. It comes from the same marketplace as [desk-look](../README.md), which redraws the Claude Code terminal to look like the Claude desktop app. It works on its own; with desk-look, the unread count shows as the `✉ N` chip in desk-look's band, `/desk-fold` folds its pane too and it follows desk-look's language.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install desk-slack --marketplace KyongSik-Yoon/cc-desktop-mod
```

It follows the latest Claude Code release, like desk-look. `/desk-update` from desk-look updates it too; without desk-look, run `claude plugin update desk-slack`.

## `/desk-slack`: Slack DMs

The DMs and group DMs other people sent you, kept as conversations like the Slack client, read through the Slack MCP server Claude Code already has connected (the claude.ai Slack connector; no token or setting of its own). Messages, @mentions and thread replies in channels are not included (thread replies in a DM are). With no Slack server, the pane says to connect Slack in `/mcp`.

- The list shows one row per conversation, most recent first: `●` when it has messages you have not opened in desk-slack, the people in it, the last message and how long ago. The first time, it fills in the last 3 days as already read
- Click a conversation for its latest 30 messages, both sides. Write in the box at the bottom and press Enter to reply there. `↻` reloads, `← Conversations` (also under the reply box) goes back
- Under a message with replies, `N replies` opens that thread (the message and its latest 30 replies), and a reply written there goes to the thread. `← name` goes back to the conversation. When a conversation's last message is a thread reply, clicking it in the list opens that thread directly
- `✕` closes a conversation, and `Close all` at the top closes every conversation in the list (both need a second press within 5 seconds). A closed conversation comes back when a new message arrives in it
- `Hand to Claude` fills the prompt with the conversation's recent messages; `Open in Slack` opens it in Slack
- While any Claude Code session is running, desk-slack checks for new messages once a minute and sends a notification per conversation through your notification channel (`slackNotify` turns that off). With desk-look, the `✉ N` chip in its band shows the unread count and opens the pane. With several sessions open, one of them checks and the others share what it finds
- "Unread" is desk-slack's own: opening a conversation here does not mark it read in Slack, and reading it in Slack does not clear it here
- The Slack connector adds a "Sent using Claude" line to messages sent through it
- desk-slack calls Slack only while all four of its Slack tools have an allow rule in `permissions.allow` in `~/.claude/settings.json`; until then it calls nothing (no checking, no notifications) and the pane lists the missing rules. The check runs in the background, where nobody could answer a permission prompt:

  ```json
  "mcp__claude_ai_Slack__slack_search_public_and_private", "mcp__claude_ai_Slack__slack_read_channel",
  "mcp__claude_ai_Slack__slack_send_message", "mcp__claude_ai_Slack__slack_read_user_profile"
  ```

  To open threads, add `"mcp__claude_ai_Slack__slack_read_thread"` too. Without just that rule, checking, notifications and conversations keep working; threads do not open, and the conversation shows the rule to add

  The rule allows the same tools for Claude too: Claude can then send Slack messages without asking

## What it runs, reads and sends

desk-slack collects no data and runs no programs. Everything it reads stays on your machine, except what is listed under "Sends".

**Reads**: Claude Code's `language` setting, and desk-look's language and `/desk-fold` state when desk-look is installed.

**Sends**: only to the Slack MCP server Claude Code already has connected (with Claude Code's own connection and login), but only while all four of its Slack tools (`slack_search_public_and_private`, `slack_read_channel`, `slack_send_message`, `slack_read_user_profile`) have an allow rule (`slack_read_thread`, which opens threads, is called only when it has one too): once a minute, from one running session, it searches for DMs and group DMs sent to you since the last check; when you open a conversation or one of its threads it reads its latest 30 messages; when you submit a reply it sends it there; and it reads your Slack user ID once. It keeps the conversation list, your user ID and which session checks in its own plugin store (`$.store`), and raises a notification for new messages through your notification channel unless `slackNotify` is `off`. Without the rules it calls nothing and the pane lists the missing ones (found with `$.tool.check`). It publishes the unread count for desk-look's `✉` chip.

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
