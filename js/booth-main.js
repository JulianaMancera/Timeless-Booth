'use strict';

/**
 * booth-main.js
 *
 * Entry point for booth.html. Deliberately tiny — its only job is
 * to bootstrap PhotoBooth once the DOM is ready. Load this last.
 */
document.addEventListener('DOMContentLoaded', () => {
  new PhotoBooth();
});
