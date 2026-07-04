'use strict';

/**
 * layouts.js
 *
 * Powers layouts.html: builds the layout picker grid from
 * LAYOUT_PRESETS (js/layout-presets.js), renders a small
 * representative frame-count thumbnail on each card, and drives a
 * full-size live preview strip using the real .film-strip markup so
 * what you pick here is what you'll actually see in the booth.
 */

const STORAGE_KEY = 'timelessBoothLayout';

/** @param {number} count @returns {HTMLElement} */
function buildMiniFrames(count) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-frames';
  for (let i = 0; i < count; i++) {
    const frame = document.createElement('span');
    frame.className = 'mini-frame';
    wrap.appendChild(frame);
  }
  return wrap;
}

function buildLayoutGrid() {
  const grid = document.getElementById('layoutGrid');
  if (!grid) return;
  grid.innerHTML = '';

  LAYOUT_PRESETS.forEach((layout) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'layout-card';
    card.dataset.layoutId = layout.id;
    card.setAttribute('role', 'tab');
    card.setAttribute('aria-selected', 'false');

    const preview = document.createElement('div');
    preview.className = `layout-preview layout-preview--${layout.id} shape-${layout.shape}`;
    preview.appendChild(buildMiniFrames(layout.totalShots));

    const name = document.createElement('div');
    name.className = 'layout-name';
    name.textContent = layout.name;

    const count = document.createElement('div');
    count.className = 'layout-count';
    count.textContent = `${layout.totalShots} shots`;

    card.append(preview, name, count);
    grid.appendChild(card);
  });
}

/** @param {string} layoutId */
function renderPreviewStrip(layoutId) {
  const layout = LAYOUT_PRESETS.find((l) => l.id === layoutId) || LAYOUT_PRESETS[0];
  const strip = document.getElementById('previewStrip');
  const nameEl = document.getElementById('previewLayoutName');
  const enterLink = document.getElementById('enterBoothLink');
  if (!strip) return;

  strip.className = `film-strip ${layout.styleClass}`;
  strip.innerHTML = '';
  for (let i = 0; i < layout.totalShots; i++) {
    const slot = document.createElement('div');
    slot.className = 'frame-slot';
    slot.innerHTML = '<div class="mock-figure"></div>';
    strip.appendChild(slot);
  }
  const footer = document.createElement('div');
  footer.className = 'strip-footer';
  footer.textContent = 'TIMELESS BOOTH';
  strip.appendChild(footer);

  if (nameEl) nameEl.textContent = `${layout.name} — ${layout.totalShots} shots`;
  if (enterLink) enterLink.href = `booth.html?layout=${layout.id}`;
}

/** @param {string} layoutId */
function selectLayout(layoutId) {
  document.querySelectorAll('#layoutGrid [data-layout-id]').forEach((card) => {
    const selected = card.dataset.layoutId === layoutId;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  renderPreviewStrip(layoutId);
  try {
    window.localStorage.setItem(STORAGE_KEY, layoutId);
  } catch (err) {
    // localStorage can be unavailable (e.g. some file:// contexts) — non-fatal.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  buildLayoutGrid();

  let initialLayoutId = LAYOUT_PRESETS[0].id;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && LAYOUT_PRESETS.some((l) => l.id === saved)) {
      initialLayoutId = saved;
    }
  } catch (err) {
    // ignore
  }
  selectLayout(initialLayoutId);

  const grid = document.getElementById('layoutGrid');
  if (grid) {
    grid.addEventListener('click', (event) => {
      const card = event.target.closest('[data-layout-id]');
      if (!card) return;
      selectLayout(card.dataset.layoutId);
    });
  }
});
