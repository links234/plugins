# Several pull requests on one page

For a stack, or any set of pull requests the user wants reviewed together, make one guide per pull request and one
page for all of them.

1. **One folder per pull request,** `<work>/pr-<number>/`, and gather each against its own base. In a stack, a pull
   request's base is the branch of the one below it, so each diff holds only its own change:
   `gh pr view <number> --json baseRefName,headRefName` names both. Fetch every branch first. For someone else's
   pull requests, share one clone: `gather.ts --pr=<number> --checkout=<work>/checkout --out=<work>/pr-<number>/diff.json`
   for each, and read each pull request after you gather it, because the clone moves to the head gathered last. Pass
   `--repo=<work>/checkout` to the build. One clone holds one repository: gather refuses a pull request from another.
2. **Write each guide** in its folder, as for one pull request. Chapter ids need only be unique within a guide.
3. **Write `<work>/stack.json`** ([guide-format.md](guide-format.md#stackjson)): a `name` for the page
   and the pull requests in order, a stack from its base up, each as `{ "guide": "pr-140/guide.json", "diff":
   "pr-140/diff.json" }`.
4. **Build** in a checkout that has every head: `bun ${CLAUDE_SKILL_DIR}/scripts/build.ts --stack=<work>/stack.json`.
   Errors and warnings name their pull request. It writes `<work>/stack.artifact.html`,
   `<work>/stack.files/` and `<work>/stack.preview.html`, and prints the `files` map.
5. **Publish** `<work>/stack.artifact.html` once, as SKILL.md says for one pull request, with the stack's `name` as
   the `description`. When any pull request moves on, update its guide, rebuild and publish the same file: the link
   stays. A pull request that merged can stay in the stack, or leave it.

Links into the page pick the pull request: `<page>#pr141` opens on #141, `#pr141-c-<id>` at a chapter of it, and
`#pr141-diff` on its Diff tab.
