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
    slot.classList.remove('starred');

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = `Developed photo, frame ${index + 1}`;
    slot.appendChild(img);

    const stamp = document.createElement('div');
    stamp.className = 'frame-stamp';
    const now = new Date();
    stamp.textContent = `FR.0${index + 1} • ${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(2)}`;
    slot.appendChild(stamp);

    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'frame-star';
    star.textContent = '★';
    star.title = `Mark frame ${index + 1} as your best shot`;
    star.addEventListener('click', () => {
      if (typeof this.onBestShotSelected === 'function') {
        this.onBestShotSelected(index);
      }
    });
    slot.appendChild(star);
  }

  /** @param {number} totalSlots */
  reset(totalSlots) {
    let footer = this.rootEl.querySelector('.strip-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'strip-footer';
      footer.id = 'stripDate';
    } else {
      footer.remove();
    }

    this.rootEl.innerHTML = '';
    for (let i = 0; i < totalSlots; i++) {
      const slot = document.createElement('div');
      slot.className = 'frame-slot';
      slot.dataset.slot = String(i);
      slot.innerHTML = `<span class="placeholder-x">0${i + 1}</span>`;
      this.rootEl.appendChild(slot);
    }

    this.rootEl.appendChild(footer);
    this.dateEl = footer;
    this.dateEl.textContent = 'TIMELESS BOOTH';
  }

  markBestShot(index) {
    this.rootEl.querySelectorAll('.frame-slot').forEach((slot) => {
      slot.classList.remove('starred');
      const star = slot.querySelector('.frame-star');
      if (star) star.classList.remove('selected');
    });

    if (index >= 0) {
      const slot = this.rootEl.querySelector(`[data-slot="${index}"]`);
      if (slot) {
        slot.classList.add('starred');
        const star = slot.querySelector('.frame-star');
        if (star) star.classList.add('selected');
      }
    }
  }

  markComplete() {
    this.dateEl.textContent = `TIMELESS BOOTH • ${new Date().toLocaleDateString()}`;
  }
}
