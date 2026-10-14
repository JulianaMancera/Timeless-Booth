'use strict';

/**
 * photo-booth.js
 *
 * Finite state machine that owns the capture session lifecycle and
 * wires up the booth page's DOM. This is the only class in the
 * project that knows about button clicks, keyboard shortcuts, or
 * element IDs — CameraManager, VintageProcessor, and FilmStrip stay
 * reusable because they don't.
 *
 * Depends on CameraManager, VintageProcessor, and FilmStrip already
 * being defined, so load this file last, right before booth-main.js.
 */

/** @enum {string} */
const BoothState = Object.freeze({
  IDLE: 'idle',              // camera not yet requested
  READY: 'ready',            // camera live, no session running
  COUNTING_DOWN: 'counting_down',
  CAPTURING: 'capturing',
  COMPLETE: 'complete',
  ERROR: 'error',
});

const SESSION_CONFIG = Object.freeze({
  DEFAULT_COUNTDOWN_SECONDS: 3,
  FLASH_DURATION_MS: 70,
  POST_SHOT_DELAY_MS: 600,
  MAX_PHOTOS: 6,
});

// LAYOUT_PRESETS now lives in js/layout-presets.js, loaded before this file.

class PhotoBooth {
  constructor() {
    this.state = BoothState.IDLE;
    /** @type {string[]} */
    this.shots = [];
    /** @type {{id: number, emoji: string, x: number, y: number}[][]} */
    this.stickers = [];
    this.nextStickerId = 1;
    this.nextStickerTarget = 0;
    this.designId = this._getDesignFromUrl();

    this._cacheDom();

    this.camera = new CameraManager(this.dom.video);
    this.processor = new VintageProcessor(this.dom.noiseCanvas);
    this.filmStrip = new FilmStrip(this.dom.filmStripEl, this.dom.stripDate);
    this.filmStrip.onBestShotSelected = (index) => this._markBestShot(index);
    this.filmStrip.onStickerRemoved = (index, stickerId) => this._removeSticker(index, stickerId);
    this.currentFilter = 'none';
    this.countdownSeconds = SESSION_CONFIG.DEFAULT_COUNTDOWN_SECONDS;
    this.bestShotIndex = -1;
    this.layout = null;
    this.activeStickerDrag = null;

    this._bindEvents();
    this.dom.designSelect.value = this.designId;
    this._applyFilterToPreview();
    this._applyDesign();
    this._setLayout(this._getLayoutFromUrl(), false);
    window.setTimeout(() => {
      void this._enableCamera();
    }, 180);
  }

  /** @private */
  _getLayoutFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const layoutId = params.get('layout');
    return LAYOUT_PRESETS.some((layout) => layout.id === layoutId)
      ? layoutId
      : LAYOUT_PRESETS[0].id;
  }

  /** @private */
  _getDesignFromUrl() {
    const requestedDesign = new URLSearchParams(window.location.search).get('design');
    if (STRIP_DESIGNS.some((design) => design.id === requestedDesign)) return requestedDesign;
    try {
      const savedDesign = window.localStorage.getItem('stickerStudioDesign');
      if (STRIP_DESIGNS.some((design) => design.id === savedDesign)) return savedDesign;
    } catch (err) {
      // localStorage can be unavailable in file:// contexts.
    }
    return STRIP_DESIGNS[0].id;
  }

  /** @private */
  _cacheDom() {
    const byId = (id) => document.getElementById(id);
    this.dom = {
      video: byId('video'),
      idleMessage: byId('idleMessage'),
      errorMessage: byId('errorMessage'),
      countdown: byId('countdown'),
      flash: byId('flash'),
      frameCounter: byId('frameCounter'),
      shotNum: byId('shotNum'),
      startBtn: byId('startBtn'),
      retakeBtn: byId('retakeBtn'),
      filterSelect: byId('filterSelect'),
      designSelect: byId('designSelect'),
      stickerTray: byId('stickerTray'),
      stickerNote: byId('stickerNote'),
      layoutGrid: byId('layoutGrid'),
      downloadPhotoBtn: byId('downloadPhotoBtn'),
      videoBtn: byId('videoBtn'),
      timerToggle: byId('timerToggle'),
      cameraSelect: byId('cameraSelect'),
      statusLine: byId('statusLine'),
      filmStripEl: byId('filmStrip'),
      stripDate: byId('stripDate'),
      downloadBtn: byId('downloadBtn'),
      captureCanvas: byId('captureCanvas'),
      stripCanvas: byId('stripCanvas'),
      noiseCanvas: byId('noiseCanvas'),
    };
  }

  /** @private */
  _bindEvents() {
    this.dom.startBtn.addEventListener('click', () => this._onStartPressed());
    this.dom.retakeBtn.addEventListener('click', () => this._reset());
    this.dom.downloadBtn.addEventListener('click', () => this._onDownloadPressed());
    this.dom.downloadPhotoBtn.addEventListener('click', () => this._onDownloadPhotoPressed());
    this.dom.videoBtn.addEventListener('click', () => this._onDownloadVideoPressed());
    this.dom.filterSelect.addEventListener('change', (e) => this._onFilterChanged(e.target.value));
    this.dom.designSelect.addEventListener('change', (e) => this._setDesign(e.target.value));
    this.dom.stickerTray.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sticker]');
      if (!button) return;
      this._addStickerToNextShot(button.dataset.sticker);
    });
    this.dom.stickerTray.addEventListener('dragstart', (event) => {
      const button = event.target.closest('[data-sticker]');
      if (!button || !event.dataTransfer) return;
      event.dataTransfer.setData('text/plain', button.dataset.sticker);
      event.dataTransfer.effectAllowed = 'copy';
    });
    this.dom.filmStripEl.addEventListener('dragover', (event) => {
      const slot = event.target.closest('[data-slot]');
      if (!slot || !event.dataTransfer?.types.includes('text/plain')) return;
      event.preventDefault();
      slot.classList.add('sticker-target');
    });
    this.dom.filmStripEl.addEventListener('dragleave', (event) => {
      const slot = event.target.closest('[data-slot]');
      if (slot && !slot.contains(event.relatedTarget)) slot.classList.remove('sticker-target');
    });
    this.dom.filmStripEl.addEventListener('drop', (event) => {
      const slot = event.target.closest('[data-slot]');
      if (!slot) return;
      event.preventDefault();
      slot.classList.remove('sticker-target');
      const emoji = event.dataTransfer?.getData('text/plain');
      const index = Number(slot.dataset.slot);
      if (emoji) this._addSticker(index, emoji, event.clientX, event.clientY);
    });
    this.dom.filmStripEl.addEventListener('pointerdown', (event) => this._beginStickerDrag(event));
    document.addEventListener('pointermove', (event) => this._moveStickerDrag(event));
    document.addEventListener('pointerup', (event) => this._finishStickerDrag(event));
    document.addEventListener('pointercancel', (event) => this._finishStickerDrag(event));
    if (this.dom.timerToggle) {
      this.dom.timerToggle.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-seconds]');
        if (!btn) return;
        this.dom.timerToggle.querySelectorAll('.timer-option').forEach((b) => {
          const selected = b === btn;
          b.classList.toggle('selected', selected);
          b.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        this._onTimerChanged(Number(btn.dataset.seconds));
      });
    }
    if (this.dom.layoutGrid) {
      this.dom.layoutGrid.addEventListener('click', (event) => {
        const button = event.target.closest('[data-layout-id]');
        if (!button) return;
        this._setLayout(button.dataset.layoutId);
      });
    }
    this.dom.cameraSelect.addEventListener('change', (e) => this._switchCamera(e.target.value));

    document.addEventListener('keydown', (e) => {
      if ((e.code === 'Space' || e.code === 'Enter') && this.state === BoothState.READY) {
        e.preventDefault();
        this._onStartPressed();
      }
    });
  }

  /** @private */
  _setState(next) {
    this.state = next;
  }

  /** @private */
  _applyFilterToPreview() {
    const filterCss = this.processor.getFilterStyle(this.currentFilter);
    this.dom.video.style.filter = filterCss;
    this.dom.video.style.webkitFilter = filterCss;
  }

  /** @private */
  _onFilterChanged(nextFilter) {
    this.currentFilter = nextFilter;
    this._applyFilterToPreview();
  }

  /** @private */
  async _onStartPressed() {
    if (this.state === BoothState.IDLE || this.state === BoothState.ERROR) {
      await this._enableCamera();
      return;
    }
    if (this.state === BoothState.COMPLETE) {
      this._reset();
    }
    if (this.state === BoothState.READY) {
      this._runSession();
    }
  }

  /** @private */
  async _enableCamera() {
    try {
      await this.camera.start();
      this._applyFilterToPreview();
      this.dom.idleMessage.hidden = true;
      this.dom.errorMessage.hidden = true;
      await this._populateCameraOptions();
      this.dom.statusLine.textContent = 'Camera ready. Press the shutter when you are.';
      this.dom.startBtn.textContent = 'Begin Countdown';
      this._updateExportButtons();
      this._setState(BoothState.READY);
    } catch (err) {
      this._setState(BoothState.ERROR);
      this.dom.errorMessage.hidden = false;
      this.dom.errorMessage.textContent =
        `Could not access the camera (${err.message}). ` +
        `Open this file directly in a browser tab and allow camera access.`;
      this.dom.statusLine.textContent = 'Camera unavailable.';
    }
  }

  /** @private */
  async _populateCameraOptions() {
    const devices = await this.camera.listVideoDevices();
    if (devices.length < 2) return; // nothing worth choosing between
    this.dom.cameraSelect.innerHTML = '';
    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      this.dom.cameraSelect.appendChild(opt);
    });
    this.dom.cameraSelect.hidden = false;
  }

  /** @private */
  async _switchCamera(deviceId) {
    if (!deviceId) return;
    try {
      await this.camera.start(deviceId);
    } catch (err) {
      this.dom.statusLine.textContent = `Could not switch camera: ${err.message}`;
    }
  }

  /** @private */
  async _runSession() {
    this._setState(BoothState.COUNTING_DOWN);
    this.dom.startBtn.disabled = true;
    this.dom.retakeBtn.disabled = true;
    this.shots = [];
    this.dom.frameCounter.hidden = false;

    for (let i = 0; i < this.layout.totalShots; i++) {
      if (this.shots.length >= SESSION_CONFIG.MAX_PHOTOS) break;
      this.dom.shotNum.textContent = String(i + 1);
      this.dom.statusLine.textContent = `Shot ${i + 1} of ${this.layout.totalShots} — get ready...`;
      await this._countdown(this.countdownSeconds);

      this._setState(BoothState.CAPTURING);
      await this._flash();
      const dataUrl = this.processor.captureFrame(this.dom.video, this.dom.captureCanvas, this.currentFilter);
      this.shots.push(dataUrl);
      this.filmStrip.placeShot(i, dataUrl);
      this.filmStrip.renderStickers(i, this.stickers[i] || []);
      this._updateExportButtons();
      this.dom.statusLine.textContent = `Shot ${i + 1} captured.`;
      await this._sleep(SESSION_CONFIG.POST_SHOT_DELAY_MS);
      this._setState(BoothState.COUNTING_DOWN);
    }

    this._setState(BoothState.COMPLETE);
    this.filmStrip.markComplete();
    this.dom.statusLine.textContent = 'Strip complete. Download it below, or retake.';
    this.dom.downloadBtn.classList.add('ready');
    this._updateExportButtons();
    this.dom.retakeBtn.disabled = false;
    this.dom.startBtn.disabled = false;
    this.dom.startBtn.textContent = 'Retake Session';
  }

  /** @private */
  async _countdown(seconds) {
    const el = this.dom.countdown;
    for (let i = seconds; i >= 1; i--) {
      el.textContent = String(i);
      el.style.transition = 'none';
      el.style.opacity = '1';
      el.style.transform = 'scale(1.15)';
      void el.offsetWidth; // force reflow before transitioning back down
      el.style.transition = 'opacity 0.15s ease, transform 0.6s ease';
      el.style.transform = 'scale(1)';
      await this._sleep(750);
      el.style.opacity = '0';
      await this._sleep(120);
    }
  }

  /** @private */
  async _flash() {
    const el = this.dom.flash;
    el.style.transition = 'opacity 0.05s ease';
    el.style.opacity = '0.9';
    await this._sleep(SESSION_CONFIG.FLASH_DURATION_MS);
    el.style.transition = 'opacity 0.4s ease';
    el.style.opacity = '0';
  }

  /** @private */
  _reset() {
    this.shots = [];
    this.stickers = Array.from({ length: this.layout.totalShots }, () => []);
    this.nextStickerTarget = 0;
    this.bestShotIndex = -1;
    this.filmStrip.reset(this.layout.totalShots);
    this.filmStrip.markBestShot(-1);
    this.dom.downloadBtn.classList.remove('ready');
    this._updateExportButtons();
    this.dom.frameCounter.hidden = true;
    this.dom.statusLine.textContent = 'Camera ready. Press the shutter when you are.';
    this.dom.stickerNote.textContent = 'Take your photos first, then decorate your strip.';
    this.dom.startBtn.textContent = 'Begin Countdown';
    this._setState(BoothState.READY);
  }

  /** @private */
  _updateExportButtons() {
    const hasShots = this.shots.length > 0;
    const canDownloadStrip = this.layout && this.shots.length === this.layout.totalShots;
    this.dom.downloadPhotoBtn.disabled = !hasShots;
    this.dom.videoBtn.disabled = !canDownloadStrip || this.shots.length < 2;
    this.dom.downloadBtn.disabled = !canDownloadStrip;
    this.dom.downloadBtn.classList.toggle('ready', Boolean(canDownloadStrip));
  }

  /** @private */
  async _onDownloadPressed() {
    if (this.shots.length < this.layout.totalShots) return;
    const dataUrl = await this.processor.buildStrip(this.shots, this.dom.stripCanvas, this._getStripOptions());
    this._triggerDownload(dataUrl, 'sticker-studio-strip.png');
  }

  /** @private */
  _setLayout(layoutId, resetSession = true) {
    const nextLayout = LAYOUT_PRESETS.find((layout) => layout.id === layoutId);
    if (!nextLayout) return;
    if (nextLayout.totalShots > SESSION_CONFIG.MAX_PHOTOS) {
      this.dom.statusLine.textContent = `Photo strips are limited to ${SESSION_CONFIG.MAX_PHOTOS} photos.`;
      return;
    }
    if (this.layout && this.layout.id === nextLayout.id) return;
    if (this.state === BoothState.CAPTURING) return;

    this.layout = nextLayout;
    if (this.dom.layoutGrid) {
      this.dom.layoutGrid.querySelectorAll('[data-layout-id]').forEach((button) => {
        const selected = button.dataset.layoutId === layoutId;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    }
    this.dom.filmStripEl.className = `film-strip ${nextLayout.styleClass} theme-${this.designId}`;
    const frameTotal = document.getElementById('frameTotal');
    if (frameTotal) frameTotal.textContent = String(nextLayout.totalShots);
    const stripStyleLabel = document.getElementById('stripStyleLabel');
    if (stripStyleLabel) stripStyleLabel.textContent = `${nextLayout.name} Strip`;

    if (resetSession) {
      this._reset();
    } else {
      this.filmStrip.reset(nextLayout.totalShots);
    }
    this.dom.statusLine.textContent = `${nextLayout.name} selected. Capture ${nextLayout.totalShots} frames.`;
  }

  /** @private */
  _markBestShot(index) {
    if (index < 0 || index >= this.shots.length) return;
    this.bestShotIndex = index;
    this.filmStrip.markBestShot(index);
    this.dom.statusLine.textContent = `Best shot marked: frame ${index + 1}.`;
  }

  /** @private */
  _onDownloadPhotoPressed() {
    const dataUrl = this.shots.length > 0
      ? this.shots[this.shots.length - 1]
      : this.processor.captureFrame(this.dom.video, this.dom.captureCanvas, this.currentFilter);
    this._triggerDownload(dataUrl, `sticker-studio-photo-${this.shots.length || 1}.jpg`);
  }

  /** @private */
  async _onDownloadVideoPressed() {
    if (this.shots.length !== this.layout.totalShots || this.shots.length < 2) {
      this.dom.statusLine.textContent = 'Complete your photo strip before downloading its video.';
      return;
    }

    try {
      this.dom.videoBtn.disabled = true;
      this.dom.statusLine.textContent = 'Recording your animated photo strip...';
      const blob = await this.processor.buildVideo(this.shots, this._getStripOptions());
      const objectUrl = URL.createObjectURL(blob);
      const isMp4 = blob.type.startsWith('video/mp4');
      const extension = isMp4 ? 'mp4' : 'webm';
      this._triggerDownload(objectUrl, `sticker-studio-strip.${extension}`, true);
      this.dom.statusLine.textContent = `Your photo strip ${extension.toUpperCase()} video is ready.`;
    } catch (err) {
      this.dom.statusLine.textContent = `Could not create video: ${err.message}`;
    } finally {
      this._updateExportButtons();
    }
  }

  /** @private */
  _setDesign(designId) {
    if (!STRIP_DESIGNS.some((design) => design.id === designId)) return;
    this.designId = designId;
    this._applyDesign();
    try {
      window.localStorage.setItem('stickerStudioDesign', designId);
    } catch (err) {
      // localStorage can be unavailable in file:// contexts.
    }
  }

  /** @private */
  _applyDesign() {
    this.dom.filmStripEl.classList.remove(...STRIP_DESIGNS.map((design) => `theme-${design.id}`));
    this.dom.filmStripEl.classList.add(`theme-${this.designId}`);
  }

  /** @private */
  _getStripOptions() {
    return {
      bestShotIndex: this.bestShotIndex,
      designId: this.designId,
      stickers: this.stickers,
      footerText: this.filmStrip.dateEl.textContent,
      layoutId: this.layout.id,
    };
  }

  /** @private */
  _addStickerToNextShot(emoji) {
    if (this.shots.length === 0) {
      this.dom.stickerNote.textContent = 'Take your photos first, then decorate your strip.';
      return;
    }
    const index = this.nextStickerTarget % this.shots.length;
    this.nextStickerTarget += 1;
    const existing = this.stickers[index] || [];
    const x = 0.2 + (existing.length % 4) * 0.19;
    const y = 0.2 + (Math.floor(existing.length / 4) % 3) * 0.22;
    this._storeSticker(index, emoji, x, y);
  }

  /** @private */
  _addSticker(index, emoji, clientX, clientY) {
    if (index >= this.shots.length) {
      this.dom.stickerNote.textContent = 'Drop stickers onto a photo you have taken.';
      return;
    }
    const slot = this.dom.filmStripEl.querySelector(`[data-slot="${index}"]`);
    const bounds = slot.getBoundingClientRect();
    const x = Math.min(0.92, Math.max(0.08, (clientX - bounds.left) / bounds.width));
    const y = Math.min(0.92, Math.max(0.08, (clientY - bounds.top) / bounds.height));
    this._storeSticker(index, emoji, x, y);
  }

  /** @private */
  _storeSticker(index, emoji, x, y) {
    if (!this.stickers[index]) this.stickers[index] = [];
    this.stickers[index].push({ id: this.nextStickerId++, emoji, x, y });
    this.filmStrip.renderStickers(index, this.stickers[index]);
    this.dom.stickerNote.textContent = `Sticker added to frame ${index + 1}. Drag it to move, or tap it to remove.`;
  }

  /** @private */
  _removeSticker(index, stickerId) {
    this.stickers[index] = (this.stickers[index] || []).filter((sticker) => sticker.id !== stickerId);
    this.filmStrip.renderStickers(index, this.stickers[index]);
    this.dom.stickerNote.textContent = `Sticker removed from frame ${index + 1}.`;
  }

  /** @private */
  _beginStickerDrag(event) {
    const button = event.target.closest('.placed-sticker');
    if (!button || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const slot = button.closest('[data-slot]');
    const stickerId = Number(button.dataset.stickerId);
    if (!slot || !Number.isInteger(stickerId)) return;
    const sourceIndex = Number(slot.dataset.slot);
    const sticker = (this.stickers[sourceIndex] || []).find((item) => item.id === stickerId);
    if (!sticker) return;

    event.preventDefault();
    const preview = button.cloneNode(true);
    preview.classList.add('sticker-drag-preview');
    preview.style.position = 'fixed';
    preview.style.left = `${event.clientX}px`;
    preview.style.top = `${event.clientY}px`;
    document.body.appendChild(preview);
    button.style.opacity = '0.35';
    this.activeStickerDrag = {
      pointerId: event.pointerId,
      sourceIndex,
      stickerId,
      button,
      preview,
      moved: false,
    };
    button.setPointerCapture(event.pointerId);
  }

  /** @private */
  _moveStickerDrag(event) {
    const drag = this.activeStickerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.moved = true;
    drag.preview.style.left = `${event.clientX}px`;
    drag.preview.style.top = `${event.clientY}px`;
  }

  /** @private */
  _finishStickerDrag(event) {
    const drag = this.activeStickerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.frame-slot[data-slot]');
    const targetIndex = target && this.dom.filmStripEl.contains(target)
      ? Number(target.dataset.slot)
      : -1;

    drag.preview.remove();
    drag.button.style.opacity = '';
    this.activeStickerDrag = null;
    if (!drag.moved) return;
    if (targetIndex < 0 || targetIndex >= this.shots.length) {
      drag.button.dataset.suppressClick = 'true';
      window.setTimeout(() => delete drag.button.dataset.suppressClick, 0);
      return;
    }

    const bounds = target.getBoundingClientRect();
    const x = Math.min(0.95, Math.max(0.05, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(0.95, Math.max(0.05, (event.clientY - bounds.top) / bounds.height));
    const source = this.stickers[drag.sourceIndex] || [];
    const stickerIndex = source.findIndex((item) => item.id === drag.stickerId);
    if (stickerIndex < 0) return;
    const [sticker] = source.splice(stickerIndex, 1);
    sticker.x = x;
    sticker.y = y;
    if (!this.stickers[targetIndex]) this.stickers[targetIndex] = [];
    this.stickers[targetIndex].push(sticker);
    this.filmStrip.renderStickers(drag.sourceIndex, source);
    if (targetIndex !== drag.sourceIndex) {
      this.filmStrip.renderStickers(targetIndex, this.stickers[targetIndex]);
    }
    this.dom.stickerNote.textContent = `Sticker moved to frame ${targetIndex + 1}.`;
  }

  /** @private */
  _onTimerChanged(nextSeconds) {
    this.countdownSeconds = nextSeconds;
    this.dom.statusLine.textContent = `Timer set to ${nextSeconds} seconds.`;
  }

  /** @private */
  _triggerDownload(href, filename, revokeUrl = false) {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (revokeUrl) window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  /** @private */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
