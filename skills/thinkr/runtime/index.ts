/* thinkr runtime entry. build.ts bundles this folder (and the kit it imports) with Bun.build and inlines it after
   window.THINKR = { libs, use } and the kit's sounds. It turns the authored <t-page> into the finished page. */
import type { Mode, Thinkr } from './types';
import { barLine, copyText, h, slug } from '../kit/web/dom';
import { ICON, soundButton, themeButton } from '../kit/web/icons';
import { bindSoundButton, sound } from '../kit/web/sound';
import { bindThemeButton } from '../kit/web/theme';
import { toast } from '../kit/web/toast';
import { load, motionReady, warm } from './libs';
import { createFigures, tokens } from './figure';
import { createQuestions } from './questions';
import { createDock } from './feedback';
import { createChanges } from './changes';
import { createSpec } from './spec';
import { createToc, glideTo } from './toc';

const page = document.querySelector<HTMLElement>('t-page');
if (page) boot(page);

function boot(page: HTMLElement) {
  performance.mark('thinkr:start');
  // mode="plan" is the old name of design: such a page keeps its storage key, so its readers keep their answers
  const named = page.getAttribute('mode');
  const mode: Mode = named === 'design' || named === 'plan' ? 'design' : 'explain';
  const version = +(page.getAttribute('version') ?? 1) || 1;
  const h1 = page.querySelector('h1');
  const title = h1?.textContent?.trim() || document.title;
  const kind = mode === 'design' ? 'Design' : 'Explainer';

  // ---------------------------------------------------------------- frame: bar, layout, eyebrow
  const end = h('div', { class: 't-bar-end', html: themeButton() + soundButton() });
  bindThemeButton(end.querySelector<HTMLElement>('[data-k-theme]')!);
  bindSoundButton(end.querySelector<HTMLElement>('[data-k-sound]')!);
  const badge = h('span', { class: 'k-badge is-muted' }, kind);
  const bar = h('div', { class: 'k-bar t-bar', 'data-uncommentable': '' },
    h('div', { class: 't-bar-title' }, badge, h('span', {}, title)), end);
  const layout = h('div', { class: 't-layout' });
  page.before(bar, layout);
  layout.append(page);
  // the title shows once the heading in view (the design's, or the spec's) has scrolled under the bar
  barLine(bar, () => {
    const top = document.querySelector<HTMLElement>('.t-layout:not([hidden]) h1');
    return top ? top.offsetTop + top.offsetHeight - 52 : 8;
  });

  const header = page.querySelector('header');
  if (header && !header.querySelector('.t-eyebrow'))
    header.prepend(h('div', { class: 't-eyebrow' }, h('span', { class: 'k-badge' }, kind), h('span', {}, 'Version ' + version)));

  decorate(page);

  // ---------------------------------------------------------------- figures, questions, design changes, dock and spec
  warm();
  const figures = createFigures(page);
  const key = `thinkr:${page.getAttribute('key') ?? slug(title)}:${named === 'plan' ? 'plan' : mode}`;
  const { questions, onChange } = createQuestions(page, mode, key);
  createToc(layout, page, questions, onChange);
  if (mode === 'design') {
    createChanges({ layout, page, bar, end, key, version, jump: glideTo });
    createDock({ page, version, key, questions, onChange, jump: glideTo });
    const spec = document.querySelector<HTMLElement>('t-spec');
    if (spec) createSpec({ spec, agentSpec: window.THINKR?.agentSpec ?? '', layout, end, badge, decorate });
  }

  const api: Thinkr = {
    figure: (sel, setup) => figures.register(sel, setup),
    load, tokens,
    sound: (name) => sound.play(name),
    motion: () => motionReady,
  };
  window.thinkr = api;
  performance.measure('thinkr:boot', 'thinkr:start'); // scripts/test.ts holds this to a budget
}

// ---------------------------------------------------------------- content: callouts, tables, code, links
// (code is highlighted and math rendered by build.ts, so nothing here waits on a library). The design or explainer
// page, and a design's spec.
function decorate(root: HTMLElement) {
  root.querySelectorAll('t-callout').forEach((el) => {
    const kind = el.getAttribute('kind') ?? 'note';
    const label = el.getAttribute('label');
    const body = h('div', { class: 't-callout-body' }, label ? h('b', { class: 't-callout-label' }, label) : null, [...el.childNodes]);
    el.append(h('span', { class: 't-callout-icon', html: ICON[kind as keyof typeof ICON] ?? ICON.note }), body);
  });
  root.querySelectorAll('table').forEach((t) => {
    if (t.parentElement?.classList.contains('t-scroll')) return;
    const wrap = h('div', { class: 't-scroll' });
    t.before(wrap);
    wrap.append(t);
  });
  const codes = [...root.querySelectorAll<HTMLElement>('pre > code')];
  for (const code of codes) {
    const pre = code.parentElement!;
    const wrap = h('div', { class: 't-code' });
    pre.before(wrap);
    const copy = h('button', { class: 'k-btn is-ghost is-icon is-sm t-copy', type: 'button', 'aria-label': 'Copy code', html: ICON.copy, 'data-uncommentable': '' });
    copy.addEventListener('click', () => copyText(code.textContent ?? '').then(() => { toast('Copied'); sound.play('select'); }, () => toast('Copy failed. Select the code instead.')));
    const name = pre.dataset.title, src = pre.dataset.href;
    if (name) wrap.append(h('div', { class: 't-code-head' }, src ? h('a', { href: src, class: 't-ext' }, name) : name, copy));
    else wrap.append(copy);
    wrap.append(pre);
  }
  // links out (docs, code, sources) get an arrow; a <t-refs> list also shows each link's site
  for (const a of root.querySelectorAll<HTMLAnchorElement | SVGAElement>('a[href^="http"]')) {
    // a link in a diagram (Mermaid's click) is SVG, whose target is read-only: it opens in a new tab and stays plain
    if (!(a instanceof HTMLAnchorElement)) { a.setAttribute('target', '_blank'); continue; }
    a.classList.add('t-ext');
    a.rel = 'noopener';
    a.target = '_blank';
    if (a.closest('t-refs') && !a.querySelector('.t-host'))
      a.append(h('span', { class: 't-host' }, new URL(a.href).hostname.replace(/^www\./, '')));
  }
}
