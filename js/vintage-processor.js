'use strict';

/**
 * vintage-processor.js
 *
 * Pure(ish) image-processing helpers. Every method takes explicit
 * canvas/context inputs rather than reaching into shared state, so
 * it stays reusable independent of the DOM tree in booth.html —
 * e.g. it doesn't know about the video element's id or the strip's
 * markup, only the elements it's handed.
 *
 * Load after camera-manager.js, before photo-booth.js.
 */

/** Layout constants for the downloadable strip composite. */
const STRIP_LAYOUT = Object.freeze({
  frameW: 480,
  frameH: 360,
  pad: 30,
  gap: 18,
  footerH: 84,
});

class VintageProcessor {
  /** @param {HTMLCanvasElement} noiseCanvas pre-existing canvas used to build the grain texture */
  constructor(noiseCanvas) {
    this.noiseCanvas = noiseCanvas;
    this._buildNoiseTexture();
  }

  /** @private Generates a reusable low-alpha grain tile. */
  _buildNoiseTexture() {
    const ctx = this.noiseCanvas.getContext('2d');
    const { width: w, height: h } = this.noiseCanvas;
    const imageData = ctx.createImageData(w, h);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const value = Math.random() * 255;
      imageData.data[i] = value;
      imageData.data[i + 1] = value;
      imageData.data[i + 2] = value;
      imageData.data[i + 3] = 18;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Returns the CSS filter string for a named preset.
   * @param {string} [filterName='vintage']
   * @returns {string}
   */
  getFilterStyle(filterName = 'vintage') {
    switch (filterName) {
      case 'none':
        return 'none';
      case 'bw':
        // True grayscale, punched up slightly so it doesn't look flat.
        return 'grayscale(1) contrast(1.15) brightness(1.02)';
      case 'sepia':
        // Classic sepia: desaturate first, then tint, so it reads as
        // sepia rather than just "warm color photo".
        return 'grayscale(0.35) sepia(0.85) contrast(1.05) saturate(1.1) brightness(1)';
      case 'dreamy':
        // Soft, airy, slightly lifted blacks and a gentle glow feel.
        return 'contrast(0.92) saturate(0.75) brightness(1.1) blur(0.3px) hue-rotate(-4deg)';
      case 'cool':
        // Push toward blue/cyan instead of the old 180deg hue flip,
        // which just inverted skin tones instead of looking "cool".
        return 'contrast(1.05) saturate(0.95) brightness(1.02) hue-rotate(-18deg) sepia(0)';
      case 'warm':
        // Golden-hour warmth without going full sepia.
        return 'contrast(1.05) saturate(1.2) brightness(1.03) sepia(0.25) hue-rotate(-6deg)';
      case 'film':
        // Higher contrast, slightly crushed color, faint warmth —
        // like consumer print film, not a full sepia wash.
        return 'contrast(1.18) saturate(0.85) brightness(0.97) sepia(0.12)';
      case 'vintage':
      default:
        // Faded, aged photograph: desaturated, lifted, warm cast.
        return 'sepia(0.45) contrast(1.05) saturate(0.65) brightness(1.03)';
    }
  }

  /**
   * Captures the current video frame, mirrored to match the live
   * preview, and returns a grain/vignette-treated JPEG data URL.
   * @param {HTMLVideoElement} video
   * @param {HTMLCanvasElement} canvas scratch canvas to draw into
   * @param {string} [filterName='vintage']
   * @returns {string} data URL
   */
  captureFrame(video, canvas, filterName = 'vintage') {
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.filter = this.getFilterStyle(filterName);
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1); // mirror to match what the sitter saw on screen
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    ctx.filter = 'none';

    this._applyGrainAndVignette(ctx, w, h, filterName);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  /** @private */
  _applyGrainAndVignette(ctx, w, h, filterName = 'vintage') {
    // Only lay down the warm brown tint for filters that are meant to
    // look warm/aged. Cool/B&W/no-filter shots would otherwise always
    // get pushed sepia regardless of what the person picked.
    const warmTintFilters = new Set(['sepia', 'vintage', 'film', 'warm']);
    if (warmTintFilters.has(filterName)) {
      ctx.fillStyle = 'rgba(80,50,20,0.12)';
      ctx.fillRect(0, 0, w, h);
    }

    ctx.globalAlpha = 0.5;
    const { width: nw, height: nh } = this.noiseCanvas;
    for (let y = 0; y < h; y += nh) {
      for (let x = 0; x < w; x += nw) {
        ctx.drawImage(this.noiseCanvas, x, y);
      }
    }
    ctx.globalAlpha = 1;

    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Composites all captured shots into a single downloadable strip.
   * @param {string[]} shotDataUrls
   * @param {HTMLCanvasElement} canvas scratch canvas to draw into
   * @param {{
   *   bestShotIndex?: number,
   *   designId?: string,
   *   stickers?: {emoji: string, x: number, y: number}[][],
   *   footerText?: string
   * }} options
   * @returns {Promise<string>} PNG data URL of the finished strip
   */
  async buildStrip(shotDataUrls, canvas, options = {}) {
    const images = await Promise.all(shotDataUrls.map(this._loadImage));
    this._drawStrip(canvas, images, options);
    return canvas.toDataURL('image/png');
  }

  /**
   * Builds a GIF of the entire photo strip, highlighting each photo in turn.
   * @param {string[]} shotDataUrls
   * @param {{
   *   bestShotIndex?: number,
   *   designId?: string,
   *   stickers?: {emoji: string, x: number, y: number}[][],
   *   footerText?: string
   * }} options
   * @returns {Promise<Blob>}
   */
  async buildGif(shotDataUrls, options = {}) {
    if (typeof window.GIF === 'undefined') {
      throw new Error('GIF export is unavailable because the GIF library did not load.');
    }

    const loadedFrames = await Promise.all(shotDataUrls.map((src) => this._loadImage(src)));
    const { frameW, frameH, pad, gap, footerH } = STRIP_LAYOUT;
    const scale = 0.7;
    const width = Math.round((frameW + pad * 2) * scale);
    const height = Math.round((pad + (frameH + gap) * loadedFrames.length + footerH) * scale);
    return new Promise((resolve, reject) => {
      const gif = new window.GIF({
        workers: 2,
        quality: 8,
        width,
        height,
        workerScript: 'js/gif.worker.js',
      });

      loadedFrames.forEach((_, highlightIndex) => {
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = width;
        frameCanvas.height = height;
        this._drawStrip(frameCanvas, loadedFrames, {
          ...options,
          highlightIndex,
          scale,
        });
        gif.addFrame(frameCanvas, { copy: true, delay: 650 });
      });

      gif.on('finished', (blob) => resolve(blob));
      gif.on('abort', () => reject(new Error('GIF export was interrupted.')));
      gif.render();
    });
  }

  /** @private */
  _drawStrip(canvas, images, options = {}) {
    const { frameW, frameH, pad, gap, footerH } = STRIP_LAYOUT;
    const stripW = frameW + pad * 2;
    const footerY = pad + (frameH + gap) * images.length;
    const stripH = footerY + footerH;
    const scale = options.scale || 1;
    const ctx = canvas.getContext('2d');
    const design = STRIP_DESIGNS.find((item) => item.id === options.designId) || STRIP_DESIGNS[0];

    if (canvas.width !== Math.round(stripW * scale)) canvas.width = Math.round(stripW * scale);
    if (canvas.height !== Math.round(stripH * scale)) canvas.height = Math.round(stripH * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = design.background;
    ctx.fillRect(0, 0, stripW, stripH);

    ctx.fillStyle = design.accent;
    ctx.fillRect(0, 0, stripW, 12);
    for (let y = 22; y < stripH - 15; y += 28) {
      ctx.beginPath(); ctx.arc(15, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(stripW - 15, y, 5, 0, Math.PI * 2); ctx.fill();
    }

    images.forEach((img, i) => {
      const y = pad + i * (frameH + gap);
      ctx.fillStyle = design.frame;
      ctx.fillRect(pad - 5, y - 5, frameW + 10, frameH + 10);
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad, y, frameW, frameH);
      ctx.clip();
      this._drawImageCover(ctx, img, pad, y, frameW, frameH);

      (options.stickers?.[i] || []).forEach((sticker) => {
        ctx.font = '38px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sticker.emoji, pad + sticker.x * frameW, y + sticker.y * frameH);
      });
      ctx.restore();

      ctx.strokeStyle = design.accent;
      ctx.lineWidth = options.highlightIndex === i ? 8 : 2;
      ctx.strokeRect(pad, y, frameW, frameH);
      if (options.bestShotIndex === i) {
        ctx.font = '34px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('⭐', pad + frameW - 10, y + 8);
      }
    });

    ctx.fillStyle = design.accent;
    ctx.fillRect(0, footerY, stripW, 4);
    ctx.fillStyle = '#30243b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px Nunito, sans-serif';
    ctx.fillText(options.footerText || 'STICKER STUDIO', stripW / 2, footerY + footerH / 2, stripW - 24);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** @private */
  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Draw an image into the destination rectangle using "cover" semantics
   * (preserve aspect ratio and center-crop), avoiding stretched output.
   * @private
   */
  _drawImageCover(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) {
      ctx.drawImage(img, dx, dy, dw, dh);
      return;
    }
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = Math.max(0, (iw - sw) / 2);
    const sy = Math.max(0, (ih - sh) / 2);
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}
