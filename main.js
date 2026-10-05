/**
 * Gemini Watermark Remover — Reverse Alpha Blending
 *
 * Uses actual Gemini alpha maps (assets/bg_48.png, assets/bg_96.png)
 * Formula: original = (watermarked - alpha * logo) / (1 - alpha)
 *
 * Removes ONLY the standard small star watermark at bottom-right corner.
 * (Ghost / large watermark is left untouched intentionally.)
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

async function loadAlphaMap(size) {
  if (alphaCache[size]) return alphaCache[size];

  const path = size === 48 ? 'assets/bg_48.png' : 'assets/bg_96.png';
  console.log('[AlphaMap] Loading:', path);

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
  let maxA = 0;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const v = Math.max(data[p], data[p + 1], data[p + 2]) / 255;
    alpha[i] = v;
    if (v > maxA) maxA = v;
  }
  console.log('[AlphaMap] Loaded size=' + size + ' maxAlpha=' + maxA.toFixed(3));

  alphaCache[size] = alpha;
  return alpha;
}

function reverseAlphaBlend(imageData, W, H, x1, y1, size, alpha, strength) {
  const data = imageData.data;
  const eps = 1e-4;
  const logo = 1.0;
  const scale = strength || 1.0;

  for (let ly = 0; ly < size; ly++) {
    const y = y1 + ly;
    if (y < 0 || y >= H) continue;
    for (let lx = 0; lx < size; lx++) {
      const x = x1 + lx;
      if (x < 0 || x >= W) continue;

      let a = alpha[ly * size + lx] * scale;
      if (a < 0.005) continue;
      if (a > 0.98) a = 0.98;

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
  console.log('[Process] Size: ' + W + 'x' + H);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, W, H);

  // Standard Gemini watermark size
  const maxDim = Math.max(W, H);
  const stdSize = maxDim > 1024 ? 96 : 48;

  // Position: bottom-right corner with 32px margin
  const margin = 32;
  const x1 = W - stdSize - margin;
  const y1 = H - stdSize - margin;

  console.log('[Process] Region: x1=' + x1 + ' y1=' + y1 + ' size=' + stdSize);

  if (x1 >= 0 && y1 >= 0) {
    const alpha = await loadAlphaMap(stdSize);
    // Single clean pass
    reverseAlphaBlend(imageData, W, H, x1, y1, stdSize, alpha, 1.0);
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
