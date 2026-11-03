/* A design's spec: the Markdown file <page>.spec.md beside the page, written once every question is decided. It is
   what an agent with no other context builds from, so it stands alone: the decisions as facts, the behavior, the
   interfaces, the work and how to check it is done, and none of the talk that led there (references/spec.md).

     ---
     design-version: 3                                   the design version it implements: the page's version
     design-url: https://claude.ai/code/artifact/…       optional: the design page, linked from the work it produces
     ---
     # API Rate Limits
     …
     ## Done when
     …

   The build checks it and renders it with markdown-it (CommonMark, GitHub's tables and strikethrough, links found in
   plain text; raw HTML stays text), into the page's Spec view. A ```mermaid block becomes a <pre class="mermaid"> for
   build.ts to draw, as on the page. The file itself is published beside the page as spec.md, as written. */
import { join } from 'node:path';
import type MarkdownIt from 'markdown-it';
import { need } from '../kit/build/deps';

export interface Spec { file: string; md: string; html: string; designVersion: number; url: string | null; words: number }

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const FENCE = /^(```|~~~)[\s\S]*?^\1/gm;
/** Words that leave a decision open: the design is not done while one is in the spec. */
const OPEN = /\b(TBD|TODO|FIXME)\b|\?\?/;
/** What only the design's reader understands: the spec's reader never saw the page or the chat. */
const TALK: [RegExp, string][] = [
  [/\bQ\d+\b/, 'a question on the design page'],
  [/\b(?:chosen|decided|agreed|changed|added|removed) in (?:v|version )\d+\b/i, 'a design version'],
  [/\bas (?:discussed|agreed|decided|planned)\b/i, 'the talk that led to it'],
  [/\b(?:the|this) design page\b|\bthe recommended option\b/i, 'the design page'],
];

const slug = (s: string) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/&\w+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Reads, checks and renders the spec beside the page `stem`, or returns null when there is none. */
export async function readSpec(stem: string, version: number, errors: string[], warns: string[]): Promise<Spec | null> {
  const file = `${stem}.spec.md`;
  const f = Bun.file(file);
  if (!(await f.exists())) return null;
  const md = await f.text();
  const err = (m: string) => errors.push(`spec: ${m}`), warn = (m: string) => warns.push(`spec: ${m}`);

  const front = FRONT.exec(md);
  const meta = Object.fromEntries((front?.[1] ?? '').split(/\r?\n/).map((l) => /^([\w-]+):\s*(.*?)\s*$/.exec(l)).filter((m) => !!m).map((m) => [m![1], m![2]]));
  const designVersion = /^\d+$/.test(meta['design-version'] ?? '') ? +meta['design-version'] : 0;
  if (!front) err(`start ${file} with a front matter block naming the design version it implements:\n        ---\n        design-version: ${version}\n        ---`);
  else if (!designVersion) err('design-version: N, in the front matter, is the design version the spec implements.');
  else if (designVersion > version) err(`design-version: ${designVersion} is newer than the page (version ${version}).`);
  else if (designVersion < version)
    err(`the spec implements version ${designVersion}, and the design is at version ${version}. Bring the spec up to the design and set design-version: ${version}, or move ${file} aside while the design changes.`);
  const url = meta['design-url'] || null;
  if (url && !/^https:\/\//.test(url)) err(`design-url must start with https://: ${url}`);

  const body = md.slice(front?.[0].length ?? 0);
  const prose = body.replace(FENCE, '').replace(/`[^`\n]*`/g, '');
  const lines = prose.split('\n');
  const h1 = lines.filter((l) => /^# \S/.test(l));
  if (h1.length !== 1) err(`one # title, the design's name: found ${h1.length}.`);
  if (!lines.some((l) => /^## Done when\s*$/.test(l))) err('add a "## Done when" section: the checks that say the work is done, each one a command to run or a result to see.');
  const open = lines.findIndex((l) => OPEN.test(l));
  if (open >= 0) err(`"${lines[open].trim().slice(0, 70)}" leaves something open. A spec holds decisions only: decide it in the design first.`);
  for (const [re, what] of TALK) {
    const at = lines.findIndex((l) => re.test(l));
    if (at >= 0) warn(`"${lines[at].trim().slice(0, 70)}" points at ${what}, which the spec's reader never saw. Say the fact itself.`);
  }

  const { default: Md } = await need<{ default: typeof MarkdownIt }>('markdown-it', join(import.meta.dir, '..'));
  const r = new Md({ html: false, linkify: true });
  const fence = r.renderer.rules.fence!;
  r.renderer.rules.fence = (tokens, i, opts, env, self) =>
    tokens[i].info.trim() === 'mermaid' ? `<pre class="mermaid">${esc(tokens[i].content)}</pre>\n` : fence(tokens, i, opts, env, self);
  // ids that cannot clash with the design's own or each other, so a link or "On this page" lands in the spec
  const ids = new Map<string, number>();
  const html = r.render(body).replace(/<h([234])>([\s\S]*?)<\/h\1>/g, (_, n: string, text: string) => {
    const id = 'spec-' + (slug(text) || 'section'), k = ids.get(id) ?? 0;
    ids.set(id, k + 1);
    return `<h${n} id="${k ? `${id}-${k + 1}` : id}">${text}</h${n}>`;
  });
  const words = prose.split(/\s+/).filter(Boolean).length;
  return { file, md, html, designVersion, url, words };
}
