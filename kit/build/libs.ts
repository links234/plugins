/* Libraries a page imports from a CDN when it is viewed, pinned in the skill's runtime/libs.json:

     { "note": "…", "checked": "2026-10-20", "libs": { "<name>": { "pkg", "version", "url": "…@{v}…", "global"?, "deps"?,
       "modules"?, "lazy"?, "skip"? } } }

   A library is an ES module (its whole static import graph goes in `modules`, so a page preloads it in one parallel
   round) or a single-file build that sets the window global `global`, after the libraries in `deps`. `lazy` names the
   dynamic imports the page always takes, as package/subpath ("shiki/core"): each joins `modules` with its own graph,
   so a library that loads its parts on demand still arrives in one round. `skip` lists releases never to pin, each
   one known not to work.

   A refresh moves each to the newest release that is at least 14 days old (the artifact rule), stable only unless the
   pin is itself a prerelease, and whose import graph resolves on the CDN (a release published with unresolved
   workspace: or catalog: dependencies does not). `--refresh` looks within the pin's major, or any major with `major`.
   It also runs on its own when the file is more than 7 days old, but then only within the pin's minor: a new minor
   can change how the library has to be called, so it waits for a `--refresh` and someone to look at the page (each
   skill's shot.ts fails on a page that logs an error). Offline, the pins stay quietly. */

const DAY = 86_400_000;

type Lib = { pkg: string; version: string; url: string; global?: string; deps?: string[]; modules?: string[]; lazy?: string[]; skip?: string[] };
type LibFile = { note: string; checked: string; libs: Record<string, Lib> };
export type LibMap = Record<string, { url: string; global?: string; deps?: string[]; modules: string[] }>;

/** Semver order, prereleases included: 1.0.0-beta.2 < 1.0.0-beta.10 < 1.0.0-rc.1 < 1.0.0 < 1.0.1. */
export function compare(a: string, b: string): number {
  const split = (v: string) => { const i = v.indexOf('-'); return i < 0 ? [v, ''] : [v.slice(0, i), v.slice(i + 1)]; };
  const [am, ap] = split(a), [bm, bp] = split(b);
  const x = am.split('.').map(Number), y = bm.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  if (ap === bp) return 0;
  if (!ap || !bp) return ap ? -1 : 1;
  const p = ap.split('.'), q = bp.split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined || q[i] === undefined) return p[i] === undefined ? -1 : 1;
    const [pn, qn] = [/^\d+$/.test(p[i]), /^\d+$/.test(q[i])];
    if (pn && qn && +p[i] !== +q[i]) return +p[i] - +q[i];
    if (pn !== qn) return pn ? -1 : 1;
    if (p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

/** How far a refresh may move a pin: within its minor (the automatic one), its major (--refresh), or any (--major). */
type Reach = 'minor' | 'major' | 'any';

async function refresh(file: string, reach: Reach) {
  const data: LibFile = await Bun.file(file).json();
  const cutoff = Date.now() - 14 * DAY;
  const changed: string[] = [];
  await Promise.all(Object.entries(data.libs).map(async ([name, lib]) => {
    let meta: { time?: Record<string, string> };
    try {
      meta = await (await fetch(`https://registry.npmjs.org/${lib.pkg}`, { signal: AbortSignal.timeout(8000) })).json();
    } catch (e) {
      console.log(`  libs: ${name} not checked (${(e as Error).name}); keeping ${lib.version}`);
      return;
    }
    // Stable releases in reach; a prerelease pin also takes newer prereleases of its own version.
    const main = lib.version.split('-')[0], pre = lib.version.includes('-');
    const [maj, min] = main.split('.');
    const fits = (v: string, t: string) => {
      if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v) || Date.parse(t) > cutoff || lib.skip?.includes(v)) return false;
      const [vmaj, vmin] = v.split('.');
      if (reach !== 'any' && vmaj !== maj) return false;
      if (reach === 'minor' && vmin !== min) return false;
      return !v.includes('-') || (pre && v.split('-')[0] === main);
    };
    const newer = Object.entries(meta.time ?? {}).filter(([v, t]) => fits(v, t) && compare(v, lib.version) > 0)
      .map(([v]) => v).sort((a, b) => compare(b, a));
    if (reach === 'minor') {
      const minor = Object.entries(meta.time ?? {}).filter(([v, t]) => v.split('.')[0] === maj && v.split('.')[1] !== min && !v.includes('-')
        && Date.parse(t) <= cutoff && !lib.skip?.includes(v) && compare(v, lib.version) > 0).map(([v]) => v).sort((a, b) => compare(b, a))[0];
      if (minor) console.log(`  libs: ${name} ${minor} is out; run with --refresh to move to it, then look at a page`);
    }
    if (lib.global) {
      if (newer[0]) { changed.push(`${name} ${lib.version} -> ${newer[0]}`); lib.version = newer[0]; }
      return;
    }
    // The newest release whose graph resolves; else the pin, with its graph found again.
    for (const v of [...newer, lib.version]) {
      try {
        lib.modules = await graph(lib.url.replace('{v}', v), lib.lazy ?? []);
      } catch (e) {
        console.log(`  libs: ${name} ${v} skipped (${(e as Error).message})`);
        continue;
      }
      if (v !== lib.version) { changed.push(`${name} ${lib.version} -> ${v}`); lib.version = v; }
      break;
    }
  }));
  data.checked = new Date().toISOString().slice(0, 10);
  await Bun.write(file, JSON.stringify(data, null, 1) + '\n');
  console.log('  libs: ' + (changed.length ? changed.join(', ') : 'up to date'));
}

/** Every module an ES module on jsDelivr imports statically, transitively, and the graph of each dynamic import named
    in `lazy` (package/subpath, such as "shiki/core"). Throws when a module does not load or names a dependency the CDN
    could not resolve. */
async function graph(entry: string, lazy: string[]): Promise<string[]> {
  const seen = new Set([entry]), queue = [entry];
  // /npm/<pkg>@<version>/<subpath>/+esm, as package/subpath
  const named = (url: string) => new URL(url).pathname.replace(/^\/npm\//, '').replace(/\/\+esm$/, '').replace(/^((?:@[^/]+\/)?[^@/]+)@[^/]+/, '$1');
  while (queue.length) {
    const url = queue.shift()!;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const src = await res.text();
    const found = [...src.matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+)["']/g)].map((m) => m[1])
      .concat([...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]).filter((spec) => lazy.includes(named(new URL(spec, url).href))));
    for (const spec of found) {
      if (!spec.startsWith('/npm/') && !spec.startsWith('./') && !spec.startsWith('../')) continue;
      if (/@(workspace|catalog)(:|%3A)/i.test(spec)) throw new Error(`${url} imports ${spec}`);
      const next = new URL(spec, url).href;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return [...seen];
}

/** The pinned libraries, refreshed first when `force` (within the major, or any with `major`), or within the minor when
    the file is stale. */
export async function libs(file: string, { force = false, major = false } = {}): Promise<LibMap> {
  let data: LibFile = await Bun.file(file).json();
  const stale = Date.now() - Date.parse(data.checked) > 7 * DAY || Object.values(data.libs).some((l) => !l.global && !l.modules?.length);
  if (force || stale) { await refresh(file, major ? 'any' : force ? 'major' : 'minor'); data = await Bun.file(file).json(); }
  return Object.fromEntries(Object.entries(data.libs).map(([k, { pkg: _p, version, url, modules, lazy: _l, skip: _s, ...rest }]) =>
    [k, { url: url.replace('{v}', version), modules: modules ?? [], ...rest }]));
}

/** Preload hints for the head, so the libraries download while the page parses: each global build's file, or each
    module's whole graph. */
export const preloads = (names: string[], map: LibMap) => names.flatMap((n) => {
  const l = map[n];
  return l.global ? [`<link rel="preload" as="script" href="${l.url}">`] : (l.modules.length ? l.modules : [l.url]).map((m) => `<link rel="modulepreload" href="${m}" crossorigin>`);
}).join('\n');
