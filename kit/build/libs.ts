/* Libraries a page imports from a CDN when it is viewed, pinned in the skill's runtime/libs.json:

     { "note": "…", "checked": "2026-10-20", "libs": { "<name>": { "pkg", "version", "url": "…@{v}…", "global"?, "deps"?,
       "modules"?, "lazy"?, "skip"? } } }

   A library is an ES module (its whole static import graph goes in `modules`, so a page preloads it in one parallel
   round) or a single-file build that sets the window global `global`, after the libraries in `deps`. `lazy` names the
   dynamic imports the page always takes, as package/subpath ("shiki/core"): each joins `modules` with its own graph,
   so a library that loads its parts on demand still arrives in one round. `skip` maps each release never to pin to
   why it does not work.

   A refresh moves each to the newest release that is at least 14 days old (the artifact rule), stable only unless the
   pin is itself a prerelease, and whose import graph resolves on the CDN (a release published with unresolved
   workspace: or catalog: dependencies does not). When the skill passes `verify`, the release must also work in one
   of its pages: one that loads but does not draw goes into `skip` with the reason, and the next newest is tried.

   With `verify`, a build refreshes on its own once a day, within the pin's major: a release that changes how the
   library has to be called fails the check like any other. Without it, nothing would catch that, so a build
   refreshes on its own once a week and only within the pin's minor, and `--refresh` looks within the major. `--major`
   looks at any major. A release that cannot be checked (no Chrome, offline) leaves the pin as it is. KIT_LIBS_FROZEN=1
   turns refreshing off, for the page a check builds. */

const DAY = 86_400_000;

type Lib = { pkg: string; version: string; url: string; global?: string; deps?: string[]; modules?: string[]; lazy?: string[]; skip?: Record<string, string> };
type LibFile = { note: string; checked: string; libs: Record<string, Lib> };
export type LibMap = Record<string, { url: string; global?: string; deps?: string[]; modules: string[] }>;
/** Whether the release of library `name` at `url` works in a page of the skill: null when it does, else why not.
    Throws when it cannot tell (no Chrome, a page that does not build), and then the pin stays. */
export type Verify = (name: string, url: string) => Promise<string | null>;

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

/** How far a refresh may move a pin: within its minor, its major, or any. */
type Reach = 'minor' | 'major' | 'any';

async function refresh(file: string, reach: Reach, verify: Verify | undefined, minAge: number) {
  const data: LibFile = await Bun.file(file).json();
  const cutoff = Date.now() - minAge * DAY;
  const changed: string[] = [];
  // One check at a time: each builds and opens a page.
  let queue: Promise<unknown> = Promise.resolve();
  const check = (name: string, url: string) => { const p = queue.then(() => verify!(name, url)); queue = p.catch(() => {}); return p; };
  await Promise.all(Object.entries(data.libs).map(async ([name, lib]) => {
    let meta: { time?: Record<string, string> };
    try {
      meta = await (await fetch(`https://registry.npmjs.org/${lib.pkg}`, { signal: AbortSignal.timeout(8000) })).json();
    } catch (e) {
      console.log(`  libs: ${name} not checked (${(e as Error).name}); keeping ${lib.version}`);
      return;
    }
    const skipped = (v: string) => !!lib.skip && Object.hasOwn(lib.skip, v);
    // Stable releases in reach; a prerelease pin also takes newer prereleases of its own version.
    const main = lib.version.split('-')[0], pre = lib.version.includes('-');
    const [maj, min] = main.split('.');
    const fits = (v: string, t: string) => {
      if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v) || Date.parse(t) > cutoff || skipped(v)) return false;
      const [vmaj, vmin] = v.split('.');
      if (reach !== 'any' && vmaj !== maj) return false;
      if (reach === 'minor' && vmin !== min) return false;
      return !v.includes('-') || (pre && v.split('-')[0] === main);
    };
    const newer = Object.entries(meta.time ?? {}).filter(([v, t]) => fits(v, t) && compare(v, lib.version) > 0)
      .map(([v]) => v).sort((a, b) => compare(b, a));
    if (reach === 'minor') {
      const minor = Object.entries(meta.time ?? {}).filter(([v, t]) => v.split('.')[0] === maj && v.split('.')[1] !== min && !v.includes('-')
        && Date.parse(t) <= cutoff && !skipped(v) && compare(v, lib.version) > 0).map(([v]) => v).sort((a, b) => compare(b, a))[0];
      if (minor) console.log(`  libs: ${name} ${minor} is out; run with --refresh to move to it, then look at a page`);
    }
    // The newest release that resolves and, with `verify`, works; else the pin, with its graph found again.
    let blind = false;
    for (const v of [...newer, lib.version]) {
      const pin = v === lib.version;
      if (!pin && blind) continue;
      const url = lib.url.replace('{v}', v);
      let modules = lib.modules ?? [];
      if (!lib.global) {
        try {
          modules = await graph(url, lib.lazy ?? []);
        } catch (e) {
          console.log(`  libs: ${name} ${v} skipped (${(e as Error).message})`);
          continue;
        }
      }
      if (!pin && verify) {
        console.log(`  libs: checking ${name} ${v} in a page`);
        try {
          const why = await check(name, url);
          if (why) {
            (lib.skip ??= {})[v] = why;
            console.log(`  libs: ${name} ${v} does not work, so it goes into skip: ${why}`);
            continue;
          }
        } catch (e) {
          console.log(`  libs: ${name} ${v} not checked (${(e as Error).message}); keeping ${lib.version}`);
          blind = true;
          continue;
        }
      }
      if (!lib.global) lib.modules = modules;
      if (!pin) { changed.push(`${name} ${lib.version} -> ${v}`); lib.version = v; }
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

/** The pinned libraries, refreshed first when `force` (within the major, or any with `major`) or when the file is
    stale (each day within the major with `verify`, each week within the minor without). `minAge` is the artifact
    rule's age, in days. */
export async function libs(file: string, { force = false, major = false, verify, minAge = 14 }:
  { force?: boolean; major?: boolean; verify?: Verify; minAge?: number } = {}): Promise<LibMap> {
  let data: LibFile = await Bun.file(file).json();
  const stale = Date.now() - Date.parse(data.checked) > (verify ? 1 : 7) * DAY || Object.values(data.libs).some((l) => !l.global && !l.modules?.length);
  if (process.env.KIT_LIBS_FROZEN !== '1' && (force || stale)) {
    await refresh(file, major ? 'any' : force || verify ? 'major' : 'minor', verify, minAge);
    data = await Bun.file(file).json();
  }
  return Object.fromEntries(Object.entries(data.libs).map(([k, { pkg: _p, version, url, modules, lazy: _l, skip: _s, ...rest }]) =>
    [k, { url: url.replace('{v}', version), modules: modules ?? [], ...rest }]));
}

/** Preload hints for the head, so the libraries download while the page parses: each global build's file, or each
    module's whole graph. */
export const preloads = (names: string[], map: LibMap) => names.flatMap((n) => {
  const l = map[n];
  return l.global ? [`<link rel="preload" as="script" href="${l.url}">`] : (l.modules.length ? l.modules : [l.url]).map((m) => `<link rel="modulepreload" href="${m}" crossorigin>`);
}).join('\n');
