#!/usr/bin/env bun
/* Check a thinkr page and pack it for the Artifact tool.

     bun scripts/build.ts page.html            # check, then write page.artifact.html, page.files/ and page.preview.html
     bun scripts/build.ts page.html --refresh  # also refresh runtime/libs.json from npm first
     bun scripts/build.ts --refresh [--major]  # refresh libs only

   Libraries resolve to the newest stable release that is at least 14 days old (the artifact rule). A refresh
   runs on its own when libs.json is more than 7 days old, and is skipped quietly when offline.

   Size: the page holds only its content. The stylesheet and the runtime (with its sounds) are files published
   beside it (page.files/, passed to the Artifact tool as `files`), and Geist comes from Google Fonts.
   Speed: math, code highlighting and Mermaid diagrams are rendered here (no MathJax, highlight.js or diagram
   library in the page), and every library the page uses is preloaded from the head, its whole import graph at once,
   so nothing waits on a request chain. Needs `bun install` in this skill's directory.

   A design's spec, <page>.spec.md beside the page, is checked and rendered into the page's Spec view, and published
   beside it as spec.md (scripts/spec.ts).

   The font link, the shared stylesheet, the sounds, the library pinning and the diagrams come from the kit
   (kit/build/). */
import { join, resolve } from 'node:path';
import { FONTS, THEME, assets, json, preview, publishLines, runtime, styles } from '../kit/build/page';
import { type LibMap, libs, preloads } from '../kit/build/libs';
import { need as needIn } from '../kit/build/deps';
import { diagrams } from '../kit/build/diagram';
import { type Node, parse } from './tree';
import { type History, KINDS, track } from './changes';
import { type Spec, readSpec } from './spec';

const RT = join(import.meta.dir, '..', 'runtime');
const HOSTS = ['https://cdnjs.cloudflare.com/', 'https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/'];
const ID = /^[A-Za-z][A-Za-z0-9_.-]*$/;

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Import a build dependency, installing them once on a fresh copy (kit/build/deps.ts). */
const need = <T>(spec: string) => needIn<T>(spec, join(import.meta.dir, '..'));

// ---------------------------------------------------------------- libraries
/** The libraries a page needs: motion always (the runtime animates with it), plus what its scripts load. */
function used(scripts: string, libmap: LibMap): string[] {
  const out = new Set(['motion']);
  if (/\.vgpu\s*\(/.test(scripts)) out.add('vgpu');
  for (const [, name] of scripts.matchAll(/load\(\s*['"`]([\w-]+)['"`]/g)) if (libmap[name]) out.add(name);
  for (const name of [...out]) for (const dep of libmap[name].deps ?? []) out.add(dep);
  return [...out];
}

// math and code are rendered here, so the page never waits for MathJax (2 MB) or highlight.js
const PROTECT = /(<(pre|code|script|style|svg|textarea)\b[\s\S]*?<\/\2>)/;

async function renderMath(html: string): Promise<{ html: string; css: string }> {
  const re = new RegExp(PROTECT.source + /|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/.source, 'g');
  if (![...html.matchAll(re)].some((m) => !m[1])) return { html, css: '' };
  const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = await Promise.all([
    need<any>('mathjax-full/js/mathjax.js'), need<any>('mathjax-full/js/input/tex.js'), need<any>('mathjax-full/js/output/svg.js'),
    need<any>('mathjax-full/js/adaptors/liteAdaptor.js'), need<any>('mathjax-full/js/handlers/html.js'), need<any>('mathjax-full/js/input/tex/AllPackages.js'),
  ]);
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: AllPackages, macros: { col: ['\\class{c#1}{#2}', 2], R: '\\mathbb{R}', N: '\\mathbb{N}', E: '\\mathbb{E}' } });
  const doc = mathjax.document('', { InputJax: tex, OutputJax: new SVG({ fontCache: 'local' }) });
  const out = html.replace(re, (m, prot, _tag, d1, d2, inline) => {
    if (prot) return prot;
    const svg = adaptor.outerHTML(doc.convert(decode(d1 ?? d2 ?? inline).trim(), { display: inline === undefined }));
    if (svg.includes('data-mjx-error')) console.log(`  warn  TeX error in: ${m.slice(0, 60)}`);
    return svg;
  });
  return { html: out, css: adaptor.textContent(doc.outputJax.styleSheet(doc)) };
}

async function highlight(html: string) {
  const re = /(<code\b[^>]*\bclass="[^"]*\blanguage-([\w+-]+)[^"]*"[^>]*>)([\s\S]*?)(<\/code>)/g;
  if (!re.test(html)) return html;
  const hljs = (await need<any>('highlight.js')).default;
  return html.replace(re, (m, open: string, lang: string, code: string, close: string) => {
    if (!hljs.getLanguage(lang)) { console.log(`  warn  no highlighting for language-${lang}`); return m; }
    return open + hljs.highlight(decode(code), { language: lang, ignoreIllegals: true }).value + close;
  });
}

/** Each <pre class="mermaid"> drawn into SVG with pele (kit/build/diagram.ts), in the page's colors. The artifact
    viewer draws a mermaid block itself, so none stays in the page. The block's other attributes (an id, its change
    marks) move to the drawing's box. A diagram pele cannot read is an error, with its line in the page, or its
    number in the spec (`where`). */
async function drawDiagrams(html: string, errors: string[], where = '') {
  const re = /<pre\b([^>]*\bclass="[^"]*\bmermaid\b[^"]*"[^>]*)>([\s\S]*?)<\/pre>/g;
  if (!re.test(html)) return html;
  const draw = await diagrams(join(import.meta.dir, '..'));
  let n = 0;
  return html.replace(re, (block, attrs: string, source: string, at: number) => {
    const d = draw(decode(source).trim(), `t-dia-${where ? where + '-' : ''}${++n}`);
    if ('error' in d) { errors.push(`${where ? `${where}: diagram ${n}` : `line ${html.slice(0, at).split('\n').length}: <pre class="mermaid">`}: ${d.error}`); return block; }
    const box = attrs.replace(/\bclass="([^"]*)"/, (_, c: string) => `class="${['k-dia', ...c.split(/\s+/).filter((x) => x && x !== 'mermaid')].join(' ')}"`);
    return `<div${box}>${d.body}</div>`;
  });
}

// ---------------------------------------------------------------- checks
function check(src: string, nodes: Node[], spec: boolean) {
  const errors: string[] = [], warns: string[] = [];
  const by = (tag: string) => nodes.filter((n) => n.tag === tag);

  const title = /<title>([\s\S]*?)<\/title>/.exec(src.slice(0, 8192));
  if (!title) errors.push('No <title> in the first 8 KB. Put <title>Name</title> at the top.');
  else if (/\s[-–—|]\s|:\s/.test(title[1]) || title[1].trim().split(/\s+/).length > 6)
    warns.push(`Title "${title[1].trim()}" reads like a caption. Use a 2 to 4 word name.`);
  for (const t of ['!doctype', '<html', '<head', '<body'])
    if (new RegExp(t.replace('!', '<!') + '[\\s>]', 'i').test(src)) errors.push(`Remove ${t}: the artifact viewer adds the document shell.`);

  const pages = by('t-page');
  if (pages.length !== 1) { errors.push(`Need exactly one <t-page>, found ${pages.length}.`); return { errors, warns, mode: null, version: 0 }; }
  // mode="plan" is the old name of design, and still builds
  const mode = pages[0].attrs.mode === 'plan' ? 'design' : pages[0].attrs.mode;
  if (mode !== 'design' && mode !== 'explain') errors.push('<t-page mode="design|explain"> is required.');
  if (!/^\d+$/.test(pages[0].attrs.version ?? '')) errors.push('<t-page version="N"> is required. Start at 1; add 1 on each republish.');
  const version = +(pages[0].attrs.version ?? 1);
  if (!by('h1').length) errors.push('Add a <header> with an <h1> and a <p class="lede">.');

  const ids = new Map<string, number>();
  for (const n of nodes) {
    const id = n.attrs.id;
    if (!id) continue;
    if (ids.has(id)) errors.push(`Duplicate id "${id}" (lines ${ids.get(id)} and ${n.line}).`);
    ids.set(id, n.line);
  }

  const qs = by('t-question');
  for (const q of qs) {
    const { attrs: a, line } = q, qid = a.id, typ = a.type ?? 'single';
    if (!qid || !ID.test(qid)) errors.push(`line ${line}: <t-question> needs a stable id (letters, digits, - _ .).`);
    if (!['single', 'multi', 'text'].includes(typ)) errors.push(`line ${line}: type="${typ}" must be single, multi or text.`);
    const prompt = q.kids.find((k) => k.tag === 'p');
    if (!prompt) errors.push(`line ${line}: <t-question id="${qid}"> needs its question as the first <p>.`);
    else if (prompt.words > 5 && !a.toc) warns.push(`line ${line}: give "${qid}" a short toc="…" label (2 to 4 words) for "On this page".`);
    const opts = q.kids.filter((k) => k.tag === 't-option');
    const vals = opts.map((k) => k.attrs.value);
    if (typ !== 'text') {
      if (vals.length < 2) errors.push(`line ${line}: "${qid}" needs at least 2 <t-option>s.`);
      if (vals.includes(undefined as never) || new Set(vals).size !== vals.length) errors.push(`line ${line}: every <t-option> in "${qid}" needs a unique value.`);
      if (vals.includes('other')) errors.push(`line ${line}: value "other" is reserved for the Other row.`);
    }
    const rec = a.recommended;
    if (rec && !vals.includes(rec)) errors.push(`line ${line}: recommended="${rec}" is not an option value of "${qid}".`);
    const ans = (a.answer ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const v of ans) if (!vals.includes(v)) errors.push(`line ${line}: answer="${v}" is not an option value of "${qid}".`);
    if (typ === 'single' && ans.length > 1) errors.push(`line ${line}: a single-choice check has one answer.`);
    const mx = a.max;
    if (mx && (typ !== 'multi' || !/^\d+$/.test(mx) || +mx < 1 || +mx >= vals.length))
      errors.push(`line ${line}: max="${mx}" works only on type="multi", between 1 and the option count minus 1.`);
    if (mode === 'design' && !ans.length && typ !== 'text') {
      if (!rec) warns.push(`line ${line}: mark your pick in "${qid}" with recommended="value".`);
      if (opts.some((o) => !o.kids.some((c) => c.tag === 'small'))) warns.push(`line ${line}: give each option of "${qid}" a <small> line with its consequence.`);
    }
  }

  if (mode === 'design') {
    // decided questions leave the page, so a later version may have none; a spec needs every one decided
    const open = qs.filter((q) => !('answer' in q.attrs));
    if (spec && open.length) errors.push(`A spec is written once every question is decided, and ${open.length === 1 ? '1 is' : `${open.length} are`} still open (${open.map((q) => q.attrs.id).join(', ')}). Decide ${open.length === 1 ? 'it' : 'them'} first, or move the spec aside.`);
    else if (!spec && !open.length && version === 1) errors.push('A design needs at least one <t-question> for the reader to answer.');
    if (qs.length > 7) warns.push(`${qs.length} questions. Ask only about forks that change what you build (2 to 5).`);
  } else if (mode === 'explain') {
    if (!by('t-figure').length) errors.push('An explainer is built on figures. Add at least one <t-figure>.');
    if (qs.some((q) => !('answer' in q.attrs))) warns.push('Explainer questions without answer="..." go nowhere. Use answer= for self-checks, or make it a design.');
    if (spec) errors.push('A spec belongs to a design. Move the spec aside, or make the page mode="design".');
  }

  for (const f of by('t-figure')) {
    if (!f.attrs.alt) errors.push(`line ${f.line}: <t-figure> needs alt="what it shows".`);
    if (!f.kids.some((k) => k.tag === 'figcaption')) errors.push(`line ${f.line}: <t-figure> needs a <figcaption> that says what to notice.`);
  }
  for (const n of by('t-notes'))
    errors.push(`line ${n.line}: remove <t-notes>. The message box in the Send feedback / Approve design panel replaces it.`);

  // changes: one <t-amends> list of what each version changed and why
  if (mode === 'explain' && by('t-amend').length) errors.push('Remove <t-amends>: the Changes list is for designs.');
  for (const a of by('t-amend')) {
    const v = a.attrs.version, kind = a.attrs.kind;
    if (a.parents.at(-1) !== 't-amends') errors.push(`line ${a.line}: put <t-amend> inside the page's one <t-amends>.`);
    if (!/^\d+$/.test(v ?? '') || +v < 2 || +v > version) errors.push(`line ${a.line}: <t-amend version="N"> names the version the change landed in, from 2 to ${version}.`);
    if (!KINDS.includes(kind)) errors.push(`line ${a.line}: <t-amend kind="${kind ?? ''}"> must be ${KINDS.join(', ')}.`);
    if (!a.words) errors.push(`line ${a.line}: <t-amend> needs a sentence: what changed, and why.`);
    if (!a.attrs.label) errors.push(`line ${a.line}: give the <t-amend> a label="…": the change in 2 to 6 words, its one-line row in Changes.`);
    else if (a.attrs.label.trim().split(/\s+/).length > 8) warns.push(`line ${a.line}: label="${a.attrs.label}" is long for a one-line row. Use 2 to 6 words.`);
    if (kind === 'answer' && (!a.attrs.re || !a.attrs.answer))
      errors.push(`line ${a.line}: an answer's <t-amend> needs re="…" (the question, word for word) and answer="…" (the reader's answer), so the reader sees what the answer was for.`);
    else if (kind !== 'claude' && kind !== 'answer' && !a.attrs.re) warns.push(`line ${a.line}: give the <t-amend> a re="…": the comment or message it answers, short.`);
    if (a.attrs.answer && kind !== 'answer') warns.push(`line ${a.line}: answer="…" is for kind="answer". Put what was said in re="…".`);
  }
  if (by('t-amends').length > 1) errors.push('Use one <t-amends> per page, right after the <header>.');
  for (const [re, what] of [[/<t-removed\b/, '<t-removed>'], [/\sdata-(v|amend)="/, 'data-v and data-amend'], [/<del\s+data-t=/, '<del data-t>']] as const)
    if (re.test(src)) errors.push(`Remove ${what} from the page: the build writes the change marks. Edit the page source, not a built file.`);

  // a long run of prose with nothing to look at
  const VISUAL = new Set(['t-figure', 't-question', 'pre', 'table', 't-callout']);
  for (const s of by('section')) {
    const words = s.kids.filter((k) => ['p', 'ul', 'ol', 'blockquote'].includes(k.tag)).reduce((t, k) => t + k.words, 0);
    if (words > 160 && !s.kids.some((k) => VISUAL.has(k.tag))) warns.push(`line ${s.line}: section has ${words} words and nothing to look at. Draw it.`);
  }

  for (const [, url] of src.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
    if (!HOSTS.some((h) => url.startsWith(h))) errors.push(`Script host not allowed: ${url}. Use cdnjs, cdn.jsdelivr.net/npm or unpkg, or thinkr.load().`);
    else if (!/[@/]\d+\.\d+\.\d+/.test(url)) errors.push(`Pin an exact version: ${url}`);
  }
  for (const [, href] of src.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g))
    errors.push(`Remove the stylesheet link ${href}: it blocks the first paint. Geist is built in; put page styles in <style>.`);
  for (const [, name] of src.matchAll(/load\(\s*['"`](hljs|mathjax)['"`]/g))
    errors.push(`load('${name}') is gone: code highlighting and math are rendered at build time. Remove the call.`);
  const banned: [RegExp, string][] = [
    [/\balert\(|\bconfirm\(|\bprompt\(/, 'alert/confirm/prompt do nothing in artifacts. Build the step into the page.'],
    [/<iframe|<object|<embed/, 'Embeds are blocked in artifacts. Link out instead.'],
    [/window\.print\(/, 'print() does nothing in artifacts.'],
    [/fetch\(\s*['"`]https?:/, 'fetch() to other sites is blocked. Put data in the page.'],
    [/<img[^>]+src="https?:/, 'Remote images are blocked. Use inline SVG or a data: URI.'],
  ];
  for (const [re, msg] of banned) if (re.test(src)) errors.push(msg);
  return { errors, warns, mode, version };
}

// ---------------------------------------------------------------- pack
/** Page scripts are TypeScript: strip the types, keep the code (imports of types vanish). */
function transpile(scripts: string) {
  const ts = new Bun.Transpiler({ loader: 'ts', target: 'browser' });
  return scripts.replace(/(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open: string, code: string, close: string) => {
    try { return open.replace(/\s(lang|type)="ts"/, (m, a) => (a === 'type' ? ' type="module"' : '')) + '\n' + ts.transformSync(code) + close; }
    catch (e) { console.log('  error page script: ' + (e as Error).message); process.exit(1); }
  });
}

async function pack(src: string, stem: string, libmap: LibMap, spec: Spec | null) {
  const title = /<title>[\s\S]*?<\/title>/.exec(src)![0];
  const body = src.replace(title, '').trim();
  const at = body.search(/<script\b/);
  const scripts = at >= 0 ? transpile(body.slice(at)) : '';
  const math = await renderMath(await highlight(at >= 0 ? body.slice(0, at) : body));
  const use = used(scripts, libmap);
  const [css, js] = await Promise.all([styles(join(RT, 'thinkr.css')), runtime(join(RT, 'index.ts'), ['nav', 'step', 'select', 'deselect', 'reveal', 'toggle', 'send'])]);
  const { at: href, files } = await assets(stem, { 'thinkr.css': css, 'thinkr.js': js });
  // the spec as written, at a path that stays: an agent reads it with the Artifact tool's read, path spec.md
  if (spec) files['spec.md'] = resolve(spec.file);
  // title first (the viewer reads it from the first 8 KB), then preloads so libraries download while the page
  // parses; the runtime goes after the content and before page scripts, so they can call thinkr.figure()
  const html = `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n${THEME}\n${preloads(use, libmap)}\n${FONTS}\n`
    + `<link rel="stylesheet" href="${href['thinkr.css']}">\n` + (math.css ? `<style>\n${math.css}</style>\n` : '')
    + math.html.trimEnd() + '\n'
    + `<script>window.THINKR = ${json({ libs: libmap, use, ...(spec ? { spec: spec.md } : {}) })};</script>\n<script src="${href['thinkr.js']}"></script>\n`
    + scripts;
  return { html, files };
}

const argv = Bun.argv.slice(2);
const libmap = await libs(join(RT, 'libs.json'), { force: argv.includes('--refresh'), major: argv.includes('--major') });
const file = argv.find((a) => !a.startsWith('--'));
if (!file) process.exit(0);

const src = await Bun.file(file).text();
const stem = file.replace(/\.html?$/, '');
const nodes = parse(src);
const { errors, warns, mode, version } = check(src, nodes, await Bun.file(`${stem}.spec.md`).exists());
const spec = mode === 'design' && !errors.length ? await readSpec(stem, version, errors, warns) : null;

// a design's changes: against the snapshot of the version before, kept beside the page (scripts/changes.ts)
const historyFile = Bun.file(`${stem}.history.json`);
let changes: ReturnType<typeof track> | null = null;
if (mode === 'design' && !errors.length) {
  const history = await historyFile.json().catch(() => null) as History | null;
  changes = track(src, nodes, version, history?.versions ? history : null);
  warns.push(...changes.warns);
  errors.push(...changes.errors);
}
// diagrams are drawn after the changes are marked, so a changed diagram's marks move to its drawing. The spec goes in
// after both, beside <t-page>: it is not part of the design, so it has no change marks of its own.
let drawn = errors.length ? '' : await drawDiagrams(changes?.html ?? src, errors);
if (spec && !errors.length) {
  const at = drawn.lastIndexOf('</t-page>') + '</t-page>'.length;
  const html = await drawDiagrams(spec.html, errors, 'spec');
  drawn = drawn.slice(0, at) + `\n<t-spec hidden data-version="${spec.designVersion}">\n${html}</t-spec>` + drawn.slice(at);
}
for (const w of warns) console.log('  warn  ' + w);
for (const e of errors) console.log('  error ' + e);
if (errors.length) { console.log(`${errors.length} error(s). Nothing written.`); process.exit(1); }

const { html: out, files } = await pack(drawn, stem, libmap, spec);
await Bun.write(`${stem}.artifact.html`, out);
await Bun.write(`${stem}.preview.html`, preview(out));
if (changes) await Bun.write(historyFile, JSON.stringify(changes.history));
console.log(`ok    ${mode} page, ${warns.length} warning(s), ${Math.round(out.length / 1024)} KB`
  + (changes ? `\n      changes: ${changes.summary}` : '')
  + (spec ? `\n      spec:    ${spec.file}, for version ${spec.designVersion}, ${spec.words} words` : '')
  + `\n${publishLines(stem, files)}\n      preview: ${stem}.preview.html`);
