# Writing the guide

A guided review answers one question for a reader who did not write the code: what did this pull request change,
and where is it? The reader should understand the change at a high level from the overview, then review one idea at
a time, and spend attention only where it matters.

## Before you write

Read the whole diff, not only the outline `gather.ts` prints: `git diff <base>...<head> -- <path>`, with the refs you
gave `gather.ts`, a file or a folder at a time. After `--worktree` or `--pr`, start from the command gather printed:
plain `git diff` skips untracked files, and the checkout you started in may not hold the pull request. Do not read
`diff.json`; it holds the full old and new text of every changed file. Read the pull request's description, its commits
and the thread that asked for it. Open the callers
and callees of each changed function until you can say what happened before the change and what happens now. On a
large pull request (over about 1,000 changed lines), give that tracing to Explore subagents, one per area, and work
from their short reports. When the diff and the description disagree, the diff wins: the guide describes the code at
its head commit.

When the change was built from a spec (the description has a `Spec:` line with a thinkr design page's link), read the
spec too: `Artifact` `read` of that link, without its `#spec`, with `path: "spec.md"`. Set `spec` in the guide
([guide-format.md](guide-format.md#top-level)), so the page links to it. Where the code does something the spec does
not say, or leaves out something it does, say so as a plain fact in the chapter that holds it: the reader reviews the
change against the spec it was built from.

If the read finds a defect in a pull request you drive, fix it first: the guide is written for the code that will
merge. In uncommitted changes or someone else's pull request, tell the user; the guide still describes the code as it
is.

## Chapters

Plan the chapters before anything else.

- **One idea per chapter.** A chapter is one change a reviewer can hold in mind: a new check, a moved
  responsibility, a renamed concept, a new screen. Group the files and hunks that make that idea, across folders. A
  file whose hunks serve two ideas is split by hunks.
- **The core change comes first.** Order chapters so each one builds on the ones before it: the type or rule the
  change is about, then the code that uses it, then the surface (route, screen, prompt). Docs that explain the
  change can follow the code they describe.
- **Database, tests and generated files come last.** Give them their kinds so they carry a label. Generated files
  start folded.
- **3 to 8 chapters.** Merge chapters of one hunk into the idea they serve. Split a chapter that needs more than two
  short paragraphs.
- **Title the idea, not the file.** "Merge gate on the board", "The search is a read", "Retry failed async steps".
  A few words, sentence case, no file names.

## Chapter text

- **Say what the code does now, and why.** Start with the behavior or the rule, then name the type or function that
  carries it. The reader sees the code beside the text, so do not narrate it line by line.
- **Two short paragraphs at most, under 110 words.** The first says what changed; the second, when needed, says a
  consequence, an edge case, or what the code deliberately does not do.
- **Name things in backticks.** `MergeGate`, `search_programs`, `open_fields`. Link one with `[name](ref:path:line)`
  when the reader should jump to it.
- **A table when the change decides between cases.** When a change picks among states or inputs, a state table with
  one row per case says it faster than prose. Mark the new rows.
- **No praise, no review findings.** The guide explains; it does not grade. A risk the reviewer should know about is
  a fact about the code: say it plainly ("The retry runs inside the transaction, so a failure rolls back both
  writes").

## Diagrams

Every section has one, drawn at build in the page's colors: the overview's draws the whole pull request, and each
chapter's draws its own part, above its code. A diagram answers the reviewer's first question about a section: what
did this look like before, and what is different now? Draw each chapter's after its text, from the code.

- **Draw the path that changed, as a diff.** The entry point, the steps under it, the decision or the state that is
  new. Mark what the pull request adds `:::new`, what it changes `:::changed` and what it takes out `:::removed`, and
  keep the nodes around them plain, so the reader knows where they are. A removed node can hang off the node that
  used to lead to it, on a dotted edge labelled `before`.
- **Pick the kind that fits the change.** A flowchart for a path or a decision (`LR` for a pipeline, `TD` for a
  decision tree), a sequence diagram for messages between services, a state diagram for new states, an ER diagram
  for tables.
- **Keep it small: 3 to 10 nodes, labels under about 40 characters.** Name a node for what it does ("deliver posts
  the signed event"), with the code's names in it, and put conditions on the edges. Leave out the calls that did not
  change and do not explain the change.
- **Ref every node that stands for code.** A ref makes the node a link to its line, and its tooltip names the
  chapter, so the overview's diagram doubles as a map of the guide.
- **Every chapter, the late ones too.** Docs: the sections that changed and what they now say. A migration: the
  table with its new columns, constraints and indexes. Tests: the cases, grouped by what they test, the new ones
  marked. Generated files: the source they come from and what changed in it.

## Overview

Write it last, from the chapters and their diagrams.

- **Summary, 2 to 4 sentences.** What was wrong or missing, then what the pull request does about it, in the words
  a product person would use. No file names.
- **Steps, 2 to 5 lines,** in chapter order: the main moves of the change.
- **Diagram: the whole change at a glance.** The path a request, an event or a record takes now, with what the
  pull request adds, changes and removes marked, in 5 to 10 nodes. Ref each node to the line its chapter shows.

## Style

Write close to [ASD-STE100](https://www.asd-ste100.org/) Simplified Technical English: short sentences, active
voice, one idea per sentence, the same word for the same thing, no idioms. Keep the code's names as they are, and use
the project's own domain terms, from its docs and its code.
