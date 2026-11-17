import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PROVIDERS } from '../ai/rework';
import { changedPaths } from '../core/edits';
import { forgetKeys, hasRememberedKeys, HOSTED_DEMO, MODELS, type Settings } from '../core/settings';
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

/** Shown wherever a Claude key is entered. */
export function KeyAdvice() {
  return (
    <p className="hint">
      Use a key made only for DeckHack, in its own workspace with a spend limit, so a lost key can cost no more than that limit. Both are set up in the{' '}
      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic Console</a>, where you can also revoke the key.
    </p>
  );
}

/** Shown in the hosted demo wherever the local app asks for a key. */
export function RunLocally() {
  return (
    <div className="notice" role="note" id="run-locally">
      <b>This hosted page is a demo and takes no keys.</b> To rework decks with your own Claude key and save to GitHub, run DeckHack on your own computer:
      <pre><code>{'git clone https://github.com/clschulzer/DeckHack\ncd DeckHack\ndocker compose up     # or: npm ci && npm start'}</code></pre>
    </div>
  );
}

/** Shown as soon as "remember" is switched on. */
export function RememberWarning() {
  return (
    <div className="notice warn" role="note">
      <b>The keys will stay in this browser after you close the tab.</b> They are stored unencrypted. Anyone using this browser profile can read them,
      and so can any other page served from the same web address (on GitHub Pages: every project under the same user name) and any browser extension with access to this page.
      Only switch this on on your own device.
    </div>
  );
}

export function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState(settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const stored = !!(s.apiKey || s.githubToken) || hasRememberedKeys();
  if (HOSTED_DEMO) {
    return (
      <Dialog title="Settings" onClose={onClose}>
        <div className="form">
          <p>Comments are applied in demo mode: no AI calls, prepared answers for the example deck, and <code>replace "old" with "new"</code> for your own comments.</p>
          <RunLocally />
        </div>
      </Dialog>
    );
  }
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
        <KeyAdvice />

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
        <p className="hint">Off (default): keys are forgotten when you close the tab.</p>
        {s.remember && <RememberWarning />}

        <div className="row end">
          {stored && <button type="button" className="btn" onClick={() => onSave(forgetKeys())}>Remove stored keys</button>}
          <button className="btn primary">Save settings</button>
        </div>
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
        {gh && !HOSTED_DEMO ? (
          <>
            <p>Commit the changed files to <b>{gh.owner}/{gh.repo}</b>. The branch is created from <code>{gh.branch}</code> if it does not exist yet, so nothing lands on your main branch without a pull request.</p>
            <label htmlFor="save-branch">Branch</label>
            <input id="save-branch" value={branch} onChange={(e) => setBranch(e.target.value.trim())} />
            <label htmlFor="save-message">Commit message</label>
            <input id="save-message" value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="row end"><button className="btn primary" disabled={state.busy || !branch || !message} onClick={() => void commit()}>Commit to GitHub</button></div>
          </>
        ) : (
          <p>{gh ? 'The hosted demo does not commit to GitHub, so this deck is saved as a download.' : 'This deck was not loaded from GitHub, so it is saved as a download.'} Every version also stays in this browser.</p>
        )}
        <div className="row end"><button className="btn" disabled={state.busy} onClick={() => void download()}>Download .zip</button></div>
        {state.error && <div className="notice error" role="alert">{state.error}</div>}
        {state.done && <div className="notice" role="status">{state.done} {state.url && <a href={state.url} target="_blank" rel="noreferrer">Open commit</a>}</div>}
      </div>
    </Dialog>
  );
}
