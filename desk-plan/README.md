# desk-plan: plan approval in a card

**English** | [한국어](README.ko.md)

desk-plan is a Claude Code plugin (mod) that asks for plan approval (`ExitPlanMode`) in a card above the prompt instead of the engine's full-screen dialog, so the plan opens in a side pane you can read while you decide. It comes from the same marketplace as [desk-look](../README.md) and needs it: the card sits in desk-look's band and the plan opens in desk-look's preview pane.

Until 0.68.6 the card was part of desk-look. It answers Claude Code's permission dialog for you, which a plugin listed in the Claude plugin directory may not do, so it moved here to keep desk-look listable. desk-plan itself is not submitted to the directory.

## Install

At the prompt of a Claude Code terminal session (desk-look comes along if it is not installed yet):

```
/plugin install desk-plan@cc-desktop-mod
```

It follows the latest Claude Code release, like desk-look. desk-look's `/desk-update` updates it too.

## The plan card

When Claude calls `ExitPlanMode` with a plan file (`~/.claude/plans/`), the card shows the plan's title and the plan opens in desk-look's preview pane. With an empty prompt:

- `1` approves. Claude Code returns to the mode you were in before plan mode, as the dialog's first choice does
- `2` opens the plan in the pane and moves the focus there
- Double-click `Changes`, write what to change and press Enter: Claude stays in plan mode, revises the plan and asks again
- `9` hands it to the engine dialog, for its other choices (such as approving with manual edits). `Close` refuses the plan without changes; Esc stops the turn, which cancels it

While the card is open it takes desk-look's band, the progress band under the spinner hides, and the hint line ends with the keys that answer it. A notification goes out when it opens (`notify`), because the engine sends none while the card stands in for its dialog.

The card is used only in sessions with a single terminal attached, and follows where you typed your last message, as desk-look's question card does: from the terminal, the card; from the Claude app (Remote Control) or from a phone through collie, the engine dialog, so you can answer there. Without a plan file, or while desk-look's question card is open, the engine dialog opens too.

## Settings

`/plugin configure desk-plan@cc-desktop-mod`:

- `language`: `auto` (default), `en`, `ko`. `auto` follows desk-look's language
- `notify`: `on` (default), `off`. Notify when the plan card opens (desk-look's `askNotify` covers only its question card now)

## What it runs and reads

- `mktemp -d`, `mkfifo`, `cat`, `tee` and `rm -rf`: the card waits for your answer on a named pipe in a temporary folder (`cat` reads it, the card's buttons write the answer with `tee`) and removes the folder afterwards
- Reads session state files (`~/.claude/sessions`) to see whether Remote Control is attached, and desk-look's values: its language, whether its question card is open, and where your last prompt came from
- Sends nothing over the network

## Hooks

- `classic.PreToolUse` (`ExitPlanMode` only): shows the card and waits. Approving returns the call's own input with `allow`, so Claude Code runs the tool and leaves plan mode as its dialog would. Asking for changes or `Close` refuses the call with a reason for Claude; `9` passes it on with `next(e)` to the engine dialog
- `ui.render` (`AbovePrompt`, `PromptHint`): draws the card and the hint keys while the card is open, and passes everything else on
- `session.start`, `state.set` (desk-look's `lang`): follow desk-look's language

## License

MIT
