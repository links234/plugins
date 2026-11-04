/* Whether a release of @pierre/diffs or @pierre/trees works in a guide, checked before build.ts pins it
   (kit/build/libs.ts calls it for each release newer than the pin). A release can load and still draw nothing:
   @pierre/diffs 1.6.0 was published against an older @pierre/theming than its code calls, so every card stayed an
   empty header. Only a page shows that.

   The first check builds the demo (scripts/demo.ts) with the libraries pinned now; each check copies it, points the
   one library at the release, and opens it in headless Chrome, light and dark. Every open file card on the Guide and
   Diff tabs must draw its lines with @pierre/diffs (the plain-text fallback counts as a failure here), the Diff tab's
   tree must draw its rows with @pierre/trees, and the page must log no error or warning. A release that loads and
   fails goes into libs.json's `skip` with the reason; delete the entry to have it checked again. One that does not
   load in Chrome at all, without Chrome, or when the demo does not build, the check throws: the pin stays and the
   release is checked again on the next refresh. */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browser, chromeBinary } from '../kit/build/chrome';
import type { Verify } from '../kit/build/libs';
import { buildDemo } from './demo';

// Stops at the first thing that did not draw: one is enough to refuse the release.
const CHECK = `(async () => {
  const sleep = (n) => new Promise((ok) => setTimeout(ok, n));
  const until = async (fn, ms) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await sleep(50); return fn(); };
  let cards = 0;
  const drawn = async (root) => {
    for (const c of root.querySelectorAll('.gr-file:not(.collapsed)')) {
      const code = c.querySelector('.gr-code');
      if (!code || !code.offsetParent) continue;
      c.scrollIntoView();
      const lines = () => code.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]');
      const plain = () => code.querySelector('.gr-plain');
      await until(() => lines() || plain(), cards++ ? 5000 : 15000);
      if (!lines()) return c.dataset.path + (plain() ? ' fell back to plain text' : ' drew no code');
    }
    return null;
  };
  const guide = await drawn(document);
  if (guide) return guide;
  document.querySelector('.gr-tab[data-view="diff"]')?.click();
  const tree = await until(() => document.querySelector('.gr-tree-host')?.shadowRoot?.querySelector('[data-item-path]'), 15000);
  if (!tree) return document.querySelector('.gr-tree-host') ? 'the file tree drew no rows' : 'the file tree fell back to a list';
  const diff = await drawn(document.querySelector('.gr-diff-cards'));
  if (diff) return diff;
  return cards ? '' : 'the page has no file cards';
})()`;

type Page = { dir: string; data: string; libs: Record<string, string> };

/** The demo, built once with the pinned libraries: its folder, its data file and the library URLs in it. */
function demoPage(): Page {
  const dir = mkdtempSync(join(tmpdir(), 'guided-review-libs-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  // Frozen, so this build does not refresh the pins and check again.
  const built = buildDemo(join(dir, 'demo'), true, { KIT_LIBS_FROZEN: '1' });
  if (built.code) throw new Error(`the demo did not build: ${built.log.trim().split('\n').pop()}`);
  const data = readdirSync(join(dir, 'demo.files')).find((f) => /^data\.[0-9a-f]+\.js$/.test(f));
  const libs = data && readFileSync(join(dir, 'demo.files', data), 'utf8').match(/"libs":(\{[^{}]*\})/)?.[1];
  if (!data || !libs) throw new Error('the demo page names no libraries');
  return { dir, data, libs: JSON.parse(libs) };
}

/** A check for kit/build/libs.ts's `verify`. */
export function verifier(): Verify {
  let page: Page | null = null;
  let n = 0;
  return async (name, url) => {
    if (!chromeBinary()) throw new Error('no Chrome to open a page in; set CHROME');
    page ??= demoPage();
    const was = page.libs[name];
    if (!was) throw new Error(`the demo page does not load ${name}`);
    const run = join(page.dir, `check-${++n}`);
    cpSync(join(page.dir, 'demo.files'), join(run, 'demo.files'), { recursive: true });
    cpSync(join(page.dir, 'demo.preview.html'), join(run, 'demo.preview.html'));
    const data = join(run, 'demo.files', page.data);
    const pair = (u: string) => `${JSON.stringify(name)}:${JSON.stringify(u)}`;
    const src = readFileSync(data, 'utf8');
    if (!src.includes(pair(was))) throw new Error(`the demo page's data names ${name} some other way`);
    writeFileSync(data, src.replace(pair(was), pair(url)));
    const problems = new Set<string>();
    try {
      for (const theme of ['light', 'dark']) {
        const tab = await browser(join(run, `profile-${theme}`), { warnings: true });
        try {
          await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
          await tab.open(`file://${join(run, 'demo.preview.html')}`);
          const out = await tab.run(CHECK);
          if (typeof out !== 'string' || out.startsWith('ERR ')) throw new Error(`the check did not run (${out})`);
          for (const e of tab.errors) problems.add(e.split('\n')[0]);
          if (out) problems.add(`${theme}: ${out}`);
        } finally {
          tab.close();
        }
        if (problems.size) break;
      }
    } finally {
      rmSync(run, { recursive: true, force: true });
    }
    const found = [...problems];
    if (found.some((p) => NOT_LOADED.test(p))) throw new Error(`it did not load in Chrome (${found[0]}), so it is checked again on the next refresh`);
    return found.length ? found.slice(0, 3).join('; ') : null;
  };
}

/** A library that did not load at all: a CDN failure looks the same, so that says nothing against the release. The
    runtime warns when @pierre/diffs does not load, and the tree falls back to a list when @pierre/trees does not. */
const NOT_LOADED = /did not load|Failed to fetch|net::ERR|dynamically imported module|fell back to a list/;
