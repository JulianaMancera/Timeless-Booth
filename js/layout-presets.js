'use strict';

/**
 * layout-presets.js
 *
 * Single source of truth for the available strip layouts. Loaded by
 * both layouts.html (the picker page) and booth.html (the capture
 * page), so a layout only ever needs to be defined in one place.
 *
 * Load this before layouts.js and before photo-booth.js.
 */
const LAYOUT_PRESETS = Object.freeze([
  { id: 'classic4', name: 'Classic 4', totalShots: 4, styleClass: 'layout-classic', shape: 'landscape' },
  { id: 'portrait3', name: 'Portrait 3', totalShots: 3, styleClass: 'layout-portrait', shape: 'portrait' },
  { id: 'mini2', name: 'Mini 2', totalShots: 2, styleClass: 'layout-mini', shape: 'landscape' },
  { id: 'tall6', name: 'Tall 6', totalShots: 6, styleClass: 'layout-tall', shape: 'landscape' },
  { id: 'film5', name: 'Film 5', totalShots: 5, styleClass: 'layout-film', shape: 'landscape' },
  { id: 'retro7', name: 'Retro 7', totalShots: 7, styleClass: 'layout-retro', shape: 'portrait' },
  { id: 'polaroid4', name: 'Polaroid 4', totalShots: 4, styleClass: 'layout-polaroid', shape: 'square' },
  { id: 'cinema8', name: 'Cinema 8', totalShots: 8, styleClass: 'layout-cinema', shape: 'wide' },
]);

const STRIP_DESIGNS = Object.freeze([
  { id: 'rose', name: 'Sweetheart', background: '#fff0f4', accent: '#f18ba9', frame: '#ffffff' },
  { id: 'sky', name: 'Cloud nine', background: '#eef8ff', accent: '#83c7eb', frame: '#ffffff' },
  { id: 'lavender', name: 'Dreamy lilac', background: '#f3efff', accent: '#aa91e8', frame: '#ffffff' },
  { id: 'mint', name: 'Minty fresh', background: '#eaf8f1', accent: '#77c9aa', frame: '#ffffff' },
  { id: 'classic', name: 'Cream soda', background: '#fff8e9', accent: '#e4b764', frame: '#ffffff' },
]);
