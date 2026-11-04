#!/usr/bin/env bun
/* Screenshot a built guide with the local Chrome: desktop and phone, light and dark (kit/build/shot.ts), then check
   its code.

     bun scripts/shot.ts guide.preview.html [out dir]   # writes <name>-{desktop,phone}-{light,dark}.png

   Set CHROME to the browser binary when it is not in a usual place. Each shot is 2400 px tall: the overview and
   the first chapters, with their code, which loads from jsDelivr (so the shots need the network). The check opens
   the page once more, brings every open file card into view, light and dark, and exits 1 when a card draws no lines
   of code or the page logs an error: a pinned @pierre/diffs that no longer highlights (runtime/libs.json) leaves
   every card an empty header, which a screenshot of the overview can miss. */
import { join, resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { browser } from '../kit/build/chrome';
import { shoot } from '../kit/build/shot';

const [file, outDir = '.'] = Bun.argv.slice(2);
if (!file) { console.log('usage: bun scripts/shot.ts guide.preview.html [out dir]'); process.exit(1); }
await shoot(file, outDir);

const CHECK = `(async () => {
  const sleep = (n) => new Promise((ok) => setTimeout(ok, n));
  const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await sleep(50); return fn(); };
  const empty = [];
  for (const pr of document.querySelectorAll('.gr-pr')) pr.hidden = false;
  for (const c of document.querySelectorAll('.gr-file:not(.collapsed)')) {
    const code = c.querySelector('.gr-code');
    if (!code || !code.offsetParent) continue;
    c.scrollIntoView();
    const drawn = await until(() => code.querySelector('.gr-plain') || code.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]'));
    if (!drawn) empty.push(c.dataset.path);
  }
  return JSON.stringify(empty);
})()`;

const page = 'file://' + resolve(file.split('#')[0]);
const profile = join(resolve(outDir), '.chrome-check');
let failed = 0;
for (const theme of ['light', 'dark']) {
  const tab = await browser(join(profile, theme));
  try {
    await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await tab.open(page);
    const empty = JSON.parse(await tab.run(CHECK) ?? '[]') as string[];
    for (const p of empty) console.log(`fail  ${theme}: ${p} drew no code`);
    for (const e of tab.errors) console.log(`fail  ${theme}: ${e.split('\n')[0]}`);
    failed += empty.length + tab.errors.length;
  } finally {
    tab.close();
  }
}
rmSync(profile, { recursive: true, force: true });
console.log(failed ? `fail  ${failed} problem(s) on ${file}: check runtime/libs.json's @pierre/diffs pin` : `ok    every file card drew its code, light and dark, with no errors`);
process.exit(failed ? 1 : 0);
