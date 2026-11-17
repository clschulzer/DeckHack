import type { Comment, DeckFiles, DeckSource, ProbeResult, Project, Snapshot, SnapshotKind } from './types';
import { changedPaths } from './edits';
import { findEntry } from './bundle';
import { changedSlides } from './preview';

/**
 * Local storage of projects, versions and comments in IndexedDB.
 * File contents are stored once per content hash, so a new version only costs the files that changed.
 */
const DB_NAME = 'deckhack';
type StoreName = 'projects' | 'snapshots' | 'blobs' | 'comments';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('project', 'projectId');
      db.createObjectStore('blobs');
      db.createObjectStore('comments', { keyPath: 'id' }).createIndex('project', 'projectId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database'));
  });
  return dbPromise;
}

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx(name: StoreName, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  return (await openDb()).transaction(name, mode).objectStore(name);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function writeFiles(files: DeckFiles): Promise<Snapshot['files']> {
  const out: Snapshot['files'] = {};
  for (const [path, file] of Object.entries(files)) {
    if (file.kind === 'remote') {
      out[path] = { kind: 'remote', url: file.url };
      continue;
    }
    const bytes = file.kind === 'text' ? encoder.encode(file.text) : file.bytes;
    const hash = await sha256(bytes);
    const blobs = await tx('blobs', 'readwrite');
    if ((await done(blobs.count(hash))) === 0) await done((await tx('blobs', 'readwrite')).put(bytes, hash));
    out[path] = file.kind === 'text' ? { kind: 'text', hash } : { kind: 'binary', hash, mime: file.mime };
  }
  return out;
}

export async function readFiles(snapshot: Snapshot): Promise<DeckFiles> {
  const out: DeckFiles = {};
  for (const [path, ref] of Object.entries(snapshot.files)) {
    if (ref.kind === 'remote') {
      out[path] = { kind: 'remote', url: ref.url };
      continue;
    }
    const bytes = (await done((await tx('blobs')).get(ref.hash))) as Uint8Array | undefined;
    if (!bytes) throw new Error(`Stored content for ${path} is missing`);
    out[path] = ref.kind === 'text' ? { kind: 'text', text: decoder.decode(bytes) } : { kind: 'binary', bytes, mime: ref.mime ?? 'application/octet-stream' };
  }
  return out;
}

export async function listProjects(): Promise<Project[]> {
  const all = (await done((await tx('projects')).getAll())) as Project[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await done((await tx('projects')).get(id))) as Project | undefined;
}

export async function listSnapshots(projectId: string): Promise<Snapshot[]> {
  const all = (await done((await tx('snapshots')).index('project').getAll(projectId))) as Snapshot[];
  return all.sort((a, b) => b.seq - a.seq);
}

export async function createProject(name: string, source: DeckSource, files: DeckFiles): Promise<{ project: Project; snapshot: Snapshot }> {
  const entry = findEntry(files);
  if (!entry) throw new Error('No HTML file found. A deck needs at least one .html file.');
  const now = Date.now();
  const project: Project = { id: crypto.randomUUID(), name, source, headId: '', createdAt: now, updatedAt: now };
  const snapshot: Snapshot = {
    id: crypto.randomUUID(), projectId: project.id, parentId: null, seq: 1, createdAt: now,
    kind: 'import', label: `Imported from ${source.label}`, files: await writeFiles(files), entry,
  };
  project.headId = snapshot.id;
  await done((await tx('snapshots', 'readwrite')).put(snapshot));
  await done((await tx('projects', 'readwrite')).put(project));
  return { project, snapshot };
}

/**
 * Adds a version on top of `parent`. Nothing is ever overwritten: going back to an old version
 * also adds a new one (kind "restore"), so the history stays complete.
 */
export async function addSnapshot(
  project: Project, parent: Snapshot, parentFiles: DeckFiles, files: DeckFiles,
  info: { kind: SnapshotKind; label: string; probe?: ProbeResult },
): Promise<Snapshot> {
  const seq = Math.max(0, ...(await listSnapshots(project.id)).map((s) => s.seq)) + 1;
  const snapshot: Snapshot = {
    id: crypto.randomUUID(), projectId: project.id, parentId: parent.id, seq, createdAt: Date.now(),
    kind: info.kind, label: info.label, files: await writeFiles(files), entry: findEntry(files) ?? parent.entry,
    probe: info.probe,
    changedSlides: info.probe ? changedSlides(parent.probe, info.probe) : undefined,
    changedFiles: changedPaths(parentFiles, files),
  };
  await done((await tx('snapshots', 'readwrite')).put(snapshot));
  await done((await tx('projects', 'readwrite')).put({ ...project, headId: snapshot.id, updatedAt: snapshot.createdAt }));
  return snapshot;
}

export async function updateSnapshot(snapshot: Snapshot): Promise<void> {
  await done((await tx('snapshots', 'readwrite')).put(snapshot));
}

export async function deleteProject(id: string): Promise<void> {
  for (const s of await listSnapshots(id)) await done((await tx('snapshots', 'readwrite')).delete(s.id));
  for (const c of await listComments(id)) await done((await tx('comments', 'readwrite')).delete(c.id));
  await done((await tx('projects', 'readwrite')).delete(id));
}

export async function listComments(projectId: string): Promise<Comment[]> {
  const all = (await done((await tx('comments')).index('project').getAll(projectId))) as Comment[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveComment(comment: Comment): Promise<void> {
  await done((await tx('comments', 'readwrite')).put(comment));
}

export async function removeComment(id: string): Promise<void> {
  await done((await tx('comments', 'readwrite')).delete(id));
}
