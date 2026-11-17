import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PROVIDERS } from '../ai/rework';
import { changedPaths } from '../core/edits';
import { MODELS, type Settings } from '../core/settings';
import { readFiles } from '../core/store';
import type { Project, Snapshot } from '../core/types';
import { commitToGithub } from '../sources/github';
import { zipDeck } from '../sources/upload';

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog ref={ref} className={'dialog' + (wide ? ' wide' : '')} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dialog-inner">
        <header><h2>{title}</h2><button className="btn quiet" onClick={onClose} aria-label="Close">Close</button></header>
        {children}
      </div>
    </dialog>
  );
}

export function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState(settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  return (
    <Dialog title="Settings" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); onSave(s); }}>
        <fieldset>
          <legend>Who applies the comments</legend>
          {Object.values(PROVIDERS).map((p) => (
            <label key={p.id} className="check">
              <input id={`provider-${p.id}`} type="radio" name="provider" checked={s.provider === p.id} onChange={() => set('provider', p.id as Settings['provider'])} />
              {p.label}
            </label>
          ))}
        </fieldset>

        <label htmlFor="set-key">Claude API key</label>
        <input id="set-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={s.apiKey} onChange={(e) => set('apiKey', e.target.value.trim())} />
        <p className="hint">Sent only to api.anthropic.com, straight from this browser. DeckHack has no server.</p>

        <label htmlFor="set-model">Model</label>
        <select id="set-model" value={s.model} onChange={(e) => set('model', e.target.value)}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.hint}</option>)}
        </select>

        <label htmlFor="set-gh">GitHub token</label>
        <input id="set-gh" type="password" autoComplete="off" spellCheck={false} placeholder="github_pat_…" value={s.githubToken} onChange={(e) => set('githubToken', e.target.value.trim())} />
        <p className="hint">Needed to save commits and to open private repositories. A fine-grained token with “Contents: read and write” on the one repository is enough.</p>

        <label className="check">
          <input id="set-remember" type="checkbox" checked={s.remember} onChange={(e) => set('remember', e.target.checked)} />
          Remember keys on this device
        </label>
        <p className="hint">Off: keys are forgotten when you close the tab. On: they are stored in this browser, readable by anything else served from the same web address.</p>

        <div className="row end"><button className="btn primary">Save settings</button></div>
      </form>
    </Dialog>
  );
}

export function SaveDialog({ project, head, snapshots, token, onSaved, onClose }: {
  project: Project; head: Snapshot; snapshots: Snapshot[]; token: string;
  onSaved: (sha: string) => Promise<void>; onClose: () => void;
}) {
  const gh = project.source.github;
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
  const [branch, setBranch] = useState(`deckhack/${slug}`);
  const [message, setMessage] = useState(`Update pitch deck (v${head.seq}): ${head.label}`);
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string; url?: string }>({});

  const download = async () => {
    setState({ busy: true });
    try {
      const zip = zipDeck(await readFiles(head));
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}-v${head.seq}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ done: `Downloaded ${slug}-v${head.seq}.zip. If nothing arrived, this page is not allowed to start downloads.` });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const commit = async () => {
    if (!gh) return;
    setState({ busy: true });
    try {
      const first = snapshots.find((s) => s.seq === 1) ?? head;
      const [before, after] = await Promise.all([readFiles(first), readFiles(head)]);
      const write: Record<string, string> = {};
      const remove: string[] = [];
      for (const path of changedPaths(before, after)) {
        const file = after[path];
        if (!file) remove.push(path);
        else if (file.kind === 'text') write[path] = file.text;
      }
      if (!Object.keys(write).length && !remove.length) {
        setState({ done: 'Nothing has changed since the deck was loaded, so there is nothing to commit.' });
        return;
      }
      const res = await commitToGithub(gh, token, { write, remove, message, branch });
      await onSaved(res.sha);
      setState({ done: `Committed ${res.sha.slice(0, 7)} to ${branch}.`, url: res.url });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Dialog title={`Save v${head.seq}`} onClose={onClose}>
      <div className="form">
        {gh ? (
          <>
            <p>Commit the changed files to <b>{gh.owner}/{gh.repo}</b>. The branch is created from <code>{gh.branch}</code> if it does not exist yet, so nothing lands on your main branch without a pull request.</p>
            <label htmlFor="save-branch">Branch</label>
            <input id="save-branch" value={branch} onChange={(e) => setBranch(e.target.value.trim())} />
            <label htmlFor="save-message">Commit message</label>
            <input id="save-message" value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="row end"><button className="btn primary" disabled={state.busy || !branch || !message} onClick={() => void commit()}>Commit to GitHub</button></div>
          </>
        ) : (
          <p>This deck was not loaded from GitHub, so it is saved as a download. Every version also stays in this browser.</p>
        )}
        <div className="row end"><button className="btn" disabled={state.busy} onClick={() => void download()}>Download .zip</button></div>
        {state.error && <div className="notice error" role="alert">{state.error}</div>}
        {state.done && <div className="notice" role="status">{state.done} {state.url && <a href={state.url} target="_blank" rel="noreferrer">Open commit</a>}</div>}
      </div>
    </Dialog>
  );
}
