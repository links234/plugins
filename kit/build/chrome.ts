/* The local Chrome, for screenshots and the runtime tests: where it is, and a minimal DevTools protocol driver. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The Chrome binary: $CHROME, else the usual places; null when there is none. */
export const chromeBinary = (): string | null => [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  Bun.which('google-chrome'), Bun.which('chromium'), Bun.which('chromium-browser'),
].find((p): p is string => !!p && existsSync(p)) ?? null;

/** The Chrome binary. Exits with a hint when there is none. */
export function findChrome(): string {
  const found = chromeBinary();
  if (!found) { console.log('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(1); }
  return found;
}

/** A headless Chrome with one tab, driven over DevTools. Real time, not --virtual-time-budget: under virtual time the
    clock stops during synchronous code (timings read 0) and animation frames never fire. Any exception or
    console.error on the page lands in `errors`, and console.warn too with `warnings`, so a test can fail on them. */
export async function browser(profile: string, { warnings = false } = {}) {
  const proc = Bun.spawn([findChrome(), '--headless=new', '--remote-debugging-port=0', '--window-size=1440,900', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'], { stderr: 'ignore', stdout: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await Bun.sleep(50);
  const port = (await Bun.file(portFile).text()).split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const ws = new WebSocket(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  let id = 0;
  const waiting = new Map<number, (v: any) => void>();
  const events = new Map<string, () => void>();
  const errors: string[] = [];
  const logged = warnings ? ['error', 'warning'] : ['error'];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id) return waiting.get(msg.id)?.(msg);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && logged.includes(msg.params.type)) errors.push(msg.params.args.map((a: any) => a.value ?? a.description).join(' '));
    events.get(msg.method)?.();
  });
  const send = (method: string, params: object = {}) => new Promise<any>((ok) => { waiting.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
  await Promise.all([send('Page.enable'), send('Runtime.enable')]);
  return {
    errors, send,
    async open(url: string) {
      const loaded = new Promise<void>((ok) => events.set('Page.loadEventFired', ok));
      await send('Page.navigate', { url });
      await loaded;
    },
    /** Evaluate code in the page, as a user gesture, and return its value (or "ERR …"). */
    async run(code: string) {
      const res = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true, userGesture: true });
      return res.result?.exceptionDetails ? 'ERR ' + (res.result.exceptionDetails.exception?.description ?? 'error') : res.result?.result?.value;
    },
    close() { ws.close(); proc.kill(); },
  };
}

/** The kit's theme button, driven on a fresh copy of a page under a dark system: the menu by mouse and by real key
    presses, what each pick does to the page, the viewer's own data-theme, the page's keys while the menu is open, a
    pick coming back on the next load, and a phone's width. Prints what failed and returns how many failed. */
export async function themeChecks(url: string, profile: string) {
  const tab = await browser(profile);
  let failed = 0, checks = 0;
  const STATE = `(() => { const w = document.querySelector('[data-k-theme]'), btn = w.querySelector('button'), menu = w.querySelector('[role="menu"]'), a = document.activeElement;
    return JSON.stringify({ open: !menu.hidden, expanded: btn.getAttribute('aria-expanded'), theme: document.documentElement.dataset.theme ?? null, kept: localStorage.getItem('kit:theme'),
      focus: a === btn ? 'button' : a.value || a.tagName, checked: menu.querySelector('[aria-checked="true"]')?.value ?? null, seen: window.seenKey ?? null,
      bg: getComputedStyle(document.body).backgroundColor, sun: getComputedStyle(w.querySelector('.is-sun')).transform === 'matrix(1, 0, 0, 1, 0, 0)' }); })()`;
  const state = async () => JSON.parse(await tab.run(STATE)) as Record<string, unknown>;
  const expect = async (name: string, want: Record<string, unknown>) => {
    const got = await state();
    for (const [k, v] of Object.entries(want)) {
      checks++;
      if (got[k] !== v) { failed++; console.log(`fail  theme, ${name}: ${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`); }
    }
    return got;
  };
  const key = async (key: string, vk: number, text?: string) => {
    await tab.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, text });
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
  };
  const down = () => key('ArrowDown', 40), up = () => key('ArrowUp', 38);
  const open = async (at = url) => { await tab.open(at); await tab.run(`addEventListener('keydown', (e) => { window.seenKey = e.key; })`); };
  const click = (sel: string) => tab.run(`document.querySelector('[data-k-theme] ${sel}').click()`);
  const trigger = '> button', settle = () => Bun.sleep(400); // past the icon's turn
  try {
    await tab.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await tab.open(url);
    await tab.run(`localStorage.removeItem('kit:theme')`);
    await open();
    await settle();
    const dark = await expect('at rest', { open: false, expanded: 'false', theme: null, kept: null, sun: false });

    await click(trigger);
    await expect('opened', { open: true, expanded: 'true', focus: 'system', checked: 'system' });
    await click('[value="light"]');
    await settle();
    const light = await expect('Light on a dark system', { open: false, expanded: 'false', theme: 'light', kept: '"light"', focus: 'button', sun: true });
    checks++;
    if (light.bg === dark.bg) { failed++; console.log(`fail  theme, Light on a dark system: the page stayed ${dark.bg}`); }

    await open();
    await expect('the pick on the next load', { open: false, theme: 'light', bg: light.bg, sun: true });
    checks++;
    if (await tab.run(`(() => { const boot = [...document.scripts].find((s) => s.textContent.includes('kit:theme')), css = document.querySelector('link[rel="stylesheet"]');
      return !!boot && !!(boot.compareDocumentPosition(css) & Node.DOCUMENT_POSITION_FOLLOWING); })()`) !== true) { failed++; console.log('fail  theme: the pick does not go on the root ahead of the stylesheet'); }

    await tab.run(`document.querySelector('[data-k-theme] > button').focus()`);
    await down();
    await expect('ArrowDown opens on the current item', { open: true, focus: 'light', checked: 'light' });
    await down();
    await expect('ArrowDown moves', { focus: 'dark' });
    await down(); await down();
    await expect('ArrowDown wraps', { focus: 'light' });
    await up();
    await expect('ArrowUp wraps', { focus: 'system' });
    await up();
    await expect('ArrowUp moves', { focus: 'dark' });
    await key('Enter', 13, '\r');
    await settle();
    await expect('Enter picks', { open: false, theme: 'dark', kept: '"dark"', focus: 'button', bg: dark.bg, sun: false });

    await key('Enter', 13, '\r');
    await expect('Enter opens', { open: true, focus: 'dark' });
    await tab.run(`window.seenKey = null`); // the Enter that opened it went to the page, as on any closed button
    await key('x', 88, 'x');
    await expect('the page keeps no keys while the menu is open', { open: true, seen: null });
    await key('Escape', 27);
    await expect('Escape closes', { open: false, focus: 'button', theme: 'dark', seen: null });
    await key('x', 88, 'x');
    await expect('the page has its keys back', { seen: 'x' });

    await click(trigger);
    await key('Tab', 9);
    await expect('Tab closes', { open: false });

    await click(trigger);
    await tab.run(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await expect('a click outside closes', { open: false });

    await click(trigger);
    await click('[value="system"]');
    await expect('System', { open: false, theme: null, kept: '"system"', bg: dark.bg });

    await tab.run(`document.documentElement.dataset.theme = 'light'`);
    await click(trigger);
    await expect('the menu follows the viewer', { checked: 'light', bg: light.bg });
    await key('Escape', 27);
    await tab.run(`delete document.documentElement.dataset.theme`);

    await tab.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await open();
    await settle();
    await click(trigger);
    const box = await tab.run(`(() => { const w = document.querySelector('[data-k-theme]'), b = w.querySelector('button').getBoundingClientRect(), m = w.querySelector('[role="menu"]').getBoundingClientRect();
      return b.width > 0 && b.right <= innerWidth && m.left >= 0 && m.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`);
    checks++;
    if (box !== true) { failed++; console.log(`fail  theme: at phone width the button or its menu is off the screen (${box})`); }

    for (const e of tab.errors) { failed++; console.log(`error theme: ${e.split('\n')[0]}`); }
    if (!failed) console.log(`ok    theme (${checks} checks, no errors)`);
  } finally {
    tab.close();
  }
  return failed;
}
