'use strict';

/**
 * film-strip.js
 *
 * Handles just the DOM rendering of the physical film-strip widget
 * (see .film-strip in css/strip.css). Knows nothing about the
 * camera or session state — it's handed a slot index and a data URL
 * and renders it.
 *
 * Load after vintage-processor.js, before photo-booth.js.
 */
class FilmStrip {
  /**
   * @param {HTMLElement} rootEl the .film-strip container
   * @param {HTMLElement} dateEl the .strip-footer element showing the date/title
   */
  constructor(rootEl, dateEl) {
    this.rootEl = rootEl;
    this.dateEl = dateEl;
  }

  /**
   * @param {number} index
   * @param {string} dataUrl
   */
  placeShot(index, dataUrl) {
    const slot = this.rootEl.querySelector(`[data-slot="${index}"]`);
    slot.innerHTML = '';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = `Developed photo, frame ${index + 1}`;
    slot.appendChild(img);

    const stamp = document.createElement('div');
    stamp.className = 'frame-stamp';
    const now = new Date();
    stamp.textContent = `FR.0${index + 1} • ${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(2)}`;
    slot.appendChild(stamp);
  }

  /** @param {number} totalSlots */
  reset(totalSlots) {
    for (let i = 0; i < totalSlots; i++) {
      const slot = this.rootEl.querySelector(`[data-slot="${i}"]`);
      slot.innerHTML = `<span class="placeholder-x">0${i + 1}</span>`;
    }
    this.dateEl.textContent = 'TIMELESS BOOTH';
  }

  markComplete() {
    this.dateEl.textContent = `TIMELESS BOOTH • ${new Date().toLocaleDateString()}`;
  }
}
