import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { estimateTokens } from '../ai/prompt';
import { PROVIDERS, runRework } from '../ai/rework';
import { Preview, probeDeck, type Picked, type PreviewState } from '../core/preview';
import { HOSTED_DEMO, loadSettings, saveSettings, type Settings } from '../core/settings';
import {
  addSnapshot, getProject, listComments, listSnapshots, readFiles, removeComment, saveComment, updateSnapshot,
} from '../core/store';
import type { Comment, DeckFiles, Project, Snapshot } from '../core/types';
import { SaveDialog, SettingsDialog } from './Dialogs';

interface LogLine { kind: 'status' | 'ok' | 'fail'; text: string }
interface RoundResult {
  snapshotId: string;
  seq: number;
  parentSeq: number;
  summary: string;
  changed: number[];
  /** Slides that changed although no comment asked for it. */
  unexpected: number[];
  newErrors: string[];
}

const STAGE_W = 1280, STAGE_H = 720;
const INITIAL_PREVIEW: PreviewState = { ready: false, adapter: 'single', count: 1, current: 1, errors: [] };

const ago = (t: number): string => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

export function Editor({ projectId, onExit }: { projectId: string; onExit: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [files, setFiles] = useState<{ id: string; files: DeckFiles } | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tab, setTab] = useState<'review' | 'versions'>('review');
  const [draft, setDraft] = useState('');
  const [wholeDeck, setWholeDeck] = useState(false);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<Picked | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'save' | null>(null);
  const [fatal, setFatal] = useState('');
  const [pv, setPv] = useState<PreviewState>(INITIAL_PREVIEW);
  const [scale, setScale] = useState(0.5);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<Preview | null>(null);
  const positionRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  const head = useMemo(() => snapshots.find((s) => s.id === project?.headId) ?? null, [snapshots, project]);
  const viewed = useMemo(() => (viewId ? snapshots.find((s) => s.id === viewId) ?? head : head), [snapshots, viewId, head]);
  const isHead = !!viewed && viewed.id === head?.id;
  const provider = PROVIDERS[settings.provider] ?? PROVIDERS.demo!;

  const refresh = useCallback(async () => {
    const p = await getProject(projectId);
    if (!p) throw new Error('This project no longer exists on this device.');
    const [snaps, comm] = await Promise.all([listSnapshots(projectId), listComments(projectId)]);
    setProject(p);
    setSnapshots(snaps);
    setComments(comm);
  }, [projectId]);

  useEffect(() => {
    refresh().catch((e: unknown) => setFatal(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  /* Load the files of the version on screen. A version that was never checked gets its first walk here. */
  useEffect(() => {
    if (!viewed) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await readFiles(viewed);
        if (cancelled) return;
        setFiles({ id: viewed.id, files: loaded });
        if (!viewed.probe) {
          const probe = await probeDeck(loaded, viewed.entry);
          await updateSnapshot({ ...viewed, probe });
          if (!cancelled) await refresh();
        }
      } catch (e) {
        if (!cancelled) setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when another version is shown
  }, [viewed?.id]);

  /* One sandboxed preview for the stage. */
  useEffect(() => {
    const preview = new Preview(iframeRef.current!);
    previewRef.current = preview;
    const off = preview.subscribe((state) => {
      if (state.ready) positionRef.current = state.current;
      setPv(state);
    });
    preview.onPicked = (picked) => {
      setTarget(picked);
      setPicking(false);
      setWholeDeck(false);
      document.getElementById('comment-text')?.focus();
    };
    return () => { off(); preview.dispose(); previewRef.current = null; };
  }, []);

  /* Pointing mode ends with the first click, with Escape, and whenever the preview reloads. */
  useEffect(() => { if (pv.ready) previewRef.current?.pick(picking); }, [picking, pv.ready]);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  useEffect(() => {
    if (!files || !viewed || files.id !== viewed.id) return;
    previewRef.current?.load(files.files, viewed.entry, { frozen, startAt: positionRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `frozen` is applied live below, without a reload
  }, [files]);

  useEffect(() => { previewRef.current?.freeze(frozen); }, [frozen]);

  /* Scale the fixed-size stage to the space available. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.1, Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const count = viewed?.probe?.count ?? pv.count;
  const titles = viewed?.probe?.titles ?? [];
  const current = Math.min(pv.current, Math.max(1, count));
  const titleOf = (n: number) => titles[n - 1] || `Slide ${n}`;
  const open = comments.filter((c) => c.status === 'open');
  const openHere = open.filter((c) => c.slide === current);
  const openDeck = open.filter((c) => c.slide === 0);
  const changedHere = new Set(viewed?.changedSlides ?? []);

  const go = (n: number) => previewRef.current?.go(Math.max(1, Math.min(count, n)));
  const replay = () => {
    if (!files || !viewed) return;
    setFrozen(false);
    previewRef.current?.load(files.files, viewed.entry, { startAt: current });
  };

  const addComment = async () => {
    const text = draft.trim();
    if (!text || !project) return;
    const about = !wholeDeck && target ? target : null;
    const slide = wholeDeck ? 0 : about?.slide ?? current;
    await saveComment({
      id: crypto.randomUUID(), projectId: project.id, slide, slideTitle: slide ? titles[slide - 1] : undefined,
      text, status: 'open', createdAt: Date.now(),
      ...(about ? { target: { tag: about.tag, text: about.text } } : {}),
    });
    setDraft('');
    setTarget(null);
    setComments(await listComments(project.id));
  };

  const applyRound = async () => {
    if (!project || !head || !files || files.id !== head.id || !open.length || busy) return;
    if (provider.needsKey && !settings.apiKey) { setDialog('settings'); return; }
    setBusy(true);
    setResult(null);
    setLog([{ kind: 'status', text: `Applying ${open.length} comment${open.length > 1 ? 's' : ''} with ${provider.label}` }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const outcome = await runRework(provider, {
        files: files.files, entry: head.entry, comments: open, probe: head.probe,
        model: settings.model, apiKey: settings.apiKey, signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'status') setLog((l) => [...l, { kind: 'status', text: e.text }]);
          else if (e.type === 'edit') setLog((l) => [...l, { kind: e.ok ? 'ok' : 'fail', text: e.message }]);
        },
      });
      if (!outcome) {
        setLog((l) => [...l, { kind: 'fail', text: 'Nothing was changed, so no new version was created.' }]);
        return;
      }
      const slidesAsked = [...new Set(open.map((c) => c.slide))].sort((a, b) => a - b);
      const label = slidesAsked.includes(0) ? 'Rework: whole deck' : `Rework: slide${slidesAsked.length > 1 ? 's' : ''} ${slidesAsked.join(', ')}`;
      const snapshot = await addSnapshot(project, head, files.files, outcome.files, { kind: 'ai', label, probe: outcome.probe });
      for (const c of open) await saveComment({ ...c, status: 'applied', appliedIn: snapshot.id });
      const changed = snapshot.changedSlides ?? [];
      setResult({
        snapshotId: snapshot.id, seq: snapshot.seq, parentSeq: head.seq, summary: outcome.summary, changed,
        unexpected: slidesAsked.includes(0) ? [] : changed.filter((n) => !slidesAsked.includes(n)),
        newErrors: outcome.newErrors,
      });
      setViewId(null);
      await refresh();
    } catch (e) {
      const text = controller.signal.aborted ? 'Stopped. Nothing was changed.' : e instanceof Error ? e.message : String(e);
      setLog((l) => [...l, { kind: 'fail', text }]);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  /* Going back never deletes anything: the old state becomes a new version on top. */
  const restore = async (target: Snapshot) => {
    if (!project || !head || busy) return;
    const [headFiles, targetFiles] = await Promise.all([readFiles(head), readFiles(target)]);
    await addSnapshot(project, head, headFiles, targetFiles, { kind: 'restore', label: `Restored v${target.seq}`, probe: target.probe });
    const later = new Set(snapshots.filter((s) => s.seq > target.seq).map((s) => s.id));
    for (const c of comments) if (c.appliedIn && later.has(c.appliedIn)) await saveComment({ ...c, status: 'open', appliedIn: undefined });
    setResult(null);
    setViewId(null);
    await refresh();
  };

  const present = () => { void stageRef.current?.requestFullscreen?.().catch(() => undefined); };

  if (fatal) {
    return (
      <div className="start"><div className="notice error" role="alert">{fatal}</div><button className="btn" onClick={onExit}>Back to start</button></div>
    );
  }

  const parentOfResult = result ? snapshots.find((s) => s.seq === result.parentSeq) : undefined;
  const showingBefore = !!parentOfResult && viewId === parentOfResult.id;

  return (
    <div className="editor">
      <header className="topbar">
        <button className="brand as-button" onClick={onExit} aria-label="Back to start"><span className="brand-mark" aria-hidden="true" />DeckHack</button>
        <div className="project">
          <b>{project?.name ?? 'Loading'}</b>
          <span>{project?.source.label}</span>
        </div>
        <span className="version-chip" title={head?.label}>v{head?.seq ?? 1} · {head ? ago(head.createdAt) : ''}</span>
        <div className="spacer" />
        <button className="btn" onClick={() => setDialog('save')} disabled={!head}>Save</button>
        <button className="btn" onClick={() => setDialog('settings')}>Settings</button>
      </header>

      <nav className="filmstrip" aria-label="Slides">
        <ol>
          {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
            const notes = open.filter((c) => c.slide === n).length;
            return (
              <li key={n}>
                <button className={'film' + (n === current ? ' current' : '')} aria-current={n === current} onClick={() => go(n)}>
                  <span className="film-no">{String(n).padStart(2, '0')}</span>
                  <span className="film-title">{titleOf(n)}</span>
                  {changedHere.has(n) && <span className="dot changed" title={`Changed in v${viewed?.seq}`} />}
                  {notes > 0 && <span className="pin" title={`${notes} open comment${notes > 1 ? 's' : ''}`}>{notes}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="stage-col">
        {!isHead && viewed && (
          <div className="banner">
            <span>Viewing <b>v{viewed.seq}</b>, an older version.</span>
            <button className="btn small" onClick={() => setViewId(null)}>Back to latest</button>
            <button className="btn small" onClick={() => void restore(viewed)} disabled={busy}>Restore this version</button>
          </div>
        )}
        <div
          className="stage" ref={stageRef} tabIndex={0} aria-label="Slide preview"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); previewRef.current?.key('ArrowRight'); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); previewRef.current?.key('ArrowLeft'); }
          }}
        >
          <div className="stage-frame" style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
            <iframe
              ref={iframeRef} title="Deck preview" width={STAGE_W} height={STAGE_H}
              style={{ transform: `scale(${scale})` }}
            />
          </div>
          {!pv.ready && <div className="stage-wait">Loading preview…</div>}
        </div>
        <div className="controls">
          <button className="btn icon" onClick={() => go(current - 1)} disabled={current <= 1} aria-label="Previous slide">←</button>
          <span className="position"><b>{current}</b> / {count}</span>
          <button className="btn icon" onClick={() => go(current + 1)} disabled={current >= count} aria-label="Next slide">→</button>
          {pv.adapter === 'keys' && (
            <>
              <span className="sep" />
              <button className="btn small" onClick={() => previewRef.current?.key('ArrowLeft')}>Step back</button>
              <button className="btn small" onClick={() => previewRef.current?.key('ArrowRight')}>Step forward</button>
            </>
          )}
          <span className="sep" />
          <button className={'btn small' + (frozen ? ' on' : '')} aria-pressed={frozen} onClick={() => setFrozen((f) => !f)}>
            {frozen ? 'Animations off' : 'Animations on'}
          </button>
          <button className="btn small" onClick={replay} title="Play this slide again from the start">▶ Replay</button>
          <div className="spacer" />
          {pv.errors.length > 0 && <span className="errors" title={pv.errors.join('\n')}>{pv.errors.length} error{pv.errors.length > 1 ? 's' : ''} in deck</span>}
          <button className="btn small" onClick={present}>Present</button>
        </div>
      </main>

      <aside className="panel">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? 'sel' : ''} onClick={() => setTab('review')}>
            Review{open.length ? ` (${open.length})` : ''}
          </button>
          <button role="tab" aria-selected={tab === 'versions'} className={tab === 'versions' ? 'sel' : ''} onClick={() => setTab('versions')}>
            Versions ({snapshots.length})
          </button>
        </div>

        {tab === 'review' && (
          <div className="panel-body">
            <h2 className="panel-title"><span className="film-no">{String(current).padStart(2, '0')}</span>{titleOf(current)}</h2>

            <ul className="comments">
              {[...openHere, ...openDeck].map((c) => (
                <li key={c.id} className="comment">
                  <span className="comment-scope">{c.slide === 0 ? 'Whole deck' : `Slide ${c.slide}`}</span>
                  {c.target && <span className="comment-target">{c.target.tag}{c.target.text ? ` “${c.target.text}”` : ''}</span>}
                  <p>{c.text}</p>
                  <button className="btn quiet small" aria-label="Delete comment" onClick={() => void removeComment(c.id).then(() => listComments(projectId)).then(setComments)}>Delete</button>
                </li>
              ))}
              {!openHere.length && !openDeck.length && <li className="empty">No open comments on this slide.</li>}
            </ul>

            <form className="composer" onSubmit={(e) => { e.preventDefault(); void addComment(); }}>
              <label htmlFor="comment-text">What should change{wholeDeck ? ' across the deck' : ` on slide ${current}`}?</label>
              <textarea
                id="comment-text" rows={3} value={draft} disabled={!isHead}
                placeholder={provider.needsKey ? 'Shorter headline. Lead with the 47 minutes.' : 'replace "old text" with "new text"'}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addComment(); } }}
              />
              {target && !wholeDeck && (
                <div className="comment-target chosen">
                  <span>About: {target.tag}{target.text ? ` “${target.text}”` : ''} on slide {target.slide}</span>
                  <button type="button" className="link" onClick={() => setTarget(null)}>Remove</button>
                </div>
              )}
              <div className="row">
                <button
                  type="button" className={'btn small' + (picking ? ' on' : '')} aria-pressed={picking} disabled={!isHead || !pv.ready}
                  onClick={() => setPicking((p) => !p)} title="Click an element on the slide to say what the comment is about"
                >{picking ? 'Click an element…' : 'Point at element'}</button>
                <label className="check"><input id="comment-whole-deck" type="checkbox" checked={wholeDeck} onChange={(e) => setWholeDeck(e.target.checked)} /> Whole deck</label>
                <div className="spacer" />
                <button className="btn" disabled={!draft.trim() || !isHead}>Add comment</button>
              </div>
            </form>

            <section className="round" aria-label="Review round">
              {open.length > 0 && (
                <p className="round-summary">
                  <b>{open.length}</b> open comment{open.length > 1 ? 's' : ''} on{' '}
                  {[...new Set(open.map((c) => c.slide))].sort((a, b) => a - b).map((n) => (n ? `slide ${n}` : 'the whole deck')).join(', ')}
                </p>
              )}
              {busy
                ? <button className="btn" onClick={() => abortRef.current?.abort()}>Stop</button>
                : <button className="btn primary wide" disabled={!open.length || !isHead} onClick={() => void applyRound()}>Apply round</button>}
              {provider.needsKey && files && open.length > 0 && (
                <p className="hint">Sends the deck text to Claude: about {estimateTokens(files.files).toLocaleString('en-US')} tokens in, plus the edits it writes back.</p>
              )}
              {!provider.needsKey && (
                <p className="hint">
                  Demo mode makes no AI calls. Comments that came with the example have a prepared answer. Your own comments only work as <code>replace "old" with "new"</code>.{' '}
                  <button className="link" onClick={() => setDialog('settings')}>{HOSTED_DEMO ? 'Run DeckHack locally' : 'Add an API key'}</button> for real rework.
                </p>
              )}
              {log.length > 0 && (
                <ol className="log" aria-live="polite">
                  {log.map((l, i) => <li key={i} className={l.kind}>{l.text}</li>)}
                </ol>
              )}
              {result && (
                <div className={'result' + (result.unexpected.length || result.newErrors.length ? ' warn' : '')}>
                  <b>v{result.seq} created</b>
                  <p className="result-check">
                    {result.changed.length ? `Changed: slide${result.changed.length > 1 ? 's' : ''} ${result.changed.join(', ')}.` : 'No visible change on any slide.'}
                    {result.unexpected.length > 0 && ` Slide${result.unexpected.length > 1 ? 's' : ''} ${result.unexpected.join(', ')} changed without a comment. Check ${result.unexpected.length > 1 ? 'them' : 'it'}.`}
                    {!result.unexpected.length && result.changed.length > 0 && ' Every other slide is unchanged.'}
                  </p>
                  {result.newErrors.length > 0 && <p className="result-errors">New errors: {result.newErrors.join(' · ')}</p>}
                  <p>{result.summary}</p>
                  <div className="row">
                    {parentOfResult && (
                      <button className="btn small" onClick={() => setViewId(showingBefore ? null : parentOfResult.id)}>
                        {showingBefore ? `Show after (v${result.seq})` : `Show before (v${result.parentSeq})`}
                      </button>
                    )}
                    {parentOfResult && <button className="btn small" onClick={() => void restore(parentOfResult)}>Undo</button>}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'versions' && (
          <div className="panel-body">
            <ol className="versions">
              {snapshots.map((s) => (
                <li key={s.id} className={'version' + (s.id === viewed?.id ? ' viewing' : '')}>
                  <div className="version-head">
                    <span className="film-no">v{s.seq}</span>
                    <b>{s.label}</b>
                  </div>
                  <div className="version-meta">
                    {ago(s.createdAt)}
                    {s.id === head?.id && ' · latest'}
                    {s.changedSlides && s.changedSlides.length > 0 && ` · slides ${s.changedSlides.join(', ')}`}
                    {s.probe && s.probe.errors.length > 0 && ` · ${s.probe.errors.length} error${s.probe.errors.length > 1 ? 's' : ''}`}
                    {s.commitSha && ` · saved ${s.commitSha.slice(0, 7)}`}
                  </div>
                  <div className="row">
                    <button className="btn small" disabled={s.id === viewed?.id} onClick={() => setViewId(s.id === head?.id ? null : s.id)}>View</button>
                    {s.id !== head?.id && <button className="btn small" disabled={busy} onClick={() => void restore(s)}>Restore</button>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>

      {dialog === 'settings' && (
        <SettingsDialog
          settings={settings}
          onClose={() => setDialog(null)}
          onSave={(next) => { saveSettings(next); setSettings(next); setDialog(null); }}
        />
      )}
      {dialog === 'save' && project && head && (
        <SaveDialog
          project={project} head={head} snapshots={snapshots} token={settings.githubToken}
          onClose={() => setDialog(null)}
          onSaved={async (sha) => { await updateSnapshot({ ...head, commitSha: sha }); await refresh(); }}
        />
      )}
    </div>
  );
}
