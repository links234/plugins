/* Lining up two lists, for the builds that mark what changed: thinkr between versions of a design, guided-review
   between the old and new renders of a Markdown file. */

export type Op = ['=' | '-' | '+', number, number];

/** A longest common subsequence of two lists, as keep (=), remove (-) and add (+) steps in order. The common head
    and tail are matched first, so an edit in the middle of a long page fills only a small table. */
export function align(a: string[], b: string[]): Op[] {
  let s = 0, e = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const n = a.length - s - e, m = b.length - s - e, W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * W + j] = a[s + i] === b[s + j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const ops: Op[] = [];
  for (let k = 0; k < s; k++) ops.push(['=', k, k]);
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[s + i] === b[s + j]) ops.push(['=', s + i++, s + j++]);
    else if (j >= m || (i < n && dp[(i + 1) * W + j] >= dp[i * W + j + 1])) ops.push(['-', s + i++, -1]);
    else ops.push(['+', -1, s + j++]);
  }
  for (let k = 0; k < e; k++) ops.push(['=', a.length - e + k, b.length - e + k]);
  return ops;
}
