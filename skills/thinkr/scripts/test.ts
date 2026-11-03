#!/usr/bin/env bun
/* Runtime regression test: builds the two templates, and the design with its specs (templates/*spec.md), drives them
   in headless Chrome, and checks what the reader would see after each action; and checks that the build refuses the
   specs it should. Run it after changing anything in runtime/ or scripts/changes.ts and scripts/spec.ts.

     bun scripts/test.ts        # needs Chrome; set CHROME when it is not in a usual place */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { browser, findChrome, themeChecks } from '../kit/build/chrome';

const ROOT = join(import.meta.dir, '..');
findChrome();

// Option labels with markup, which the template's plain labels leave untested. They go in before the first build,
// so both versions have them and they are not a change.
const DESIGN_V1: [string | RegExp, string][] = [
  ['<t-option value="bucket">Token bucket<small>', '<t-option value="bucket">Token bucket, one <code>EVALSHA</code> call<small>'],
  ['<t-option value="org">Organization<small>', '<t-option value="org"><b>Organization</b>, by <code>org_id</code><small>'],
];

// The design is tested at version 2: built once as the template, then changed as below and built again, so the build
// has a version to compare with and the page has Changes to pick.
const DESIGN_V2: [string | RegExp, string][] = [
  ['version="1"', 'version="2"'],
  ['  </header>\n', `  </header>
  <t-amends>
    <t-amend version="2" kind="answer" label="Requests pass when Redis is down" re="When Redis does not answer within 20 ms, what should the gateway do?" answer="Let the request through" at="flow">
      The check now says what it costs when Redis is down.
    </t-amend>
    <t-amend version="2" kind="comment" label="Two weeks of shadow mode" re="Is one week of shadow mode enough?" at="rollout references">
      Shadow mode runs two weeks, and the Retry-After reference went with the old timeline.
    </t-amend>
  </t-amends>
`],
  ['It costs one Redis round trip per request.', 'It costs one Redis round trip per request, and lets the request through when Redis is slow.'],
  ['so we can set the numbers from real', 'so we can tune the numbers from two weeks of real'],
  ['    <t-question id="exceptions"', '    <p>Two weeks covers a month-end billing run.</p>\n\n    <t-question id="exceptions"'],
  [/ *<li><a href="https:\/\/developer\.mozilla\.org\/en-US\/docs\/Web\/HTTP\/Headers\/Retry-After">[\s\S]*?<\/li>\n/, ''],
];

// The spec case is the design with every question decided (gone from the page) and its two specs beside it:
// templates/spec.md, for people, and templates/agent-spec.md, for the agent.
const SPEC = await Bun.file(join(ROOT, 'templates/spec.md')).text();
const AGENT = await Bun.file(join(ROOT, 'templates/agent-spec.md')).text();
const decided = (src: string) => src.replace(/\n *<t-question[\s\S]*?<\/t-question>\n/g, '\n');
// What the build must refuse: specs beside open questions, one without the other, or one that is stale, open or (the
// agent's) has no checks. A null spec is left out.
const REFUSED: { name: string; page: (src: string) => string; spec: string | null; agent: string | null; says: string }[] = [
  { name: 'open questions', page: (src) => src, spec: SPEC, agent: AGENT, says: 'The specs are written once every question is decided, and 4 are still open' },
  { name: 'no agent spec', page: decided, spec: SPEC, agent: null, says: 'needs its agent spec' },
  { name: 'no spec for people', page: decided, spec: null, agent: AGENT, says: 'needs its spec for people' },
  { name: 'newer than the page', page: decided, spec: SPEC, agent: AGENT.replace('design-version: 1', 'design-version: 2'), says: 'design-version: 2 is newer than the page' },
  { name: 'no front matter', page: decided, spec: SPEC.replace(/^---[\s\S]*?---\n/, ''), agent: AGENT, says: 'front matter block' },
  { name: 'left open', page: decided, spec: SPEC, agent: AGENT.replace('## Out of scope', '## Out of scope\n\n- Limits by plan: TBD.'), says: 'leaves something open' },
  { name: 'no checks', page: decided, spec: SPEC, agent: AGENT.replace('## Done when', '## Checks'), says: 'add a "## Done when" section' },
];

// Each case runs in the page; `r` collects facts, `expect` lists what they must be, and `budget` caps timings
// in ms: t(fn) times the synchronous work a click or input does before the browser can paint the result. An
// interaction must fit well inside one 60 Hz frame (16.7 ms), so the next frame already shows its result.
const BUDGET = { boot: 30, interaction: 12 };
// `prime` runs on a first load and the page is opened again, as a reader coming back would open it. `viewer` runs
// before the page's own scripts on every load.
const cases: Record<string, { viewer?: string; prime?: string; hash?: string; run: string; expect: Record<string, unknown>; budget: Record<string, number> }> = {
  design: {
    // A stand-in for the claude.ai viewer: the page database in memory (__docs), a reader "u_me", and a comments
    // capability that records each send's text, or fails once with rate_limited when __fail is set.
    viewer: `(() => {
      const docs = window.__docs = new Map();
      window.__sent = [];
      const db = { doc: (path) => ({ path, get: async () => ({ exists: docs.has(path) }), set: async (d) => { docs.set(path, d); } }) };
      const comments = {
        canSendToClaude: async () => 'available',
        anchorFor: async () => ({}),
        sendToClaude: async ({ text }) => {
          if (window.__fail) { window.__fail = false; throw { code: 'rate_limited' }; }
          window.__sent.push(text);
          return { threadId: 't' + window.__sent.length };
        },
      };
      const user = { id: async () => 'u_me', can: async () => true };
      window.claude = { use: async (name) => ({ db, comments, user })[name] ?? null };
    })();`,
    prime:`localStorage.setItem('thinkr:api-rate-limits:design:seen', '1')`, // this reader last saw version 1
    budget: { boot: BUDGET.boot, select: BUDGET.interaction, step: BUDGET.interaction, panel: BUDGET.interaction, toc: BUDGET.interaction, change: BUDGET.interaction },
    run: `
      ms.select = t(() => $('#algorithm--bucket').click());
      r.badge = $('#algorithm .t-qstate').textContent;
      r.count = $('.t-progress b').textContent;
      $('#scopes--key').click(); $('#scopes--org').click();
      r.maxDisabled = $('#scopes--ip').disabled;
      $('#redis-down--other').click();
      r.otherShown = !$('#redis-down--other-text').hidden;
      $('#redis-down--open').click();
      r.otherHidden = $('#redis-down--other-text').hidden;
      const part = $('#flow-fig [data-show="2+"]');
      r.offAtStep1 = part.classList.contains('is-off');
      ms.step = t(() => $('#flow-fig [aria-label="Next step"]').click());
      r.onAtStep2 = !part.classList.contains('is-off');
      r.saved = Object.keys(JSON.parse(localStorage.getItem('thinkr:api-rate-limits:design')).answers).length;
      r.refHost = $('t-refs .t-host').textContent;
      // a Mermaid block is drawn at build, so no mermaid block is left for the viewer to draw
      r.diagram = !!$('#flow ~ .k-dia svg.pele-flowchart .pele-node.new') && !document.querySelector('pre.mermaid');

      // the figure viewport: zoom, reset, resize from an edge
      const stage = $('#flow-fig .t-stage'), fsvg = stage.querySelector('svg');
      await new Promise((ok) => setTimeout(ok, 100));
      const vb = fsvg.viewBox.baseVal, bb = fsvg.getBBox();
      r.fitsContent = vb.x <= bb.x && vb.y <= bb.y && vb.x + vb.width >= bb.x + bb.width && vb.y + vb.height >= bb.y + bb.height;
      $('#flow-fig [aria-label="Zoom in"]').click();
      r.zoomed = $('#flow-fig .t-zoom-level').textContent;
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
      r.reset = $('#flow-fig .t-zoom-level').textContent;
      const edge = $('#flow-fig .t-edge.is-s'), er = edge.getBoundingClientRect(), h0 = stage.offsetHeight;
      const drag = (type, y) => edge.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, button: 0, buttons: 1, clientX: er.x + 20, clientY: y }));
      drag('pointerdown', er.y); drag('pointermove', er.y + 100); drag('pointerup', er.y + 100);
      r.taller = stage.offsetHeight > h0;

      // the send panel
      const form = $('#t-composer');
      ms.panel = t(() => $('.t-dock > .k-btn.is-primary').click());
      r.panel = form.classList.contains('is-open') && $('.t-composer-head b').textContent;
      r.panelWarn = !$('.t-composer-warn').hidden && $('.t-composer-warn span').textContent;
      const box = $('#t-composer-text');
      box.value = 'Ship it after the load test.'; box.dispatchEvent(new Event('input'));
      r.draft = JSON.parse(localStorage.getItem('thinkr:api-rate-limits:design:message'));
      form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      r.escCloses = !form.classList.contains('is-open');
      $('.t-dock > .k-btn:not(.is-primary)').click();
      r.sendPanel = form.classList.contains('is-open') && $('.t-composer-head b').textContent;
      r.sendNoWarn = $('.t-composer-warn').hidden;
      r.draftKept = box.value;
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      r.outsideCloses = !form.classList.contains('is-open');

      // "On this page": sections with their questions one notch in, answered dots, the stepped rail
      await new Promise((ok) => setTimeout(ok, 300));
      r.tocEntries = document.querySelectorAll('.t-toc li').length;
      r.tocSub = document.querySelectorAll('.t-toc li.is-sub').length;
      r.tocDone = document.querySelectorAll('.t-toc li[data-done]').length;
      const d = $('.t-toc-rail path')?.getAttribute('d') ?? '';
      r.railNotches = d.includes('M0.5') && d.includes('L12.5');

      scrollTo(0, 0);
      await new Promise((ok) => setTimeout(ok, 100));
      ms.toc = t(() => $('.t-toc li:last-child a').click());
      await new Promise((ok) => setTimeout(ok, 150));
      r.tocMidGlide = scrollY > 0 && $('#references').getBoundingClientRect().top > 90;
      await new Promise((ok) => setTimeout(ok, 1500));
      r.tocLands = Math.abs($('#references').getBoundingClientRect().top - 84) < 4 || scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
      r.tocHash = location.hash;
      // at the end of the page, a click on an entry already on screen still moves the marker and flashes the target
      const rollout = [...document.querySelectorAll('.t-toc a')].find((a) => a.textContent === 'Rollout');
      rollout.click();
      r.pinOn = $('.t-toc a.is-on')?.textContent;
      await new Promise((ok) => setTimeout(ok, 1000));
      r.pinHeld = $('.t-toc a.is-on')?.textContent;
      r.flashed = $('#rollout').classList.contains('t-flash');
      dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
      r.wheelReleases = $('.t-toc a.is-on')?.textContent !== 'Rollout' || $('#rollout').getBoundingClientRect().top < 140;
      $('.t-progress').click();
      await new Promise((ok) => setTimeout(ok, 1500));
      const top = $('#exceptions').getBoundingClientRect().top;
      r.nextOpen = Math.abs(top - 84) < 4 || (top > 84 && top < innerHeight && scrollY + innerHeight >= document.documentElement.scrollHeight - 2);

      // Changes: one-line rows (new ones dotted), the marks the build wrote (hidden until a row opens), opening a
      // row (its question and answer, its marks, the stepper), switching, closing, folding a version
      const rows = [...document.querySelectorAll('.t-chg-row')];
      r.chgEntries = rows.length;
      r.chgNew = document.querySelectorAll('.t-chg-dot').length + ' ' + $('.t-changes-btn .t-count')?.textContent;
      r.chgRail = getComputedStyle($('.t-changes')).position;
      r.chgMarked = document.querySelectorAll('t-page [data-amend]').length;
      r.chgQuiet = getComputedStyle($('del[data-t]')).display === 'none' && $('[data-removed]').hidden && !$('.is-lit')
        && getComputedStyle($('.t-chg-detail')).display === 'none';
      r.chgHeading = $('#flow').textContent;
      ms.change = t(() => rows[1].click());
      r.chgPos = $('.t-chgnav-pos').textContent;
      r.chgLit = document.querySelectorAll('.is-lit').length;
      r.chgShown = !$('[data-removed]').hidden && getComputedStyle($('.is-lit del[data-t]')).display === 'inline';
      r.chgBar = $('.t-bar').classList.contains('is-stepping') && $('.t-chgnav-label').textContent;
      $('[aria-label="Next change"]').click();
      r.chgNext = $('.t-chgnav-pos').textContent;
      rows[0].click();
      r.chgSwitch = $('.t-chgnav-pos').textContent + ' ' + document.querySelectorAll('.t-chg.is-on').length;
      r.chgQA = [...document.querySelectorAll('.t-chg.is-on .t-chg-qa dd')].map((d) => d.textContent).join(' | ');
      rows[0].click();
      r.chgReclick = !$('.t-chg.is-on') && !$('.is-lit');
      rows[1].click();
      dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      r.chgCleared = !$('.is-lit') && !$('.t-chg.is-on') && $('[data-removed]').hidden && !$('.t-bar').classList.contains('is-stepping');
      $('.t-chg-vbtn').click();
      r.chgFold = $('.t-chg-items').hidden;
      $('.t-chg-vbtn').click();
      r.chgUnfold = !$('.t-chg-items').hidden;
      r.chgSeen = JSON.parse(localStorage.getItem('thinkr:api-rate-limits:design:seen'));

      // sends: each lists the answers that changed since the last send that reached Claude, and names the rest
      const submit = async (approve) => {
        if (!$('#t-composer').classList.contains('is-open')) $(approve ? '.t-dock > .k-btn.is-primary' : '.t-dock > .k-btn:not(.is-primary)').click();
        $('#t-composer').requestSubmit();
        await new Promise((ok) => setTimeout(ok, 100));
        return window.__sent.at(-1).split('\\n\\n').map((b) => b.split('\\n')[0]).join(' | ');
      };
      r.sendFirst = await submit(false);
      // labels with markup come back whole, in the send and in the database, and never with "Recommended"
      r.sentLabels = window.__sent.at(-1).split('\\n\\n').slice(1, 3).map((b) => b.split('\\n')[1]).join(' | ');
      r.dbLabels = ['algorithm', 'scopes'].map((id) => window.__docs.get('responses/u_me').answers[id].labels.join('; ')).join(' | ');
      r.sendApprove = await submit(true);
      $('#algorithm--sliding').click();
      r.sendChanged = await submit(false);
      $('#redis-down--closed').click();
      window.__fail = true;
      r.sendFailed = (await submit(false)) === r.sendChanged && $('#t-composer').classList.contains('is-open');
      r.sendRetry = await submit(false);`,
    expect: {
      badge: 'Answered', count: '1/4', maxDisabled: true, otherShown: true, otherHidden: true, offAtStep1: true, onAtStep2: true, saved: 4, refHost: 'redis.io', diagram: true, fitsContent: true, zoomed: '150%', reset: '100%', taller: true,
      panel: 'Approve design', panelWarn: '1 question is still open.', draft: 'Ship it after the load test.', escCloses: true,
      sendPanel: 'Send feedback', sendNoWarn: true, draftKept: 'Ship it after the load test.', outsideCloses: true,
      tocEntries: 7, tocSub: 4, tocDone: 3, railNotches: true, tocMidGlide: true, tocLands: true, tocHash: '#references', pinOn: 'Rollout', pinHeld: 'Rollout', flashed: true, wheelReleases: true, nextOpen: true,
      chgEntries: 2, chgNew: '2 2', chgRail: 'sticky', chgMarked: 4, chgQuiet: true, chgHeading: 'How a request is checked', chgPos: '1 / 3', chgLit: 3, chgShown: true,
      chgBar: 'Two weeks of shadow mode', chgNext: '2 / 3', chgSwitch: '1 / 1 1', chgQA: 'When Redis does not answer within 20 ms, what should the gateway do? | Let the request through',
      chgReclick: true, chgCleared: true, chgFold: true, chgUnfold: true, chgSeen: 2,
      sendFirst: 'Feedback on: API Rate Limits (v2) | Q1 Which algorithm should count requests? | Q2 What should each limit be counted against? | Q3 When Redis does not answer within 20 ms, what should the gateway do? | Q4 Which customers need a higher limit from day one? | Message: | Full answers: responses/u_me in the page database.',
      sentLabels: '→ Token bucket, one EVALSHA call | → API key; Organization, by org_id',
      dbLabels: 'Token bucket, one EVALSHA call | API key; Organization, by org_id',
      sendApprove: 'Approved: API Rate Limits (v2) | Q4 Which customers need a higher limit from day one? | Answers unchanged since the last send: Q1, Q2, Q3. | Full answers: responses/u_me in the page database.',
      sendChanged: 'Feedback on: API Rate Limits (v2) | Q1 Which algorithm should count requests? | Q4 Which customers need a higher limit from day one? | Answers unchanged since the last send: Q2, Q3. | Full answers: responses/u_me in the page database.',
      sendFailed: true,
      sendRetry: 'Feedback on: API Rate Limits (v2) | Q3 When Redis does not answer within 20 ms, what should the gateway do? | Q4 Which customers need a higher limit from day one? | Answers unchanged since the last send: Q1, Q2. | Full answers: responses/u_me in the page database.',
    },
  },
  spec: {
    // the clipboard, recorded, so Copy Markdown can be read back
    viewer: `Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied = text; } } });`,
    hash: '#spec', // the link guided-review gives: the page opens on the spec
    budget: { boot: BUDGET.boot, view: BUDGET.interaction },
    run: `
      r.openedOnSpec = !$('#t-spec-view').hidden && $('#t-design-view').hidden && document.documentElement.classList.contains('t-in-spec');
      r.tabs = [...document.querySelectorAll('.t-views button')].map((b) => b.textContent + ' ' + b.getAttribute('aria-selected')).join(', ');
      r.barBadge = $('.t-bar-title .k-badge').textContent;
      r.titleHidden = !$('.t-bar').classList.contains('is-scrolled');
      r.specTitle = $('t-spec h1').textContent;
      r.specFor = $('t-spec .t-eyebrow span:nth-child(2)').textContent;
      r.specToc = [...document.querySelectorAll('#t-spec-view .t-toc a')].map((a) => a.textContent).join(', ');
      // a table, a Mermaid diagram drawn at build, highlighted code, a link out
      r.specParts = [!!$('t-spec .t-scroll table'), !!$('t-spec .k-dia svg'), !!$('t-spec .t-code .hljs-keyword'), !!$('t-spec a.t-ext')].join(' ');
      r.dockAway = getComputedStyle($('.t-dock')).display;
      $('.t-spec-copy').click();
      await new Promise((ok) => setTimeout(ok, 50));
      r.copied = window.__copied === THINKR.agentSpec && window.__copied.length; // the agent's, which the page does not show

      // the switch: each view keeps where the reader was, and the hash follows the view
      const [design, spec] = document.querySelectorAll('.t-views button');
      ms.view = t(() => design.click());
      r.backToDesign = !$('#t-design-view').hidden && $('#t-spec-view').hidden && location.hash === '' && $('.t-bar-title .k-badge').textContent;
      r.noProgress = $('.t-progress').hidden; // every question is decided
      scrollTo(0, 600);
      await new Promise((ok) => setTimeout(ok, 100));
      spec.click();
      r.specFromTop = scrollY;
      r.specHash = location.hash;
      design.click();
      r.keptScroll = scrollY;`,
    expect: {
      openedOnSpec: true, tabs: 'Design false, Spec true', barBadge: 'Spec', titleHidden: true, specTitle: 'API Rate Limits', specFor: 'For version 1 of the design',
      specToc: 'What happens to a request, Budgets, What clients see, How it ships, Not in this change', specParts: 'true true true true', dockAway: 'none', copied: AGENT.length,
      backToDesign: 'Design', noProgress: true, specFromTop: 0, specHash: '#spec', keptScroll: 600,
    },
  },
  explain: {
    budget: { boot: BUDGET.boot, check: BUDGET.interaction, slider: BUDGET.interaction },
    run: `
      r.checkDisabled = $('#steep-axis .t-qfoot button').disabled;
      r.explainHidden = $('#steep-axis t-explain').hidden;
      $('#steep-axis--faster').click();
      ms.check = t(() => $('#steep-axis .t-qfoot button').click());
      r.wrong = !!$('#steep-axis .t-opt.is-wrong') && !!$('#steep-axis .t-opt.is-right');
      r.explainShown = !$('#steep-axis t-explain').hidden;
      $('#steep-axis--bounce').click();
      $('#steep-axis .t-qfoot button').click();
      r.verdict = $('#steep-axis .t-verdict').textContent;
      r.noOther = !$('#steep-axis--other');
      const range = $('#landscape input[type=range]');
      ms.slider = t(() => { range.value = '0.24'; range.dispatchEvent(new Event('input')); });
      r.output = $('#landscape output').textContent;
      r.math = !!$('mjx-container');
      r.code = !!$('.hljs-keyword');
      r.motion = !!(await thinkr.motion());
      // where WebGPU runs, the field is the shader's, not the Canvas 2D fallback's
      r.shader = !(await navigator.gpu?.requestAdapter()) || !!$('#landscape canvas').getContext('webgpu');`,
    expect: { checkDisabled: true, explainHidden: true, wrong: true, explainShown: true, verdict: 'Correct', noOther: true, output: '0.24', math: true, code: true, motion: true, shader: true },
  },
};

const tmp = mkdtempSync(join(tmpdir(), 'thinkr-test-'));
let failed = 0;
try {
  const build = (file: string) => {
    const b = Bun.spawnSync(['bun', join(ROOT, 'scripts/build.ts'), file]);
    if (b.exitCode || / warn /.test(b.stdout.toString())) { console.log(b.stdout.toString()); process.exit(1); }
  };
  const edit = async (file: string, edits: [string | RegExp, string][], list: string) => {
    let src = await Bun.file(file).text();
    for (const [from, to] of edits) {
      const hit = typeof from === 'string' ? from : from.exec(src)?.[0];
      if (!hit || !src.includes(hit)) { console.log(`fail  design: the template no longer has ${from}; update ${list}`); process.exit(1); }
      src = src.replace(hit, to);
    }
    await Bun.write(file, src);
  };
  for (const r of REFUSED) {
    const stem = join(tmp, 'refused-' + r.name.replace(/\W+/g, '-'));
    await Bun.write(`${stem}.html`, r.page(await Bun.file(join(ROOT, 'templates/design.html')).text()));
    if (r.spec != null) await Bun.write(`${stem}.spec.md`, r.spec);
    if (r.agent != null) await Bun.write(`${stem}.agent-spec.md`, r.agent);
    const out = Bun.spawnSync(['bun', join(ROOT, 'scripts/build.ts'), `${stem}.html`]);
    const ok = out.exitCode === 1 && out.stdout.toString().includes(r.says);
    if (!ok) { failed++; console.log(`fail  spec refused, ${r.name}: expected an error with "${r.says}", got:\n${out.stdout}`); }
  }
  if (!failed) console.log(`ok    spec refused (${REFUSED.length} cases)`);

  for (const [name, c] of Object.entries(cases)) {
    // built in the temp folder, so the history file the build keeps for a design never lands in templates/
    const file = join(tmp, `${name}.html`);
    const from = name === 'spec' ? 'design' : name;
    await Bun.write(file, Bun.file(join(ROOT, `templates/${from}.html`)));
    if (name === 'spec') {
      await Bun.write(file, decided(await Bun.file(file).text()));
      await Bun.write(join(tmp, 'spec.spec.md'), SPEC);
      await Bun.write(join(tmp, 'spec.agent-spec.md'), AGENT);
    }
    if (name === 'design') await edit(file, DESIGN_V1, 'DESIGN_V1');
    build(file);
    if (name === 'design') {
      await edit(file, DESIGN_V2, 'DESIGN_V2');
      build(file);
    }
    const chromeTab = await browser(join(tmp, 'profile-' + name));
    try {
      const url = 'file://' + join(tmp, `${name}.preview.html`) + (c.hash ?? '');
      if (c.viewer) await chromeTab.send('Page.addScriptToEvaluateOnNewDocument', { source: c.viewer });
      await chromeTab.open(url);
      if (c.prime) { await chromeTab.run(c.prime); await chromeTab.open(url); }
      const raw = await chromeTab.run(`(async () => {
        const r = {}, ms = {}, $ = (s) => document.querySelector(s);
        const t = (fn) => { const s = performance.now(); fn(); return +(performance.now() - s).toFixed(2); };
        await new Promise((ok) => setTimeout(ok, 600));
        ms.boot = +performance.getEntriesByName('thinkr:boot')[0].duration.toFixed(2);
        ${c.run}
        return JSON.stringify({ r, ms });
      })()`);
      if (typeof raw !== 'string' || !raw.startsWith('{')) { console.log(`fail  ${name}: ${raw}`); failed++; continue; }
      const { r: got, ms } = JSON.parse(raw) as { r: Record<string, unknown>; ms: Record<string, number> };
      const bad = Object.entries(c.expect).filter(([k, v]) => got[k] !== v);
      for (const [k, v] of bad) console.log(`fail  ${name}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
      const slow = Object.entries(c.budget).filter(([k, max]) => !(ms[k] <= max));
      for (const [k, max] of slow) console.log(`slow  ${name}.${k}: ${ms[k]} ms, budget ${max} ms`);
      for (const err of chromeTab.errors) console.log(`error ${name}: ${err.split('\n')[0]}`);
      if (!bad.length && !slow.length && !chromeTab.errors.length)
        console.log(`ok    ${name} (${Object.keys(c.expect).length} checks, no errors; ${Object.entries(ms).map(([k, v]) => `${k} ${v}ms`).join(', ')})`);
      failed += bad.length + slow.length + chromeTab.errors.length;
    } finally {
      chromeTab.close();
    }
  }
  failed += await themeChecks('file://' + join(tmp, 'design.preview.html'), join(tmp, 'profile-theme'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
