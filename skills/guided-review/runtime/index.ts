/* The guided review page: code cards, diagrams, review marks, review comments, jumps, the chapter rail, the left
   columns and keys, for one pull request or several.
   With several, the title is a menu of them (a stack from its base up, or any set to review together), and the page
   shows one at a time. build.ts bundles this into one script, loaded after the page's markup and its data file (window.GR_DATA).
   Code renders with @pierre/diffs and the Diff tab's tree with @pierre/trees, both imported from the pinned jsDelivr
   URLs in the data. */
import type { DiffStyle } from './types';
import { $$ } from '../kit/web/dom';
import { sound } from '../kit/web/sound';
import { T0 } from './dom';
import { cards, commentBlock, openProseFold, setDiffStyle, setFold, setProse, startDiffStyle, STEP } from './cards';
import { headingIn } from './prose';
import { type Ctx, active, byId, byOwnId, ctxOf, ctxs, diffOf } from './ctx';
import { markChapter, markFile, progress, saveMarks } from './marks';
import { choose, current, go, jump, onScroll, pin, show, step, toCard, togglePanel, view } from './nav';
import { startComments, toggleNotes } from './comments';
import { followNode, startDiagrams } from './diagrams';

/** Mark a chapter from a click or a key, with its sound; the last chapter reviewed sounds its own. */
function reviewChapter(c: Ctx, id: string, on: boolean) {
  markChapter(c, id, on);
  saveMarks(c);
  sound.play(on && progress(c) === c.pr.chapters.length ? 'reveal' : on ? 'select' : 'deselect');
}

// ---------------------------------------------------------------- the picker
const openList = () => $$<HTMLElement>('.gr-picklist').find((l) => !l.hidden && !l.closest('[hidden]')) ?? null;
function setList(btn: HTMLElement, open: boolean) {
  const list = document.getElementById(btn.getAttribute('aria-controls')!)!;
  list.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) (list.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.querySelector<HTMLElement>('[role="option"]'))?.focus();
}
function closeList(focusButton = false) {
  const list = openList();
  if (!list) return;
  const btn = list.parentElement!.querySelector<HTMLElement>('.gr-pick-btn')!;
  setList(btn, false);
  if (focusButton) btn.focus();
}
function pick(c: Ctx | null) {
  closeList();
  if (c && choose(c)) sound.play('nav');
  active().root.querySelector<HTMLElement>('.gr-pick-btn')?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest<HTMLElement>('button, a');
  if (!t?.closest('.gr-pick')) closeList();
  if (!t) { followNode(e.target as Element); return; }
  const c = ctxOf(t) ?? active();
  if (t.classList.contains('gr-pick-btn')) { setList(t, t.getAttribute('aria-expanded') !== 'true'); return; }
  if (t.dataset.pick) { pick(byId(t.dataset.pick)); return; }
  if (t.dataset.diffStyle) { if (setDiffStyle(t.dataset.diffStyle as DiffStyle)) sound.play('toggle'); return; }
  if (t.hasAttribute('data-panel-toggle')) { togglePanel(); sound.play('toggle'); return; }
  if (t.classList.contains('gr-tab')) {
    if (t.dataset.view !== view()) sound.play('toggle');
    show(t.dataset.view as 'guide' | 'diff');
    return;
  }
  if (t.classList.contains('gr-fold')) { const el = t.closest('.gr-card')!; setFold(el, !el.classList.contains('collapsed')); return; }
  // A Markdown card: Source or Preview, Changes on or off, a fold of its preview, a comment on a block, a link to a
  // heading of the same file.
  const file = t.closest<HTMLElement>('.gr-file');
  if (file && t.dataset.mdMode) { if (setProse(file, { mode: t.dataset.mdMode as 'source' | 'preview' })) sound.play('toggle'); return; }
  if (file && t.hasAttribute('data-md-changes')) { if (setProse(file, { changes: t.getAttribute('aria-pressed') !== 'true' })) sound.play('toggle'); return; }
  if (file && t.dataset.mdOpen) { openProseFold(file, Number(t.dataset.mdOpen)); sound.play('reveal'); return; }
  if (file && t.hasAttribute('data-md-note')) { commentBlock(t.closest<HTMLElement>('.gr-md-b')!); return; }
  if (file && t.dataset.mdAnchor != null) {
    e.preventDefault();
    const st = cards.get(file);
    if (!st?.prose) return;
    if (!headingIn(st.prose, t.dataset.mdAnchor)) setProse(file, { changes: false });
    const h = headingIn(st.prose, t.dataset.mdAnchor);
    if (h) { pin(h); sound.play('nav'); }
    return;
  }
  if (t.dataset.expand) {
    const st = cards.get(t.closest('.gr-file')!);
    const all = e.shiftKey || e.altKey;
    st?.inst?.expandHunk(Number(t.dataset.hunk), all ? 'both' : (t.dataset.expand as 'up' | 'down'), all ? Number.POSITIVE_INFINITY : STEP);
    return;
  }
  if (t.closest('.gr-rail')) { const el = document.getElementById(t.dataset.target!); if (el) { pin(el); sound.play('nav'); } return; }
  if (t.dataset.jump) { void jump(c, t.dataset.jump, Number(t.dataset.line), t.dataset.side as 'o' | 'n', null, t); return; }
  if (t.dataset.diffGo) { void jump(c, t.closest<HTMLElement>('.gr-file')!.dataset.path!, Number(t.dataset.diffGo), 'n', null, diffOf(c)); return; }
  if (t.dataset.chapterGo) { show('guide'); const el = byOwnId(c, `c-${t.dataset.chapterGo}`); if (el) pin(el); return; }
  if (t.dataset.ref) {
    e.preventDefault();
    // The chapter a ref belongs to: the one it is written in. On the Diff tab only a comment holds a ref, and it stays
    // on that tab. Ask the view, not the link: the click marks an answer read, which draws its thread again.
    const ch = t.closest<HTMLElement>('.gr-sec')?.dataset.chapter ?? null;
    const from = view() === 'diff' ? diffOf(c) : t;
    void jump(c, t.dataset.ref, Number(t.dataset.line) || 0, (t.dataset.side as 'o' | 'n') || 'n', ch, from);
    return;
  }
  if (t.dataset.goto) toCard(c, t.dataset.goto, t.dataset.in === 'diff' ? diffOf(c) : t.closest('.gr-sec'));
});

document.addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  const c = ctxOf(box);
  if (!c) return;
  if (box.dataset.reviewFile) {
    markFile(c, box.dataset.reviewCh || null, box.dataset.reviewFile, box.checked);
    saveMarks(c);
    sound.play(box.checked ? 'select' : 'deselect');
  }
  if (box.dataset.reviewChapter) reviewChapter(c, box.dataset.reviewChapter, box.checked);
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  // The open picker: arrows move between pull requests, Escape closes it.
  const list = openList();
  if (list) {
    const opts = $$<HTMLElement>('[role="option"]', list);
    const i = opts.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); closeList(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length]?.focus(); return; }
    if (e.key === 'Tab') closeList();
  }
  if (t.classList?.contains('gr-pick-btn') && e.key === 'ArrowDown') { e.preventDefault(); setList(t, true); return; }
  // A diagram node that leads to its code, focused.
  if ((e.key === 'Enter' || e.key === ' ') && t.classList?.contains('is-ref') && followNode(t)) { e.preventDefault(); return; }
  // Keys stay with a field that takes text; a ticked box gives them back.
  const typing = /textarea|select/i.test(t.tagName) || (t.tagName === 'INPUT' && !/checkbox|radio|button/.test((t as HTMLInputElement).type));
  if (e.metaKey || e.ctrlKey || e.altKey || typing || e.composedPath().some((n) => (n as HTMLElement).isContentEditable)) return;
  if (e.key === '[' || e.key === ']') { if (step(e.key === ']' ? 1 : -1)) sound.play('nav'); return; }
  if (e.key === 'c') { toggleNotes(); sound.play('toggle'); return; }
  if (e.key === 'b') { togglePanel(); sound.play('toggle'); return; }
  if (view() !== 'guide') return;
  if (e.key === 'j' || e.key === 'k') { if (go(e.key === 'j' ? 1 : -1)) sound.play('nav'); }
  else if (e.key === 'r') {
    const id = current()?.dataset.chapter;
    const c = active();
    if (id) reviewChapter(c, id, !c.marks.c[id]);
  }
});
addEventListener('scroll', onScroll, { passive: true });

// ---------------------------------------------------------------- start
// The link's anchor picks the pull request and the place: #pr43 (a pull request), #pr43-c-<id> (a chapter),
// #pr43-diff (its Diff tab); on a page with one pull request, #c-<id> and #diff as before.
function start() {
  const hash = location.hash.slice(1);
  const c = ctxs.find((x) => x.pr.prefix && hash.startsWith(x.pr.prefix)) ?? ctxOf(hash ? document.getElementById(hash) : null) ?? ctxs[0];
  const rest = c.pr.prefix && hash.startsWith(c.pr.prefix) ? hash.slice(c.pr.prefix.length) : hash;
  for (const x of ctxs) progress(x);
  choose(c);
  startDiffStyle();
  startComments();
  startDiagrams();
  if (rest === 'diff') show('diff');
  else if (rest && byOwnId(c, rest) && !byOwnId(c, rest)!.classList.contains('gr-pr')) pin(byOwnId(c, rest)!);
  performance.measure('gr:boot', { start: T0, end: performance.now() });
}
start();
