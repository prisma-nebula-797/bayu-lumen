import { h, tp } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- robot eyes
// Robot eyes like the ones people build with an Arduino and a 128 × 64 OLED (FluxGarage RoboEyes style): rounded eye
// blocks drawn in a small pixel buffer and scaled up sharp, with eyelids for the moods, curious eyes that grow when they
// look aside, and a mouth. They blink, glance around and, with "Follow me with the front camera" on, turn towards whoever
// is in front of the phone. Every few seconds they play an antic. The camera frames are looked at on the phone, in this
// widget, and never stored or sent anywhere; the camera is off unless the option is ticked, and stops while the panel is
// hidden.

export const EYE_COLOURS = { cyan: '#38e8ff', white: '#f2f6ff', amber: '#ffb000', green: '#5dff8a', pink: '#ff7ad9' };
export const ANTICS = ['lookAround', 'sleepy', 'yawn', 'sleep', 'wink', 'dizzy', 'love', 'laugh', 'surprised', 'rollEyes', 'curious',
  'tv', 'angry', 'confused', 'nervous', 'thinking', 'scan', 'peek', 'sneeze', 'sing', 'shy'];

// How the camera tracker behaves at each sensitivity: how often it looks (ms), the brightness change that counts as
// movement, how many pixels must change, how fast the eyes follow and how far they turn.
export const SENSITIVITY = {
  high: { every: 90, threshold: 14, pixels: 4, follow: 0.42, gain: 3.0 },
  normal: { every: 160, threshold: 24, pixels: 10, follow: 0.26, gain: 2.4 },
  low: { every: 260, threshold: 34, pixels: 18, follow: 0.16, gain: 2.0 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Where the movement is in two small grey frames: the centre of the pixels that changed, as 0..1 of the frame, and how
 * many changed. Exported for the tests. `threshold` is the change in brightness (0..255) that counts.
 */
export function motionCentroid(prev, cur, width, height, threshold = 28) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (Math.abs(cur[i] - prev[i]) > threshold) { sx += x; sy += y; n++; }
    }
  }
  return n ? { x: (sx / n + 0.5) / width, y: (sy / n + 0.5) / height, count: n } : { x: 0.5, y: 0.5, count: 0 };
}

/**
 * Where to look, -1..1 on each axis, for a point at (x, y) in the front camera's frame (0..1). The camera faces the
 * person like the eyes do, so its left is their right: x is mirrored. `gain` is how far the eyes turn for an offset.
 */
export const lookAt = (x, y, gain = 2.2) => ({ x: clamp((0.5 - x) * gain, -1, 1), y: clamp((y - 0.45) * gain, -1, 1) });

// A refused (or missing) camera stays refused until the app reloads the panel: the layout is rebuilt when settings
// change, and asking again each time would bring Android's prompt back over and over.
let cameraRefused = null;

// The front camera, small and grey, for the tracker. Uses the FaceDetector (Shape Detection API) when the WebView has
// one, otherwise follows movement.
function cameraTracker(sens, onTarget, onState) {
  const W_ = 40, H_ = 30;
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
  const canvas = document.createElement('canvas');
  canvas.width = W_; canvas.height = H_;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const faces = typeof window.FaceDetector === 'function' ? (() => { try { return new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); } catch (_) { return null; } })() : null;
  let stream = null, timer = null, prev = null, busy = false, stopped = false, starting = false;

  async function sample() {
    if (busy || !stream || video.readyState < 2) return;
    busy = true;
    try {
      if (faces) {
        const found = await faces.detect(video);
        if (found[0]) {
          const b = found[0].boundingBox;
          onTarget((b.x + b.width / 2) / video.videoWidth, (b.y + b.height / 2) / video.videoHeight, 'face');
          return;
        }
      }
      ctx.drawImage(video, 0, 0, W_, H_);
      const px = ctx.getImageData(0, 0, W_, H_).data;
      const grey = new Uint8ClampedArray(W_ * H_);
      for (let i = 0; i < grey.length; i++) grey[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
      if (prev) {
        const m = motionCentroid(prev, grey, W_, H_, sens.threshold);
        if (m.count >= sens.pixels) onTarget(m.x, m.y, 'motion');
      }
      prev = grey;
    } catch (_) {
      // a detector that fails once (a frame not ready yet) just skips the frame
    } finally { busy = false; }
  }

  async function start() {
    stopped = false;
    if (cameraRefused) { onState(cameraRefused); return; }
    if (stream || starting) return;
    if (!navigator.mediaDevices?.getUserMedia) { cameraRefused = 'unavailable'; onState('unavailable'); return; }
    starting = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 160 }, height: { ideal: 120 }, frameRate: { ideal: 15 } }, audio: false });
      if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      video.srcObject = s;
      await video.play().catch(() => {});
      prev = null;
      timer = setInterval(sample, sens.every);
      onState('on');
    } catch (_) {
      cameraRefused = 'denied';
      onState('denied');
    } finally { starting = false; }
  }
  function stop() {
    stopped = true;
    clearInterval(timer); timer = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    video.srcObject = null;
  }
  return { start, stop };
}

// ---------------------------------------------------------------- drawing (in OLED pixels)
function rrect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// Cuts a shape out of what is drawn (eyelids, the happy lower lid), like RoboEyes draws them in black.
function cut(g, draw) {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  draw();
  g.fill();
  g.restore();
}

/**
 * One eye in OLED pixels. `side` is -1 for the left eye, 1 for the right. Lids: tired (outer corner down), angry (inner
 * corner down), happy (a lower lid from below), plus special shapes for some antics.
 */
function drawEye(g, cx, cy, w, h, e, side, s) {
  const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
  if (e.shape === 'heart') {
    const k = Math.min(w, h) * 0.5;
    g.beginPath();
    g.moveTo(cx, cy + k * 0.9);
    g.bezierCurveTo(cx - k * 1.7, cy - k * 0.15, cx - k * 0.75, cy - k * 1.35, cx, cy - k * 0.45);
    g.bezierCurveTo(cx + k * 0.75, cy - k * 1.35, cx + k * 1.7, cy - k * 0.15, cx, cy + k * 0.9);
    g.fill();
    return;
  }
  if (e.shape === 'x' || e.shape === 'gt' || e.shape === 'lt') {
    const k = Math.min(w, h) * 0.38;
    g.lineWidth = Math.max(2, 5 * s); g.lineCap = 'square';
    g.beginPath();
    if (e.shape === 'x') { g.moveTo(cx - k, cy - k); g.lineTo(cx + k, cy + k); g.moveTo(cx + k, cy - k); g.lineTo(cx - k, cy + k); }
    else { const d = e.shape === 'gt' ? 1 : -1; g.moveTo(cx - k * d, cy - k); g.lineTo(cx + k * d, cy); g.lineTo(cx - k * d, cy + k); }
    g.stroke();
    return;
  }
  if (e.shape === 'spiral') {
    g.lineWidth = Math.max(1.5, 3 * s);
    g.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.25) {
      const r = (a / (Math.PI * 6)) * Math.min(w, h) * 0.5;
      const px = cx + Math.cos(a + e.spin) * r, py = cy + Math.sin(a + e.spin) * r;
      if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    return;
  }
  const eh = Math.max(2 * s, h * e.open);
  const ey = Math.round(cy - eh / 2);
  rrect(g, x, ey, Math.round(w), Math.round(eh), 8 * s * Math.min(1, eh / h + 0.3));
  g.fill();
  // RoboEyes lids
  if (e.tired > 0) cut(g, () => { const d = eh * e.tired; const outer = side < 0 ? x : x + w; const inner = side < 0 ? x + w : x; g.moveTo(outer - side * 2, ey - 1); g.lineTo(inner + side * 2, ey - 1); g.lineTo(outer - side * 2, ey + d); });
  if (e.angry > 0) cut(g, () => { const d = eh * e.angry; const outer = side < 0 ? x : x + w; const inner = side < 0 ? x + w : x; g.moveTo(outer - side * 2, ey - 1); g.lineTo(inner + side * 2, ey - 1); g.lineTo(inner + side * 2, ey + d); });
  if (e.happy > 0) cut(g, () => { const top = ey + eh * (1 - e.happy); rrect(g, x - 2, top, w + 4, eh, 8 * s); });
  if (e.lid > 0) cut(g, () => { g.rect(x - 2, ey - 1, w + 4, eh * e.lid + 1); });
}

function drawMouth(g, cx, cy, w, mouth, s, t) {
  g.lineWidth = Math.max(2, 3.5 * s); g.lineCap = 'round';
  g.beginPath();
  switch (mouth) {
    case 'smile': g.arc(cx, cy - w * 0.32, w * 0.42, Math.PI * 0.22, Math.PI * 0.78); g.stroke(); break;
    case 'grin': g.moveTo(cx - w * 0.38, cy - w * 0.06); g.quadraticCurveTo(cx, cy + w * 0.36, cx + w * 0.38, cy - w * 0.06); g.closePath(); g.fill(); break;
    case 'o': g.ellipse(cx, cy, w * 0.1, w * 0.13, 0, 0, Math.PI * 2); g.stroke(); break;
    case 'yawn': g.ellipse(cx, cy, w * 0.13, w * 0.19, 0, 0, Math.PI * 2); g.fill(); break;
    case 'small': g.moveTo(cx - w * 0.08, cy); g.lineTo(cx + w * 0.08, cy); g.stroke(); break;
    case 'frown': g.arc(cx, cy + w * 0.36, w * 0.36, Math.PI * 1.25, Math.PI * 1.75); g.stroke(); break;
    case 'sing': g.ellipse(cx, cy, w * 0.09, w * 0.08 + Math.abs(Math.sin(t / 160)) * w * 0.07, 0, 0, Math.PI * 2); g.fill(); break;
    case 'wavy':
      for (let i = 0; i <= 14; i++) { const px = cx - w * 0.3 + (i / 14) * w * 0.6, py = cy + Math.sin(i * 1.3 + t / 110) * w * 0.04; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke(); break;
    case 'zigzag':
      for (let i = 0; i <= 8; i++) { const px = cx - w * 0.28 + (i / 8) * w * 0.56, py = cy + (i % 2 ? -1 : 1) * w * 0.04; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke(); break;
    case 'smirk': g.moveTo(cx - w * 0.2, cy + w * 0.02); g.quadraticCurveTo(cx + w * 0.1, cy + w * 0.08, cx + w * 0.28, cy - w * 0.08); g.stroke(); break;
    case 'none': break;
    default: g.moveTo(cx - w * 0.24, cy); g.quadraticCurveTo(cx, cy + w * 0.05, cx + w * 0.24, cy); g.stroke();
  }
}

// Small extras some antics draw: a sweat drop, Zzz, a television, thinking dots, music notes, blush.
function drawExtra(g, kind, L, H, s, t, f) {
  g.save();
  switch (kind) {
    case 'zzz': {
      const p = (t / 900) % 1;
      g.globalAlpha = 1 - p;
      g.font = `bold ${Math.round(11 * s)}px monospace`;
      g.fillText('Z', L * 0.8, H * 0.28 - p * 10 * s);
      g.font = `bold ${Math.round(8 * s)}px monospace`;
      g.fillText('z', L * 0.88, H * 0.16 - p * 8 * s);
      break;
    }
    case 'sweat': {
      const y = H * 0.18 + ((t / 30) % (H * 0.3));
      g.beginPath(); g.moveTo(L * 0.86, y - 6 * s); g.quadraticCurveTo(L * 0.86 + 4 * s, y + 1 * s, L * 0.86, y + 3 * s); g.quadraticCurveTo(L * 0.86 - 4 * s, y + 1 * s, L * 0.86, y - 6 * s); g.fill();
      break;
    }
    case 'tv': {
      // a little television in the lower corner, its screen flickering with the "programme"
      const tw = 24 * s, th = 17 * s, tx = 3 * s, ty = H - th - 3 * s;
      g.lineWidth = Math.max(1, 1.5 * s);
      rrect(g, tx, ty, tw, th, 3 * s); g.stroke();
      g.beginPath(); g.moveTo(tx + tw * 0.35, ty); g.lineTo(tx + tw * 0.2, ty - 6 * s); g.moveTo(tx + tw * 0.65, ty); g.lineTo(tx + tw * 0.8, ty - 6 * s); g.stroke();
      const flick = Math.floor(t / 120);
      for (let i = 0; i < 18; i++) {
        const r = ((flick * 37 + i * 53) % 97) / 97;
        if (r > 0.45) g.fillRect(tx + 3 * s + (i % 6) * (tw - 6 * s) / 6, ty + 3 * s + Math.floor(i / 6) * (th - 6 * s) / 3, (tw - 6 * s) / 6 - 1, (th - 6 * s) / 3 - 1);
      }
      break;
    }
    case 'dots': {
      const n = 1 + (Math.floor(t / 350) % 3);
      for (let i = 0; i < n; i++) { g.beginPath(); g.arc(L * 0.72 + i * 7 * s, H * 0.14, 2.2 * s, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'notes': {
      const p = (t / 1200) % 1;
      g.globalAlpha = 1 - p;
      g.font = `bold ${Math.round(12 * s)}px sans-serif`;
      g.fillText('♪', L * 0.78, H * 0.32 - p * 14 * s);
      g.fillText('♫', L * 0.12, H * 0.26 - ((p + 0.5) % 1) * 14 * s);
      break;
    }
    case 'blush': {
      g.lineWidth = Math.max(1, 1.5 * s);
      for (const bx of [L * 0.22, L * 0.7]) for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(bx + i * 4 * s, H * 0.7); g.lineTo(bx + i * 4 * s + 3 * s, H * 0.64); g.stroke(); }
      break;
    }
    case 'achoo': {
      if (f > 0.55) { g.font = `bold ${Math.round(10 * s)}px monospace`; g.fillText('ACHOO!', L * 0.5 - 18 * s, H * 0.14); }
      break;
    }
    case 'vein': {
      g.lineWidth = Math.max(1, 1.5 * s);
      const vx = L * 0.84, vy = H * 0.16, k = 4 * s;
      g.beginPath(); g.moveTo(vx - k, vy - k * 0.3); g.lineTo(vx - k * 0.3, vy - k * 0.3); g.lineTo(vx - k * 0.3, vy - k); g.moveTo(vx + k, vy - k * 0.3); g.lineTo(vx + k * 0.3, vy - k * 0.3); g.lineTo(vx + k * 0.3, vy - k);
      g.moveTo(vx - k, vy + k * 0.3); g.lineTo(vx - k * 0.3, vy + k * 0.3); g.lineTo(vx - k * 0.3, vy + k); g.moveTo(vx + k, vy + k * 0.3); g.lineTo(vx + k * 0.3, vy + k * 0.3); g.lineTo(vx + k * 0.3, vy + k);
      g.stroke();
      break;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- moods and antics
// The face for a mood: lids per eye ([left, right]), a shape, size, shake and the mouth.
const MOODS = {
  neutral: { mouth: 'line' },
  happy: { lids: [{ happy: 0.45 }, { happy: 0.45 }], mouth: 'smile' },
  surprised: { scale: 1.15, mouth: 'o' },
  tired: { lids: [{ tired: 0.45 }, { tired: 0.45 }], mouth: 'small' },
  sleepy: { lids: [{ lid: 0.55 }, { lid: 0.55 }], mouth: 'small' },
  sleep: { lids: [{ open: 0.1 }, { open: 0.1 }], mouth: 'small', extra: 'zzz' },
  yawn: { lids: [{ lid: 0.6 }, { lid: 0.6 }], mouth: 'yawn' },
  wink: { lids: [{}, { happy: 0.75 }], mouth: 'smirk' },
  dizzy: { lids: [{ shape: 'spiral' }, { shape: 'spiral' }], mouth: 'wavy' },
  love: { lids: [{ shape: 'heart' }, { shape: 'heart' }], mouth: 'smile', pulse: true },
  laugh: { lids: [{ happy: 0.6 }, { happy: 0.6 }], mouth: 'grin', shake: 'y' },
  curious: { lids: [{ scaleY: 0.78 }, { scaleY: 1.18 }], mouth: 'smirk' },
  angry: { lids: [{ angry: 0.5 }, { angry: 0.5 }], mouth: 'frown', extra: 'vein' },
  confused: { lids: [{ tired: 0.3 }, { angry: 0.3 }], mouth: 'zigzag', shake: 'x' },
  nervous: { lids: [{ tired: 0.25 }, { tired: 0.25 }], mouth: 'wavy', extra: 'sweat', shake: 'jitter' },
  thinking: { lids: [{ lid: 0.25 }, { lid: 0.25 }], mouth: 'smirk', extra: 'dots' },
  scan: { lids: [{ open: 0.22 }, { open: 0.22 }], mouth: 'line' },
  squeeze: { lids: [{ shape: 'gt' }, { shape: 'lt' }], mouth: 'small' },
  sing: { lids: [{ happy: 0.5 }, { happy: 0.5 }], mouth: 'sing', extra: 'notes', shake: 'y' },
  shy: { lids: [{ happy: 0.35 }, { happy: 0.35 }], mouth: 'small', extra: 'blush' },
  tv: { mouth: 'small', extra: 'tv', scale: 0.82 },
  tvLaugh: { lids: [{ happy: 0.6 }, { happy: 0.6 }], mouth: 'grin', extra: 'tv', shake: 'y', scale: 0.82 },
  tvShock: { scale: 0.95, mouth: 'o', extra: 'tv' },
};

// An antic: moods over time (fraction → mood), where to look, and how long it lasts.
function antic(name) {
  switch (name) {
    case 'lookAround': return { ms: 4500, mood: () => 'neutral', look: (f) => ({ x: Math.sin(f * Math.PI * 2) * 1, y: Math.sin(f * Math.PI * 4) * 0.3 }) };
    case 'sleepy': return { ms: 7000, mood: (f) => (f < 0.25 ? 'tired' : f < 0.7 ? 'sleepy' : f < 0.85 ? 'sleep' : 'surprised'),
      look: (f) => ({ x: 0, y: f < 0.85 ? 0.2 + Math.max(0, Math.sin(f * 18)) * 0.6 : -0.3 }) }; // nodding off, then a jolt awake
    case 'yawn': return { ms: 3400, mood: (f) => (f < 0.75 ? 'yawn' : 'tired'), look: () => ({ x: 0, y: -0.5 }) };
    case 'sleep': return { ms: 7000, mood: () => 'sleep', look: () => ({ x: 0, y: 0.6 }) };
    case 'wink': return { ms: 2000, mood: (f) => (f < 0.7 ? 'wink' : 'happy'), look: () => ({ x: 0.25, y: 0 }) };
    case 'dizzy': return { ms: 3500, mood: () => 'dizzy', look: (f) => ({ x: Math.cos(f * 22) * 0.35, y: Math.sin(f * 22) * 0.35 }) };
    case 'love': return { ms: 3200, mood: () => 'love', look: () => ({ x: 0, y: -0.1 }) };
    case 'laugh': return { ms: 3000, mood: () => 'laugh', look: () => ({ x: 0, y: 0 }) };
    case 'surprised': return { ms: 2000, mood: () => 'surprised', look: () => ({ x: 0, y: -0.25 }) };
    case 'rollEyes': return { ms: 2800, mood: () => 'tired', look: (f) => ({ x: Math.cos(f * Math.PI * 2 - Math.PI / 2), y: Math.sin(f * Math.PI * 2 - Math.PI / 2) }) };
    case 'curious': return { ms: 3200, mood: () => 'curious', look: (f) => ({ x: f < 0.5 ? -0.9 : 0.9, y: 0.1 }) };
    // watching TV: eyes on the little set in the corner, now and then a laugh or a fright at the programme
    case 'tv': return { ms: 8000, mood: (f) => (f > 0.38 && f < 0.5 ? 'tvLaugh' : f > 0.72 && f < 0.8 ? 'tvShock' : 'tv'), look: (f) => ({ x: -0.55 + Math.sin(f * 30) * 0.03, y: 0.35 }) };
    case 'angry': return { ms: 3000, mood: () => 'angry', look: (f) => ({ x: Math.sin(f * 40) * 0.08, y: 0.1 }) };
    case 'confused': return { ms: 3000, mood: () => 'confused', look: (f) => ({ x: Math.sin(f * 14) * 0.5, y: -0.1 }) };
    case 'nervous': return { ms: 3500, mood: () => 'nervous', look: (f) => ({ x: Math.sin(f * 9) * 0.7, y: 0.05 }) };
    case 'thinking': return { ms: 4000, mood: () => 'thinking', look: () => ({ x: 0.55, y: -0.8 }) };
    case 'scan': return { ms: 4000, mood: () => 'scan', look: (f) => ({ x: Math.sin(f * Math.PI * 3) * 1, y: 0 }) };
    // peek: the eyes slide off one side and come back
    case 'peek': return { ms: 3600, mood: (f) => (f > 0.75 ? 'happy' : 'curious'), look: (f) => ({ x: f < 0.5 ? -f * 6 : -3 + (f - 0.5) * 6, y: 0 }) };
    case 'sneeze': return { ms: 2600, mood: (f) => (f < 0.55 ? 'squeeze' : f < 0.75 ? 'surprised' : 'happy'), look: (f) => ({ x: 0, y: f > 0.55 && f < 0.7 ? 0.6 : -0.2 }) };
    case 'sing': return { ms: 4500, mood: () => 'sing', look: (f) => ({ x: Math.sin(f * Math.PI * 4) * 0.4, y: -0.2 }) };
    case 'shy': return { ms: 3000, mood: () => 'shy', look: () => ({ x: -0.6, y: 0.5 }) };
    default: return { ms: 1500, mood: () => 'neutral', look: () => ({ x: 0, y: 0 }) };
  }
}
const anticExtra = { sneeze: 'achoo' };

W.roboeyes = {
  bare: true, needs: [],
  create(box, { o }) {
    const colour = EYE_COLOURS[o.color] || EYE_COLOURS.cyan;
    const showMouth = o.mouth !== false;
    const pixels = o.pixels !== false;
    // antics: one every `every` seconds, once nobody has touched the panel for `idle` minutes (0 = straight away)
    const idleMs = clamp(Number(o.idle ?? 0) || 0, 0, 120) * 60_000;
    const everyMs = clamp(Number(o.every) || 10, 3, 600) * 1000;
    const sens = SENSITIVITY[o.sensitivity] || SENSITIVITY.high;
    const canvas = document.createElement('canvas');
    canvas.className = 're-canvas';
    const status = h('div', 're-status');
    box.append(canvas, status);
    box.classList.toggle('re-pixels', pixels);
    box.style.setProperty('--re-colour', colour);
    const g = canvas.getContext('2d');

    let look = { x: 0, y: 0 }, target = { x: 0, y: 0 }, mood = 'neutral', moodUntil = 0;
    let act = null, actStart = 0, lastAntic = Date.now(), lastTouch = Date.now(), seen = 0;
    let blinkAt = Date.now() + 1200 + Math.random() * 3500, blinkUntil = 0, spin = 0, raf = 0, last = 0, visible = true, destroyed = false;
    box.dataset.mood = mood;

    const setMood = (m, ms) => { if (m !== mood) { mood = m; box.dataset.mood = m; } moodUntil = ms ? Date.now() + ms : 0; };
    const touched = () => {
      lastTouch = Date.now();
      lastAntic = Date.now();
      if (act) { act = null; box.dataset.antic = ''; }
      setMood('surprised', 1200);
    };
    window.addEventListener('pointerdown', touched, true);
    window.addEventListener('keydown', touched, true);

    const tracker = o.camera === true ? cameraTracker(sens, (x, y, how) => {
      target = lookAt(x, y, sens.gain);
      seen = Date.now();
      box.dataset.tracking = how;
    }, (state) => {
      box.dataset.camera = state;
      status.textContent = state === 'denied' ? tp('Camera not allowed') : state === 'unavailable' ? tp('No camera') : '';
    }) : null;

    // the drawing buffer: 128 pixels across like the OLED (sharp when scaled up), or the screen's own pixels
    function size() {
      const bw = Math.max(1, box.clientWidth), bh = Math.max(1, box.clientHeight);
      let L, H;
      if (pixels) { L = 128; H = clamp(Math.round(128 * bh / bw), 40, 256); }
      else { const dpr = window.devicePixelRatio || 1; L = Math.round(bw * dpr); H = Math.round(bh * dpr); }
      if (canvas.width !== L || canvas.height !== H) { canvas.width = L; canvas.height = H; box.style.setProperty('--re-px', `${100 / L}%`); box.style.setProperty('--re-py', `${100 / H}%`); }
      return [L, H];
    }

    function frame(now) {
      raf = 0;
      if (destroyed || !visible || document.hidden) return;
      if (now - last < 33) { raf = requestAnimationFrame(frame); return; }
      last = now;
      const t = Date.now();

      // an antic every few seconds, once the panel has been left alone long enough
      if (!act && t - lastTouch >= idleMs && t - lastAntic >= everyMs) {
        const name = ANTICS[Math.floor(Math.random() * ANTICS.length)];
        act = { name, ...antic(name) };
        actStart = t; lastAntic = t;
        box.dataset.antic = name;
      }
      let f = 0;
      if (act) {
        f = (t - actStart) / act.ms;
        if (f >= 1) { act = null; box.dataset.antic = ''; setMood('neutral'); }
        else { target = act.look(f); setMood(act.mood(f)); }
      }
      if (!act) {
        if (!tracker || t - seen > 2500) {
          // nobody tracked: the RoboEyes idle glance now and then, then back to the middle
          if (Math.random() < 0.008) target = { x: (Math.random() - 0.5) * 1.8, y: (Math.random() - 0.5) * 0.9 };
          else if (Math.random() < 0.012) target = { x: 0, y: 0 };
        }
        if (moodUntil && t > moodUntil) setMood('neutral');
      }

      if (t >= blinkAt) { blinkUntil = t + 130; blinkAt = t + 2200 + Math.random() * 4000; }
      const m = MOODS[mood] || MOODS.neutral;
      const blinking = t < blinkUntil && !m.lids?.some((l) => l.shape || l.open !== undefined) && !['laugh', 'tvLaugh', 'sing'].includes(mood);

      const follow = tracker && !act ? sens.follow : 0.2;
      look.x = lerp(look.x, target.x, follow);
      look.y = lerp(look.y, target.y, follow);
      spin += 0.3;

      const [L, H] = size();
      g.clearRect(0, 0, L, H);
      g.fillStyle = colour; g.strokeStyle = colour;
      const s = Math.min(L / 128, H / (showMouth ? 80 : 64));
      const baseW = 36 * s, baseH = 36 * s, space = 12 * s;
      let ox = 0, oy = 0;
      if (m.shake === 'x') ox = Math.sin(t / 40) * 2.5 * s;
      if (m.shake === 'y') oy = Math.abs(Math.sin(t / 90)) * -3 * s;
      if (m.shake === 'jitter') { ox = (Math.random() - 0.5) * 2 * s; oy = (Math.random() - 0.5) * 2 * s; }
      const pulse = m.pulse ? 1 + Math.sin(t / 140) * 0.08 : 1;
      const scale = (m.scale || 1) * pulse;
      const cy = H * (showMouth ? 0.4 : 0.5) + look.y * 10 * s + oy;
      const cx = L / 2 + look.x * 22 * s + ox;
      for (const [i, side] of [[0, -1], [1, 1]]) {
        const lid = m.lids?.[i] || {};
        // curious RoboEyes: the eye on the side looked at grows when the look is far to that side
        const curious = Math.abs(look.x) > 0.55 && Math.sign(look.x) === side ? 1 + (Math.abs(look.x) - 0.55) * 0.5 : 1;
        const e = { open: blinking ? 0.08 : (lid.open ?? 1), shape: lid.shape, tired: lid.tired || 0, angry: lid.angry || 0, happy: lid.happy || 0, lid: lid.lid || 0, spin: spin * side };
        drawEye(g, cx + side * (baseW / 2 + space / 2), cy, baseW * scale, baseH * scale * (lid.scaleY || 1) * curious, e, side, s);
      }
      if (showMouth) drawMouth(g, L / 2 + look.x * 8 * s + ox, cy + baseH * 0.5 * scale + 13 * s, 40 * s, m.mouth, s, t);
      const extra = m.extra || (act && anticExtra[act.name]);
      if (extra) drawExtra(g, extra, L, H, s, t, f);
      raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && !destroyed) raf = requestAnimationFrame(frame); };

    // the camera and the drawing stop while the widget or the panel is out of sight
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) { tracker?.start(); kick(); } else tracker?.stop();
    }) : null;
    io?.observe(box);
    const onVis = () => { if (document.hidden) tracker?.stop(); else if (visible) { tracker?.start(); kick(); } };
    document.addEventListener('visibilitychange', onVis);
    if (!io) { tracker?.start(); kick(); }

    return {
      update() { kick(); },
      destroy() {
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        tracker?.stop();
        io?.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pointerdown', touched, true);
        window.removeEventListener('keydown', touched, true);
      },
    };
  },
};
