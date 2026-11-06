---
name: simplify-review
description: "Runs /simplify on the current changes to apply cleanups, then /code-review medium to look for bugs, and shows one report in desk-review's side pane. Usage: /desk-review:simplify-review [target]. Use when the person asks to simplify and then review, or to clean up and review in one go."
argument-hint: "[target — the current diff when left out]"
disable-model-invocation: true
---

# simplify → code-review medium

Call the two skills **in this order, in one turn**. Do not ask the person anything in between.

1. `Skill(skill: "simplify", args: "$ARGUMENTS")` — applies the cleanups to the working tree.
2. As soon as simplify finishes, `Skill(skill: "code-review", args: "medium $ARGUMENTS")`.
   The review also covers the code step 1 changed — that is the point of the order
   (the review catches defects the cleanup introduced).

## Rules

- Never swap the order. Cleanups made after the review are reviewed by no one.
- Always pass `medium` to code-review. Left out, it reuses the last level typed.
- Run step 2 even when step 1 changed nothing.
- If step 1 fails or breaks the build, stop and report instead of going on to step 2.
- Commit as each skill and the person's own rules say. This skill sets no commit units of its own.

## Final report — the point of this skill

After both steps, **always** report once, as below. Without it the skill did not run.
Write it even when code-review already reported through `ReportFindings` — then point at each finding
with its `short_summary` in one line instead of repeating its text.

### Where: desk-review's pane

Call `mcp__desk-review__review_report` with every item:

- `summary`: one sentence — what changed and what the review found.
- `items`: one entry per cleanup and per finding, `{ stage, status, file, line, reason }`.
  - `stage: "simplify"` with `status` `fixed` (applied) or `skipped` (left alone).
  - `stage: "review"` with `status` `found` (a real defect) or `dismissed` (rejected on verification).
  - `file`: the full path, relative to the working directory or absolute. Never just the file name, never shortened with `…`.
  - `line`: the 1-based line the item is about. For a fix, the first changed line after the fix.
  - `reason`: **always**. Why it was fixed (duplication, needless complexity …), why it was skipped
    (false positive, out of scope, would change behaviour …), how it breaks (which input, what goes wrong),
    or why it was rejected (the evidence from verification).
- `unverified`: tests not run, files not read, doubts left. Empty when there are none.
- `next`: what the person has to decide, as two options with a recommendation. Empty when there is nothing.

The pane draws each item as one line with its reason below; pressing it opens that file in desk-look's diff
pane. So **do not paste code into the report**, and in your
reply write only the one-line summary — never the items again.

### When the tool is missing or refuses

If `mcp__desk-review__review_report` is not available, or refuses the input twice, write the same report as
Markdown in the session's scratchpad directory (from the system prompt; `/tmp/claude-$(id -u)/` without one)
as `simplify-review-<YYYYMMDD-HHMMSS>.md`, and reply with its full path and the one-line summary.
In that file, put under each item's `path:line` a code block: for `fixed` the diff hunk of that change
(`git diff -U3 -- <file>`, language `diff`), for the others about five lines either side of the line from the
current file. Read the code from the file or the diff; never rewrite it from memory. Do not use tables, and write
"None" for an empty section rather than leaving it out.
