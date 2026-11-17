import { useMemo, useState } from 'react';
import { PROVIDERS } from '../ai/rework';
import { HOSTED_DEMO, MODELS, type Settings } from '../core/settings';
import type { DeckFiles } from '../core/types';
import type { Template } from '../sources/templates';
import {
  BEAT_TITLES, buildDeckFromBrief, CRITERIA, EMPTY_BRIEF, EXAMPLE_BRIEF, LENGTHS, planBeats, secondsPerSlide, STORYLINES, type Brief,
} from '../sources/wizard';
import { Dialog, KeyAdvice, RememberWarning, RunLocally } from './Dialogs';

export interface WizardResult {
  name: string;
  files: DeckFiles;
  brief: Brief;
  settings: Settings;
  /** Add a whole-deck comment that asks the AI for a first draft. */
  firstDraft: boolean;
}

const STEPS = ['Length', 'Jury', 'Storyline', 'Content', 'AI'] as const;

const FIELDS: { key: keyof Brief; label: string; hint?: string; rows?: number }[] = [
  { key: 'project', label: 'Project name' },
  { key: 'team', label: 'Team' },
  { key: 'event', label: 'Event and challenge' },
  { key: 'persona', label: 'Who has the problem?', hint: 'One person, as concrete as you can.' },
  { key: 'problem', label: 'The problem in one sentence' },
  { key: 'number', label: 'The number that proves it', hint: 'Appears highlighted. Leave empty if you have none yet.' },
  { key: 'cause', label: 'Why does it happen?' },
  { key: 'solution', label: 'What you built, in one sentence' },
  { key: 'how', label: 'How it works', hint: 'One step per line, as “Label: what happens”.', rows: 3 },
  { key: 'members', label: 'Team members', hint: 'One per line, as “Name, role”.', rows: 3 },
  { key: 'ask', label: 'What you ask the jury for' },
  { key: 'contact', label: 'Contact' },
];

export function Wizard({ template, settings, onCreate, onPlain, onClose }: {
  template: Template; settings: Settings;
  onCreate: (result: WizardResult) => void; onPlain: () => void; onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState<Brief>(EXAMPLE_BRIEF);
  const [ai, setAi] = useState<Settings>(settings);
  const [firstDraft, setFirstDraft] = useState(true);
  const [error, setError] = useState('');

  const set = <K extends keyof Brief>(key: K, value: Brief[K]) => setBrief((b) => ({ ...b, [key]: value }));
  const beats = useMemo(() => planBeats(brief), [brief]);
  const perSlide = secondsPerSlide(brief.minutes, beats.length);
  const isExample = FIELDS.every((f) => brief[f.key] === EXAMPLE_BRIEF[f.key]);
  const usesClaude = ai.provider === 'claude';
  const last = step === STEPS.length - 1;

  const create = () => {
    try {
      const { files } = buildDeckFromBrief(template.files, brief);
      onCreate({ name: brief.project.trim() || template.name, files, brief, settings: ai, firstDraft: usesClaude && !!ai.apiKey && firstDraft });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const plan = (
    <div className="wiz-plan" aria-label="Slide plan">
      <span className="wiz-plan-head"><b>{beats.length}</b> slides · about <b>{perSlide} s</b> each</span>
      <ol>{beats.map((b, i) => <li key={b}><span className="film-no">{String(i + 1).padStart(2, '0')}</span>{BEAT_TITLES[b]}</li>)}</ol>
    </div>
  );

  return (
    <Dialog title={`New deck from “${template.name}”`} onClose={onClose} wide>
      <ol className="wiz-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <button type="button" onClick={() => setStep(i)}><span>{i + 1}</span>{s}</button>
          </li>
        ))}
      </ol>

      <form className="wiz" onSubmit={(e) => { e.preventDefault(); if (last) create(); else setStep(step + 1); }}>
        {step === 0 && (
          <div className="wiz-body">
            <h3>How long may you talk?</h3>
            <div className="wiz-options" role="radiogroup" aria-label="Pitch length">
              {LENGTHS.map((l) => (
                <label key={l.minutes} className={'wiz-option' + (brief.minutes === l.minutes ? ' sel' : '')}>
                  <input type="radio" name="minutes" checked={brief.minutes === l.minutes} onChange={() => set('minutes', l.minutes)} />
                  <b>{l.label}</b><span>{l.slides} slides. {l.hint}</span>
                </label>
              ))}
            </div>
            <p className="hint">A slide the jury can take in needs twenty to thirty seconds. The length decides how many slides you get, not how much you squeeze onto each.</p>
            {plan}
          </div>
        )}

        {step === 1 && (
          <div className="wiz-body">
            <h3>What does the jury score?</h3>
            <div className="wiz-options two">
              {CRITERIA.map((c) => (
                <label key={c.id} className={'wiz-option' + (brief.criteria.includes(c.id) ? ' sel' : '')}>
                  <input
                    id={`crit-${c.id}`} type="checkbox" checked={brief.criteria.includes(c.id)}
                    onChange={(e) => set('criteria', e.target.checked ? [...brief.criteria, c.id] : brief.criteria.filter((x) => x !== c.id))}
                  />
                  <b>{c.label}</b><span>{c.hint}</span>
                </label>
              ))}
            </div>
            <label htmlFor="wiz-notes">Criteria from the event page (optional)</label>
            <textarea id="wiz-notes" rows={2} placeholder="Paste the judging criteria here. The AI reads them in every round." value={brief.criteriaNotes} onChange={(e) => set('criteriaNotes', e.target.value)} />
            <p className="hint">Hook, solution and ask are always in. Each criterion you tick gets its slide next, then the rest as far as the time allows.</p>
            {plan}
          </div>
        )}

        {step === 2 && (
          <div className="wiz-body">
            <h3>How do you tell it?</h3>
            <div className="wiz-options two" role="radiogroup" aria-label="Storyline">
              {STORYLINES.map((s) => (
                <label key={s.id} className={'wiz-option' + (brief.storyline === s.id ? ' sel' : '')}>
                  <input type="radio" name="storyline" checked={brief.storyline === s.id} onChange={() => set('storyline', s.id)} />
                  <b>{s.name}</b><span>{s.description}</span>
                </label>
              ))}
            </div>
            {plan}
          </div>
        )}

        {step === 3 && (
          <div className="wiz-body">
            <div className="row">
              <h3>What is the pitch about?</h3>
              <div className="spacer" />
              {isExample
                ? <button type="button" className="btn small" onClick={() => setBrief((b) => ({ ...EMPTY_BRIEF, minutes: b.minutes, criteria: b.criteria, criteriaNotes: b.criteriaNotes, storyline: b.storyline }))}>Clear example data</button>
                : <button type="button" className="btn small" onClick={() => setBrief((b) => ({ ...EXAMPLE_BRIEF, minutes: b.minutes, criteria: b.criteria, criteriaNotes: b.criteriaNotes, storyline: b.storyline }))}>Fill with example data</button>}
            </div>
            {isExample && <p className="notice">These fields hold example data so you can click through. Replace them with your own or clear them.</p>}
            <div className="wiz-fields">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.rows ? 'full' : ''}>
                  <label htmlFor={`wiz-${f.key}`}>{f.label}</label>
                  {f.rows
                    ? <textarea id={`wiz-${f.key}`} rows={f.rows} value={brief[f.key] as string} onChange={(e) => set(f.key, e.target.value as never)} />
                    : <input id={`wiz-${f.key}`} value={brief[f.key] as string} onChange={(e) => set(f.key, e.target.value as never)} />}
                  {f.hint && <p className="hint">{f.hint}</p>}
                </div>
              ))}
            </div>
            <p className="hint">Anything you leave empty becomes a visible [TODO] on the slide. Nothing is made up.</p>
          </div>
        )}

        {step === 4 && (
          <div className="wiz-body">
            <h3>Who applies your comments later?</h3>
            <div className="wiz-options two" role="radiogroup" aria-label="AI provider">
              <label className={'wiz-option' + (!usesClaude ? ' sel' : '')}>
                <input id="wiz-provider-demo" type="radio" name="wiz-provider" checked={!usesClaude} onChange={() => setAi((a) => ({ ...a, provider: 'demo' }))} />
                <b>{PROVIDERS.demo!.label}</b><span>Nothing to set up. Good for clicking through. It can only do <code>replace "old" with "new"</code>.</span>
              </label>
              {!HOSTED_DEMO && <label className={'wiz-option' + (usesClaude ? ' sel' : '')}>
                <input id="wiz-provider-claude" type="radio" name="wiz-provider" checked={usesClaude} onChange={() => setAi((a) => ({ ...a, provider: 'claude' }))} />
                <b>{PROVIDERS.claude!.label}</b><span>Real rework from plain comments. You pay Anthropic for what you use.</span>
              </label>}
            </div>
            {HOSTED_DEMO && <RunLocally />}
            {usesClaude && (
              <div className="form">
                <label htmlFor="wiz-key">Claude API key</label>
                <input id="wiz-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={ai.apiKey} onChange={(e) => setAi((a) => ({ ...a, apiKey: e.target.value.trim() }))} />
                <p className="hint">Sent only to api.anthropic.com, straight from this browser. DeckHack has no server. Kept until you close the tab.</p>
                <KeyAdvice />
                <label htmlFor="wiz-model">Model</label>
                <select id="wiz-model" value={ai.model} onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))}>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.hint}</option>)}
                </select>
                <label className="check"><input id="wiz-remember" type="checkbox" checked={ai.remember} onChange={(e) => setAi((a) => ({ ...a, remember: e.target.checked }))} /> Remember the key on this device</label>
                {ai.remember && <RememberWarning />}
                <label className="check"><input id="wiz-first-draft" type="checkbox" checked={firstDraft} disabled={!ai.apiKey} onChange={(e) => setFirstDraft(e.target.checked)} /> Add a comment that asks Claude for a first draft</label>
                <p className="hint">The comment waits in the review panel. Nothing is sent until you press “Apply round”.</p>
              </div>
            )}
            {!HOSTED_DEMO && <p className="hint">You can change this any time under Settings, on the start page and in the editor.</p>}
            {plan}
          </div>
        )}

        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="row wiz-foot">
          {step === 0 && <button type="button" className="link" onClick={onPlain}>Skip the wizard and open the template as it is</button>}
          <div className="spacer" />
          {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          {!last && <button type="button" className="btn" onClick={create}>Create deck now</button>}
          <button className="btn primary">{last ? 'Create deck' : 'Next'}</button>
        </div>
      </form>
    </Dialog>
  );
}
