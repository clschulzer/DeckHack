# Templates

A template is a folder in this directory. Add a folder, and it shows up on the start page and in the start wizard. Nothing else has to be registered.

```
templates/
  my-template/
    index.html      required: the deck
    deckhack.json   required: name, description, how slides are found
    deck.css        optional: any further text files (CSS, JS, SVG)
```

The folder name is the template's id. Use lower case and hyphens. It also works as a link into the running app: `http://localhost:4173/?template=my-template`.

## deckhack.json

```json
{
  "name": "Three-minute pitch",
  "description": "One sentence shown on the start page.",
  "author": "Your name or team",
  "colors": ["#101418", "#f2f4f1", "#5ee0c0"],
  "entry": "index.html",
  "slideSelector": "section.slide"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Shown on the start page. |
| `description` | yes | One sentence: how many slides, for what, what it looks like. |
| `author` | yes | Who made it. |
| `colors` | no | Two to four hex colours (background, text, accent) shown as swatches. |
| `entry` | yes | The HTML file to open. |
| `slideSelector` | yes | CSS selector that matches one element per slide. |

## What the HTML must provide

The start wizard keeps everything in your `index.html` and replaces only what is inside `<main>` with the slides it plans. So:

1. All slides are direct children of one `<main>` element. Navigation, counters and scripts live outside it.
2. Your CSS styles these elements, because the wizard writes them:

| Markup | Used for |
| --- | --- |
| `<section class="slide" data-title="…">` | One slide. Also gets the class `hook`, `demo` or `ask` on those slides. |
| `<p class="eyebrow tag">` | Small label above the headline. |
| `<h1>`, `<h2>` | Headline. `<h1>` only on the first slide. |
| `<em>` inside a headline | The highlighted number. |
| `<p class="lede">` | One supporting sentence. |
| `<ul class="points"><li>` with optional `<b>` | Up to three points. |
| `<ol class="steps"><li><b>…</b><span>…</span></li>` | How it works, three steps. |
| `<div class="team"><div><b>…</b><span>…</span></div>` | Team members. |
| `<div class="screen"><div class="bar"><i></i><i></i><i></i></div><p>…</p></div>` | Placeholder frame for a demo. |

3. Your script must work with any number of slides between 4 and 12. Do not hard-code a slide count.
4. A slide fits a 16:9 stage of 1280 × 720 and scales with the viewport. Use `vw`/`vh` or `clamp()` for sizes.

`three-minute-pitch/` is the reference: copy it and change the look. The five styled templates (`midnight-terminal`, `swiss-minimal`, `confetti-pop`, `boardroom`, `blueprint-robotics`) share one `deck.js`, which also sets `<html data-slide="hook|demo|ask">` so the fixed footer can change colour per slide, and `data-motion="off"` on `<html>` turns their animations off.

## Rules

- Text files only (HTML, CSS, JS, inline SVG). Templates are bundled as text when the app is built.
- No external requests: no CDN, no web fonts, no remote images. A template has to work offline at a venue with bad Wi-Fi, and the app's Content-Security-Policy blocks other servers anyway.
- Invented content only. No real names, no real personal data.
- Respect `prefers-reduced-motion` if you animate, and make sure content is visible when the animation ends.
- Text needs WCAG AA contrast (4.5:1, large text 3:1), also in a fixed footer over every slide colour.

## Check your template

```bash
npm test                 # "templates" checks every folder here against these rules
npm run eval:templates   # real browser: keys, overflow, contrast, motion, offline (needs Chromium)
npm run dev              # open the app and click through the wizard with your template
```
