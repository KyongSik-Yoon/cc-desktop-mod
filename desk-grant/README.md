# desk-grant: lets desk-asana and desk-slack call their own tools

**English** | [한국어](README.ko.md)

desk-grant is a Claude Code plugin (mod) with no pane and no settings. It allows the Asana and Slack MCP tools that [desk-asana](../desk-asana/README.md) and [desk-slack](../desk-slack/README.md) call from their panes, so you do not need `permissions.allow` rules for them. It comes from the same marketplace as [desk-look](../README.md).

A plugin's MCP call goes through Claude Code's permission check like Claude's own calls: auto mode refuses it and the default mode asks every time. A plugin's own permission hook does not run for calls made from its buttons, input boxes or timers, but another plugin's hook does, so the grant is a separate plugin. desk-grant is not submitted to the Claude plugin directory.

## Install

Installing desk-asana or desk-slack installs it too. If you had desk-asana or desk-slack before 0.70.0, updating does not pull in the new dependency; install it once, then reload:

```
/plugin install desk-grant@cc-desktop-mod
/reload-plugins
```

desk-asana and desk-slack list desk-grant as a dependency: without it Claude Code turns them off and lists them under Errors in `/plugin`. You can remove the old `permissions.allow` rules for these tools (`mcp__asana-v2__…`, `mcp__claude_ai_Slack__…`); while they stay, they also let Claude itself call those tools without asking. desk-look's `/desk-update` updates desk-grant too (it does not install it).

## What it runs, reads and sends

Nothing: it runs no programs, reads nothing and sends nothing over the network. Its one hook, `tool.check`, answers `allow` only when both hold:

- the call (or a `$.tool.check` query) was raised by the plugin desk-asana or desk-slack, which the engine records in `next.origin.plugin`
- the tool is `mcp__<any server>__<name>` and `<name>` is in that plugin's own list: the Asana v2 and v1 tools desk-asana uses, or desk-slack's five Slack tools

Everything else goes on with `next(e)` unchanged, so Claude's own calls to the same tools still get Claude Code's normal permission check.

## License

MIT
