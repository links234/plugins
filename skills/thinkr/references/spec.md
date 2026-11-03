# The specs

The design page holds the reasoning: the options, the reader's answers, what changed in each version and why. Once
it is decided, two documents say what gets built, each for its own reader:

| | The spec | The agent spec |
|---|---|---|
| Reader | People: the user, a reviewer, anyone who wants to know what the work does | The agent that builds it, with no other context |
| Says | What will happen once it is built, at a glance | Everything needed to build it end to end, and how to check it is done |
| Reads like | Short sentences and the shapes to look at: a diagram, the schemas and interfaces, a table of cases | A complete brief: every decision, behavior, interface, file, pull request and check |
| File | `<name>.spec.md` | `<name>.agent-spec.md` |
| Where | The page shows it under **Spec** | Not on the page. **Copy agent spec** copies it, and it is published beside the page as `agent-spec.md` |

An agent that builds from the design page carries the rejected options and the back-and-forth into the code; one that
builds from the agent spec gets only what to build. A person who reads the agent spec wades through detail they did
not need; the spec tells them what happens in a minute. [`../templates/spec.md`](../templates/spec.md) and
[`../templates/agent-spec.md`](../templates/agent-spec.md) are the pair for the template design (its repository is
made up).

## When to write them

Once the design is decided: no question is left on the page, and the reader approved the current version. Write both
at once; the build refuses one without the other, and either one beside an open question. A document with a decision
still open is a design, not a spec.

## Both files

Each starts with the design version it describes, so the two cannot drift apart:

```markdown
---
design-version: 3
design-url: https://claude.ai/code/artifact/…
---
# API Rate Limits
```

| Front matter | Use |
|---|---|
| `design-version` | Required in both. The design version they describe: the page's `version`. The build refuses a spec for another version. |
| `design-url` | Agent spec only. The design page's link, as the first publish returned it. The builder puts it in each pull request's description (`Spec: <design-url>#spec`), so the review links to the spec. `https://` only. |

Both take one `# title`, the design's name, and neither leaves anything open: `TBD`, `TODO`, `FIXME` or `??` outside
code is an error. Neither points back at the page or the talk, which their readers never saw: the build warns on a
question number (`Q2`), "decided in v3", "as discussed", "the design page". Write the fact itself.

## The spec, for people

What will happen once it is built, so a reader knows at a glance. It is not a shorter agent spec: it leaves out the
files, the steps and the edge cases, and keeps what changes for whoever uses the thing.

- **Show the shape.** A `mermaid` diagram of what happens (mark what is new with `:::new`), the schemas and interfaces
  in code blocks, a table of cases. The page draws the diagram and highlights the code.
- **Say it plainly.** Short sentences, one idea each, in the words of whoever uses it: "When a client spends its
  budget, the API answers `429`," not the Lua script that decides it.
- **Stay high.** Each section is a few sentences beside its diagram, schema or table. The build warns past 500 words
  of prose, and when there is nothing to look at.

A shape that reads well, with the section names in the work's own words:

| Section | Holds |
|---|---|
| `# <title>` | Then one or two sentences: what it does once built, and why it matters. |
| `## What happens …` | A diagram of the flow, then what it means in a sentence or two. |
| `## <the data, the API, the config>` | The schemas, interfaces or config, each with a sentence on what it is for. |
| `## What <users, clients, operators> see` | The cases that matter to them, as a table. |
| `## How it ships` | The pull requests or phases, one line each. |
| `## Not in this change` | What a reader might expect and will not get, in a line. |

## The agent spec, for the builder

Everything a fresh agent needs to build it with the repository and nothing else, and to know it is done. In this
order; leave out a section with nothing in it, except the title and **Done when**. Work that is not code (a process,
a document, a migration plan) keeps the same order in its own nouns.

| Section | Holds |
|---|---|
| `# <title>` | Then one paragraph: what gets built, and what is true once it is. |
| `## Context` | What the builder needs and the repository does not say: the repository and base branch, the files and functions the work touches (linked at a fixed commit, as on the page), and each term it uses, defined. |
| `## Decisions` | Each decided fork as a fact: "Count with a token bucket, one per API key." No alternatives. A reason only when it limits the code: "Let the request through when Redis is slow: a Redis outage must never become an API outage." |
| `## Behavior` | What happens in each case: inputs, outputs, errors, the edge cases. A table of cases; a `mermaid` block when order matters. |
| `## Interfaces` | Types, signatures, schemas, config, endpoints and events, in code blocks, exact. |
| `## Work` | The pull requests in the order the design set: what each one adds or changes, which one it builds on, the tests it adds. |
| `## Out of scope` | What not to build, so the builder does not widen the task. |
| `## Done when` | Required. The checks that say the work is done, each one pass or fail: a command and what it prints, a request and its answer, a thing to see. |

Make it stand alone:

- Define each term at its first use, or link the code that defines it.
- Check that every path exists, or say the work creates it. Link code at a fixed commit. Every number is a decision:
  exact, not an example.
- Keep it as long as the decisions need. A figure from the page becomes a table, a `mermaid` block or a sentence.
- Read it as the builder before you publish it: with only this file and the repository, could you build it without
  asking? Each place you would ask is a missing fact.

The spec and the agent spec agree: every decision the spec shows is in the agent spec, and nothing in the agent spec
contradicts it.

## What stays on the design page

- The options not chosen, and why one won.
- The questions, their numbers and answers, and the version where anything changed.
- The figures and their narration, and the lede's case for the work.
- Anything said in the chat or a comment.

## When the design changes

The specs follow the design. A change to the design is a new version (with its `<t-amend>`, as always); bring both
specs up to it and set `design-version`, or move both aside while the design is open again. The build refuses a spec
for an older version. Moving them aside does not unpublish the agent spec: a file the Artifact tool published stays
until a publish removes it, so publish that version with `"agent-spec.md": null` in `files`. A fix to the specs alone
(a wrong path, a missing check) keeps the design's version.

## Hand it over

After the user's go:

1. Give the agent spec to a fresh agent, and nothing else from this conversation: a new session, or a subagent,
   whose whole prompt is the agent spec (the file's text, or, from another session, `Artifact` `read` of the design
   page's `url` with `path: "agent-spec.md"`). Add one line: put `Spec: <design-url>#spec` in each pull request's
   description.
2. Do not build it in the design session: its context holds the options the specs left out.
3. When the builder finds the agent spec wrong or short, fix it (and the spec, and the design when a decision
   changes), rebuild, republish, and hand it over again. A gap filled only in the builder's chat leaves the specs
   wrong for the review.
