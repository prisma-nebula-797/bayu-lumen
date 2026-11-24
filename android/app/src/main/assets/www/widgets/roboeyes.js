import { h, tp } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- robot eyes
// Two OLED-style robot eyes and a mouth, like the ones people build with an Arduino and a small screen. They blink,
// look around and, with "Follow me with the front camera" on, turn towards whoever is in front of the phone. After a
// while without a touch they start fooling around. The camera frames are looked at on the phone, in this widget, and
// never stored or sent anywhere; the camera is off unless the option is ticked, and stops while the panel is hidden.

export const EYE_COLOURS = { cyan: '#38e8ff', white: '#f2f6ff', amber: '#ffb000', green: '#5dff8a', pink: '#ff7ad9' };
// The antics, one at a time, while nobody has touched the panel for a while.
export const ANTICS = ['lookAround', 'yawn', 'sleep', 'wink', 'dizzy', 'love', 'laugh', 'surprised', 'rollEyes', 'curious'];

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
 * person like the eyes do, so its left is their right: x is mirrored.
 */
export const lookAt = (x, y) => ({ x: clamp((0.5 - x) * 2.2, -1, 1), y: clamp((y - 0.45) * 2.2, -1, 1) });

// A refused (or missing) camera stays refused until the app reloads the panel: the layout is rebuilt when settings
// change, and asking again each time would bring Android's prompt back over and over.
let cameraRefused = null;

// The front camera, small and grey, for the tracker. Uses the FaceDetector (Shape Detection API) when the WebView has
// one, otherwise follows movement.
function cameraTracker(onTarget, onState) {
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
        const m = motionCentroid(prev, grey, W_, H_);
        if (m.count > 12) onTarget(m.x, m.y, 'motion');
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
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 160 }, height: { ideal: 120 }, frameRate: { ideal: 10 } }, audio: false });
      if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      video.srcObject = s;
      await video.play().catch(() => {});
      prev = null;
      timer = setInterval(sample, 220);
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

// One eye: a rounded block that moves, squashes and changes shape with the mood.
function drawEye(g, cx, cy, w, hgt, eye, colour) {
  const { open, shape, squint } = eye;
  g.fillStyle = colour;
  g.strokeStyle = colour;
  g.shadowColor = colour;
  g.shadowBlur = w * 0.18;
  if (shape === 'heart') {
    const s = Math.min(w, hgt) * 0.55;
    g.beginPath();
    g.moveTo(cx, cy + s * 0.9);
    g.bezierCurveTo(cx - s * 1.6, cy - s * 0.2, cx - s * 0.7, cy - s * 1.3, cx, cy - s * 0.45);
    g.bezierCurveTo(cx + s * 0.7, cy - s * 1.3, cx + s * 1.6, cy - s * 0.2, cx, cy + s * 0.9);
    g.fill();
    return;
  }
  if (shape === 'x') {
    const s = Math.min(w, hgt) * 0.38;
    g.lineWidth = w * 0.14; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - s, cy - s); g.lineTo(cx + s, cy + s); g.moveTo(cx + s, cy - s); g.lineTo(cx - s, cy + s); g.stroke();
    return;
  }
  if (shape === 'spiral') {
    g.lineWidth = w * 0.08; g.lineCap = 'round';
    g.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.2) {
      const r = (a / (Math.PI * 6)) * Math.min(w, hgt) * 0.48;
      const ang = a + eye.spin;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    return;
  }
  const eh = Math.max(hgt * open, w * 0.08);
  if (shape === 'happy') {
    // ^ ^ : an arch
    g.lineWidth = w * 0.16; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy + hgt * 0.18, w * 0.38, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    return;
  }
  const r = Math.min(w, eh) * 0.28;
  const x = cx - w / 2, y = cy - eh / 2;
  // a lid across the top (tired, sleepy, squinting): only the part below it is drawn, glow included
  g.save();
  if (squint > 0) { g.beginPath(); g.rect(x - w, y + eh * squint, w * 3, eh * 2); g.clip(); }
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + eh - r); g.quadraticCurveTo(x + w, y + eh, x + w - r, y + eh);
  g.lineTo(x + r, y + eh); g.quadraticCurveTo(x, y + eh, x, y + eh - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.fill();
  g.restore();
}

function drawMouth(g, cx, cy, w, mouth, colour, t) {
  g.strokeStyle = colour; g.fillStyle = colour; g.lineCap = 'round'; g.lineWidth = Math.max(2, w * 0.06);
  g.shadowColor = colour; g.shadowBlur = w * 0.08;
  g.beginPath();
  switch (mouth) {
    case 'smile': g.arc(cx, cy - w * 0.25, w * 0.32, Math.PI * 0.2, Math.PI * 0.8); g.stroke(); break;
    case 'grin': g.moveTo(cx - w * 0.36, cy - w * 0.05); g.quadraticCurveTo(cx, cy + w * 0.32, cx + w * 0.36, cy - w * 0.05); g.closePath(); g.fill(); break;
    case 'o': g.ellipse(cx, cy, w * 0.11, w * 0.14, 0, 0, Math.PI * 2); g.stroke(); break;
    case 'yawn': g.ellipse(cx, cy, w * 0.14, w * 0.2, 0, 0, Math.PI * 2); g.fill(); break;
    case 'small': g.moveTo(cx - w * 0.08, cy); g.lineTo(cx + w * 0.08, cy); g.stroke(); break;
    case 'wavy':
      for (let i = 0; i <= 16; i++) { const x = cx - w * 0.3 + (i / 16) * w * 0.6, y = cy + Math.sin(i * 1.2 + t / 120) * w * 0.035; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke(); break;
    case 'smirk': g.moveTo(cx - w * 0.2, cy + w * 0.02); g.quadraticCurveTo(cx + w * 0.1, cy + w * 0.08, cx + w * 0.26, cy - w * 0.08); g.stroke(); break;
    default: g.moveTo(cx - w * 0.26, cy); g.quadraticCurveTo(cx, cy + w * 0.06, cx + w * 0.26, cy); g.stroke();
  }
}

// What each mood does to the eyes and the mouth. eyes: [left, right] overrides, mouth: the shape.
const MOODS = {
  neutral: { mouth: 'line' },
  happy: { eyes: [{ shape: 'happy' }, { shape: 'happy' }], mouth: 'smile' },
  surprised: { scale: 1.18, mouth: 'o' },
  tired: { eyes: [{ squint: 0.5 }, { squint: 0.5 }], mouth: 'small' },
  sleep: { eyes: [{ open: 0.08 }, { open: 0.08 }], mouth: 'small', zzz: true },
  yawn: { eyes: [{ squint: 0.6 }, { squint: 0.6 }], mouth: 'yawn' },
  wink: { eyes: [{}, { shape: 'happy' }], mouth: 'smirk' },
  dizzy: { eyes: [{ shape: 'spiral' }, { shape: 'spiral' }], mouth: 'wavy' },
  love: { eyes: [{ shape: 'heart' }, { shape: 'heart' }], mouth: 'smile' },
  laugh: { eyes: [{ shape: 'happy' }, { shape: 'happy' }], mouth: 'grin', bounce: true },
  curious: { eyes: [{ scaleY: 0.75 }, { scaleY: 1.2 }], mouth: 'smirk' },
  dead: { eyes: [{ shape: 'x' }, { shape: 'x' }], mouth: 'wavy' },
};

// The antics: a mood, where to look over time, and how long.
function antic(name) {
  switch (name) {
    case 'lookAround': return { mood: 'neutral', ms: 4200, look: (f) => ({ x: Math.sin(f * Math.PI * 2) * 0.95, y: Math.sin(f * Math.PI * 4) * 0.25 }) };
    case 'yawn': return { mood: 'yawn', ms: 3200, look: () => ({ x: 0, y: -0.5 }) };
    case 'sleep': return { mood: 'sleep', ms: 6500, look: () => ({ x: 0, y: 0.6 }) };
    case 'wink': return { mood: 'wink', ms: 1800, look: () => ({ x: 0.2, y: 0 }) };
    case 'dizzy': return { mood: 'dizzy', ms: 3500, look: (f) => ({ x: Math.cos(f * 20) * 0.3, y: Math.sin(f * 20) * 0.3 }) };
    case 'love': return { mood: 'love', ms: 3000, look: () => ({ x: 0, y: -0.1 }) };
    case 'laugh': return { mood: 'laugh', ms: 2800, look: () => ({ x: 0, y: 0 }) };
    case 'surprised': return { mood: 'surprised', ms: 1800, look: () => ({ x: 0, y: -0.2 }) };
    case 'rollEyes': return { mood: 'tired', ms: 2600, look: (f) => ({ x: Math.cos(f * Math.PI * 2 - Math.PI / 2) * 0.9, y: Math.sin(f * Math.PI * 2 - Math.PI / 2) * 0.9 }) };
    case 'curious': return { mood: 'curious', ms: 3000, look: (f) => ({ x: f < 0.5 ? -0.7 : 0.7, y: 0.1 }) };
    default: return { mood: 'neutral', ms: 1500, look: () => ({ x: 0, y: 0 }) };
  }
}

W.roboeyes = {
  bare: true, needs: [],
  create(box, { o }) {
    const colour = EYE_COLOURS[o.color] || EYE_COLOURS.cyan;
    const showMouth = o.mouth !== false;
    const idleMs = clamp(Number(o.idle) || 10, 1, 120) * 60_000;
    const canvas = document.createElement('canvas');
    canvas.className = 're-canvas';
    const status = h('div', 're-status');
    box.append(canvas, status);
    const g = canvas.getContext('2d');

    // state: where the eyes look (smoothed), the mood, the antic running, blinking
    let look = { x: 0, y: 0 }, target = { x: 0, y: 0 }, mood = 'neutral', moodUntil = 0;
    let act = null, actStart = 0, nextAntic = 0, lastTouch = Date.now(), seen = 0;
    let blinkAt = Date.now() + 1200 + Math.random() * 3500, blinkUntil = 0, spin = 0, raf = 0, last = 0, visible = true, destroyed = false;
    box.dataset.mood = mood;

    const setMood = (m, ms) => { mood = m; moodUntil = ms ? Date.now() + ms : 0; box.dataset.mood = m; };
    const touched = () => {
      const wasIdle = act !== null || Date.now() - lastTouch > idleMs;
      lastTouch = Date.now();
      if (wasIdle) { act = null; box.dataset.antic = ''; setMood('surprised', 1400); }
    };
    // any touch on the panel counts, not only on this widget
    window.addEventListener('pointerdown', touched, true);
    window.addEventListener('keydown', touched, true);

    const tracker = o.camera === true ? cameraTracker((x, y, how) => {
      target = lookAt(x, y);
      seen = Date.now();
      box.dataset.tracking = how;
    }, (state) => {
      box.dataset.camera = state;
      status.textContent = state === 'denied' ? tp('Camera not allowed') : state === 'unavailable' ? tp('No camera') : '';
    }) : null;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(box.clientWidth * dpr)), hh = Math.max(1, Math.round(box.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
      return [w, hh];
    }

    function frame(now) {
      raf = 0;
      if (destroyed || !visible || document.hidden) return;
      // about 30 frames a second is plenty for eyes, and half the work of the display's rate
      if (now - last < 33) { raf = requestAnimationFrame(frame); return; }
      last = now;
      const t = Date.now();

      // antics after a while without a touch
      if (t - lastTouch > idleMs) {
        if (!act && t >= nextAntic) {
          const name = ANTICS[Math.floor(Math.random() * ANTICS.length)];
          act = { name, ...antic(name) };
          actStart = t;
          box.dataset.antic = name;
          setMood(act.mood);
        }
        if (act) {
          const f = (t - actStart) / act.ms;
          if (f >= 1) { act = null; box.dataset.antic = ''; setMood('neutral'); nextAntic = t + 1500 + Math.random() * 3500; }
          else target = act.look(f);
        }
      } else if (!tracker || t - seen > 4000) {
        // nobody tracked: glance around now and then, then come back
        if (Math.random() < 0.006) target = { x: (Math.random() - 0.5) * 1.6, y: (Math.random() - 0.5) * 0.8 };
        else if (Math.random() < 0.01) target = { x: 0, y: 0 };
      }
      if (moodUntil && t > moodUntil) setMood('neutral');

      // blinking (not while asleep or with shaped eyes)
      if (t >= blinkAt) { blinkUntil = t + 140; blinkAt = t + 2500 + Math.random() * 4000; }
      const blinking = t < blinkUntil && !['sleep', 'happy', 'love', 'dizzy', 'laugh'].includes(mood);

      look.x = lerp(look.x, target.x, 0.18);
      look.y = lerp(look.y, target.y, 0.18);
      spin += 0.25;

      const [w, hh] = resize();
      g.clearRect(0, 0, w, hh);
      const m = MOODS[mood] || MOODS.neutral;
      const unit = Math.min(w / 2.6, hh / (showMouth ? 2.05 : 1.4));
      const eyeW = unit * 0.78 * (m.scale || 1), eyeH = unit * 0.95 * (m.scale || 1);
      const bounce = m.bounce ? Math.abs(Math.sin(t / 110)) * unit * 0.06 : 0;
      const cy = hh * (showMouth ? 0.4 : 0.5) + look.y * unit * 0.22 - bounce;
      const gap = unit * 0.62;
      for (const [i, side] of [[0, -1], [1, 1]]) {
        const over = m.eyes?.[i] || {};
        const eye = { open: blinking ? 0.08 : (over.open ?? 1), shape: over.shape || 'block', squint: over.squint || 0, spin: spin * (side) };
        const sy = over.scaleY || 1;
        drawEye(g, w / 2 + side * gap + look.x * unit * 0.32, cy, eyeW, eyeH * sy, eye, colour);
      }
      if (showMouth) drawMouth(g, w / 2 + look.x * unit * 0.12, cy + eyeH * 0.5 + unit * 0.34 + bounce, unit * 1.2, m.mouth, colour, t);
      if (m.zzz) {
        g.shadowBlur = 0; g.fillStyle = colour;
        const s = unit * 0.22, p = (t / 900) % 1;
        g.font = `700 ${Math.round(s)}px sans-serif`;
        g.globalAlpha = 1 - p;
        g.fillText('Z', w / 2 + gap * 1.6, cy - eyeH * 0.6 - p * unit * 0.4);
        g.font = `700 ${Math.round(s * 0.7)}px sans-serif`;
        g.fillText('z', w / 2 + gap * 2.0, cy - eyeH * 0.9 - p * unit * 0.4);
        g.globalAlpha = 1;
      }
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
