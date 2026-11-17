/** A deck is a folder of plain web files. DeckHack never requires a special format. */
export type DeckFile =
  | { kind: 'text'; text: string }
  /** Binary asset held locally (uploaded image, font, video). */
  | { kind: 'binary'; bytes: Uint8Array; mime: string }
  /** Binary asset that stays where it is (for example in a public GitHub repo) and is loaded by URL. */
  | { kind: 'remote'; url: string };

/** Path (relative to the deck root, forward slashes) to file. */
export type DeckFiles = Record<string, DeckFile>;

export interface DeckSource {
  type: 'template' | 'upload' | 'github';
  label: string;
  github?: { owner: string; repo: string; branch: string; dir: string; baseSha: string };
}

/** What one walk through the rendered deck found. Stored with every version. */
export interface ProbeResult {
  adapter: AdapterKind;
  count: number;
  titles: string[];
  /** One fingerprint per slide: markup, text and key computed styles. Same fingerprint = same slide. */
  fingerprints: string[];
  errors: string[];
}

export type AdapterKind = 'sections' | 'keys' | 'single';

export type SnapshotKind = 'import' | 'ai' | 'manual' | 'restore';

export interface Snapshot {
  id: string;
  projectId: string;
  parentId: string | null;
  /** Running number inside the project: v1, v2, ... */
  seq: number;
  createdAt: number;
  kind: SnapshotKind;
  label: string;
  /** path -> content hash (see blobs store) or a remote URL entry. */
  files: Record<string, { hash: string; kind: 'text' | 'binary'; mime?: string } | { url: string; kind: 'remote' }>;
  entry: string;
  probe?: ProbeResult;
  /** Slide numbers (1-based) whose fingerprint differs from the parent version. */
  changedSlides?: number[];
  changedFiles?: string[];
  commitSha?: string;
}

export interface Project {
  id: string;
  name: string;
  source: DeckSource;
  headId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Comment {
  id: string;
  projectId: string;
  /** 1-based slide number, or 0 for a comment on the whole deck. */
  slide: number;
  slideTitle?: string;
  text: string;
  status: 'open' | 'applied';
  createdAt: number;
  appliedIn?: string;
  /**
   * Prepared answer for the example deck: text replacements that demo mode performs for this comment.
   * Real providers ignore it and read the comment text.
   */
  demo?: { old: string; new: string }[];
}

export type EditOp =
  | { op: 'replace'; path: string; old: string; new: string }
  | { op: 'write'; path: string; content: string }
  | { op: 'delete'; path: string };
