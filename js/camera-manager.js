'use strict';

/**
 * camera-manager.js
 *
 * Wraps getUserMedia lifecycle: acquisition, device listing, and
 * teardown. Never touches the DOM beyond the <video> element it's
 * handed in the constructor — no button wiring, no state machine.
 *
 * Loaded as a plain script (no bundler), so it attaches `CameraManager`
 * to the top-level scope for booth-main.js to consume. Load this file
 * before photo-booth.js.
 */
class CameraManager {
  /** @param {HTMLVideoElement} videoEl */
  constructor(videoEl) {
    this.videoEl = videoEl;
    /** @type {MediaStream|null} */
    this.stream = null;
  }

  /**
   * Requests camera access and binds it to the video element.
   * @param {string} [deviceId] optional specific device to use
   * @returns {Promise<void>}
   * @throws {Error} if permission is denied or no camera exists
   */
  async start(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support camera access.');
    }
    this.stop();

    const videoConstraints = {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 960 },
    };
    if (deviceId) videoConstraints.deviceId = { exact: deviceId };

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false,
    });
    this.videoEl.muted = true;
    this.videoEl.autoplay = true;
    this.videoEl.playsInline = true;
    this.videoEl.setAttribute('playsinline', '');
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play().catch(() => {}); // autoplay guard
  }

  /** Releases all active tracks. */
  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  /**
   * Lists available video input devices. Labels are only populated
   * once permission has already been granted at least once.
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async listVideoDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  get isActive() {
    return Boolean(this.stream);
  }
}
