/* <t-question>: single, multi (with an optional max) or text. In a design each question has an Other row and an
   optional note; with answer="…" a question becomes a self-check that marks the right options and opens its
   <t-explain>. Answers live in localStorage, and in the page database for designs (feedback.ts). */
import type { Mode } from './types';
import { h, slug, store } from '../kit/web/dom';
import { ICON } from '../kit/web/icons';
import { sound } from '../kit/web/sound';
import { anim } from './libs';

export type QType = 'single' | 'multi' | 'text';
export interface Answer { values: string[]; other: string; note: string; text: string; checked?: boolean }
export interface AnswerReport { question: string; type: QType; values: string[]; labels: string[]; other: string; text: string; note: string; recommended: string | null }
export interface Question {
  el: HTMLElement; id: string; quiz: boolean;
  /** "Q2" in a design, "" for a self-check. */
  num: string;
  /** The short label for "On this page": the toc attribute, else the question text. */
  label: string;
  done(): boolean; report(): AnswerReport;
}
interface Saved { answers: Record<string, Answer> }

export function createQuestions(page: HTMLElement, mode: Mode, key: string) {
  const state: Saved = { answers: store.get<Partial<Saved>>(key)?.answers ?? {} };
  const onChange = new Set<() => void>();
  const changed = () => { store.set(key, state); onChange.forEach((cb) => cb()); };

  const questions = [...page.querySelectorAll<HTMLElement>('t-question')].map((el, i) => question(el, i));
  return { questions, onChange };

  function question(q: HTMLElement, qi: number): Question {
    const id = (q.id ||= 'q' + (qi + 1));
    const t = q.getAttribute('type');
    const type: QType = t === 'multi' || t === 'text' ? t : 'single';
    const max = +(q.getAttribute('max') ?? 0) || 0;
    const answerKey = (q.getAttribute('answer') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const quiz = answerKey.length > 0;
    const rec = q.getAttribute('recommended');
    const a: Answer = (state.answers[id] ??= { values: [], other: '', note: '', text: '' });
    const prompt = q.querySelector<HTMLElement>(':scope > p');
    const explain = q.querySelector<HTMLElement>(':scope > t-explain');
    if (explain) explain.hidden = true;
    q.setAttribute('data-comment-target', '');

    // header: number, hint, state
    const hint = type === 'text' ? 'Write an answer' : type === 'single' ? 'Choose one' : max ? `Choose up to ${max}` : 'Choose any';
    const badge = h('span', { class: 'k-badge is-muted t-qstate', hidden: quiz });
    const head = h('div', { class: 't-qhead', 'data-uncommentable': '' }, h('span', { class: 't-qnum' }, (quiz ? 'Check ' : 'Q') + (qi + 1)), h('span', {}, '·'), h('span', {}, hint), badge);
    q.prepend(head);
    if (prompt) head.after(prompt);

    // options
    const opts = h('div', { class: 't-opts', role: type === 'single' ? 'radiogroup' : 'group', 'aria-label': prompt?.textContent ?? id });
    const inputs: HTMLInputElement[] = [];
    let refreshOther = () => {};
    const option = (value: string, label: (Node | string)[], small: Element | null, wrapper: HTMLElement) => {
      const iid = `${id}--${value}`;
      const input = h('input', { type: type === 'single' ? 'radio' : 'checkbox', name: id, value, id: iid, checked: a.values.includes(value) });
      inputs.push(input);
      const title = h('span', { class: 't-optlabel' }, label, rec === value ? h('span', { class: 'k-badge' }, 'Recommended') : null);
      const body = h('span', { class: 't-optbody' }, title, small);
      const ind = h('span', { class: 't-ind ' + (type === 'single' ? 'is-radio' : 'is-check'), html: type === 'single' ? '<i></i>' : ICON.check });
      wrapper.replaceChildren(h('label', { class: 't-opt', for: iid }, input, ind, body));
      opts.append(wrapper);
      return { input, body };
    };
    if (type === 'text') {
      const ta = h('textarea', { class: 't-field', id: id + '--text', rows: 3, placeholder: q.getAttribute('placeholder') ?? 'Your answer' });
      ta.value = a.text;
      ta.addEventListener('input', () => { a.text = ta.value; render(); changed(); });
      opts.append(ta);
    } else {
      q.querySelectorAll<HTMLElement>(':scope > t-option').forEach((o) => {
        const small = o.querySelector('small');
        small?.remove();
        option(o.getAttribute('value') ?? slug(o.textContent ?? ''), [...o.childNodes], small, o);
      });
      if (!q.hasAttribute('no-other') && !quiz) {
        const other = h('input', { type: 'text', class: 't-field', id: id + '--other-text', placeholder: 'Describe your option' });
        other.value = a.other;
        const { input, body } = option('other', ['Other'], null, h('t-option'));
        body.append(other);
        refreshOther = () => { other.hidden = !input.checked; };
        refreshOther();
        other.addEventListener('input', () => {
          a.other = other.value;
          if (other.value && !input.checked) { input.checked = true; sync(input); }
          changed();
        });
        input.addEventListener('change', () => { if (input.checked) setTimeout(() => other.focus(), 0); });
      }
    }
    q.append(opts);
    if (explain) q.append(explain);

    // footer: Check for self-checks, a note for design questions
    const foot = h('div', { class: 't-qfoot', 'data-uncommentable': '' });
    const verdict = h('span', { class: 't-verdict', 'aria-live': 'polite' });
    const checkBtn = h('button', { class: 'k-btn is-sm', type: 'button' }, 'Check');
    if (quiz) {
      checkBtn.addEventListener('click', () => (q.classList.contains('is-checked') ? reset() : check()));
      foot.append(checkBtn, verdict);
    } else if (type !== 'text' && mode === 'design') {
      const noteBox = h('textarea', { class: 't-field', id: id + '--note', rows: 2, placeholder: 'Why, or anything Claude should know', hidden: !a.note });
      noteBox.value = a.note;
      const noteBtn = h('button', { class: 'k-btn is-ghost is-sm', type: 'button' }, a.note ? 'Note' : 'Add a note');
      noteBtn.addEventListener('click', () => {
        noteBox.hidden = !noteBox.hidden;
        if (!noteBox.hidden) { noteBox.focus(); anim(noteBox, { opacity: [0, 1], transform: ['translateY(-4px)', 'translateY(0px)'] }); }
      });
      noteBox.addEventListener('input', () => { a.note = noteBox.value; changed(); });
      foot.append(noteBtn, noteBox);
    }
    if (foot.childNodes.length) q.append(foot);

    const limit = () => { if (max) inputs.forEach((i) => { i.disabled = !i.checked && a.values.length >= max; }); };
    function sync(input: HTMLInputElement) {
      a.values = type === 'single' ? (input.checked ? [input.value] : []) : inputs.filter((i) => i.checked).map((i) => i.value);
      limit(); refreshOther(); render(); changed();
    }
    for (const input of inputs) input.addEventListener('change', () => {
      sync(input);
      sound.play(input.checked ? 'select' : 'deselect');
      if (input.checked) anim(input.parentElement?.querySelector('.t-ind'), { scale: [0.7, 1] }, { bounce: 0.35, duration: 0.22 });
      if (q.classList.contains('is-checked')) reset();
    });
    limit();

    function check() {
      const right = [...answerKey].sort().join() === [...a.values].sort().join();
      for (const i of inputs) {
        const row = i.closest('.t-opt')!;
        row.classList.toggle('is-right', answerKey.includes(i.value) && (i.checked || !right));
        row.classList.toggle('is-wrong', i.checked && !answerKey.includes(i.value));
      }
      q.classList.add('is-checked');
      verdict.className = 't-verdict ' + (right ? 'is-ok' : 'is-bad');
      verdict.textContent = right ? 'Correct' : 'Not quite. The right answer is marked.';
      checkBtn.textContent = 'Try again';
      if (explain) { explain.hidden = false; anim(explain, { opacity: [0, 1], transform: ['translateY(-4px)', 'translateY(0px)'] }); }
      if (!right) anim(opts, { x: [0, -5, 5, -2, 0] }, { type: 'tween', duration: 0.24 });
      sound.play(right ? 'send' : 'reveal');
      a.checked = right;
      changed();
    }
    function reset() {
      q.classList.remove('is-checked');
      verdict.textContent = '';
      checkBtn.textContent = 'Check';
      inputs.forEach((i) => i.closest('.t-opt')?.classList.remove('is-right', 'is-wrong'));
      if (explain) explain.hidden = true;
      render();
    }
    const done = () => (type === 'text' ? !!a.text.trim() : a.values.length > 0);
    function render() {
      badge.textContent = done() ? 'Answered' : 'Open';
      if (quiz && !q.classList.contains('is-checked')) checkBtn.disabled = !done();
    }
    render();

    // an option's label is every node in its title (text, <code>, links…) but the Recommended badge
    const labelOf = (v: string) => v === 'other'
      ? 'Other: ' + a.other
      : ([...(q.querySelector(`input[value="${CSS.escape(v)}"]`)?.closest('.t-opt')?.querySelector('.t-optlabel')?.childNodes ?? [])]
        .filter((n) => !(n instanceof Element && n.classList.contains('k-badge')))
        .map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim() || v);
    const text = prompt?.textContent?.trim() || id;
    return {
      el: q, id, quiz, done,
      num: quiz ? '' : 'Q' + (qi + 1),
      label: q.getAttribute('toc') ?? text,
      report: () => ({ question: text, type, values: [...a.values], labels: a.values.map(labelOf), other: a.other, text: a.text, note: a.note, recommended: rec }),
    };
  }
}
