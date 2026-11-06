/* Sent comments, as threads. A comment the reader sends stays on the page: it opens a thread that holds the comment
   where it was written, Claude's answers, the replies after them, and whether it is resolved.

   The page database holds them, in each reader's own subtree (references/comments.md):
   - comments/<uid>/sends/<send id>: one send, written once: its comments, and its replies to earlier threads;
   - comments/<uid>/msgs/<msg id>: Claude's answers, and the marks that resolve a thread or open it again, one
     document per message, so the reader and Claude never write the same document.
   The owner and editors read every reader's subtree, found by the document each reader keeps at comments/<uid>;
   anyone else reads only their own. Without the database (a local preview, a reader who cannot write there), sends
   and marks are kept in this browser in the same shape, and no answer comes back into them. A send going out shows as
   its threads from the moment it leaves, until one of these holds it.

   A thread written on an older head than the page's is placed as GitHub places one: on its own lines while they
   still hold the code it was written on, else where that code is in the diff now, else nowhere: it is outdated, and
   sits by its file's header, with the code as it was. */
import type { Author, DbCap, DiffFile, Line, ReviewComment, SendDoc, SentComment, Side, ThreadMsg, UserCap } from './types';
import { store } from '../kit/web/dom';
import { toast } from '../kit/web/toast';
import { rebuildOld } from './hunks';
import { type Ctx, ctxs } from './ctx';

const MAX_CODE = 30; // lines of code kept with a line comment
/** Two subscriptions a reader, of the 64 a view may hold. */
const MAX_READERS = 30;
export type Target = Pick<ReviewComment, 'kind' | 'path' | 'chapter' | 'start' | 'side' | 'end' | 'endSide'>;
export const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------- lines
/** Every line of a file's hunks, in order, and the index of one line by its number on a side. */
export const rowsOf = (f: DiffFile) => f.hunks.flatMap((hk) => hk.lines);
export const rowAt = (rows: Line[], line: number, s: Side) => rows.findIndex((l) => (s === 'o' ? l[1] : l[2]) === line);
/** The lines a comment is on, as the page shows them. */
export function codeOf(f: DiffFile, t: Target): NonNullable<ReviewComment['code']> {
  const rows = rowsOf(f);
  const i = rowAt(rows, t.start!, t.side!), j = rowAt(rows, t.end!, t.endSide!);
  if (i >= 0 && j >= 0) return rows.slice(i, j + 1).slice(0, MAX_CODE).map((l) => [l[0], l[3]]);
  // A line outside the hunks, in a fold the reader opened on the Diff tab: unchanged, so its side's text has it.
  const text = t.side === 'o' ? (f.old ?? rebuildOld(f)) : f.new;
  return text ? text.slice(t.start! - 1, t.end).slice(0, MAX_CODE).map((s) => [' ', s]) : [];
}

const sideOf = (op: string): Side => (op === '-' ? 'o' : 'n');
const lineOf = (l: Line) => (l[0] === '-' ? l[1] : l[2])!;
/** The same lines: the same text, each on the same side. A line added then may be unchanged now, and still be it. */
const sameCode = (a: [string, string][], b: [string, string][]) => a.length === b.length && a.every((x, i) => x[1] === b[i][1] && sideOf(x[0]) === sideOf(b[i][0]));

const places = new Map<string, Target | null>();
/** Where a comment shows on the page's head: its own place, the place its code moved to, or null when it is outdated.
    A general comment is never outdated; a file comment is while its file is in the pull request. */
export function placeOf(c: Ctx, cm: ReviewComment): Target | null {
  if (cm.kind === 'general') return cm;
  const f = cm.path ? c.files.get(cm.path) : undefined;
  if (!f) return null;
  if (cm.kind !== 'line' || cm.head === c.pr.head) return cm;
  const key = `${c.pr.key}:${cm.id}`;
  if (!places.has(key)) places.set(key, moved(f, cm));
  return places.get(key)!;
}
function moved(f: DiffFile, cm: ReviewComment): Target | null {
  const want = cm.code ?? [];
  if (!want.length || cm.start == null) return null;
  if (sameCode(codeOf(f, cm), want)) return cm;
  const to = (start: number, side: Side, end: number, endSide: Side): Target => ({ kind: 'line', path: cm.path, start, side, end, endSide });
  let best: Target | null = null, gap = Infinity;
  const rows = rowsOf(f);
  for (let i = 0; i + want.length <= rows.length; i++) {
    if (!want.every(([op, s], k) => rows[i + k][3] === s && sideOf(rows[i + k][0]) === sideOf(op))) continue;
    const a = rows[i], b = rows[i + want.length - 1], d = Math.abs(lineOf(a) - cm.start);
    if (d < gap) { gap = d; best = to(lineOf(a), sideOf(a[0]), lineOf(b), sideOf(b[0])); }
  }
  // Unchanged lines may sit outside the hunks now, in the new file's text.
  if (!best && f.new && want.every(([op]) => op === ' ')) {
    for (let i = 0; i + want.length <= f.new.length; i++) {
      if (!want.every(([, s], k) => f.new![i + k] === s)) continue;
      const d = Math.abs(i + 1 - cm.start);
      if (d < gap) { gap = d; best = to(i + 1, 'n', i + want.length, 'n'); }
    }
  }
  return best;
}

// ---------------------------------------------------------------- threads
export interface Post { id: string; by: Author; uid: string | null; text: string; at: string; head?: string }
export interface Thread {
  id: string;
  c: Ctx;
  /** The comment that opened it. */
  cm: ReviewComment;
  /** Who opened it: a reader's id, or null for a thread kept in this browser. */
  uid: string | null;
  /** The send that holds it: comments/<uid>/sends/<send>. */
  send: string;
  /** What came after the comment, oldest first: Claude's answers and the readers' replies. */
  posts: Post[];
  resolved: boolean;
}
type Stored<T> = T & { id: string };
interface Source { sends: Stored<SendDoc>[]; msgs: Stored<ThreadMsg>[]; synced: boolean }
export type Changes = Map<Ctx, { ids: Set<string>; paths: Set<string | undefined> }>;

/** By reader id; LOCAL is this browser. */
const LOCAL = '';
const sources = new Map<string, Source>();
/** Sends going out, by id, until a source holds them. */
const flying = new Map<string, SendDoc>();
let threads = new Map<string, Thread>();
let sigs = new Map<string, string>();
const listeners: ((ch: Changes) => void)[] = [];
let db: DbCap | null = null, user: UserCap | null = null, me: string | null = null, writer = false;
let names: Record<string, { name: string }> = {};

export const onThreads = (fn: (ch: Changes) => void) => { listeners.push(fn); };
export const threadsOf = (c: Ctx) => [...threads.values()].filter((t) => t.c === c);
export const threadOf = (id: string | undefined) => (id ? threads.get(id) : undefined);
/** Who wrote a post, as the reader sees it. Names show where the page has the "profile" scope. */
export const authorOf = (by: Author, uid: string | null) => (by === 'claude' ? 'Claude' : uid == null || uid === me ? 'You' : names[uid]?.name || 'Reviewer');
/** Whose a post is, for its colors: Claude's, the reader's own, or another reader's. */
export const whoOf = (by: Author, uid: string | null) => (by === 'claude' ? 'claude' : uid == null || uid === me ? 'me' : 'other');

const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const KINDS = new Set(['line', 'file', 'general', 'reply']), SIDES = new Set(['o', 'n']);
/** A comment read from a send, when it is whole, with only the fields the page draws. What the database holds was
    written by the page's readers, so every field is checked before it is used. */
function clean(cm: SentComment, sentAt: string): ReviewComment | null {
  if (!cm || !str(cm.id) || !str(cm.text) || !str(cm.head) || !KINDS.has(cm.kind)) return null;
  if ((cm.kind === 'line' || cm.kind === 'file') && !str(cm.path)) return null;
  if (cm.kind === 'line' && !(num(cm.start) && num(cm.end) && SIDES.has(cm.side!) && SIDES.has(cm.endSide!))) return null;
  if (cm.kind === 'reply' && !str(cm.thread)) return null;
  const { id, kind, thread, path, chapter, start, side, end, endSide, text, head } = cm;
  const code = Array.isArray(cm.code) ? cm.code.filter((l) => Array.isArray(l) && str(l[0]) && str(l[1])) : undefined;
  return { id, kind, thread, path: str(path) ? path : undefined, chapter: str(chapter) ? chapter : undefined, start, side, end, endSide, code, text, head, at: str(cm.at) ? cm.at : sentAt };
}
/** The pull request a send names: by its key; a send from before keys, by its number, or the page's only one. */
function ctxFor(p: SendDoc['prs'][number]) {
  if (p.key != null) return ctxs.find((c) => c.pr.key === p.key);
  if (p.number != null) return ctxs.find((c) => c.pr.number === p.number);
  return ctxs.length === 1 ? ctxs[0] : undefined;
}

/** Make the threads again from every source, and tell the listeners which changed. */
function rebuild() {
  const next = new Map<string, Thread>();
  const replies: { thread: string; post: Post }[] = [];
  const sends = [...sources].flatMap(([key, src]) => src.sends.map((s) => ({ s, uid: key || null })));
  for (const [id, s] of flying) {
    if (sends.some((x) => x.s.id === id)) flying.delete(id);
    else sends.push({ s: { ...s, id }, uid: me });
  }
  for (const { s, uid } of sends) for (const p of Array.isArray(s.prs) ? s.prs : []) {
    const c = p && ctxFor(p);
    if (!c || !Array.isArray(p.comments)) continue;
    for (const raw of p.comments) {
      const cm = clean(raw, str(s.sentAt) ? s.sentAt : '');
      if (!cm) continue;
      if (cm.kind === 'reply') replies.push({ thread: cm.thread!, post: { id: cm.id, by: 'reader', uid, text: cm.text, at: cm.at, head: cm.head } });
      else if (!next.has(cm.id)) next.set(cm.id, { id: cm.id, c, cm, uid, send: s.id, posts: [], resolved: false });
    }
  }
  for (const r of replies) next.get(r.thread)?.posts.push(r.post);
  const markedAt = new Map<string, string>();
  for (const [key, src] of sources) for (const m of src.msgs) {
    const t = m && str(m.thread) ? next.get(m.thread) : undefined;
    if (!t || !str(m.at)) continue;
    if (str(m.text) && m.text.trim()) t.posts.push({ id: m.id, by: m.by === 'claude' ? 'claude' : 'reader', uid: key || null, text: m.text, at: m.at, head: str(m.head) ? m.head : undefined });
    // The latest mark wins, whoever set it.
    if (typeof m.resolved === 'boolean' && m.at >= (markedAt.get(t.id) ?? '')) { markedAt.set(t.id, m.at); t.resolved = m.resolved; }
  }
  for (const t of next.values()) t.posts.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const ch: Changes = new Map();
  const note = (t: Thread) => {
    let x = ch.get(t.c);
    if (!x) ch.set(t.c, x = { ids: new Set(), paths: new Set() });
    x.ids.add(t.id);
    x.paths.add(t.cm.path);
  };
  const nextSigs = new Map<string, string>();
  for (const t of next.values()) {
    const sig = JSON.stringify([t.resolved, t.posts.map((p) => [p.id, p.text, authorOf(p.by, p.uid)])]);
    nextSigs.set(t.id, sig);
    if (sigs.get(t.id) !== sig) note(t);
  }
  for (const [id, t] of threads) if (!next.has(id)) note(t);
  threads = next;
  sigs = nextSigs;
  if (ch.size) for (const fn of listeners) fn(ch);
}

/** At start: the threads kept in this browser. */
export function startThreads() {
  const sends = store.get<Stored<SendDoc>[]>('gr:sent'), msgs = store.get<Stored<ThreadMsg>[]>('gr:msgs');
  sources.set(LOCAL, { sends: Array.isArray(sends) ? sends : [], msgs: Array.isArray(msgs) ? msgs : [], synced: true });
  rebuild();
}

/** Once the page has its database: every reader's threads this viewer may read, kept up to date. */
export function watchThreads(d: DbCap, u: UserCap, id: string | null, canWrite: boolean) {
  db = d; user = u; me = id; writer = canWrite && !!id;
  if (id) watch(id);
  try { d.collection('comments').onSnapshot((s) => { for (const doc of s.docs) watch(doc.id); }, () => {}); } catch { /* a database that lists nothing */ }
}
function watch(uid: string) {
  if (!db || sources.has(uid) || sources.size > MAX_READERS) return;
  const src: Source = { sends: [], msgs: [], synced: false };
  sources.set(uid, src);
  const docs = <T>(s: { docs: { id: string; data(): Record<string, unknown> | undefined }[] }) => s.docs.map((x) => ({ ...(x.data() as T), id: x.id }));
  try {
    db.collection(`comments/${uid}/sends`).onSnapshot((s) => { src.sends = docs<SendDoc>(s); rebuild(); }, () => {});
    db.collection(`comments/${uid}/msgs`).onSnapshot((s) => {
      // Answers that arrive while the page is open are worth a word; the ones there at load are not.
      if (src.synced) {
        const n = new Set(s.docChanges().filter((x) => x.type === 'added').map((x) => x.doc.data() as ThreadMsg | undefined)
          .filter((m) => m?.by === 'claude' && str(m.text) && threads.has(m.thread)).map((m) => m!.thread)).size;
        if (n) toast(`Claude answered in ${n === 1 ? 'a thread' : `${n} threads`}.`);
      }
      src.synced ||= !s.metadata?.fromCache;
      src.msgs = docs<ThreadMsg>(s);
      rebuild();
    }, () => {});
  } catch { return; }
  if (uid !== me) void nameReaders();
}
async function nameReaders() {
  const ids = [...sources.keys()].filter((k) => k && k !== me);
  names = await user?.profiles(ids).catch(() => names) ?? names;
  rebuild();
}

// ---------------------------------------------------------------- writes
/** Where a send will be kept for Claude to read, or null when it stays in this browser. */
export const refFor = (send: string) => (db && writer ? `comments/${me}/sends/${send}` : null);
/** Keep a send in the page database. Resolves whether it is there. */
export async function saveSend(send: string, data: SendDoc) {
  const ref = refFor(send);
  if (!ref) return false;
  try { await db!.doc(ref).set(data as unknown as Record<string, unknown>); } catch { return false; }
  // The reader's own document is how the owner and editors find their threads.
  db!.doc(`comments/${me}`).set({ at: data.sentAt }).catch(() => {});
  return true;
}
/** A send going out (`data`), or one that did not go (null). Its threads and replies show at once, as they will once
    the database or this browser holds it. */
export function outgoing(send: string, data: SendDoc | null) {
  if (data) flying.set(send, data); else flying.delete(send);
  rebuild();
}
/** Keep a send in this browser: its threads stay on the page, with no answers. */
export function keepLocal(send: string, data: SendDoc) {
  const src = sources.get(LOCAL)!;
  src.sends = [...src.sends, { ...data, id: send }];
  store.set('gr:sent', src.sends);
  rebuild();
}
/** Resolve a thread, or open it again: a mark in the reader's own messages. */
export async function mark(t: Thread, resolved: boolean) {
  const m: ThreadMsg = { thread: t.id, by: 'reader', resolved, at: new Date().toISOString() };
  const id = newId('m');
  if (db && writer) {
    try { await db.doc(`comments/${me}/msgs/${id}`).set(m as unknown as Record<string, unknown>); return true; } catch { return false; }
  }
  const src = sources.get(LOCAL)!;
  src.msgs = [...src.msgs, { ...m, id }];
  store.set('gr:msgs', src.msgs);
  rebuild();
  return true;
}
