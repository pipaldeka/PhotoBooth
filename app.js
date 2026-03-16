/* ═══════════════════════════════════════════════════════════
   snapr — app.js
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ─── State ────────────────────────────────────────────────── */
let stream      = null;
let photos      = [];          // array of dataURLs, already filtered
let filterMode  = 'color';     // 'color' | 'bw' | 'vintage'
const TOTAL     = 4;

/* ─── Photo dimensions — strict 3:4 portrait ───────────────── */
const PHOTO_W = 480;
const PHOTO_H = 640;   // 480 × (4/3) — always 3:4

/* ─── CSS filter strings for live preview ─────────────────────
   These drive the <video> element so what you see = what you get.
   The canvas processing then replicates these precisely.          */
const PREVIEW_FILTER = {
  color:   '',
  bw:      'grayscale(1) contrast(1.15) brightness(0.95)',
  vintage: 'sepia(0.55) contrast(1.08) brightness(0.88) saturate(0.75) hue-rotate(-5deg)',
};

/* ══════════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════════ */
async function enterBooth() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('booth').style.display   = 'block';
  await startCamera();
}

function retake() {
  document.getElementById('result').style.display = 'none';
  document.getElementById('booth').style.display  = 'block';
  resetStrip();
  // Re-apply preview filter to fresh video
  applyPreviewFilter();
}

/* ══════════════════════════════════════════════════════════════
   CAMERA
══════════════════════════════════════════════════════════════ */
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const video = document.getElementById('video');
    video.srcObject = stream;
    await new Promise(res => { video.onloadedmetadata = res; });
    video.play();
  } catch (err) {
    alert('Camera access needed — please allow permissions and reload.\n\n' + err.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   FILTER SELECTION
══════════════════════════════════════════════════════════════ */
function setFilter(mode) {
  filterMode = mode;
  applyPreviewFilter();
  ['color', 'bw', 'vintage'].forEach(m => {
    document.getElementById('pill-' + m).classList.toggle('active', m === mode);
  });
}

function applyPreviewFilter() {
  const video = document.getElementById('video');
  if (video) video.style.filter = PREVIEW_FILTER[filterMode] || '';
}

/* ══════════════════════════════════════════════════════════════
   SESSION — 4 photos with countdown
══════════════════════════════════════════════════════════════ */
async function startSession() {
  if (photos.length > 0) resetStrip();

  const btn = document.getElementById('start-btn');
  btn.disabled = true;
  photos = [];

  for (let i = 0; i < TOTAL; i++) {
    await runCountdown();
    await capturePhoto(i);
    if (i < TOTAL - 1) await sleep(700);
  }

  btn.disabled = false;
  document.getElementById('photo-counter').textContent = '';
  showResult();
}

/* Countdown 3-2-1-📸 */
function runCountdown() {
  return new Promise(resolve => {
    const overlay = document.getElementById('countdown-overlay');
    const numEl   = document.getElementById('countdown-number');

    overlay.style.display = 'flex';
    let count = 3;
    numEl.textContent = count;

    const tick = setInterval(() => {
      count--;
      if (count === 0) {
        numEl.textContent = '📸';
        clearInterval(tick);
        setTimeout(() => {
          overlay.style.display = 'none';
          resolve();
        }, 380);
      } else {
        numEl.textContent = count;
        // restart animation
        numEl.style.animation = 'none';
        void numEl.offsetHeight;
        numEl.style.animation = 'pulse 1s ease-in-out';
      }
    }, 1000);
  });
}

/* ══════════════════════════════════════════════════════════════
   CAPTURE — crop to exact 3:4, mirror, apply filter
══════════════════════════════════════════════════════════════ */
async function capturePhoto(index) {
  const video   = document.getElementById('video');
  const canvas  = document.getElementById('snapshot-canvas');
  const flash   = document.getElementById('flash-overlay');
  const counter = document.getElementById('photo-counter');

  // Flash effect
  flash.style.display   = 'block';
  flash.style.opacity   = '1';
  flash.style.transition = '';
  requestAnimationFrame(() => {
    flash.style.transition = 'opacity 0.35s ease-out';
    flash.style.opacity = '0';
    setTimeout(() => { flash.style.display = 'none'; }, 380);
  });

  /* ── Crop source video to 3:4 portrait from the centre ──────
     Webcams are landscape (e.g. 1280×720 = 16:9).
     We want a 3:4 portrait crop:
       target src width  = srcH * (3/4)
       target src height = srcH
     Centre it horizontally.                                      */
  const srcW = video.videoWidth  || 640;
  const srcH = video.videoHeight || 480;

  const cropW = Math.round(srcH * 3 / 4);  // 3:4 portrait crop width
  const cropH = srcH;
  const cropX = Math.round((srcW - cropW) / 2);
  const cropY = 0;

  /* ── Draw onto canvas at fixed 480×640 ──────────────────────
     drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)
     We flip horizontally (mirror) via ctx.scale(-1,1).          */
  canvas.width  = PHOTO_W;  // 480
  canvas.height = PHOTO_H;  // 640

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(PHOTO_W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, PHOTO_W, PHOTO_H);
  ctx.restore();

  // Apply chosen filter to pixel data
  applyFilterToCanvas(ctx);

  const dataURL = canvas.toDataURL('image/jpeg', 0.93);
  photos.push(dataURL);
  counter.textContent = `${index + 1} / ${TOTAL}`;

  // Update live strip preview
  const slot = document.getElementById(`slot-${index}`);
  slot.innerHTML = `<img src="${dataURL}" alt="photo ${index + 1}"><div class="photo-badge">${index + 1}</div>`;
  slot.classList.add('filled', 'taking-photo');
  setTimeout(() => slot.classList.remove('taking-photo'), 320);
}

/* ══════════════════════════════════════════════════════════════
   FILTER ENGINE — pixel manipulation on canvas
   All filters work at PHOTO_W × PHOTO_H (480 × 640).
══════════════════════════════════════════════════════════════ */
function applyFilterToCanvas(ctx) {
  if (filterMode === 'color') return; // no processing needed

  const W = PHOTO_W, H = PHOTO_H;
  const imageData = ctx.getImageData(0, 0, W, H);
  const d = imageData.data;

  if (filterMode === 'bw') {
    /* ── B&W: luminance → grayscale, mild contrast S-curve ── */
    for (let i = 0; i < d.length; i += 4) {
      let g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      // gentle S-curve
      g /= 255;
      g = g < 0.5
        ? 2 * g * g
        : 1 - Math.pow(-2 * g + 2, 2) / 2;
      g = Math.min(255, Math.max(0, g * 255 * 1.05));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(imageData, 0, 0);

    // Soft vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.80);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

  } else if (filterMode === 'vintage') {
    /* ── VINTAGE: warm sepia tone + lifted blacks (faded film)
          + grain + heavy oval vignette.
       Reference: the second screenshot — warm browns, dark corners,
       visible grain, matte/faded feel.                            */

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] / 255;
      let g = d[i + 1] / 255;
      let b = d[i + 2] / 255;

      /* Step 1 — sepia matrix */
      const nr = r * 0.393 + g * 0.769 + b * 0.189;
      const ng = r * 0.349 + g * 0.686 + b * 0.168;
      const nb = r * 0.272 + g * 0.534 + b * 0.131;
      r = nr; g = ng; b = nb;

      /* Step 2 — amber / warm push (more red, slightly less blue) */
      r = r * 1.12 + 0.015;
      g = g * 0.98;
      b = b * 0.72;

      /* Step 3 — lift blacks (faded/matte film look) */
      r = r * 0.78 + 0.10;
      g = g * 0.78 + 0.075;
      b = b * 0.78 + 0.055;

      /* Step 4 — pull contrast slightly (not too punchy) */
      r = (r - 0.5) * 1.08 + 0.5;
      g = (g - 0.5) * 1.08 + 0.5;
      b = (b - 0.5) * 1.05 + 0.5;

      d[i]     = Math.min(255, Math.max(0, r * 255));
      d[i + 1] = Math.min(255, Math.max(0, g * 255));
      d[i + 2] = Math.min(255, Math.max(0, b * 255));
    }

    /* Step 5 — film grain (random per-pixel noise, stronger in mids) */
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3 / 255;
      // grain peaks in midtones, less in deep shadows/highlights
      const grainAmt = 18 * Math.sin(lum * Math.PI);
      const noise = (Math.random() - 0.5) * grainAmt;
      d[i]     = Math.min(255, Math.max(0, d[i]     + noise));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + noise * 0.92));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + noise * 0.78));
    }

    ctx.putImageData(imageData, 0, 0);

    /* Step 6 — heavy oval vignette (darkest at corners, warm tint) */
    const vg = ctx.createRadialGradient(W * 0.5, H * 0.48, H * 0.20, W * 0.5, H * 0.50, H * 0.88);
    vg.addColorStop(0,    'rgba(0,0,0,0)');
    vg.addColorStop(0.50, 'rgba(20,8,0,0.08)');
    vg.addColorStop(1,    'rgba(30,12,0,0.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    /* Step 7 — subtle warm colour cast over the whole frame */
    ctx.fillStyle = 'rgba(200, 130, 30, 0.04)';
    ctx.fillRect(0, 0, W, H);
  }
}

/* ══════════════════════════════════════════════════════════════
   RESULT PAGE
══════════════════════════════════════════════════════════════ */
function showResult() {
  document.getElementById('booth').style.display = 'none';

  const result = document.getElementById('result');
  result.style.display = 'flex';

  // Rebuild final strip
  const strip  = document.getElementById('final-strip');
  strip.querySelectorAll('.final-photo').forEach(el => el.remove());

  const dateEl = document.getElementById('strip-date');
  photos.forEach(src => {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'final-photo';
    strip.insertBefore(img, dateEl);
  });

  const now = new Date();
  dateEl.textContent = now
    .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    .toUpperCase();
}

/* ══════════════════════════════════════════════════════════════
   DOWNLOAD — render to offscreen canvas pixel-perfect
   No stretching: photos are already PHOTO_W × PHOTO_H (3:4).
   Strip layout:
     STRIP_W  = photo display width  (e.g. 360px)
     PAD_X    = side padding
     PHOTO_DW = STRIP_W - PAD_X*2   (photo draw width on strip)
     PHOTO_DH = PHOTO_DW * 4/3      (preserves 3:4 ratio exactly)
══════════════════════════════════════════════════════════════ */
async function downloadStrip() {
  const SCALE    = 2;       // retina/2× output
  const STRIP_W  = 320;     // logical px
  const PAD_X    = 12;
  const PAD_TOP  = 14;
  const PAD_BOT  = 42;
  const GAP      = 6;

  const PHOTO_DW = STRIP_W - PAD_X * 2;           // photo drawn width
  const PHOTO_DH = Math.round(PHOTO_DW * 4 / 3);  // 3:4 — NO distortion

  const TOTAL_H = PAD_TOP + TOTAL * PHOTO_DH + (TOTAL - 1) * GAP + PAD_BOT;

  const canvas = document.createElement('canvas');
  canvas.width  = STRIP_W  * SCALE;
  canvas.height = TOTAL_H  * SCALE;

  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  /* ── Background ── */
  const bgMap = { color: '#ffffff', bw: '#f0efed', vintage: '#ede0cc' };
  ctx.fillStyle = bgMap[filterMode] || '#ffffff';
  ctx.fillRect(0, 0, STRIP_W, TOTAL_H);

  /* ── Outer border ── */
  const borderMap = { color: '#1a1a1a', bw: '#333', vintage: '#7a5c38' };
  ctx.strokeStyle = borderMap[filterMode] || '#1a1a1a';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(1.25, 1.25, STRIP_W - 2.5, TOTAL_H - 2.5);

  /* ── Draw each photo at the correct 3:4 size ── */
  const loadImg = src => new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });

  for (let i = 0; i < photos.length; i++) {
    const img = await loadImg(photos[i]);
    const y = PAD_TOP + i * (PHOTO_DH + GAP);

    /*  drawImage preserves the image's natural 3:4 ratio because
        PHOTO_DH = PHOTO_DW × (4/3), same as the captured pixels.
        No distortion.                                             */
    ctx.drawImage(img, PAD_X, y, PHOTO_DW, PHOTO_DH);

    // Thin photo border
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(PAD_X, y, PHOTO_DW, PHOTO_DH);
  }

  /* ── Footer label ── */
  const labelColor = filterMode === 'bw' ? '#555' : filterMode === 'vintage' ? '#8a6a40' : '#aaa';
  const labelY     = TOTAL_H - PAD_BOT + 16;

  ctx.fillStyle = labelColor;
  ctx.textAlign = 'center';

  // "snapr" wordmark
  ctx.font = `bold 13px "Courier New", monospace`;
  ctx.fillText('snapr', STRIP_W / 2, labelY);

  // Date
  const now = new Date();
  ctx.font = `10px "Courier New", monospace`;
  ctx.fillText(
    now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase(),
    STRIP_W / 2,
    labelY + 16
  );

  // Thin divider above footer
  ctx.strokeStyle = labelColor;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(PAD_X + 20, TOTAL_H - PAD_BOT + 4);
  ctx.lineTo(STRIP_W - PAD_X - 20, TOTAL_H - PAD_BOT + 4);
  ctx.stroke();

  /* ── Trigger download ── */
  const link = document.createElement('a');
  link.download = `snapr-${filterMode}-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
function resetStrip() {
  for (let i = 0; i < TOTAL; i++) {
    const slot = document.getElementById(`slot-${i}`);
    slot.innerHTML = '<span class="slot-empty-icon">○</span>';
    slot.classList.remove('filled', 'taking-photo');
  }
  photos = [];
  document.getElementById('photo-counter').textContent = '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
