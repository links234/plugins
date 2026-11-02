/* Shared types: diff.json (gather.ts writes it), guide.json (the agent writes it), the data build.ts embeds in the
   page, and the slice of @pierre/diffs and @pierre/trees the runtime calls. */
import type { ThemeType } from '../kit/web/types';

// ---------------------------------------------------------------- diff.json
export type Kind = 'core' | 'docs' | 'database' | 'tests' | 'generated';
export type Status = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
/** One diff line: op, old line number, new line number, text. */
export type Line = [op: ' ' | '-' | '+', old: number | null, new: number | null, text: string];
export interface Hunk {
  id: number;
  oldStart: number; oldLines: number; newStart: number; newLines: number;
  header: string;
  /** The function, type or section the hunk sits in. */
  label: string;
  /** Lines that open the scopes above the hunk, outermost first. */
  scope: number[];
  lines: Line[];
}
/** A block of removed lines that comes back as added lines elsewhere, seen from one end. */
export interface Move { side: '-' | '+'; from: number; to: number; other: string; otherFrom: number; otherTo: number; lines: number }
export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: Status;
  kind: Kind;
  lang: string;
  binary: boolean;
  add: number;
  del: number;
  /** Full old text, kept only for a deleted file (the page rebuilds it otherwise). */
  old: string[] | null;
  /** Full new text, when small enough and not generated. */
  new: string[] | null;
  oldCount: number | null;
  newCount: number | null;
  hunks: Hunk[];
  moves: Move[];
  /** A Markdown file rendered, as build.ts adds it to the page's data (scripts/markdown.ts). diff.json has none. */
  preview?: MdPreview;
}

/** One top-level block of a rendered Markdown file (a heading, a paragraph, a list, a table, a code block…): its
    first and last source lines, 1-based, and its sanitized HTML. */
export interface MdBlock { a: number; b: number; html: string }
/** One block of the preview with Changes on, in reading order. */
export interface MdRow {
  mark: 'same' | 'changed' | 'added' | 'removed';
  /** The block of `blocks` it shows: same, changed and added rows, and every row of a deleted file. */
  n?: number;
  /** The old block's first and last lines: a changed row, and a removed row of a changed file. */
  o?: [number, number];
  /** A changed row's HTML with its words marked, or a removed row's old HTML. */
  html?: string;
  /** The hunks whose changed lines fall in it, so a chapter card shows only the rows of its own hunks. */
  hunks: number[];
}
export interface MdPreview {
  /** The side `blocks` are on: the head ('n'), or the base for a deleted file ('o'). */
  side: Side;
  /** The whole document, unmarked, as it is at the head (as it was, for a deleted file): Changes off. */
  blocks: MdBlock[];
  /** The document with its change marked: Changes on. */
  rows: MdRow[];
}
export interface Commit { sha: string; author: string; subject: string }
export interface Diff {
  version: 1;
  repo: string;
  base: string;
  head: string;
  /** Set when `head` is a snapshot of the working tree: the commit it sits on. No remote holds the snapshot. */
  snapshotOf?: string;
  /** Paths left out of the snapshot. gather reads them back, so a rebuild keeps them out. */
  exclude?: string[];
  baseRef: string;
  branch: string | null;
  commits: Commit[];
  files: DiffFile[];
}

// ---------------------------------------------------------------- guide.json
export type Text = string | string[];
/** A section's diagram: Mermaid source, drawn at build with pele. `refs` ties a node, by its id, to the code it stands
    for ("path:line"). */
export interface Diagram { title?: string; mermaid: string; refs?: Record<string, string> }
export interface StateTable {
  title?: string;
  caption?: string;
  ref?: string;
  columns: string[];
  rows: (string[] | { cells: string[]; new?: boolean; gone?: boolean })[];
  note?: string;
}
export type FileSel = string | { path: string; hunks?: number[] };
export interface Chapter {
  id: string;
  title: string;
  kind?: Kind;
  body: Text;
  files: FileSel[];
  table?: StateTable;
  diagram: Diagram;
}
export type DiffStyle = 'unified' | 'split';
export interface Guide {
  pr: {
    number?: number; title: string; url?: string; author?: string; base?: string; head?: string;
    /** Someone else's change: Claude answers comments on it, and changes no code. */
    readOnly?: boolean;
  };
  /** The page's name in the browser tab and the artifact gallery, 2 to 4 words. */
  name?: string;
  /** How code cards show a change at first: one column, or old and new side by side. Each reader can switch. */
  diffStyle?: DiffStyle;
  links?: { label: string; href: string }[];
  overview: { summary: Text; steps?: string[]; diagram: Diagram };
  chapters: Chapter[];
}

// ---------------------------------------------------------------- stack.json
/** Several pull requests on one page, in the order the picker lists them: a stack from its base up. Paths are
    relative to this file. */
export interface Stack {
  /** The page's name in the browser tab and the artifact gallery, 2 to 4 words. */
  name?: string;
  diffStyle?: DiffStyle;
  prs: { guide: string; diff: string }[];
}

// ---------------------------------------------------------------- the page's data (window.GR_DATA)
export interface PageChapter { id: string; title: string; files: { path: string; hunks: number[] | null }[] }
export interface PagePr {
  /** The PR's panel id ("pr42"), and the prefix of every element id inside it: "pr42-", or "" on a page with one PR. */
  id: string;
  prefix: string;
  /** Where review marks are kept: by pull request, not head, so they carry over to a rebuilt guide. */
  key: string;
  number: number | null;
  title: string;
  /** The head commit the guide was written for: line comments name it, so their line numbers can be read back. */
  head: string;
  /** What a send may do, named in its text; left out when Claude drives a branch. "uncommitted": it changes the working
      tree and commits nothing. "read-only": it answers and changes no code. */
  mode?: 'uncommitted' | 'read-only';
  chapters: PageChapter[];
  files: DiffFile[];
  /** Each section's diagram, drawn at build: by "overview" or "c-<chapter id>". */
  diagrams: Record<string, PageDiagram>;
}
/** Where a diagram's node leads: a line of the diff (in chapter `ch`), or `url` on GitHub for a file the pull request
    does not change. `title` is the node's tooltip. */
export interface DiagramRef { path: string; line: number; side?: Side; ch?: string; url?: string; title: string }
/** A drawn diagram: the SVG for its box (kit/build/diagram.ts), and its nodes' refs by node id. */
export interface PageDiagram { html: string; refs?: Record<string, DiagramRef> }
export interface PageData {
  libs: Record<'diffs' | 'trees', string>;
  diffStyle: DiffStyle;
  prs: PagePr[];
}

// ---------------------------------------------------------------- review comments
/** The side a line number counts on: the old file ('o', a removed line) or the new one ('n', every other line). */
export type Side = 'o' | 'n';
/** One comment the reader writes on the page for Claude. Kept in their browser until they send the batch; then it
    opens a thread, or, as a reply, goes on one. */
export interface ReviewComment {
  id: string;
  /** line: a line or a block of lines; file: a file as a whole; general: the pull request as a whole; reply: the next
      message in a thread a sent comment opened. */
  kind: 'line' | 'file' | 'general' | 'reply';
  /** A reply's thread: the id of the comment that opened it. */
  thread?: string;
  /** The file, for a line or file comment, and for a reply on one. */
  path?: string;
  /** For a file comment: the chapter whose card it was written on, so it stays beside that card. */
  chapter?: string;
  /** A line comment's first and last line, each on its own side. */
  start?: number;
  side?: Side;
  end?: number;
  endSide?: Side;
  /** The lines a line comment is on, as the page showed them. */
  code?: [op: ' ' | '-' | '+', text: string][];
  text: string;
  /** The head commit the comment was written on. */
  head: string;
  at: string;
}
/** A comment as a send holds it. A reply also carries the thread it answers, as the reader saw it. */
export interface SentComment extends ReviewComment {
  on?: { where: string; text: string };
  before?: { by: Author; text: string }[];
}
/** One send, as the page database keeps it at comments/<uid>/sends/<send id>. Written once, never changed. */
export interface SendDoc {
  sentAt: string;
  prs: { key?: string; number: number | null; title: string; head: string; comments: SentComment[] }[];
}
export type Author = 'reader' | 'claude';
/** One message in a thread, at comments/<uid>/msgs/<msg id>: an answer of Claude's, or a mark that resolves the
    thread or opens it again. One document per message, so the reader and Claude never write the same one. */
export interface ThreadMsg { thread: string; by: Author; text?: string; resolved?: boolean; at: string; head?: string }

// ---------------------------------------------------------------- artifact capabilities (runtime contract 0.2.x)
export type CanSendToClaude = 'available' | 'writers_only' | 'no_session' | 'off';
export interface CommentsCap {
  canSendToClaude(): Promise<CanSendToClaude>;
  anchorFor(el: Element): Promise<unknown>;
  sendToClaude(target: { anchor: unknown; text: string }): Promise<{ threadId: string }>;
}
export interface DocSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
export interface QuerySnap { docs: DocSnap[]; docChanges(): { type: 'added' | 'modified' | 'removed'; doc: DocSnap }[]; metadata?: { fromCache: boolean } }
export interface DocRef { path: string; set(data: Record<string, unknown>): Promise<void> }
export interface CollectionRef { path: string; onSnapshot(next: (s: QuerySnap) => void, error?: (e: { code: string }) => void): () => void }
export interface DbCap { doc(path: string): DocRef; collection(path: string): CollectionRef }
export interface UserCap {
  can(name: string): Promise<boolean | null>;
  id(): Promise<string | null>;
  /** Names are "" without the "profile" scope. */
  profiles(ids: string[]): Promise<Record<string, { name: string }>>;
}
export interface CapabilityMap { comments: CommentsCap; db: DbCap; user: UserCap }

declare global {
  interface Window {
    /** Set by the page's data file, which loads before the runtime. */
    GR_DATA?: PageData;
    claude?: { use<K extends keyof CapabilityMap>(name: K): Promise<CapabilityMap[K] | null> };
  }
}

// ---------------------------------------------------------------- the library slices the runtime uses
export interface PierreHunkSeparator { hunkIndex: number; lines: number; lineCountKnown?: boolean; expandable?: boolean }
export interface PierreAnnotation<T> { side: 'additions' | 'deletions'; lineNumber: number; metadata: T }
/** A range of lines the reader picked in the gutter (the lines selected, or the "+" dragged over), in the order picked.
    An end on `deletions` is numbered on the old side; any other end (an added or unchanged line) on the new side. */
export interface PierreLineRange { start: number; end: number; side?: 'additions' | 'deletions'; endSide?: 'additions' | 'deletions' }
export interface PierreFileDiffMeta { isPartial: boolean }
export interface PierreFileDiff {
  setOptions(o: Record<string, unknown>): void;
  rerender(): void;
  render(o: { fileDiff: PierreFileDiffMeta; containerWrapper: HTMLElement; lineAnnotations?: PierreAnnotation<unknown>[] }): void;
  setLineAnnotations(list: PierreAnnotation<unknown>[]): void;
  setThemeType(t: ThemeType): void;
  expandHunk(index: number, direction: 'up' | 'down' | 'both', lines?: number): void;
  setSelectedLines(range: PierreLineRange | null): void;
}
export interface PierreDiffs {
  parsePatchFiles(patch: string): { files: PierreFileDiffMeta[] }[];
  hydratePartialDiff(mode: 'mutate', fd: PierreFileDiffMeta, files: { oldFile: { name: string; contents: string }; newFile: { name: string; contents: string } }): void;
  setCustomExtension(ext: string, lang: string): void;
  FileDiff: new (o: Record<string, unknown>) => PierreFileDiff;
}
export interface TreeDecoration { text: string; title?: string; parts?: { text: string; color?: string }[] }
export interface PierreFileTree {
  render(o: { fileTreeContainer: HTMLElement }): void;
  setComposition(c?: unknown): void;
}
export interface PierreTrees {
  FileTree: new (o: {
    paths: string[];
    initialExpansion?: 'open' | 'closed';
    flattenEmptyDirectories?: boolean;
    density?: string;
    gitStatus?: { path: string; status: string }[];
    renderRowDecoration?: (row: { item: { path: string } }) => TreeDecoration | null;
    onSelectionChange?: (paths: string[]) => void;
    unsafeCSS?: string;
  }) => PierreFileTree;
}
