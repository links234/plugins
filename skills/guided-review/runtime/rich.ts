/* The text of a comment or an answer, drawn as a chapter's text is: `code`, **bold**, *em*, [text](https://…) and
   [text](ref:path:line). build.ts reads that subset when it builds a chapter; a thread's text arrives after the build,
   so the page reads it here. It builds elements, never HTML, because any reader can write this text.

   A ref to a file the pull request changes jumps to its line, as a chapter's does; a ref to any other file opens
   GitHub. Plain text links too, so an answer written without refs and a reader's own words work the same: an https
   link; a changed file by its path, or by as much of it as names one file (src/a.ts, a.ts:31, a.ts:31-33, a.ts:12
   (old)); and folder/file.ext:line for a file the pull request does not change. The page cannot see that file, so a
   folder and a line are what mark it as one of this repository's: a bare .github/workflows/build.yml may be another
   repository's, and stays text. */
import type { DiffFile } from './types';
import { h } from '../kit/web/dom';
import type { Ctx } from './ctx';

type Kid = Node | string;

const BARE = String.raw`(?<![\w./@+:#-])((?:\./)?[\w@+-]*(?:[./][\w@+-]+)+)(?::(\d+)(?:-\d+)?)?( \(old\))?`;
const WHOLE = new RegExp(`^${BARE}$`);
const TOKEN = new RegExp([
  /`([^`\n]+)`/, /\[([^\]\n]+)\]\(([^)\s]+)\)/, /\*\*([^*\n]+)\*\*/, /(?<![\w*])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![\w*])/,
  /(https:\/\/[^\s<>"'`)\]]*[^\s<>"'`)\].,;:!?])/, new RegExp(BARE),
].map((r) => r.source).join('|'), 'g');

const names = new WeakMap<Ctx, Map<string, DiffFile[]>>();
/** The changed file a path names: exactly, or as the end of one file's path. */
function fileOf(c: Ctx, path: string) {
  const exact = c.files.get(path);
  if (exact) return exact;
  let byName = names.get(c);
  if (!byName) {
    byName = new Map();
    for (const f of c.files.values()) {
      const name = f.path.split('/').pop()!;
      byName.set(name, [...(byName.get(name) ?? []), f]);
    }
    names.set(c, byName);
  }
  const hits = (byName.get(path.split('/').pop()!) ?? []).filter((f) => f.path.endsWith(`/${path}`));
  return hits.length === 1 ? hits[0] : null;
}

/** `label` as a link to a line, or as it is when nothing can be linked. `sure` is a ref someone wrote; without it, a
    file the pull request does not change needs a folder and a line. */
function refTo(c: Ctx, raw: string, line: number, old: boolean, label: Kid[], sure: boolean): Kid[] {
  const path = raw.replace(/^\.\//, '');
  const f = fileOf(c, path);
  const title = `${f?.path ?? path}${line ? `:${line}` : ''}`;
  if (f) {
    const side = f.status === 'deleted' || (old && f.status !== 'added') ? 'o' : 'n';
    return [h('a', { href: '#', class: 'ref', 'data-ref': f.path, 'data-line': line, 'data-side': side, title }, label)];
  }
  const { blob } = c.pr;
  if (!blob || path.split('/').includes('..') || !(sure || (line && /\/.*\.\w+$/.test(path)))) return label;
  return [h('a', { href: `${blob}${encodeURI(path)}${line ? `#L${line}` : ''}`, class: 'ref', target: '_blank', rel: 'noopener', title: `${title} on GitHub` }, label)];
}
function linkTo(c: Ctx, target: string, label: Kid[]): Kid[] {
  const ref = target.startsWith('ref:') && target.slice(4).match(/^(.+?)(?::(\d+)(?:-\d+)?)?$/);
  if (ref) return refTo(c, ref[1], Number(ref[2]) || 0, false, label, true);
  return /^https:\/\//.test(target) ? [h('a', { href: target, target: '_blank', rel: 'noopener' }, label)] : label;
}

/** The text as nodes. Inside a link's own label, `links` is false: a link cannot hold one. */
export function richText(c: Ctx, text: string, links = true): Kid[] {
  const out: Kid[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [all, code, label, target, bold, em, url, path, line, old] = m;
    out.push(text.slice(at, m.index));
    at = m.index + all.length;
    if (code != null) {
      const el = h('code', { text: code });
      const bare = links ? code.match(WHOLE) : null;
      out.push(...(bare ? refTo(c, bare[1], Number(bare[2]) || 0, !!bare[3], [el], false) : [el]));
    } else if (label != null) out.push(...(links ? linkTo(c, target, richText(c, label, false)) : richText(c, label, false)));
    else if (bold != null) out.push(h('b', {}, richText(c, bold, links)));
    else if (em != null) out.push(h('em', {}, richText(c, em, links)));
    else if (url != null) out.push(links ? h('a', { href: url, target: '_blank', rel: 'noopener', text: url }) : url);
    else out.push(...(links ? refTo(c, path, Number(line) || 0, !!old, [all], false) : [all]));
  }
  out.push(text.slice(at));
  return out.filter((k) => k !== '');
}

/** The text with its markup gone, for a line that cannot hold a link: a folded thread, the bell's list. */
export function plainText(text: string): string {
  return text.replace(TOKEN, (all, code, label, _target, bold, em) => {
    const inner = label ?? bold ?? em;
    return code ?? (inner == null ? all : plainText(inner));
  });
}
