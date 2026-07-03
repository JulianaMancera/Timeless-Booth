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
  TOTAL_SHOTS: 4,
  DEFAULT_COUNTDOWN_SECONDS: 3,
  FLASH_DURATION_MS: 70,
  POST_SHOT_DELAY_MS: 600,
});

class PhotoBooth {
  constructor() {
    this.state = BoothState.IDLE;
    /** @type {string[]} */
    this.shots = [];

    this._cacheDom();

    this.camera = new CameraManager(this.dom.video);
    this.processor = new VintageProcessor(this.dom.noiseCanvas);
    this.filmStrip = new FilmStrip(this.dom.filmStripEl, this.dom.stripDate);
    this.currentFilter = 'vintage';
    this.countdownSeconds = SESSION_CONFIG.DEFAULT_COUNTDOWN_SECONDS;

    this._bindEvents();
    this._applyFilterToPreview();
    window.setTimeout(() => {
      void this._enableCamera();
    }, 180);
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
      downloadPhotoBtn: byId('downloadPhotoBtn'),
      gifBtn: byId('gifBtn'),
      timerSelect: byId('timerSelect'),
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
    this.dom.gifBtn.addEventListener('click', () => this._onDownloadGifPressed());
    this.dom.filterSelect.addEventListener('change', (e) => this._onFilterChanged(e.target.value));
    this.dom.timerSelect.addEventListener('change', (e) => this._onTimerChanged(Number(e.target.value)));
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

    for (let i = 0; i < SESSION_CONFIG.TOTAL_SHOTS; i++) {
      this.dom.shotNum.textContent = String(i + 1);
      this.dom.statusLine.textContent = `Shot ${i + 1} of ${SESSION_CONFIG.TOTAL_SHOTS} — get ready...`;
      await this._countdown(this.countdownSeconds);

      this._setState(BoothState.CAPTURING);
      await this._flash();
      const dataUrl = this.processor.captureFrame(this.dom.video, this.dom.captureCanvas, this.currentFilter);
      this.shots.push(dataUrl);
      this.filmStrip.placeShot(i, dataUrl);
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
    this.filmStrip.reset(SESSION_CONFIG.TOTAL_SHOTS);
    this.dom.downloadBtn.classList.remove('ready');
    this._updateExportButtons();
    this.dom.frameCounter.hidden = true;
    this.dom.statusLine.textContent = 'Camera ready. Press the shutter when you are.';
    this.dom.startBtn.textContent = 'Begin Countdown';
    this._setState(BoothState.READY);
  }

  /** @private */
  _updateExportButtons() {
    const hasShots = this.shots.length > 0;
    const canDownloadStrip = this.shots.length === SESSION_CONFIG.TOTAL_SHOTS;
    this.dom.downloadPhotoBtn.disabled = !hasShots;
    this.dom.gifBtn.disabled = this.shots.length < 2;
    this.dom.downloadBtn.disabled = !canDownloadStrip;
    this.dom.downloadBtn.classList.toggle('ready', canDownloadStrip);
  }

  /** @private */
  async _onDownloadPressed() {
    if (this.shots.length < SESSION_CONFIG.TOTAL_SHOTS) return;
    const dataUrl = await this.processor.buildStrip(this.shots, this.dom.stripCanvas);
    this._triggerDownload(dataUrl, 'timeless-booth-strip.png');
  }

  /** @private */
  _onDownloadPhotoPressed() {
    const dataUrl = this.shots.length > 0
      ? this.shots[this.shots.length - 1]
      : this.processor.captureFrame(this.dom.video, this.dom.captureCanvas, this.currentFilter);
    this._triggerDownload(dataUrl, `timeless-booth-photo-${this.shots.length || 1}.jpg`);
  }

  /** @private */
  async _onDownloadGifPressed() {
    if (this.shots.length < 2) {
      this.dom.statusLine.textContent = 'Capture at least two frames to build a GIF.';
      return;
    }

    try {
      this.dom.statusLine.textContent = 'Building your GIF...';
      const blob = await this.processor.buildGif(this.shots, this.currentFilter);
      const objectUrl = URL.createObjectURL(blob);
      this._triggerDownload(objectUrl, 'timeless-booth.gif', true);
      this.dom.statusLine.textContent = 'GIF export ready.';
    } catch (err) {
      this.dom.statusLine.textContent = `Could not create GIF: ${err.message}`;
    }
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
    if (revokeUrl) URL.revokeObjectURL(href);
  }

  /** @private */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
