import type { DeckFiles, DeckSource } from '../core/types';
import { isTextPath } from '../core/paths';

export interface GithubTarget {
  owner: string;
  repo: string;
  /** Branch, tag or commit. Undefined means the default branch. */
  ref?: string;
  /** Folder (or file) inside the repo. */
  path: string;
}

/** Understands repo, tree, blob and GitHub Pages links. */
export function parseGithubUrl(input: string): GithubTarget | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const pages = /^([a-z0-9-]+)\.github\.io$/i.exec(url.hostname);
  if (pages) {
    const [repo, ...rest] = parts;
    if (!repo) return null;
    return { owner: pages[1]!, repo, path: rest.join('/') };
  }
  if (url.hostname !== 'github.com' || parts.length < 2) return null;
  const [owner, repo, kind, ref, ...rest] = parts;
  if ((kind === 'tree' || kind === 'blob') && ref) return { owner: owner!, repo: repo!.replace(/\.git$/, ''), ref, path: rest.join('/') };
  return { owner: owner!, repo: repo!.replace(/\.git$/, ''), path: '' };
}

const API = 'https://api.github.com';
const MAX_FILES = 400;
const MAX_TEXT_BYTES = 1_500_000;

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint = res.status === 401 ? 'The GitHub token was rejected.'
      : res.status === 403 ? 'GitHub refused the request (rate limit or missing permission). Add a token in Settings.'
      : res.status === 404 ? 'Not found. For a private repository, add a token with access to it in Settings.'
      : `GitHub answered ${res.status}.`;
    throw new Error(`${hint} ${detail.slice(0, 160)}`.trim());
  }
  return (await res.json()) as T;
}

interface TreeEntry { path: string; type: 'blob' | 'tree'; sha: string; size?: number }

const b64ToText = (b64: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

/**
 * Loads a deck folder from GitHub. Text files are downloaded so they can be edited;
 * images, video and fonts stay in the repository and are referenced by URL (pinned to the commit).
 */
export async function loadFromGithub(input: string, token: string): Promise<{ files: DeckFiles; source: DeckSource; name: string }> {
  const target = parseGithubUrl(input);
  if (!target) throw new Error('This does not look like a GitHub link. Paste a link to a repository, a folder or a GitHub Pages site.');
  const { owner, repo } = target;
  const info = await api<{ default_branch: string; private: boolean }>(`/repos/${owner}/${repo}`, token);
  const branch = target.ref ?? info.default_branch;
  const head = await api<{ sha: string; commit: { tree: { sha: string } } }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, token);
  const tree = await api<{ tree: TreeEntry[]; truncated: boolean }>(`/repos/${owner}/${repo}/git/trees/${head.commit.tree.sha}?recursive=1`, token);

  let dir = target.path.replace(/\/+$/, '');
  if (/\.html?$/i.test(dir)) dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
  const prefix = dir ? dir + '/' : '';
  const blobs = tree.tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && !/(^|\/)(\.git|node_modules)\//.test(e.path));
  if (!blobs.length) throw new Error(`No files found in ${owner}/${repo}${dir ? '/' + dir : ''} on ${branch}.`);
  if (blobs.length > MAX_FILES) {
    throw new Error(`This folder has ${blobs.length} files. Link to the folder that holds the deck (the one with its index.html) instead of the whole repository.`);
  }

  const files: DeckFiles = {};
  await Promise.all(blobs.map(async (entry) => {
    const rel = entry.path.slice(prefix.length);
    if (isTextPath(rel) && (entry.size ?? 0) <= MAX_TEXT_BYTES) {
      const blob = await api<{ content: string }>(`/repos/${owner}/${repo}/git/blobs/${entry.sha}`, token);
      files[rel] = { kind: 'text', text: b64ToText(blob.content) };
    } else if (!info.private) {
      files[rel] = { kind: 'remote', url: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${head.sha}/${entry.path.split('/').map(encodeURIComponent).join('/')}` };
    }
  }));

  return {
    files,
    name: dir ? dir.split('/').pop()! : repo,
    source: { type: 'github', label: `${owner}/${repo}${dir ? '/' + dir : ''}`, github: { owner, repo, branch, dir, baseSha: head.sha } },
  };
}

/**
 * Saves changed text files as one commit, using the Git Data API (blobs, tree, commit, ref).
 * Writes to `branch`; when that branch does not exist yet it is created from the source branch.
 */
export async function commitToGithub(
  gh: NonNullable<DeckSource['github']>, token: string,
  change: { write: Record<string, string>; remove: string[]; message: string; branch: string },
): Promise<{ sha: string; url: string }> {
  if (!token) throw new Error('Saving to GitHub needs a token with write access to the repository. Add one in Settings.');
  const base = `/repos/${gh.owner}/${gh.repo}`;
  const full = (rel: string) => (gh.dir ? `${gh.dir}/${rel}` : rel);

  let parentSha: string;
  let branchExists = true;
  try {
    parentSha = (await api<{ object: { sha: string } }>(`${base}/git/ref/heads/${encodeURIComponent(change.branch)}`, token)).object.sha;
  } catch {
    branchExists = false;
    parentSha = (await api<{ object: { sha: string } }>(`${base}/git/ref/heads/${encodeURIComponent(gh.branch)}`, token)).object.sha;
  }
  const parent = await api<{ tree: { sha: string } }>(`${base}/git/commits/${parentSha}`, token);

  const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null }> = [];
  for (const [rel, text] of Object.entries(change.write)) {
    const blob = await api<{ sha: string }>(`${base}/git/blobs`, token, { method: 'POST', body: JSON.stringify({ content: text, encoding: 'utf-8' }) });
    tree.push({ path: full(rel), mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const rel of change.remove) tree.push({ path: full(rel), mode: '100644', type: 'blob', sha: null });

  const newTree = await api<{ sha: string }>(`${base}/git/trees`, token, { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree }) });
  const commit = await api<{ sha: string; html_url: string }>(`${base}/git/commits`, token, {
    method: 'POST', body: JSON.stringify({ message: change.message, tree: newTree.sha, parents: [parentSha] }),
  });
  if (branchExists) {
    await api(`${base}/git/refs/heads/${encodeURIComponent(change.branch)}`, token, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  } else {
    await api(`${base}/git/refs`, token, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${change.branch}`, sha: commit.sha }) });
  }
  return { sha: commit.sha, url: commit.html_url };
}
