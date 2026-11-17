/** Settings live in this browser only. Keys are never sent anywhere except to the provider they belong to. */
export interface Settings {
  provider: 'demo' | 'claude';
  model: string;
  apiKey: string;
  githubToken: string;
  /** When false, keys are kept for this tab session only. */
  remember: boolean;
}

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Default. Best balance for slide rework.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Faster and cheaper for small text fixes.' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', hint: 'Most capable, for whole-deck restructuring.' },
] as const;

const KEY = 'deckhack.settings';
const DEFAULTS: Settings = { provider: 'demo', model: 'claude-opus-5-5', apiKey: '', githubToken: '', remember: false };

function read(storage: Storage | undefined): Partial<Settings> {
  try {
    return JSON.parse(storage?.getItem(KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}

const storageOf = (name: 'localStorage' | 'sessionStorage'): Storage | undefined => {
  try {
    return window[name];
  } catch {
    return undefined;
  }
};

export function loadSettings(): Settings {
  return { ...DEFAULTS, ...read(storageOf('localStorage')), ...read(storageOf('sessionStorage')) };
}

export function saveSettings(settings: Settings): void {
  try {
    storageOf('sessionStorage')?.setItem(KEY, JSON.stringify(settings));
    storageOf('localStorage')?.setItem(KEY, JSON.stringify(settings.remember ? settings : { ...settings, apiKey: '', githubToken: '' }));
  } catch {
    /* storage may be unavailable; settings then last for this page view */
  }
}
