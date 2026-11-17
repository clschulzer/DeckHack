/**
 * Settings live in this browser only. Keys are never sent anywhere except to the provider they belong to.
 * By default keys are kept in sessionStorage, which ends with the tab. Only when the user opts in
 * ("remember") are they also written to localStorage, where they outlive the tab and can be read by
 * any other page served from the same web address.
 */
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

/**
 * True in the build that GitHub Pages serves (`vite build --mode pages`). That build is a demo only:
 * it never takes, stores or uses a key. To work with your own key, run DeckHack locally.
 */
export const HOSTED_DEMO = import.meta.env.MODE === 'pages';

/** What the hosted demo is allowed to keep: no provider with a key, no keys. */
export const demoOnly = (settings: Settings): Settings => ({ ...settings, provider: 'demo', apiKey: '', githubToken: '', remember: false });

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

export function loadSettings(hosted = HOSTED_DEMO): Settings {
  const settings = { ...DEFAULTS, ...read(storageOf('localStorage')), ...read(storageOf('sessionStorage')) };
  return hosted ? demoOnly(settings) : settings;
}

export function saveSettings(input: Settings, hosted = HOSTED_DEMO): void {
  const settings = hosted ? demoOnly(input) : input;
  try {
    storageOf('sessionStorage')?.setItem(KEY, JSON.stringify(settings));
    storageOf('localStorage')?.setItem(KEY, JSON.stringify(settings.remember ? settings : { ...settings, apiKey: '', githubToken: '' }));
  } catch {
    /* storage may be unavailable; settings then last for this page view */
  }
}

/** True when a key is stored beyond this tab session. */
export function hasRememberedKeys(): boolean {
  const stored = read(storageOf('localStorage'));
  return !!(stored.apiKey || stored.githubToken);
}

/** Removes every stored key, from this tab session and from this device, and turns "remember" off. */
export function forgetKeys(): Settings {
  const next: Settings = { ...loadSettings(), apiKey: '', githubToken: '', remember: false };
  saveSettings(next);
  return next;
}
