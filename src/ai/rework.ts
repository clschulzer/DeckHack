import { changedPaths } from '../core/edits';
import { probeDeck } from '../core/preview';
import type { DeckFiles, ProbeResult } from '../core/types';
import { findEntry } from '../core/bundle';
import { demoProvider } from './demo';
import type { Provider, ReworkRequest } from './provider';

/** The Claude SDK is loaded only when it is first used, which keeps the first page load small. */
const claudeProvider: Provider = {
  id: 'claude',
  label: 'Claude (your API key)',
  needsKey: true,
  rework: async (request) => (await import('./claude')).claudeProvider.rework(request),
};

export const PROVIDERS: Record<string, Provider> = { demo: demoProvider, claude: claudeProvider };

export interface ReworkOutcome {
  files: DeckFiles;
  probe: ProbeResult;
  summary: string;
  changedFiles: string[];
  /** Errors the change introduced and one repair attempt could not remove. */
  newErrors: string[];
}

/**
 * One review round: let the provider edit the files, then render the result in a hidden preview,
 * walk every slide and compare with the previous version. When the change introduced load errors,
 * the provider gets one chance to repair them. Returns null when nothing changed.
 */
export async function runRework(provider: Provider, request: ReworkRequest): Promise<ReworkOutcome | null> {
  const baseErrors = new Set(request.probe?.errors ?? []);
  let current = request;
  let result = await provider.rework(current);
  let files = result.files;
  if (!changedPaths(request.files, files).length) return null;

  request.onEvent({ type: 'status', text: 'Checking every slide' });
  let probe = await probeDeck(files, findEntry(files) ?? request.entry);
  let newErrors = probe.errors.filter((e) => !baseErrors.has(e));

  if (newErrors.length && provider.needsKey) {
    request.onEvent({ type: 'status', text: `The change caused ${newErrors.length} error(s). Asking for a fix` });
    current = { ...request, files, repair: newErrors };
    result = await provider.rework(current);
    files = result.files;
    probe = await probeDeck(files, findEntry(files) ?? request.entry);
    newErrors = probe.errors.filter((e) => !baseErrors.has(e));
  }

  return { files, probe, summary: result.summary, changedFiles: changedPaths(request.files, files), newErrors };
}
