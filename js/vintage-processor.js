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
  frameW: 640,
  frameH: 480,
  pad: 40,
  gap: 30,
  footerH: 80,
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
   * @returns {Promise<string>} PNG data URL of the finished strip
   */
  async buildStrip(shotDataUrls, canvas, bestShotIndex = -1) {
    const { frameW, frameH, pad, gap, footerH } = STRIP_LAYOUT;
    const stripW = frameW + pad * 2;
    const stripH = pad + (frameH + gap) * shotDataUrls.length + footerH;
    canvas.width = stripW;
    canvas.height = stripH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f4e8d0';
    ctx.fillRect(0, 0, stripW, stripH);

    ctx.fillStyle = '#0d0906';
    const holeRadius = 9;
    const holeGap = 46;
    for (let y = 20; y < stripH - 20; y += holeGap) {
      ctx.beginPath(); ctx.arc(20, y, holeRadius, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(stripW - 20, y, holeRadius, 0, Math.PI * 2); ctx.fill();
    }

    const images = await Promise.all(shotDataUrls.map(this._loadImage));

    images.forEach((img, i) => {
      const y = pad + i * (frameH + gap);
      // Draw with "cover" semantics to avoid stretching (center-crop)
      this._drawImageCover(ctx, img, pad, y, frameW, frameH);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 2;
      ctx.strokeRect(pad, y, frameW, frameH);
      ctx.fillStyle = 'rgba(13,9,6,0.6)';
      ctx.font = '20px Courier New';
      ctx.fillText(`FRAME 0${i + 1}/0${shotDataUrls.length}`, pad + 10, y + frameH - 14);

      if (bestShotIndex === i) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.arc(pad + frameW - 32, y + 32, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffdd55';
        ctx.font = '24px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText('★', pad + frameW - 32, y + 38);
        ctx.textAlign = 'left';
      }
    });

    const footerY = pad + (frameH + gap) * shotDataUrls.length;
    ctx.fillStyle = 'rgba(26,20,16,0.7)';
    ctx.textAlign = 'center';
    ctx.font = '22px Georgia';
    ctx.fillText('TIMELESS BOOTH', stripW / 2, footerY + footerH / 2 - 8);
    ctx.font = '14px Courier New';
    ctx.fillText(new Date().toLocaleDateString(), stripW / 2, footerY + footerH / 2 + 16);
    ctx.textAlign = 'left';

    return canvas.toDataURL('image/png');
  }

  /**
   * Builds an animated GIF from the captured frames.
   * @param {string[]} shotDataUrls
   * @param {string} [filterName='vintage']
   * @returns {Promise<Blob>}
   */
  async buildGif(shotDataUrls, filterName = 'vintage') {
    if (typeof window.GIF === 'undefined') {
      throw new Error('GIF export is unavailable because the GIF library did not load.');
    }

    const loadedFrames = await Promise.all(shotDataUrls.map((src) => this._loadImage(src)));
    return new Promise((resolve, reject) => {
      const gif = new window.GIF({
        workers: 2,
        quality: 8,
        width: 640,
        height: 480,
        workerScript: 'js/gif.worker.js',
      });

      loadedFrames.forEach((img) => {
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = 640;
        frameCanvas.height = 480;
        const frameCtx = frameCanvas.getContext('2d');
        frameCtx.filter = this.getFilterStyle(filterName);
        this._drawImageCover(frameCtx, img, 0, 0, 640, 480);
        frameCtx.filter = 'none';
        this._applyGrainAndVignette(frameCtx, 640, 480, filterName);
        gif.addFrame(frameCanvas, { copy: true, delay: 500 });
      });

      gif.on('finished', (blob) => resolve(blob));
      gif.on('abort', () => reject(new Error('GIF export was interrupted.')));
      gif.render();
    });
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
