/* Public types: the figure API page scripts use, the config build.ts injects, and the slice of the claude.ai
   artifact capabilities the runtime calls. */

import type { SoundName } from '../kit/web/types';
export type { SoundName };

/** A library: a single-file build that sets `global` (after its `deps`), or an ES module with its import graph. */
export type Libs = Record<string, { url: string; global?: string; deps?: string[]; modules?: string[] }>;
/** `use`: the libraries this page needs, which build.ts found in its scripts. `agentSpec`: a design's agent spec as
    written, for Copy agent spec. */
export interface Config { libs: Libs; use: string[]; agentSpec?: string }

export type Mode = 'design' | 'explain';
export type RGBA = [number, number, number, number];
export type Controls = Record<string, number | string | boolean>;
export type Size = { width: number; height: number };
export type Keyframes = Record<string, unknown>;
export type AnimOpts = Record<string, unknown>;
export interface MotionAnimation { finished: Promise<unknown> }
export interface Motion { animate(el: Element, keyframes: Keyframes, opts?: AnimOpts): MotionAnimation }

/** Theme colors as rgba() strings, read fresh on each call. */
export type Tokens = Record<'bg' | 'fg' | 'card' | 'muted' | 'mutedFg' | 'border' | 'primary' | 'ok' | 'bad' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5', string>
  & { dark: boolean; font: string; mono: string };

/** What `thinkr.figure('#id', (fig) => …)` hands a figure script. */
export interface Fig {
  readonly el: HTMLElement;
  readonly id: string;
  /** The element to draw into (position: relative). */
  readonly stage: HTMLDivElement;
  readonly steps: number;
  /** The current step, from 1. */
  readonly step: number;
  readonly controls: Controls;
  readonly reducedMotion: boolean;
  readonly visible: boolean;
  readonly size: Size;
  /** A canvas that fills the stage, made once. */
  canvas(): HTMLCanvasElement;
  onResize(cb: (size: Size) => void): void;
  onControl(cb: (controls: Controls, changed: string) => void): void;
  onStep(cb: (step: number, prev: number) => void): void;
  onVisible(cb: (visible: boolean) => void): void;
  onTheme(cb: (tokens: Tokens) => void): void;
  tokens(): Tokens;
  /** A theme token (`'c1'`, `'bg'`, …) or any CSS color as linear 0..1 floats, ready for a shader uniform. */
  color(name: string): RGBA;
  load<T = any>(name: string): Promise<T>;
  /** Resolves motion's module, or null with reduced motion or when it cannot load. */
  motion(): Promise<Motion | null>;
  /** motion's animate() with the page's spring; does nothing until motion loads or with reduced motion. */
  anim(el: Element | null | undefined, keyframes: Keyframes, opts?: AnimOpts): MotionAnimation | null;
  /** vgpu with WebGPU started: `{ gpu, surface, effect, frameLoop, target, compute, storage, prepare, … }`, where
      effect, compute and draw take WGSL as a string. The page starts it at load, so this usually resolves at once. */
  vgpu(): Promise<any>;
  /** requestAnimationFrame that runs only while the figure is on screen. Returns a stop function. */
  loop(fn: (seconds: number, dt: number) => void): () => void;
  goTo(step: number): void;
  fail(err: unknown): void;
}

export interface Thinkr {
  figure(selector: string | Element, setup: (fig: Fig) => void | Promise<void>): void;
  load<T = any>(name: string): Promise<T>;
  tokens(): Tokens;
  sound(name: SoundName): void;
  motion(): Promise<Motion | null>;
}

// ---------------------------------------------------------------- artifact capabilities (runtime contract 0.2.x)
export type CanSendToClaude = 'available' | 'writers_only' | 'no_session' | 'off';
export interface CommentsCap {
  canSendToClaude(): Promise<CanSendToClaude>;
  anchorFor(el: Element): Promise<unknown>;
  sendToClaude(target: { anchor: unknown; text: string }): Promise<{ threadId: string }>;
}
export interface DocRef { path: string; get(): Promise<{ exists: boolean }>; set(data: Record<string, unknown>): Promise<void> }
export interface DbCap { doc(path: string): DocRef }
export interface UserCap { can(name: string): Promise<boolean | null>; id(): Promise<string | null> }
export interface CapabilityMap { comments: CommentsCap; db: DbCap; user: UserCap }

declare global {
  interface Window {
    THINKR?: Config;
    thinkr: Thinkr;
    claude?: { use<K extends keyof CapabilityMap>(name: K): Promise<CapabilityMap[K] | null> };
  }
}
