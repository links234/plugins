/* The design dock: progress (click it to jump to the next open question), Send feedback and Approve design. Either
   button opens a panel above the dock with an optional message and Submit. Each viewer's answers and message go to
   the page database at responses/<user id> (Claude reads them with ArtifactData); Submit posts a short summary
   with Send to Claude, which wakes the session. Where a viewer cannot send, the summary is copied for the chat. */
import type { CanSendToClaude, CapabilityMap, CommentsCap, DocRef } from './types';
import type { AnswerReport, Question } from './questions';
import { copyText, h, store } from '../kit/web/dom';
import { sound } from '../kit/web/sound';
import { toast } from '../kit/web/toast';
import { anim } from './libs';

const MAX_BYTES = 3900; // a comment holds 4 KiB
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface DockOptions {
  page: HTMLElement; version: number; key: string;
  questions: Question[]; onChange: Set<() => void>;
  jump(el: HTMLElement): void;
}

export function createDock({ page, version, key, questions, onChange, jump }: DockOptions) {
  const title = page.querySelector('h1')?.textContent?.trim() || document.title;
  const asks = questions.filter((q) => !q.quiz);
  const open = () => asks.filter((q) => !q.done());
  const draftKey = key + ':message';
  let message = store.get<string>(draftKey) ?? '';

  // ---------------------------------------------------------------- dock
  const fill = h('i');
  const count = h('b');
  const progress = h('button', { class: 't-progress', type: 'button', title: 'Go to the next open question', hidden: !asks.length },
    h('span', { class: 't-meter' }, fill), h('span', {}, count, h('span', { class: 't-plabel' }, ' answered')));
  progress.addEventListener('click', () => { const q = open()[0]; if (q) jump(q.el); });
  const sendBtn = h('button', { class: 'k-btn is-sm', type: 'button', 'aria-expanded': 'false', 'aria-controls': 't-composer' }, 'Send feedback');
  const approveBtn = h('button', { class: 'k-btn is-sm is-primary', type: 'button', 'aria-expanded': 'false', 'aria-controls': 't-composer' }, 'Approve design');

  // ---------------------------------------------------------------- panel
  const heading = h('b');
  const meta = h('span', { class: 't-composer-meta' });
  const warnText = h('span');
  const warnJump = h('button', { class: 'k-btn is-ghost is-sm', type: 'button' }, 'Show me');
  const warn = h('p', { class: 't-composer-warn', hidden: true }, warnText, warnJump);
  const box = h('textarea', { class: 't-field', id: 't-composer-text', rows: 3, maxlength: 2000, placeholder: 'Anything else Claude should know? Optional.' });
  box.value = message;
  const cancel = h('button', { class: 'k-btn is-ghost is-sm', type: 'button' }, 'Cancel');
  const submit = h('button', { class: 'k-btn is-primary is-sm', type: 'submit' }, 'Submit');
  const hint = h('span', { class: 't-composer-hint' }, h('kbd', {}, MAC ? '⌘' : 'Ctrl'), h('kbd', {}, '↵'));
  const form = h('form', { class: 't-composer', id: 't-composer', 'aria-label': 'Send to Claude' },
    h('div', { class: 't-composer-head' }, heading, meta), warn, box, h('div', { class: 't-composer-foot' }, hint, cancel, submit));

  const dock = h('div', { class: 't-dock', 'data-uncommentable': '' }, form, progress, sendBtn, approveBtn);
  document.body.append(dock);

  const paint = () => {
    const done = asks.length - open().length;
    count.textContent = `${done}/${asks.length}`;
    fill.style.width = (asks.length ? (done / asks.length) * 100 : 100) + '%';
    meta.textContent = `${done} of ${asks.length} answered · v${version}`;
  };
  onChange.add(paint);
  paint();

  let approving: boolean | null = null; // null: the panel is closed
  function show(approve: boolean) {
    if (approving === approve) return hide();
    const wasOpen = approving !== null;
    approving = approve;
    heading.textContent = approve ? 'Approve design' : 'Send feedback';
    const n = open().length;
    warn.hidden = !approve || n === 0;
    warnText.textContent = n === 1 ? '1 question is still open.' : `${n} questions are still open.`;
    sendBtn.setAttribute('aria-expanded', String(!approve));
    approveBtn.setAttribute('aria-expanded', String(approve));
    sendBtn.classList.toggle('is-active', !approve);
    approveBtn.classList.toggle('is-active', approve);
    form.classList.add('is-open'); // always laid out, so opening is a class change, not a layout
    if (!wasOpen) {
      anim(form, { opacity: [0, 1], transform: ['translate(-50%, 6px) scale(0.985)', 'translate(-50%, 0px) scale(1)'] }, { type: 'tween', duration: 0.14, ease: [0.2, 0.8, 0.2, 1] });
      sound.play('reveal');
    }
    box.focus({ preventScroll: true }); // the panel is fixed on screen: no scroll, no layout to wait for
  }
  function hide() {
    approving = null;
    form.classList.remove('is-open');
    for (const b of [sendBtn, approveBtn]) { b.setAttribute('aria-expanded', 'false'); b.classList.remove('is-active'); }
  }
  sendBtn.addEventListener('click', () => show(false));
  approveBtn.addEventListener('click', () => show(true));
  cancel.addEventListener('click', () => hide());
  warnJump.addEventListener('click', () => { const q = open()[0]; hide(); if (q) jump(q.el); });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const was = approving; hide(); (was ? approveBtn : sendBtn).focus(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
  });
  document.addEventListener('pointerdown', (e) => { if (approving !== null && !dock.contains(e.target as Node)) hide(); });
  box.addEventListener('input', () => { message = box.value; store.set(draftKey, message); schedule(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); if (approving !== null) void send(approving); });

  // ---------------------------------------------------------------- capabilities
  let docRef: DocRef | null = null, comments: CommentsCap | null = null, canSend: CanSendToClaude = 'off', writeTimer = 0;
  const use = <K extends keyof CapabilityMap>(n: K) => window.claude?.use(n).catch(() => null) ?? Promise.resolve(null);
  const snapshot = (extra: Record<string, unknown> = {}) => ({
    pageVersion: version,
    updatedAt: new Date().toISOString(),
    answers: Object.fromEntries(questions.map((q) => [q.id, q.report()])),
    message,
    ...extra,
  });
  const write = async (extra?: Record<string, unknown>) => { try { await docRef?.set(snapshot(extra)); } catch { docRef = null; } };
  const schedule = () => { if (!docRef) return; clearTimeout(writeTimer); writeTimer = window.setTimeout(() => void write(), 900); };
  onChange.add(schedule);

  void (async () => {
    const [db, user, c] = await Promise.all([use('db'), use('user'), use('comments')]);
    comments = c;
    const refresh = async () => { canSend = comments ? await comments.canSendToClaude().catch(() => 'off' as const) : 'off'; };
    await refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
    if (!db || !user || (await user.can('data.write')) === false) return;
    const uid = await user.id();
    if (!uid) return;
    docRef = db.doc('responses/' + uid);
    const snap = await docRef.get().catch(() => null);
    if (!snap?.exists) void write();
  })();

  // ---------------------------------------------------------------- send
  // An answer an earlier send delivered, unchanged since, is named instead of repeated, so Send feedback and then
  // Approve design do not send every answer twice. Only with the page database, which still holds it for Claude.
  const sentKey = key + ':sent';
  const summary = (approved: boolean, reports: AnswerReport[], answers: Record<string, string>) => {
    const before = (docRef && store.get<Record<string, string>>(sentKey)) || {};
    const lines = [`${approved ? 'Approved' : 'Feedback on'}: ${title} (v${version})`];
    const same: string[] = [];
    questions.forEach((q, i) => {
      if (q.done() && before[q.id] === answers[q.id]) return void same.push(`Q${i + 1}`);
      const r = reports[i];
      const ans = r.type === 'text' ? r.text : r.labels.join('; ');
      lines.push(`Q${i + 1} ${r.question}\n→ ${ans || '(unanswered)'}${r.note ? `\n  note: ${r.note}` : ''}`);
    });
    if (same.length) lines.push(`Answers unchanged since the last send: ${same.join(', ')}.`);
    if (message.trim()) lines.push(`Message:\n${message.trim()}`);
    let text = lines.join('\n\n');
    if (docRef) text += `\n\nFull answers: ${docRef.path} in the page database.`;
    const enc = new TextEncoder();
    while (enc.encode(text).length > MAX_BYTES) text = text.slice(0, -200) + '…';
    return text;
  };
  const sent = (msg: string) => {
    sound.play('send');
    toast(msg);
    message = '';
    box.value = '';
    store.set(draftKey, '');
    hide();
  };

  // Submit never makes the reader wait: the panel closes at once, the database write and the send run in
  // parallel, and a failure reopens the panel with the message still in it.
  async function send(approved: boolean) {
    const reports = questions.map((q) => q.report());
    const answers = Object.fromEntries(questions.map((q, i) => [q.id, JSON.stringify(reports[i])]));
    const text = summary(approved, reports, answers);
    const now = new Date().toISOString();
    const extra = { sentAt: now, ...(approved ? { approved: { version, at: now } } : {}) };
    const draft = message;
    const reopen = (msg: string) => { show(approved); box.value = draft; toast(msg); };
    hide();
    if (canSend === 'available' && comments) {
      const c = comments;
      toast(approved ? 'Approving…' : 'Sending…');
      try {
        await Promise.all([write(extra), c.anchorFor(page.querySelector('h1') ?? page).then((anchor) => c.sendToClaude({ anchor, text }))]);
        store.set(sentKey, answers); // only a send that reached Claude, with the answers as they were when it left
        return sent(approved ? 'Approved. Claude will reply in the comment thread.' : 'Sent. Claude will reply in the comment thread.');
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === 'consent_required') return reopen('Not sent. Allow comments from this page to send feedback.');
        if (code === 'rate_limited') return reopen('Too many sends. Wait a moment and try again.');
        canSend = 'off';
        return reopen('Could not reach Claude. Press Submit again to copy your feedback instead.');
      }
    }
    void write(extra);
    copyText('# ' + text).then( // still inside the click, so the clipboard allows it
      () => sent('Copied. Paste it in your chat with Claude.'),
      () => reopen('Copy failed. Select your answers and copy them by hand.'),
    );
  }
}
