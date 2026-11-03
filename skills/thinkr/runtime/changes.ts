/* Changes, in designs: what Claude changed in each version and why, from the page's <t-amends>. Versions fold; each
   change is one row with its label. Opening a row says where it came from (the question and the reader's answer,
   or the comment) and why, lights the blocks build.ts tied to it (data-amend; scripts/changes.ts) with their marks
   (added words, removed words, removed blocks), and glides to the first; the bar then steps through them. One row
   is open at a time. Wide screens show the list left of the page; narrower ones open it from Changes in the bar.
   Rows newer than the reader's last visit get a dot, and their count shows on the bar button. */
import { h, store } from '../kit/web/dom';
import { ICON } from '../kit/web/icons';
import { sound } from '../kit/web/sound';
import { anim } from './libs';

const FROM: Record<string, string> = { comment: 'Your comment', message: 'Your message', chat: 'In the chat', claude: 'Claude’s own fix' };
const WIDE = '(min-width: 1320px)'; // room for this list, the page and "On this page"

interface Entry { v: number; label: string; fresh: boolean; li: HTMLElement; row: HTMLButtonElement; targets: HTMLElement[] }
interface ChangesOptions {
  layout: HTMLElement; page: HTMLElement; bar: HTMLElement; end: HTMLElement; key: string; version: number;
  jump(el: HTMLElement): void;
}

export function createChanges({ layout, page, bar, end, key, version, jump }: ChangesOptions) {
  // every visit counts, the first version's too, so the reader's next version knows what is new to them
  const seen = store.get<number>(key + ':seen');
  store.set(key + ':seen', version);
  const source = page.querySelector('t-amends');
  source?.remove();
  const amends = [...(source?.querySelectorAll<HTMLElement>('t-amend') ?? [])];
  if (!amends.length) return;

  // what each entry points at: the blocks build.ts tied to it, else the elements its at= names
  const tied = new Map<string, HTMLElement[]>();
  for (const el of page.querySelectorAll<HTMLElement>('[data-amend]'))
    for (const id of el.dataset.amend!.split(' ')) tied.set(id, [...(tied.get(id) ?? []), el]);
  const named = (a: HTMLElement) => (a.getAttribute('at') ?? '').split(/[\s,]+/).flatMap((id) => {
    const el = id ? page.querySelector<HTMLElement>('#' + CSS.escape(id)) : null;
    if (!el) return [];
    const section = el.parentElement;
    return [/^H[23]$/.test(el.tagName) && section?.tagName === 'SECTION' && section.firstElementChild === el ? section : el];
  });

  // ---------------------------------------------------------------- rows: a label that opens to the why
  const entries: Entry[] = amends.map((a) => {
    const v = +(a.getAttribute('version') ?? 0), kind = a.getAttribute('kind') ?? 'claude';
    const re = a.getAttribute('re'), answer = a.getAttribute('answer');
    const body = h('div', { class: 't-chg-body' }, [...a.childNodes]);
    const label = a.getAttribute('label') || body.textContent!.trim().split(/(?<=[.!?])\s/)[0];
    const from = kind === 'answer'
      ? h('dl', { class: 't-chg-qa' }, h('dt', { title: 'Question' }, 'Q'), h('dd', {}, re ?? ''), answer ? [h('dt', { title: 'Your answer' }, 'A'), h('dd', { class: 't-chg-a' }, answer)] : null)
      : h('p', { class: 't-chg-from' }, FROM[kind] ?? kind, re ? [' · ', h('q', {}, re)] : null);
    const fresh = seen != null && v > seen;
    const row = h('button', { class: 't-chg-row', type: 'button', 'aria-expanded': 'false' },
      h('span', { class: 't-chg-label' }, label), fresh ? h('i', { class: 't-chg-dot', title: 'New since your last visit' }) : null);
    const li = h('li', { class: 't-chg', 'data-comment-target': '' }, row, h('div', { class: 't-chg-detail' }, from, body));
    const entry: Entry = { v, label, fresh, li, row, targets: tied.get(a.id) ?? named(a) };
    row.addEventListener('click', () => pick(entry));
    return entry;
  });

  // ---------------------------------------------------------------- versions that fold, newest first; open: this one and any with news
  const versions = [...new Set(entries.map((e) => e.v))].sort((a, b) => b - a).map((v) => {
    const mine = entries.filter((e) => e.v === v);
    const open = v === version || mine.some((e) => e.fresh);
    const items = h('ol', { class: 't-chg-items', hidden: !open }, mine.map((e) => e.li));
    const head = h('button', { class: 't-chg-vbtn', type: 'button', 'aria-expanded': String(open) },
      h('span', { class: 't-chg-chev', html: ICON.down }), h('span', {}, 'Version ' + v), h('span', { class: 't-chg-vn' }, String(mine.length)));
    head.addEventListener('click', () => {
      items.hidden = !items.hidden;
      head.setAttribute('aria-expanded', String(!items.hidden));
      sound.play('toggle');
    });
    return h('li', { class: 't-chg-ver', 'data-uncommentable': '' }, head, items);
  });

  const close = h('button', { class: 'k-btn is-ghost is-icon is-sm t-changes-close', type: 'button', 'aria-label': 'Close', html: ICON.x });
  const rail = h('nav', { class: 't-changes', id: 't-changes', 'aria-label': 'Changes' },
    h('div', { class: 't-changes-head', 'data-uncommentable': '' }, h('p', {}, 'Changes'), close), h('ol', {}, versions));
  layout.prepend(rail);
  layout.classList.add('has-changes');

  // ---------------------------------------------------------------- the bar: Changes (narrow screens) and the stepper
  const fresh = entries.filter((e) => e.fresh).length;
  const toggle = h('button', { class: 'k-btn is-ghost is-sm t-changes-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 't-changes', title: 'What changed in each version' },
    'Changes', fresh ? h('span', { class: 't-count', 'aria-label': `${fresh} new` }, String(fresh)) : null);
  end.prepend(toggle);
  const tag = h('span', { class: 'k-badge is-muted' });
  const label = h('span', { class: 't-chgnav-label' });
  const pos = h('span', { class: 't-chgnav-pos', 'aria-live': 'polite' });
  const btn = (name: string, icon: string) => h('button', { class: 'k-btn is-ghost is-icon is-sm', type: 'button', 'aria-label': name, title: name, html: icon });
  const prev = btn('Previous change', ICON.left), next = btn('Next change', ICON.right), done = btn('Hide changes (Esc)', ICON.x);
  bar.insertBefore(h('div', { class: 't-chgnav', role: 'toolbar', 'aria-label': 'Change' }, tag, label, pos, prev, next, done), end);

  const wide = matchMedia(WIDE);
  const isOpen = () => rail.classList.contains('is-open');
  function open(on: boolean) {
    if (on === isOpen()) return;
    rail.classList.toggle('is-open', on);
    toggle.setAttribute('aria-expanded', String(on));
    if (!on) return;
    anim(rail, { opacity: [0, 1], transform: ['translateY(-6px)', 'translateY(0px)'] }, { type: 'tween', duration: 0.14, ease: [0.2, 0.8, 0.2, 1] });
    sound.play('reveal');
  }
  toggle.addEventListener('click', () => open(!isOpen()));
  close.addEventListener('click', () => { open(false); toggle.focus(); });
  document.addEventListener('pointerdown', (e) => { const t = e.target as Node; if (isOpen() && !rail.contains(t) && !toggle.contains(t)) open(false); });

  // ---------------------------------------------------------------- one open row: light its marks, step through them
  let picked: Entry | null = null, lit: HTMLElement[] = [], at = 0;
  function pick(e: Entry) {
    const again = picked === e;
    clear();
    if (again) return;
    picked = e;
    e.li.classList.add('is-on');
    e.row.setAttribute('aria-expanded', 'true');
    if (!e.targets.length) { sound.play('reveal'); return; } // an answer that changed nothing: the row only opens
    lit = [...new Set(e.targets)].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    for (const el of lit) { el.classList.add('is-lit'); if (el.hasAttribute('data-removed')) el.hidden = false; }
    tag.textContent = 'v' + e.v;
    label.textContent = e.label;
    prev.disabled = next.disabled = lit.length < 2;
    bar.classList.add('is-stepping');
    if (!wide.matches) open(false);
    go(0);
  }
  function go(i: number) {
    if (!lit.length) return;
    at = (i + lit.length) % lit.length;
    pos.textContent = `${at + 1} / ${lit.length}`;
    jump(lit[at]);
  }
  function clear() {
    for (const el of lit) { el.classList.remove('is-lit'); if (el.hasAttribute('data-removed')) el.hidden = true; }
    picked?.li.classList.remove('is-on');
    picked?.row.setAttribute('aria-expanded', 'false');
    picked = null; lit = [];
    bar.classList.remove('is-stepping');
  }
  prev.addEventListener('click', () => go(at - 1));
  next.addEventListener('click', () => go(at + 1));
  done.addEventListener('click', () => clear());
  addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable], .t-composer')) return;
    if (isOpen()) { open(false); toggle.focus(); } else if (picked) clear();
  });
}
