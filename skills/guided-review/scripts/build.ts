#!/usr/bin/env bun
/* Check guides against their diffs, then pack the guided review for the Artifact tool.

     bun scripts/build.ts --diff=<work>/diff.json --guide=<work>/guide.json [--out=<work>/guide] [--repo=<checkout>]
     bun scripts/build.ts --stack=<work>/stack.json [--out=<work>/stack] [--repo=<checkout>]
     bun scripts/build.ts ... --check          # check only, write nothing
     bun scripts/build.ts --refresh [--major]  # refresh runtime/libs.json only

   One guide makes a page about one pull request. A stack.json lists several guides with their diffs, a stack from its
   base up or any set to review together; their page's title becomes a menu of them. Writes <out>.artifact.html
   (publish it, with the `files` map the build prints), the stylesheet, runtime and data it loads in <out>.files/,
   and <out>.preview.html (a full document to open locally); <out> defaults to the guide's or the stack's path
   without .json. Exit code 1 when a guide has errors; warnings do not stop the build.

   Libraries (@pierre/diffs and @pierre/trees) resolve to the newest release that is at least 14 days old (the
   artifact rule). A refresh runs on its own when libs.json is more than 7 days old, and is skipped quietly when
   offline. Size: the page holds only its markup; the stylesheet, the runtime (with its sounds) and the data are files
   beside it, and Geist comes from Google Fonts. Speed: the runtime is bundled and minified, and every library the
   page uses is preloaded from the head with its whole import graph, so nothing waits on a request chain. Diagrams
   are drawn here with pele, into SVG in the kit's colors; the drawings ride in the data file, so the page loads no
   diagram library and stays small.

   The font link, the shared stylesheet, the sounds, the speaker button, the library pinning and the diagrams come
   from the kit (kit/build/). */
import { dirname, join, resolve } from 'node:path';
import type { Chapter, Diagram, DiagramRef, Diff, DiffFile, Guide, Kind, PageData, PageDiagram, PagePr, Stack, StateTable, Text } from '../runtime/types';
import { FONTS, ICON, THEME, assets, preview, publishLines, runtime, soundButton, styles, themeButton } from '../kit/build/page';
import { libs, preloads } from '../kit/build/libs';
import { diagrams } from '../kit/build/diagram';
import { BELL, COMMENT, PANEL } from '../runtime/icons';
import { previews } from './markdown';

const ROOT = join(import.meta.dir, '..');
const RT = join(ROOT, 'runtime');

const argv = Bun.argv.slice(2);
/** --name=value or --name value. */
const opt = (name: string, fallback?: string) => {
  const i = argv.findIndex((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  return argv[i].includes('=') ? argv[i].slice(name.length + 3) : (argv[i + 1] ?? fallback);
};
const flag = (f: string) => argv.includes(`--${f}`);
const libmap = await libs(join(RT, 'libs.json'), { force: flag('refresh'), major: flag('major') });
if (!opt('guide') && !opt('stack')) {
  if (flag('refresh')) process.exit(0);
  console.log('usage: bun scripts/build.ts --diff=diff.json --guide=guide.json [--out=guide] [--check] [--repo=<checkout>]');
  console.log('       bun scripts/build.ts --stack=stack.json [--out=stack] [--check] [--repo=<checkout>]');
  process.exit(flag('help') ? 0 : 2);
}
const draw = await diagrams(ROOT);

// ---------------------------------------------------------------- inputs
// One guide and its diff, or a stack.json that lists several, in the order the page's picker shows them.
let stack: Stack | null = null;
let inputs: { guide: Guide; diff: Diff }[];
const stackPath = opt('stack');
if (stackPath) {
  stack = await Bun.file(stackPath).json() as Stack;
  const dir = dirname(resolve(stackPath));
  if (!Array.isArray(stack.prs) || !stack.prs.length) { console.log('  error stack.json: prs is empty. List each pull request as { "guide": …, "diff": … }.'); process.exit(1); }
  inputs = await Promise.all(stack.prs.map(async (p) => ({ guide: await Bun.file(resolve(dir, p.guide)).json(), diff: await Bun.file(resolve(dir, p.diff)).json() })));
} else {
  inputs = [{ guide: await Bun.file(opt('guide')!).json(), diff: await Bun.file(opt('diff', 'diff.json')!).json() }];
}
const stem = (opt('out') ?? stackPath ?? opt('guide')!).replace(/\.(json|html?)$/, '').replace(/\.artifact$/, '');
const multi = inputs.length > 1;
const checkout = opt('repo', process.cwd())!;

const KINDS: Kind[] = ['core', 'docs', 'database', 'tests', 'generated'];
const LABEL: Partial<Record<Kind, string>> = { docs: 'Docs', database: 'Database', tests: 'Tests', generated: 'Generated' };
const LATE = new Set<Kind>(['database', 'tests', 'generated']);
const words = (s: unknown) => String(s ?? '').replace(/`[^`]*`/g, 'x').split(/\s+/).filter(Boolean).length;
const paras = (b: Text | undefined) => (Array.isArray(b) ? b : b == null ? [] : [b]).map(String);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pad2 = (n: number) => String(n).padStart(2, '0');
const statHtml = (a: number, d: number) => `${a ? `<span class="add-n">+${a}</span>` : ''}${d ? `<span class="del-n">−${d}</span>` : ''}`;
const chip = (path: string) => {
  const name = path.split('/').pop()!;
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return ext && ext.length <= 4 ? ext : 'txt';
};
const CHEV = ICON.down;
const MARK_LABEL: Record<string, string> = { new: 'New', changed: 'Changed', removed: 'Removed' };

// ---------------------------------------------------------------- one pull request
/** The commit a link to GitHub names. */
const linkRevOf = (diff: Diff) => (diff.snapshotOf ? diff.base : diff.head);

interface Built {
  id: string; prefix: string; number: number | null; title: string; url: string | null; name?: string; repo: string;
  base: string; branch: string | null; add: number; del: number; files: number;
  errors: string[]; warns: string[]; report: string[];
  meta: string; sections: string; diffView: string; footer: string; links: string; data: PagePr;
}

function buildPr(guide: Guide, diff: Diff, index: number): Built {
  const errors: string[] = [], warns: string[] = [];
  const err = (m: string) => errors.push(m);
  const warn = (m: string) => warns.push(m);
  const FILES = new Map<string, DiffFile>(diff.files.map((f) => [f.path, f]));
  const pr = guide.pr ?? ({} as Guide['pr']);
  // On a page with several pull requests, every element id starts with the PR's own, so two guides' chapter ids
  // never meet; a page with one keeps the plain ids (#overview, #c-<id>).
  const id = `pr${pr.number ?? index + 1}`;
  const P = multi ? `${id}-` : '';

  // -------------------------------------------------------------- refs
  // "path:line" names a line on the new side, or on the old side for a removed line. A file the pull request does
  // not change links to GitHub at the head commit, and so does a line the page cannot show: one outside the hunks
  // of a file kept without its text. GitHub has no snapshot of a working tree, so its links go to the base instead.
  type Ref = { path: string; line: number; side?: 'o' | 'n'; external?: string };
  const repoUrl = String(pr.url ?? '').replace(/\/pull\/\d+.*$/, '') || diff.repo;
  const atHead = (path: string) => Bun.spawnSync(['git', '-C', checkout, 'cat-file', '-e', `${diff.head}:${path}`], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  const inHunks = (f: DiffFile, line: number, s: 'o' | 'n') => f.hunks.some((h) => h.lines.some((l) => (s === 'o' ? l[1] : l[2]) === line));
  const blob = (rev: string, path: string, line: number) => `${repoUrl}/blob/${rev}/${path}${line ? `#L${line}` : ''}`;
  const linkRev = linkRevOf(diff);

  function parseRef(ref: string, side: 'o' | 'n', where: string): Ref | null {
    const m = String(ref).match(/^(.+?)(?::(\d+))?$/);
    const line = m?.[2] ? Number(m[2]) : 0;
    const f = m && FILES.get(m[1]);
    if (!m || !f) {
      if (m && atHead(m[1])) {
        if (!repoUrl) { err(`${where}: ref "${ref}" names a file the pull request does not change, and there is no repository URL to link it to (set pr.url).`); return null; }
        return { path: m[1], line, external: blob(linkRev, m[1], line) };
      }
      err(`${where}: ref "${ref}" names a file that is neither in this pull request nor at its head in ${checkout} (pass --repo=<checkout>).`);
      return null;
    }
    const s = f.status === 'deleted' ? 'o' : f.status === 'added' ? 'n' : side;
    if (side === 'o' && f.status === 'added') { err(`${where}: ref "${ref}" points at the old side of an added file.`); return null; }
    const count = s === 'n' ? (f.newCount ?? f.new?.length) : (f.old?.length ?? f.oldCount);
    if (line && count != null && line > count) { err(`${where}: ref "${ref}" is past the end of the file (${count} lines).`); return null; }
    // The page shows a line outside the hunks only when it has the file's text.
    if (line && !f.new && !f.old && !inHunks(f, line, s)) {
      if (!repoUrl || diff.snapshotOf) { err(`${where}: ref "${ref}" is outside the hunks of a file kept without its text, and there is no ${repoUrl ? 'copy of this snapshot on GitHub' : 'repository URL'} to link it to.`); return null; }
      return { path: f.path, line, external: s === 'o' ? blob(diff.base, f.oldPath ?? f.path, line) : blob(diff.head, f.path, line) };
    }
    return { path: f.path, line, side: s };
  }
  /** A ref as a link: an in-page jump for a changed file, GitHub for any other. */
  function refLink(r: Ref, text: string, cls = '') {
    const title = `${r.path}${r.line ? `:${r.line}` : ''}`;
    if (r.external) return `<a class="${cls}" href="${esc(r.external)}" target="_blank" rel="noopener" title="${esc(title)} on GitHub">${text}</a>`;
    return `<a href="#" class="${cls}" data-ref="${esc(r.path)}" data-line="${r.line}" data-side="${r.side}" title="${esc(title)}">${text}</a>`;
  }

  // -------------------------------------------------------------- check the guide
  if (!pr.title) err('pr.title is missing. Copy the pull request\'s title.');
  if ((pr.number == null) !== (pr.url == null)) err('pr needs both number and url, or neither (for a branch with no pull request).');
  if (pr.url && !/^https:\/\//.test(pr.url)) err('pr.url must start with https://.');
  if (guide.name != null && (!String(guide.name).trim() || words(guide.name) > 5)) err('name is the page\'s name in the gallery: 2 to 4 words, such as "Webhook retries review".');
  if (!multi && pr.number == null && guide.name == null) warn('Give a guide with no pull request number a name (2 to 4 words); the page is called "Review of <branch>" otherwise.');
  if (pr.readOnly && diff.snapshotOf) err('pr.readOnly is for someone else\'s change; a snapshot of your working tree is yours.');
  if (guide.diffStyle != null && guide.diffStyle !== 'unified' && guide.diffStyle !== 'split') err('diffStyle must be "unified" or "split".');
  // the spec the change was built from: a thinkr design page, opened on its Spec view
  const spec = guide.spec;
  let specUrl = '';
  if (spec != null) {
    if (!/^https:\/\//.test(spec.url ?? '')) err('spec.url is the design page\'s link, starting with https://.');
    else specUrl = spec.url.includes('#') ? spec.url : spec.url + '#spec';
    if (spec.version != null && !(Number.isInteger(spec.version) && spec.version > 0)) err('spec.version is the design version the spec implements, a whole number.');
  }
  const ov = guide.overview ?? ({} as Guide['overview']);
  if (!ov.summary) err('overview.summary is missing: say what the pull request changes in 2 to 4 sentences.');
  else if (words(paras(ov.summary).join(' ')) > 80) warn(`overview.summary has ${words(paras(ov.summary).join(' '))} words. Keep it under 80; the chapters carry the detail.`);
  const steps = ov.steps ?? [];
  if (steps.length > 5) warn(`overview.steps has ${steps.length} items. Keep 2 to 5.`);
  steps.forEach((s, i) => { if (words(s) > 30) warn(`overview.steps[${i}] has ${words(s)} words. One line each.`); });
  if ('beforeAfter' in ov) err('overview.beforeAfter is gone: the overview draws the change as a diagram. Write overview.diagram instead (guide-format.md).');

  const chapters: Chapter[] = guide.chapters ?? [];
  if (!chapters.length) err('The guide has no chapters.');
  if (chapters.length > 12) warn(`The guide has ${chapters.length} chapters. Merge small ones; aim for 3 to 8.`);
  const ids = new Set<string>();
  const covered = new Map<string, Map<number, string[]>>(); // path → hunk id → chapter ids
  let sawLate = false, sawGenerated = false;
  const sel: { path: string; hunks: number[] | null }[][] = []; // per chapter
  for (const [i, ch] of chapters.entries()) {
    const where = `chapters[${i}]${ch.id ? ` (${ch.id})` : ''}`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(ch.id ?? '')) err(`${where}: id must be lower case letters, digits and dashes.`);
    if (ids.has(ch.id)) err(`${where}: id is used twice.`);
    ids.add(ch.id);
    if (!ch.title) err(`${where}: title is missing.`);
    else if (words(ch.title) > 9) warn(`${where}: the title has ${words(ch.title)} words. Name the idea in a few words.`);
    const kind = ch.kind ?? 'core';
    if (!KINDS.includes(kind)) err(`${where}: kind must be one of ${KINDS.join(', ')}.`);
    if (sawGenerated && kind !== 'generated') err(`${where}: generated chapters come last.`);
    if (sawLate && !LATE.has(kind)) err(`${where}: a ${kind} chapter comes after a database, tests or generated chapter. The core change comes first.`);
    if (LATE.has(kind)) sawLate = true;
    if (kind === 'generated') sawGenerated = true;
    if ('beforeAfter' in ch) err(`${where}: beforeAfter is gone: a chapter draws its change as a diagram. Write diagram instead (guide-format.md).`);
    const body = paras(ch.body);
    if (!body.length) err(`${where}: body is missing.`);
    const bw = body.reduce((n, p) => n + words(p), 0);
    if (bw > 110) warn(`${where}: the body has ${bw} words. Keep a chapter under 110; split the idea or cut what the code shows.`);
    const files: { path: string; hunks: number[] | null }[] = [];
    for (const entry of ch.files ?? []) {
      const path = typeof entry === 'string' ? entry : entry?.path;
      const f = FILES.get(path);
      if (!f) { err(`${where}: "${path}" is not a file in this pull request.`); continue; }
      let hunks = typeof entry === 'object' && entry.hunks ? entry.hunks : null;
      if (hunks) {
        const bad = hunks.filter((h) => !f.hunks.some((x) => x.id === h));
        if (bad.length) err(`${where}: ${path} has no hunk ${bad.join(', ')} (it has ${f.hunks.length}).`);
        hunks = hunks.filter((h) => !bad.includes(h));
        if (hunks.length === f.hunks.length) hunks = null;
      }
      if (f.kind === 'generated' && kind !== 'generated') warn(`${where}: ${path} looks generated; put it in a generated chapter at the end.`);
      if (!covered.has(path)) covered.set(path, new Map());
      const map = covered.get(path)!;
      if (!f.hunks.length) map.set(0, [...(map.get(0) ?? []), ch.id]);
      for (const h of hunks ?? f.hunks.map((x) => x.id)) map.set(h, [...(map.get(h) ?? []), ch.id]);
      files.push({ path, hunks });
    }
    if (!files.length) err(`${where}: files is empty. A chapter shows the code it explains.`);
    if (files.length > 10) warn(`${where}: ${files.length} files. A chapter is one idea; split it.`);
    sel.push(files);
  }
  for (const f of diff.files) {
    const map = covered.get(f.path);
    if (!map) { err(`${f.path} is in no chapter. Every file in the pull request belongs to one.`); continue; }
    for (const h of f.hunks) {
      const by = map.get(h.id);
      if (!by) err(`${f.path} hunk ${h.id} (L${h.newStart}, ${h.label || 'top of file'}) is in no chapter.`);
      else if (by.length > 1) warn(`${f.path} hunk ${h.id} is in ${by.length} chapters (${by.join(', ')}). Show it once.`);
    }
  }

  /** The chapter that shows a line, for the tooltip of a diagram node that refs it. */
  function chapterOf(ref: Ref): number | null {
    const f = FILES.get(ref.path)!;
    const hit = f.hunks.find((h) => {
      if (!ref.line) return false;
      const [s, e] = ref.side === 'o' ? [h.oldStart, h.oldStart + h.oldLines - 1] : [h.newStart, h.newStart + h.newLines - 1];
      return ref.line >= s && ref.line <= e;
    });
    const idx = sel.findIndex((files) => files.some((x) => x.path === ref.path && (!hit || !x.hunks || x.hunks.includes(hit.id))));
    return idx < 0 ? null : idx;
  }

  // -------------------------------------------------------------- inline text
  // Markdown subset: `code`, **bold**, *em*, [text](https://…) and [text](ref:path:line). Code spans are set aside
  // first, so bold or italic can wrap one, and `handlers[i](ctx)` is never read as a link.
  function inline(s: string) {
    const codes: string[] = [];
    const text = esc(String(s).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`));
    return text
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${esc(codes[+i])}</code>`);
  }
  function md(s: string, where: string) {
    const codes: string[] = [];
    const kept = String(s).replace(/`[^`]+`/g, (c) => `\u0001${codes.push(c) - 1}\u0001`);
    const back = (t: string) => t.replace(/\u0001(\d+)\u0001/g, (_, i: string) => codes[+i]);
    return kept.split(/(\[[^\]]+\]\([^)\s]+\))/).map((p) => {
      const m = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (!m) return inline(back(p));
      const [text, target] = [back(m[1]), back(m[2])];
      if (target.startsWith('ref:')) {
        const r = parseRef(target.slice(4), 'n', where);
        return r ? refLink(r, inline(text), 'ref') : inline(text);
      }
      if (!/^https:\/\//.test(target)) { err(`${where}: link "${target}" must start with https:// or ref:.`); return inline(text); }
      return `<a href="${esc(target)}" target="_blank" rel="noopener">${inline(text)}</a>`;
    }).join('');
  }

  // -------------------------------------------------------------- diagrams
  // Each section's diagram, drawn here with pele (kit/build/diagram.ts). The page holds an empty box for it; the
  // drawing rides in the data file, and the runtime fills the box as its section comes near.
  const drawings: Record<string, PageDiagram> = {};
  function diagram(dg: Diagram | undefined, key: string, where: string) {
    if (!dg || typeof dg !== 'object') { err(`${where} is missing. Every section draws its change: give it { "title": …, "mermaid": … }.`); return ''; }
    if (!String(dg.mermaid ?? '').trim()) { err(`${where}.mermaid is missing: the diagram's Mermaid source, such as "flowchart LR\\n  A[…] --> B[…]:::new".`); return ''; }
    const drawn = draw(String(dg.mermaid).trim(), `${id}-${key}`);
    if ('error' in drawn) { err(`${where}.mermaid: ${drawn.error}`); return ''; }
    if (dg.title != null && words(dg.title) > 14) warn(`${where}.title has ${words(dg.title)} words. One line names what the diagram shows.`);
    if (drawn.nodes.size > 14) warn(`${where}: ${drawn.nodes.size} nodes. Keep a diagram under 12; draw the path that changed.`);
    if (drawn.width > 960) warn(`${where}: the diagram is ${drawn.width} px wide, so it shrinks to fit its card. Shorten its labels, cut nodes, or draw it top to bottom (flowchart TD).`);
    if (drawn.type === 'flowchart' && !drawn.marks.length) warn(`${where}: no node is marked. Mark what the pull request adds, changes or removes with :::new, :::changed or :::removed.`);
    const refs: Record<string, DiagramRef> = {};
    for (const [node, ref] of Object.entries(dg.refs ?? {})) {
      const w = `${where}.refs.${node}`;
      if (!drawn.nodes.has(node)) { err(`${w}: the diagram has no node "${node}". Its nodes: ${[...drawn.nodes.keys()].join(', ') || 'none'}.`); continue; }
      // A removed node stands for code that is gone, so its line is on the old side, unless its file is new (a
      // migration that drops an index).
      const gone = drawn.nodes.get(node) === 'removed' && FILES.get(String(ref).replace(/:\d+$/, ''))?.status !== 'added';
      const r = parseRef(ref, gone ? 'o' : 'n', w);
      if (!r) continue;
      const at = r.external ? null : chapterOf(r);
      const ch = at != null ? chapters[at] : null;
      refs[node] = {
        path: r.path, line: r.line, ...(r.side ? { side: r.side } : {}), ...(ch ? { ch: ch.id } : {}), ...(r.external ? { url: r.external } : {}),
        title: `${r.path.split('/').pop()}${r.line ? ` ${r.line}` : ''}${ch ? `, chapter ${pad2(at! + 1)}: ${ch.title}` : r.external ? ', on GitHub' : ''}`,
      };
    }
    drawings[key] = { html: drawn.body, ...(Object.keys(refs).length ? { refs } : {}) };
    const keys = drawn.marks.map((m) => `<span class="gr-dia-key is-${m}">${MARK_LABEL[m]}</span>`).join('');
    return `<div class="gr-card gr-dia"><header><button type="button" class="gr-fold" aria-label="Fold the diagram" aria-expanded="true">${CHEV}</button>`
      + `<span class="ttl">${esc(dg.title ?? 'Diagram')}</span><span class="sp"></span>${keys ? `<span class="gr-dia-keys">${keys}</span>` : ''}</header>`
      + `<div class="k-dia" data-dia="${esc(key)}"></div></div>`;
  }

  // -------------------------------------------------------------- state table
  function table(t: StateTable | undefined, where: string) {
    if (!t) return '';
    const cols = t.columns ?? [];
    if (!cols.length) { err(`${where}: columns is missing.`); return ''; }
    const rows = (t.rows ?? []).map((r, i) => {
      const cells = Array.isArray(r) ? r : r.cells;
      if (!Array.isArray(cells) || cells.length !== cols.length) err(`${where}.rows[${i}]: give ${cols.length} cells.`);
      const cls = !Array.isArray(r) && r.new ? 'new' : !Array.isArray(r) && r.gone ? 'gone' : '';
      return `<tr class="${cls}">${(cells ?? []).map((c) => `<td>${md(c, where)}</td>`).join('')}</tr>`;
    }).join('');
    let ref = '';
    if (t.ref) {
      const r = parseRef(t.ref, 'n', where);
      if (r) ref = refLink(r, `${esc(r.path.split('/').pop())}${r.line ? ` ${r.line}` : ''}`);
    }
    return `<div class="gr-table"><header><b>${esc(t.title ?? 'State table')}</b>${t.caption ? `<span>${esc(t.caption)}</span>` : ''}${ref}</header>`
      + `<div class="scroll"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
      + (t.note ? `<footer>${md(t.note, where)}</footer>` : '') + '</div>';
  }

  // -------------------------------------------------------------- sections
  function fileList(files: { path: string; hunks: number[] | null }[]) {
    return `<ul class="gr-filelist">${files.map(({ path, hunks }) => {
      const f = FILES.get(path)!;
      const name = path.split('/').pop()!;
      const dir = path.slice(0, path.length - name.length);
      let a = 0, d = 0;
      for (const h of f.hunks) if (!hunks || hunks.includes(h.id)) for (const l of h.lines) { if (l[0] === '+') a++; else if (l[0] === '-') d++; }
      const part = hunks ? '<span class="part">part</span>' : '';
      return `<li><button type="button" data-goto="${esc(path)}"><span class="gr-lang">${esc(chip(path))}</span><span class="name">${esc(name)}</span><span class="dir">${esc(dir)}</span><span class="stat">${part}${statHtml(a, d)}</span></button></li>`;
    }).join('')}</ul>`;
  }
  const n = chapters.length;
  const sections: string[] = [];
  sections.push(`<section class="gr-sec" id="${P}overview" data-title="Overview"><div class="gr-text"><h2>Overview</h2><div class="gr-body">`
    + paras(ov.summary).map((p) => `<p>${md(p, 'overview.summary')}</p>`).join('')
    + (steps.length ? `<ol>${steps.map((s, i) => `<li>${md(s, `overview.steps[${i}]`)}</li>`).join('')}</ol>` : '')
    + `</div></div><div class="gr-code-col">${diagram(ov.diagram, 'overview', 'overview.diagram')}</div></section>`);
  let labelStarted = false;
  chapters.forEach((ch, i) => {
    const kind = ch.kind ?? 'core';
    const where = `chapters[${i}]`;
    const startLabel = LATE.has(kind) && !labelStarted;
    if (startLabel) labelStarted = true;
    sections.push(`<section class="gr-sec${startLabel ? ' label-start' : ''}" id="${P}c-${esc(ch.id)}" data-chapter="${esc(ch.id)}" data-title="${esc(ch.title)}">`
      + `<div class="gr-text"><h2>${esc(ch.title)}</h2><div class="gr-chmeta"><span class="gr-count">${pad2(i + 1)} / ${pad2(n)}</span>`
      + (LABEL[kind] ? `<span class="gr-kind">${LABEL[kind]}</span>` : '')
      + `<label class="gr-check"><input type="checkbox" data-review-chapter="${esc(ch.id)}"> Reviewed</label></div>`
      + `<div class="gr-body">${paras(ch.body).map((p) => `<p>${md(p, `${where}.body`)}</p>`).join('')}</div>`
      + table(ch.table, `${where}.table`) + fileList(sel[i] ?? []) + '</div>'
      + `<div class="gr-code-col">${diagram(ch.diagram, `c-${ch.id}`, `${where}.diagram`)}<div class="gr-files" data-chapter="${esc(ch.id)}"></div></div></section>`);
  });

  const links = (guide.links ?? []).map((l, i) => {
    if (!/^https:\/\//.test(l.href ?? '')) { err(`links[${i}]: href must start with https://.`); return ''; }
    return `<a class="k-btn is-sm" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`;
  }).join('');
  const total = diff.files.reduce((s, f) => [s[0] + f.add, s[1] + f.del], [0, 0]);
  const headShort = diff.head.slice(0, 7);
  // git log lists the newest commit first; the pull request's author wrote the oldest.
  const author = pr.author ?? diff.commits?.at(-1)?.author ?? '';
  const base = pr.base ?? (diff.baseRef ?? 'main').replace(/^origin\//, '');
  const branch = pr.head ?? diff.branch;
  const num = pr.number != null ? `#${esc(pr.number)}` : '';
  const headLink = repoUrl ? `<a class="mono" href="${esc(repoUrl)}/commit/${diff.head}" target="_blank" rel="noopener">${headShort}</a>` : `<span class="mono">${headShort}</span>`;
  const meta = [
    author ? `<span><span class="gr-avatar">${esc(author[0])}</span>${esc(author)}</span>` : '',
    pr.url ? `<a href="${esc(pr.url)}" target="_blank" rel="noopener">${num}</a>` : '',
    branch ? `<span class="mono">${esc(base)} ← ${esc(branch)}</span>` : '',
    `<span>${diff.files.length} file${diff.files.length === 1 ? '' : 's'}</span>`,
    `<span>${statHtml(total[0], total[1])}</span>`,
    `<span>written for ${diff.snapshotOf ? `uncommitted changes on <span class="mono">${diff.snapshotOf.slice(0, 7)}</span>` : headLink}</span>`,
    pr.readOnly ? '<span title="Claude answers comments on this page, and changes no code.">read-only</span>' : '',
    specUrl ? `<span>built from <a href="${esc(specUrl)}" target="_blank" rel="noopener">its spec${spec?.version ? `, design v${spec.version}` : ''}</a></span>` : '',
  ].filter(Boolean).join('');
  const ofWhat = pr.url ? `<a href="${esc(pr.url)}" target="_blank" rel="noopener">${num}</a>` : esc(branch ?? 'the branch');
  const keys = `<kbd>j</kbd> <kbd>k</kbd> next and previous chapter · <kbd>r</kbd> mark the chapter reviewed${multi ? ' · <kbd>[</kbd> <kbd>]</kbd> previous and next pull request' : ''} · <kbd>b</kbd> chapter text or file tree · <kbd>c</kbd> show or hide comments · shift-click a fold to open it all`;
  const hunkCount = diff.files.reduce((s, f) => s + f.hunks.length, 0);
  const report = [
    `guide ${num || esc(pr.title)}: ${n} chapters, ${diff.files.length} files, ${hunkCount} hunks, ${Object.keys(drawings).length} diagrams`,
    ...chapters.map((ch, i) => `  ${pad2(i + 1)} ${(ch.kind ?? 'core').padEnd(9)} ${String(paras(ch.body).reduce((s, p) => s + words(p), 0)).padStart(3)} words  ${ch.title}`),
  ];
  const tag = multi ? `${num || id}: ` : '';
  return {
    id, prefix: P, number: pr.number ?? null, title: pr.title, url: pr.url ?? null, name: guide.name, repo: repoUrl,
    base, branch, add: total[0], del: total[1], files: diff.files.length,
    errors: errors.map((e) => tag + e), warns: warns.map((w) => tag + w), report,
    meta, sections: sections.join('\n'),
    diffView: `<div class="gr-view gr-diff" hidden><aside class="gr-tree"><h3>${diff.files.length} files</h3><div class="gr-tree-host"></div></aside><div class="gr-diff-cards"></div></div>`,
    footer: `<footer class="gr-foot"><span>Guided review of ${ofWhat} at ${headShort}, ${diff.base.slice(0, 7)}..${headShort}</span><span>${keys}</span></footer>`,
    links: (specUrl ? `<a class="k-btn is-sm" href="${esc(specUrl)}" target="_blank" rel="noopener" title="The spec this change was built from">Spec<span aria-hidden="true">↗</span></a>` : '')
      + (links ? `<span class="gr-links">${links}</span>` : '')
      + (pr.url ? `<a class="k-btn is-sm is-primary" href="${esc(pr.url)}" target="_blank" rel="noopener"><span>Open ${num}<span class="long"> on GitHub</span></span><span aria-hidden="true">↗</span></a>` : ''),
    data: {
      id, prefix: P, key: `gr:${pr.number ?? branch ?? diff.snapshotOf ?? diff.head}`, number: pr.number ?? null, title: pr.title, head: diff.head,
      ...(pr.readOnly ? { mode: 'read-only' as const } : diff.snapshotOf ? { mode: 'uncommitted' as const } : {}),
      ...(repoUrl ? { blob: `${repoUrl}/blob/${linkRev}/` } : {}),
      chapters: chapters.map((c, i) => ({ id: c.id, title: c.title, files: sel[i] ?? [] })), files: diff.files, diagrams: drawings,
    },
  };
}

// ---------------------------------------------------------------- every pull request
const prs = inputs.map((x, i) => buildPr(x.guide, x.diff, i));
// Markdown files are rendered here, with their change marked, so the page only shows them (scripts/markdown.ts).
for (const [i, p] of prs.entries()) {
  const { diff } = inputs[i];
  const md = await previews(diff.files, { repo: p.repo, base: diff.base, head: diff.head, checkout, link: linkRevOf(diff) });
  p.warns.push(...md.warns.map((w) => (multi ? `${p.number != null ? `#${p.number}` : p.id}: ` : '') + w));
  if (md.out.size) p.data.files = diff.files.map((f) => (md.out.has(f.path) ? { ...f, preview: md.out.get(f.path)! } : f));
  p.report[0] += `, ${md.out.size} Markdown preview${md.out.size === 1 ? '' : 's'}`;
}
const errors = prs.flatMap((p) => p.errors);
const warns = prs.flatMap((p) => p.warns);
const seen = new Map<string, number>();
for (const p of prs) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
for (const [id, k] of seen) if (k > 1) errors.push(`stack.json lists ${id.replace(/^pr/, '#')} ${k} times. List each pull request once.`);
const diffStyle = stack?.diffStyle ?? inputs[0].guide.diffStyle ?? 'unified';
if (stack?.diffStyle != null && !['unified', 'split'].includes(stack.diffStyle)) errors.push('stack.json: diffStyle must be "unified" or "split".');
if (stack?.name != null && (!String(stack.name).trim() || words(stack.name) > 5)) errors.push('stack.json: name is the page\'s name in the gallery: 2 to 4 words, such as "Webhook retries stack".');
// A stack: each pull request's base is the branch of the one before it.
const stacked = multi && prs.every((p, i) => i === 0 || (!!prs[i - 1].branch && p.base === prs[i - 1].branch));

for (const p of prs) for (const line of p.report) console.log(line);
if (multi) console.log(`page: ${prs.length} pull requests${stacked ? ', stacked' : ''}`);
for (const w of warns) console.log(`  warn  ${w}`);
for (const e of errors) console.log(`  error ${e}`);
if (errors.length) { console.log(`${errors.length} error(s). Nothing written.`); process.exit(1); }
if (flag('check')) { console.log(`ok    ${warns.length} warning(s)`); process.exit(0); }

// ---------------------------------------------------------------- the picker
// With several pull requests the title is a menu of them, in the stack's order, each with its branches and how many
// of its chapters the reader has marked.
function picker(self: Built, i: number) {
  if (!multi) return `<h1>${esc(self.title)}</h1>`;
  const items = prs.map((p, k) => `<button type="button" role="option" class="gr-pick-item" data-pick="${p.id}" aria-selected="${p === self}">`
    + `<span class="i">${k + 1}</span><span class="tx"><b>${p.number != null ? `<span class="n">#${p.number}</span> ` : ''}${esc(p.title)}</b>`
    + `<span class="sub">${p.branch ? `<span class="mono">${esc(p.base)} ← ${esc(p.branch)}</span>` : ''}<span>${p.files} file${p.files === 1 ? '' : 's'}</span><span>${statHtml(p.add, p.del)}</span></span></span>`
    + `<span class="pg" data-progress-of="${p.id}"></span></button>`).join('');
  return `<div class="gr-pick"><h1><button type="button" class="gr-pick-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${self.id}-picks">`
    + `<span class="t">${esc(self.title)}</span><span class="gr-pick-n">${i + 1} of ${prs.length}</span>${CHEV}</button></h1>`
    + `<div class="gr-picklist${stacked ? ' stacked' : ''}" id="${self.id}-picks" role="listbox" aria-label="Pull requests" hidden>`
    + `<div class="gr-pick-head"><span>${stacked ? `Stack of ${prs.length}, from its base` : `${prs.length} pull requests`}</span><span><kbd>[</kbd> <kbd>]</kbd></span></div>${items}</div></div>`;
}

// Each pull request's parts carry data-pr, and only the chosen one's show: its progress and links in the bar, and its
// panel (header, guide, diff, footer). The tabs, the layout switch, the sound and the comments stay. The comments
// margin fills in at the right of the panel on screen.
const hide = (i: number) => (i ? ' hidden' : '');
const markup = `<div class="k-bar gr-bar"><div class="gr-wrap">
<button type="button" class="k-btn is-ghost is-icon is-sm gr-panel-toggle" data-panel-toggle aria-expanded="true" aria-label="Hide the chapter text" title="Hide the chapter text (b)">${PANEL}</button>
<div class="k-seg is-sm gr-tabs" role="tablist"><button type="button" class="gr-tab" role="tab" data-view="guide" aria-selected="true">Guide</button><button type="button" class="gr-tab" role="tab" data-view="diff" aria-selected="false">Diff</button></div>
<span class="gr-spacer"></span>${prs.map((p, i) => `<span class="gr-progress" data-pr="${p.id}"${hide(i)}></span>`).join('')}<span class="k-seg is-sm gr-seg" role="group" aria-label="Diff layout"><button type="button" data-diff-style="unified" aria-pressed="${diffStyle === 'unified'}">Unified</button><button type="button" data-diff-style="split" aria-pressed="${diffStyle === 'split'}">Split</button></span>${themeButton('k-btn is-ghost is-icon is-sm')}${soundButton('k-btn is-ghost is-icon is-sm')}<span class="gr-bell-wrap"><button type="button" class="k-btn is-ghost is-icon is-sm gr-bell" data-bell aria-haspopup="dialog" aria-expanded="false" aria-controls="gr-inbox" aria-label="Unread answers from Claude" title="Unread answers from Claude">${BELL}<span class="gr-bell-n" hidden></span></button><div class="gr-inbox" id="gr-inbox" role="dialog" aria-label="Unread answers from Claude" data-uncommentable hidden></div></span><button type="button" class="k-btn is-sm gr-note-toggle" data-notes-toggle aria-pressed="true" aria-label="Hide comments" title="Hide comments (c)">${COMMENT}<span class="long">Comments</span><span class="gr-note-count" hidden>0</span></button><button type="button" class="k-btn is-sm gr-send" data-note-send hidden><span class="n">Send</span><span class="long">to Claude</span></button>${prs.map((p, i) => (p.links ? `<span class="gr-barlinks" data-pr="${p.id}"${hide(i)}>${p.links}</span>` : '')).join('')}
</div></div>
<div class="gr-wrap">
${prs.map((p, i) => `<div class="gr-pr" id="${multi ? p.id : 'gr-pr'}" data-pr="${p.id}"${hide(i)}>
<header class="gr-head">${picker(p, i)}<div class="gr-meta">${p.meta}<button type="button" class="gr-head-note" data-note-general title="Comment on the pull request as a whole">${COMMENT}Comment</button></div></header>
<main>
<div class="gr-view gr-guide">
${p.sections}
</div>
${p.diffView}
</main>
${p.footer}
</div>`).join('\n')}
</div>
<nav class="gr-rail" aria-label="Chapters"></nav>`;

// ---------------------------------------------------------------- pack
const data: PageData = {
  libs: { diffs: libmap.diffs.url, trees: libmap.trees.url },
  diffStyle,
  prs: prs.map((p) => p.data),
};
const [css, js] = await Promise.all([styles(join(RT, 'guide.css')), runtime(join(RT, 'index.ts'), ['select', 'deselect', 'nav', 'toggle', 'reveal', 'send'])]);
const { at, files } = await assets(stem, { 'guided-review.css': css, 'data.js': `window.GR_DATA = ${JSON.stringify(data)};\n`, 'guided-review.js': js });
// The title first (the viewer reads it from the first 8 KB), then preloads so the libraries download while the page
// parses; the data and the runtime go after the markup they fill.
const one = prs[0];
const nums = prs.filter((p) => p.number != null).map((p) => `#${p.number}`);
const name = multi
  ? stack?.name ?? (nums.length === prs.length ? `Guided review ${nums[0]}–${nums.at(-1)}` : `Review of ${prs.length} pull requests`)
  : one.name ?? (one.number != null ? `Guided review #${one.number}` : `Review of ${one.branch ?? inputs[0].diff.head.slice(0, 7)}`);
const page = `<title>${esc(name)}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${THEME}\n${preloads(['diffs', 'trees'], libmap)}\n${FONTS}\n`
  + `<link rel="stylesheet" href="${at['guided-review.css']}">\n${markup}\n`
  + `<script src="${at['data.js']}"></script>\n<script src="${at['guided-review.js']}"></script>\n`;
await Bun.write(`${stem}.artifact.html`, page);
await Bun.write(`${stem}.preview.html`, preview(page));
console.log(`ok    ${warns.length} warning(s), ${Math.round(page.length / 1024)} KB\n${publishLines(stem, files)}\n      preview: ${stem}.preview.html`);
