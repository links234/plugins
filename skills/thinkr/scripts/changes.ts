/* What changed between versions of a design, found at build. build.ts keeps each version's blocks in
   <page>.history.json beside the page. On each build, track() lines the page's blocks up against the last version
   before this one and writes the marks into the page:

     data-v="N"              on a block last changed in version N (added or edited)
     <ins>…</ins>            words added in that version, inside a text block
     <del data-t="…"></del>  words removed there; they sit in the attribute, so they never reach textContent
     <t-removed hidden>      where a block was removed, with its text

   data-amend="change-N-i" ties a block to the <t-amend> entries that explain it: the entries of its version whose
   at= names the block, a parent, or its section's heading (or the version's only entry, when that has no at=).
   A block keeps its marks until it changes again, so an older entry still shows its words while they stand. The
   runtime (runtime/changes.ts) shows the marks only for the entry the reader picks. Rebuilding a version replaces
   its snapshot, so the marks are always against the version before it. */
import type { Node } from './tree';
import { align } from '../kit/build/words';

/** The units a change is found in: the outermost of these in the page. */
const BLOCK = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'dt', 'dd', 'blockquote', 'pre', 'tr', 't-callout', 't-figure', 't-question']);
/** Blocks whose words are compared. Code, figures and questions change as a whole (questions.ts reads option labels
    as text, so marks in them would leak into the answers sent to Claude). */
const WORDS = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'dt', 'dd', 'blockquote', 'tr', 't-callout']);
/** Containers a removed block's stub must not sit in, and where removed words cannot go (a table would move them). */
const LIST = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr']);
export const KINDS = ['answer', 'comment', 'message', 'chat', 'claude'];

interface Saved { src: string; tag: string; v: number; ann: string | null; ids: string[] }
interface Gone { v: number; at: number; tag: string; text: string; ids: string[] }
interface Snapshot { blocks: Saved[]; removed: Gone[] }
export interface History { versions: Record<string, Snapshot> }
interface Block { n: Node; src: string; key: string; ids: string[]; v: number; ann: string | null; change: '' | 'edit' | 'add' }
interface Amend { n: Node; v: number; id: string; at: string[] }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const START = /^<[a-zA-Z][\w-]*(?:[^>"']|"[^"]*"|'[^']*')*>/;
/** Text for an attribute or a stub: tags gone, entities kept, and no $ or \ for build.ts's math pass to find. */
const plain = (s: string) => s.replace(/<\/(td|th|li|p|dt|dd)>|<(br|small)\b[^>]*>/g, ' ').replace(/<[^>]*>/g, '');
const safe = (s: string) => s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\$/g, '&#36;').replace(/\\/g, '&#92;');

export function track(src: string, nodes: Node[], version: number, history: History | null) {
  const errors: string[] = [], warns: string[] = [];
  const page = nodes.find((n) => n.tag === 't-page')!;

  // the entries, with the ids the runtime finds them by
  const count = new Map<number, number>();
  const amends: Amend[] = nodes.filter((n) => n.tag === 't-amend').map((n) => {
    const v = +n.attrs.version, k = (count.get(v) ?? 0) + 1;
    count.set(v, k);
    return { n, v, id: n.attrs.id || `change-${v}-${k}`, at: (n.attrs.at ?? '').split(/[\s,]+/).filter(Boolean) };
  });
  const owners = (v: number, ids: string[]) => {
    const mine = amends.filter((a) => a.v === v);
    const hit = mine.filter((a) => a.at.some((id) => ids.includes(id)));
    return hit.length ? hit : mine.length === 1 && !mine[0].at.length ? mine : [];
  };

  // the blocks, each with the ids that can name it: its own, its parents', its section's heading
  const blocks: Block[] = [];
  let h2: string | undefined, h3: string | undefined;
  for (const n of nodes) {
    if (!BLOCK.has(n.tag) || n.start < page.open || n.end > page.close) continue;
    if (n.parents.some((p) => BLOCK.has(p) || p === 't-amends')) continue;
    if (n.tag === 'h2') { h2 = n.attrs.id; h3 = undefined; } else if (n.tag === 'h3') h3 = n.attrs.id;
    const ids = new Set<string>();
    for (let p: Node | null = n; p && p !== page; p = p.up) if (p.attrs.id) ids.add(p.attrs.id);
    for (const id of [h2, h3]) if (id) ids.add(id);
    const s = src.slice(n.start, n.end);
    blocks.push({ n, src: s, key: norm(s), ids: [...ids], v: version === 1 ? 1 : 0, ann: null, change: '' });
  }

  // line them up against the last version before this one
  const prior = Object.keys(history?.versions ?? {}).map(Number).filter((v) => v < version).sort((a, b) => b - a)[0];
  const base = prior ? history!.versions[prior] : null;
  let removed: Gone[] = [];
  if (base) {
    const old = base.blocks;
    const map = new Array<number>(old.length).fill(-1); // each old block → the block it is now
    const hunk = (dels: number[], adds: number[]) => {
      let k = 0;
      for (const d of dels) {
        const at = adds.slice(k).findIndex((a) => alike(old[d], blocks[a]));
        if (at < 0) continue;
        k += at;
        const b = blocks[map[d] = adds[k++]];
        Object.assign(b, { v: version, change: 'edit', ann: WORDS.has(b.n.tag) ? words(old[d].src, b.src, b.n.tag) : null });
      }
      for (const a of adds) if (!blocks[a].change) Object.assign(blocks[a], { v: version, change: 'add' });
    };
    let dels: number[] = [], adds: number[] = [];
    for (const [op, i, j] of align(old.map((b) => norm(b.src)), blocks.map((b) => b.key))) {
      if (op === '-') { dels.push(i); continue; }
      if (op === '+') { adds.push(j); continue; }
      hunk(dels, adds);
      dels = []; adds = [];
      map[i] = j;
      Object.assign(blocks[j], { v: old[i].v, ann: old[i].ann });
    }
    hunk(dels, adds);
    // a removed block's stub sits before the next block that is still there
    const land = (i: number) => { for (let k = i; k < old.length; k++) if (map[k] >= 0) return map[k]; return blocks.length; };
    removed = base.removed.map((g) => ({ ...g, at: land(g.at) }));
    old.forEach((b, i) => { if (map[i] < 0) removed.push({ v: version, at: land(i), tag: b.tag, text: gist(b.tag, b.src), ids: b.ids }); });
  }

  // checks: every change in this version has an entry that explains it
  const mine = amends.filter((a) => a.v === version);
  const edited = blocks.filter((b) => b.change === 'edit').length, added = blocks.filter((b) => b.change === 'add').length;
  const gone = removed.filter((g) => g.v === version);
  if (version > 1 && !mine.length)
    warns.push(`v${version} has no <t-amend version="${version}">. Add one entry per answer, comment or message you acted on, so the reader sees what changed and why.`);
  else if (base) {
    const loose = [
      ...blocks.filter((b) => b.change && !owners(version, b.ids).length).map((b) => `line ${b.n.line}: this <${b.n.tag}>`),
      ...gone.filter((g) => !owners(version, g.ids).length).map((g) => `the removed ${g.tag === 't-question' || g.tag === 't-figure' ? g.tag : `<${g.tag}>`} "${g.text.slice(0, 40)}"`),
    ];
    for (const l of loose.slice(0, 6))
      warns.push(`${l} changed in v${version}, but no <t-amend version="${version}"> covers it. Add its id, a parent's or its section heading's to an entry's at=.`);
    if (loose.length > 6) warns.push(`…and ${loose.length - 6} more changes no entry covers.`);
  }
  const known = new Set([...nodes.map((n) => n.attrs.id), ...(base ? [...base.blocks, ...base.removed].flatMap((b) => b.ids) : [])]);
  for (const a of mine) {
    const unknown = a.at.filter((id) => !known.has(id));
    if (unknown.length) (base ? errors : warns).push(`line ${a.n.line}: at="${unknown.join(' ')}" names nothing on the page${base ? ` or in v${prior}` : ''}. Use the id of what changed, a parent's or its section heading's.`);
    else if (base && a.at.length && ![...blocks, ...gone].some((b) => b.v === version && owners(version, b.ids).includes(a)))
      warns.push(`line ${a.n.line}: nothing under at="${a.at.join(' ')}" changed since v${prior}.`);
  }

  // write the marks in
  const edits: { at: number; to: number; text: string; order: number }[] = [];
  const tie = (v: number, ids: string[]) => { const o = owners(v, ids); return o.length ? ` data-amend="${o.map((a) => a.id).join(' ')}"` : ''; };
  for (const b of blocks) {
    if (b.v < 2) continue;
    const html = (b.ann ?? b.src).replace(/^<[a-zA-Z][\w-]*/, (t) => `${t} data-v="${b.v}"${tie(b.v, b.ids)}`);
    edits.push({ at: b.n.start, to: b.n.end, text: html, order: 1 });
  }
  for (const g of removed) {
    const after = g.at >= blocks.length;
    let n = (after ? blocks.at(-1) : blocks[g.at])?.n;
    if (!n) continue;
    const li = g.tag === 'li' && n.tag === 'li';
    if (!li) while (n.up && LIST.has(n.up.tag)) n = n.up;
    const tag = li ? 'li' : 't-removed', at = after ? n.end : n.start;
    edits.push({ at, to: at, text: `<${tag} hidden data-removed data-v="${g.v}"${tie(g.v, g.ids)}>${g.text}</${tag}>`, order: 0 });
  }
  for (const a of amends) if (!a.n.attrs.id) { const at = a.n.start + 1 + a.n.tag.length; edits.push({ at, to: at, text: ` id="${a.id}"`, order: 0 }); }
  edits.sort((x, y) => x.at - y.at || x.order - y.order);
  let html = '', pos = 0;
  for (const e of edits) { html += src.slice(pos, e.at) + e.text; pos = e.to; }
  html += src.slice(pos);

  // keep this version's blocks, and a few versions before it, for the next build
  const versions: Record<string, Snapshot> = Object.fromEntries(Object.entries(history?.versions ?? {})
    .filter(([v]) => +v < version).sort((x, y) => +y[0] - +x[0]).slice(0, 3));
  versions[version] = { blocks: blocks.map((b) => ({ src: b.src, tag: b.n.tag, v: b.v, ann: b.ann, ids: b.ids })), removed };
  const summary = version === 1 ? 'v1, the first snapshot'
    : base ? `since v${prior}: ${edited} edited, ${added} added, ${gone.length} removed`
    : `no snapshot before v${version} beside this page, so entries point by at= only`;
  return { html, history: { versions }, errors, warns, summary };
}

/** Two versions of a block are the same block when they share an id, or a tag and most of their words. */
function alike(a: Saved, b: Block) {
  if (a.tag !== b.n.tag) return false;
  const id = /\sid="([^"]+)"/.exec(START.exec(a.src)?.[0] ?? '')?.[1];
  if (id && b.n.attrs.id) return id === b.n.attrs.id;
  return similarity(plain(a.src), plain(b.src)) >= 0.35;
}

function similarity(x: string, y: string) {
  const a = x.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [], b = y.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!a.length || !b.length) return a.length === b.length ? 1 : 0;
  const bag = new Map<string, number>();
  for (const w of a) bag.set(w, (bag.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of b) { const c = bag.get(w); if (c) { common++; bag.set(w, c - 1); } }
  return (2 * common) / (a.length + b.length);
}

/** One line for a removed block's stub. */
function gist(tag: string, src: string) {
  const head = START.exec(src)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(head)?.[1] ?? '';
  let s = tag === 't-figure' ? 'Figure: ' + attr('alt')
    : tag === 't-question' ? 'Question: ' + plain(/<p\b[^>]*>([\s\S]*?)<\/p>/.exec(src)?.[1] ?? '')
    : tag === 'pre' ? (/\bmermaid\b/.test(attr('class')) ? 'Diagram' : 'Code' + (attr('data-title') ? ': ' + attr('data-title') : ''))
    : plain(src.replace(/<svg\b[\s\S]*?<\/svg>/g, ''));
  s = norm(s);
  return safe(s.length > 280 ? s.slice(0, 279) + '…' : s).replace(/&quot;/g, '"');
}

// ---------------------------------------------------------------- words
// math, inline code and the like as one token; a tag; spaces; a word; punctuation on its own, so "request." and
// "request," share the word
const TOKEN = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|<(code|kbd|svg|math)\b[^>]*>[\s\S]*?<\/\1>|<(?:br|img|wbr)\b[^>]*>|<[^>]*>|\s+|[^\s<$\\.,;:!?()]+|[\s\S]/g;
type Tok = { t: string; k: 'atom' | 'tag' | 'space' | 'word' };
const tokens = (s: string): Tok[] => [...s.matchAll(TOKEN)].map(([t, inline]) => ({
  t, k: /^\s/.test(t) ? 'space' : t[0] === '<' ? (inline || /^<(br|img|wbr)\b/i.test(t) ? 'atom' : 'tag') : /^(\$\$|\\[([])/.test(t) && t.length > 2 ? 'atom' : 'word',
}));

/** The new block with its added words in <ins> and its removed words in <del data-t>. Tags are never wrapped and
    always come from the new version, so the markup stays balanced. Null when only tags changed, or the block is too
    long to compare word by word: then it is marked as a whole. */
function words(a: string, b: string, tag: string): string | null {
  const ha = START.exec(a), hb = START.exec(b);
  const ea = a.lastIndexOf('</'), eb = b.lastIndexOf('</');
  if (!ha || !hb || !new RegExp(`^</${tag}\\s*>$`, 'i').test(b.slice(eb)) || !new RegExp(`^</${tag}\\s*>$`, 'i').test(a.slice(ea))) return null;
  const A = tokens(a.slice(ha[0].length, ea)), B = tokens(b.slice(hb[0].length, eb));
  if (A.length * B.length > 250_000) return null;
  const key = (x: Tok) => (x.k === 'space' ? ' ' : x.t);
  const open = [tag]; // the elements the output is inside, to keep removed words out of a list or a row
  let body = '', ins = '', del = '';
  const flush = () => {
    if (del.trim() && !LIST.has(open.at(-1)!)) {
      const t = del.replace(/\s+/g, ' '); // its spaces stay, so struck words never run into the next ones
      body += `<del data-t="${safe(ins.trim() && !t.endsWith(' ') ? t + ' ' : t)}"></del>`;
    }
    const [, l, core, r] = /^(\s*)([\s\S]*?)(\s*)$/.exec(ins)!;
    body += core ? `${l}<ins>${core}</ins>${r}` : ins;
    ins = del = '';
  };
  const emit = (x: Tok) => {
    body += x.t;
    const m = /^<(\/?)([a-zA-Z][\w-]*)/.exec(x.t);
    if (x.k !== 'tag' || !m || x.t.endsWith('/>')) return;
    if (!m[1]) open.push(m[2].toLowerCase());
    else { const i = open.lastIndexOf(m[2].toLowerCase()); if (i > 0) open.length = i; }
  };
  const ops = align(A.map(key), B.map(key));
  ops.forEach(([op, i, j], k) => {
    // a space between two changed words joins them, so a reworded phrase reads as one removal and one addition
    if (op === '=' && B[j].k === 'space' && (ins || del) && ops[k + 1] && ops[k + 1][0] !== '=') { del += ' '; ins += B[j].t; return; }
    if (op === '=') { flush(); emit(B[j]); }
    else if (op === '-') { const x = A[i]; if (x.k !== 'tag') del += x.k === 'space' ? ' ' : x.k === 'atom' ? plain(x.t) : x.t; }
    else { const x = B[j]; if (x.k === 'tag') { flush(); emit(x); } else ins += x.t; }
  });
  flush();
  return /<ins>|<del /.test(body) ? hb[0] + body + b.slice(eb) : null;
}
