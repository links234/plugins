# plugins

Michael Assaf's skills for Claude, in one plugin, `snowmead`, from the marketplace `plugins`. Every skill runs
under the same prefix: `/snowmead:<skill>`.

| Skill | Run it | What it does |
|---|---|---|
| [thinkr](skills/thinkr) | `/snowmead:thinkr` | Turns a plan or an explanation into a clean, interactive page, published as a Claude Artifact. Plan pages ask you about the real forks and send your answers back to Claude; explainer pages teach with diagrams you step through, WebGPU figures and self-checks. Needs [Bun](https://bun.sh). |
| [guided-review](skills/guided-review) | `/snowmead:guided-review` | Turns a pull request (yours or someone else's), a branch, uncommitted local changes, or a stack of pull requests into a guided code review, published as a Claude Artifact: an overview with a diagram of the whole change, then the diff as short chapters, each explained beside its code under a diagram of what it changes, with review marks, a file tree and syntax-highlighted diffs. Comment on lines, files or the whole pull request in a margin beside the code, and send each comment to Claude at once or queue them to send together, to iterate on the code; each stays as a thread, held by a Claude agent of its own that answers and changes the code, to reply in, and is marked outdated when its code changes, and a bell lists the answers not read yet. Claude looks across the threads for a problem or a design choice several share, and settles it once. A stack's pull requests are picked from a menu in the title. Needs [Bun](https://bun.sh). |
| [changelog](skills/changelog) | `/snowmead:changelog` | Keeps a team changelog as a Claude Artifact: each run writes up the pull requests merged since the last entry (or in the last N days) as features with animated scenes and PR links, and posts a summary to Slack. Runs the same by hand or on a schedule. Needs [Bun](https://bun.sh) and the GitHub CLI. |
| [rust](skills/rust) | `/snowmead:rust` | Effective Rust: defaults for reading and writing Rust, from the toolchain and module layout to types, conversions, ownership, unsafe code and tests, with standard-library and nightly references. |
| [review](skills/review) | `/snowmead:review` | A Claude code review, on the Claude Agent SDK: one agent per lens (bugs, security, tests, design, docs, and any a repository adds), a skeptic that tries to refute each finding, and an editor. Locally it reviews the branch you are on, uncommitted changes included, and writes a Markdown report; as a GitHub Action it posts one review of inline comments and a summary in the description on each push. The skill also adds it to a repository and tunes its rules and settings. Needs [Bun](https://bun.sh), and a Claude sign-in, subscription token, or Anthropic API key. |

## Install

### Claude Code

Add the marketplace once, then install the plugin:

```
/plugin marketplace add snowmead/plugins
/plugin install snowmead@plugins
```

Or add and install in one step (Claude Code 2.1.275 or later):

```
/plugin install snowmead --marketplace snowmead/plugins
```

From your shell: `claude plugin marketplace add snowmead/plugins`, then `claude plugin install snowmead@plugins`.

Updates: `/plugin marketplace update plugins`, or turn on auto-update for the marketplace under `/plugin` →
Marketplaces. The plugin updates when its `version` changes.

Coming from the old one-skill plugins (`thinkr`, `guided-review`, `changelog`, `e-rust`)? Uninstall them, for example
`/plugin uninstall thinkr@plugins`, so each skill shows up once.

### Other agents, or as plain skills

With the [skills](https://skills.sh) CLI, which installs into Claude Code, Codex, Cursor and other agents:

```sh
npx skills add snowmead/plugins                  # choose from all
npx skills add snowmead/plugins --skill thinkr   # one skill
npx skills add snowmead/plugins --skill rust -g  # every project
```

## Layout

The repository root is the plugin `snowmead`, and each folder in `skills/` is one of its skills:

```
.claude-plugin/marketplace.json   the marketplace "plugins", listing the one plugin
.claude-plugin/plugin.json        plugin snowmead: name, version, metadata
skills/thinkr/                    skill thinkr  (SKILL.md, …)
skills/guided-review/             skill guided-review  (SKILL.md, …)
skills/changelog/                 skill changelog  (SKILL.md, …)
skills/rust/                      skill rust  (SKILL.md, references/)
skills/review/                    skill review  (SKILL.md, action.yml, its Rust program, engine/)
kit/                              what the Artifact skills share (see kit/README.md)
```

thinkr, guided-review and changelog share one look, one sound kit and one set of build and test helpers through
[`kit/`](kit). Each links it as `skills/<skill>/kit -> ../../kit`, so the skill works on its own too: `npx skills`
copies the link in as real files. When `kit/` changes, test every skill that links it and bump the plugin's version.

To add a skill: create `skills/<skill>/` with `SKILL.md` (it runs as `/snowmead:<skill>`), name it in the
descriptions in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, and check it. A skill that builds
an Artifact page links the kit too (`ln -s ../../kit skills/<skill>/kit`).

The review skill is also this repository's CI: `.github/workflows/review-skill.yml` checks it (its engine's types and
tests, its Rust program and its crates' advisories), and `.github/workflows/claude-review.yml` reviews each pull request
here with the action as the base branch has it.

```sh
claude plugin validate --strict . && claude plugin validate --strict .claude-plugin/plugin.json
claude --plugin-dir . plugin details snowmead   # lists the skills it loads
# claude.ai keeps 1024 characters of a skill's description and warns on each sync past that; validate does not check it
awk '/^description: /{n=length($0)-13; if(n>1024){print FILENAME": description is "n" characters"; bad=1}} END{exit bad}' skills/*/SKILL.md
```

**Release:** bump `version` in `.claude-plugin/plugin.json` (installed copies update only when it changes),
validate, commit, then tag with `claude plugin tag . --push` (tags look like `snowmead--v0.2.0`).

## License

Apache-2.0 (`LICENSE`). Third-party parts keep their own licenses, listed in each skill's `NOTICE`.
