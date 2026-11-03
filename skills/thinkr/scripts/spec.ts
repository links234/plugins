/* A design's two specs, Markdown files beside the page, written once every question is decided (references/spec.md):

     <page>.spec.md         for people: what will happen once it is built, at a glance. Short sentences, and the
                            shapes to look at: a diagram, the schemas, the interfaces, a table of cases. The page
                            shows it under Spec.
     <page>.agent-spec.md   for the agent that builds it, with no other context: every decision, behavior, interface,
                            piece of work and check, in full. Nobody reads it on the page; Copy agent spec copies it,
                            and it is published beside the page as agent-spec.md, as written.

   Both start with the design version they describe, so they cannot drift apart:

     ---
     design-version: 3                                   the page's version
     design-url: https://claude.ai/code/artifact/…       agent spec only, optional: the design page, linked from the
     ---                                                 pull requests it produces

   The build checks both, and renders the spec for people with markdown-it (CommonMark, GitHub's tables and
   strikethrough, links found in plain text; raw HTML stays text). A ```mermaid block becomes a <pre class="mermaid">
   for build.ts to draw, as on the page. */
import { join } from 'node:path';
import type MarkdownIt from 'markdown-it';
import { need } from '../kit/build/deps';

export interface Doc { file: string; md: string; designVersion: number; words: number }
export interface Specs {
  /** The spec for people, rendered for the Spec view. */
  people: Doc & { html: string };
  agent: Doc & { url: string | null };
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const FENCE = /^(```|~~~)[\s\S]*?^\1/gm;
/** Words that leave a decision open: the design is not done while one is in a spec. */
const OPEN = /\b(TBD|TODO|FIXME)\b|\?\?/;
/** What only the design's reader understands: a spec's reader never saw the page or the chat. */
const TALK: [RegExp, string][] = [
  [/\bQ\d+\b/, 'a question on the design page'],
  [/\b(?:chosen|decided|agreed|changed|added|removed) in (?:v|version )\d+\b/i, 'a design version'],
  [/\bas (?:discussed|agreed|decided|planned)\b/i, 'the talk that led to it'],
  [/\b(?:the|this) design page\b|\bthe recommended option\b/i, 'the design page'],
];
/** The spec for people reads in a minute or two: past this many words of prose (code and diagrams aside), it is
    going into the detail the agent spec holds. */
const PEOPLE_WORDS = 500;

const slug = (s: string) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/&\w+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Whether the page has a spec beside it, either one: a design with one has every question decided. */
export const hasSpecs = async (stem: string) => (await Bun.file(`${stem}.spec.md`).exists()) || (await Bun.file(`${stem}.agent-spec.md`).exists());

/** Reads and checks both specs beside the page `stem`, and renders the one for people. Null when there is neither;
    an error when only one is there. */
export async function readSpecs(stem: string, version: number, errors: string[], warns: string[]): Promise<Specs | null> {
  const files = { people: `${stem}.spec.md`, agent: `${stem}.agent-spec.md` };
  const [people, agent] = await Promise.all([Bun.file(files.people), Bun.file(files.agent)].map(async (f) => ((await f.exists()) ? f.text() : null)));
  if (people == null && agent == null) return null;
  if (people == null || agent == null) {
    errors.push(people == null
      ? `spec: ${files.agent} needs its spec for people, ${files.people}: what will happen once it is built, at a glance, with a diagram and the schemas (references/spec.md).`
      : `spec: ${files.people} needs its agent spec, ${files.agent}: everything the agent that builds it needs, with no other context, ending in "## Done when" (references/spec.md).`);
    return null;
  }
  const p = check(files.people, people, version, errors, warns);
  const a = check(files.agent, agent, version, errors, warns);

  // the agent's: where the work links back to, and how it knows it is done
  const url = a.meta['design-url'] || null;
  if (url && !/^https:\/\//.test(url)) errors.push(`spec: design-url must start with https://: ${url}`);
  if (!a.lines.some((l) => /^## Done when\s*$/.test(l)))
    errors.push(`spec: add a "## Done when" section to ${files.agent}: the checks that say the work is done, each one a command to run or a result to see.`);
  // people's: short, and something to look at
  if (p.words > PEOPLE_WORDS)
    warns.push(`spec: ${files.people} has ${p.words} words of prose. Keep it to what happens, at a glance (under ${PEOPLE_WORDS}); the detail belongs in ${files.agent}.`);
  if (!/^(```|~~~)|^\|.*\|\s*$/m.test(p.body))
    warns.push(`spec: ${files.people} has nothing to look at. Show the shape: a mermaid diagram, a schema or an interface, a table of cases.`);

  return {
    people: { file: files.people, md: people, designVersion: p.version, words: p.words, html: await render(p.body) },
    agent: { file: files.agent, md: agent, designVersion: a.version, words: a.words, url },
  };
}

/** What both specs share: the design version they describe, one title, no open decision, no words that point back at
    the page or the talk. */
function check(file: string, md: string, version: number, errors: string[], warns: string[]) {
  const err = (m: string) => errors.push(`spec: ${m}`);
  const front = FRONT.exec(md);
  const meta: Record<string, string> = Object.fromEntries((front?.[1] ?? '').split(/\r?\n/).map((l) => /^([\w-]+):\s*(.*?)\s*$/.exec(l)).filter((m) => !!m).map((m) => [m![1], m![2]]));
  const v = /^\d+$/.test(meta['design-version'] ?? '') ? +meta['design-version'] : 0;
  if (!front) err(`start ${file} with a front matter block naming the design version it describes:\n        ---\n        design-version: ${version}\n        ---`);
  else if (!v) err(`${file}: design-version: N, in the front matter, is the design version it describes.`);
  else if (v > version) err(`${file}: design-version: ${v} is newer than the page (version ${version}).`);
  else if (v < version)
    err(`${file} describes version ${v}, and the design is at version ${version}. Bring both specs up to the design and set design-version: ${version}, or move them aside while the design changes.`);

  const body = md.slice(front?.[0].length ?? 0);
  const prose = body.replace(FENCE, '').replace(/`[^`\n]*`/g, '');
  const lines = prose.split('\n');
  const h1 = lines.filter((l) => /^# \S/.test(l));
  if (h1.length !== 1) err(`${file}: one # title, the design's name: found ${h1.length}.`);
  const open = lines.findIndex((l) => OPEN.test(l));
  if (open >= 0) err(`${file}: "${lines[open].trim().slice(0, 70)}" leaves something open. A spec holds decisions only: decide it in the design first.`);
  for (const [re, what] of TALK) {
    const at = lines.findIndex((l) => re.test(l));
    if (at >= 0) warns.push(`spec: ${file}: "${lines[at].trim().slice(0, 70)}" points at ${what}, which the spec's reader never saw. Say the fact itself.`);
  }
  // prose words, without tables: a table is something to look at
  const words = lines.filter((l) => !/^\s*\|/.test(l)).join(' ').split(/\s+/).filter((w) => /\w/.test(w)).length;
  return { meta, version: v, body, lines, words };
}

/** The spec for people as HTML, with heading ids that cannot clash with the design's own or each other, so a link or
    "On this page" lands in the spec. */
async function render(body: string) {
  const { default: Md } = await need<{ default: typeof MarkdownIt }>('markdown-it', join(import.meta.dir, '..'));
  const r = new Md({ html: false, linkify: true });
  const fence = r.renderer.rules.fence!;
  r.renderer.rules.fence = (tokens, i, opts, env, self) =>
    tokens[i].info.trim() === 'mermaid' ? `<pre class="mermaid">${esc(tokens[i].content)}</pre>\n` : fence(tokens, i, opts, env, self);
  const ids = new Map<string, number>();
  return r.render(body).replace(/<h([234])>([\s\S]*?)<\/h\1>/g, (_, n: string, text: string) => {
    const id = 'spec-' + (slug(text) || 'section'), k = ids.get(id) ?? 0;
    ids.set(id, k + 1);
    return `<h${n} id="${k ? `${id}-${k + 1}` : id}">${text}</h${n}>`;
  });
}
