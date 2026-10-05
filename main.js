/**
 * Gemini Watermark Remover — Browser-only
 *
 * Uses Reverse Alpha Blending:
 *   original = (watermarked - alpha * logo) / (1 - alpha)
 *
 * Gemini places a fixed-size 4-pointed star watermark at the bottom-right
 * corner with 32px margin. 48x48 for images <= 1024px, 96x96 for larger.
 * We build the star alpha procedurally and invert the blend.
 */

const WATERMARK_SIZE_SMALL = 48;
const WATERMARK_SIZE_LARGE = 96;
const WATERMARK_MARGIN = 32;

const fileInput = document.getElementById('fileInput');
const uploadBox = document.getElementById('uploadBox');
const fileName = document.getElementById('fileName');
const previewOriginal = document.getElementById('previewOriginal');
const previewProcessed = document.getElementById('previewProcessed');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

let processedUrl = null;

function buildStarAlpha(size) {
  const alpha = new Float32Array(size * size);
  const cx = size / 2;
  const cy = size / 2;
  const longR = size * 0.45;
  const shortR = size * 0.08;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d1 = Math.sqrt((dx / longR) ** 2 + (dy / shortR) ** 2);
      const d2 = Math.sqrt((dx / shortR) ** 2 + (dy / longR) ** 2);
      const v = 1 - Math.min(d1, d2);
      alpha[y * size + x] = Math.max(0, Math.min(1, v)) * 0.35;
    }
  }
  return alpha;
}

function removeWatermarkFromCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width;
  const H = canvas.height;
  const size = Math.max(W, H) > 1024 ? WATERMARK_SIZE_LARGE : WATERMARK_SIZE_SMALL;
  const margin = WATERMARK_MARGIN;
  const x1 = W - size - margin;
  const y1 = H - size - margin;

  if (x1 < 0 || y1 < 0) return;

  const alpha = buildStarAlpha(size);
  const imageData = ctx.getImageData(x1, y1, size, size);
  const data = imageData.data;
  const eps = 1e-4;
  const logo = 1.0;

  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const a = alpha[ly * size + lx];
      if (a < 0.01) continue;
      const idx = (ly * size + lx) * 4;
      const denom = 1 - a + eps;
      for (let c = 0; c < 3; c++) {
        const wm = data[idx + c] / 255;
        const recovered = (wm - a * logo) / denom;
        data[idx + c] = Math.max(0, Math.min(255, Math.round(recovered * 255)));
      }
    }
  }
  ctx.putImageData(imageData, x1, y1);
}

function resetUI() {
  previewOriginal.hidden = true;
  previewProcessed.hidden = true;
  downloadBtn.hidden = true;
  statusEl.textContent = '';
  errorEl.textContent = '';
  if (processedUrl) {
    URL.revokeObjectURL(processedUrl);
    processedUrl = null;
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;

  resetUI();
  fileName.textContent = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      previewOriginal.src = e.target.result;
      previewOriginal.hidden = false;

      statusEl.textContent = 'Removing watermark...';

      // Use setTimeout so UI updates before heavy work
      setTimeout(() => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          removeWatermarkFromCanvas(canvas);

          canvas.toBlob((blob) => {
            if (!blob) {
              errorEl.textContent = 'Failed to export processed image.';
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
          }, 'image/png');
        } catch (err) {
          errorEl.textContent = 'Error: ' + err.message;
          statusEl.textContent = '';
        }
      }, 50);
    };
    img.onerror = () => {
      errorEl.textContent = 'Could not load image.';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
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
