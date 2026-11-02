/* Markdown previews, rendered when the guide is built, so the page shows a Markdown file as it reads, beside its
   source diff, and never renders anything itself.

   Each side of a file renders with markdown-it, the renderer VS Code uses, in its default (CommonMark and GitHub's
   tables and strikethrough) with links found in plain text, plus GitHub's task lists and alerts. Every top-level
   block (a heading, a paragraph, a list, a table, a code block…) keeps the source lines it came from, which is what
   the marks, the jumps from a ref and the comments on a block go by. Each block's HTML is sanitized to what GitHub
   lets a README hold: no scripts, styles, frames, forms or event handlers, and links only to http, https and mailto.
   A link to another file of the repository goes to it on GitHub at the head; an image of the repository is embedded
   from git (256 KB each, 2 MB a page); any other image shows as a link, since the artifact viewer loads no images
   from other hosts.

   The old and new documents' blocks are then lined up: a block whose HTML is the same is unchanged; a removed block
   followed by an added one that shares most of its words is one changed block, with its words marked (<ins>, <del>);
   the rest are added or removed. Code blocks are marked as a whole, since their spaces matter. */
import { join, posix } from 'node:path';
import type MarkdownIt from 'markdown-it';
import type { IOptions } from 'sanitize-html';
import type { DiffFile, MdBlock, MdPreview, MdRow, Side } from '../runtime/types';
import { rebuildOld } from '../runtime/hunks';
import { align } from '../kit/build/words';
import { need } from '../kit/build/deps';

const SKILL = join(import.meta.dir, '..');
const MAX_IMAGE = 256 * 1024;
const MAX_IMAGES = 2 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
/** Two blocks are one changed block when they share this much of their words. */
const ALIKE = 0.4;

/** Which files get a preview: Markdown, not MDX, whose JSX markdown-it would show as text. */
export const isMarkdown = (f: DiffFile) => /\.(md|markdown)$/i.test(f.path) && !f.binary && f.kind !== 'generated';

/** Where the pull request is: links and images resolve against its repository, at its base or its head. */
export interface Where {
  repo: string; base: string; head: string; checkout: string;
  /** The commit links go to on GitHub: the head, unless it is a snapshot only this machine holds. */
  link: string;
}
type Sanitize = ((html: string, o: IOptions) => string) & { defaults: IOptions };
let md: InstanceType<typeof MarkdownIt> | null = null, sanitize: Sanitize | null = null;
/** The renderer and the sanitizer, loaded once. */
async function load() {
  if (md) return;
  const [{ default: Md }, { default: san }] = await Promise.all([
    need<{ default: typeof MarkdownIt }>('markdown-it', SKILL),
    need<{ default: Sanitize }>('sanitize-html', SKILL),
  ]);
  md = new Md({ html: true, linkify: true });
  sanitize = san;
}

/** The previews of a pull request's Markdown files, by path, and a warning for each one that could not be rendered. */
export async function previews(files: DiffFile[], at: Where) {
  const out = new Map<string, MdPreview>();
  const warns: string[] = [];
  const list = files.filter(isMarkdown);
  if (!list.length) return { out, warns };
  await load();
  const images = { used: 0 };
  for (const f of list) {
    try {
      const p = previewOf(f, at, images);
      if (p) out.set(f.path, p);
    } catch (e) {
      warns.push(`${f.path}: no preview (${(e as Error).message}); its card shows only the source.`);
    }
  }
  return { out, warns };
}

/** A file's preview, or null when the page has no full text for it (a large file keeps only its hunks). */
function previewOf(f: DiffFile, at: Where, images: { used: number }): MdPreview | null {
  const oldText = f.status === 'added' ? [] : f.status === 'deleted' ? f.old : rebuildOld(f);
  const newText = f.status === 'deleted' ? [] : f.new;
  if (!oldText || !newText) return null;
  const render = (text: string[], side: Side) => blocksOf(text, {
    path: side === 'o' ? f.oldPath ?? f.path : f.path, rev: side === 'o' ? at.base : at.head, at, images,
  });
  if (f.status === 'deleted') {
    const blocks = render(oldText, 'o');
    return { side: 'o', blocks, rows: blocks.map((b, n) => ({ mark: 'removed', n, hunks: hunksIn(f, 'o', b.a, b.b) })) };
  }
  const blocks = render(newText, 'n');
  if (f.status === 'added') return { side: 'n', blocks, rows: blocks.map((b, n) => ({ mark: 'added', n, hunks: hunksIn(f, 'n', b.a, b.b) })) };
  return { side: 'n', blocks, rows: rowsOf(f, render(oldText, 'o'), blocks) };
}

// ---------------------------------------------------------------- blocks
interface Ctx { path: string; rev: string; at: Where; images: { used: number } }

/** The top-level blocks of a document, each with its lines and its sanitized HTML. */
function blocksOf(lines: string[], ctx: Ctx): MdBlock[] {
  const out: MdBlock[] = [];
  // Front matter shows as GitHub shows it, as a table of its keys or as code. markdown-it reads blank lines in its
  // place, so every line keeps its number.
  const fm = frontMatter(lines);
  const src = fm ? [...lines.slice(0, fm.end).map(() => ''), ...lines.slice(fm.end)] : lines;
  if (fm) out.push({ a: 1, b: fm.end, html: fm.html });
  const env = {};
  const tokens = md!.parse(src.join('\n'), env);
  const slugs = new Map<string, number>();
  for (let i = 0; i < tokens.length;) {
    const start = i, map = tokens[i].map;
    let depth = tokens[i++].nesting;
    while (depth > 0 && i < tokens.length) depth += tokens[i++].nesting;
    if (!map) continue;
    const html = finish(clean(md!.renderer.render(tokens.slice(start, i), md!.options, env), ctx), slugs);
    if (html.trim()) out.push({ a: map[0] + 1, b: map[1], html: html.trim() });
  }
  return out;
}

/** YAML front matter at the top of a file: its last line, and its HTML. */
function frontMatter(lines: string[]) {
  if (lines[0]?.trim() !== '---') return null;
  const close = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (close < 0) return null;
  const body = lines.slice(1, close);
  const pairs = body.map((l) => /^([\w.-]+):\s*(.*)$/.exec(l));
  const html = body.length && pairs.every((p) => p && p[2] && !/^[|>[{]/.test(p[2]))
    ? `<table class="gr-md-front"><thead><tr>${pairs.map((p) => `<th>${esc(p![1])}</th>`).join('')}</tr></thead><tbody><tr>${pairs.map((p) => `<td>${esc(unquote(p![2]))}</td>`).join('')}</tr></tbody></table>`
    : `<pre class="gr-md-front"><code>${esc(body.join('\n'))}</code></pre>`;
  return { end: close + 1, html };
}
const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, '$2');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------------------------------------------------------- sanitizing
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
/** What a README may hold on GitHub, near enough: text, lists, tables, code, images, details. */
function options(ctx: Ctx): IOptions {
  return {
    allowedTags: [...(sanitize!.defaults.allowedTags as string[]), 'img', 'del', 'ins', 'details', 'summary', 'picture', 'source'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel', 'data-md-anchor'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      ol: ['start'], th: ['style', 'align'], td: ['style', 'align'], code: ['class'], details: ['open'],
      ...Object.fromEntries(HEADINGS.map((h) => [h, ['id']])),
    },
    allowedStyles: { '*': { 'text-align': [/^(left|right|center)$/] } },
    allowedClasses: { code: [/^language-[\w+-]+$/] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attribs) => ({ tagName: tag, attribs: link(attribs, ctx) }),
      img: (tag, attribs) => image(attribs, ctx),
      // An id from the file would meet the page's own; headings get theirs when the block is finished.
      ...Object.fromEntries(HEADINGS.map((h) => [h, (tag: string) => ({ tagName: tag, attribs: {} })])),
    },
  };
}
const clean = (html: string, ctx: Ctx) => sanitize!(html, options(ctx));

/** A path of the repository, from one written in `ctx.path`'s file; null when it leaves the repository. */
function resolvePath(href: string, ctx: Ctx) {
  const path = decodeURI(href.split(/[?#]/)[0]);
  const full = path.startsWith('/') ? posix.normalize(path.slice(1)) : posix.normalize(posix.join(posix.dirname(ctx.path), path));
  return full.startsWith('..') ? null : full;
}
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** A link: to a heading of the same file, kept for the page to scroll to; to a file of the repository, to GitHub at
    the head; anything with a scheme, as it is (the sanitizer drops all but http, https and mailto). */
function link(attribs: Record<string, string>, ctx: Ctx): Record<string, string> {
  const href = attribs.href ?? '';
  const out: Record<string, string> = attribs.title ? { title: attribs.title } : {};
  if (href.startsWith('#')) return { ...out, href, 'data-md-anchor': slug(decodeURIComponent(href.slice(1))) };
  if (SCHEME.test(href) || href.startsWith('//')) return { ...out, href, target: '_blank', rel: 'noopener' };
  const path = href && resolvePath(href, ctx);
  if (!path || !ctx.at.repo) return out;
  const hash = href.includes('#') ? `#${href.split('#')[1]}` : '';
  return { ...out, href: `${ctx.at.repo}/blob/${ctx.at.link}/${encodeURI(path)}${hash}`, target: '_blank', rel: 'noopener' };
}
/** An image: one of the repository's, embedded while the page's budget lasts; any other, a link to it. */
function image(attribs: Record<string, string>, ctx: Ctx): { tagName: string; attribs: Record<string, string>; text?: string } {
  const src = attribs.src ?? '', alt = attribs.alt || 'Image';
  const keep = Object.fromEntries(['alt', 'title', 'width', 'height'].filter((k) => attribs[k]).map((k) => [k, attribs[k]]));
  if (!SCHEME.test(src) && !src.startsWith('//')) {
    const path = src && resolvePath(src, ctx);
    const type = IMAGE_TYPES[path?.split('.').pop()?.toLowerCase() ?? ''];
    const p = path && type ? Bun.spawnSync(['git', '-C', ctx.at.checkout, 'cat-file', 'blob', `${ctx.rev}:${path}`], { stdout: 'pipe', stderr: 'ignore' }) : null;
    if (p && p.exitCode === 0 && p.stdout.length <= MAX_IMAGE && ctx.images.used + p.stdout.length <= MAX_IMAGES) {
      ctx.images.used += p.stdout.length;
      return { tagName: 'img', attribs: { ...keep, src: `data:${type};base64,${p.stdout.toString('base64')}` } };
    }
    const href = path && ctx.at.repo ? `${ctx.at.repo}/blob/${ctx.rev}/${encodeURI(path)}` : '';
    return href ? { tagName: 'a', attribs: { href, target: '_blank', rel: 'noopener', title: path! }, text: alt } : { tagName: 'span', attribs: {}, text: alt };
  }
  return /^https?:/i.test(src) ? { tagName: 'a', attribs: { href: src, target: '_blank', rel: 'noopener', title: src }, text: alt } : { tagName: 'span', attribs: {}, text: alt };
}

/** GitHub's heading slug: lower case, punctuation dropped, spaces to dashes. */
const slug = (s: string) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/&\w+;|&#\d+;/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
/** What GitHub adds to the sanitized block: each heading's anchor name (repeats numbered, as GitHub does), the
    boxes of a task list, and an alert's title. Only fixed markup is added, after sanitizing. */
function finish(html: string, slugs: Map<string, number>) {
  return html
    .replace(/<(h[1-6])>([\s\S]*?)<\/\1>/g, (_, h: string, inner: string) => {
      const base = slug(inner), n = slugs.get(base) ?? 0;
      slugs.set(base, n + 1);
      return `<${h} data-md-id="${esc(n ? `${base}-${n}` : base)}">${inner}</${h}>`;
    })
    .replace(/<li>(<p>)?\[([ xX])\]\s/g, (_, p: string | undefined, x: string) => `<li class="gr-md-task">${p ?? ''}<input type="checkbox" disabled${x === ' ' ? '' : ' checked'}> `)
    .replace(/^<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*([\s\S]*)<\/blockquote>\s*$/, (_, kind: string, rest: string) =>
      `<div class="gr-md-alert is-${kind.toLowerCase()}"><p class="gr-md-alert-t">${kind[0]}${kind.slice(1).toLowerCase()}</p>${/^<\/p>/.test(rest) ? rest.replace(/^<\/p>\s*/, '') : `<p>${rest}`}</div>`);
}

// ---------------------------------------------------------------- marks
/** The hunks whose changed lines on a side fall in lines a..b. */
function hunksIn(f: DiffFile, side: Side, a: number, b: number) {
  return f.hunks.filter((h) => h.lines.some((l) => {
    const n = side === 'o' ? (l[0] === '-' ? l[1] : null) : (l[0] === '+' ? l[2] : null);
    return n != null && n >= a && n <= b;
  })).map((h) => h.id);
}
const union = (...lists: number[][]) => [...new Set(lists.flat())].sort((x, y) => x - y);

/** The old and new blocks lined up into rows, in reading order. */
function rowsOf(f: DiffFile, old: MdBlock[], blocks: MdBlock[]): MdRow[] {
  const rows: MdRow[] = [];
  const ops = align(old.map((b) => b.html), blocks.map((b) => b.html));
  let gone: number[] = [], come: number[] = [];
  const flush = () => {
    // A removed block and an added one at the same place that share most of their words are one changed block.
    const pairs: [number, number][] = [];
    let k = 0;
    for (const o of gone) {
      const at = come.slice(k).findIndex((n) => alike(old[o].html, blocks[n].html));
      if (at < 0) continue;
      pairs.push([o, come[k + at]]);
      k += at + 1;
    }
    // In reading order: what was removed before a changed block, then what was added before it, then the block.
    let gi = 0, ci = 0;
    const upTo = (o: number, n: number) => {
      while (gi < gone.length && gone[gi] < o) removed(gone[gi++]);
      while (ci < come.length && come[ci] < n) added(come[ci++]);
    };
    for (const [o, n] of pairs) {
      upTo(o, n);
      gi++; ci++;
      const b = blocks[n], ob = old[o];
      rows.push({ mark: 'changed', n, o: [ob.a, ob.b], html: words(ob.html, b.html) ?? b.html, hunks: union(hunksIn(f, 'n', b.a, b.b), hunksIn(f, 'o', ob.a, ob.b)) });
    }
    upTo(Infinity, Infinity);
    gone = []; come = [];
  };
  const removed = (o: number) => rows.push({ mark: 'removed', o: [old[o].a, old[o].b], html: old[o].html, hunks: hunksIn(f, 'o', old[o].a, old[o].b) });
  const added = (n: number) => rows.push({ mark: 'added', n, hunks: hunksIn(f, 'n', blocks[n].a, blocks[n].b) });
  for (const [op, i, j] of ops) {
    if (op === '-') gone.push(i);
    else if (op === '+') come.push(j);
    else {
      flush();
      // The same HTML from changed source (lines rewrapped, a reference moved) is the same block, and still where
      // its hunks are.
      const b = blocks[j];
      rows.push({ mark: 'same', n: j, hunks: union(hunksIn(f, 'n', b.a, b.b), hunksIn(f, 'o', old[i].a, old[i].b)) });
    }
  }
  flush();
  // A hunk that only removes lines no block held (a blank line, a link's definition) stays on the row after it.
  const placed = new Set(rows.flatMap((r) => r.hunks));
  for (const h of f.hunks) {
    if (placed.has(h.id)) continue;
    const row = rows.find((r) => r.n != null && blocks[r.n].b >= h.newStart) ?? rows.at(-1);
    if (row) row.hunks = union(row.hunks, [h.id]);
  }
  return rows;
}

// ---------------------------------------------------------------- words
// Inline code, an image or a line break as one token; a tag; spaces; a word; punctuation on its own.
const TOKEN = /<(code|kbd)\b[^>]*>[\s\S]*?<\/\1>|<(?:br|img|input|wbr)\b[^>]*>|<[^>]*>|\s+|[^\s<.,;:!?()]+|[\s\S]/g;
type Tok = { t: string; k: 'atom' | 'tag' | 'space' | 'word' };
const tokens = (s: string): Tok[] => [...s.matchAll(TOKEN)].map(([t, inline]) => ({
  t, k: /^\s/.test(t) ? 'space' : t[0] === '<' ? (inline || /^<(br|img|input|wbr)\b/i.test(t) ? 'atom' : 'tag') : 'word',
}));
const wordsOf = (html: string) => tokens(html).filter((x) => x.k !== 'tag' && x.k !== 'space').map((x) => x.t);
/** Whether two blocks share enough words to be one block changed. */
function alike(a: string, b: string) {
  const tagA = /^<(\w+)/.exec(a)?.[1], tagB = /^<(\w+)/.exec(b)?.[1];
  if (tagA !== tagB) return false;
  const x = wordsOf(a), y = wordsOf(b);
  if (!x.length || !y.length || x.length * y.length > 250_000) return false;
  const same = align(x, y).filter(([op]) => op === '=').length;
  // Most of the words of both; or, for a block that grew or shrank a lot, most of the shorter one's.
  const short = Math.min(x.length, y.length);
  return (2 * same) / (x.length + y.length) >= ALIKE || (short >= 4 && same / short >= 0.6);
}
/** Removed words can sit where text can, never straight inside a list or a table. */
const NO_TEXT = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr']);
/** The new block with its added words in <ins> and its removed words in <del>. Tags always come from the new block,
    so the markup stays whole. Null for a code block, whose spaces matter, or when only tags changed. */
function words(a: string, b: string): string | null {
  if (/^<pre\b/.test(b)) return null;
  const A = tokens(a), B = tokens(b);
  if (A.length * B.length > 250_000) return null;
  const key = (x: Tok) => (x.k === 'space' ? ' ' : x.t);
  const open: string[] = [];
  let body = '', ins = '', del = '';
  const flush = () => {
    // A space the removed words ended on stays after them, so the next word never runs into them.
    if (del.trim() && !NO_TEXT.has(open.at(-1) ?? '')) body += `<del>${del.replace(/\s+/g, ' ').trim()}</del>${ins.trim() || /\s$/.test(del) ? ' ' : ''}`;
    const [, l, core, r] = /^(\s*)([\s\S]*?)(\s*)$/.exec(ins)!;
    body += core ? `${l}<ins>${core}</ins>${r}` : ins;
    ins = del = '';
  };
  const emit = (x: Tok) => {
    body += x.t;
    const m = /^<(\/?)([a-zA-Z][\w-]*)/.exec(x.t);
    if (x.k !== 'tag' || !m || x.t.endsWith('/>')) return;
    if (!m[1]) open.push(m[2].toLowerCase());
    else { const i = open.lastIndexOf(m[2].toLowerCase()); if (i >= 0) open.length = i; }
  };
  const ops = align(A.map(key), B.map(key));
  ops.forEach(([op, i, j], k) => {
    // A space between two changed words joins them, so a reworded phrase reads as one removal and one addition.
    if (op === '=' && B[j].k === 'space' && (ins || del) && ops[k + 1] && ops[k + 1][0] !== '=') { del += ' '; ins += B[j].t; return; }
    if (op === '=') { flush(); emit(B[j]); }
    else if (op === '-') { const x = A[i]; if (x.k !== 'tag') del += x.k === 'space' ? ' ' : x.t; }
    else { const x = B[j]; if (x.k === 'tag') { flush(); emit(x); } else ins += x.t; }
  });
  flush();
  return /<ins>|<del>/.test(body) ? body : null;
}
