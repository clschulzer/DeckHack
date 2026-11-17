import { bundleDeck } from './bundle';
import type { AdapterKind, DeckFiles, ProbeResult } from './types';

export interface PreviewState {
  ready: boolean;
  adapter: AdapterKind;
  count: number;
  current: number;
  errors: string[];
}

type Listener = (state: PreviewState) => void;

/** An element the user pointed at in the preview. */
export interface Picked { tag: string; text: string; slide: number }

/**
 * One sandboxed preview of a deck. The iframe gets `sandbox="allow-scripts"` and nothing else:
 * its origin is opaque, so deck code (uploaded, linked or written by the AI) cannot read the app's
 * storage, cookies or API key, cannot navigate the app and cannot open windows.
 */
export class Preview {
  readonly iframe: HTMLIFrameElement;
  state: PreviewState = { ready: false, adapter: 'single', count: 1, current: 1, errors: [] };
  warnings: string[] = [];
  private token = '';
  private listeners = new Set<Listener>();
  private probes = new Map<string, (r: ProbeResult) => void>();
  private readyWaiters: Array<() => void> = [];
  /** Called when the user clicks an element while pointing mode is on. */
  onPicked: ((picked: Picked) => void) | null = null;

  constructor(iframe?: HTMLIFrameElement) {
    this.iframe = iframe ?? document.createElement('iframe');
    this.iframe.setAttribute('sandbox', 'allow-scripts');
    this.iframe.setAttribute('referrerpolicy', 'no-referrer');
    window.addEventListener('message', this.onMessage);
  }

  load(files: DeckFiles, entry: string, opts: { frozen?: boolean; startAt?: number } = {}): void {
    this.token = crypto.randomUUID();
    this.state = { ready: false, adapter: 'single', count: 1, current: 1, errors: [] };
    const { html, warnings } = bundleDeck(files, entry, { token: this.token, ...opts });
    this.warnings = warnings;
    this.iframe.srcdoc = html;
    this.emit();
  }

  private onMessage = (e: MessageEvent): void => {
    const m = e.data as { pc?: string; type?: string; [k: string]: unknown } | null;
    if (e.source !== this.iframe.contentWindow || !m || m.pc !== this.token) return;
    if (m.type === 'ready') {
      this.state = { ...this.state, ready: true, adapter: m.adapter as AdapterKind, count: m.count as number, current: m.current as number };
      this.readyWaiters.splice(0).forEach((fn) => fn());
    } else if (m.type === 'pos') {
      this.state = { ...this.state, current: m.current as number, count: m.count as number };
    } else if (m.type === 'error') {
      this.state = { ...this.state, errors: [...this.state.errors, m.text as string] };
    } else if (m.type === 'picked') {
      this.onPicked?.({ tag: String(m.tag), text: String(m.text), slide: Number(m.slide) || 1 });
      return;
    } else if (m.type === 'probe') {
      this.probes.get(m.id as string)?.(m.result as ProbeResult);
      this.probes.delete(m.id as string);
      return;
    } else return;
    this.emit();
  };

  private send(cmd: string, data: Record<string, unknown> = {}): void {
    this.iframe.contentWindow?.postMessage({ pc: this.token, cmd, ...data }, '*');
  }

  go(n: number): void { this.send('go', { n }); }
  key(key: string): void { this.send('key', { key }); }
  freeze(on: boolean): void { this.send('freeze', { on }); }
  /** Pointing mode: the next click in the preview reports the element instead of reaching the deck. */
  pick(on: boolean): void { this.send('pick', { on }); }

  whenReady(timeoutMs = 8000): Promise<void> {
    if (this.state.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The preview did not start. The deck may be blocked in this environment.')), timeoutMs);
      this.readyWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  async probe(timeoutMs = 20000): Promise<ProbeResult> {
    await this.whenReady();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.probes.delete(id); reject(new Error('Checking the deck timed out.')); }, timeoutMs);
      this.probes.set(id, (r) => { clearTimeout(timer); resolve(r); });
      this.send('probe', { id });
    });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void { this.listeners.forEach((fn) => fn(this.state)); }

  dispose(): void {
    window.removeEventListener('message', this.onMessage);
    this.listeners.clear();
  }
}

/**
 * Renders a deck in a hidden frame, walks every slide with animations frozen and returns
 * slide count, titles, fingerprints and console errors. This is the automatic check after every change.
 */
export async function probeDeck(files: DeckFiles, entry: string): Promise<ProbeResult> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const preview = new Preview(iframe);
  try {
    preview.load(files, entry, { frozen: true });
    return await preview.probe();
  } finally {
    preview.dispose();
    iframe.remove();
  }
}

/** 1-based numbers of slides whose fingerprint changed. A changed slide count marks every slide. */
export function changedSlides(before: ProbeResult | undefined, after: ProbeResult): number[] {
  if (!before) return [];
  const max = Math.max(before.count, after.count);
  const out: number[] = [];
  for (let i = 0; i < max; i++) if (before.fingerprints[i] !== after.fingerprints[i]) out.push(i + 1);
  return out;
}
