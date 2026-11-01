/* Camera QR scanner shared by the admin check-in screen and the door kiosk.
 * Uses the native BarcodeDetector where available (Chrome, Android) and falls
 * back to jsQR (iPhone Safari, Firefox), loaded only when needed.
 *
 *   const stop = await NadiScanner.start(videoEl, (text) => { … });
 */
(() => {
  'use strict';

  let jsqrPromise = null;
  const loadJsQR = () => {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsqrPromise) {
      jsqrPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/js/jsqr.js';
        s.onload = () => resolve(window.jsQR);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return jsqrPromise;
  };

  async function makeDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          const det = new window.BarcodeDetector({ formats: ['qr_code'] });
          return async (video) => {
            const codes = await det.detect(video);
            return codes.length ? codes[0].rawValue : '';
          };
        }
      } catch { /* fall back */ }
    }
    const jsQR = await loadJsQR();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (video) => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return '';
      // Scan a centred square, downscaled: fast enough on old tablets.
      const side = Math.min(w, h);
      const size = Math.min(side, 640);
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
      const img = ctx.getImageData(0, 0, size, size);
      const code = jsQR(img.data, size, size, { inversionAttempts: 'dontInvert' });
      return code ? code.data : '';
    };
  }

  /**
   * Start scanning. Calls onCode(text) for each new code (the same code is
   * ignored for `repeatMs`). Returns a stop() function.
   */
  async function start(video, onCode, { repeatMs = 4000 } = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no_camera'), { code: 'no_camera' });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const detect = await makeDetector();
    let running = true;
    let busy = false;
    let last = '';
    let lastAt = 0;
    const tick = async () => {
      if (!running) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        try {
          const text = await detect(video);
          const now = Date.now();
          if (text && (text !== last || now - lastAt > repeatMs)) {
            last = text;
            lastAt = now;
            onCode(text);
          }
        } catch { /* ignore a bad frame */ }
        busy = false;
      }
      setTimeout(tick, 120);
    };
    tick();
    return function stop() {
      running = false;
      for (const tr of stream.getTracks()) tr.stop();
      video.srcObject = null;
    };
  }

  /** Short success / error beep (no audio files needed). */
  function beep(ok) {
    try {
      const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = ok ? 880 : 220;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.18 : 0.45));
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + (ok ? 0.2 : 0.5));
    } catch { /* no audio */ }
  }

  window.NadiScanner = { start, beep };
})();
