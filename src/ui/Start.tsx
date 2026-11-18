import { useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS } from '../ai/rework';
import { probeDeck } from '../core/preview';
import { addSnapshot, createProject, deleteProject, listProjects, saveComment, updateSnapshot } from '../core/store';
import type { DeckFiles, DeckSource, Project } from '../core/types';
import { loadSettings, saveSettings, type Settings } from '../core/settings';
import { EXAMPLE_APPLIED, EXAMPLE_OPEN, exampleComment, exampleDeck } from '../sources/example';
import { loadFromGithub } from '../sources/github';
import { listTemplates, type Template } from '../sources/templates';
import { filesFromUpload } from '../sources/upload';
import { firstDraftComment } from '../sources/wizard';
import { SettingsDialog } from './Dialogs';
import { Wizard, type WizardResult } from './Wizard';

export function Start({ onOpen }: { onOpen: (projectId: string) => void }) {
  const templates = useMemo(listTemplates, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [wizard, setWizard] = useState<Template | null>(null);
  const [showSettings, setShowSettings] = useState(false);
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

  const openTemplate = (t: Template) =>
    void open('Opening template', async () => ({ name: t.name, source: { type: 'template', label: t.name }, files: t.files }));

  const createFromWizard = async (t: Template, result: WizardResult) => {
    setWizard(null);
    setBusy('Creating your deck');
    setError('');
    try {
      saveSettings(result.settings);
      setSettings(result.settings);
      const { project } = await createProject(result.name, { type: 'template', label: `${t.name} · start wizard` }, result.files);
      if (result.firstDraft) {
        await saveComment({ id: crypto.randomUUID(), projectId: project.id, slide: 0, text: firstDraftComment(result.brief), status: 'open', createdAt: Date.now() });
      }
      onOpen(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };

  /* The example: dummy data, one round already applied, four open comments demo mode can answer. */
  const openExample = async () => {
    const base = templates.find((t) => t.id === 'three-minute-pitch') ?? templates[0];
    if (!base) return;
    setBusy('Preparing the example');
    setError('');
    try {
      const deck = exampleDeck(base.files);
      const { project, snapshot } = await createProject(deck.name, { type: 'template', label: 'Example with dummy data' }, deck.v1);
      const first = { ...snapshot, label: 'Created with the start wizard', probe: await probeDeck(deck.v1, snapshot.entry) };
      await updateSnapshot(first);
      const second = await addSnapshot(project, first, deck.v1, deck.v2, {
        kind: 'ai', label: `Rework: slide ${EXAMPLE_APPLIED.slide}`, probe: await probeDeck(deck.v2, snapshot.entry),
      });
      const titles = second.probe?.titles ?? [];
      const now = Date.now();
      await saveComment({ ...exampleComment(project.id, EXAMPLE_APPLIED, titles, now - 1000), status: 'applied', appliedIn: second.id });
      for (const [i, c] of EXAMPLE_OPEN.entries()) await saveComment(exampleComment(project.id, c, titles, now + i));
      onOpen(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };

  /* Links into the app: ?example opens the example, ?template=<id> starts the wizard, ?deck=<GitHub link> loads a deck. */
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current) return;
    linked.current = true;
    let params: URLSearchParams;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    const deck = params.get('deck');
    const template = templates.find((t) => t.id === params.get('template'));
    if (!params.has('example') && !deck && !template) return;
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* not allowed in every embedding */ }
    if (params.has('example')) void openExample();
    else if (template) setWizard(template);
    else if (deck) {
      const url = /^https?:\/\//i.test(deck) ? deck : `https://${deck}`;
      setLink(url);
      void open('Loading from GitHub', () => loadFromGithub(url, loadSettings().githubToken));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the address the app was opened with
  }, []);

  const aiReady = settings.provider === 'claude' && !!settings.apiKey;

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
        <div className="row">
          <div className="brand"><span className="brand-mark" aria-hidden="true" />DeckHack</div>
          <div className="spacer" />
          <button className="btn ai-chip" onClick={() => setShowSettings(true)}>
            <span className={'dot ' + (aiReady ? 'ready' : 'off')} aria-hidden="true" />
            {aiReady ? `AI: ${PROVIDERS.claude!.label.replace(/ \(.*/, '')} ready` : settings.provider === 'claude' ? 'AI: API key missing' : 'AI: demo mode · add API key'}
          </button>
        </div>
        <h1>Fix your pitch deck slide by slide.</h1>
        <p>Open an HTML deck, leave a note on each slide that needs work, apply the whole round at once and keep every version. Your deck stays plain HTML.</p>
        <div className="row">
          <button className="btn primary" disabled={!!busy} onClick={() => void openExample()}>Try the example deck</button>
          <span className="hint">Dummy data, four comments waiting, one version to go back to. No key needed.</span>
        </div>
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
                  onClick={() => setWizard(t)}
                >
                  <b>{t.name}</b>
                  <span>{t.description}</span>
                  {t.colors.length > 0 && <span className="template-swatches" aria-hidden="true">{t.colors.map((c) => <i key={c} style={{ background: c }} />)}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">A short wizard asks for pitch length, jury criteria and storyline, then lays out the slides.</p>
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

      {wizard && (
        <Wizard
          template={wizard} settings={settings}
          onClose={() => setWizard(null)}
          onPlain={() => { const t = wizard; setWizard(null); openTemplate(t); }}
          onCreate={(result) => void createFromWizard(wizard, result)}
        />
      )}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(next) => { saveSettings(next); setSettings(next); setShowSettings(false); }}
        />
      )}

      <footer className="start-foot">
        Runs entirely in your browser. Decks and keys are stored on this device and are sent only to the services you connect.
      </footer>
    </div>
  );
}
