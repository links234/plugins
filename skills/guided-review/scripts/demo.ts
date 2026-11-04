#!/usr/bin/env bun
/* The demo: a small pull request ("Retry failed webhook deliveries with backoff", #42) and its guide, built into
   examples/demo.{artifact,preview}.html; and a stack of it with the pull request based on it ("Show retrying
   deliveries on the endpoint page", #43), built into examples/stack.{artifact,preview}.html. test.ts and the
   screenshots use them too.

     bun scripts/demo.ts

   examples/demo/base/ is the repository on main; examples/demo/head/ holds the files #42 adds or changes, and
   examples/demo/stack/ the files #43 changes on top of it. makeDemoRepo() commits each on its own branch, stacked, in
   a scratch repository. */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const DEMO = join(ROOT, 'examples', 'demo');

export const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', '-c', 'user.name=Example Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode) throw new Error(`git ${args.join(' ')}: ${p.stderr.toString()}`);
  return p.stdout.toString();
};

/** A scratch repository: main holds the base, branch retry-webhooks #42, and branch endpoint-retrying #43 on top of
    it. Returns its path. */
export function makeDemoRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'guided-review-demo-'));
  git(repo, 'init', '-q', '-b', 'main');
  cpSync(join(DEMO, 'base'), repo, { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'Webhook deliveries, posted once');
  git(repo, 'checkout', '-qb', 'retry-webhooks');
  cpSync(join(DEMO, 'head'), repo, { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'Retry failed webhook deliveries with backoff');
  git(repo, 'checkout', '-qb', 'endpoint-retrying');
  cpSync(join(DEMO, 'stack'), repo, { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'Show retrying deliveries on the endpoint page');
  git(repo, 'checkout', '-q', 'retry-webhooks');
  return repo;
}

/** Gather the demo's diff and build its guide into <out>.artifact.html and <out>.preview.html, with `env` added to the
    environment of both steps. */
export function buildDemo(out = join(ROOT, 'examples', 'demo'), quiet = false, env: Record<string, string> = {}): { code: number; log: string } {
  const repo = makeDemoRepo();
  try {
    const diff = join(repo, 'diff.json');
    const steps = [
      ['bun', join(ROOT, 'scripts/gather.ts'), '--base=main', '--head=retry-webhooks', `--out=${diff}`],
      ['bun', join(ROOT, 'scripts/build.ts'), `--diff=${diff}`, `--guide=${join(ROOT, 'examples/demo.guide.json')}`, `--out=${out}`, `--repo=${repo}`],
    ];
    let log = '';
    for (const cmd of steps) {
      const p = Bun.spawnSync(cmd, { cwd: repo, stdout: quiet ? 'pipe' : 'inherit', stderr: quiet ? 'pipe' : 'inherit', env: { ...process.env, ...env } });
      if (quiet) log += (p.stdout?.toString() ?? '') + (p.stderr?.toString() ?? '');
      if (p.exitCode) return { code: p.exitCode, log };
    }
    return { code: 0, log };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

/** Gather both stacked pull requests, each against its own base, and build them into one page with a stack.json. */
export function buildStack(out = join(ROOT, 'examples', 'stack'), quiet = false): { code: number; log: string } {
  const repo = makeDemoRepo();
  try {
    const prs = [
      { n: 42, base: 'main', head: 'retry-webhooks', guide: join(ROOT, 'examples/demo.guide.json') },
      { n: 43, base: 'retry-webhooks', head: 'endpoint-retrying', guide: join(ROOT, 'examples/demo-43.guide.json') },
    ];
    let log = '';
    const run = (cmd: string[]) => {
      const p = Bun.spawnSync(cmd, { cwd: repo, stdout: quiet ? 'pipe' : 'inherit', stderr: quiet ? 'pipe' : 'inherit' });
      if (quiet) log += (p.stdout?.toString() ?? '') + (p.stderr?.toString() ?? '');
      return p.exitCode;
    };
    for (const p of prs) {
      const code = run(['bun', join(ROOT, 'scripts/gather.ts'), `--base=${p.base}`, `--head=${p.head}`, `--out=${join(repo, `diff-${p.n}.json`)}`, '--quiet']);
      if (code) return { code, log };
    }
    const stack = { name: 'Webhook retries stack', prs: prs.map((p) => ({ guide: p.guide, diff: `diff-${p.n}.json` })) };
    writeFileSync(join(repo, 'stack.json'), JSON.stringify(stack, null, 1));
    git(repo, 'checkout', '-q', 'endpoint-retrying');
    const code = run(['bun', join(ROOT, 'scripts/build.ts'), `--stack=${join(repo, 'stack.json')}`, `--out=${out}`, `--repo=${repo}`]);
    return { code, log };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(buildDemo().code || buildStack().code);
