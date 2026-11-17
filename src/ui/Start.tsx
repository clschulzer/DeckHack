import { useEffect, useMemo, useRef, useState } from 'react';
import { createProject, deleteProject, listProjects } from '../core/store';
import type { DeckFiles, DeckSource, Project } from '../core/types';
import { loadSettings } from '../core/settings';
import { loadFromGithub } from '../sources/github';
import { listTemplates } from '../sources/templates';
import { filesFromUpload } from '../sources/upload';

export function Start({ onOpen }: { onOpen: (projectId: string) => void }) {
  const templates = useMemo(listTemplates, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const open = async (what: string, load: () => Promise<{ name: string; source: DeckSource; files: DeckFiles }>) => {
    setBusy(what);
    setError('');
    try {
      const { name, source, files } = await load();
      const { project } = await createProject(name, source, files);
      onOpen(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };

  const upload = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    void open('Reading files', async () => {
      const loaded = await filesFromUpload(files);
      return { ...loaded, source: { type: 'upload', label: loaded.name } };
    });
  };

  return (
    <div className="start">
      <header className="start-head">
        <div className="brand"><span className="brand-mark" aria-hidden="true" />DeckHack</div>
        <h1>Fix your pitch deck slide by slide.</h1>
        <p>Open an HTML deck, leave a note on each slide that needs work, apply the whole round at once and keep every version. Your deck stays plain HTML.</p>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      {busy && <div className="notice" role="status">{busy}…</div>}

      <div className="start-grid">
        <section className="source" aria-labelledby="src-template">
          <h2 id="src-template">Start from a template</h2>
          <ul className="template-list">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  className="template" disabled={!!busy}
                  onClick={() => void open('Opening template', async () => ({ name: t.name, source: { type: 'template', label: t.name }, files: t.files }))}
                >
                  <b>{t.name}</b>
                  <span>{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="source" aria-labelledby="src-upload">
          <h2 id="src-upload">Open your own deck</h2>
          <div
            className={'drop' + (dragging ? ' over' : '')}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
          >
            <p>Drop an .html file or a .zip of the deck folder here.</p>
            <div className="row">
              <button className="btn" disabled={!!busy} onClick={() => fileInput.current?.click()}>Choose file</button>
              <button className="btn" disabled={!!busy} onClick={() => folderInput.current?.click()}>Choose folder</button>
            </div>
            <input id="upload-files" ref={fileInput} type="file" multiple accept=".html,.htm,.zip" hidden onChange={(e) => upload(e.target.files)} />
            <input
              id="upload-folder" type="file" multiple hidden onChange={(e) => upload(e.target.files)}
              ref={(el) => { folderInput.current = el; el?.setAttribute('webkitdirectory', ''); }}
            />
          </div>
        </section>

        <section className="source" aria-labelledby="src-link">
          <h2 id="src-link">Load from GitHub</h2>
          <form
            className="link-form"
            onSubmit={(e) => { e.preventDefault(); if (link.trim()) void open('Loading from GitHub', () => loadFromGithub(link, loadSettings().githubToken)); }}
          >
            <label htmlFor="gh-link">Link to a repository, a folder in it, or its GitHub Pages site</label>
            <input id="gh-link" type="url" inputMode="url" placeholder="https://github.com/you/repo/tree/main/pitch" value={link} onChange={(e) => setLink(e.target.value)} />
            <button className="btn primary" disabled={!!busy || !link.trim()}>Load deck</button>
          </form>
          <p className="hint">Public repositories work without a token. Saving back creates a commit on a branch you choose.</p>
        </section>
      </div>

      {projects.length > 0 && (
        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title">Continue</h2>
          <ul>
            {projects.map((p) => (
              <li key={p.id}>
                <button className="recent-open" onClick={() => onOpen(p.id)}>
                  <b>{p.name}</b>
                  <span>{p.source.label} · {new Date(p.updatedAt).toLocaleString()}</span>
                </button>
                <button
                  className="btn quiet" aria-label={`Delete ${p.name}`}
                  onClick={() => void deleteProject(p.id).then(listProjects).then(setProjects)}
                >Delete</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="start-foot">
        Runs entirely in your browser. Decks and keys are stored on this device and are sent only to the services you connect.
      </footer>
    </div>
  );
}
