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
   *   caption?: string,
   *   footerText?: string,
   *   layoutId?: string
   * }} options
   * @returns {Promise<string>} PNG data URL of the finished strip
   */
  async buildStrip(shotDataUrls, canvas, options = {}) {
    const images = await Promise.all(shotDataUrls.map(this._loadImage));
    this._drawStrip(canvas, images, options);
    return canvas.toDataURL('image/png');
  }

  /**
   * Adds an optional caption to a single downloaded photo.
   * @param {string} shotDataUrl
   * @param {HTMLCanvasElement} canvas
   * @param {string} caption
   * @returns {Promise<string>}
   */
  async buildCaptionedPhoto(shotDataUrl, canvas, caption) {
    const image = await this._loadImage(shotDataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);
    this._drawCaption(ctx, caption, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  /**
   * Records the complete strip animation using the best browser-supported video format.
   * @param {string[]} shotDataUrls
   * @param {{
   *   bestShotIndex?: number,
   *   designId?: string,
   *   stickers?: {emoji: string, x: number, y: number}[][],
   *   caption?: string,
   *   footerText?: string,
   *   layoutId?: string
   * }} options
   * @returns {Promise<Blob>}
   */
  async buildVideo(shotDataUrls, options = {}) {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Video export is not supported by this browser.');
    }
    const loadedFrames = await Promise.all(shotDataUrls.map((src) => this._loadImage(src)));
    if (typeof MediaRecorder.isTypeSupported !== 'function') {
      throw new Error('This browser cannot check video encoding support.');
    }
    const mimeType = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This browser cannot encode MP4 or WebM video.');

    const geometry = this._getStripGeometry(loadedFrames.length, options);
    const scale = Math.min(1, 900 / geometry.stripW, 1800 / geometry.stripH);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(geometry.stripW * scale);
    canvas.height = Math.round(geometry.stripH * scale);
    if (typeof canvas.captureStream !== 'function') {
      throw new Error('Canvas video recording is not supported by this browser.');
    }

    const stream = canvas.captureStream(24);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      throw err;
    }
    const chunks = [];
    const recording = new Promise((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      }, { once: true });
      recorder.addEventListener('error', (event) => {
        reject(event.error || new Error('The browser could not record the strip video.'));
      }, { once: true });
    });

    try {
      recorder.start();
      for (let highlightIndex = 0; highlightIndex < loadedFrames.length; highlightIndex++) {
        this._drawStrip(canvas, loadedFrames, { ...options, highlightIndex, scale });
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
      recorder.stop();
      const blob = await recording;
      if (blob.size === 0) throw new Error('The browser produced an empty video file.');
      return blob;
    } catch (err) {
      if (recorder.state !== 'inactive') {
        recorder.stop();
        await recording.catch(() => {});
      }
      throw err;
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  /**
   * Builds an animated GIF that highlights each photo in turn.
   * @param {string[]} shotDataUrls
   * @param {object} options
   * @returns {Promise<Blob>}
   */
  async buildGif(shotDataUrls, options = {}) {
    if (typeof window.GIF === 'undefined') {
      throw new Error('GIF export is unavailable because the GIF library did not load.');
    }
    const loadedFrames = await Promise.all(shotDataUrls.map((src) => this._loadImage(src)));
    const frameW = loadedFrames[0].naturalWidth || loadedFrames[0].width;
    const frameH = loadedFrames[0].naturalHeight || loadedFrames[0].height;
    const scale = Math.min(1, 640 / frameW, 640 / frameH);
    const width = Math.max(1, Math.round(frameW * scale));
    const height = Math.max(1, Math.round(frameH * scale));

    return new Promise((resolve, reject) => {
      const gif = new window.GIF({
        workers: 2,
        quality: 8,
        width,
        height,
        workerScript: 'js/gif.worker.js',
      });
      loadedFrames.forEach((image, index) => {
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = width;
        frameCanvas.height = height;
        const ctx = frameCanvas.getContext('2d');
        this._drawImageCover(ctx, image, 0, 0, width, height);
        (options.stickers?.[index] || []).forEach((sticker) => {
          ctx.font = `${Math.max(24, Math.round(width * 0.08))}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(sticker.emoji, sticker.x * width, sticker.y * height);
        });
        if (options.caption) this._drawCaption(ctx, options.caption, 0, 0, width, height);
        gif.addFrame(frameCanvas, { copy: true, delay: 650 });
      });
      gif.on('finished', resolve);
      gif.on('abort', () => reject(new Error('GIF export was interrupted.')));
      gif.render();
    });
  }

  /** @private */
  _getStripGeometry(imageCount, options = {}) {
    const layout = LAYOUT_PRESETS.find((item) => item.id === options.layoutId);
    const isGrid = layout?.shape === 'grid';
    const frameW = isGrid ? 360 : STRIP_LAYOUT.frameW;
    const frameH = isGrid ? 360 : STRIP_LAYOUT.frameH;
    const { pad, gap, footerH } = STRIP_LAYOUT;
    const columns = isGrid ? 2 : 1;
    const rows = Math.ceil(imageCount / columns);
    const stripW = pad * 2 + columns * frameW + (columns - 1) * gap;
    const footerY = pad + rows * frameH + rows * gap;
    return { frameW, frameH, pad, gap, footerH, columns, stripW, footerY, stripH: footerY + footerH };
  }

  /** @private */
  _drawStrip(canvas, images, options = {}) {
    const { frameW, frameH, pad, gap, footerH, columns, stripW, footerY, stripH } =
      this._getStripGeometry(images.length, options);
    const scale = options.scale || 1;
    const ctx = canvas.getContext('2d');
    const design = STRIP_DESIGNS.find((item) => item.id === options.designId) || STRIP_DESIGNS[0];

    if (canvas.width !== Math.round(stripW * scale)) canvas.width = Math.round(stripW * scale);
    if (canvas.height !== Math.round(stripH * scale)) canvas.height = Math.round(stripH * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = design.background;
    ctx.fillRect(0, 0, stripW, stripH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, stripW, stripH);
    ctx.clip();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = design.accent;
    if (design.pattern === 'stripe') {
      for (let x = 0; x < stripW; x += 22) ctx.fillRect(x, 0, 6, stripH);
    } else if (design.pattern === 'dot') {
      for (let y = 18; y < stripH; y += 24) {
        for (let x = 12; x < stripW; x += 24) {
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (design.pattern === 'star') {
      for (let y = 20; y < stripH; y += 35) {
        this._drawStripStar(ctx, 13, y, 5);
        this._drawStripStar(ctx, stripW - 13, y + 12, 5);
      }
    } else if (design.pattern === 'check') {
      for (let y = 0; y < stripH; y += 16) {
        for (let x = 0; x < stripW; x += 16) {
          if ((x / 16 + y / 16) % 2 === 0) ctx.fillRect(x, y, 8, 8);
        }
      }
    } else if (design.pattern === 'cat') {
      for (let y = 34; y < stripH; y += 64) {
        this._drawPawPrint(ctx, 15, y, 0.8, design.accent);
        this._drawPawPrint(ctx, stripW - 15, y + 28, 0.8, design.accent);
      }
    } else {
      for (let y = 16; y < stripH; y += 24) {
        ctx.fillRect(0, y, stripW, 2);
      }
    }
    ctx.restore();

    ctx.fillStyle = design.accent;
    ctx.fillRect(0, 0, stripW, 12);
    for (let y = 22; y < stripH - 15; y += 28) {
      ctx.beginPath(); ctx.arc(15, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(stripW - 15, y, 5, 0, Math.PI * 2); ctx.fill();
    }

    images.forEach((img, i) => {
      const x = pad + (i % columns) * (frameW + gap);
      const y = pad + Math.floor(i / columns) * (frameH + gap);
      ctx.fillStyle = design.frame;
      const mat = design.pattern === 'ticket' ? 8 : 5;
      ctx.fillRect(x - mat, y - mat, frameW + mat * 2, frameH + mat * 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, frameW, frameH);
      ctx.clip();
      this._drawImageCover(ctx, img, x, y, frameW, frameH);

      (options.stickers?.[i] || []).forEach((sticker) => {
        ctx.font = '38px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sticker.emoji, x + sticker.x * frameW, y + sticker.y * frameH);
      });
      ctx.restore();

      ctx.strokeStyle = design.accent;
      ctx.lineWidth = options.highlightIndex === i ? 8 : (design.pattern === 'check' ? 6 : 3);
      ctx.setLineDash(design.pattern === 'star' ? [9, 6] : []);
      ctx.strokeRect(x, y, frameW, frameH);
      ctx.setLineDash([]);
      if (design.pattern === 'cat') {
        ctx.fillStyle = design.accent;
        [x + 18, x + frameW - 18].forEach((centerX) => {
          ctx.beginPath();
          ctx.moveTo(centerX - 10, y + 5);
          ctx.lineTo(centerX - 5, y - 8);
          ctx.lineTo(centerX + 4, y + 5);
          ctx.closePath();
          ctx.fill();
        });
      }
      if (design.pattern === 'dot') {
        ctx.lineWidth = 2;
        ctx.strokeStyle = design.frame;
        ctx.strokeRect(x + 7, y + 7, frameW - 14, frameH - 14);
      } else if (design.pattern === 'ticket') {
        ctx.fillStyle = design.accent;
        for (let corner = 0; corner < 4; corner++) {
          const cx = corner % 2 === 0 ? x + 9 : x + frameW - 9;
          const cy = corner < 2 ? y + 9 : y + frameH - 9;
          ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (options.bestShotIndex === i) {
        ctx.font = '34px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('⭐', x + frameW - 10, y + 8);
      }
    });

    ctx.fillStyle = design.accent;
    ctx.fillRect(0, footerY, stripW, 4);
    ctx.fillStyle = design.accent;
    if (design.pattern === 'star') {
      this._drawStripStar(ctx, 26, footerY + footerH / 2, 9);
      this._drawStripStar(ctx, stripW - 26, footerY + footerH / 2, 9);
    } else if (design.pattern === 'stripe') {
      for (let x = 8; x < stripW - 8; x += 16) ctx.fillRect(x, footerY + 8, 5, 5);
    } else if (design.pattern === 'check') {
      for (let x = 8; x < stripW - 8; x += 12) ctx.fillRect(x, footerY + 8, 6, 6);
    } else if (design.pattern === 'ticket') {
      ctx.beginPath();
      ctx.arc(18, footerY + 4, 8, 0, Math.PI * 2);
      ctx.arc(stripW - 18, footerY + 4, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#30243b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const footerCenterY = footerY + footerH / 2;
    ctx.font = 'bold 19px Nunito, sans-serif';
    ctx.fillText('STICKER STUDIO', stripW / 2, footerCenterY - 19, stripW - 24);
    if (options.footerText) {
      ctx.font = 'bold 12px Nunito, sans-serif';
      ctx.fillText(options.footerText, stripW / 2, footerCenterY, stripW - 24);
    }
    if (options.caption) {
      ctx.font = 'bold 13px Nunito, sans-serif';
      ctx.fillText(options.caption, stripW / 2, footerCenterY + 20, stripW - 24);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** @private */
  _drawCaption(ctx, caption, x, y, width, height) {
    const barHeight = Math.max(26, Math.min(44, height * 0.12));
    const barY = y + height - barHeight - 8;
    ctx.fillStyle = 'rgba(48, 36, 59, 0.72)';
    ctx.fillRect(x + 8, barY, width - 16, barHeight);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(14, Math.round(barHeight * 0.48))}px Nunito, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, x + width / 2, barY + barHeight / 2, width - 28);
  }

  /** @private */
  _drawPawPrint(ctx, x, y, scale, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    [[-6, -4, 3], [0, -7, 3], [6, -4, 3]].forEach(([dx, dy, radius]) => {
      ctx.beginPath();
      ctx.arc(dx, dy, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.beginPath();
    ctx.ellipse(0, 3, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** @private */
  _drawStripStar(ctx, x, y, radius) {
    ctx.beginPath();
    for (let point = 0; point < 10; point++) {
      const angle = (Math.PI / 5) * point - Math.PI / 2;
      const distance = point % 2 === 0 ? radius : radius * 0.45;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      if (point === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
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
