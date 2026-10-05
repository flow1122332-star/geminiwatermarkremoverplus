/**
 * Gemini Watermark Remover — Browser with OpenCV.js
 *
 * Uses OpenCV inpainting (cv.inpaint TELEA) on the bottom-right corner
 * where Gemini places its 4-pointed star watermark.
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
let cvReady = false;

// Called by opencv.js onload
window.onOpenCvReady = function () {
  cvReady = true;
  console.log('OpenCV.js loaded');
  if (statusEl && statusEl.textContent === 'Loading OpenCV...') {
    statusEl.textContent = '';
  }
};

function waitForOpenCV(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (cvReady || (typeof cv !== 'undefined' && cv.Mat)) {
        cvReady = true;
        return resolve();
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('OpenCV.js failed to load. Check your internet connection.'));
      }
      setTimeout(check, 150);
    };
    check();
  });
}

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

async function processImage(img) {
  await waitForOpenCV();

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, W, H);

  const src = cv.matFromImageData(imageData);

  // Watermark region — Gemini style: bottom-right with ~32px margin
  const maxDim = Math.max(W, H);
  const baseSize = maxDim > 1024 ? 96 : 48;
  const size = Math.round(baseSize * 1.4);
  const margin = 24;

  const x1 = Math.max(0, W - size - margin);
  const y1 = Math.max(0, H - size - margin);
  const rectW = W - margin - x1;
  const rectH = H - margin - y1;

  if (rectW <= 0 || rectH <= 0) {
    src.delete();
    throw new Error('Image too small to process.');
  }

  // Build mask (image sized) — white where watermark is
  const mask = cv.Mat.zeros(H, W, cv.CV_8UC1);
  const roi = mask.roi(new cv.Rect(x1, y1, rectW, rectH));
  roi.setTo(new cv.Scalar(255));
  roi.delete();

  // Soften mask edges so inpaint blends smoothly
  cv.GaussianBlur(mask, mask, new cv.Size(0, 0), 3, 3, cv.BORDER_DEFAULT);

  // Real inpainting
  const dst = new cv.Mat();
  cv.inpaint(src, mask, dst, 5, cv.INPAINT_TELEA);

  // Render result to canvas
  cv.imshow(canvas, dst);

  src.delete();
  mask.delete();
  dst.delete();

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

    if (!cvReady) {
      statusEl.textContent = 'Loading OpenCV...';
    } else {
      statusEl.textContent = 'Removing watermark...';
    }

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
