# guided-review

A skill for Claude that turns a pull request, a branch or your uncommitted changes into a guided code review,
published as a Claude Artifact. The pull request can be yours or someone else's.

A big diff shown in file order makes the reviewer work out what the change does. A guided review does that work for
them:

- **Overview** with a **diagram** of the whole change: the path a request or a record takes now, its new, changed
  and removed parts marked in green, amber and dashed red, each node linked to its line and its chapter.
- **Chapters**, one idea each, in reading order: text on the left, its code on the right, under a diagram of what
  that chapter changes. Core change first; docs, then database, tests and generated files last, with a label. State
  tables lay out the cases a change decides.
- **Diagrams** are Mermaid, drawn when the guide is built by [pele](https://pele.run) into SVG in the page's own
  colors and type, light and dark, with no diagram library in the page; on a phone they are laid out top to bottom.
- **Code** drawn by [`@pierre/diffs`](https://diffs.com): syntax highlighting, changed words within a line, folds
  that name the function they hide, moved code marked at both ends. A **Diff** tab lists every file in a
  [`@pierre/trees`](https://trees.software) tree. Unified or split: the guide sets where it starts (`diffStyle`),
  and each reader can switch from the bar.
- **Markdown** files open in **Preview**, as GitHub shows them: rendered when the guide is built (with
  [markdown-it](https://github.com/markdown-it/markdown-it) and a GitHub-like sanitizer), with the change marked:
  added and removed blocks, and the words that changed inside a block, folded around it. **Changes** off shows the whole
  document as it is now; **Source** shows the diff. Each card keeps its own switches. Images of the repository are
  embedded; links to its files go to GitHub at the head.
- **Full width**: the page fills the window, so long lines show in full. The panel button at the left of the bar (`b`)
  closes the chapter text in the guide, leaving each chapter's title above its code, and the file tree in the Diff
  tab; each view remembers its own.
- **Review marks**: tick a chapter or a file to fold it and count it toward "3 of 6 chapters reviewed". `j` and `k`
  move between chapters, `r` marks one. Marks stay in the reader's browser and survive a rebuild for a new head.
- **Review comments**: press the **+** in a card's gutter to comment on a line. For a block of lines, click a line
  number, Shift-click another and press the **+**, or drag the **+** over the lines;
  the speech bubble in a file's header comments on the whole file, and **Comment** under the title on the whole pull
  request. In a Markdown preview, the speech bubble beside a block comments on the block's lines. Each comment is a box in a margin beside the code, level with its line, like comments beside a document;
  click one to go to its code, opening its file if it is folded or marked reviewed, with its lines selected. **Send**
  sends a comment to Claude at once; **Add to queue** queues it, and the bar's **Send N to Claude** sends the queue. Claude changes the code on the branch and
  republishes the guide for the new head. `c` hides the margin. Without a Claude session to send to, Send copies the
  comments for the chat. On a narrow screen the boxes sit in the code instead.
- **Comment threads**: a sent comment stays as a thread, with Claude's answer. Reply in it to keep the conversation
  going. Each thread has a Claude agent of its own, a background subagent that reads its code, answers and makes its
  changes, so one thread's work stays out of the others'; the session that published the page keeps a ledger of every
  thread, and settles once a problem or a design choice that several share. The bell in the bar lists the answers you have not read; click one to go to it. As on GitHub, a thread follows its code to a new head, is marked **Outdated** when that code is gone, and
  folds away when resolved.
- **Uncommitted changes**: review the working tree without a commit. gather takes a snapshot of it, staged, unstaged
  and untracked files, and leaves your files, index and refs as they are. Claude's changes land in the working tree, and
  nothing is committed.
- **Someone else's pull request**: gather clones the repository beside the guide, at the pull request's head, so it
  needs no checkout and touches none. Claude answers comments and changes no code. When you ask, your comments become a
  pending review on GitHub, which you submit there.
- **Stacks**: one page can hold several pull requests, a stack or any set to review together. The title becomes a
  menu of them, a stack drawn from its base up, each with its branches, size and review progress; `[` and `]` move
  between them.

The page holds only its markup: its styles, its data and one small bundled runtime are files published beside it,
Geist and Geist Mono load from Google Fonts, and the libraries are preloaded with their whole import graphs. It
shares its look, its quiet UI sounds and its bar with [thinkr](../thinkr) and [changelog](../changelog) through the
[kit](../../kit): a sound confirms a mark, and the speaker button mutes them.

## Install

In Claude Code (2.1.275 or later):

```
/plugin install snowmead --marketplace snowmead/plugins
```

This installs the plugin snowmead, which holds all four of these skills; run this one as `/snowmead:guided-review`.
On older versions: `/plugin marketplace add snowmead/plugins`, then `/plugin install snowmead@plugins`. For other
agents, or as a plain skill: `npx skills add snowmead/plugins --skill guided-review` (add `-g` for every
project).

### Requirements

- [Bun](https://bun.sh) 1.2 or newer and git on your `PATH`. The first build installs its packages (pele,
  markdown-it and sanitize-html) once, from the pinned lockfile.
- [`gh`](https://cli.github.com), signed in, only for someone else's pull request.
- Publishing uses Claude's Artifact tool, so guides are made in Claude Code or another Claude client that can publish
  Artifacts. Without it, Claude hands you the preview file, a full HTML document.
- Optional: Google Chrome, for the screenshot check (`scripts/shot.ts`).

## Use

Ask in plain words:

- "Write a guided review of PR 214."
- "Walk me through what the `retry-webhooks` branch changes."
- "Review my local diff. I have not committed it."
- "Write a guided review of https://github.com/acme/api/pull/88. It is Sam's, and I am reviewing it."
- "Review the stack #140 to #142 as one guide."

Claude gathers the diff, reads the change, writes the chapters, checks and builds the page, publishes it, and gives
you the link. Comment on lines, files or the whole pull request, and send each comment at once or queue them and send
them from the bar: Claude answers each comment in its thread, makes the changes you asked for, and puts the next version of the guide
on the same link. Reply in a thread to go on. Claude pushes only when you say so. On uncommitted changes it commits
nothing, and on someone else's pull request it changes no code.

## Maintain

Run these in this folder, after `bun install`:

| Command | Does |
|---|---|
| `bun run test` | gather and build against a scratch repository (kinds, scopes, moves, refs, escaping, every refusal, a working tree's snapshot, a pull request from a stand-in for GitHub), then the demo in headless Chrome over DevTools: behavior, no console errors, and timing budgets (boot ≤ 30 ms, each interaction ≤ 12 ms) |
| `bun run typecheck` | `tsc` over the runtime and the scripts |
| `bun run example` | Builds the demo into `examples/demo.preview.html`, and the two stacked demo pull requests into `examples/stack.preview.html` |
| `bun scripts/build.ts --refresh` | Moves @pierre/diffs and @pierre/trees to their newest release that is at least 14 days old (the artifact rule); `--major` crosses a major version |

```
SKILL.md                          what Claude reads first
references/                       guide-format.md, writing.md, stack.md, comments.md, threads.md
examples/                         demo.guide.json, demo-43.guide.json, and demo/ (the demo's base, its head and the PR stacked on it)
runtime/                          TypeScript runtime, CSS, library pins
kit/                              link to the shared kit: tokens, sounds, UI parts, build helpers
scripts/                          gather.ts, build.ts, shot.ts (used by the skill); test.ts, demo.ts (maintenance)
package.json, bun.lock            dev dependencies (TypeScript, Bun's types)
```

The page layout comes from the guided review in [haaku-co/corpus-christi](https://github.com/haaku-co/corpus-christi).
Licensed under Apache-2.0 (`LICENSE.txt`). Third-party parts keep their own licenses, listed in `NOTICE`:
earshot (MIT).
