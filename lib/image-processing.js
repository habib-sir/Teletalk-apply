/**
 * image-processing.js
 * ---------------------------------------------------------------
 * 100% local, offline image processing utilities.
 * No AI models, no network calls, no external libraries.
 * Everything here is plain pixel math running on <canvas>.
 *
 * Exposes: window.ImageTools
 * ---------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /**
   * Load a File/Blob into an HTMLImageElement.
   */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  /**
   * Draw an image (or canvas) onto a new canvas at a given size.
   */
  function toCanvas(source, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, w, h);
    return canvas;
  }

  /**
   * Convert a canvas to grayscale in-place. Returns the same canvas.
   */
  function grayscale(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      // Luminance-weighted grayscale (matches human perception better than plain average)
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = gray;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Adaptive (local mean) thresholding — the actual "CamScanner effect".
   * Instead of one global black/white cutoff, each pixel is compared
   * against the average brightness of a surrounding window. This
   * cleans up uneven lighting/shadows and makes the background pure
   * white while keeping ink/signature strokes solid black.
   *
   * @param {HTMLCanvasElement} canvas - must already be grayscale
   * @param {number} windowSize - size of the local averaging window (odd number, e.g. 15-25)
   * @param {number} sensitivity - how much darker than local average a pixel must be to count as "ink" (0-40 typical)
   */
  function adaptiveThreshold(canvas, windowSize = 21, sensitivity = 10) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height);
    const src = imgData.data;

    // Build a flat grayscale buffer for fast integral-image style averaging
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      gray[p] = src[i];
    }

    // Integral image for O(1) box-window average lookups
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        rowSum += gray[y * width + x];
        integral[(y + 1) * (width + 1) + (x + 1)] =
          integral[y * (width + 1) + (x + 1)] + rowSum;
      }
    }

    const half = Math.floor(windowSize / 2);
    const out = new Uint8ClampedArray(width * height);

    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - half);
      const y1 = Math.min(height - 1, y + half);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - half);
        const x1 = Math.min(width - 1, x + half);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum =
          integral[(y1 + 1) * (width + 1) + (x1 + 1)] -
          integral[y0 * (width + 1) + (x1 + 1)] -
          integral[(y1 + 1) * (width + 1) + x0] +
          integral[y0 * (width + 1) + x0];
        const localMean = sum / area;
        const pixel = gray[y * width + x];
        out[y * width + x] = pixel < localMean - sensitivity ? 0 : 255;
      }
    }

    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      src[i] = src[i + 1] = src[i + 2] = out[p];
      src[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Light 3x3 sharpen convolution to make strokes crisper after thresholding.
   */
  function sharpen(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const yy = Math.min(height - 1, Math.max(0, y + ky));
            const xx = Math.min(width - 1, Math.max(0, x + kx));
            sum += src.data[(yy * width + xx) * 4] * kernel[k++];
          }
        }
        const idx = (y * width + x) * 4;
        const val = Math.min(255, Math.max(0, sum));
        dst.data[idx] = dst.data[idx + 1] = dst.data[idx + 2] = val;
        dst.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(dst, 0, 0);
    return canvas;
  }

  /**
   * Auto-crop away white/near-white margins so only the ink content remains.
   * Returns a NEW canvas (tightly cropped), or the original if nothing to trim.
   */
  function autoCropMargins(canvas, whiteThreshold = 250, paddingPx = 6) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = data[(y * width + x) * 4];
        if (v < whiteThreshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0) return canvas; // nothing dark found, bail out safely

    minX = Math.max(0, minX - paddingPx);
    minY = Math.max(0, minY - paddingPx);
    maxX = Math.min(width - 1, maxX + paddingPx);
    maxY = Math.min(height - 1, maxY + paddingPx);

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const cropped = document.createElement('canvas');
    cropped.width = cropW;
    cropped.height = cropH;
    cropped.getContext('2d').drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    return cropped;
  }

  /**
   * Fit a canvas onto a white background of exact target dimensions
   * without distorting aspect ratio (letterbox style).
   */
  function fitOnWhiteCanvas(source, targetW, targetH) {
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    const scale = Math.min(targetW / source.width, targetH / source.height);
    const drawW = source.width * scale;
    const drawH = source.height * scale;
    const dx = (targetW - drawW) / 2;
    const dy = (targetH - drawH) / 2;
    ctx.drawImage(source, dx, dy, drawW, drawH);
    return out;
  }

  /**
   * Compress a canvas to JPEG under a target KB size by stepping down quality.
   * Returns { blob, base64, quality, kb }.
   */
  async function compressToTargetKB(canvas, maxKB = 100, mime = 'image/jpeg') {
    let quality = 0.92;
    let blob = await canvasToBlob(canvas, mime, quality);
    while (blob.size / 1024 > maxKB && quality > 0.1) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, mime, quality);
    }
    const base64 = await blobToBase64(blob);
    return { blob, base64, quality, kb: Math.round(blob.size / 1024) };
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Full one-call pipeline: File -> "scanned document" signature canvas
   * cropped/resized to an exact target size (e.g. 300x80).
   *
   * @param {File} file
   * @param {Object} opts
   * @param {number} opts.targetW
   * @param {number} opts.targetH
   * @param {number} opts.windowSize   adaptive threshold window (default 21)
   * @param {number} opts.sensitivity  adaptive threshold sensitivity (default 10)
   * @param {boolean} opts.sharpenPass apply sharpen filter (default true)
   * @param {boolean} opts.autoCrop    trim white margins before resizing (default true)
   */
  async function processSignatureFile(file, opts = {}) {
    const {
      targetW = 300,
      targetH = 80,
      windowSize = 21,
      sensitivity = 10,
      sharpenPass = true,
      autoCrop = true,
    } = opts;

    const img = await loadImage(file);
    // Work at a reasonably high internal resolution for cleaner thresholding,
    // then downsize at the very end.
    const workW = Math.min(1200, img.naturalWidth || img.width);
    const workH = Math.round((img.naturalHeight || img.height) * (workW / (img.naturalWidth || img.width)));

    let canvas = toCanvas(img, workW, workH);
    grayscale(canvas);
    adaptiveThreshold(canvas, windowSize, sensitivity);
    if (sharpenPass) sharpen(canvas);
    if (autoCrop) canvas = autoCropMargins(canvas);

    const finalCanvas = fitOnWhiteCanvas(canvas, targetW, targetH);
    return finalCanvas;
  }

  /**
   * Process an existing canvas/image element as a clean scanned signature:
   * Grayscale -> Adaptive Threshold -> Sharpen -> AutoCrop -> Fit on White (W: targetW, H: targetH).
   * Teletalk specification: Width 300px, Height 80px (300 × 80 px), <= 60 KB.
   *
   * @param {HTMLCanvasElement|HTMLImageElement} sourceCanvas
   * @param {Object} [opts]
   * @returns {Promise<{canvas: HTMLCanvasElement, blob: Blob, base64: string, kb: number, width: number, height: number}>}
   */
  async function processSignatureCanvas(sourceCanvas, opts = {}) {
    const {
      targetW = 300,
      targetH = 80,
      windowSize = 21,
      sensitivity = 10,
      sharpenPass = true,
      autoCrop = true,
      maxKB = 60,
    } = opts;

    const workW = Math.min(1200, sourceCanvas.width);
    const workH = Math.max(1, Math.round(sourceCanvas.height * (workW / (sourceCanvas.width || 1))));
    let canvas = toCanvas(sourceCanvas, Math.max(1, workW), workH);

    grayscale(canvas);
    adaptiveThreshold(canvas, windowSize, sensitivity);
    if (sharpenPass) sharpen(canvas);
    if (autoCrop) canvas = autoCropMargins(canvas, 245, 6);

    const finalCanvas = fitOnWhiteCanvas(canvas, targetW, targetH);
    const compressed = await compressToTargetKB(finalCanvas, maxKB, 'image/png');
    return {
      canvas: finalCanvas,
      blob: compressed.blob,
      base64: compressed.base64,
      kb: compressed.kb,
      width: targetW,
      height: targetH,
    };
  }

  /**
   * Process a canvas/image element as an applicant passport photo:
   * Center crop to 1:1 aspect ratio -> Smooth resize to targetW x targetH -> JPEG compression.
   * Teletalk specification: 300 × 300 px, <= 100 KB.
   *
   * @param {HTMLCanvasElement|HTMLImageElement} sourceCanvas
   * @param {Object} [opts]
   * @returns {Promise<{canvas: HTMLCanvasElement, blob: Blob, base64: string, kb: number, width: number, height: number}|null>}
   */
  async function processPhotoCanvas(sourceCanvas, opts = {}) {
    const {
      targetW = 300,
      targetH = 300,
      maxKB = 100,
    } = opts;

    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    if (!sw || !sh) return null;

    // Center crop square (1:1) to prevent aspect ratio distortion
    const size = Math.min(sw, sh);
    const sx = Math.floor((sw - size) / 2);
    const sy = Math.floor((sh - size) / 2);

    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    ctx.drawImage(sourceCanvas, sx, sy, size, size, 0, 0, targetW, targetH);

    const compressed = await compressToTargetKB(out, maxKB, 'image/jpeg');
    return {
      canvas: out,
      blob: compressed.blob,
      base64: compressed.base64,
      kb: compressed.kb,
      width: targetW,
      height: targetH,
    };
  }

  global.ImageTools = {
    loadImage,
    toCanvas,
    grayscale,
    adaptiveThreshold,
    sharpen,
    autoCropMargins,
    fitOnWhiteCanvas,
    compressToTargetKB,
    processSignatureFile,
    processSignatureCanvas,
    processPhotoCanvas,
  };
})(typeof window !== 'undefined' ? window : this);
