# desk-asana: Asana tasks in a Claude Code side pane

**English** | [한국어](README.ko.md)

desk-asana is a Claude Code plugin (mod) that opens your Asana tasks in a side pane next to the conversation. It comes from the same marketplace as [desk-look](../README.md), which redraws the Claude Code terminal to look like the Claude desktop app. It works on its own; with desk-look, `/desk-fold` folds its pane too and it follows desk-look's language.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install desk-asana --marketplace KyongSik-Yoon/cc-desktop-mod
```

It follows the latest Claude Code release, like desk-look. `/desk-update` from desk-look updates it too; without desk-look, run `claude plugin update desk-asana`.

## `/desk-asana`: Asana tasks

Your open Asana tasks, read through the Asana MCP server Claude Code already has connected (no token or setting of its own). It uses Asana's official V2 server (`https://mcp.asana.com/v2/mcp`, the one with `get_my_tasks`) when one is connected, otherwise the claude.ai Asana connector; on the connector, listing your tasks needs a Premium workspace (Asana's task search). With neither, the pane says to connect Asana in `/mcp`.

- The list groups your incomplete tasks by project, with the due date at the end of the row (red when overdue). Below them, `Done in the last 14 days` shows the tasks completed in the last 14 days, dimmed, with their status (`● On hold`). Depending on the task type, statuses such as on hold or waiting for release count as complete in Asana, so a task moved to one of them can still be opened from the pane
- The `● My tasks ○ Projects` tabs at the top switch views. `Projects` lists the projects you are a member of, most recently changed first (member count, and open task count on the V2 server). Click one for its open tasks, whoever they are assigned to, grouped by section with the assignee and due date (sections with no open task are left out), and tasks completed in the last 14 days in a `Done in the last 14 days` group at the end; click a section row to fold it, or `Collapse all` (`z`) to fold or unfold every section. Up to 300 open tasks are read per project. `← Projects`, at the top and again at the bottom, goes back to the list
- The `Search` box above it finds open tasks anywhere in the workspace you can see, by name, description or comment (the 50 most recently changed), shown the same way with each task's assignee; `✕ My tasks` or an empty search goes back to your tasks. Search needs a Premium workspace (Asana's task search)
- Click a task for its details: the task type's status (`● Open`), projects and sections, assignee, due date, custom fields, the description with its formatting as on the web (headings, bold, lists, inline code, code blocks, links and task mentions) and the latest 30 comments, formatted the same way with mentions by name (on the claude.ai connector, the comments among the task's first 100 activity entries). `↻` (`r` in every view) reloads, `← Tasks` (also at the bottom) goes back to the list, the search or the project
- Write a comment in the box at the bottom and press Enter to add it on Asana. `@ Mention` below it finds people by name or email; pressing one puts `@Name` in the comment, and it is sent as an Asana @-mention (which notifies them) as long as the `@Name` is still in the text when you send
- `✎ Edit` next to one of your own comments edits it in place (Enter saves). The Asana MCP servers have no tool for editing a comment, so this one call goes to Asana's REST API with a personal access token you put in yourself: create one at https://app.asana.com/0/my-apps, put it in `Asana personal access token` under `/plugin configure desk-asana@cc-desktop-mod` (kept in secure storage) and choose `Save configuration`, which reloads the plugin. Without a token, `✎ Edit` explains this and calls nothing. Only the characters you change are written back into the comment's original rich text, so mentions, links, bold, lists, code blocks and images you did not touch stay exactly as they were. List marks (`• `, `1. `), images (`[image]`) and the letters of a mention or link are shown but cannot be changed here (a whole mention can be deleted); an edit that touches them is refused and kept in the box. Only comments the token's owner wrote can be edited
- `Change` next to the assignee finds people by name or email (or `Me`); handing the task to someone takes a second press within 5 seconds
- `›` next to a dropdown custom field lists its options; press one to set it
- `Hand to Claude` fills the prompt with the task's title, link, status, description and recent comments
- `Change` next to the task type's status (Open, In Progress…) lists the type's statuses; picking one changes it. The Asana MCP servers drop this key, so like `✎ Edit` it goes to Asana's REST API only when you have put in a personal access token; without one, `Change` explains how and calls nothing
- These Asana calls are made only when you open the pane or press something in it, and they go through Claude Code's permission check like Claude's own calls: auto mode refuses them and the default mode asks each time, unless an allow rule covers them. Add the pane's tools to `permissions.allow` in `~/.claude/settings.json`; while some are missing, the pane lists them. For the V2 server:

  ```json
  "mcp__asana-v2__get_my_tasks", "mcp__asana-v2__search_tasks", "mcp__asana-v2__get_task",
  "mcp__asana-v2__get_task_stories", "mcp__asana-v2__add_comment", "mcp__asana-v2__update_tasks", "mcp__asana-v2__search_objects",
  "mcp__asana-v2__get_me", "mcp__asana-v2__get_projects", "mcp__asana-v2__get_tasks"
  ```

  The rule allows the same tools for Claude too, including adding comments and changing tasks

## What it runs, reads and sends

desk-asana collects no data and runs no programs. Everything it reads stays on your machine, except what is listed under "Sends".

**Reads**: the Asana personal access token you put in its settings (`asanaToken`, used only as described under "Sends"), Claude Code's `language` setting, and desk-look's language and `/desk-fold` state when desk-look is installed.

**Sends**: only through the Asana MCP server Claude Code already has connected (with Claude Code's own connection and login), only when you open `/desk-asana` or press something in it: it reads your tasks, open tasks matching text you search for, the workspace's projects and the open tasks of a project you open, a task's details and comments, and people matching a name you search for, and adds a comment, changes the assignee or sets a dropdown field when you submit or press those. With an Asana personal access token in the plugin settings, two actions call Asana's REST API (`https://app.asana.com/api/1.0`) directly through `$.http.fetch`, the token only in the `Authorization` header: `✎ Edit` on one of your comments reads that comment's rich text and your Asana user ID, and saving writes the edited text back; picking a task type's status sets it on the task. Without a token these actions call nothing. The MCP calls go through Claude Code's permission check like any other; desk-asana only asks, with `$.tool.check`, which of the pane's Asana tools have no allow rule, to list them in the pane.

## Hooks and what they do

Every hook below passes the event on with `next(e)` and only watches the result, except where it says otherwise.

- `ui.render`: draws the `/desk-asana` pane
- `session.start`, `session.end`: register `/desk-asana` and tell desk-look the plugin is loaded (again after `/resume` or `/clear` in the same window)
- `state.set` on desk-look's `lang` and `folded`: after desk-look's own write goes through, follow its language and fold or unfold this plugin's pane with `/desk-fold`
- `command.run`: handles `/desk-asana` only

`hooks/shared/` is a copy of desk-look's Markdown renderer, used to draw task descriptions and comments; `hooks/shared/vendor/lovely-mermaid.js` is [lovely-mermaid](https://github.com/xl0/lovely-mermaid) 0.3.3 (Apache-2.0, `hooks/shared/vendor/LICENSE.lovely-mermaid`), bundled without minification. It runs no programs and makes no requests.

## Settings

Search for `desk-asana` in `/config` to find these options.

- `language`: `auto` (default), `en`, `ko`. Language of the plugin's own labels. `auto` follows desk-look's language, or without desk-look Claude Code's `language` in `/config`: Korean when it names Korean, English otherwise
- `asanaToken`: empty (default). An Asana personal access token, optional. Only `✎ Edit` on your Asana comments and changing a task type's status use it (see `/desk-asana`); set it with `/plugin configure desk-asana@cc-desktop-mod`
- `asanaKeyField`: empty (default). Optional. Name of the Asana custom field that holds each task's key (for example an ID field `JKD` giving `JKD-1630`). With it, the list shows the key dimmed after each task's title, typing a key (`JKD-1630`) in the search box finds that open task first, and `Hand to Claude` includes the key. Several names separated by commas (`JKD, J5S`) use the first one a task has a value for. Empty shows titles only

## License

MIT (`LICENSE`)
