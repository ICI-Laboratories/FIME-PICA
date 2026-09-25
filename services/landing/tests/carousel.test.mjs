import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { initCarousel } from '../js/carousel.js';

const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function setup({ reducedMotion = false } = {}) {
  const { document, window } = parseHTML(markup);
  const root = document.querySelector('.carousel-section');
  const callbacks = new Map();
  let nextTimer = 0;
  let motionChange;
  const motion = {
    matches: reducedMotion,
    addEventListener(type, callback) {
      assert.equal(type, 'change');
      motionChange = callback;
    },
  };
  initCarousel(root, {
    motion,
    schedule(callback, delay) {
      assert.equal(delay, 5000);
      callbacks.set(++nextTimer, callback);
      return nextTimer;
    },
    cancel(timer) { callbacks.delete(timer); },
  });
  return {
    document,
    root,
    callbacks,
    fire(target, type, detail = 0) {
      const event = new window.Event(type, { bubbles: true });
      Object.defineProperty(event, 'detail', { value: detail });
      target.dispatchEvent(event);
    },
    changeMotion(matches) {
      motion.matches = matches;
      motionChange();
    },
    playback: root.querySelector('#toggle-carousel'),
    previous: root.querySelector('#prev-slide'),
    next: root.querySelector('#next-slide'),
  };
}

function assertActive(env, expectedIndex) {
  const slides = [...env.root.querySelectorAll('.slide')];
  assert.equal(env.root.querySelector('.carousel').style.transform, `translateX(-${expectedIndex * 100}%)`);
  assert.equal(env.root.querySelector('[data-carousel-count]').textContent, `${expectedIndex + 1} de ${slides.length}`);
  for (const [index, slide] of slides.entries()) {
    assert.equal(slide.getAttribute('aria-hidden'), String(index !== expectedIndex));
    assert.equal(slide.hasAttribute('inert'), index !== expectedIndex);
  }
}

test('the actual landing exposes a working skip target and only its first slide without JavaScript', () => {
  const { document } = parseHTML(markup);
  const skip = document.querySelector('body > a.skip-link');
  const main = document.querySelector(skip.getAttribute('href'));
  assert.equal(main.tagName, 'MAIN');
  assert.equal(main.getAttribute('tabindex'), '-1');
  assert.equal(document.querySelector('#fimebot-chat').getAttribute('tabindex'), '-1');
  assert.equal(document.querySelectorAll('.slide:not([aria-hidden="true"])').length, 1);
  assert.equal(document.querySelectorAll('.slide[inert]').length, 7);
  assert.equal(document.querySelector('#toggle-carousel').hidden, true);
});

test('automatic rotation exposes one slide, while next and previous pause and wrap', () => {
  const env = setup();
  assertActive(env, 0);
  assert.equal(env.playback.hidden, false);
  assert.equal(env.callbacks.size, 1);
  assert.equal(env.root.querySelector('.carousel-status').getAttribute('aria-live'), 'off');
  env.callbacks.values().next().value();
  assertActive(env, 1);
  env.next.click();
  assertActive(env, 2);
  assert.equal(env.callbacks.size, 0);
  env.previous.click();
  env.previous.click();
  env.previous.click();
  assertActive(env, 7);
  assert.match(env.root.querySelector('[data-carousel-announcement]').textContent, /8 de 8: Laboratorio de Electrónica/);
  assert.equal(env.root.querySelector('.carousel-status').getAttribute('aria-live'), 'polite');
});

test('keyboard focus stops rotation until the visitor explicitly resumes', () => {
  const env = setup();
  env.fire(env.playback, 'focusin');
  assert.equal(env.callbacks.size, 0);
  assert.equal(env.playback.textContent, 'Reproducir imágenes');
  env.fire(env.playback, 'focusout');
  assert.equal(env.callbacks.size, 0);
  env.playback.click();
  assert.equal(env.callbacks.size, 1);
  env.fire(env.next, 'focusin');
  assert.equal(env.callbacks.size, 0);
});

test('pointer focus does not turn a pause click into an accidental restart', () => {
  const env = setup();
  env.fire(env.playback, 'pointerdown');
  env.fire(env.playback, 'focusin');
  env.fire(env.playback, 'click', 1);
  assert.equal(env.callbacks.size, 0);
  assert.equal(env.playback.textContent, 'Reproducir imágenes');
  env.fire(env.playback, 'pointerdown');
  env.fire(env.playback, 'click', 1);
  assert.equal(env.callbacks.size, 1);
  assert.equal(env.playback.textContent, 'Pausar imágenes');
});

test('reduced motion disables automatic rotation and changes take effect immediately', () => {
  const env = setup({ reducedMotion: true });
  assert.equal(env.callbacks.size, 0);
  env.next.click();
  assertActive(env, 1);
  env.playback.click();
  assert.equal(env.callbacks.size, 1, 'explicit playback remains available');
  env.changeMotion(true);
  assert.equal(env.callbacks.size, 0);
  env.changeMotion(false);
  assert.equal(env.callbacks.size, 0, 'changing preferences must not restart a paused carousel');
});

test('a hidden tab stops scheduling and respects the visitor’s pause on return', () => {
  const env = setup();
  Object.defineProperty(env.document, 'hidden', { value: true, configurable: true });
  env.fire(env.document, 'visibilitychange');
  assert.equal(env.callbacks.size, 0);
  Object.defineProperty(env.document, 'hidden', { value: false, configurable: true });
  env.fire(env.document, 'visibilitychange');
  assert.equal(env.callbacks.size, 1);
  env.playback.click();
  env.fire(env.document, 'visibilitychange');
  assert.equal(env.callbacks.size, 0);
});
