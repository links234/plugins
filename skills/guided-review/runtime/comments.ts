/* Review comments. The reader writes comments for Claude on a line or a block of lines, on a file, or on the pull
   request as a whole, and sends each at once or queues it to send with the others. A sent comment stays on the page
   as a thread (threads.ts), where Claude's answers come back and the reader replies. The bell in the bar lists the
   threads with an answer the reader has not read, and a click on one, or on any comment, goes to its code.

   - A line comment starts from the "+" @pierre/diffs shows beside the line under the pointer (drag it to take a block
     of lines), or beside the last of the lines the reader selected by their numbers (a click, then a Shift-click on
     another to take the lines between). On a Markdown card in Preview, it starts from the speech bubble beside a
     block, and is on the block's lines.
   - A file comment starts from the speech bubble in a card's header.
   - A general comment starts from the Comment button under the pull request's title.
   - A reply starts from a thread's Reply box.

   On a wide screen every comment is a box in a margin at the right of the code, as comments sit beside a document: a
   box for each thread, each pending comment and the comment being written, level with the line, file header or title
   it is on. Boxes that would meet stack down the margin. The box the reader clicks comes level with its line, a
   little nearer the code, and its lines are selected; a card folded or marked reviewed opens, and the code comes on
   screen. On a narrow screen there is no margin: each box sits in the code instead, under its line, under its file's
   header, or under the title.

   Pending comments and replies stay in the reader's browser, per pull request like the review marks, until they are
   sent. Once Send is pressed they leave the queue and show as their threads at once; a send that fails puts them
   back in the queue. A send posts a summary with Send to Claude, which wakes the session that published the page:
   one comment thread per send, anchored at the pull request's title, since the shell cannot anchor inside a card's
   shadow root. Then it writes the send to the page database at comments/<user id>/sends/<send id>, where Claude reads
   it with ArtifactData and the page reads it back as threads. Where the reader cannot send, the summary is copied for
   the chat. */
import type { CanSendToClaude, CapabilityMap, CommentsCap, Line, Move, PierreAnnotation, PierreLineRange, ReviewComment, SendDoc, SentComment, Side } from './types';
import { $, $$, copyText, h, store } from '../kit/web/dom';
import { ICON } from '../kit/web/icons';
import { sound } from '../kit/web/sound';
import { toast } from '../kit/web/toast';
import { split } from './dom';
import { type CardState, allDrawn, cards, findRow, mount, previewOn, redrawNotes, rowOf, select, setFold } from './cards';
import { reveal as revealProse } from './prose';
import { plainText, richText } from './rich';
import { type Ctx, active, ctxOf, ctxs, diffOf, guideOf } from './ctx';
import { choose, pin, renderDiff, show, view } from './nav';
import { type Post, type Target, type Thread, authorOf, codeOf, keepLocal, mark, newId, onThreads, outgoing, placeOf, refFor, rowAt, rowsOf, saveSend, startThreads, threadOf, threadsOf, watchThreads, whoOf } from './threads';

const MAX_BYTES = 3900; // a comment holds 4 KiB
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Wide enough for the margin beside the code; narrower, comments sit in the code. */
const wide = matchMedia('(min-width: 1180px)');
const now = () => new Date().toISOString();

/** What a card draws under a line (cards.ts): a moved-code chip, a pending comment, a thread, or the composer of a new
    comment. Comments are drawn there only where there is no margin. */
export type Note = { kind: 'move'; mv: Move } | { kind: 'comment'; cm: ReviewComment } | { kind: 'thread'; id: string } | { kind: 'draft'; form: HTMLFormElement };

// ---------------------------------------------------------------- the pending comments
const keyOf = (c: Ctx) => `${c.pr.key}:comments`;
const lists = new Map<Ctx, ReviewComment[]>();
function listOf(c: Ctx) {
  let l = lists.get(c);
  if (!l) {
    const got = store.get<ReviewComment[]>(keyOf(c));
    lists.set(c, l = Array.isArray(got) ? got : []);
  }
  return l;
}
/** The comments in a send going out: they stay on the list until it lands, so a reload keeps them, and show as the
    threads they open, or in them. */
const going = new Set<string>();
/** The comments in the queue: pending, and not going out. */
const waiting = (c: Ctx) => listOf(c).filter((cm) => !going.has(cm.id));
const total = () => ctxs.reduce((n, c) => n + waiting(c).length, 0);
function find(id: string) {
  for (const c of ctxs) { const cm = listOf(c).find((x) => x.id === id); if (cm) return { c, cm }; }
  return null;
}
/** The threads a pull request shows: a comment still in the queue is not one, even where a send of it landed. */
const sentOf = (c: Ctx) => threadsOf(c).filter((t) => !waiting(c).some((cm) => cm.id === t.id));

/** Things in reading order, by the place each is on: general first, then by file in the diff's order, each file's own
    comments before its line comments, and those by line. A file the head no longer has comes last. */
function byPlace<T>(c: Ctx, list: T[], place: (x: T) => Target) {
  const rank = new Map(c.pr.files.map((f, i) => [f.path, i]));
  const at = (t: Target) => (t.kind === 'general' ? -1 : rank.get(t.path!) ?? c.pr.files.length);
  const placed = list.map((x) => ({ x, t: place(x) }));
  placed.sort((a, b) => at(a.t) - at(b.t) || (a.t.kind === 'file' ? -1 : 0) - (b.t.kind === 'file' ? -1 : 0) || (a.t.start ?? 0) - (b.t.start ?? 0));
  return placed.map((p) => p.x);
}
/** The place a comment is in: a reply's is its thread's. */
const general: Target = { kind: 'general' };
const placeIn = (cm: ReviewComment): Target => (cm.kind === 'reply' ? threadOf(cm.thread)?.cm ?? general : cm);
const ordered = (c: Ctx) => byPlace(c, waiting(c), placeIn);

const old = (s?: Side) => (s === 'o' ? ' (old)' : '');
/** "Line 31", "Lines 31–33", "Line 12 (old)", "Lines 30 (old) to 32". */
function lineLabel(t: Target) {
  if (t.side === t.endSide) return t.start === t.end ? `Line ${t.start}${old(t.side)}` : `Lines ${t.start}–${t.end}${old(t.side)}`;
  return `Lines ${t.start}${old(t.side)} to ${t.end}${old(t.endSide)}`;
}
const placeLabel = (t: Target) => (t.kind === 'line' ? lineLabel(t) : t.kind === 'file' ? 'The whole file' : 'The pull request');
/** Where a comment is, for Claude: "src/a.ts:31-33", "src/a.ts:12 (old)", "src/a.ts (the file)", "General". */
function where(cm: Target) {
  if (cm.kind === 'general') return 'General';
  if (cm.kind === 'file') return `${cm.path} (the file)`;
  if (cm.side === cm.endSide) return `${cm.path}:${cm.start}${cm.end !== cm.start ? `-${cm.end}` : ''}${old(cm.side)}`;
  return `${cm.path}:${cm.start}${old(cm.side)} to ${cm.end}${old(cm.endSide)}`;
}
const firstLine = (s: string, n = 100) => { const l = s.split('\n')[0]; return l.length > n ? `${l.slice(0, n - 1)}…` : l; };
/** The lines of a place, for the code to select them. */
const rangeOf = (t: Target): PierreLineRange => ({ start: t.start!, end: t.end!, side: t.side === 'o' ? 'deletions' : 'additions', endSide: t.endSide === 'o' ? 'deletions' : 'additions' });

// Comments hidden from the bar stay, and still go with a send; the margin closes and the code takes its width.
let hidden = store.get<boolean>('gr:notes-hidden') === true;
const inMargin = () => wide.matches && !hidden;
const inCode = () => !wide.matches && !hidden;

/** Store a pull request's pending comments and draw again what shows them: the cards of `paths`, the comments and
    threads `ids`. */
function changed(c: Ctx, paths: (string | undefined)[], ids: (string | undefined)[] = []) {
  store.set(keyOf(c), listOf(c));
  repaint(c, paths, ids);
}
function repaint(c: Ctx, paths: Iterable<string | undefined>, ids: Iterable<string | undefined>) {
  const want = new Set([...ids].filter((x): x is string => !!x));
  if (inCode()) {
    for (const path of new Set(paths)) {
      if (!path) continue;
      for (const st of allDrawn(c)) if (st.f.path === path) redrawNotes(st);
      for (const el of $$('.gr-file', c.root)) if (el.dataset.path === path) fileNotes(c, el);
    }
    headNotes(c);
  }
  if (want.size) {
    for (const el of $$<HTMLElement>('.gr-thread')) if (want.has(el.dataset.threadId!)) paintThread(el);
    for (const el of $$<HTMLElement>('.gr-note[data-note-id]')) { const hit = want.has(el.dataset.noteId!) && find(el.dataset.noteId!); if (hit) paintNote(el, hit.cm); }
  }
  paintBar();
  relayout();
}
function add(c: Ctx, t: Target, text: string) {
  const f = t.path ? c.files.get(t.path) : undefined;
  const cm: ReviewComment = { id: newId('c'), ...t, text, head: c.pr.head, at: now() };
  if (t.kind === 'line' && f) cm.code = codeOf(f, t);
  listOf(c).push(cm);
  changed(c, [t.path]);
  return cm;
}
function addReply(t: Thread, text: string) {
  const cm: ReviewComment = { id: newId('r'), kind: 'reply', thread: t.id, path: t.cm.path, text, head: t.c.pr.head, at: now() };
  listOf(t.c).push(cm);
  changed(t.c, [], [t.id]);
  return cm;
}
function remove(id: string) {
  const hit = find(id);
  if (!hit) return;
  lists.set(hit.c, listOf(hit.c).filter((x) => x !== hit.cm));
  if (looking === `n:${id}`) look(null);
  changed(hit.c, hit.cm.thread ? [] : [hit.cm.path], [hit.cm.thread]);
  sound.play('deselect');
}
/** A new comment or reply is kept: queued, or sent at once. */
function kept(cm: ReviewComment, now: boolean) {
  if (now) void send([cm]);
  else { sound.play('select'); paintBar(); }
}

// ---------------------------------------------------------------- composers
const sendWord = () => (canSend === 'available' ? 'Send' : 'Copy');
const sendTitle = (what: string) => (canSend === 'available' ? `Send ${what} to Claude now (${MAC ? '⌘' : 'Ctrl'}↵)` : `${whyCopy()} (${MAC ? '⌘' : 'Ctrl'}↵)`);
/** A comment box. A new comment or reply has Cancel, Add to queue and Send (⌘↵); an edit has Cancel and Save.
    Escape cancels. */
function composer(o: { label?: string; text?: string; placeholder?: string; edit?: boolean; reply?: boolean; save(text: string, now: boolean): void; cancel(): void }) {
  const box = h('textarea', { class: 'gr-field', rows: 3, maxlength: 2000, placeholder: o.placeholder ?? 'Leave a comment for Claude', 'aria-label': o.label ?? o.placeholder ?? 'Comment' });
  box.value = o.text ?? '';
  const take = (now: boolean) => { const t = box.value.trim(); if (t) o.save(t, now); else box.focus(); };
  const button = (text: string, cls: string, fn: () => void, title?: string, data?: string) => h('button', { class: `k-btn is-sm ${cls}`, type: 'button', title, onclick: fn, [data ?? 'data-composer-cancel']: '' }, text);
  const form = h('form', { class: 'gr-composer', 'data-uncommentable': '' },
    o.label ? h('div', { class: 'gr-composer-where', text: o.label }) : null, box,
    h('div', { class: 'gr-composer-foot' },
      button('Cancel', 'is-ghost', () => o.cancel()),
      o.edit ? null : button('Add to queue', '', () => take(false), 'Queue it with your other comments, to send them together from the bar', 'data-composer-add'),
      h('button', { class: 'k-btn is-primary is-sm', type: 'submit', 'data-composer-send': '', title: o.edit ? `Save (${MAC ? '⌘' : 'Ctrl'}↵)` : sendTitle(o.reply ? 'this reply' : 'this comment') }, o.edit ? 'Save' : sendWord())));
  form.addEventListener('submit', (e) => { e.preventDefault(); take(!o.edit); });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); o.cancel(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
  });
  return form;
}
/** Focus a composer's box at once, so no key typed straight after the click is lost; a box the code has not placed
    yet is focused in the next frame. */
function focusIn(el: Element) {
  const box = () => el.querySelector<HTMLTextAreaElement>('textarea');
  if (el.isConnected) box()?.focus({ preventScroll: true });
  else requestAnimationFrame(() => box()?.focus({ preventScroll: true }));
}
const fill = (el: HTMLElement, ...kids: (Node | null)[]) => el.replaceChildren(...kids.filter((k): k is Node => !!k));
/** Draw inside an element again without taking the reader out of a box they are typing in. */
function keepTyping(el: Element, draw: () => void) {
  const a = document.activeElement;
  const box = a instanceof HTMLTextAreaElement && el.contains(a) ? a : null;
  const [s, e] = box ? [box.selectionStart, box.selectionEnd] : [0, 0];
  draw();
  if (box?.isConnected && document.activeElement !== box) { box.focus({ preventScroll: true }); box.setSelectionRange(s, e); }
}

// One new comment or reply is open at a time: a new comment's composer is a box of its own, a reply's sits in its
// thread.
let draft: { c: Ctx; form: HTMLFormElement; target?: Target; st?: CardState; note?: Note; thread?: HTMLElement } | null = null;
/** Close the open composer, unless it holds text: then point at it and keep it. Returns whether it is closed. */
function takeDraft() {
  const box = draft?.form.querySelector('textarea');
  // A composer the page no longer shows (its thread is gone) cannot hold the reader up.
  if (box?.value.trim() && draft!.form.isConnected) {
    if (hidden) setHidden(false);
    box.focus();
    toast('Add or cancel the open comment first.');
    return false;
  }
  closeDraft();
  return true;
}
function closeDraft() {
  const d = draft;
  if (!d) return;
  draft = null;
  if (d.st) select(d.st, null);
  if (looking === 'draft' || (d.thread && looking === d.thread.dataset.key)) look(null);
  if (d.thread) paintThread(d.thread);
  else showDraft(d.c, d.st);
}
/** Draw the comment being written where it goes, or take it away once it is closed. */
function showDraft(c: Ctx, st?: CardState) {
  if (inCode()) {
    if (st?.inst) redrawNotes(st);
    for (const el of $$('.gr-file', c.root)) fileNotes(c, el);
    headNotes(c);
  }
  relayout();
}
/** Open a composer for a new comment on `t`. */
function openNew(c: Ctx, t: Target, label: string, st?: CardState, range?: PierreLineRange) {
  if (hidden) setHidden(false);
  const form = composer({
    label,
    save: (text, now) => {
      draft = null;
      const cm = add(c, t, text);
      // The comment stays the box the reader looks at, its lines still selected.
      if (looking === 'draft') looking = `n:${cm.id}`;
      for (const el of $$<HTMLElement>(`[data-key="n:${cm.id}"]`)) el.classList.add('is-active');
      kept(cm, now);
    },
    cancel: closeDraft,
  });
  form.dataset.key = 'draft';
  draft = { c, form, target: t, st };
  if (st) draft.note = { kind: 'draft', form };
  look('draft', false);
  showDraft(c, st);
  // The lines stay selected while the comment is written, even where closing an empty composer cleared them.
  if (st && range) { select(st, range); lit = st; }
  focusIn(form);
  sound.play('reveal');
}

/** The gutter's "+": a composer for the lines picked (`what` names them, as "the block" of a preview). */
export function openLine(st: CardState, range: PierreLineRange, what?: string) {
  if (!takeDraft()) return;
  const toSide = (s?: string): Side => (s === 'deletions' ? 'o' : 'n');
  let a = { line: range.start, side: toSide(range.side) }, b = { line: range.end, side: toSide(range.endSide ?? range.side) };
  // The gutter reports the lines in the order they were dragged; a comment runs down the page.
  const rows = rowsOf(st.f);
  const ia = rowAt(rows, a.line, a.side), ib = rowAt(rows, b.line, b.side);
  if (ia >= 0 && ib >= 0 ? ia > ib : a.side === b.side && a.line > b.line) [a, b] = [b, a];
  const t: Target = { kind: 'line', path: st.f.path, start: a.line, side: a.side, end: b.line, endSide: b.side };
  openNew(st.ctx, t, `Comment on ${what ? `${what}, ` : ''}${lineLabel(t).toLowerCase()}`, st, range);
}
/** The speech bubble in a card's header: a composer for the file as a whole. */
function openFile(card: HTMLElement) {
  const c = ctxOf(card);
  const path = card.dataset.path!;
  if (!c || !takeDraft()) return;
  setFold(card, false);
  const chapter = card.closest<HTMLElement>('.gr-sec')?.dataset.chapter;
  openNew(c, { kind: 'file', path, ...(chapter ? { chapter } : {}) }, `Comment on ${split(path)[0]} as a whole`);
}
/** The Comment button under the title: a composer for the pull request as a whole. */
function openGeneral(c: Ctx) {
  if (!takeDraft()) return;
  openNew(c, general, 'Comment on the pull request');
}
/** A thread's Reply box: a composer at the foot of the thread. */
function openReply(el: HTMLElement) {
  const t = threadOf(el.dataset.threadId);
  if (!t || !takeDraft()) return;
  const form = composer({
    placeholder: 'Reply to Claude', reply: true,
    save: (text, now) => { draft = null; kept(addReply(t, text), now); },
    cancel: closeDraft,
  });
  draft = { c: t.c, form, thread: el };
  paintThread(el);
  look(el.dataset.key!, false);
  relayout();
  focusIn(form);
  sound.play('reveal');
}

// A pending comment or reply is edited where it is drawn: in its box, or in its thread.
let editing: { id: string; form: HTMLFormElement; at: HTMLElement } | null = null;
function edit(btn: HTMLElement, id: string) {
  const hit = find(id);
  const at = btn.closest<HTMLElement>('.gr-thread, .gr-note');
  if (!hit || !at) return;
  const { c, cm } = hit;
  const done = () => { editing = null; changed(c, cm.thread ? [] : [cm.path], [cm.thread ?? cm.id]); };
  editing = {
    id, at,
    form: composer({ label: cm.kind === 'reply' ? 'Edit reply' : 'Edit comment', text: cm.text, edit: true, save: (text) => { cm.text = text; cm.at = now(); done(); }, cancel: done }),
  };
  if (at.classList.contains('gr-thread')) paintThread(at); else paintNote(at, cm);
  relayout();
  focusIn(editing.form);
}
const editingHere = (el: HTMLElement, id: string) => editing?.at === el && editing.id === id;

// ---------------------------------------------------------------- the boxes
/** One box: a thread, a pending comment, or the comment being written (`at` is where it shows on the page's head,
    null when it is outdated). */
interface Item { key: string; c: Ctx; cm: ReviewComment; at: Target | null; t?: Thread }
/** What a pull request shows as boxes, in reading order. A pending reply shows in its thread. */
function itemsOf(c: Ctx): Item[] {
  const out: Item[] = [];
  for (const t of sentOf(c)) out.push({ key: `t:${t.id}`, c, cm: t.cm, at: placeOf(c, t.cm), t });
  for (const cm of waiting(c)) if (cm.kind !== 'reply') out.push({ key: `n:${cm.id}`, c, cm, at: placeOf(c, cm) });
  if (draft?.c === c && draft.target) out.push({ key: 'draft', c, cm: { id: 'draft', ...draft.target, text: '', head: c.pr.head, at: '' }, at: draft.target });
  return byPlace(c, out, (x) => x.at ?? x.cm);
}
const viewOf = (c: Ctx) => (view() === 'guide' ? guideOf(c) : diffOf(c));
const rowCache = new WeakMap<CardState, Line[]>();
const rowsIn = (st: CardState) => { let r = rowCache.get(st); if (!r) rowCache.set(st, r = st.hunks.flatMap((hk) => hk.lines)); return r; };

/** Where a box goes in a view: beside a line of a card that shows it; else beside a card of its file (a file comment,
    beside the card it was written on; an outdated one, or a line no card of the view shows, beside the first); else
    beside the title (a general comment, a file the pull request no longer has). */
type Spot = { at: 'row'; st: CardState; line: number; side: Side } | { at: 'card'; card: HTMLElement } | { at: 'head' };
function spotOf(it: Item, scope: HTMLElement): Spot {
  const { cm, at } = it;
  if (cm.kind === 'general' || !cm.path) return { at: 'head' };
  const list = $$('.gr-file', scope).filter((x) => x.dataset.path === cm.path);
  if (!list.length) return { at: 'head' };
  if (at?.kind === 'line') for (const card of list) {
    const st = cards.get(card);
    if (!st) continue;
    // A preview shows a line where a block holds it; else the box sits by the card's header.
    if (previewOn(st)) {
      if (rowOf(st, at.start!, at.side!)) return { at: 'row', st, line: at.start!, side: at.side! };
      if (rowOf(st, at.end!, at.endSide!)) return { at: 'row', st, line: at.end!, side: at.endSide! };
      continue;
    }
    const rows = rowsIn(st);
    if (rowAt(rows, at.start!, at.side!) >= 0) return { at: 'row', st, line: at.start!, side: at.side! };
    if (rowAt(rows, at.end!, at.endSide!) >= 0) return { at: 'row', st, line: at.end!, side: at.endSide! };
    // The Diff tab's card of the whole file shows a folded line once the reader opens the fold.
    if (st.whole && rowOf(st, at.start!, at.side!)) return { at: 'row', st, line: at.start!, side: at.side! };
  }
  const own = cm.chapter ? list.find((x) => x.closest<HTMLElement>('.gr-sec')?.dataset.chapter === cm.chapter) : undefined;
  return { at: 'card', card: own ?? list[0] };
}
/** Whether a box shows its code: when the lines it is on are not beside it. */
function showsCode(it: Item) {
  if (it.cm.kind !== 'line' || !it.cm.code?.length) return false;
  if (!it.at) return true;
  const f = it.c.files.get(it.at.path!);
  return !f || rowAt(rowsOf(f), it.at.start!, it.at.side!) < 0;
}

// The boxes the code shows itself, where there is no margin.
const notes = new WeakMap<ReviewComment, Note>();
const noteOf = (cm: ReviewComment) => { let n = notes.get(cm); if (!n) notes.set(cm, n = { kind: 'comment', cm }); return n; };
// The library keeps a slotted element across redraws while its note is the same object, so each thread keeps one.
const threadNotes = new Map<string, Note>();
const threadNote = (id: string) => { let n = threadNotes.get(id); if (!n) threadNotes.set(id, n = { kind: 'thread', id }); return n; };
/** The boxes a card draws under its lines where there is no margin, each under the last line it is on. */
export function commentNotes(st: CardState): PierreAnnotation<Note>[] {
  if (!inCode() || previewOn(st)) return [];
  const scope = st.el.closest<HTMLElement>('.gr-view');
  if (!scope) return [];
  const out: PierreAnnotation<Note>[] = [];
  const rows = rowsIn(st);
  for (const it of itemsOf(st.ctx)) {
    const s = spotOf(it, scope);
    if (s.at !== 'row' || s.st !== st || !it.at) continue;
    const end = st.whole || rowAt(rows, it.at.end!, it.at.endSide!) >= 0;
    const [line, side] = end ? [it.at.end!, it.at.endSide!] : [s.line, s.side];
    const metadata = it.t ? threadNote(it.t.id) : it.key === 'draft' ? draft!.note! : noteOf(it.cm);
    out.push({ side: side === 'o' ? 'deletions' : 'additions', lineNumber: line, metadata });
  }
  return out;
}
export const noteEl = (n: Exclude<Note, { kind: 'move' }>) => (n.kind === 'draft' ? n.form : n.kind === 'thread' ? threadEl(n.id) : noteCard(n.cm));
/** Draw a list of boxes again in place: what is drawn already is reused, so a box being typed in stays. */
function fillBoxes(box: HTMLElement, items: Item[]) {
  const had = new Map($$<HTMLElement>(':scope > [data-key]', box).map((el) => [el.dataset.key!, el]));
  const kids = items.map((it) => {
    const el = had.get(it.key);
    if (el) paintBox(el, it);
    return el ?? boxEl(it);
  });
  if (!kids.length && box.hidden) return;
  keepTyping(box, () => box.replaceChildren(...kids));
  box.hidden = !kids.length;
}
/** A card's boxes under its header where there is no margin: its file's comments, and those that cannot sit on a
    line. A preview's line comments sit under their blocks. */
export function fileNotes(c: Ctx, card: HTMLElement) {
  const box = $('.gr-notes', card);
  if (!box) return;
  const scope = card.closest<HTMLElement>('.gr-view');
  fillBoxes(box, inCode() && scope ? itemsOf(c).filter((it) => { const s = spotOf(it, scope); return s.at === 'card' && s.card === card; }) : []);
  const st = cards.get(card);
  if (st?.prose) proseNotes(st);
}
/** Where there is no margin, a preview draws the boxes on its blocks under each block, as the code draws them under
    a line. */
function proseNotes(st: CardState) {
  const pr = st.prose!;
  const want = new Map<Element, Item[]>();
  const scope = st.el.closest<HTMLElement>('.gr-view');
  if (inCode() && previewOn(st) && pr.painted && scope) {
    for (const it of itemsOf(st.ctx)) {
      const s = spotOf(it, scope);
      if (s.at !== 'row' || s.st !== st || !it.at) continue;
      const block = rowOf(st, it.at.end!, it.at.endSide!) ?? rowOf(st, s.line, s.side);
      if (block) want.set(block, [...(want.get(block) ?? []), it]);
    }
  }
  for (const box of $$('.gr-md-notes', pr.el)) if (!want.has(box.previousElementSibling!)) box.remove();
  for (const [block, items] of want) {
    let box = block.nextElementSibling as HTMLElement | null;
    if (!box?.classList.contains('gr-md-notes')) block.after(box = h('div', { class: 'gr-md-notes', hidden: true }));
    fillBoxes(box, items);
  }
}
/** A card flipped between Preview and Source, or opened a fold: its boxes go where it now shows their lines. */
export function reflow(st: CardState) {
  if (inCode()) {
    if (st.inst) redrawNotes(st);
    fileNotes(st.ctx, st.el as HTMLElement);
  }
  relayout();
}
/** The boxes under the title where there is no margin: comments on the pull request as a whole. */
function headNotes(c: Ctx) {
  const head = $('.gr-head', c.root);
  if (!head) return;
  let box = $('.gr-head-notes', head);
  if (!box) head.append(box = h('div', { class: 'gr-head-notes', hidden: true }));
  const scope = viewOf(c);
  fillBoxes(box, inCode() ? itemsOf(c).filter((it) => spotOf(it, scope).at === 'head') : []);
}

/** A box's element: a thread, a pending comment, or the composer of a new one. */
function boxEl(it: Item) {
  if (it.key === 'draft') return draft!.form;
  return it.t ? threadEl(it.t.id) : noteCard(it.cm);
}
function paintBox(el: HTMLElement, it: Item) {
  if (it.t) paintThread(el); else if (it.key !== 'draft') paintNote(el, it.cm);
}
function noteCard(cm: ReviewComment) {
  const el = h('div', { class: 'gr-note', 'data-note-id': cm.id, 'data-key': `n:${cm.id}` });
  paintNote(el, cm);
  return el;
}
const btn = (text: string, attrs: Record<string, string>, icon?: string) =>
  h('button', { class: `k-btn is-ghost is-sm${icon ? ' is-icon' : ''}`, type: 'button', ...attrs, html: icon }, icon ? null : text);
/** A queued comment's box: where it is, its words, and Edit, Send and Delete. */
function paintNote(el: HTMLElement, cm: ReviewComment) {
  el.classList.toggle('is-active', looking === el.dataset.key);
  if (editingHere(el, cm.id)) { keepTyping(el, () => el.replaceChildren(editing!.form)); return; }
  const c = find(cm.id)?.c;
  const at = c ? placeOf(c, cm) : cm;
  fill(el,
    h('div', { class: 'gr-note-head' },
      h('span', { class: 'gr-note-what', text: placeLabel(at ?? cm) }),
      at ? null : h('span', { class: 'gr-chip is-outdated', text: 'Outdated', title: `Written on ${cm.head.slice(0, 7)}. The code it was on has changed since.` }),
      h('span', { class: 'gr-chip is-pending', text: 'Queued' }), h('span', { class: 'gr-spacer' }),
      btn('Edit', { 'data-note-edit': cm.id }),
      btn(sendWord(), { 'data-note-now': cm.id, title: sendTitle('this comment') }),
      btn('Delete', { 'data-note-del': cm.id, 'aria-label': 'Delete comment', title: 'Delete' }, ICON.x)),
    c && showsCode({ key: '', c, cm, at }) ? codeBlock(cm.code!) : null,
    noteText(c ?? active(), cm.text));
}

// ---------------------------------------------------------------- threads
/** Resolved threads the reader opened again to read. */
const unfolded = new Set<string>();
function threadEl(id: string) {
  const el = h('div', { class: 'gr-note gr-thread', 'data-thread-id': id, 'data-key': `t:${id}`, 'data-uncommentable': '' });
  paintThread(el);
  return el;
}
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const noteText = (c: Ctx, text: string) => h('p', { class: 'gr-note-text' }, richText(c, text));
function postEl(c: Ctx, p: Post, threadHead: string) {
  const fresh = p.by === 'claude' && !read.has(p.id);
  const lit = flash?.ids.has(p.id) && Date.now() < flash.until;
  return h('li', { class: `gr-post is-${whoOf(p.by, p.uid)}${fresh ? ' is-unread' : ''}${lit ? ' is-flash' : ''}`, 'data-post-id': p.id },
    h('div', { class: 'gr-post-by' }, h('b', { text: authorOf(p.by, p.uid) }), h('time', { datetime: p.at, text: when(p.at) }),
      p.by === 'claude' && p.head && p.head !== threadHead ? h('span', { class: 'gr-post-head', title: 'The head commit it answers on', text: p.head.slice(0, 7) }) : null,
      fresh ? h('span', { class: 'gr-chip is-new', text: 'New' }) : null),
    noteText(c, p.text));
}
function pendingPost(c: Ctx, el: HTMLElement, r: ReviewComment) {
  if (editingHere(el, r.id)) return h('li', { class: 'gr-post is-me is-editing', 'data-note-id': r.id }, editing!.form);
  return h('li', { class: 'gr-post is-me is-pending', 'data-note-id': r.id },
    h('div', { class: 'gr-post-by' }, h('b', { text: 'You' }), h('span', { class: 'gr-chip is-pending', text: 'Queued' }), h('span', { class: 'gr-spacer' }),
      btn('Edit', { 'data-note-edit': r.id }),
      btn(sendWord(), { 'data-note-now': r.id, title: sendTitle('this reply') }),
      btn('Delete', { 'data-note-del': r.id, 'aria-label': 'Delete reply', title: 'Delete' }, ICON.x)),
    noteText(c, r.text));
}
/** A thread: where it is, its comment and what came after, the replies waiting to be sent, and its Reply box. A
    resolved one folds to one line until the reader opens it. */
function paintThread(el: HTMLElement) {
  const t = threadOf(el.dataset.threadId);
  el.hidden = !t;
  if (!t) { if (draft?.thread === el) draft = null; el.replaceChildren(); return; }
  el.classList.toggle('is-active', looking === el.dataset.key);
  const at = placeOf(t.c, t.cm);
  // A thread being replied to stays open, even when it is resolved meanwhile.
  const folded = t.resolved && !unfolded.has(t.id) && draft?.thread !== el;
  const pending = waiting(t.c).filter((x) => x.kind === 'reply' && x.thread === t.id);
  el.classList.toggle('is-resolved', t.resolved);
  el.classList.toggle('is-folded', folded);
  el.classList.toggle('has-unread', unreadIn(t).length > 0);
  const what = h('span', { class: 'gr-note-what', text: placeLabel(at ?? t.cm) });
  const chips = [
    at ? null : h('span', { class: 'gr-chip is-outdated', text: 'Outdated', title: `Written on ${t.cm.head.slice(0, 7)}. The code it was on has changed since.` }),
    t.resolved ? h('span', { class: 'gr-chip is-resolved', text: 'Resolved' }) : null,
  ];
  if (folded) {
    keepTyping(el, () => fill(el, h('div', { class: 'gr-note-head' }, what, ...chips,
      h('span', { class: 'gr-thread-gist', text: firstLine(plainText(t.posts.at(-1)?.text ?? t.cm.text)) }), btn('Show', { 'data-thread-fold': t.id }))));
    return;
  }
  const code = showsCode({ key: '', c: t.c, cm: t.cm, at, t }) ? codeBlock(t.cm.code!) : null;
  const reply = draft?.thread === el ? draft.form : h('button', { class: 'gr-reply', type: 'button', 'data-thread-reply': t.id }, 'Reply…');
  keepTyping(el, () => fill(el,
    h('div', { class: 'gr-note-head' }, what, ...chips, h('span', { class: 'gr-spacer' }),
      t.resolved ? btn('Hide', { 'data-thread-fold': t.id }) : null, btn(t.resolved ? 'Reopen' : 'Resolve', { 'data-thread-resolve': t.id })),
    code,
    h('ol', { class: 'gr-posts' },
      postEl(t.c, { id: t.id, by: 'reader', uid: t.uid, text: t.cm.text, at: t.cm.at, head: t.cm.head }, t.cm.head),
      ...t.posts.map((p) => postEl(t.c, p, t.cm.head)), ...pending.map((r) => pendingPost(t.c, el, r))),
    h('div', { class: 'gr-thread-reply' }, reply)));
}
function codeBlock(code: NonNullable<ReviewComment['code']>) {
  return h('pre', { class: 'gr-note-code' }, ...code.slice(0, 4).map(([op, s]) => h('span', { class: op === '+' ? 'add' : op === '-' ? 'del' : '', text: `${op === ' ' ? ' ' : op === '-' ? '−' : '+'} ${s}` })),
    code.length > 4 ? h('span', { class: 'more', text: `${code.length - 4} more lines` }) : null);
}
async function resolve(id: string) {
  const t = threadOf(id);
  if (!t) return;
  const to = !t.resolved;
  if (!to) unfolded.add(id); else unfolded.delete(id);
  if (await mark(t, to)) sound.play(to ? 'select' : 'deselect');
  else toast('Could not save that. Try again.');
}
function fold(id: string) {
  if (unfolded.has(id)) unfolded.delete(id); else unfolded.add(id);
  for (const el of $$<HTMLElement>('.gr-thread')) if (el.dataset.threadId === id) paintThread(el);
  relayout();
  sound.play('toggle');
}
// A thread that changes in the database (an answer from Claude, a send, a mark) is drawn again where it shows.
onThreads((ch) => { for (const [c, { ids, paths }] of ch) repaint(c, paths, ids); });

// ---------------------------------------------------------------- the margin
// Each pull request's panel holds a margin layer at its right, and the boxes of the view on screen are laid in it,
// each level with what it is on. Laying out reads where those are and writes only the boxes' tops, once a frame.
const layers = new Map<Ctx, HTMLElement>();
function layerOf(c: Ctx) {
  let l = layers.get(c);
  if (!l) { c.root.append(l = h('div', { class: 'gr-margin', 'data-uncommentable': '' })); layers.set(c, l); }
  return l;
}
const GAP = 8;
let queued = false;
/** Lay the margin out in the next frame. */
export function relayout() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; layout(active()); });
}
/** A card drew its code: its rows are where the boxes beside it go. */
export function noteMounted(st: CardState) {
  if (inMargin() && itemsOf(st.ctx).some((it) => it.cm.path === st.f.path)) relayout();
}
function layout(c: Ctx) {
  const items = inMargin() ? itemsOf(c) : [];
  const on = items.length > 0;
  if (on !== document.body.classList.contains('gr-notes-on')) keepPlace(c, () => document.body.classList.toggle('gr-notes-on', on));
  for (const [x, l] of layers) if (x !== c) l.replaceChildren();
  if (!on) { layers.get(c)?.replaceChildren(); c.root.style.minHeight = ''; return; }
  const layer = layerOf(c);
  const had = new Map($$<HTMLElement>(':scope > [data-key]', layer).map((el) => [el.dataset.key!, el]));
  const boxes = items.map((it) => {
    let el = had.get(it.key), fresh = false;
    if (el) had.delete(it.key);
    else { el = boxEl(it); fresh = true; }
    el.classList.add('gr-box');
    if (fresh) el.style.transition = 'none';
    if (el.parentElement !== layer) layer.append(el);
    return { it, el, fresh };
  });
  for (const el of had.values()) el.remove();
  // Reads, then writes.
  const scope = viewOf(c);
  const base = layer.getBoundingClientRect().top;
  const head = $('.gr-head h1', c.root)?.getBoundingClientRect().top ?? base;
  const placed = boxes.map((b, i) => ({ ...b, i, y: 0, want: topOf(spotOf(b.it, scope), head) - base, hgt: b.el.offsetHeight }));
  const order = [...placed].sort((a, b) => a.want - b.want || a.i - b.i);
  const k = order.findIndex((p) => p.it.key === looking);
  // The box the reader looks at sits level with what it is on; the others make room above and below it.
  const down = (from: number, y: number) => { for (let i = from; i < order.length; i++) { order[i].y = Math.max(order[i].want, y); y = order[i].y + order[i].hgt + GAP; } };
  if (k < 0) down(0, 0);
  else {
    order[k].y = Math.max(order[k].want, 0);
    down(k + 1, order[k].y + order[k].hgt + GAP);
    let y = order[k].y - GAP;
    for (let i = k - 1; i >= 0; i--) { order[i].y = Math.min(order[i].want, y - order[i].hgt); y = order[i].y - GAP; }
    if (order[0].y < 0) down(0, 0);
  }
  for (const p of placed) p.el.style.top = `${Math.round(p.y)}px`;
  const bottom = Math.max(...placed.map((p) => p.y + p.hgt));
  c.root.style.minHeight = `${Math.ceil(bottom + 24)}px`;
  // A box new to the margin appears in its place; after that, it moves.
  requestAnimationFrame(() => { for (const p of placed) if (p.fresh) p.el.style.transition = ''; });
}
/** Where a box's spot is on screen, from the top of the viewport. A card that has not drawn its code yet keeps room
    for its rows, 20 px each, and 28 px for each fold. */
function topOf(s: Spot, head: number) {
  if (s.at === 'head') return head;
  if (s.at === 'card') return s.card.getBoundingClientRect().top;
  const card = s.st.el as HTMLElement;
  if (card.classList.contains('collapsed')) return card.getBoundingClientRect().top;
  const row = rowOf(s.st, s.line, s.side);
  if (row) return row.getBoundingClientRect().top;
  if (previewOn(s.st)) return card.getBoundingClientRect().top;
  const rows = rowsIn(s.st), i = Math.max(0, rowAt(rows, s.line, s.side));
  let n = 0, hunk = 0;
  for (const hk of s.st.hunks) { if (n + hk.lines.length > i) break; n += hk.lines.length; hunk++; }
  return ($('.gr-code', card) ?? card).getBoundingClientRect().top + i * 20 + (hunk + 1) * 28;
}
/** Change the layout without moving what the reader is reading: the card at the reading line, or the one a new
    comment is on, stays where it is on screen. */
function keepPlace(c: Ctx, change: () => void) {
  const scope = viewOf(c);
  const y = innerHeight * 0.3;
  const at = (draft?.st?.el as HTMLElement | undefined) ?? $$('.gr-card', scope).find((x) => { const r = x.getBoundingClientRect(); return r.top <= y && r.bottom > y; });
  const top = at?.getBoundingClientRect().top ?? 0;
  change();
  if (at) scrollBy(0, at.getBoundingClientRect().top - top);
}

// ---------------------------------------------------------------- looking at a box
// A click on a box brings it forward: it comes level with what it is on, a little nearer the code, and the lines it
// is on are selected. A press anywhere else, or Escape, lets it go.
let looking: string | null = null;
let lit: CardState | null = null;
function look(key: string | null, layoutNow = true) {
  if (key === looking) return;
  looking = key;
  if (key?.startsWith('t:')) markRead(key.slice(2));
  if (lit) { select(lit, null); lit = null; }
  for (const el of $$<HTMLElement>('[data-key]')) el.classList.toggle('is-active', !!key && el.dataset.key === key);
  if (key) void light(key);
  if (layoutNow) relayout();
}
async function light(key: string) {
  const c = active();
  const it = itemsOf(c).find((x) => x.key === key);
  if (!it?.at || it.at.kind !== 'line') return;
  const s = spotOf(it, viewOf(c));
  if (s.at !== 'row') return;
  if (!previewOn(s.st)) await mount(s.st.el);
  if (looking !== key) return;
  select(s.st, rangeOf(it.at));
  lit = s.st;
}

// ---------------------------------------------------------------- going to a comment
/** The pull request a box is on. */
function ctxOfKey(key: string) {
  if (key === 'draft') return draft?.c ?? null;
  return key.startsWith('t:') ? threadOf(key.slice(2))?.c ?? null : find(key.slice(2))?.c ?? null;
}
const onScreen = (el: Element) => { const r = el.getBoundingClientRect(); return r.top >= 60 && r.bottom <= innerHeight; };
/** Go to a comment's code: open its card when it is folded or marked reviewed, show the Diff tab when only that tab
    can show its line, and bring the code on screen when it is not (`always`: even when it is). Then look at its box. */
async function reveal(key: string, always: boolean) {
  const c = ctxOfKey(key);
  if (!c) return;
  if (c !== active()) choose(c);
  const it = itemsOf(c).find((x) => x.key === key);
  if (!it) return;
  let s = spotOf(it, viewOf(c));
  // A line in a fold of a preview: the fold opens.
  if (it.at?.kind === 'line' && s.at !== 'row') {
    for (const card of $$('.gr-file', viewOf(c)).filter((x) => x.dataset.path === it.at!.path)) {
      const st = cards.get(card);
      if (st && previewOn(st) && revealProse(st.prose!, it.at.start!, it.at.side!)) { reflow(st); s = spotOf(it, viewOf(c)); break; }
    }
  }
  if (it.at?.kind === 'line' && s.at !== 'row') {
    // A line no card of this view shows, as one in a fold of the guide: the Diff tab's card of the whole file opens to it.
    renderDiff(c);
    const whole = $$('.gr-file', diffOf(c)).find((x) => x.dataset.path === it.at!.path);
    const st = whole && cards.get(whole);
    if (st) { if (view() !== 'diff') show('diff'); s = { at: 'row', st, line: it.at.start!, side: it.at.side! }; }
  }
  const card = s.at === 'row' ? (s.st.el as HTMLElement) : s.at === 'card' ? s.card : null;
  const folded = !!card?.classList.contains('collapsed');
  if (card) setFold(card, false);
  const target = s.at === 'row' ? (await findRow(s.st.el, s.line, s.side)) ?? card : card ?? $('.gr-head', c.root);
  if (looking === key) void light(key); else look(key);
  if (key.startsWith('t:')) markRead(key.slice(2));
  if (target && (always || folded || !onScreen(target))) pin(target, s.at === 'row' ? 'center' : 'start');
  relayout();
}

/** From the bell: open the thread, bring its first unread answer on screen and light its unread answers for a moment,
    so the reader sees where to read from, even in a long thread. */
const FLASH_MS = 1600;
let flash: { ids: Set<string>; until: number } | null = null;
async function goToAnswers(id: string) {
  const t = threadOf(id);
  if (!t) return;
  const fresh = unreadIn(t).map((p) => p.id);
  if (t.resolved) unfolded.add(id);
  flash = { ids: new Set(fresh), until: Date.now() + FLASH_MS };
  await reveal(`t:${id}`, true);
  // The margin lays its boxes out in the next frame: the answer is where it will stay after that.
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const first = $$<HTMLElement>('[data-post-id]').find((el) => el.dataset.postId === fresh[0] && el.offsetParent);
  if (first && !onScreen(first)) pin(first, 'center');
  const was = flash;
  setTimeout(() => {
    if (flash !== was) return;
    flash = null;
    for (const el of $$('.gr-post.is-flash')) el.classList.remove('is-flash');
  }, FLASH_MS);
}

// ---------------------------------------------------------------- unread answers and the bell
// An answer of Claude's is unread until the reader looks at its thread: a click on its box, or on it in the bell's
// list. What they have read is kept in this browser, like the review marks. The bell in the bar counts the threads
// with an unread answer and opens a list of them, newest first; a click on one goes to it. Under them, the threads
// whose answers the reader has read, the last read first, so one opened by mistake is still a click away. That part
// folds: it opens folded while any answer is unread, so the unread ones show in full, and open when none is.
const READ = 'gr:read', SEEN = 'gr:seen';
const read = new Set<string>((() => { const got = store.get<string[]>(READ); return Array.isArray(got) ? got : []; })());
/** When the reader last read an answer in each thread, by thread id. */
const seen = new Map<string, string>((() => {
  const got = store.get<[string, string][]>(SEEN);
  return Array.isArray(got) ? got.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string') : [];
})());
/** The reader's own fold of the Read part, until the list closes; null: folded while any answer is unread. */
let readOpen: boolean | null = null;
function readOnes() {
  return ctxs.flatMap((c) => sentOf(c)).filter((t) => seen.has(t.id) && !unreadIn(t).length && t.posts.some((p) => p.by === 'claude'))
    .sort((a, b) => (seen.get(a.id)! < seen.get(b.id)! ? 1 : -1));
}
const unreadIn = (t: Thread) => t.posts.filter((p) => p.by === 'claude' && !read.has(p.id));
function unread() {
  return ctxs.flatMap((c) => sentOf(c).map((t) => ({ t, posts: unreadIn(t) })).filter((x) => x.posts.length))
    .sort((a, b) => (a.posts.at(-1)!.at < b.posts.at(-1)!.at ? 1 : -1));
}
function markRead(id: string) {
  const t = threadOf(id);
  const fresh = t ? unreadIn(t) : [];
  if (!fresh.length) return;
  for (const p of fresh) read.add(p.id);
  store.set(READ, [...read].slice(-2000));
  seen.delete(id);
  seen.set(id, new Date().toISOString());
  store.set(SEEN, [...seen].slice(-200));
  for (const el of $$<HTMLElement>('.gr-thread')) if (el.dataset.threadId === id) paintThread(el);
  paintBell();
  relayout();
}
const inbox = () => document.getElementById('gr-inbox');
const bellOpen = () => inbox()?.hidden === false;
function paintBell() {
  const list = unread();
  for (const b of $$('[data-bell]')) {
    const n = $('.gr-bell-n', b);
    if (n) { n.textContent = String(list.length); n.hidden = !list.length; }
    b.setAttribute('aria-label', list.length ? `Unread answers from Claude: ${list.length}` : 'Unread answers from Claude: none');
  }
  if (bellOpen()) paintInbox(list);
}
function paintInbox(list = unread()) {
  const box = inbox();
  if (!box) return;
  const item = ({ t, posts }: { t: Thread; posts: Post[] }, done = false) => {
    const last = posts.at(-1)!;
    return h('button', { class: `gr-inbox-item${done ? ' is-read' : ''}`, type: 'button', 'data-inbox': t.id },
      h('span', { class: 'where' },
        ctxs.length > 1 && t.c.pr.number != null ? h('span', { class: 'n', text: `#${t.c.pr.number}` }) : null,
        h('b', { text: t.cm.path ? split(t.cm.path)[0] : 'The pull request' }),
        t.cm.kind === 'general' ? null : h('span', { text: placeLabel(placeOf(t.c, t.cm) ?? t.cm) }),
        h('time', { datetime: last.at, text: when(last.at) })),
      h('span', { class: 'ask', text: firstLine(plainText(t.cm.text), 90) }),
      h('span', { class: 'gist' }, h('b', { text: 'Claude ' }), plainText(last.text)),
      !done && posts.length > 1 ? h('span', { class: 'more', text: `${posts.length} new answers` }) : null);
  };
  const old = readOnes(), open = readOpen ?? !list.length;
  box.replaceChildren(h('div', { class: 'gr-inbox-scroll' },
    h('div', { class: 'gr-inbox-head' }, h('b', { text: 'Unread answers' }),
      list.length ? h('button', { class: 'k-btn is-ghost is-sm', type: 'button', 'data-inbox-all': '' }, 'Mark all read') : null),
    list.length ? h('div', { class: 'gr-inbox-list' }, ...list.map((x) => item(x)))
      : h('p', { class: 'gr-inbox-empty', text: old.length ? 'No unread answers.' : 'No unread answers. When Claude answers one of your comments, it shows here until you read it.' }),
    old.length ? h('button', { class: 'gr-inbox-head is-sub', type: 'button', 'data-inbox-fold': '', 'aria-expanded': String(open) },
      h('span', { class: 'chev', html: ICON.down }), h('b', { text: 'Read' }), h('span', { class: 'n', text: String(old.length) }), h('span', { class: 'hint', text: 'last read first' })) : null,
    old.length && open ? h('div', { class: 'gr-inbox-list', 'data-inbox-read': '' }, ...old.map((t) => item({ t, posts: t.posts.filter((p) => p.by === 'claude') }, true))) : null));
}
function setBell(open: boolean, focusBell = false) {
  const box = inbox();
  if (!box || open === bellOpen()) return;
  readOpen = null;
  if (open) paintInbox();
  box.hidden = !open;
  for (const b of $$('[data-bell]')) b.setAttribute('aria-expanded', String(open));
  if (open) (box.querySelector<HTMLElement>('.gr-inbox-item') ?? box.querySelector<HTMLElement>('button'))?.focus();
  else if (focusBell) $<HTMLElement>('[data-bell]')?.focus();
}

// ---------------------------------------------------------------- showing and hiding
/** Show or hide the comments. */
export function toggleNotes(show = hidden) {
  setHidden(!show);
}
function setHidden(on: boolean) {
  if (on === hidden) return;
  hidden = on;
  store.set('gr:notes-hidden', on);
  if (on) look(null, false);
  redrawAll();
}
/** Draw every pull request's comments again, after the screen narrows or widens or the reader hides or shows them. */
function redrawAll() {
  for (const c of ctxs) {
    for (const st of allDrawn(c)) redrawNotes(st);
    for (const el of $$('.gr-file', c.root)) fileNotes(c, el);
    headNotes(c);
  }
  paintBar();
  relayout();
}
wide.addEventListener('change', redrawAll);

/** The bar: the Comments button, which shows or hides them, with their count; the Send button, while any are queued;
    the bell. */
function paintBar() {
  const n = total(), m = ctxs.reduce((s, c) => s + sentOf(c).length, 0) + n;
  for (const b of $$('[data-notes-toggle]')) {
    const badge = $('.gr-note-count', b);
    if (badge) { badge.textContent = String(m); badge.hidden = !m; }
    b.setAttribute('aria-pressed', String(!hidden));
    b.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} comments${m ? `, ${m}` : ''}`);
    b.title = `${hidden ? 'Show' : 'Hide'} comments (c)`;
  }
  for (const b of $$<HTMLButtonElement>('[data-note-send]')) {
    b.hidden = !n;
    b.disabled = sending;
    $('.n', b)!.textContent = canSend === 'available' ? `Send ${n}` : `Copy ${n}`;
    $('.long', b)!.textContent = canSend === 'available' ? 'to Claude' : 'for the chat';
    b.title = canSend === 'available' ? `Send the ${plural(n)} in the queue to Claude, together` : whyCopy();
  }
  paintBell();
}
const whyCopy = () => (canSend === 'writers_only' ? 'Only the page’s editors can send to Claude, so this copies them to paste in your chat.'
  : canSend === 'no_session' ? 'No Claude session is watching this page, so this copies them to paste in your chat.'
  : 'This copies them, to paste in your chat with Claude.');

// ---------------------------------------------------------------- send
let comments: CommentsCap | null = null, canSend: CanSendToClaude = 'off';
const use = <K extends keyof CapabilityMap>(n: K) => window.claude?.use(n).catch(() => null) ?? Promise.resolve(null);
async function refreshCanSend() {
  const was = canSend;
  canSend = comments ? await comments.canSendToClaude().catch(() => 'off' as const) : 'off';
  if (canSend !== was) for (const c of ctxs) repaint(c, [], listOf(c).map((cm) => cm.thread ?? cm.id));
}

type Batch = { c: Ctx; list: ReviewComment[] }[];
const plural = (n: number) => `${n} comment${n === 1 ? '' : 's'}`;
const prName = (c: Ctx) => `${c.pr.number != null ? `#${c.pr.number} ` : ''}${c.pr.title}, at ${c.pr.head.slice(0, 7)}${c.pr.mode ? ` (${c.pr.mode})` : ''}`;
/** The text Claude is sent: each comment's place and thread, a few of its lines of code, and its words, numbered in
    reading order; a reply names its thread's place and quotes the comment that opened it. The thread id is how Claude
    finds the agent that holds a thread (references/threads.md), with nothing else to read. Within `limit` bytes it
    drops the code first, then the comments that do not fit, and says where the rest are: in the page database at `ref`, or
    still on the page. Returns the comments it holds. */
function summary(batch: Batch, limit: number, ref: string | null) {
  const n = batch.reduce((s, b) => s + b.list.length, 0);
  const enc = new TextEncoder();
  const size = (s: string) => enc.encode(s).length;
  const top = batch.length === 1 ? `Review comments on ${prName(batch[0].c)}: ${plural(n)}` : `Review comments on ${batch.length} pull requests: ${plural(n)}`;
  const item = (c: Ctx, cm: ReviewComment, i: number, code: boolean) => {
    const t = cm.kind === 'reply' ? threadOf(cm.thread) : null;
    const lines = cm.kind === 'reply'
      ? [`${i}. Reply on ${t ? where(t.cm) : 'a thread'} [thread ${cm.thread}]`, ...(t ? [`   > ${firstLine(t.cm.text)}`] : [])]
      : [`${i}. ${where(cm)}${cm.head !== c.pr.head ? `, written on ${cm.head.slice(0, 7)}` : ''} [thread ${cm.id}]`];
    if (code) for (const [op, s] of cm.code?.slice(0, 3) ?? []) lines.push(`   | ${op} ${s}`);
    for (const t of cm.text.split('\n')) lines.push(`   ${t}`);
    return lines.join('\n');
  };
  const foot = (rest: number) => rest
    ? (ref ? `\n\n${plural(rest)} more did not fit here. Every comment, with its code: ${ref} in the page database.` : `\n\n${plural(rest)} more did not fit, and stay on the page.`)
    : (ref ? `\n\nEvery comment, with its code: ${ref} in the page database.` : '');
  const compose = (code: boolean, room: number) => {
    let text = top, i = 0;
    const held = new Set<ReviewComment>();
    for (const { c, list } of batch) {
      let head = batch.length > 1 ? `\n\n${prName(c)}` : '';
      for (const cm of list) {
        const block = `${head}\n\n${item(c, cm, i + 1, code)}`;
        if (size(text + block) > room) return { text, held };
        text += block;
        head = '';
        i++;
        held.add(cm);
      }
    }
    return { text, held };
  };
  for (const code of [true, false]) {
    const all = compose(code, Infinity);
    if (size(all.text + foot(0)) <= limit) return { text: all.text + foot(0), held: all.held };
  }
  const some = compose(false, limit - size(foot(n)));
  return { text: some.text + foot(n - some.held.size), held: some.held };
}
/** The send as the database keeps it. A reply carries its thread as the reader saw it, so Claude reads it in one place:
    without the replies going out, which the thread shows already. */
function sendDoc(batch: Batch): SendDoc {
  const withThread = (cm: ReviewComment): SentComment => {
    const t = cm.kind === 'reply' ? threadOf(cm.thread) : null;
    return t ? { ...cm, on: { where: where(t.cm), text: t.cm.text }, before: t.posts.filter((p) => !going.has(p.id)).slice(-8).map((p) => ({ by: p.by, text: p.text })) } : cm;
  };
  return { sentAt: now(), prs: batch.map(({ c, list }) => ({ key: c.pr.key, number: c.pr.number, title: c.pr.title, head: c.pr.head, comments: list.map(withThread) })) };
}

/** A send leaves: its comments show at once as the threads they open, or in their threads. */
function launch(batch: Batch, send: string) {
  for (const { list } of batch) for (const cm of list) going.add(cm.id);
  // The box the reader was looking at is a thread now.
  if (looking?.startsWith('n:') && going.has(looking.slice(2))) looking = `t:${looking.slice(2)}`;
  outgoing(send, sendDoc(batch));
}
/** A send landed or failed: its comments are no longer going out, and those still pending are back in the queue. */
function back(batch: Batch) {
  for (const { list } of batch) for (const cm of list) going.delete(cm.id);
  const id = looking?.startsWith('t:') ? looking.slice(2) : null;
  if (id && find(id)) looking = `n:${id}`;
}
/** A send that did not go: its comments are back in the queue, as they were. */
function ground(batch: Batch, send: string) {
  back(batch);
  outgoing(send, null);
}

/** Keep the send (in the page database, else in this browser), so what it held stays on the page as threads, and
    take the comments sent off the pending list. `held`: the comments the text holds, when it could not hold them all;
    the rest went only if the database took the send, and go back to the queue if not. */
async function sent(batch: Batch, send: string, held: Set<ReviewComment> | null, copied: boolean) {
  const n = batch.reduce((s, b) => s + b.list.length, 0);
  const inDb = await saveSend(send, sendDoc(batch));
  const went = inDb ? null : held;
  const kept = batch.map(({ c, list }) => ({ c, list: went ? list.filter((cm) => went.has(cm)) : list })).filter((b) => b.list.length);
  if (!inDb) keepLocal(send, sendDoc(kept));
  for (const { c, list } of kept) lists.set(c, listOf(c).filter((cm) => !list.includes(cm)));
  back(batch);
  for (const { c, list } of batch) changed(c, list.map((cm) => (cm.thread ? undefined : cm.path)), list.map((cm) => cm.thread ?? cm.id));
  sound.play('send');
  toast(copied ? 'Copied. Paste it in your chat with Claude.' : went ? `Sent ${went.size} of ${n}. Send again for the rest.` : n === 1 ? 'Sent. Claude will answer in its thread.' : 'Sent. Claude will answer in each thread.');
}

// A send never makes the reader wait on the page: its threads show at once, it goes out, then the database write. A
// failure puts every comment back in the queue. Sends go one at a time (the first may wait on a consent prompt), so
// one batch never opens two threads.
let sending = false;
/** Send the pending comments: `only` these, or all of them. */
async function send(only?: ReviewComment[]) {
  const batch: Batch = ctxs.map((c) => ({ c, list: ordered(c).filter((cm) => !only || only.includes(cm)) })).filter((b) => b.list.length);
  const n = batch.reduce((s, b) => s + b.list.length, 0);
  if (!n) return;
  if (sending) { toast('A send is going out. This one stays in the queue.'); paintBar(); return; }
  const id = `s${Date.now().toString(36)}`;
  if (canSend === 'available' && comments) {
    sending = true;
    launch(batch, id);
    paintBar();
    try { await sendToClaude(batch, n, comments, id); } finally { sending = false; paintBar(); }
    return;
  }
  // Still inside the click, so the clipboard allows it.
  const { text } = summary(batch, Infinity, refFor(id));
  launch(batch, id);
  copyText('# ' + text).then(
    () => sent(batch, id, null, true),
    () => { ground(batch, id); toast('Copy failed. Your comments are still here; try again.'); },
  );
}
async function sendToClaude(batch: Batch, n: number, cap: CommentsCap, id: string) {
  const { text, held } = summary(batch, MAX_BYTES, refFor(id));
  toast('Sending…');
  const anchor = $('.gr-head h1', active().root) ?? document.body;
  try {
    await cap.sendToClaude({ anchor: await cap.anchorFor(anchor), text });
  } catch (e) {
    ground(batch, id);
    const code = (e as { code?: string })?.code;
    if (code === 'consent_required') return toast('Not sent. Allow comments from this page to send them to Claude.');
    if (code === 'rate_limited') return toast('Too many sends. Wait a moment and try again.');
    canSend = 'off';
    paintBar();
    return toast('Could not reach Claude. Press Send again to copy your comments instead.');
  }
  await sent(batch, id, held.size === n ? null : held, false);
}

// ---------------------------------------------------------------- events
/** Whether a box's key still names one: a click that closes a composer lands on a box on its way out. */
const live = (key: string) => (key === 'draft' ? !!draft?.target : key.startsWith('n:') ? !!find(key.slice(2)) : !!threadOf(key.slice(2)));
document.addEventListener('click', (e) => {
  const el = e.target as Element;
  if (bellOpen() && !el.closest('.gr-bell-wrap')) setBell(false);
  // A click on a comment goes to its code; one on its buttons or in its text box only looks at it.
  const box = el.closest<HTMLElement>('[data-key]');
  const key = box?.dataset.key;
  if (key && live(key)) {
    if (!el.closest('button, a, textarea, input, select, label, form') && !getSelection()?.toString()) void reveal(key, false);
    else if (key !== looking) look(key);
  }
  const t = el.closest<HTMLElement>('button');
  if (!t) return;
  if (t.hasAttribute('data-bell')) { setBell(!bellOpen()); sound.play('toggle'); }
  else if (t.dataset.inbox) { setBell(false); void goToAnswers(t.dataset.inbox); sound.play('nav'); }
  else if (t.hasAttribute('data-inbox-fold')) {
    readOpen = t.getAttribute('aria-expanded') !== 'true';
    paintInbox();
    inbox()?.querySelector<HTMLElement>('[data-inbox-fold]')?.focus();
    sound.play('toggle');
  }
  else if (t.hasAttribute('data-inbox-all')) { for (const { t: th } of unread()) markRead(th.id); sound.play('select'); }
  else if (t.hasAttribute('data-notes-toggle')) { toggleNotes(); sound.play('toggle'); }
  else if (t.hasAttribute('data-note-file')) openFile(t.closest<HTMLElement>('.gr-file')!);
  else if (t.hasAttribute('data-note-general')) { const c = ctxOf(t); if (c) openGeneral(c); }
  else if (t.dataset.noteEdit) edit(t, t.dataset.noteEdit);
  else if (t.dataset.noteDel) remove(t.dataset.noteDel);
  else if (t.dataset.noteNow) { const hit = find(t.dataset.noteNow); if (hit) void send([hit.cm]); }
  else if (t.dataset.threadReply) openReply(t.closest<HTMLElement>('.gr-thread')!);
  else if (t.dataset.threadResolve) void resolve(t.dataset.threadResolve);
  else if (t.dataset.threadFold) fold(t.dataset.threadFold);
  else if (t.hasAttribute('data-note-send')) void send();
});
// Before the code takes the press, so a line the reader starts to select is theirs.
document.addEventListener('pointerdown', (e) => {
  if (looking && !(e.target as Element).closest?.('[data-key]')) look(null);
}, true);
document.addEventListener('keydown', (e) => {
  // The bell's list: the arrows move between its answers, Escape closes it.
  if (bellOpen()) {
    if (e.key === 'Escape') { e.preventDefault(); setBell(false, true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = $$<HTMLElement>('.gr-inbox-item');
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (items.length) { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      return;
    }
  }
  if (e.key !== 'Escape' || !looking || (e.target as Element).closest?.('form')) return;
  look(null);
});
document.addEventListener('gr:view', () => { look(null, false); for (const c of ctxs) headNotes(c); relayout(); });

/** At start: the threads kept here, the bar, where the boxes go, and the capabilities that send and that bring the
    threads in from the page database. */
export function startComments() {
  startThreads();
  paintBar();
  const ro = new ResizeObserver(() => relayout());
  for (const c of ctxs) { ro.observe(guideOf(c)); ro.observe(diffOf(c)); }
  relayout();
  if (!window.claude) return;
  void (async () => {
    const [d, user, c] = await Promise.all([use('db'), use('user'), use('comments')]);
    comments = c;
    await refreshCanSend();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshCanSend(); });
    if (!d || !user) return;
    const id = await user.id();
    watchThreads(d, user, id, (await user.can('data.write')) !== false);
  })();
}
