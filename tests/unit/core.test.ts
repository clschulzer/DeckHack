import { describe, expect, it } from 'vitest';
import { applyEdit, changedPaths } from '../../src/core/edits';
import { resolveRef, safeDeckPath } from '../../src/core/paths';
import { bundleDeck, findEntry } from '../../src/core/bundle';
import { changedSlides } from '../../src/core/preview';
import { addSnapshot, createProject, listSnapshots, readFiles } from '../../src/core/store';
import { parseGithubUrl } from '../../src/sources/github';
import { stripCommonRoot } from '../../src/sources/upload';
import { demoProvider } from '../../src/ai/demo';
import type { DeckFiles, ProbeResult } from '../../src/core/types';

const deck = (): DeckFiles => ({
  'index.html': { kind: 'text', text: '<html><head><link rel="stylesheet" href="css/deck.css"><script src="deck.js"></script></head><body><section><h1>One</h1></section><section><h1>Two</h1></section><img src="img/logo.png"></body></html>' },
  'css/deck.css': { kind: 'text', text: 'body{background:url(../img/logo.png)} h1{color:red}' },
  'deck.js': { kind: 'text', text: 'const a = "</script>";' },
  'img/logo.png': { kind: 'binary', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
});

describe('paths', () => {
  it('resolves references relative to the file that contains them', () => {
    expect(resolveRef('css', '../img/logo.png')).toBe('img/logo.png');
    expect(resolveRef('', './a/b.css?v=2#x')).toBe('a/b.css');
  });
  it('treats external references and escapes from the deck as not local', () => {
    expect(resolveRef('', 'https://example.org/a.css')).toBeNull();
    expect(resolveRef('', 'data:image/png;base64,AA')).toBeNull();
    expect(resolveRef('', '../outside.css')).toBeNull();
  });
  it('rejects unsafe paths from the model', () => {
    expect(safeDeckPath('index.html')).toBe('index.html');
    expect(safeDeckPath('../secret')).toBeNull();
    expect(safeDeckPath('/etc/passwd')).toBeNull();
    expect(safeDeckPath('a/../../b')).toBeNull();
    expect(safeDeckPath(42)).toBeNull();
  });
});

describe('edits', () => {
  it('replaces text that occurs exactly once', () => {
    const files = deck();
    expect(applyEdit(files, { op: 'replace', path: 'index.html', old: '<h1>One</h1>', new: '<h1>Uno</h1>' }).ok).toBe(true);
    expect((files['index.html'] as { text: string }).text).toContain('Uno');
  });
  it('refuses ambiguous, missing and out-of-deck edits and leaves files untouched', () => {
    const files = deck();
    const before = JSON.stringify(files['index.html']);
    expect(applyEdit(files, { op: 'replace', path: 'index.html', old: '<h1>', new: '<h2>' }).ok).toBe(false);
    expect(applyEdit(files, { op: 'replace', path: 'index.html', old: 'nope', new: 'x' }).ok).toBe(false);
    expect(applyEdit(files, { op: 'write', path: '../x.html', content: 'x' }).ok).toBe(false);
    expect(applyEdit(files, { op: 'write', path: 'img/logo.png', content: 'x' }).ok).toBe(false);
    expect(JSON.stringify(files['index.html'])).toBe(before);
  });
  it('lists changed paths', () => {
    const a = deck(), b = deck();
    applyEdit(b, { op: 'write', path: 'new.css', content: 'a{}' });
    applyEdit(b, { op: 'delete', path: 'deck.js' });
    expect(changedPaths(a, b)).toEqual(['deck.js', 'new.css']);
  });
});

describe('bundle', () => {
  it('finds the entry file', () => {
    expect(findEntry(deck())).toBe('index.html');
    expect(findEntry({ 'a/b/index.html': { kind: 'text', text: '' }, 'deck.html': { kind: 'text', text: '' } })).toBe('deck.html');
    expect(findEntry({ 'x.css': { kind: 'text', text: '' } })).toBeNull();
  });
  it('inlines local styles and scripts, maps assets and injects the bridge first', () => {
    const { html } = bundleDeck(deck(), 'index.html', { token: 'tok' });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.head.firstElementChild?.getAttribute('data-pc')).toBe('bridge');
    expect(doc.querySelector('link[rel=stylesheet]')).toBeNull();
    expect(doc.querySelector('style[data-pc-src="css/deck.css"]')?.textContent).toContain('url("data:image/png;base64,AQID")');
    expect(doc.querySelector('script[data-pc-src="deck.js"]')?.hasAttribute('src')).toBe(false);
    expect(html).toContain('"token":"tok"');
    expect(html).toContain('"img/logo.png":"data:image/png;base64,AQID"');
    expect(html).not.toContain('__PC_CONFIG__');
  });
});

describe('slide comparison', () => {
  const probe = (fingerprints: string[]): ProbeResult => ({ adapter: 'sections', count: fingerprints.length, titles: [], fingerprints, errors: [] });
  it('reports the slides whose fingerprint changed', () => {
    expect(changedSlides(probe(['a', 'b', 'c']), probe(['a', 'x', 'c']))).toEqual([2]);
    expect(changedSlides(probe(['a', 'b']), probe(['a', 'b', 'c']))).toEqual([3]);
    expect(changedSlides(undefined, probe(['a']))).toEqual([]);
  });
});

describe('sources', () => {
  it('parses GitHub links', () => {
    expect(parseGithubUrl('https://github.com/o/r')).toEqual({ owner: 'o', repo: 'r', path: '' });
    expect(parseGithubUrl('https://github.com/o/r/tree/main/Presentation/hackathon')).toEqual({ owner: 'o', repo: 'r', ref: 'main', path: 'Presentation/hackathon' });
    expect(parseGithubUrl('https://github.com/o/r/blob/dev/pitch/index.html')).toEqual({ owner: 'o', repo: 'r', ref: 'dev', path: 'pitch/index.html' });
    expect(parseGithubUrl('https://o.github.io/r/Presentation/hackathon/?s=1')).toEqual({ owner: 'o', repo: 'r', path: 'Presentation/hackathon' });
    expect(parseGithubUrl('https://example.org/x')).toBeNull();
    expect(parseGithubUrl('not a link')).toBeNull();
  });
  it('strips a shared top folder from uploads', () => {
    const out = stripCommonRoot({ 'deck/index.html': { kind: 'text', text: '' }, 'deck/css/a.css': { kind: 'text', text: '' } });
    expect(Object.keys(out).sort()).toEqual(['css/a.css', 'index.html']);
  });
});

describe('demo provider', () => {
  it('applies replace "a" with "b" and skips anything else', async () => {
    const events: string[] = [];
    const comment = (text: string) => ({ id: text, projectId: 'p', slide: 1, text, status: 'open' as const, createdAt: 0 });
    const { files } = await demoProvider.rework({
      files: deck(), entry: 'index.html', model: '', apiKey: '',
      comments: [comment('replace "One" with "Eins"'), comment('make it pop')],
      onEvent: (e) => events.push(e.type === 'edit' ? `${e.ok}` : e.type),
    });
    expect((files['index.html'] as { text: string }).text).toContain('<h1>Eins</h1>');
    expect(events).toEqual(['true', 'false']);
  });
});

describe('store', () => {
  it('keeps every version and restores old content', async () => {
    const files = deck();
    const { project, snapshot } = await createProject('Test', { type: 'upload', label: 'test' }, files);
    const next = deck();
    applyEdit(next, { op: 'replace', path: 'index.html', old: '<h1>One</h1>', new: '<h1>Uno</h1>' });
    const v2 = await addSnapshot(project, snapshot, files, next, { kind: 'ai', label: 'Rework: slide 1' });
    expect(v2.seq).toBe(2);
    expect(v2.changedFiles).toEqual(['index.html']);
    expect(v2.files['deck.js']).toEqual(snapshot.files['deck.js']);
    const all = await listSnapshots(project.id);
    expect(all.map((s) => s.seq)).toEqual([2, 1]);
    const v1Files = await readFiles(all[1]!);
    expect((v1Files['index.html'] as { text: string }).text).toContain('<h1>One</h1>');
    expect(Array.from((v1Files['img/logo.png'] as { bytes: Uint8Array }).bytes)).toEqual([1, 2, 3]);
  });
});
