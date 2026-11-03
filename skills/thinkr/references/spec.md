# The spec

The design page holds the reasoning: the options, the reader's answers, what changed in each version and why. An
agent that builds from all of that carries the rejected options and the back-and-forth into the code. The spec holds
only what to build. A fresh agent with the spec and the repository builds it end to end, with nothing else to read
and no question to ask back. [`../templates/spec.md`](../templates/spec.md) is a complete one, for the template
design (its repository is made up).

## When to write it

Once the design is decided: no question is left on the page, and the reader approved the current version. The build
refuses a spec beside an open question. A document with a decision still open is a design, not a spec.

## The file

Write `<name>.spec.md` beside `<name>.html`. The build finds it by that name, checks it, renders it into the page's
Spec view (the **Design | Spec** switch in the bar), and publishes it beside the page as `spec.md`, as written: the
`files` map the build prints holds it. A link to the page that ends in `#spec` opens on the spec.

```markdown
---
design-version: 3
design-url: https://claude.ai/code/artifact/…
---
# API Rate Limits

One paragraph: what gets built, and what is true once it is.

## Context
…
## Done when
…
```

| Front matter | Use |
|---|---|
| `design-version` | Required. The design version the spec implements: the page's `version`. The build refuses a spec for another version. |
| `design-url` | The design page's link, as the first publish returned it. The builder puts it in each pull request's description (`Spec: <design-url>#spec`), and guided-review links the review to the spec through it. `https://` only. |

## What it holds

In this order. Leave out a section with nothing in it, except the title and **Done when**. Work that is not code (a
process, a document, a migration plan) keeps the same order in its own nouns.

| Section | Holds |
|---|---|
| `# <title>` | The design's name, then one paragraph: what gets built, and what is true once it is. |
| `## Context` | What the builder needs and the repository does not say: the repository and base branch, the files and functions the work touches (linked at a fixed commit, as on the page), and each term it uses, defined. |
| `## Decisions` | Each decided fork as a fact: "Count with a token bucket, one per API key." No alternatives. A reason only when it limits the code: "Let the request through when Redis is slow: a Redis outage must never become an API outage." |
| `## Behavior` | What happens in each case: inputs, outputs, errors, the edge cases. A table of cases; a `mermaid` block when order matters (the page draws it; the builder reads its source). |
| `## Interfaces` | Types, signatures, schemas, config, endpoints and events, in code blocks, exact. |
| `## Work` | The pull requests in the order the design set: what each one adds or changes, which one it builds on, the tests it adds. |
| `## Out of scope` | What not to build, so the builder does not widen the task. |
| `## Done when` | Required. The checks that say the work is done, each one pass or fail: a command and what it prints, a request and its answer, a thing to see. |

## What stays on the design page

- The options not chosen, and why one won.
- The questions, their numbers and answers, and the version where anything changed.
- The figures and their narration, and the lede's case for the work.
- Anything said in the chat or a comment.

The build warns on words that point back at the page or the talk: a question number (`Q2`), "decided in v3", "as
discussed", "the design page". Write the fact itself.

## Make it stand alone

- Define each term at its first use, or link the code that defines it.
- Check that every path exists, or say the work creates it. Link code at a fixed commit. Every number is a decision:
  exact, not an example.
- Leave nothing open. `TBD`, `TODO`, `FIXME` or `??` outside code is an error: decide it in the design first.
- Keep it as long as the decisions need. A figure from the page becomes a table, a `mermaid` block or a sentence.
- Read it as the builder before you publish it: with only this file and the repository, could you build it without
  asking? Each place you would ask is a missing fact.

## When the design changes

The spec follows the design. A change to the design is a new version (with its `<t-amend>`, as always); bring the
spec up to it and set `design-version`, or move the file aside while the design is open again. The build refuses a
spec for an older version. Moving it aside does not unpublish it: a file the Artifact tool published stays until a
publish removes it, so publish that version with `"spec.md": null` in `files`. A fix to the spec alone (a wrong path, a missing check) keeps the design's version.

## Hand it over

After the user's go:

1. Give the spec to a fresh agent, and nothing else from this conversation: a new session, or a subagent, whose
   whole prompt is the spec (the file's text, or, from another session, `Artifact` `read` of the design page's `url`
   with `path: "spec.md"`). Add one line: put `Spec: <design-url>#spec` in each pull request's description.
2. Do not build it in the design session: its context holds the options the spec left out.
3. When the builder finds the spec wrong or short, fix the spec (and the design, when a decision changes), rebuild,
   republish, and hand it over again. A gap filled only in the builder's chat leaves the spec wrong for the review.
