#!/usr/bin/env bun
/* Regression test, in two parts. Run it after changing anything in scripts/ or runtime/.

     bun scripts/test.ts        # needs git, Chrome and the network; set CHROME when it is not in a usual place

   1. scripts: gather.ts and build.ts against a scratch repository: the diff GitHub shows, kinds, scope labels,
      emptied, deleted, renamed, binary and moved code, refs, escaping, and every check that refuses a guide. Then a
      snapshot of a working tree, and a pull request read from a stand-in for GitHub.
   2. page: builds the demo (scripts/demo.ts) and drives it in headless Chrome over DevTools: what the reader sees
      after each action, review comments (the gutter's "+" dragged with real mouse events, the margin, the sends, the
      threads sent comments leave, outdated ones, and the page database through a stand-in for the viewer), no
      console errors, and timing budgets (boot ≤ 30 ms, each interaction ≤ 12 ms, a redraw of the cards on screen ≤
      one frame). */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Diff, DiffFile, Guide } from '../runtime/types';
import { buildDemo, buildStack as buildStackDemo, git } from './demo';
import { browser, findChrome, themeChecks } from '../kit/build/chrome';

const ROOT = join(import.meta.dir, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) return;
  failed++;
  console.log(`fail  ${name}${detail ? `\n      ${detail.split('\n').join('\n      ')}` : ''}`);
};
const same = (name: string, got: unknown, want: unknown) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `expected ${JSON.stringify(want)}\n got      ${JSON.stringify(got)}`);

// ---------------------------------------------------------------- 1. scripts
const tmp = mkdtempSync(join(tmpdir(), 'guided-review-test-'));
const repo = join(tmp, 'repo');
mkdirSync(repo);
const put = (path: string, text: string | Uint8Array) => { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); };
const read = (path: string) => readFileSync(join(repo, path), 'utf8');
const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';
const bun = (script: string, args: string[], cwd = repo, env?: Record<string, string>) => {
  const p = Bun.spawnSync(['bun', join(ROOT, 'scripts', script), ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  return { status: p.exitCode, log: p.stdout.toString() + p.stderr.toString() };
};

// main: Rust files to change, empty, delete, rename and move code out of, notes with a fenced block, and a README
// the pull request leaves alone.
const MOVED = `fn moves() {
    let first_value_with_a_long_name = compute_the_first_thing();
    let second_value_with_a_long_name = compute_the_second_thing();
    let third = combine(first_value_with_a_long_name, second_value_with_a_long_name);
}
`;
git(repo, 'init', '-q', '-b', 'main');
put('src/a.rs', `fn one() {\n${lines(20, (i) => `    let x${i} = ${i};`)}}\n\nfn two() {\n${lines(20, (i) => `    let y${i} = ${i};`)}}\n`);
put('src/gone.rs', 'fn gone() {\n    1\n}\n');
put('src/old.rs', 'fn old() {\n    2\n}\n');
put('src/r.rs', `fn renamed() {\n${lines(10, (i) => `    let r${i} = ${i};`)}}\n`);
put('src/m.rs', `fn stays() {\n    let s = 0;\n}\n\n${MOVED}`);
put('src/tail.rs', 'impl Foo {\n    fn keep(&self) {\n        let a = 1;\n    }\n\n    fn trim(&self) {\n        let b = 2;\n        let c = 3;\n        let d = 4;\n    }\n}\n');
put('docs/notes.md', '# Notes\n\n## Setup\n\n```sh\n# install\njust up\n```\n\nSome text.\n');
put('README.md', '# Scratch\n\nA repository for the tests.\n');
// A PNG's first bytes are enough for the page to embed it.
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
put('docs/logo.png', LOGO);
git(repo, 'add', '-A');
git(repo, 'commit', '-qm', 'base');
const branchPoint = git(repo, 'rev-parse', 'HEAD').trim();

// The pull request: a change in each function of a.rs, an emptied file, a deleted one, a renamed one with an edit,
// a block moved to a new file, a method's tail removed, a line below a fenced block, and new files of each kind.
git(repo, 'checkout', '-qb', 'pr');
put('src/a.rs', read('src/a.rs').replace('let x10 = 10;', 'let x10 = 100;').replace('let y10 = 10;', 'let y10 = 100;'));
put('src/gone.rs', '');
git(repo, 'rm', '-q', 'src/old.rs');
git(repo, 'mv', 'src/r.rs', 'src/r2.rs');
put('src/r2.rs', read('src/r2.rs').replace('let r5 = 5;', 'let r5 = 50;'));
put('src/m.rs', read('src/m.rs').replace(`\n${MOVED}`, ''));
put('src/n.rs', MOVED);
put('src/tail.rs', read('src/tail.rs').replace('        let c = 3;\n        let d = 4;\n', ''));
put('docs/notes.md', read('docs/notes.md').replace('Some text.', 'Some more text.'));
// A new page of docs with what a preview must render, rewrite or drop.
put('docs/guide.md', [
  '---', 'title: Guide', 'owner: docs', '---', '',
  '# Guide', '',
  'See [the readme](../README.md) and [setup](#setup). <script>alert(1)</script>', '',
  '<img src=x onerror=alert(1)> [bad](javascript:alert(1)) <b onclick="alert(1)">bold</b>', '',
  '![logo](logo.png) ![badge](https://img.example.com/b.svg)', '',
  '- [x] done', '- [ ] open', '',
  '> [!NOTE]', '> Read this.', '',
  '## Setup', '',
  '<iframe src="https://example.com"></iframe>', '',
].join('\n'));
put('tests/a_test.rs', '#[test]\nfn works() {}\n// </script><img src=x onerror=alert(1)>\n');
put('migrations/0001_init.sql', 'create table t (id int);\n');
put('api/schema.gen.ts', 'export type T = { id: number };\n');
put('assets/logo.bin', new Uint8Array([0, 1, 2, 255, 0, 3]));
git(repo, 'add', '-A');
git(repo, 'commit', '-qm', 'change');
// main moves on after the branch point; the pull request's diff leaves that out.
git(repo, 'checkout', '-q', 'main');
put('later.txt', 'landed on main later\n');
git(repo, 'add', '-A');
git(repo, 'commit', '-qm', 'later');
git(repo, 'checkout', '-q', 'pr');

const diffPath = join(tmp, 'diff.json');
const gathered = bun('gather.ts', ['--base', 'main', '--head=pr', `--out=${diffPath}`, '--quiet'], join(repo, 'src'));
check('gather runs from a subfolder', gathered.status === 0, gathered.log);
const diff: Diff = gathered.status === 0 ? JSON.parse(readFileSync(diffPath, 'utf8')) : ({ files: [] } as unknown as Diff);
const file = (path: string) => diff.files.find((f) => f.path === path) ?? ({ hunks: [], moves: [] } as unknown as DiffFile);

same('gather diffs from the merge base', diff.base, branchPoint);
same('gather sorts every changed file by kind', Object.fromEntries(diff.files.map((f) => [f.path, f.kind]).sort()), {
  'api/schema.gen.ts': 'generated', 'assets/logo.bin': 'core', 'docs/guide.md': 'docs', 'docs/notes.md': 'docs', 'migrations/0001_init.sql': 'database',
  'src/a.rs': 'core', 'src/gone.rs': 'core', 'src/m.rs': 'core', 'src/n.rs': 'core', 'src/old.rs': 'core', 'src/r2.rs': 'core',
  'src/tail.rs': 'core', 'tests/a_test.rs': 'tests',
});
same('gather labels each hunk with its scope', file('src/a.rs').hunks.map((h) => h.label), ['fn one() {', 'fn two() {']);
// The line left where a method's tail was removed is its closing brace, outside the method.
same('a removed tail keeps its method as the label', file('src/tail.rs').hunks.map((h) => h.label), ['fn trim(&self) {']);
// A comment inside a fenced block is not a heading.
same('a fenced comment is not a heading', file('docs/notes.md').hunks.map((h) => h.label), ['## Setup']);
const gone = file('src/gone.rs'), old = file('src/old.rs'), renamed = file('src/r2.rs'), bin = file('assets/logo.bin');
same('an emptied file stays modified', [gone.status, gone.newCount, gone.del], ['modified', 0, 3]);
same('a deleted file keeps its old text', [old.status, old.old, old.hunks.length], ['deleted', ['fn old() {', '    2', '}'], 1]);
same('a renamed file keeps its old path', [renamed.status, renamed.oldPath, renamed.add, renamed.del], ['renamed', 'src/r.rs', 1, 1]);
same('a binary file has no hunks', [bin.binary, bin.hunks.length], [true, 0]);
const pick = ({ side, from, to, other, otherFrom }: DiffFile['moves'][number]) => ({ side, from, to, other, otherFrom });
same('moved code is marked where it left', file('src/m.rs').moves.map(pick), [{ side: '-', from: 5, to: 9, other: 'src/n.rs', otherFrom: 1 }]);
same('moved code is marked where it landed', file('src/n.rs').moves.map(pick), [{ side: '+', from: 1, to: 5, other: 'src/m.rs', otherFrom: 5 }]);

// A guide that places every file and hunk, with refs written into its first chapter, and a diagram in each section.
const dia = (what: string) => ({ title: what, mermaid: `flowchart LR\n  A[before] --> B[${what}]:::new` });
const later: Guide['chapters'] = [
  { id: 'notes', title: 'The notes', kind: 'docs', body: ['Notes.'], diagram: dia('notes'), files: ['docs/notes.md', 'docs/guide.md'] },
  { id: 'db', title: 'A table', kind: 'database', body: ['A table.'], diagram: dia('a table'), files: ['migrations/0001_init.sql'] },
  { id: 'tests', title: 'A test', kind: 'tests', body: ['A test.'], diagram: dia('a test'), files: ['tests/a_test.rs'] },
  { id: 'gen', title: 'The schema', kind: 'generated', body: ['Generated.'], diagram: dia('the schema'), files: ['api/schema.gen.ts'] },
];
const rest = ['src/gone.rs', 'src/old.rs', 'src/r2.rs', 'src/m.rs', 'src/n.rs', 'src/tail.rs', 'assets/logo.bin'];
const guideFor = (body: string, chapters?: Guide['chapters']): Guide => ({
  pr: { number: 1, title: 'Scratch <change> & "more"', url: 'https://github.com/example/scratch/pull/1' },
  overview: { summary: 'Changes two values.', diagram: { ...dia('one sets x10'), refs: { B: 'src/a.rs:11' } } },
  chapters: chapters ?? [
    { id: 'one', title: 'The first value', body: [body], diagram: dia('the first value'), files: [{ path: 'src/a.rs', hunks: [1] }, ...rest] },
    { id: 'two', title: 'The second value', body: ['`two` changes too.'], diagram: dia('the second value'), files: [{ path: 'src/a.rs', hunks: [2] }] },
    ...later,
  ],
});
/** A built page and the data file it loads from <stem>.files/. */
function page(stem: string) {
  const dir = join(tmp, `${stem}.files`), data = readdirSync(dir).find((f) => f.startsWith('data.'))!;
  return { html: readFileSync(join(tmp, `${stem}.artifact.html`), 'utf8'), data: readFileSync(join(dir, data), 'utf8') };
}
function build(guide: unknown) {
  const guidePath = join(tmp, 'guide.json');
  writeFileSync(guidePath, JSON.stringify(guide));
  rmSync(join(tmp, 'guide.artifact.html'), { force: true });
  const r = bun('build.ts', [`--diff=${diffPath}`, `--guide=${guidePath}`]);
  return { ...r, ...(r.status === 0 ? page('guide') : { html: '', data: '' }) };
}

const built = build(guideFor('See [the readme](ref:README.md:3), [the old file](ref:src/old.rs:2) and **`x10`** in `handlers[i](ctx)`.'));
check('build writes a page for a guide that places every hunk once', built.status === 0, built.log);
// A file the pull request does not change links to GitHub at the head commit; a deleted one jumps to its old side.
check('an unchanged file links to GitHub at the head', built.html.includes(`href="https://github.com/example/scratch/blob/${diff.head}/README.md#L3"`));
check('a deleted file jumps to its old side', /data-ref="src\/old\.rs" data-line="2" data-side="o"/.test(built.html));
// Code spans stay code: inside bold, and when they look like a link.
check('code inside bold stays code', built.html.includes('<b><code>x10</code></b>'));
check('code that looks like a link stays code', built.html.includes('<code>handlers[i](ctx)</code>'));
check('the title is escaped', built.html.includes('<h1>Scratch &lt;change&gt; &amp; &quot;more&quot;</h1>'));
// The diff's own `</script>` line reaches the page as text, from the data file.
const data = /^window\.GR_DATA = (.*);\n$/s.exec(built.data)?.[1];
check('the data file holds the diff as it is', !!data && JSON.parse(data).prs[0].files.find((f: DiffFile) => f.path === 'tests/a_test.rs').new.includes('// </script><img src=x onerror=alert(1)>'));
// Markdown files are rendered at build: each block with its lines, sanitized, with the change marked.
const files = data ? JSON.parse(data).prs[0].files as DiffFile[] : [];
const notes = files.find((f) => f.path === 'docs/notes.md')?.preview, mdGuide = files.find((f) => f.path === 'docs/guide.md')?.preview;
same('a Markdown file renders as blocks, each with its lines', notes?.blocks.map((b) => [b.a, b.b, b.html.slice(0, 4)]), [[1, 1, '<h1 '], [3, 3, '<h2 '], [5, 8, '<pre'], [10, 10, '<p>S']]);
same('a reworded block is changed, with its words marked', notes?.rows.map((r) => r.mark + (r.html?.includes('<ins>more</ins>') ? ' ins' : '')), ['same', 'same', 'same', 'changed ins']);
same('a changed block names its hunk', notes?.rows.at(-1)?.hunks, [1]);
const g = mdGuide?.blocks.map((b) => b.html).join('\n') ?? '';
check('a preview drops scripts, frames, handlers and javascript: links', !!g && !/<script|<iframe|onerror|onclick|href="javascript:/i.test(g), g);
check('front matter shows as a table of its keys', mdGuide?.blocks[0]?.a === 1 && mdGuide.blocks[0].b === 4 && /class="gr-md-front".*<th>title<\/th>.*<td>Guide<\/td>/.test(mdGuide.blocks[0].html), mdGuide?.blocks[0]?.html);
check('a link to a file of the repository goes to GitHub at the head', g.includes(`href="https://github.com/example/scratch/blob/${diff.head}/README.md" target="_blank"`), g);
check('a link to a heading of the same file stays in the page', g.includes('data-md-anchor="setup"') && g.includes('<h2 data-md-id="setup">Setup</h2>'), g);
check('an image of the repository is embedded from git', g.includes(`src="data:image/png;base64,${Buffer.from(LOGO).toString('base64')}"`), g);
check('an image from another host shows as a link to it', /<a href="https:\/\/img\.example\.com\/b\.svg"[^>]*>badge<\/a>/.test(g), g);
check('task lists and alerts render as GitHub does', g.includes('<input type="checkbox" disabled checked> done') && g.includes('<div class="gr-md-alert is-note"><p class="gr-md-alert-t">Note</p>'), g);
same('an added file is added, block by block', mdGuide?.rows.every((r) => r.mark === 'added' && r.n != null), true);

// A read of the published page returns at most 50,000 characters, so the page holds only its markup.
check('the page holds only its markup; Geist, styles, runtime and data load beside it', built.html.includes('fonts.googleapis.com/css2?family=Geist')
  && !built.html.includes('base64') && !built.html.includes('<style')
  && ['guided-review.css', 'data.js', 'guided-review.js'].every((f) => new RegExp(`(href|src)="guide\\.files/${f.replace(/\.(\w+)$/, '\\.[0-9a-f]{8}\\.$1')}"`).test(built.html)));
check('the libraries are preloaded at exact versions', /<link rel="modulepreload" href="https:\/\/cdn\.jsdelivr\.net\/npm\/@pierre\/diffs@\d+\.\d+\.\d+[^"]*"/.test(built.html));
// Diagrams are drawn at build: the page keeps an empty box per section, and the drawings ride in the data file.
check('the page loads no diagram library and keeps no mermaid block, which the viewer would draw', !/mermaid|pele@/.test(built.html));
same('each section has a box for its diagram', [...built.html.matchAll(/<div class="k-dia" data-dia="([^"]+)">/g)].map((m) => m[1]), ['overview', 'c-one', 'c-two', 'c-notes', 'c-db', 'c-tests', 'c-gen']);
const drawn = data ? JSON.parse(data).prs[0].diagrams : {};
check('a diagram is drawn into SVG in the kit\'s colors, with its marks', /<svg [^>]*class="pele pele-flowchart"/.test(drawn.overview?.html ?? '') && /class="pele-node [^"]*\bnew" data-id="B"/.test(drawn.overview?.html ?? ''), drawn.overview?.html?.slice(0, 300));
same('a node\'s ref names its line and its chapter', drawn.overview?.refs, { B: { path: 'src/a.rs', line: 11, side: 'n', ch: 'one', title: 'a.rs 11, chapter 01: The first value' } });
const outside = build({ ...guideFor('One.'), overview: { summary: 'S.', diagram: { ...dia('x'), refs: { A: 'README.md:3' } } } });
same('a node\'s ref to a file the pull request does not change goes to GitHub', JSON.parse(/^window\.GR_DATA = (.*);\n$/s.exec(outside.data)?.[1] ?? '{"prs":[{}]}').prs[0].diagrams?.overview?.refs,
  { A: { path: 'README.md', line: 3, url: `https://github.com/example/scratch/blob/${diff.head}/README.md#L3`, title: 'README.md 3, on GitHub' } });
check('the diagram\'s key names the marks it uses', /<span class="gr-dia-keys"><span class="gr-dia-key is-new">New<\/span><\/span>/.test(built.html));
check('the title comes first, as a short name', built.html.startsWith('<title>Guided review #1</title>'));

const branchOnly = build({ ...guideFor('One.'), pr: { title: 'A branch with no pull request' } });
const splitGuide = build({ ...guideFor('One.'), diffStyle: 'split' });
check('a guide can start in split', splitGuide.status === 0 && splitGuide.data.includes('"diffStyle":"split"') && splitGuide.html.includes('data-diff-style="split" aria-pressed="true"'), splitGuide.log);
check('a branch with no pull request builds', branchOnly.status === 0 && !branchOnly.html.includes('Open #') && branchOnly.html.startsWith('<title>Review of pr</title>'), branchOnly.log);
const named = build({ ...guideFor('One.'), name: 'Scratch values review' });
check('a guide names its page', named.html.startsWith('<title>Scratch values review</title>'), named.log);
// the spec the change was built from: its design page, opened on the Spec view, in the bar and the header
const specced = build({ ...guideFor('One.'), spec: { url: 'https://claude.ai/code/artifact/0a1b', version: 3 } });
check('a guide links the spec it was built from', specced.status === 0
  && specced.html.includes('<a class="k-btn is-sm" href="https://claude.ai/code/artifact/0a1b#spec" target="_blank" rel="noopener" title="The spec this change was built from">Spec')
  && specced.html.includes('built from <a href="https://claude.ai/code/artifact/0a1b#spec" target="_blank" rel="noopener">its spec, design v3</a>'), specced.log);

const refusals: [string, unknown, RegExp][] = [
  ['a hunk in no chapter', guideFor('One.', [
    { id: 'one', title: 'The first value', body: ['One.'], diagram: dia('one'), files: [{ path: 'src/a.rs', hunks: [1] }, ...rest] },
    ...later,
  ]), /src\/a\.rs hunk 2 .* is in no chapter/],
  ['a ref past the end of a file', guideFor('See [it](ref:src/a.rs:999).'), /past the end of the file/],
  ['a ref to a file that does not exist', guideFor('See [it](ref:src/missing.rs:1).'), /neither in this pull request nor at its head/],
  ['a core chapter after a tests chapter', guideFor('One.', [
    later[0], later[2],
    { id: 'one', title: 'The values', body: ['One.'], diagram: dia('the values'), files: ['src/a.rs', ...rest] },
    later[1], later[3],
  ]), /\(one\): a core chapter comes after a database, tests or generated chapter/],
  ['a link that is not https', guideFor('See [it](javascript:alert(1)).'), /must start with https:\/\/ or ref:/],
  ['a links entry that is not https', { ...guideFor('One.'), links: [{ label: 'It', href: 'javascript:alert(1)' }] }, /links\[0\]: href must start with https:\/\//],
  ['a spec link that is not https', { ...guideFor('One.'), spec: { url: 'javascript:alert(1)' } }, /spec\.url is the design page's link/],
  ['a pull request number without its url', { ...guideFor('One.'), pr: { number: 1, title: 'T' } }, /pr needs both number and url/],
  ['a name that is a sentence', { ...guideFor('One.'), name: 'A guided review of the scratch values change' }, /name is the page's name in the gallery/],
  ['a diff style that is neither unified nor split', { ...guideFor('One.'), diffStyle: 'side-by-side' }, /diffStyle must be "unified" or "split"/],
  ['a chapter without a diagram', guideFor('One.', [
    { id: 'one', title: 'The first value', body: ['One.'], diagram: dia('one'), files: [{ path: 'src/a.rs', hunks: [1] }, ...rest] },
    { id: 'two', title: 'The second value', body: ['Two.'], files: [{ path: 'src/a.rs', hunks: [2] }] } as Guide['chapters'][number],
    ...later,
  ]), /chapters\[1\]\.diagram is missing/],
  ['a before / after, which a diagram replaced', { ...guideFor('One.'), overview: { summary: 'S.', beforeAfter: { lines: [{ t: 'x' }] } } }, /overview\.beforeAfter is gone/],
  ['a diagram pele cannot read', { ...guideFor('One.'), overview: { summary: 'S.', diagram: { mermaid: 'flowchart LR\n  A[x --> B' } } }, /overview\.diagram\.mermaid: Parse error on line \d/],
  ['a ref to a node the diagram does not have', { ...guideFor('One.'), overview: { summary: 'S.', diagram: { ...dia('x'), refs: { Z: 'src/a.rs:11' } } } }, /overview\.diagram\.refs\.Z: the diagram has no node "Z"\. Its nodes: A, B/],
];
for (const [name, guide, message] of refusals) {
  const r = build(guide);
  check(`build refuses ${name}`, r.status === 1 && message.test(r.log), r.log);
}

// Several pull requests on one page: a stack.json lists each guide with its diff.
function buildStack(guides: unknown[]) {
  const prs = guides.map((g, i) => { writeFileSync(join(tmp, `g${i}.json`), JSON.stringify(g)); return { guide: `g${i}.json`, diff: 'diff.json' }; });
  const stackPath = join(tmp, 'stack.json');
  writeFileSync(stackPath, JSON.stringify({ prs }));
  rmSync(join(tmp, 'stack.artifact.html'), { force: true });
  const r = bun('build.ts', [`--stack=${stackPath}`]);
  return { ...r, ...(r.status === 0 ? page('stack') : { html: '', data: '' }) };
}
const second = { ...guideFor('Two.'), pr: { number: 2, title: 'The same change, again', url: 'https://github.com/example/scratch/pull/2' } };
const pair = buildStack([guideFor('One.'), second]);
check('a stack of two pull requests builds', pair.status === 0, pair.log);
check('each pull request gets its own panel and ids', pair.html.includes('id="pr1-c-one"') && pair.html.includes('id="pr2-c-one"') && pair.html.includes('id="pr1-overview"'));
check('the title becomes a menu of them', (pair.html.match(/class="gr-pick-item"/g) ?? []).length === 4 && pair.html.includes('2 pull requests'));
check('a stack page is named by its pull requests', pair.html.startsWith('<title>Guided review #1–#2</title>'));
check('the page data lists both', !!pair.data.match(/"prs":\[\{"id":"pr1"/) && pair.data.includes('"id":"pr2"'));
const twice = buildStack([guideFor('One.'), guideFor('One.')]);
check('build refuses a stack that lists a pull request twice', twice.status === 1 && /lists #1 2 times/.test(twice.log), twice.log);
const tagged = buildStack([guideFor('One.'), { ...second, chapters: second.chapters.slice(1) }]);
check('a stack\'s errors name their pull request', tagged.status === 1 && /error #2: src\/a\.rs hunk 1 .* is in no chapter/.test(tagged.log), tagged.log);

// A working tree. Signing fails here, so a snapshot that tried to sign would fail too: on the machines this runs on,
// a signature waits for a touch on a hardware key.
const tree = join(tmp, 'tree');
mkdirSync(join(tree, 'src'), { recursive: true });
const putT = (path: string, text: string) => writeFileSync(join(tree, path), text);
const commitT = (message: string) => { git(tree, 'add', '-A'); git(tree, 'commit', '-qm', message); return git(tree, 'rev-parse', 'HEAD').trim(); };
git(tree, 'init', '-q', '-b', 'main');
git(tree, 'remote', 'add', 'origin', 'https://github.com/example/tree.git');
git(tree, 'config', 'commit.gpgsign', 'true');
git(tree, 'config', 'gpg.program', 'false');
putT('.gitignore', '*.log\n');
putT('README.md', '# Tree\n\nSee [the code](src/a.rs).\n');
putT('src/a.rs', 'fn a() {\n    1\n}\n');
putT('src/c.rs', 'fn c() {\n    3\n}\n');
commitT('base');
git(tree, 'checkout', '-qb', 'work');
putT('src/b.rs', 'fn b() {\n    2\n}\n');
const treeTip = commitT('a commit on the branch');
putT('src/a.rs', 'fn a() {\n    10\n}\n'); // changed, not staged
putT('src/s.rs', 'fn s() {}\n');
git(tree, 'add', 'src/s.rs'); // new, staged
putT('src/new.rs', 'fn new() {}\n'); // new, untracked
putT('README.md', '# Tree\n\nSee [the code](src/a.rs), now.\n');
putT('debug.log', 'ignored\n');
putT('secret.txt', 'left out\n');
const treeState = () => [git(tree, 'status', '--porcelain=v1'), git(tree, 'diff', '--cached', '--name-only'), git(tree, 'for-each-ref'), git(tree, 'stash', 'list')];
const before = treeState();
const treeDiffPath = join(tmp, 'tree.json');
const gatherTree = (...args: string[]) => {
  const r = bun('gather.ts', [...args, `--out=${treeDiffPath}`], tree);
  return { ...r, diff: (r.status === 0 ? JSON.parse(readFileSync(treeDiffPath, 'utf8')) : { files: [] }) as Diff };
};
const paths = (d: Diff) => d.files.map((f) => f.path).sort();
const alone = gatherTree('--base=HEAD', '--worktree', '--exclude=secret.txt');
check('a snapshot gathers', alone.status === 0, alone.log);
same('a snapshot holds staged, unstaged and untracked changes, and no ignored or excluded file', paths(alone.diff), ['README.md', 'src/a.rs', 'src/new.rs', 'src/s.rs']);
same('a snapshot sits on HEAD', [alone.diff.snapshotOf, alone.diff.base], [treeTip, treeTip]);
same('a snapshot is in no commit list', alone.diff.commits, []);
same('uncommitted changes read as sitting on their branch', [alone.diff.baseRef, alone.diff.branch], ['work', 'uncommitted changes']);
same('a snapshot leaves the index, the files and the refs as they were', treeState(), before);
check('the outline marks untracked files', /src\/new\.rs  added  \+1 -0  untracked/.test(alone.log), alone.log);
same('the same files give the same snapshot', gatherTree('--base=HEAD', '--worktree', '--exclude=secret.txt').diff.head, alone.diff.head);
const keptPath = join(tmp, 'kept.json');
const keptOut = (...args: string[]) => {
  const r = bun('gather.ts', ['--base=HEAD', '--worktree', ...args, `--out=${keptPath}`], tree);
  return { ...r, diff: JSON.parse(readFileSync(keptPath, 'utf8')) as Diff };
};
const leftOut = keptOut('--exclude=secret.txt', '--exclude=src/a.rs');
same('an excluded tracked file stays as committed', paths(leftOut.diff), ['README.md', 'src/new.rs', 'src/s.rs']);
check('the outline names what was left out', leftOut.log.includes('Left out: secret.txt, src/a.rs.'), leftOut.log);
same('a path left out stays out when gather writes the same diff.json again', paths(keptOut().diff), ['README.md', 'src/new.rs', 'src/s.rs']);
const whole = gatherTree('--base=main', '--worktree', '--exclude=secret.txt');
same('against a branch, a snapshot adds to what is committed', paths(whole.diff), ['README.md', 'src/a.rs', 'src/b.rs', 'src/new.rs', 'src/s.rs']);
same('against a branch, the commits are the real ones', whole.diff.commits.map((c) => c.subject), ['a commit on the branch']);
same('against a branch, the page keeps its names', [whole.diff.baseRef, whole.diff.branch], ['main', 'work']);

const treeGuide = (pr: Guide['pr'], body = 'One.'): Guide => ({
  pr, name: 'Local values review', overview: { summary: 'Changes a value.', diagram: dia('one') },
  chapters: [{ id: 'all', title: 'All of it', body: [body], diagram: dia('all of it'), files: ['src/a.rs', 'src/new.rs', 'src/s.rs', 'README.md'] }],
});
const buildTree = (guide: Guide, stem: string) => {
  const guidePath = join(tmp, `${stem}.guide.json`);
  writeFileSync(guidePath, JSON.stringify(guide));
  return bun('build.ts', [`--diff=${treeDiffPath}`, `--guide=${guidePath}`, `--out=${join(tmp, stem)}`], tree);
};
gatherTree('--base=HEAD', '--worktree', '--exclude=secret.txt');
const local = buildTree(treeGuide({ title: 'A local change' }, 'See [the rest](ref:src/c.rs:2).'), 'tree');
check('a snapshot builds', local.status === 0, local.log);
const localPage = local.status === 0 ? page('tree') : { html: '', data: '' };
check('a snapshot says what it was written for, with no link GitHub cannot serve', localPage.html.includes(`uncommitted changes on <span class="mono">${treeTip.slice(0, 7)}</span>`) && !localPage.html.includes('/commit/'));
check('a ref to an unchanged file links to the base', localPage.html.includes(`https://github.com/example/tree/blob/${treeTip}/src/c.rs#L2`), localPage.html);
check('a Markdown link names the base, not the snapshot', localPage.data.includes(`https://github.com/example/tree/blob/${treeTip}/src/a.rs`) && !localPage.data.includes(`/blob/${alone.diff.head}`));
check('the page knows a send is on uncommitted changes', localPage.data.includes('"mode":"uncommitted"'));
check('a thread\'s link to an unchanged file names the base, not the snapshot', localPage.data.includes(`"blob":"https://github.com/example/tree/blob/${treeTip}/"`));
const owned = buildTree(treeGuide({ title: 'A local change', readOnly: true }), 'owned');
check('build refuses a read-only snapshot', owned.status === 1 && /pr\.readOnly is for someone else/.test(owned.log), owned.log);
const clean = bun('gather.ts', ['--base=HEAD', '--worktree', `--out=${join(tmp, 'clean.json')}`]);
check('a clean working tree has nothing to review', clean.status === 1 && /nothing to review/.test(clean.log), clean.log);
const contradict = bun('gather.ts', ['--worktree', '--head=pr']);
check('gather refuses --worktree with --head', contradict.status === 1 && /takes no --head/.test(contradict.log), contradict.log);

// Someone else's pull request. GitHub is a bare repository, with the ref it keeps for pull requests, and a gh that
// knows one pull request. gather runs in another project's checkout, which it must not touch.
const remote = join(tmp, 'remote.git');
git(tmp, 'clone', '-q', '--bare', repo, remote);
git(remote, 'config', 'uploadpack.allowFilter', 'true');
git(remote, 'update-ref', 'refs/pull/7/head', 'refs/heads/pr');
const tools = join(tmp, 'tools');
mkdirSync(tools);
writeFileSync(join(tools, 'gh'), `#!/bin/sh
[ "$3" = "404" ] && { echo 'no pull requests found' >&2; exit 1; }
echo '{"number":7,"url":"https://github.com/someone/else/pull/7","title":"Their change","author":{"login":"alice"},"baseRefName":"main","headRefName":"pr"}'
`, { mode: 0o755 });
const github = { PATH: `${tools}:${process.env.PATH}`, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${remote}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/someone/else.git' };
const prPath = join(tmp, 'theirs', 'diff.json'), prClone = join(tmp, 'theirs', 'checkout');
mkdirSync(dirname(prPath));
const gatherPr = (...args: string[]) => bun('gather.ts', [...args, `--out=${prPath}`], tree, github);
const beforePr = treeState();
const theirs = gatherPr('--pr=https://github.com/someone/else/pull/7');
check('gather reads a pull request', theirs.status === 0, theirs.log);
const prDiff: Diff = theirs.status === 0 ? JSON.parse(readFileSync(prPath, 'utf8')) : ({ files: [] } as unknown as Diff);
const prHead = git(repo, 'rev-parse', 'pr').trim();
same('a pull request diffs from its merge base to its head', [prDiff.base, prDiff.head], [branchPoint, prHead]);
same('a pull request keeps its own names', [prDiff.repo, prDiff.baseRef, prDiff.branch], ['https://github.com/someone/else', 'main', 'pr']);
same('a pull request has its own clone, at its head', git(prClone, 'rev-parse', 'HEAD').trim(), prHead);
check('gather prints what the guide needs', theirs.log.includes(`checkout ${prClone}`) && theirs.log.includes('"author":"alice"') && theirs.log.includes('"head":"pr"'), theirs.log);
same('reading a pull request leaves the checkout it ran in as it was', treeState(), beforePr);
const theirGuide = (readOnly: boolean): Guide => ({ ...guideFor('One.'), pr: { number: 7, title: 'Their change', url: 'https://github.com/someone/else/pull/7', author: 'alice', base: 'main', head: 'pr', ...(readOnly ? { readOnly } : {}) } });
const buildPr = (guide: Guide, stem: string) => {
  const guidePath = join(tmp, `${stem}.guide.json`);
  writeFileSync(guidePath, JSON.stringify(guide));
  return bun('build.ts', [`--diff=${prPath}`, `--guide=${guidePath}`, `--out=${join(tmp, stem)}`, `--repo=${prClone}`], tmp, github);
};
const prBuilt = buildPr(theirGuide(true), 'theirs-page');
check('a guide of a pull request builds against its clone', prBuilt.status === 0, prBuilt.log);
const prPage = prBuilt.status === 0 ? page('theirs-page') : { html: '', data: '' };
check('the page says it is read-only', prPage.html.includes('>read-only</span>') && prPage.data.includes('"mode":"read-only"'));
check('the page links to the pull request and its head', prPage.html.includes('https://github.com/someone/else/pull/7') && prPage.html.includes(`https://github.com/someone/else/commit/${prHead}`));
const driven = buildPr(theirGuide(false), 'driven-page');
check('a pull request you drive names no mode', driven.status === 0 && !page('driven-page').data.includes('"mode":'), driven.log);
git(repo, 'checkout', '-q', 'pr');
git(repo, 'commit', '--allow-empty', '-qm', 'a new head');
git(remote, 'fetch', '-q', repo, '+refs/heads/pr:refs/pull/7/head');
const moved = gatherPr('--pr=7');
same('run again, gather moves to the new head', [moved.status, git(prClone, 'rev-parse', 'HEAD').trim()], [0, git(repo, 'rev-parse', 'HEAD').trim()]);
const missing = gatherPr('--pr=404');
check('gather says when gh cannot find the pull request', missing.status === 1 && /error gh pr view 404: no pull requests found/.test(missing.log), missing.log);
const noGh = join(tmp, 'no-gh');
mkdirSync(noGh);
symlinkSync(process.execPath, join(noGh, 'bun'));
const without = bun('gather.ts', ['--pr=7'], tmp, { PATH: noGh });
check('gather says when gh is missing', without.status === 1 && /--pr needs gh/.test(without.log), without.log);
const otherClone = gatherPr('--pr=7', `--checkout=${tree}`);
check('gather refuses a clone of another repository', otherClone.status === 1 && /is a clone of https:\/\/github\.com\/example\/tree\.git/.test(otherClone.log), otherClone.log);
const both = gatherPr('--pr=7', '--head=x');
check('gather refuses --pr with --head', both.status === 1 && /takes no --base, --head or --worktree/.test(both.log), both.log);
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `fail  scripts (${failed})` : 'ok    scripts (gather and build against a scratch repository)');

// ---------------------------------------------------------------- 2. page
findChrome();

// `r` collects facts and `ms` timings: t(fn) times the synchronous work a click or key does before the browser can
// paint the result. An interaction must fit well inside one 60 Hz frame (16.7 ms).
// The diff layout switch answers in the click's frame and redraws the cards on screen in the next, which must fit one.
const BUDGET = { boot: 30, interaction: 12, frame: 16.7 };
const budget = { boot: BUDGET.boot, mark: BUDGET.interaction, key: BUDGET.interaction, tab: BUDGET.interaction, split: BUDGET.interaction, restyle: BUDGET.frame, panel: BUDGET.interaction };
const expect: Record<string, unknown> = {
  railButtons: 8, generatedFolded: true, moveChip: '↑ 6 lines moved to src/webhooks/sign.ts line 3', code: true, plain: 0, diagram: true,
  progress: '1 of 7 chapters reviewed', chapterFolds: true, saved: true, keyMoves: true, keyMarks: '2 of 7 chapters reviewed',
  jumpInGuide: true, jumpFoldToDiff: true, foldRow: true, diffCards: 11, tree: true, treeTick: true, soundOff: 'false', soundSaved: false,
  styleStart: 'true', split: true, styleSaved: 'split', splitJump: true, unified: true,
  textShut: true, panelSaved: '{"guide":true,"diff":false}', treeOwn: 'true false', treeShut: true, panelsOpen: '{"guide":false,"diff":false}',
};

const RUN = `
  r.railButtons = document.querySelectorAll('.gr-rail button').length;
  r.generatedFolded = card('.gr-guide', 'src/api/schema.gen.ts').classList.contains('collapsed');

  // code renders as it comes near, and so does each diagram; the moved-code chip comes with the code
  $('#c-signing').scrollIntoView();
  r.code = await until(() => card('#c-signing', 'src/webhooks/deliver.ts')?.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]'));
  await until(() => card('#c-signing', 'src/webhooks/deliver.ts').querySelector('.gr-move'));
  r.moveChip = card('#c-signing', 'src/webhooks/deliver.ts').querySelector('.gr-move button')?.textContent;
  r.plain = document.querySelectorAll('.gr-plain').length;
  r.diagram = !!await until(() => $('#c-signing .k-dia svg.pele'));

  // review marks
  scrollTo(0, 0); await sleep(100);
  const box = $('input[data-review-chapter="retry-decision"]');
  ms.mark = t(() => box.click());
  r.progress = $('.gr-progress').textContent;
  r.chapterFolds = [...document.querySelectorAll('#c-retry-decision .gr-file')].every((c) => c.classList.contains('collapsed'));
  r.saved = !!JSON.parse(localStorage.getItem('gr:42')).c['retry-decision'];

  // j moves to the next chapter, r marks the chapter at the reading line
  // The scroll brings new code cards near, which render; let their layout land first, so the timing is the key's.
  $('#c-retry-decision').scrollIntoView(); await sleep(800); document.body.offsetHeight;
  ms.key = t(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
  await sleep(150);
  r.keyMoves = Math.abs($('#c-worker').getBoundingClientRect().top - 60) < 30;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  r.keyMarks = $('.gr-progress').textContent;

  // a diagram node's ref to a line a chapter shows stays in the guide and selects the line
  const node = async (sec, id) => { await until(() => $(sec + ' .pele-node.is-ref')); return $(sec + ' .k-dia-wide .pele-node.is-ref[data-id="' + id + '"]'); };
  (await node('#overview', 'R')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  r.jumpInGuide = await until(() => !$('.gr-guide').hidden && card('#c-retry-decision', 'src/webhooks/deliver.ts').querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line="31"][data-selected-line]'));

  // a ref to a line folded away in every chapter opens the Diff tab's card of the whole file at that line; Enter on
  // the focused node follows it too
  $('.gr-tab[data-view="guide"]').click();
  const post = await node('#c-retry-decision', 'P');
  post.focus();
  post.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  r.jumpFoldToDiff = await until(() => !$('.gr-diff').hidden);
  r.foldRow = await until(() => card('.gr-diff', 'src/webhooks/deliver.ts')?.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line="16"][data-selected-line]'));

  // the Diff tab: every file, and the tree with its review ticks
  $('.gr-tab[data-view="guide"]').click();
  ms.tab = t(() => $('.gr-tab[data-view="diff"]').click());
  r.diffCards = document.querySelectorAll('.gr-diff .gr-file').length;
  r.tree = await until(() => $('.gr-tree-host').shadowRoot || $('.gr-tree-host').children.length);
  const treeText = () => ($('.gr-tree-host').shadowRoot ?? $('.gr-tree-host')).textContent;
  r.treeTick = await until(() => treeText().includes('✓'));

  // the speaker button mutes, and remembers
  $('[data-k-sound]').click();
  r.soundOff = $('[data-k-sound]').getAttribute('aria-pressed');
  r.soundSaved = JSON.parse(localStorage.getItem('kit:sound'));

  // unified or split: the switch redraws every drawn card and is remembered, and refs land in the right column
  $('.gr-tab[data-view="guide"]').click();
  r.styleStart = $('[data-diff-style="unified"]').getAttribute('aria-pressed');
  const dcard = () => card('#c-retry-decision', 'src/webhooks/deliver.ts').querySelector('diffs-container')?.shadowRoot;
  ms.split = t(() => $('[data-diff-style="split"]').click());
  r.split = await until(() => dcard()?.querySelector('[data-diff-type="split"]'));
  ms.restyle = +performance.getEntriesByName('gr:restyle').at(-1).duration.toFixed(2);
  r.styleSaved = JSON.parse(localStorage.getItem('gr:diff-style'));
  (await node('#overview', 'OK')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  r.splitJump = await until(() => dcard()?.querySelector('[data-additions] [data-line="27"][data-selected-line]'));
  $('[data-diff-style="unified"]').click();
  r.unified = await until(() => dcard()?.querySelector('[data-diff-type="single"]'));

  // the panel button closes the left column of the view on screen, each view's on its own, and remembers
  const shut = (q) => getComputedStyle($(q)).display === 'none';
  ms.panel = t(() => $('[data-panel-toggle]').click());
  r.textShut = shut('#c-worker .gr-body') && getComputedStyle($('#c-worker')).gridTemplateColumns.split(' ').length === 1 && !shut('#c-worker h2');
  r.panelSaved = localStorage.getItem('gr:panel-closed');
  $('.gr-tab[data-view="diff"]').click();
  r.treeOwn = $('[data-panel-toggle]').getAttribute('aria-expanded') + ' ' + shut('.gr-tree');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  r.treeShut = shut('.gr-tree') && getComputedStyle($('.gr-diff')).gridTemplateColumns.split(' ').length === 1;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  $('.gr-tab[data-view="guide"]').click();
  $('[data-panel-toggle]').click();
  r.panelsOpen = !shut('.gr-tree') && !shut('#c-worker .gr-body') && localStorage.getItem('gr:panel-closed');`;

// A Markdown card opens in Preview: the document with its change marked, folded around it. A fold opens; Changes off
// shows the whole document, and the Diff tab's card of the same file keeps its own switch; Source draws the diff and
// Preview comes back as the reader left it. A ref to a line lights the block that holds it, and the speech bubble on
// a block opens a comment on its lines, in the margin, level with the block.
const MD_RUN = `
  const shows = (el) => !!el && getComputedStyle(el).display !== 'none';
  const md = card('#c-docs', 'docs/webhooks.md');
  $('#c-docs').scrollIntoView();
  await until(() => md.querySelector('.gr-md-b'));
  r.opensInPreview = [md.classList.contains('is-prose'), md.querySelector('[data-md-mode="preview"]').getAttribute('aria-pressed'), !md.querySelector('diffs-container')].join(' ');
  r.marks = ['changed', 'added', 'removed'].map((m) => md.querySelectorAll('.gr-md-b.is-' + m).length).join(' ');
  r.words = !!md.querySelector('.is-changed ins') && !!md.querySelector('.is-changed del');
  r.fold = md.querySelector('.gr-md-fold .lb')?.textContent;
  r.image = md.querySelector('.gr-prose img')?.getAttribute('src').startsWith('data:image/svg+xml;base64,');
  r.alert = md.querySelector('.gr-md-alert-t')?.textContent;
  const before = md.querySelectorAll('.gr-md-b').length;
  ms.mdFold = t(() => md.querySelector('button[data-md-open]').click());
  r.foldOpens = md.querySelectorAll('.gr-md-b').length - before;

  ms.mdChanges = t(() => md.querySelector('[data-md-changes]').click());
  const doc = window.GR_DATA.prs[0].files.find((f) => f.path === 'docs/webhooks.md').preview.blocks.length;
  r.whole = (md.querySelectorAll('.gr-md-b').length === doc) + ' ' + md.querySelectorAll('.is-added, .is-changed, .is-removed, ins, del, .gr-md-fold').length;
  $('.gr-tab[data-view="diff"]').click();
  const other = card('.gr-diff', 'docs/webhooks.md');
  other.scrollIntoView();
  await until(() => other.querySelector('.gr-md-b'));
  r.ownSwitch = other.querySelector('[data-md-changes]').getAttribute('aria-pressed') + ' ' + !!other.querySelector('.gr-md-b.is-changed');
  $('.gr-tab[data-view="guide"]').click();
  md.scrollIntoView();

  ms.mdSource = t(() => md.querySelector('[data-md-mode="source"]').click());
  r.source = await until(() => md.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')) && !shows(md.querySelector('.gr-prose')) && md.querySelector('[data-md-changes]').hidden;
  md.querySelector('[data-md-mode="preview"]').click();
  r.back = [shows(md.querySelector('.gr-prose')), shows(md.querySelector('.gr-code')), md.querySelector('[data-md-changes]').getAttribute('aria-pressed')].join(' ');

  [...document.querySelectorAll('#c-docs .gr-body a[data-ref]')].find((a) => a.dataset.ref === 'docs/webhooks.md').click();
  r.jump = await until(() => md.classList.contains('is-prose') && md.querySelector('.gr-md-b.is-lit')?.dataset.a === '16');

  md.querySelector('[data-md-changes]').click();
  const table = [...md.querySelectorAll('.gr-md-b')].find((b) => b.querySelector('table'));
  table.scrollIntoView({ block: 'center' });
  await sleep(100);
  ms.mdNote = t(() => table.querySelector('[data-md-note]').click());
  await sleep(150);
  const form = document.querySelector('.gr-margin > [data-key="draft"]');
  r.noteWhere = form?.querySelector('.gr-composer-where')?.textContent;
  r.noteLevel = form && Math.round(form.getBoundingClientRect().top - table.getBoundingClientRect().top);
  r.noteLit = table.classList.contains('is-lit');
  form.querySelector('textarea').value = 'Say that the waits vary?';
  form.querySelector('[data-composer-add]').click();
  const saved = JSON.parse(localStorage.getItem('gr:42:comments') ?? '[]').at(-1);
  r.noteSaved = saved && [saved.kind, saved.path, saved.start, saved.end, saved.side, saved.code.length].join(' ');`;
const MD_EXPECT: Record<string, unknown> = {
  opensInPreview: 'true true true', marks: '1 4 0', words: true, fold: '4 unchanged blocks', image: true, alert: 'Important', foldOpens: 4,
  whole: 'true 0', ownSwitch: 'true true', source: true, back: 'true false false', jump: true,
  noteWhere: 'Comment on the block, lines 16–23', noteLevel: 0, noteLit: true, noteSaved: 'line docs/webhooks.md 16 23 n 8', narrow: true,
};

// The stack: #42 and #43, based on it, on one page. The picker, [ and ], marks kept per pull request, an anchor that
// opens #43, and a jump inside it.
const STACK_RUN = `
  const vis = (q) => [...document.querySelectorAll(q)].filter((e) => !e.hidden && !e.closest('[hidden]'));
  r.startsOn = vis('.gr-pr')[0]?.dataset.pr; r.count = vis('.gr-pick-n')[0]?.textContent;
  r.stacked = !!vis('.gr-picklist.stacked, .gr-pick .stacked').length || !!document.querySelector('.gr-pr:not([hidden]) .gr-picklist.stacked');
  vis('.gr-pick-btn')[0].click();
  r.opens = vis('.gr-picklist').length === 1 && document.activeElement?.dataset.pick === 'pr42';
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  r.arrowMoves = document.activeElement?.dataset.pick;
  ms.pick = t(() => document.activeElement.click());
  r.picked = vis('.gr-pr')[0]?.dataset.pr; r.closed = vis('.gr-picklist').length === 0;
  r.followers = [vis('.gr-head .t')[0]?.textContent, vis('.gr-bar .k-btn.is-primary')[0]?.textContent.trim(), vis('.gr-progress')[0]?.textContent].join(' | ');
  r.rail = [...document.querySelectorAll('.gr-rail button')].map((b) => b.dataset.target).join(' ');
  await until(() => vis('.gr-file diffs-container').length);
  ms.back = t(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true })));
  r.bracketBack = vis('.gr-pr')[0]?.dataset.pr;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
  r.bracketNext = vis('.gr-pr')[0]?.dataset.pr;
  vis('input[data-review-chapter="counts"]')[0].click();
  r.ownMarks = [!!JSON.parse(localStorage.getItem('gr:43') ?? '{}').c?.counts, !!JSON.parse(localStorage.getItem('gr:42') ?? '{"c":{}}').c?.counts].join();
  r.pickerProgress = document.querySelector('[data-progress-of="pr43"]').textContent;
  await until(() => $('#pr43-overview .pele-node.is-ref'));
  $('#pr43-overview .k-dia-wide .pele-node.is-ref[data-id="F"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  r.jump = await until(() => vis('.gr-file').find((c) => c.dataset.path === 'src/api/endpoint.ts')?.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line="17"][data-selected-line]'));`;
const STACK_EXPECT: Record<string, unknown> = {
  startsOn: 'pr42', count: '1 of 2', stacked: true, opens: true, arrowMoves: 'pr43', picked: 'pr43', closed: true,
  followers: 'Show retrying deliveries on the endpoint page | Open #43 on GitHub↗ | 0 of 3 chapters reviewed',
  rail: 'pr43-overview pr43-c-counts pr43-c-docs pr43-c-tests', bracketBack: 'pr42', bracketNext: 'pr43',
  ownMarks: 'true,false', pickerProgress: '1/3', jump: true, anchor: 'pr43', anchorAt: true,
};

type Tab = Awaited<ReturnType<typeof browser>>;
/** Runs `code` in the page with the helpers every run uses ($, sleep, until, t, card) and returns its { r, ms }. */
async function inPage(tab: Tab, code: string) {
  const raw = await tab.run(`(async () => {
    const r = {}, ms = {}, $ = (s) => document.querySelector(s), sleep = (n) => new Promise((ok) => setTimeout(ok, n));
    const t = (fn) => { const s = performance.now(); fn(); return +(performance.now() - s).toFixed(2); };
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await sleep(50); return !!fn(); };
    const card = (scope, path) => [...document.querySelectorAll(scope + ' .gr-file')].find((c) => c.dataset.path === path);
    ${code}
    return JSON.stringify({ r, ms });
  })()`);
  if (typeof raw !== 'string' || !raw.startsWith('{')) throw new Error(String(raw));
  return JSON.parse(raw) as { r: Record<string, unknown>; ms: Record<string, number> };
}
function report(name: string, tab: Tab, got: Record<string, unknown>, ms: Record<string, number>, expect: Record<string, unknown>, budget: Record<string, number>) {
  const bad = Object.entries(expect).filter(([k, v]) => got[k] !== v);
  for (const [k, v] of bad) console.log(`fail  ${name}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
  const slow = Object.entries(budget).filter(([k, max]) => !(ms[k] <= max));
  for (const [k, max] of slow) console.log(`slow  ${name}.${k}: ${ms[k]} ms, budget ${max} ms`);
  for (const e of tab.errors) console.log(`error ${name}: ${e.split('\n')[0]}`);
  if (!bad.length && !slow.length && !tab.errors.length)
    console.log(`ok    ${name} (${Object.keys(expect).length} checks, no errors; ${Object.entries(ms).map(([k, v]) => `${k} ${v}ms`).join(', ')})`);
  failed += bad.length + slow.length + tab.errors.length;
}

async function runPage(name: string, file: string, run: string, expect: Record<string, unknown>, budget: Record<string, number>, after?: (tab: Tab, r: Record<string, unknown>) => Promise<void>) {
  const tab = await browser(join(dirname(file), `profile-${name}`), { warnings: true });
  try {
    await tab.open('file://' + file);
    let got: Record<string, unknown>, ms: Record<string, number>;
    try {
      ({ r: got, ms } = await inPage(tab, `await sleep(300);
        ms.boot = +performance.getEntriesByName('gr:boot')[0].duration.toFixed(2);
        ${run}`));
    } catch (e) { console.log(`fail  ${name}: ${(e as Error).message}`); failed++; return; }
    if (after) await after(tab, got);
    report(name, tab, got, ms, expect, budget);
  } finally {
    tab.close();
  }
}

// Review comments, in the margin of a wide page: a line and a file comment kept from an earlier visit are boxes level
// with their line and their file's header; three lines selected by their numbers (a click, then a Shift-click), and
// the gutter's "+" dragged over three others, each with real mouse events, open a composer beside them; a general
// comment comes from the Comment button under the title; Add to batch keeps each one pending. The bar's Send (copied
// here, with no Claude to send to) holds every comment and takes them off the pending list, and they stay as threads,
// kept in this browser. A click on a box brings it forward and selects its lines. A reply waits with the next send
// and names its thread; a composer's Send sends at once; Resolve folds a thread; the bar hides and shows the margin;
// a narrow screen draws the boxes in the code instead.
async function runComments(file: string) {
  const name = 'comments';
  const tab = await browser(join(dirname(file), `profile-${name}`), { warnings: true });
  const got: Record<string, unknown> = {}, ms: Record<string, number> = {};
  const take = (x: { r: Record<string, unknown>; ms: Record<string, number> }) => { Object.assign(got, x.r); Object.assign(ms, x.ms); return x.r; };
  const mouse = (type: string, x: number, y: number, down = false, modifiers = 0) => tab.send('Input.dispatchMouseEvent', { type, x, y, modifiers, button: down || type !== 'mouseMoved' ? 'left' : 'none', buttons: down || type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  const click = async (at: { x: number; y: number }, modifiers = 0) => {
    await mouse('mouseMoved', at.x, at.y);
    await mouse('mousePressed', at.x, at.y, false, modifiers);
    await mouse('mouseReleased', at.x, at.y, false, modifiers);
  };
  const root = `card('#c-retry-decision', 'src/webhooks/deliver.ts').querySelector('diffs-container').shadowRoot`;
  const num = (line: number) => `${root}.querySelector('[data-column-number="${line}"]:not([data-line-type="change-deletion"])')`;
  /** The centre of an element on screen, or null. */
  const centre = async (el: string) => JSON.parse(await tab.run(`(() => { const card = (s, p) => [...document.querySelectorAll(s + ' .gr-file')].find((c) => c.dataset.path === p);
      const u = ${el}?.getBoundingClientRect();
      return JSON.stringify(u ? { x: u.left + u.width / 2, y: u.top + u.height / 2 } : null); })()`)) as { x: number; y: number } | null;
  /** The lines the card shows selected. */
  const picked = `[...${root}.querySelectorAll('[data-content] [data-line][data-selected-line]')].map((e) => e.dataset.line).join(' ')`;
  // A box in the margin, how far its top is from a line's row (0: level with it), and the bar's Send.
  const helpers = `const box = (key) => document.querySelector('.gr-margin > [data-key="' + key + '"]');
      const boxBy = (text) => [...document.querySelectorAll('.gr-margin > [data-key]')].find((x) => x.textContent.includes(text));
      const off = (el, line) => Math.round(el.getBoundingClientRect().top - ${num(0).replace('"0"', '"\' + line + \'"')}.getBoundingClientRect().top);
      const sendBar = () => $('[data-note-send]').hidden ? '' : $('[data-note-send]').textContent;`;
  try {
    await tab.open('file://' + file);
    await inPage(tab, `const head = window.GR_DATA.prs[0].head;
      localStorage.setItem('gr:42:comments', JSON.stringify([
        { id: 'cseed1', kind: 'line', path: 'src/webhooks/deliver.ts', start: 27, side: 'n', end: 27, endSide: 'n', code: [['+', 'x']], text: 'Seeded line comment', head, at: '2026-01-01T00:00:00Z' },
        { id: 'cseed2', kind: 'file', path: 'src/webhooks/backoff.ts', text: 'Seeded file comment', head, at: '2026-01-01T00:00:00Z' },
      ]));`);
    await tab.open('about:blank');
    await tab.open('file://' + file);
    take(await inPage(tab, `await sleep(300); ${helpers}
      r.bar = $('.gr-note-count').textContent + ' ' + sendBar();
      $('#c-retry-decision').scrollIntoView();
      r.lineNote = await until(() => box('n:cseed1')?.textContent.includes('Seeded line comment'));
      await until(() => ${root}?.querySelector('[data-line="27"]'));
      await sleep(300);
      r.lineLevel = off(box('n:cseed1'), 27);
      const backoff = card('#c-retry-decision', 'src/webhooks/backoff.ts');
      r.fileLevel = box('n:cseed2') && Math.round(box('n:cseed2').getBoundingClientRect().top - backoff.getBoundingClientRect().top) + ' ' + box('n:cseed2').querySelector('.gr-note-text').textContent;
      r.margin = document.body.classList.contains('gr-notes-on') && !card('#c-retry-decision', 'src/webhooks/deliver.ts').querySelector('.gr-note');
      ms.general = t(() => $('[data-note-general]').click());
      await sleep(50);
      const general = box('draft');
      const field = general?.querySelector('textarea');
      r.generalFocused = document.activeElement === field;
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
      r.typingKeepsKeys = $('[data-notes-toggle]').getAttribute('aria-pressed');
      field.value = 'Seeded general comment';
      ms.add = t(() => general.querySelector('[data-composer-add]').click());
      await sleep(50);
      r.added = sendBar() + ' ' + document.querySelectorAll('.gr-margin > [data-key]').length + ' ' + !!boxBy('Seeded general comment');
      ${num(31)}.scrollIntoView({ block: 'center' });
      await sleep(150);`));
    // A click on line 37's number, then a Shift-click on 35's, selects 35–37 and puts the "+" on 37. The clicks land on
    // the digits, left of where the "+" shows.
    const digits = (line: number) => `${num(line)}.querySelector('[data-line-number-content]')`;
    const n37 = await centre(digits(37)), n35 = await centre(digits(35));
    if (n37 && n35) { await click(n37); await click(n35, 8); }
    take(await inPage(tab, `await sleep(50);
      r.picked = ${picked};
      r.plusOnLast = ${root}.querySelector('[data-utility-button]')?.closest('[data-column-number]')?.dataset.columnNumber;`));
    const onLast = await centre(`${root}.querySelector('[data-utility-button]')`);
    if (onLast) await click(onLast);
    take(await inPage(tab, `await sleep(150); ${helpers}
      const form = box('draft');
      r.pickedComposer = form?.querySelector('.gr-composer-where')?.textContent;
      r.pickedBeside = form && off(form, 35);
      r.pickedKept = ${picked};
      if (form) { form.querySelector('textarea').value = 'Selected by their numbers'; form.querySelector('[data-composer-add]').click(); }
      const saved = JSON.parse(localStorage.getItem('gr:42:comments')).find((c) => c.text === 'Selected by their numbers');
      r.pickedSaved = saved ? saved.start + '-' + saved.end + ' ' + saved.side + saved.endSide + ' ' + saved.code.map((l) => l[0]).join('') : null;
      await sleep(50);
      // the comment stays the box the reader looks at, its lines still selected
      r.pickedLooked = !!boxBy('Selected by their numbers')?.classList.contains('is-active') && ${picked};`));
    const at = JSON.parse(await tab.run(`(() => { const card = (s, p) => [...document.querySelectorAll(s + ' .gr-file')].find((c) => c.dataset.path === p);
      const a = ${num(31)}.getBoundingClientRect(), b = ${num(33)}.getBoundingClientRect();
      return JSON.stringify({ x: a.left + a.width / 2, y: a.top + a.height / 2, y2: b.top + b.height / 2 }); })()`));
    await mouse('mouseMoved', at.x, at.y);
    const plus = JSON.parse(await tab.run(`(() => { const card = (s, p) => [...document.querySelectorAll(s + ' .gr-file')].find((c) => c.dataset.path === p);
      const u = ${root}.querySelector('[data-utility-button]')?.getBoundingClientRect();
      return JSON.stringify(u ? { x: u.left + u.width / 2, y: u.top + u.height / 2 } : null); })()`));
    got.plus = !!plus;
    if (plus) {
      await mouse('mousePressed', plus.x, plus.y);
      await mouse('mouseMoved', plus.x, at.y2, true);
      await mouse('mouseReleased', plus.x, at.y2);
    }
    take(await inPage(tab, `await sleep(150); ${helpers}
      r.lookLetGo = !document.querySelector('.gr-margin .is-active:not([data-key="draft"])');
      const form = box('draft');
      r.composer = form?.querySelector('.gr-composer-where')?.textContent;
      r.composerFocused = document.activeElement === form?.querySelector('textarea');
      if (form) { form.querySelector('textarea').value = 'Dragged over three lines'; ms.lineAdd = t(() => form.querySelector('[data-composer-add]').click()); }
      const saved = JSON.parse(localStorage.getItem('gr:42:comments')).find((c) => c.text === 'Dragged over three lines');
      r.dragged = saved ? saved.start + '-' + saved.end + ' ' + saved.side + saved.endSide + ' ' + saved.code.map((l) => l[0]).join('') : null;
      r.draggedDrawn = await until(() => boxBy('Dragged over three lines'));
      r.pending = sendBar();
      let copied = null;
      navigator.clipboard.writeText = (text) => { copied = text; return Promise.resolve(); };
      const queued = JSON.parse(localStorage.getItem('gr:42:comments'));
      window.GR_DATA.prs[0].mode = 'read-only'; // read when the send is written, as build.ts would have set it
      const th = (text) => ' [thread ' + queued.find((c) => c.text === text)?.id + ']';
      $('[data-note-send]').click();
      await until(() => copied);
      await sleep(150);
      delete window.GR_DATA.prs[0].mode;
      r.sent = !!copied && copied.startsWith('# Review comments on #42 ') && copied.includes(' (read-only): 5 comments')
        && copied.includes('1. General' + th('Seeded general comment') + '\\n   Seeded general comment') && copied.includes('src/webhooks/backoff.ts (the file) [thread ')
        && copied.includes('src/webhooks/deliver.ts:27 [thread ') && copied.includes('src/webhooks/deliver.ts:31-33' + th('Dragged over three lines') + '\\n   | + ')
        && copied.includes('src/webhooks/deliver.ts:35-37 [thread ') && queued.every((c) => copied.includes(' [thread ' + c.id + ']\\n'));
      r.cleared = sendBar() === '' && !document.querySelector('.gr-margin > .gr-note:not(.gr-thread)') && localStorage.getItem('gr:42:comments') === '[]';
      r.kept = JSON.parse(localStorage.getItem('gr:sent') ?? '[]').map((s) => s.prs[0].comments.length).join();
      r.threads = document.querySelectorAll('.gr-margin > .gr-thread').length + ' ' + $('.gr-note-count').textContent;
      const drawn = () => [...document.querySelectorAll('.gr-margin > .gr-thread')].find((x) => x.textContent.includes('Dragged over three lines'));
      // a click on a box brings it forward and selects its lines; a press elsewhere lets it go
      ms.look = t(() => drawn().querySelector('.gr-note-text').click());
      await sleep(300);
      r.looked = drawn().classList.contains('is-active') + ' ' + off(drawn(), 31) + ' ' + ${picked};
      $('.gr-head h1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      r.letGo = !drawn().classList.contains('is-active') && ${picked} === '';
      // a reply waits with the next send, and names its thread
      drawn().querySelector('[data-thread-reply]').click();
      const reply = drawn().querySelector('.gr-composer');
      r.replyFocused = document.activeElement === reply?.querySelector('textarea');
      if (reply) { reply.querySelector('textarea').value = 'And the 503 case?'; reply.querySelector('[data-composer-add]').click(); }
      r.replyPending = sendBar() + ' ' + !!drawn().querySelector('.gr-post.is-pending');
      copied = null;
      $('[data-note-send]').click();
      await until(() => copied);
      r.replySent = !!copied && copied.includes(': 1 comment\\n') && copied.includes('1. Reply on src/webhooks/deliver.ts:31-33' + th('Dragged over three lines') + '\\n   > Dragged over three lines\\n   And the 503 case?');
      r.replyPosted = await until(() => [...drawn().querySelectorAll('.gr-post:not(.is-pending) .gr-note-text')].map((p) => p.textContent).join('|') === 'Dragged over three lines|And the 503 case?');
      // a composer's Send sends that one comment at once
      card('#c-retry-decision', 'src/webhooks/deliver.ts').querySelector('[data-note-file]').click();
      await sleep(50);
      const now = box('draft');
      now.querySelector('textarea').value = 'Split this file?';
      copied = null;
      now.querySelector('[data-composer-send]').click();
      await until(() => copied);
      await sleep(150);
      r.sentNow = copied.includes(': 1 comment\\n') && copied.includes('1. src/webhooks/deliver.ts (the file) [thread c') && copied.includes(']\\n   Split this file?') && sendBar() === '' && !!boxBy('Split this file?')?.classList.contains('gr-thread');
      const tid = drawn().dataset.threadId;
      drawn().querySelector('[data-thread-resolve]').click();
      r.resolved = await until(() => box('t:' + tid)?.classList.contains('is-folded')) && JSON.parse(localStorage.getItem('gr:msgs')).at(-1).resolved;
      // a click on a comment whose file is marked reviewed opens the file, and brings the line on screen
      const deliver = card('#c-retry-decision', 'src/webhooks/deliver.ts');
      deliver.querySelector('input[data-review-file]').click();
      await sleep(100);
      const folded = deliver.classList.contains('collapsed');
      scrollTo(0, 0);
      await sleep(100);
      box('t:cseed1').querySelector('.gr-note-text').click();
      await sleep(600);
      const r27 = ${num(27)}?.getBoundingClientRect();
      r.reveal = folded + ' ' + !deliver.classList.contains('collapsed') + ' ' + (!!r27 && r27.top > 60 && r27.bottom < innerHeight) + ' ' + box('t:cseed1').classList.contains('is-active') + ' ' + ${picked};
      // the bar hides the comments and the code takes the width; c shows them again
      ms.hide = t(() => $('[data-notes-toggle]').click());
      await sleep(100);
      r.hidden = !document.body.classList.contains('gr-notes-on') && !document.querySelector('.gr-margin > *') && $('[data-notes-toggle]').getAttribute('aria-pressed');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
      await sleep(100);
      r.shown = document.body.classList.contains('gr-notes-on') && document.querySelectorAll('.gr-margin > .gr-thread').length;`));
    // Narrow, there is no margin: the boxes sit in the code, under their line, their file's header, the title.
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
    take(await inPage(tab, `await sleep(300);
      $('#c-retry-decision').scrollIntoView();
      const deliver = () => card('#c-retry-decision', 'src/webhooks/deliver.ts');
      r.narrow = [await until(() => deliver().querySelectorAll('diffs-container .gr-thread').length === 3),
        !document.querySelector('.gr-margin > *'), !!deliver().querySelector('.gr-notes .gr-thread'), !!document.querySelector('.gr-head-notes .gr-thread')].join();`));
    await tab.send('Emulation.clearDeviceMetricsOverride');
  } catch (e) {
    console.log(`fail  ${name}: ${(e as Error).message}`);
    failed++;
    return;
  } finally {
    tab.close();
  }
  report(name, tab, got, ms, {
    bar: '2 Copy 2for the chat', lineNote: true, lineLevel: 0, fileLevel: '0 Seeded file comment', margin: true,
    generalFocused: true, typingKeepsKeys: 'true', added: 'Copy 3for the chat 3 true',
    picked: '35 36 37', plusOnLast: '37', pickedComposer: 'Comment on lines 35–37', pickedBeside: 0, pickedKept: '35 36 37', pickedSaved: '35-37 nn ++ ', pickedLooked: '35 36 37',
    plus: true, lookLetGo: true, composer: 'Comment on lines 31–33', composerFocused: true, dragged: '31-33 nn +++', draggedDrawn: true, pending: 'Copy 5for the chat',
    sent: true, cleared: true, kept: '5', threads: '5 5', looked: 'true 0 31 32 33', letGo: true,
    replyFocused: true, replyPending: 'Copy 1for the chat true', replySent: true, replyPosted: true, sentNow: true, resolved: true, reveal: 'true true true true 27',
    hidden: 'false', shown: 6, narrow: 'true,true,true,true',
  }, { general: BUDGET.interaction, add: BUDGET.interaction, lineAdd: BUDGET.frame, look: BUDGET.interaction, hide: BUDGET.frame });
}

// A stand-in for the claude.ai viewer: the page database in memory (documents by path, a collection's listeners
// told of each write), a comments capability that records what it sends, and a reader "u_me". It holds, from before
// the page opened, the sends of another reader, "u_other": a line comment, written on an older head, whose code is
// not in the diff any more, and a send whose comments are not whole, which the page leaves out.
const VIEWER = `(() => {
  const docs = new Map(), subs = [];
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const tell = (coll) => { for (const s of subs) if (s.coll === coll) setTimeout(s.fire); };
  const put = (path, data) => { docs.set(path, JSON.parse(JSON.stringify(data))); tell(parent(path)); };
  const db = {
    doc: (path) => ({ path, set: async (d) => put(path, d), delete: async () => { docs.delete(path); tell(parent(path)); } }),
    collection: (coll) => ({ path: coll, onSnapshot(next) {
      const s = { coll, had: new Set(), fire() {
        const list = [...docs].filter(([p]) => parent(p) === coll).sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, d]) => ({ id: p.split('/').pop(), exists: true, data: () => d }));
        const added = list.filter((d) => !s.had.has(d.id)).map((doc) => ({ type: 'added', doc }));
        s.had = new Set(list.map((d) => d.id));
        next({ docs: list, docChanges: () => added, metadata: { fromCache: false } });
      } };
      subs.push(s);
      setTimeout(s.fire);
      return () => subs.splice(subs.indexOf(s), 1);
    } }),
  };
  put('comments/u_other', { at: '2026-01-01T00:00:00Z' });
  put('comments/u_other/sends/s0', { sentAt: '2026-01-01T00:00:00Z', prs: [{ number: 42, title: 'Retry', head: 'a0a0a0a', comments: [
    { id: 'cother', kind: 'line', path: 'src/webhooks/deliver.ts', start: 27, side: 'n', end: 27, endSide: 'n', code: [['+', '  const gone = true;']], text: 'Is this still needed?', head: 'a0a0a0a', at: '2026-01-01T00:00:00Z' },
  ] }] });
  put('comments/u_other/sends/s1', { sentAt: 3, prs: [null, { number: 42, comments: [null, 'x',
    { id: 'bad1', kind: 'line', path: 'src/webhooks/deliver.ts', code: 'oops', text: 'No lines', head: 'a0a0a0a' },
    { id: 'bad2', kind: 'file', text: 7, head: 'a0a0a0a' }, { id: 'bad3', kind: 'reply', text: 'No thread', head: 'a0a0a0a' }] }] });
  window.__viewer = { docs, put, sent: [] };
  const comments = {
    canSendToClaude: async () => 'available',
    anchorFor: async () => ({ path: 'h1', x: 0, y: 0 }),
    sendToClaude: async (t) => {
      await window.__viewer.hold;
      if (window.__viewer.fail) throw { code: window.__viewer.fail };
      window.__viewer.sent.push(t.text);
      return { threadId: 'th' + window.__viewer.sent.length, commentId: 'x' };
    },
  };
  const user = { id: async () => 'u_me', can: async () => true, profiles: async (ids) => Object.fromEntries([].concat(ids).map((i) => [i, { name: '' }])) };
  window.claude = { use: async (name) => ({ db, comments, user })[name] ?? null };
})();`;

// Threads: kept in this browser from an earlier visit on an older head, one is level with its own lines while they
// hold its code, one with the lines its code moved to, and one, whose code is gone, sits by its file's header, marked
// Outdated, with its code. A click on the moved one selects the lines it is on now. With the viewer's database:
// another reader's thread shows; Send writes the send for Claude to read; an answer Claude writes comes into its
// thread at once; a reply sent at once carries its thread to Claude; Resolve writes a mark.
async function runThreads(file: string) {
  const name = 'threads';
  const tab = await browser(join(dirname(file), `profile-${name}`), { warnings: true });
  const got: Record<string, unknown> = {}, ms: Record<string, number> = {};
  const take = (x: { r: Record<string, unknown>; ms: Record<string, number> }) => { Object.assign(got, x.r); Object.assign(ms, x.ms); return x.r; };
  const root = `card('#c-retry-decision', 'src/webhooks/deliver.ts').querySelector('diffs-container')?.shadowRoot`;
  const helpers = `const box = (key) => document.querySelector('.gr-margin > [data-key="' + key + '"]');
      const row = (line) => ${root}?.querySelector('[data-line="' + line + '"]:not([data-line-type="change-deletion"])');
      const off = (el, line) => Math.round(el.getBoundingClientRect().top - row(line).getBoundingClientRect().top);`;
  try {
    await tab.open('file://' + file);
    await inPage(tab, `const line = (id, start, code, text) => ({ id, kind: 'line', path: 'src/webhooks/deliver.ts', start, side: 'n', end: start, endSide: 'n', code: [['+', code]], text, head: 'b1b1b1b', at: '2026-01-01T00:00:00Z' });
      const head = window.GR_DATA.prs[0].head;
      localStorage.setItem('gr:sent', JSON.stringify([{ id: 'sold', sentAt: '2026-01-01T00:00:00Z', prs: [{ key: 'gr:42', number: 42, title: 'Retry', head: 'b1b1b1b', comments: [
        line('tsame', 31, '  if (retryable(code) && attempts < MAX_ATTEMPTS) {', 'On its own lines'),
        line('tmoved', 40, "    return { status: 'retrying', code };", 'Its code moved'),
        line('tgone', 31, '  const gone = true;', 'Its code is gone'),
        { ...line('tfold', 16, '', 'On a folded line'), code: [[' ', '    const res = await fetch(endpoint.url, {']], head },
      ] }] }]));`);
    await tab.open('about:blank');
    await tab.open('file://' + file);
    take(await inPage(tab, `await sleep(300); ${helpers}
      $('#c-retry-decision').scrollIntoView();
      await until(() => row(33) && box('t:tmoved'));
      await sleep(300);
      // the moved one waits below the box above it, until the reader looks at it
      r.level = off(box('t:tsame'), 31) + ' ' + (off(box('t:tmoved'), 33) > 0);
      // the outdated one and the one on a folded line sit by the file's header, one under the other
      const header = card('#c-retry-decision', 'src/webhooks/deliver.ts');
      const by = (id) => Math.round(box('t:' + id).getBoundingClientRect().top - header.getBoundingClientRect().top);
      r.goneBeside = Math.min(by('tgone'), by('tfold')) + ' ' + (Math.max(by('tgone'), by('tfold')) > 0);
      r.outdated = ['tsame', 'tmoved', 'tgone'].map((id) => !!box('t:' + id)?.querySelector('.gr-chip.is-outdated')).join();
      r.goneCode = box('t:tgone')?.querySelector('.gr-note-code')?.textContent.trim();
      r.movedLabel = box('t:tmoved')?.querySelector('.gr-note-what')?.textContent;
      ms.look = t(() => box('t:tmoved').querySelector('.gr-note-text').click());
      r.movedLit = await until(() => row(33)?.matches('[data-selected-line]')) && !row(31).matches('[data-selected-line]');
      await sleep(300);
      r.movedLevel = off(box('t:tmoved'), 33) + ' ' + (off(box('t:tsame'), 31) < 0);
      // a click on the one on a folded line opens the Diff tab's card of the whole file to that line
      box('t:tfold').querySelector('.gr-note-text').click();
      const whole = () => card('.gr-diff', 'src/webhooks/deliver.ts')?.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line="16"]:not([data-line-type="change-deletion"])');
      r.foldReveal = await until(() => !$('.gr-diff').hidden && whole()?.matches('[data-selected-line]'));`));
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: VIEWER });
    await tab.open('about:blank');
    await tab.open('file://' + file);
    take(await inPage(tab, `${helpers}
      r.otherReader = await until(() => box('t:cother')) && box('t:cother').querySelector('.gr-post-by b').textContent + ' ' + !!box('t:cother').querySelector('.gr-chip.is-outdated');
      r.otherWho = box('t:cother').querySelector('.gr-post').className;
      r.notWhole = !box('t:bad1') && !box('t:bad2') && document.querySelectorAll('.gr-margin > .gr-thread').length === 5;
      $('[data-note-general]').click();
      await sleep(50);
      const general = box('draft');
      general.querySelector('textarea').value = 'Is the backoff capped?';
      general.querySelector('[data-composer-add]').click();
      r.sendWord = $('[data-note-send]').textContent;
      $('[data-note-send]').click();
      const { docs, put, sent } = window.__viewer;
      await until(() => sent.length && [...docs.keys()].some((p) => p.startsWith('comments/u_me/sends/')));
      const ref = [...docs.keys()].find((p) => p.startsWith('comments/u_me/sends/'));
      r.sentRef = sent[0]?.endsWith('Every comment, with its code: ' + ref + ' in the page database.') && docs.get(ref).prs[0].key === 'gr:42' && docs.has('comments/u_me');
      const mine = docs.get(ref).prs[0].comments[0].id;
      r.sentThread = !!sent[0]?.includes(' [thread ' + mine + ']\\n');
      r.mineShows = await until(() => box('t:' + mine)) && box('t:' + mine).querySelector('.gr-post-by b').textContent;
      put('comments/u_me/msgs/m1', { thread: mine, by: 'claude', text: 'Capped at an hour (backoff.ts:12).', at: new Date().toISOString(), head: 'c2c2c2c' });
      r.answer = await until(() => box('t:' + mine)?.querySelector('.gr-post.is-claude')) && [...box('t:' + mine).querySelectorAll('.gr-post-by b')].map((b) => b.textContent).join() + ' ' + box('t:' + mine).querySelector('.gr-post.is-claude .gr-note-text').textContent;
      r.answerToast = $('#k-toast')?.textContent;
      // each post says whose it is, for its colors: the reader's own, and Claude's
      r.who = [...box('t:' + mine).querySelectorAll('.gr-post')].map((p) => ['is-me', 'is-claude', 'is-other'].filter((c) => p.classList.contains(c)).join('+')).join();
      // the bell counts the thread, and its list goes to the answer and marks it read
      r.unread = $('.gr-bell-n').textContent + ' ' + !!box('t:' + mine).querySelector('.gr-post.is-unread .gr-chip.is-new');
      ms.bell = t(() => $('[data-bell]').click());
      const items = [...document.querySelectorAll('.gr-inbox-item')];
      r.inbox = !$('#gr-inbox').hidden && items.length + ' ' + items[0]?.querySelector('.gist').textContent + ' | ' + (document.activeElement === items[0]);
      scrollTo(0, document.body.scrollHeight);
      items[0].click();
      await sleep(600);
      const mb = box('t:' + mine);
      r.bellGo = [$('#gr-inbox').hidden, $('.gr-bell-n').hidden, mb.classList.contains('is-active'), !mb.querySelector('.is-unread'),
        mb.getBoundingClientRect().top < innerHeight && mb.getBoundingClientRect().bottom > 0, JSON.parse(localStorage.getItem('gr:read')).includes('m1')].join();
      // the answer it went to is on screen and lit for a moment, then not
      const lit = mb.querySelector('[data-post-id="m1"]');
      r.flash = [lit?.classList.contains('is-flash'), lit && lit.getBoundingClientRect().top >= 0 && lit.getBoundingClientRect().bottom <= innerHeight].join();
      await sleep(1200);
      r.flashGone = !document.querySelector('.gr-post.is-flash');
      $('[data-bell]').click();
      r.inboxEmpty = $('.gr-inbox-empty')?.textContent.startsWith('No unread answers');
      // the answer just read is under Read, and kept in this browser with when it was read
      r.readFold = $('[data-inbox-fold]')?.getAttribute('aria-expanded');
      r.readList = [...document.querySelectorAll('[data-inbox-read] .gr-inbox-item')].map((b) => b.dataset.inbox === mine).join() + ' ' + JSON.parse(localStorage.getItem('gr:seen')).some(([id]) => id === mine);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      r.inboxClosed = $('#gr-inbox').hidden;
      box('t:' + mine).querySelector('[data-thread-reply]').click();
      const form = box('t:' + mine).querySelector('.gr-composer');
      form.querySelector('textarea').value = 'Make it configurable?';
      r.replyWord = form.querySelector('[data-composer-send]').textContent;
      form.querySelector('[data-composer-send]').click();
      await until(() => sent.length === 2);
      r.replyText = sent[1]?.includes(': 1 comment\\n') && sent[1]?.includes('1. Reply on General [thread ' + mine + ']\\n   > Is the backoff capped?\\n   Make it configurable?');
      await sleep(100);
      const ref2 = [...docs.keys()].filter((p) => p.startsWith('comments/u_me/sends/')).sort().at(-1);
      const rc = docs.get(ref2)?.prs[0].comments[0];
      r.replyDoc = rc && [rc.kind, rc.thread === mine, rc.on?.text, rc.before?.map((b) => b.by).join()].join(' ');
      r.replyShows = await until(() => box('t:' + mine)?.querySelectorAll('.gr-post:not(.is-pending)').length === 3);
      box('t:' + mine).querySelector('[data-thread-resolve]').click();
      r.mark = await until(() => [...docs].some(([p, d]) => p.startsWith('comments/u_me/msgs/') && d.thread === mine && d.resolved === true)) && await until(() => box('t:' + mine)?.classList.contains('is-folded'));
      // a composer's Send shows its thread while the send is out, never a queued comment, and the box stays once it lands
      const boxesWith = (text) => [...document.querySelectorAll('.gr-margin > .gr-note')].filter((b) => b.textContent.includes(text));
      let release;
      window.__viewer.hold = new Promise((res) => { release = res; });
      $('[data-note-general]').click();
      await sleep(50);
      const quick = box('draft');
      quick.querySelector('textarea').value = 'Any jitter?';
      quick.querySelector('[data-composer-send]').click();
      await new Promise(requestAnimationFrame);
      const flying = boxesWith('Any jitter?');
      r.flying = flying.length + ' ' + flying.every((b) => b.classList.contains('gr-thread') && !b.querySelector('.gr-chip.is-pending')) + ' ' + $('[data-note-send]').hidden;
      release();
      await until(() => sent.length === 3);
      await sleep(100);
      r.landed = !!flying[0]?.isConnected && box(flying[0].dataset.key) === flying[0] && boxesWith('Any jitter?').length === 1;
      // a send that fails puts the comment back in the queue
      window.__viewer.hold = null;
      window.__viewer.fail = 'consent_required';
      $('[data-note-general]').click();
      await sleep(50);
      const fails = box('draft');
      fails.querySelector('textarea').value = 'Will this go?';
      fails.querySelector('[data-composer-send]').click();
      await sleep(100);
      const back = boxesWith('Will this go?');
      r.failed = back.length + ' ' + !back[0]?.classList.contains('gr-thread') + ' ' + !!back[0]?.querySelector('.gr-chip.is-pending') + ' ' + $('[data-note-send]').textContent + ' ' + sent.length;
      // an answer reads as a chapter does: what it names links to its code, and nothing in it runs
      const shown = document.querySelector('.gr-margin > .gr-thread:not(.is-folded)');
      const shownId = shown.dataset.threadId;
      put('comments/u_me/msgs/m9', { thread: shownId, by: 'claude', at: new Date().toISOString(), head: 'c2c2c2c',
        text: 'See [\`retryable\`](ref:src/webhooks/deliver.ts:31), sign.ts:3, **src/webhooks/backoff.ts**, \`queue.ts\`, src/log.ts:2 and [the log](ref:src/log.ts).\\nNot ours: .github/workflows/build.yml, https://example.com/a.ts:1, v1.2.3, <img src=x onerror="window.__rich=1"> [bad](javascript:window.__rich=1) [[x.ts:1](ref:y)] *em*' });
      const answerP = () => [...(box('t:' + shownId)?.querySelectorAll('.gr-post.is-claude .gr-note-text') ?? [])].find((p) => p.textContent.startsWith('See '));
      await until(answerP);
      const head = window.GR_DATA.prs[0].head;
      r.richLinks = [...answerP().querySelectorAll('a')].map((a) => (a.dataset.ref ? a.dataset.ref + ':' + a.dataset.line + a.dataset.side : a.getAttribute('href').replace(head, 'HEAD'))).join(' ');
      r.richMarks = [answerP().querySelector('b a')?.dataset.ref, answerP().querySelector('a[data-ref="src/webhooks/queue.ts"] code')?.textContent, answerP().querySelector('em')?.textContent, !answerP().querySelector('a a'), !answerP().querySelector('img'), window.__rich === undefined, answerP().textContent.includes('<img src=x')].join();
      $('[data-bell]').click();
      r.richGist = [...document.querySelectorAll('.gr-inbox-item .gist')].map((g) => g.textContent).find((g) => g.startsWith('Claude See'))?.slice(0, 66);
      $('[data-bell]').click();
      const selected = (scope, line) => [...document.querySelectorAll(scope + ' .gr-file')].some((f) => f.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line="' + line + '"][data-selected-line]'));
      answerP().querySelector('a[data-ref="src/webhooks/deliver.ts"]').click();
      r.richJump = await until(() => !$('.gr-guide').hidden && selected('.gr-guide', 31));
      // a ref in a thread on lines goes to what it names: the thread does not take the card's selection back
      await sleep(2000);
      put('comments/u_me/msgs/m10', { thread: 'tsame', by: 'claude', at: new Date().toISOString(), head: 'c2c2c2c', text: 'Compare src/webhooks/deliver.ts:35 with webhooks/deliver.ts:36, not deliver.ts:37, which two files could be.' });
      await until(() => box('t:tsame')?.querySelector('.gr-post.is-unread a[data-line="35"]'));
      box('t:tsame').querySelector('a[data-line="35"]').click();
      await until(() => row(35)?.matches('[data-selected-line]'));
      await sleep(300);
      r.richLine = [row(35)?.matches('[data-selected-line]'), row(31)?.matches('[data-selected-line]'), box('t:tsame').classList.contains('is-active'), !!box('t:tsame').querySelector('.is-unread')].join();
      r.richAmbiguous = [...box('t:tsame').querySelectorAll('.gr-post.is-claude a')].map((a) => a.dataset.line).join();
      // on the Diff tab it stays on the Diff tab, even when the click repaints an unread answer
      put('comments/u_me/msgs/m11', { thread: shownId, by: 'claude', at: new Date().toISOString(), head: 'c2c2c2c', text: 'Then src/webhooks/sign.ts:4.' });
      await until(() => box('t:' + shownId)?.querySelector('.gr-post.is-unread a[data-line="4"]'));
      $('.gr-tab[data-view="diff"]').click();
      await sleep(200);
      box('t:' + shownId).querySelector('.gr-post.is-unread a[data-line="4"]').click();
      r.richUnread = await until(() => !$('.gr-diff').hidden && selected('.gr-diff', 4));
      await sleep(2000);
      answerP().querySelector('a[data-ref="src/webhooks/sign.ts"]').click();
      r.richStays = await until(() => !$('.gr-diff').hidden && selected('.gr-diff', 3));`));
    // Narrower, there is no margin: a thread sits in the code, and its links work the same.
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
    take(await inPage(tab, `await sleep(300); ${helpers}
      $('.gr-tab[data-view="guide"]').click();
      $('#c-retry-decision').scrollIntoView();
      const inCode = () => document.querySelector('.gr-file [data-key="t:tsame"]');
      await until(inCode);
      await sleep(2000);
      const link = inCode()?.querySelector('a[data-line="36"]');
      r.narrowLink = !!link && getComputedStyle(link).textDecorationStyle;
      link?.click();
      r.narrowJump = await until(() => row(36)?.matches('[data-selected-line]'));`));
  } catch (e) {
    console.log(`fail  ${name}: ${(e as Error).message}`);
    failed++;
    return;
  } finally {
    tab.close();
  }
  report(name, tab, got, ms, {
    level: '0 true', movedLevel: '0 true', goneBeside: '0 true', foldReveal: true, outdated: 'false,false,true', goneCode: '+   const gone = true;', movedLabel: 'Line 33', movedLit: true,
    otherReader: 'Reviewer true', otherWho: 'gr-post is-other', notWhole: true, unread: '1 true', inbox: '1 Claude Capped at an hour (backoff.ts:12). | true',
    bellGo: 'true,true,true,true,true,true', flash: 'true,true', flashGone: true, inboxEmpty: true, readFold: 'true', readList: 'true true', inboxClosed: true, sendWord: 'Send 1to Claude', sentRef: true, sentThread: true, mineShows: 'You', answer: 'You,Claude Capped at an hour (backoff.ts:12).', answerToast: 'Claude answered in a thread.', who: 'is-me,is-claude',
    replyWord: 'Send', replyText: true, replyDoc: 'reply true Is the backoff capped? claude', replyShows: true, mark: true,
    flying: '1 true true', landed: true, failed: '1 true true Send 1to Claude 3',
    richLinks: 'src/webhooks/deliver.ts:31n src/webhooks/sign.ts:3n src/webhooks/backoff.ts:0n src/webhooks/queue.ts:0n https://github.com/example/webhooks/blob/HEAD/src/log.ts#L2 https://github.com/example/webhooks/blob/HEAD/src/log.ts https://example.com/a.ts:1 https://github.com/example/webhooks/blob/HEAD/y',
    richMarks: 'src/webhooks/backoff.ts,queue.ts,em,true,true,true,true', richGist: 'Claude See retryable, sign.ts:3, src/webhooks/backoff.ts, queue.ts', richJump: true, richStays: true,
    richLine: 'true,false,false,false', richAmbiguous: '35,36', richUnread: true, narrowLink: 'dotted', narrowJump: true,
  }, { look: BUDGET.interaction, bell: BUDGET.interaction });
}

const dir = mkdtempSync(join(tmpdir(), 'guided-review-page-'));
try {
  const demo = buildDemo(join(dir, 'demo'), true);
  const stack = buildStackDemo(join(dir, 'stack'), true);
  if (demo.code || stack.code) { console.log(demo.log + stack.log); process.exit(1); }
  await runPage('page', join(dir, 'demo.preview.html'), RUN, expect, budget);
  await runPage('markdown', join(dir, 'demo.preview.html'), MD_RUN, MD_EXPECT, { boot: BUDGET.boot, mdFold: BUDGET.interaction, mdChanges: BUDGET.interaction, mdSource: BUDGET.interaction, mdNote: BUDGET.interaction }, async (tab, r) => {
    // Narrower, there is no margin: the comment sits under its block, as a line comment sits under its line.
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
    r.narrow = JSON.parse(await tab.run(`(async () => { await new Promise((ok) => setTimeout(ok, 300));
      const table = [...document.querySelectorAll('#c-docs .gr-md-b')].find((b) => b.querySelector('table'));
      const box = table?.nextElementSibling;
      return JSON.stringify(!!box?.classList.contains('gr-md-notes') && !box.hidden && box.textContent.includes('Say that the waits vary?') && !document.querySelector('.gr-margin > [data-key]')); })()`));
  });
  await runComments(join(dir, 'demo.preview.html'));
  await runThreads(join(dir, 'demo.preview.html'));
  await runPage('stack', join(dir, 'stack.preview.html'), STACK_RUN, STACK_EXPECT, { boot: BUDGET.boot, pick: BUDGET.interaction, back: BUDGET.interaction }, async (tab, r) => {
    // A link with #pr43-c-docs opens on #43, at that chapter.
    // Another document first: a navigation that changes only the anchor fires no load.
    await tab.open('about:blank');
    await tab.open('file://' + join(dir, 'stack.preview.html') + '#pr43-c-docs');
    const at = JSON.parse(await tab.run(`(async () => { await new Promise((ok) => setTimeout(ok, 400));
      const p = [...document.querySelectorAll('.gr-pr')].find((e) => !e.hidden);
      return JSON.stringify({ anchor: p?.dataset.pr, anchorAt: Math.abs(document.getElementById('pr43-c-docs').getBoundingClientRect().top - 60) < 40 || scrollY + innerHeight >= document.documentElement.scrollHeight - 2 }); })()`));
    Object.assign(r, at);
  });
  failed += await themeChecks('file://' + join(dir, 'demo.preview.html'), join(dir, 'profile-theme'));
  // A phone's bar, with Send up or not: the page never scrolls sideways, the bell and Send stay on the screen, and the
  // theme button shows until Send needs its room.
  const phone = await browser(join(dir, 'profile-phone'));
  try {
    const bar = `(() => { const send = document.querySelector('[data-note-send]'), right = (s) => document.querySelector(s).getBoundingClientRect().right;
      return JSON.stringify({ wide: document.documentElement.scrollWidth > innerWidth, off: right('[data-bell]') > innerWidth || (!send.hidden && right('[data-note-send]') > innerWidth),
        theme: !!document.querySelector('[data-k-theme]').offsetWidth }); })()`;
    for (const width of [430, 390, 360, 320]) {
      await phone.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
      await phone.open('file://' + join(dir, 'demo.preview.html'));
      same(`phone bar at ${width}`, JSON.parse(await phone.run(bar)), { wide: false, off: false, theme: true });
      await phone.run(`(() => { const s = document.querySelector('[data-note-send]'); s.hidden = false; s.querySelector('.n').textContent = 'Send 1'; })()`);
      same(`phone bar at ${width}, with Send`, JSON.parse(await phone.run(bar)), { wide: false, off: false, theme: false });
    }
  } finally {
    phone.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
