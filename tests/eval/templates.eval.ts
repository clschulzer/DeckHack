/* Browser evals for every template (see templates/README.md for the contract).
   Run:  npm run eval:templates      Screenshots land in tests/eval/out/<template>/.

   For each template, as shipped and as filled by the start wizard at every pitch length, at several
   screen sizes, a real Chromium checks what a jury would notice: the script finds and moves through
   every slide, nothing overflows the slide or runs under the footer, text has enough contrast,
   animations end with everything visible, and the deck makes no request to another server. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { listTemplates, type Template } from '../../src/sources/templates';
import { findEntry } from '../../src/core/bundle';
import { buildDeckFromBrief, EXAMPLE_BRIEF, LENGTHS } from '../../src/sources/wizard';
import type { DeckFiles } from '../../src/core/types';

const ORIGIN = 'http://deck.test';
const VIEWPORTS = [
  { width: 1280, height: 720 },   // the 16:9 stage from the contract
  { width: 1920, height: 1080 },  // venue projector
  { width: 1366, height: 768 },   // common laptop
  { width: 1024, height: 768 },   // 4:3 projector
];
const OUT = 'tests/eval/out'; // relative to the repo root, where npm runs the evals

interface SlideReport { index: number; title: string; overflow: string[]; underFooter: string[]; lowContrast: string[]; tinyText: string[] }

let browser: Browser;
beforeAll(async () => {
  /* CI installs the matching browser. Cloud sessions ship one Chromium at a fixed path instead. */
  browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
});
afterAll(async () => { await browser?.close(); });

/** Serves the deck's files from memory on a fake origin and records every request that leaves it. */
async function openDeck(files: DeckFiles, viewport: { width: number; height: number }, opts: { motion?: boolean; reducedMotion?: boolean } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const external: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) { external.push(url.href); return route.abort(); }
    const file = files[decodeURIComponent(url.pathname.slice(1))];
    if (!file || file.kind !== 'text') return route.fulfill({ status: 404, body: '' });
    const type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    let body = file.text;
    if (opts.motion === false && type === 'text/html') body = body.replace(/<html\b/i, '<html data-motion="off"');
    return route.fulfill({ status: 200, contentType: type, body });
  });
  await page.goto(`${ORIGIN}/${findEntry(files)}`);
  await page.waitForLoadState('load');
  return { page, context, external, errors };
}

/** Layout and contrast checks for the slide that is currently on screen. Runs inside the page. */
function inspectCurrentSlide(page: Page, selector: string, index: number): Promise<SlideReport> {
  return page.evaluate(({ selector, index }) => {
    const slide = document.querySelectorAll(selector)[index] as HTMLElement;
    const box = slide.getBoundingClientRect();
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    /* The colour behind an element: blend solid backgrounds from the element up to the root. */
    const backdrop = (el: Element, over: Element | null): number[] => {
      const layers: number[][] = [];
      let opaque = false;
      for (let e: Element | null = el; e && !(over && e === document.body); e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) { layers.push(c); if (c[3] >= 1) { opaque = true; break; } }
      }
      if (!opaque && over) for (let e: Element | null = over; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
      }
      let out = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse()) out = [r! * a! + out[0]! * (1 - a!), g! * a! + out[1]! * (1 - a!), b! * a! + out[2]! * (1 - a!)];
      return out;
    };
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const footer = Array.from(document.querySelectorAll('body *')).find((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && !slide.contains(el) && el.getBoundingClientRect().height > 0 && visible(el);
    });
    const footerTop = footer ? footer.getBoundingClientRect().top : Infinity;

    const report = { index, title: slide.getAttribute('data-title') ?? '', overflow: [] as string[], underFooter: [] as string[], lowContrast: [] as string[], tinyText: [] as string[] };
    /* Text in the fixed footer floats over the slide, so its contrast is checked against this slide too. */
    const footerText = footer ? Array.from(footer.querySelectorAll('*')).concat(footer) : [];
    for (const el of Array.from(slide.querySelectorAll('*')).concat(footerText)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
      const inFooter = footerText.includes(el);
      if (inFooter) { /* only contrast and size below */ }
      else if (r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1 || r.top < box.top - 1) report.overflow.push(name(el));
      else if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible' && hasText) report.overflow.push(name(el) + ' (text wider than box)');
      if (!inFooter && hasText && r.bottom > footerTop + 1 && r.top < footerTop + 40) report.underFooter.push(name(el));
      if (!hasText) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      if (size < 10) report.tinyText.push(`${name(el)} ${size}px`);
      const fg = parse(cs.color);
      const bg = backdrop(el, inFooter ? slide : null);
      const fgMixed = [fg[0] * fg[3] + bg[0]! * (1 - fg[3]), fg[1] * fg[3] + bg[1]! * (1 - fg[3]), fg[2] * fg[3] + bg[2]! * (1 - fg[3])];
      const [hi, lo] = [lum(fgMixed), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi! + 0.05) / (lo! + 0.05);
      const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) report.lowContrast.push(`${name(el)} ${ratio.toFixed(2)}:1`);
    }
    return report;
  }, { selector, index });
}

const currentIndex = (page: Page, selector: string) => page.evaluate((sel) => {
  const slides = Array.from(document.querySelectorAll(sel));
  let best = 0, bestArea = -1;
  slides.forEach((s, i) => {
    const r = s.getBoundingClientRect();
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (h > bestArea) { bestArea = h; best = i; }
  });
  return best;
}, selector);

function variants(t: Template): { name: string; files: DeckFiles }[] {
  return [
    { name: 'as shipped', files: t.files },
    ...LENGTHS.map((l) => ({ name: `wizard ${l.label}`, files: buildDeckFromBrief(t.files, { ...EXAMPLE_BRIEF, minutes: l.minutes }).files })),
  ];
}

const templates = listTemplates();
const selectorOf = (t: Template) => (JSON.parse((t.files['deckhack.json'] as { text: string }).text) as { slideSelector: string }).slideSelector;

for (const t of templates) {
  describe(`template ${t.id}`, () => {
    const selector = selectorOf(t);

    it('runs, moves through every slide with the keyboard, and stays offline', async () => {
      for (const v of variants(t)) {
        const { page, context, external, errors } = await openDeck(v.files, VIEWPORTS[0]!, { motion: false });
        const total = await page.locator(selector).count();
        for (let i = 1; i < total; i++) {
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => currentIndex(page, selector), { message: `${v.name}: ArrowRight to slide ${i + 1}`, timeout: 2000 }).toBe(i);
        }
        for (let i = total - 2; i >= 0; i--) {
          await page.keyboard.press('ArrowLeft');
          await expect.poll(() => currentIndex(page, selector), { message: `${v.name}: ArrowLeft to slide ${i + 1}`, timeout: 2000 }).toBe(i);
        }
        expect(errors, `${v.name}: script errors`).toEqual([]);
        expect(external, `${v.name}: requests to other servers`).toEqual([]);
        await context.close();
      }
    });

    it('fits every slide at every screen size, with readable contrast', async () => {
      const problems: string[] = [];
      for (const v of variants(t)) {
        for (const vp of VIEWPORTS) {
          const { page, context } = await openDeck(v.files, vp, { motion: false });
          const total = await page.locator(selector).count();
          for (let i = 0; i < total; i++) {
            await page.locator(selector).nth(i).evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
            await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))); // let scroll handlers run
            const r = await inspectCurrentSlide(page, selector, i);
            const where = `${v.name} @${vp.width}x${vp.height} slide ${i + 1} (${r.title})`;
            for (const [kind, list] of [['overflows', r.overflow], ['runs under the footer', r.underFooter], ['low contrast', r.lowContrast], ['text under 10px', r.tinyText]] as const) {
              for (const what of list) problems.push(`${where}: ${kind}: ${what}`);
            }
          }
          await context.close();
        }
      }
      expect(problems).toEqual([]);
    });

    it('ends its entrance animation with everything visible, and shows everything at once with reduced motion', async () => {
      for (const reducedMotion of [false, true]) {
        const { page, context } = await openDeck(t.files, VIEWPORTS[0]!, { reducedMotion });
        if (!reducedMotion) await page.waitForTimeout(1600);
        const hidden = await page.evaluate((sel) => {
          const slide = document.querySelector(sel)!;
          return Array.from(slide.querySelectorAll('*')).filter((el) => {
            const cs = getComputedStyle(el);
            return (el.textContent ?? '').trim() && cs.display !== 'none' && +cs.opacity < 0.99;
          }).map((el) => el.tagName + ' ' + (el.textContent ?? '').trim().slice(0, 30));
        }, selector);
        expect(hidden, reducedMotion ? 'hidden with reduced motion' : 'still hidden after the animation').toEqual([]);
        await context.close();
      }
    });

    it('writes screenshots of every slide', async () => {
      const shots: string[] = [];
      const { page, context } = await openDeck(t.files, VIEWPORTS[0]!, { motion: false });
      const total = await page.locator(selector).count();
      for (let i = 0; i < total; i++) {
        await page.locator(selector).nth(i).evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.waitForTimeout(80); // the deck script marks the slide active on scroll
        shots.push((await page.screenshot({ path: `${OUT}/${t.id}/${String(i + 1).padStart(2, '0')}.png` })).length > 0 ? 'ok' : 'empty');
      }
      await context.close();
      expect(shots).toEqual(Array(total).fill('ok'));
    });
  });
}
