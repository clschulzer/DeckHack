/* Deck navigation: arrow keys, space, Enter, Page keys, Home and End. No dependencies.
   The current slide gets the class "active", which starts its entrance animation.
   <html data-slide="..."> carries the current slide's extra classes (hook, demo, ask), so CSS can
   restyle the fixed footer per slide. Set data-motion="off" on <html> to switch animations off. */
(() => {
  document.documentElement.classList.add('js');
  const deck = document.querySelector('.deck');
  const slides = [...document.querySelectorAll('.slide')];
  const counter = document.getElementById('counter');
  const progress = document.getElementById('progress');
  const pad = (n) => String(n).padStart(2, '0');
  let current = 0;

  const update = () => {
    slides.forEach((s, i) => s.classList.toggle('active', i === current));
    document.documentElement.dataset.slide = [...slides[current].classList].filter((c) => c !== 'slide' && c !== 'active').join(' ');
    if (counter) counter.textContent = `${pad(current + 1)} / ${pad(slides.length)}`;
    if (progress) progress.style.width = `${((current + 1) / slides.length) * 100}%`;
  };
  const show = (i) => {
    current = Math.max(0, Math.min(slides.length - 1, i));
    slides[current].scrollIntoView({ behavior: 'instant', block: 'start' });
    update();
  };

  addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); show(current + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); show(current - 1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
  });
  deck.addEventListener('scroll', () => {
    const i = Math.round(deck.scrollTop / deck.clientHeight);
    if (i !== current) { current = i; update(); }
  });
  update();
})();
