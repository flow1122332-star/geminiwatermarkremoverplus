/**
 * Gemini Watermark Remover — Reverse Alpha Blending
 *
 * Uses actual Gemini alpha maps (assets/bg_48.png, assets/bg_96.png)
 * to mathematically reverse the watermark blend and recover original pixels.
 *
 * Formula: original = (watermarked - alpha * logo) / (1 - alpha)
 *
 * Handles TWO watermarks:
 *  - PASS 1: Standard small star (chhota) — aggressive removal
 *  - PASS 2: Large faint ghost star (bada) — soft removal
 */

const fileInput = document.getElementById('fileInput');
const uploadBox = document.getElementById('uploadBox');
const fileName = document.getElementById('fileName');
const previewOriginal = document.getElementById('previewOriginal');
const previewProcessed = document.getElementById('previewProcessed');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

let processedUrl = null;

// Cache alpha maps (Float32Array, 0..1)
const alphaCache = {};

function resetUI() {
  previewProcessed.hidden = true;
  downloadBtn.hidden = true;
  statusEl.textContent = '';
  errorEl.textContent = '';
  if (processedUrl) {
    URL.revokeObjectURL(processedUrl);
    processedUrl = null;
  }
}

/**
 * Load a PNG alpha map and convert to Float32Array of per-pixel opacity.
 */
async function loadAlphaMap(size) {
  if (alphaCache[size]) return alphaCache[size];

  const path = size === 48 ? 'assets/bg_48.png' : 'assets/bg_96.png';

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Failed to load ' + path));
    i.src = path;
  });

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  const alpha = new Float32Array(size * size);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const v = Math.max(data[p], data[p + 1], data[p + 2]) / 255;
    alpha[i] = v;
  }

  alphaCache[size] = alpha;
  return alpha;
}

/**
 * Scale alpha map from old size to new size (nearest-neighbor).
 */
function scaleAlphaMap(alpha, oldSize, newSize) {
  const scaled = new Float32Array(newSize * newSize);
  for (let y = 0; y < newSize; y++) {
    for (let x = 0; x < newSize; x++) {
      const srcX = Math.floor(x * oldSize / newSize);
      const srcY = Math.floor(y * oldSize / newSize);
      scaled[y * newSize + x] = alpha[srcY * oldSize + srcX];
    }
  }
  return scaled;
}

/**
 * Apply reverse alpha blending over the watermark region.
 * original = (watermarked - alpha * logo) / (1 - alpha)
 *
 * strength: multiplier on alpha (1.0 = normal, >1 = aggressive, <1 = soft)
 */
function reverseAlphaBlend(imageData, W, H, x1, y1, size, alpha, strength) {
  const data = imageData.data;
  const eps = 1e-4;
  const logo = 1.0; // white watermark
  const scale = strength || 1.0;

  for (let ly = 0; ly < size; ly++) {
    const y = y1 + ly;
    if (y < 0 || y >= H) continue;
    for (let lx = 0; lx < size; lx++) {
      const x = x1 + lx;
      if (x < 0 || x >= W) continue;

      let a = alpha[ly * size + lx] * scale;
      if (a < 0.01) continue;
      if (a > 0.95) a = 0.95; // clamp to avoid blow-out

      const idx = (y * W + x) * 4;
      const denom = 1 - a + eps;

      for (let c = 0; c < 3; c++) {
        const wm = data[idx + c] / 255;
        const recovered = (wm - a * logo) / denom;
        data[idx + c] = Math.max(0, Math.min(255, Math.round(recovered * 255)));
      }
    }
  }
}

async function processImage(img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, W, H);
  const maxDim = Math.max(W, H);
  const stdSize = maxDim > 1024 ? 96 : 48;

  // --- PASS 1: Standard Gemini watermark (chhota, aggressive) ---
  const stdMargin = 24;
  const stdBoost = 1.6;
  const stdSizeBoost = 1.3;

  const stdApplied = Math.round(stdSize * stdSizeBoost);
  const sx1 = W - stdApplied - stdMargin;
  const sy1 = H - stdApplied - stdMargin;

  if (sx1 >= 0 && sy1 >= 0) {
    try {
      const baseAlpha = await loadAlphaMap(stdSize);
      const scaledAlpha = scaleAlphaMap(baseAlpha, stdSize, stdApplied);
      // Aggressive pass
      reverseAlphaBlend(imageData, W, H, sx1, sy1, stdApplied, scaledAlpha, stdBoost);
      // Soft cleanup pass to remove residual ghost
      reverseAlphaBlend(imageData, W, H, sx1, sy1, stdApplied, scaledAlpha, 0.8);
    } catch (e) {
      console.warn('Pass 1 (standard) failed:', e.message);
    }
  }

  // --- PASS 2: Large faint ghost watermark (bada) ---
  const largeSize = maxDim > 1024 ? 220 : 110;
  const largeMargin = 0;
  const lx1 = W - largeSize - largeMargin;
  const ly1 = H - largeSize - largeMargin;

  if (lx1 >= 0 && ly1 >= 0) {
    try {
      const baseAlpha = await loadAlphaMap(stdSize);
      const scaledAlpha = scaleAlphaMap(baseAlpha, stdSize, largeSize);
      reverseAlphaBlend(imageData, W, H, lx1, ly1, largeSize, scaledAlpha, 0.7);
    } catch (e) {
      console.warn('Pass 2 (ghost) failed:', e.message);
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;

  resetUI();
  fileName.textContent = file.name;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    previewOriginal.src = url;
    previewOriginal.hidden = false;
    statusEl.textContent = 'Removing watermark...';

    setTimeout(async () => {
      try {
        const blob = await processImage(img);
        if (!blob) {
          errorEl.textContent = 'Failed to export image.';
          statusEl.textContent = '';
          return;
        }
        if (processedUrl) URL.revokeObjectURL(processedUrl);
        processedUrl = URL.createObjectURL(blob);
        previewProcessed.src = processedUrl;
        previewProcessed.hidden = false;
        downloadBtn.href = processedUrl;
        downloadBtn.hidden = false;
        statusEl.textContent = 'Done! Click download below.';
      } catch (err) {
        errorEl.textContent = 'Error: ' + err.message;
        statusEl.textContent = '';
        console.error(err);
      }
    }, 50);
  };
  img.onerror = () => {
    errorEl.textContent = 'Could not load image.';
  };
  img.src = url;
});

// Drag & drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
  uploadBox.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
});
['dragenter', 'dragover'].forEach((evt) => {
  uploadBox.addEventListener(evt, () => uploadBox.classList.add('dragover'));
});
['dragleave', 'drop'].forEach((evt) => {
  uploadBox.addEventListener(evt, () => uploadBox.classList.remove('dragover'));
});
uploadBox.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const dt = new DataTransfer();
    dt.items.add(files[0]);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change'));
  }
});
