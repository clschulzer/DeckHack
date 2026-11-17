import type { Comment, DeckFiles, ProbeResult } from '../core/types';

export type ReworkEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'edit'; ok: boolean; message: string };

export interface ReworkRequest {
  files: DeckFiles;
  entry: string;
  /** Open comments to apply. `slide` 0 means the whole deck. */
  comments: Comment[];
  /** What the automatic walk found: slide count, titles, how slides are detected. */
  probe?: ProbeResult;
  /** Set on the second attempt: errors the first attempt introduced. */
  repair?: string[];
  model: string;
  apiKey: string;
  signal?: AbortSignal;
  onEvent: (event: ReworkEvent) => void;
}

export interface ReworkResult {
  files: DeckFiles;
  summary: string;
}

/** Anything that can turn comments into file edits. Add a provider by implementing this. */
export interface Provider {
  id: string;
  label: string;
  needsKey: boolean;
  rework(request: ReworkRequest): Promise<ReworkResult>;
}
