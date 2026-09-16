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
   * Evaluates whether an RGB pixel corresponds to human skin tone.
   * Uses RGB chrominance rules and the standard YCbCr skin locus.
   * Robust across light, medium, and deep South Asian / Bangladeshi skin complexions,
   * while strictly rejecting white/light paper, black text, and blue ballpoint ink.
   */
  function isSkinPixel(r, g, b) {
    // Avoid pure blacks, deep darks, and pure white/light paper
    if (r < 45 || g < 28 || b < 18) return false;
    // Warm human skin: red is predominant over green and blue
    if (r <= g || g <= b * 0.82) return false;
    if (r - g < 6) return false; // reject neutral grays, whites, and pale cream paper
    if (r - b < 10) return false;
    if (Math.abs(r - g) > 115) return false; // reject oversaturated pure red/orange markers

    // YCbCr transformation (standard in computer vision face/skin segmentation)
    // Y  =  0.299*R + 0.587*G + 0.114*B
    // Cb = -0.168736*R - 0.331264*G + 0.5*B + 128
    // Cr =  0.5*R - 0.418688*G - 0.081312*B + 128
    const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;

    return cb >= 72 && cb <= 135 && cr >= 125 && cr <= 185;
  }

  /**
   * Calculates the percentage of human skin-tone pixels in a canvas or sub-region.
   */
  function getSkinDensity(canvas, rx = 0, ry = 0, rw = null, rh = null, step = 4) {
    if (!canvas) return 0;
    const w = rw || canvas.width;
    const h = rh || canvas.height;
    if (w <= 0 || h <= 0) return 0;

    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(rx, ry, w, h);
    const d = imgData.data;

    let skinCount = 0;
    let totalSampled = 0;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const idx = (y * w + x) * 4;
        totalSampled++;
        if (isSkinPixel(d[idx], d[idx + 1], d[idx + 2])) {
          skinCount++;
        }
      }
    }

    return totalSampled > 0 ? skinCount / totalSampled : 0;
  }

  /**
   * Detects the human face region and calculates the optimal 1:1 passport photo crop box.
   * Accurately detects face boundaries and photo frames, strictly excluding surrounding
   * document text, headers, and outside table rows.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [searchBox] Optional search sub-region { x, y, w, h }
   * @param {Array<object>} [excludeWords] Words with bounding boxes to strictly stay outside of
   * @returns {{ faceFound: boolean, cropRect: { x: number, y: number, w: number, h: number }, faceCenter: { x: number, y: number }, skinRatio: number }|null}
   */
  function detectFaceRegion(canvas, searchBox = null, excludeWords = []) {
    if (!canvas || canvas.width < 50 || canvas.height < 50) return null;

    const fullW = canvas.width;
    const fullH = canvas.height;

    // By default, search the upper 65% of the document where photos reside in forms/CVs
    const sx = Math.max(0, searchBox ? searchBox.x : 0);
    const sy = Math.max(0, searchBox ? searchBox.y : 0);
    const sw = Math.min(fullW - sx, searchBox ? searchBox.w : fullW);
    const sh = Math.min(fullH - sy, searchBox ? searchBox.h : Math.round(fullH * 0.65));

    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(sx, sy, sw, sh);
    const d = imgData.data;

    // Scan skin pixels with a step of 4px for speed and spatial coherence
    const step = 4;
    const gridW = Math.ceil(sw / step);
    const gridH = Math.ceil(sh / step);
    const skinGrid = new Uint8Array(gridW * gridH);

    let totalSkin = 0;
    for (let gy = 0; gy < gridH; gy++) {
      const y = Math.min(sh - 1, gy * step);
      for (let gx = 0; gx < gridW; gx++) {
        const x = Math.min(sw - 1, gx * step);
        const idx = (y * sw + x) * 4;
        if (isSkinPixel(d[idx], d[idx + 1], d[idx + 2])) {
          skinGrid[gy * gridW + gx] = 1;
          totalSkin++;
        }
      }
    }

    // Minimum skin pixels required for a genuine human face (~30x30px face minimum)
    const minSkinThreshold = 55;
    if (totalSkin < minSkinThreshold) {
      return null;
    }

    // Find the primary skin cluster using an adaptive sliding window
    const winW = Math.max(8, Math.floor(gridW * 0.18));
    const winH = Math.max(8, Math.floor(gridH * 0.22));
    let maxClusterDensity = 0;
    let bestGx = 0;
    let bestGy = 0;

    for (let gy = 0; gy <= gridH - winH; gy += 2) {
      for (let gx = 0; gx <= gridW - winW; gx += 2) {
        let count = 0;
        for (let dy = 0; dy < winH; dy++) {
          for (let dx = 0; dx < winW; dx++) {
            if (skinGrid[(gy + dy) * gridW + (gx + dx)] === 1) count++;
          }
        }
        if (count > maxClusterDensity) {
          maxClusterDensity = count;
          bestGx = gx;
          bestGy = gy;
        }
      }
    }

    if (maxClusterDensity < 20) {
      return null;
    }

    // Centroid and bounding box of the best face cluster
    let cSumX = 0, cSumY = 0, cCount = 0;
    let minX = sw, maxX = 0, minY = sh, maxY = 0;
    for (let dy = 0; dy < winH; dy++) {
      for (let dx = 0; dx < winW; dx++) {
        const gx = bestGx + dx;
        const gy = bestGy + dy;
        if (skinGrid[gy * gridW + gx] === 1) {
          const px = gx * step;
          const py = gy * step;
          cSumX += px;
          cSumY += py;
          cCount++;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }

    if (cCount < 15) return null;

    const faceLocalCx = cSumX / cCount;
    const faceLocalCy = cSumY / cCount;
    const faceGlobalCx = sx + faceLocalCx;
    const faceGlobalCy = sy + faceLocalCy;

    const faceW = Math.max(30, maxX - minX);
    const faceH = Math.max(35, maxY - minY);

    // Search outwards from face center to find the real photo frame / border lines
    // In BD job application forms, the photo box has a 1px border or clear boundary
    let frameLeft = -1, frameRight = -1, frameTop = -1, frameBottom = -1;
    const maxSearchSpan = Math.round(Math.max(faceW * 1.6, 220));

    // 1. Scan Left for vertical photo edge/border
    for (let dx = Math.round(faceW * 0.5); dx < maxSearchSpan; dx += 2) {
      const x = Math.round(faceGlobalCx - dx);
      if (x <= 5) break;
      let darkCount = 0;
      let paperCount = 0;
      const scanSpan = Math.round(faceH * 1.1);
      const startScanY = Math.max(0, Math.round(faceGlobalCy - scanSpan * 0.5));
      const endScanY = Math.min(fullH - 1, Math.round(faceGlobalCy + scanSpan * 0.5));
      const testData = ctx.getImageData(x, startScanY, 1, endScanY - startScanY).data;
      for (let i = 0; i < testData.length; i += 4) {
        const lum = 0.299 * testData[i] + 0.587 * testData[i + 1] + 0.114 * testData[i + 2];
        if (lum < 160) darkCount++;
        else if (lum > 240) paperCount++;
      }
      const totalPixels = (endScanY - startScanY);
      if (darkCount > totalPixels * 0.65) {
        frameLeft = x + 1; // 1px inside border
        break;
      }
      if (paperCount > totalPixels * 0.90 && dx > faceW * 0.75) {
        frameLeft = x + 2;
        break;
      }
    }

    // 2. Scan Right for vertical photo edge/border
    for (let dx = Math.round(faceW * 0.5); dx < maxSearchSpan; dx += 2) {
      const x = Math.round(faceGlobalCx + dx);
      if (x >= fullW - 5) break;
      let darkCount = 0;
      let paperCount = 0;
      const scanSpan = Math.round(faceH * 1.1);
      const startScanY = Math.max(0, Math.round(faceGlobalCy - scanSpan * 0.5));
      const endScanY = Math.min(fullH - 1, Math.round(faceGlobalCy + scanSpan * 0.5));
      const testData = ctx.getImageData(x, startScanY, 1, endScanY - startScanY).data;
      for (let i = 0; i < testData.length; i += 4) {
        const lum = 0.299 * testData[i] + 0.587 * testData[i + 1] + 0.114 * testData[i + 2];
        if (lum < 160) darkCount++;
        else if (lum > 240) paperCount++;
      }
      const totalPixels = (endScanY - startScanY);
      if (darkCount > totalPixels * 0.65) {
        frameRight = x - 1; // 1px inside border
        break;
      }
      if (paperCount > totalPixels * 0.90 && dx > faceW * 0.75) {
        frameRight = x - 2;
        break;
      }
    }

    // 3. Scan Top for horizontal photo edge/border
    for (let dy = Math.round(faceH * 0.45); dy < maxSearchSpan; dy += 2) {
      const y = Math.round(faceGlobalCy - dy);
      if (y <= 5) break;
      let darkCount = 0;
      let paperCount = 0;
      const scanSpan = Math.round(faceW * 1.0);
      const startScanX = Math.max(0, Math.round(faceGlobalCx - scanSpan * 0.5));
      const endScanX = Math.min(fullW - 1, Math.round(faceGlobalCx + scanSpan * 0.5));
      const testData = ctx.getImageData(startScanX, y, endScanX - startScanX, 1).data;
      for (let i = 0; i < testData.length; i += 4) {
        const lum = 0.299 * testData[i] + 0.587 * testData[i + 1] + 0.114 * testData[i + 2];
        if (lum < 160) darkCount++;
        else if (lum > 240) paperCount++;
      }
      const totalPixels = (endScanX - startScanX);
      if (darkCount > totalPixels * 0.65) {
        frameTop = y + 1;
        break;
      }
      if (paperCount > totalPixels * 0.90 && dy > faceH * 0.6) {
        frameTop = y + 2;
        break;
      }
    }

    // 4. Scan Bottom for horizontal photo edge/border
    for (let dy = Math.round(faceH * 0.6); dy < maxSearchSpan; dy += 2) {
      const y = Math.round(faceGlobalCy + dy);
      if (y >= fullH - 5) break;
      let darkCount = 0;
      let paperCount = 0;
      const scanSpan = Math.round(faceW * 1.0);
      const startScanX = Math.max(0, Math.round(faceGlobalCx - scanSpan * 0.5));
      const endScanX = Math.min(fullW - 1, Math.round(faceGlobalCx + scanSpan * 0.5));
      const testData = ctx.getImageData(startScanX, y, endScanX - startScanX, 1).data;
      for (let i = 0; i < testData.length; i += 4) {
        const lum = 0.299 * testData[i] + 0.587 * testData[i + 1] + 0.114 * testData[i + 2];
        if (lum < 160) darkCount++;
        else if (lum > 240) paperCount++;
      }
      const totalPixels = (endScanX - startScanX);
      if (darkCount > totalPixels * 0.65) {
        frameBottom = y - 1;
        break;
      }
      if (paperCount > totalPixels * 0.90 && dy > faceH * 0.75) {
        frameBottom = y - 2;
        break;
      }
    }

    let cropX, cropY, cropSize;

    if (frameLeft > 0 && frameRight > frameLeft + 50 && frameTop > 0 && frameBottom > frameTop + 50) {
      // Detected real rectangular photo frame!
      const fw = frameRight - frameLeft;
      const fh = frameBottom - frameTop;
      cropSize = Math.max(fw, fh);
      cropX = Math.round(frameLeft + (fw - cropSize) / 2);
      cropY = Math.round(frameTop + (fh - cropSize) / 2);
    } else {
      // Fallback: Passport photo proportions centered strictly on face
      // Face occupies ~55% of passport photo height
      cropSize = Math.round(Math.max(faceH * 1.45, faceW * 1.55));
      cropX = Math.round(faceGlobalCx - cropSize / 2);
      cropY = Math.round(faceGlobalCy - cropSize * 0.38);
    }

    // Text exclusion: ensure crop box does not cross into any recognized text words
    if (excludeWords && excludeWords.length) {
      for (const w of excludeWords) {
        if (!w || !w.bbox) continue;
        const b = w.bbox;
        // If word is to the left of the face and overlaps cropX
        if (b.x1 <= faceGlobalCx && b.y1 > cropY && b.y0 < cropY + cropSize) {
          if (cropX < b.x1 + 3) {
            const shift = (b.x1 + 3) - cropX;
            cropX += shift;
            cropSize = Math.max(60, cropSize - shift);
          }
        }
        // If word is to the right of the face and overlaps right edge
        if (b.x0 >= faceGlobalCx && b.y1 > cropY && b.y0 < cropY + cropSize) {
          if (cropX + cropSize > b.x0 - 3) {
            cropSize = Math.max(60, (b.x0 - 3) - cropX);
          }
        }
        // If word is above face and overlaps cropY
        if (b.y1 <= faceGlobalCy && b.x1 > cropX && b.x0 < cropX + cropSize) {
          if (cropY < b.y1 + 3) {
            const shift = (b.y1 + 3) - cropY;
            cropY += shift;
            cropSize = Math.max(60, cropSize - shift);
          }
        }
        // If word is below face
        if (b.y0 >= faceGlobalCy && b.x1 > cropX && b.x0 < cropX + cropSize) {
          if (cropY + cropSize > b.y0 - 3) {
            cropSize = Math.max(60, (b.y0 - 3) - cropY);
          }
        }
      }
    }

    // Clamp inside canvas
    cropX = Math.max(0, Math.min(fullW - cropSize, cropX));
    cropY = Math.max(0, Math.min(fullH - cropSize, cropY));
    cropSize = Math.min(cropSize, Math.min(fullW - cropX, fullH - cropY));

    return {
      faceFound: true,
      cropRect: {
        x: cropX,
        y: cropY,
        w: cropSize,
        h: cropSize,
      },
      faceCenter: { x: faceGlobalCx, y: faceGlobalCy },
      skinRatio: totalSkin / (gridW * gridH),
    };
  }

  /**
   * Detects dark or blue cursive ink strokes typical of signatures,
   * distinguishing them from printed text paragraphs or blank paper.
   */
  function detectSignatureRegion(canvas, searchBox = null) {
    if (!canvas || canvas.width < 40 || canvas.height < 15) return null;

    const fullW = canvas.width;
    const fullH = canvas.height;

    const sx = Math.max(0, searchBox ? searchBox.x : 0);
    const sy = Math.max(0, searchBox ? searchBox.y : 0);
    const sw = Math.min(fullW - sx, searchBox ? searchBox.w : fullW);
    const sh = Math.min(fullH - sy, searchBox ? searchBox.h : fullH);

    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(sx, sy, sw, sh);
    const d = imgData.data;

    let minX = sw, maxX = -1, minY = sh, maxY = -1;
    let blueMinX = sw, blueMaxX = -1, blueMinY = sh, blueMaxY = -1;
    let inkCount = 0;
    let blueInkCount = 0;

    // Detect horizontal rule / baseline lines to avoid expanding crop to divider lines
    const rowDarkCounts = new Int32Array(sh);
    for (let y = 0; y < sh; y++) {
      let rCount = 0;
      for (let x = 0; x < sw; x++) {
        const idx = (y * sw + x) * 4;
        const lum = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
        if (lum < 175) rCount++;
      }
      rowDarkCounts[y] = rCount;
    }

    for (let y = 0; y < sh; y++) {
      // If a single row is > 65% solid dark pixels, it is a table/border line, not signature ink
      const isDividerLine = rowDarkCounts[y] > sw * 0.65;
      if (isDividerLine) continue;

      for (let x = 0; x < sw; x++) {
        const idx = (y * sw + x) * 4;
        const r = d[idx], g = d[idx + 1], b = d[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        const isDarkInk = lum < 180;
        const isBlueInk = b > 75 && b > r + 12 && b > g + 6;

        if (isBlueInk) {
          blueInkCount++;
          if (x < blueMinX) blueMinX = x;
          if (x > blueMaxX) blueMaxX = x;
          if (y < blueMinY) blueMinY = y;
          if (y > blueMaxY) blueMaxY = y;
        }

        if (isDarkInk || isBlueInk) {
          inkCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // If distinctive blue pen ink was found, prioritize blue signature ink
    if (blueInkCount >= 25 && blueMaxX > blueMinX + 15 && blueMaxY > blueMinY + 6) {
      const pad = 6;
      const cropX = Math.max(0, sx + blueMinX - pad);
      const cropY = Math.max(0, sy + blueMinY - pad);
      const cropW = Math.min(fullW - cropX, blueMaxX - blueMinX + 1 + pad * 2);
      const cropH = Math.min(fullH - cropY, blueMaxY - blueMinY + 1 + pad * 2);
      return {
        x: cropX,
        y: cropY,
        w: cropW,
        h: cropH,
        inkCount: blueInkCount,
        blueInkCount,
      };
    }

    // Minimum ink strokes required for a valid signature
    if (inkCount < 30 || maxX <= minX + 20 || maxY <= minY + 8) {
      return null;
    }

    // Pad slightly around the ink strokes
    const pad = 6;
    const cropX = Math.max(0, sx + minX - pad);
    const cropY = Math.max(0, sy + minY - pad);
    const cropW = Math.min(fullW - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(fullH - cropY, maxY - minY + 1 + pad * 2);

    return {
      x: cropX,
      y: cropY,
      w: cropW,
      h: cropH,
      inkCount,
      blueInkCount,
    };
  }
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
   * Uses face detection to cleanly center on the applicant's face and shoulders ->
   * 1:1 aspect ratio -> Smooth resize to targetW x targetH -> JPEG compression.
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
      cropRect = null,
      faceDetect = true,
    } = opts;

    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    if (!sw || !sh) return null;

    let sx, sy, sSizeW, sSizeH;

    if (cropRect && cropRect.w > 10 && cropRect.h > 10) {
      sx = Math.max(0, Math.min(sw - 10, cropRect.x));
      sy = Math.max(0, Math.min(sh - 10, cropRect.y));
      sSizeW = Math.min(sw - sx, cropRect.w);
      sSizeH = Math.min(sh - sy, cropRect.h);
    } else if (faceDetect) {
      const faceResult = detectFaceRegion(sourceCanvas);
      if (faceResult && faceResult.faceFound && faceResult.cropRect) {
        sx = faceResult.cropRect.x;
        sy = faceResult.cropRect.y;
        sSizeW = faceResult.cropRect.w;
        sSizeH = faceResult.cropRect.h;
      } else {
        // Fallback: 1:1 center crop
        const size = Math.min(sw, sh);
        sx = Math.floor((sw - size) / 2);
        sy = Math.floor((sh - size) / 2);
        sSizeW = size;
        sSizeH = size;
      }
    } else {
      const size = Math.min(sw, sh);
      sx = Math.floor((sw - size) / 2);
      sy = Math.floor((sh - size) / 2);
      sSizeW = size;
      sSizeH = size;
    }

    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    ctx.drawImage(sourceCanvas, sx, sy, sSizeW, sSizeH, 0, 0, targetW, targetH);

    const compressed = await compressToTargetKB(out, maxKB, 'image/jpeg');
    return {
      canvas: out,
      blob: compressed.blob,
      base64: compressed.base64,
      kb: compressed.kb,
      width: targetW,
      height: targetH,
      rawCropRect: { x: sx, y: sy, w: sSizeW, h: sSizeH },
    };
  }

  global.ImageTools = {
    isSkinPixel,
    getSkinDensity,
    detectFaceRegion,
    detectSignatureRegion,
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
