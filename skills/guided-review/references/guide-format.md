# guide.json

The guide is the part you write. `gather.ts` writes the diff; `build.ts` joins the two and checks the guide against
the diff. [`../examples/demo.guide.json`](../examples/demo.guide.json) uses every common field, and
[`../runtime/types.ts`](../runtime/types.ts) types every one (`Guide`).

## Top level

| Field | Required | What it holds |
|---|---|---|
| `pr` | yes | `title`; `number` and `url` together, or neither for a branch with no pull request or for uncommitted changes; optional `author` (GitHub login), `base` (branch name), `head` (branch name). Copy them from GitHub, or from the `pr` line `gather.ts --pr` prints. `readOnly`: `true` for someone else's pull request, so the page and its sends say that Claude answers and changes no code. |
| `name` | no | The page's name in the browser tab and the artifact gallery, 2 to 4 words, such as "Webhook retries review". Defaults to "Guided review #<number>", or "Review of <branch>" with no pull request. |
| `diffStyle` | no | `"unified"` (default) to show each change in one column, or `"split"` to show old and new side by side. It is where cards start: each reader can switch with the Unified / Split control in the bar, and the page remembers their choice. Screens under 860 px wide always show one column. Pick `split` when most changes rewrite lines in place rather than add or remove whole blocks. |
| `links` | no | Buttons in the top bar, `[{ "label": "Video", "href": "https://…" }]`. Link the pull request's video and anything else the reader checks the change with. `https://` only. |
| `overview` | yes | The opening section. See below. |
| `chapters` | yes | The chapters, in reading order. See below. |

## `overview`

| Field | Required | What it holds |
|---|---|---|
| `summary` | yes | What the pull request changes and why, in 2 to 4 sentences: the state before, then what is different. A string, or an array of paragraphs. |
| `steps` | no | 2 to 5 one-line items: the main moves of the change, in the order the chapters take them. |
| `diagram` | yes | The diagram of the whole change, beside the summary. See below. |

## `diagram`

A diagram of what a section changes, drawn when the guide is built: the overview's shows the whole pull request, and
each chapter's shows its own part, above its code. `build.ts` draws it with [pele](https://pele.run) into SVG in the
page's own colors, light and dark, and lays it out again top to bottom for a phone.

| Field | Required | What it holds |
|---|---|---|
| `title` | no | One line in the card's header that names what the diagram shows, such as "Where a delivery goes after each post". Defaults to "Diagram". |
| `mermaid` | yes | [Mermaid](https://mermaid.js.org/intro/) source: a `flowchart LR` or `flowchart TD` most of the time; a `sequenceDiagram`, `stateDiagram-v2` or `erDiagram` when the change is a message order, states or tables. As a JSON string: `\n` between lines, and `\"` around a label with punctuation (`R["retrying, due at nextAttemptAt"]`). |
| `refs` | no | `{ "<node id>": "path:line" }`: the code a node stands for. Clicking the node, or Enter on it, jumps to that line in the chapter that shows it, and its tooltip names the file, line and chapter. A file the pull request does not change opens on GitHub at the head commit. A `:::removed` node's line is on the old side, unless its file is new. |

Mark the nodes of a flowchart with what the pull request does to them: `:::new` (green), `:::changed` (amber) or
`:::removed` (dashed red, struck through). The card's header shows a key for the marks the diagram uses. Leave out
`classDef` and `style`: colors written in the source do not follow the page's theme.

```json
"diagram": {
  "title": "Where a delivery goes after each post",
  "mermaid": "flowchart LR\n  D[\"deliver posts the event\"] -->|2xx| OK[delivered]\n  D -->|\"timeout, 5xx\"| R[\"retrying\"]:::new",
  "refs": { "D": "src/webhooks/deliver.ts:11", "R": "src/webhooks/deliver.ts:31" }
}
```

`build.ts` stops on source pele cannot read, with its line, and on a ref to a node the diagram does not have. It warns
when a diagram is over 960 px wide (it shrinks to fit its card), has more than 14 nodes, or marks no node.

## `chapters`

| Field | Required | What it holds |
|---|---|---|
| `id` | yes | Lower case letters, digits and dashes. It becomes the anchor `#c-<id>` and the key for review marks, so keep it when you rebuild. |
| `title` | yes | The idea, in a few words: "Merge gate on the board", not "Changes to merge-gate.tsx". |
| `kind` | no | `core` (default), `docs`, `database`, `tests` or `generated`. Every kind but core shows a label. Database, tests and generated chapters come after every core and docs chapter, and generated ones come last. |
| `body` | yes | One or two short paragraphs, a string or an array. |
| `files` | yes | The code the chapter shows, in the order to read it: a path for the whole file, or `{ "path": "…", "hunks": [2, 3] }` for some of its hunks. Hunk numbers are the ones `gather.ts` prints. |
| `table` | no | A boxed state table under the body, below. |
| `diagram` | yes | The diagram of what this chapter changes, above its files. Fields as above. |

Every hunk of every file belongs to a chapter, and `build.ts` stops when one is missing. Split a file by hunks
when its parts belong to different ideas; show a hunk once.

A Markdown file (`.md`, `.markdown`) needs nothing more: `build.ts` renders it, and its card opens in Preview with
the change marked, showing the blocks of the chapter's own hunks. A ref to one of its lines lands on the block that
holds it. A file gather.ts keeps without its text (over 4,000 lines or 400 KB) shows only its source.

## `table`

A state table lays out the cases a change decides between, one row per case, with the new cases marked.

| Field | What it holds |
|---|---|
| `title` | Defaults to "State table". |
| `caption` | A muted line after the title, such as "which delivery completes". |
| `ref` | `path:line` of the code that decides. |
| `columns` | The column names. |
| `rows` | Each row is `{ "cells": […], "new": true }`, or `"gone": true` for a case that no longer exists, or a plain array of cells. |
| `note` | A line under the table, such as "2 of 4 cases are new". |

## Text

`summary`, `steps`, `body`, table cells and `note` take a small Markdown subset: `` `code` ``, `**bold**`, `*em*`,
`[text](https://…)`, and `[text](ref:path:line)` for a link that jumps to a line of the diff (or to GitHub, for an
unchanged file). Name functions, types and fields in backticks.

## stack.json

Several pull requests on one page: a stack, or any set to review together. `build.ts --stack=<path>` reads it.

| Field | Required | What it holds |
|---|---|---|
| `name` | no | The page's name in the browser tab and the artifact gallery, 2 to 4 words, such as "Webhook retries stack". Defaults to "Guided review #140–#142". |
| `diffStyle` | no | `"unified"` or `"split"` for every pull request on the page; without it, the first guide's. |
| `prs` | yes | The pull requests in the order the menu lists them, a stack from its base up: `[{ "guide": "pr-140/guide.json", "diff": "pr-140/diff.json" }, …]`. Paths are relative to the stack file. Each pull request appears once. |

Each guide is checked on its own, as above, and its errors start with its number. Its `name` and `diffStyle` give
way to the stack's. Every element id on the page starts with the pull request's own (`pr140-`), so two guides may use
the same chapter ids. A link's anchor picks the pull request: `#pr140`, `#pr140-c-<id>` or `#pr140-diff`. The menu
draws the pull requests as a stack when each one's base (`pr.base`, or the branch `gather.ts` read) is the branch of
the one before it.

