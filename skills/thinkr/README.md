# thinkr

A skill for Claude that turns a design or an explanation into a clean, interactive page, published as a Claude
Artifact.

- **Design pages** lay out what Claude is about to build: a stepped diagram of how it works, then 2 to 5 single or
  multiple choice questions about the real forks. You answer them, press **Send feedback** or **Approve design**, add
  an optional message, and Claude picks up your answers in the session. Each new version lists what changed and why
  under **Changes**; click an entry to jump to the change, with the added words underlined and the removed ones
  struck through.
- **Specs** come once a design is decided and approved, two of them, with none of the talk that led there. The
  spec is for you: what will happen once it is built, at a glance, in short sentences beside a diagram, the schemas
  and a table of cases. **Spec**, in the design page's bar, shows it. The agent spec is for the agent that builds
  it: every decision, behavior, interface, piece of work and check, complete. The page does not show it; **Copy
  agent spec** copies it. A fresh agent with no other context builds from it, and
  [guided-review](../guided-review) links the review of what it built back to the spec.
- **Explainer pages** teach one idea: diagrams you step through, WebGPU figures you can move, quick self-checks, and
  links to the sources behind every claim.

It looks like shadcn/ui's default theme in Geist: one reading column, an "On this page" rail that lists the
questions, motion that stays out of the way, and quiet UI sounds made with
[earshot](https://github.com/Leonxlnx/earshot). Pages stay small and open fast: math and code are rendered
ahead of time, libraries are preloaded, the styles and runtime are files published beside the page, and Geist loads
from Google Fonts.

## Install

In Claude Code (2.1.275 or later):

```
/plugin install snowmead --marketplace snowmead/plugins
```

This installs the plugin snowmead, which holds all four of these skills; run this one as `/snowmead:thinkr`. On
older versions: `/plugin marketplace add snowmead/plugins`, then `/plugin install snowmead@plugins`. For other
agents, or as a plain skill: `npx skills add snowmead/plugins --skill thinkr` (add `-g` for every project).

### Requirements

- [Bun](https://bun.sh) 1.2 or newer on your `PATH`. The first build installs the packages the build uses
  (MathJax, highlight.js, pele, which draws Mermaid diagrams, and markdown-it, which renders a spec), once, from the
  pinned lockfile.
- Publishing uses Claude's Artifact tool, so pages are made in Claude Code or another Claude client that can publish
  Artifacts. claude.ai uploads are best effort: they need code execution with network access to install Bun.
- Optional: Google Chrome, for the screenshot check (`scripts/shot.ts`).

## Use

Ask in plain words. The skill triggers on designing, planning and explaining:

- "Design the rate limiter as a thinkr page and ask me about the open questions."
- "Explain how our sync engine resolves conflicts, with a diagram I can step through."

Claude writes the page, checks it, publishes it, and gives you the link. On a design page, answer the questions and
submit; Claude reads your answers and messages and updates the page. Once you approve it with nothing left open,
Claude writes the specs, puts the one for you under **Spec**, and asks for a go; then a fresh agent builds from the
agent spec alone.

### On the page

Every page gives its reader these, with nothing for Claude to write:

- A sticky bar with the page name once they scroll, and a sound toggle. Sounds play after their first click.
- "On this page" on wide screens: sections, with their questions one notch to the right and a dot that fills when a
  question is answered. The highlight slides along the rail; a click glides to the entry.
- In a design, the dock at the bottom: the answered count (click it to go to the next open question), **Send feedback**
  and **Approve design**. Either button opens a panel above the dock with an optional message ("Anything else Claude
  should know?") and **Submit** (⌘↵). Approving with open questions says how many are open, with a link to the first.
- In a design with `<t-amends>`, **Changes**: versions that fold, newest first, each change a one-line row with its
  label; left of the page on wide screens, behind a Changes button in the bar on narrower ones. The current version
  and any with news start open. Opening a row shows where it came from (Q and A for an answer, the quote for a
  comment) and why, lights its changes (added words underlined, removed words struck through, removed blocks shown)
  and glides to the first; the bar then shows where they are (2 / 3) with previous, next and close (Esc). One row is
  open at a time; clicking it again closes it. Rows newer than the reader's last visit get a dot, and their count
  shows on the Changes button.
- In a design with its specs, **Design | Spec** in the bar. Spec shows the spec in the same column, with its own "On
  this page" and **Copy agent spec**; the dock and Changes step aside. Each view keeps its place, and a link that ends
  in `#spec` opens on the spec.
- Claude's own comment button (from the artifact viewer) works on any paragraph, figure, question or code line.

## Maintain

Run these in this folder, after `bun install`:

| Command | Does |
|---|---|
| `bun run test` | Builds both templates, and the design with its two specs from `templates/`, and drives them in headless Chrome over DevTools: behavior, no console errors, and timing budgets (startup ≤ 30 ms, each interaction ≤ 12 ms); checks the build refuses specs beside an open question, one without the other, or one that is stale or left open |
| `bun run typecheck` | `tsc` over the runtime and the scripts |
| `bun run examples` | Builds `templates/design.html` and `templates/explain.html` |
| `bun scripts/build.ts --refresh` | Moves motion, vgpu, d3 and Plot to their newest release that is at least 14 days old (the artifact rule); `--major` crosses a major version |

The look, the font link, the sounds, the bar and buttons, and the build and test helpers come from the shared
[kit](../../kit), linked here as `kit/`; its README says how to change them. Sounds stay in one family: short, crisp
ticks and clicks under 100 ms, matched in loudness. UI sound should confirm, never alarm.

```
SKILL.md                          what Claude reads first
references/                       authoring.md, figures.md, design.md, spec.md, vgpu.md
templates/                        design.html, explain.html (working examples), spec.md and agent-spec.md (its specs)
runtime/                          TypeScript runtime, CSS, library pins
kit/                              link to the shared kit: tokens, sounds, UI parts, build helpers
scripts/                          build.ts with changes.ts, spec.ts and tree.ts, shot.ts (used by the skill); test.ts (maintenance)
package.json, bun.lock            build dependencies; the first build installs them
```

Licensed under Apache-2.0 (`LICENSE.txt`). Third-party parts keep their own licenses, listed in `NOTICE`: earshot
(MIT).
