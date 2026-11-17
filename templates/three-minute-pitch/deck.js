/* Navigation for the deck: arrow keys, space, Home and End. No dependencies. */
(() => {
  const deck = document.querySelector('.deck');
  const slides = [...document.querySelectorAll('.slide')];
  const counter = document.getElementById('counter');
  const progress = document.getElementById('progress');
  let current = 0;

  const show = (i) => {
    current = Math.max(0, Math.min(slides.length - 1, i));
    slides[current].scrollIntoView({ behavior: 'instant', block: 'start' });
    update();
  };
  const update = () => {
    slides.forEach((s, i) => s.classList.toggle('active', i === current));
    counter.textContent = `${current + 1} / ${slides.length}`;
    progress.style.width = `${((current + 1) / slides.length) * 100}%`;
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
