/**
 * photo-signature-capture.js
 * ---------------------------------------------------------------
 * Wires up two capture tools on top of image-processing.js:
 *   1. Photo capture  -> manual drag-crop locked to 300x300 (1:1)
 *   2. Signature capture -> auto "scanner" effect, locked to 300x80
 *
 * Meets official Bangladesh Government / Teletalk specifications:
 *   - Photo: 300 x 300 pixels, <= 100 KB
 *   - Signature: 300 x 80 pixels, <= 60 KB
 *
 * Depends on: window.ImageTools (image-processing.js)
 * Storage: chrome.storage.local, keys:
 *   profile_photo::<profileId>      -> { base64, kb, updatedAt }
 *   profile_signature::<profileId>  -> { base64, kb, updatedAt }
 *
 * Load order in profiles.html:
 *   <script src="lib/image-processing.js"></script>
 *   <script src="lib/photo-signature-capture.js"></script>
 *
 * Then from profiles.js call:
 *   ProfileCapture.initPhotoCapture('#photoInput', '#photoPreview', profileId);
 *   ProfileCapture.initSignatureCapture('#sigInput', '#sigPreview', profileId);
 * ---------------------------------------------------------------
 */
(function (global) {
  'use strict';

  function getStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  function saveToStorage(key, value) {
    return new Promise((resolve, reject) => {
      const storage = getStorage();
      if (storage) {
        storage.set({ [key]: value }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(value);
          }
        });
      } else if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('chrome_storage_local_' + key, JSON.stringify(value));
          resolve(value);
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error('Storage not available'));
      }
    });
  }

  function getFromStorage(key) {
    return new Promise((resolve, reject) => {
      const storage = getStorage();
      if (storage) {
        storage.get([key], (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result ? result[key] || null : null);
          }
        });
      } else if (typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem('chrome_storage_local_' + key);
          resolve(raw ? JSON.parse(raw) : null);
        } catch (e) {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
  }

  function removeFromStorage(key) {
    return new Promise((resolve) => {
      const storage = getStorage();
      if (storage && typeof storage.remove === 'function') {
        storage.remove([key], () => resolve());
      } else if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('chrome_storage_local_' + key);
        resolve();
      } else {
        resolve();
      }
    });
  }

  // ---------------------------------------------------------------
  // Shared: draggable/resizable crop box over an <img>, locked ratio
  // ---------------------------------------------------------------
  function buildCropOverlay(container, img, aspectW, aspectH, initialRect = null) {
    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.display = 'inline-block';
    container.style.maxWidth = '100%';
    container.style.userSelect = 'none';

    img.style.display = 'block';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '360px';
    img.style.borderRadius = '6px';
    container.appendChild(img);

    const box = document.createElement('div');
    box.style.position = 'absolute';
    box.style.border = '2px solid #2563eb';
    box.style.background = 'rgba(37, 99, 235, 0.18)';
    box.style.cursor = 'move';
    box.style.boxSizing = 'border-box';
    box.style.boxShadow = '0 0 0 9999px rgba(15, 23, 42, 0.45)';
    box.style.touchAction = 'none';

    const handle = document.createElement('div');
    handle.style.position = 'absolute';
    handle.style.right = '-8px';
    handle.style.bottom = '-8px';
    handle.style.width = '16px';
    handle.style.height = '16px';
    handle.style.background = '#2563eb';
    handle.style.border = '2px solid #ffffff';
    handle.style.borderRadius = '50%';
    handle.style.cursor = 'nwse-resize';
    handle.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
    box.appendChild(handle);
    container.appendChild(box);

    const ratio = aspectW / aspectH;
    let state = { x: 0, y: 0, w: 0, h: 0 };

    function applyState() {
      box.style.left = state.x + 'px';
      box.style.top = state.y + 'px';
      box.style.width = state.w + 'px';
      box.style.height = state.h + 'px';
    }

    function initState() {
      const cw = img.clientWidth || img.naturalWidth || 300;
      const ch = img.clientHeight || img.naturalHeight || 300;
      const natW = img.naturalWidth || cw;
      const natH = img.naturalHeight || ch;

      if (initialRect && initialRect.w > 10 && initialRect.h > 10) {
        const scaleX = cw / natW;
        const scaleY = ch / natH;
        let rx = initialRect.x * scaleX;
        let ry = initialRect.y * scaleY;
        let rw = initialRect.w * scaleX;
        let rh = rw / ratio;
        state = { x: rx, y: ry, w: rw, h: rh };
        clamp();
        applyState();
        return;
      }

      let w = Math.min(cw, ch * ratio) * 0.85;
      let h = w / ratio;
      state = { x: Math.max(0, (cw - w) / 2), y: Math.max(0, (ch - h) / 2), w, h };
      applyState();
    }

    if (img.complete && img.clientWidth > 0) {
      initState();
    } else {
      img.onload = initState;
    }

    let dragging = null; // 'move' | 'resize'
    let start = null;

    function clamp() {
      const cw = img.clientWidth;
      const ch = img.clientHeight;
      state.w = Math.max(30, Math.min(state.w, cw));
      state.h = state.w / ratio;
      if (state.h > ch) {
        state.h = ch;
        state.w = state.h * ratio;
      }
      state.x = Math.max(0, Math.min(state.x, cw - state.w));
      state.y = Math.max(0, Math.min(state.y, ch - state.h));
    }

    function onPointerDown(e) {
      dragging = e.target === handle ? 'resize' : 'move';
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      start = { mx: clientX, my: clientY, ...state };
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - start.mx;
      const dy = clientY - start.my;
      if (dragging === 'move') {
        state.x = start.x + dx;
        state.y = start.y + dy;
      } else {
        state.w = Math.max(30, start.w + dx);
        state.h = state.w / ratio;
      }
      clamp();
      applyState();
    }

    function onPointerUp() {
      dragging = null;
    }

    box.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    box.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);

    return {
      getCropRect() {
        const scaleX = (img.naturalWidth || img.clientWidth) / (img.clientWidth || 1);
        const scaleY = (img.naturalHeight || img.clientHeight) / (img.clientHeight || 1);
        return {
          x: state.x * scaleX,
          y: state.y * scaleY,
          w: state.w * scaleX,
          h: state.h * scaleY,
        };
      },
    };
  }

  function cropRectToCanvas(img, rect, targetW, targetH) {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, targetW, targetH);
    return canvas;
  }

  // ---------------------------------------------------------------
  // 1. PHOTO capture — manual crop, 300x300, JPEG compressed (<=100KB)
  // ---------------------------------------------------------------
  async function initPhotoCapture(inputSel, previewSel, profileId, opts = {}) {
    const { targetW = 300, targetH = 300, maxKB = 100 } = opts;
    const input = document.querySelector(inputSel);
    const preview = document.querySelector(previewSel);
    if (!input || !preview) return;

    // Load existing photo if saved
    if (profileId) {
      const existing = await getProfilePhoto(profileId);
      if (existing && existing.base64) {
        showSavedThumbnail(preview, existing.base64, `Photo: ${targetW}×${targetH}px (${existing.kb} KB)`, async () => {
          await deleteProfilePhoto(profileId);
          preview.innerHTML = '<span class="capture-placeholder-text">No photo uploaded yet (300×300px required)</span>';
          input.value = '';
        });
      } else {
        preview.innerHTML = '<span class="capture-placeholder-text">No photo uploaded yet (300×300px required)</span>';
      }
    }

    // Replace previous change handler to avoid double bindings
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('change', async () => {
      const file = newInput.files[0];
      if (!file) return;

      preview.innerHTML = '<div class="capture-loading">Preparing image for crop...</div>';
      try {
        const img = await global.ImageTools.loadImage(file);
        const stageWrap = document.createElement('div');
        stageWrap.className = 'capture-stage-wrapper';
        preview.innerHTML = '';
        preview.appendChild(stageWrap);

        const overlay = buildCropOverlay(stageWrap, img, targetW, targetH);

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'capture-controls-row';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'button button--primary capture-save-btn';
        saveBtn.innerHTML = `✓ Save Photo (${targetW}×${targetH})`;

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'button button--secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = async () => {
          newInput.value = '';
          if (profileId) {
            const existing = await getProfilePhoto(profileId);
            if (existing && existing.base64) {
              showSavedThumbnail(preview, existing.base64, `Photo: ${targetW}×${targetH}px (${existing.kb} KB)`, async () => {
                await deleteProfilePhoto(profileId);
                preview.innerHTML = '<span class="capture-placeholder-text">No photo uploaded yet</span>';
              });
            } else {
              preview.innerHTML = '<span class="capture-placeholder-text">No photo uploaded yet</span>';
            }
          } else {
            preview.innerHTML = '<span class="capture-placeholder-text">No photo uploaded yet</span>';
          }
        };

        saveBtn.onclick = async () => {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Optimizing & saving...';
          const rect = overlay.getCropRect();
          const cropped = cropRectToCanvas(img, rect, targetW, targetH);
          const result = await global.ImageTools.compressToTargetKB(cropped, maxKB, 'image/jpeg');

          if (profileId) {
            await saveToStorage(`profile_photo::${profileId}`, {
              base64: result.base64,
              kb: result.kb,
              width: targetW,
              height: targetH,
              updatedAt: Date.now(),
            });
          }

          showSavedThumbnail(preview, result.base64, `✓ Photo Saved (${targetW}×${targetH}px, ${result.kb} KB)`, async () => {
            if (profileId) await deleteProfilePhoto(profileId);
            preview.innerHTML = '<span class="capture-placeholder-text">No photo uploaded yet</span>';
            newInput.value = '';
          });
        };

        actionsWrap.appendChild(saveBtn);
        actionsWrap.appendChild(cancelBtn);
        preview.appendChild(actionsWrap);
      } catch (err) {
        console.error('Photo load error:', err);
        preview.innerHTML = `<span class="capture-error">Failed to load photo: ${err.message}</span>`;
      }
    });
  }

  // ---------------------------------------------------------------
  // 2. SIGNATURE capture — auto CamScanner scan effect, 300x80 (<=60KB)
  // ---------------------------------------------------------------
  async function initSignatureCapture(inputSel, previewSel, profileId, opts = {}) {
    const { targetW = 300, targetH = 80, maxKB = 60 } = opts;
    const input = document.querySelector(inputSel);
    const preview = document.querySelector(previewSel);
    if (!input || !preview) return;

    // Load existing signature if saved
    if (profileId) {
      const existing = await getProfileSignature(profileId);
      if (existing && existing.base64) {
        showSavedThumbnail(preview, existing.base64, `Signature: ${targetW}×${targetH}px (${existing.kb} KB)`, async () => {
          await deleteProfileSignature(profileId);
          preview.innerHTML = '<span class="capture-placeholder-text">No signature uploaded yet (300×80px required)</span>';
          input.value = '';
        });
      } else {
        preview.innerHTML = '<span class="capture-placeholder-text">No signature uploaded yet (300×80px required)</span>';
      }
    }

    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('change', () => {
      const file = newInput.files[0];
      if (!file) return;

      let sensitivity = 12;
      let isProcessing = false;

      async function runPipeline() {
        if (isProcessing) return;
        isProcessing = true;
        preview.innerHTML = '<div class="capture-loading">Scanning document &amp; enhancing strokes...</div>';

        try {
          const canvas = await global.ImageTools.processSignatureFile(file, {
            targetW,
            targetH,
            sensitivity,
            windowSize: 21,
            sharpenPass: true,
            autoCrop: true,
          });

          preview.innerHTML = '';

          const canvasWrap = document.createElement('div');
          canvasWrap.className = 'capture-signature-canvas-wrap';
          canvas.style.display = 'block';
          canvas.style.maxWidth = '100%';
          canvas.style.border = '1px solid #cbd5e1';
          canvas.style.borderRadius = '4px';
          canvas.style.background = '#ffffff';
          canvas.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
          canvasWrap.appendChild(canvas);
          preview.appendChild(canvasWrap);

          // Contrast / threshold sensitivity slider
          renderSensitivitySlider(preview, sensitivity, (val) => {
            sensitivity = val;
            runPipeline();
          });

          // Controls
          const actionsWrap = document.createElement('div');
          actionsWrap.className = 'capture-controls-row';

          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'button button--primary capture-save-btn';
          saveBtn.innerHTML = `✓ Save Signature (${targetW}×${targetH})`;

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'button button--secondary';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.onclick = async () => {
            newInput.value = '';
            if (profileId) {
              const existing = await getProfileSignature(profileId);
              if (existing && existing.base64) {
                showSavedThumbnail(preview, existing.base64, `Signature: ${targetW}×${targetH}px (${existing.kb} KB)`, async () => {
                  await deleteProfileSignature(profileId);
                  preview.innerHTML = '<span class="capture-placeholder-text">No signature uploaded yet</span>';
                });
              } else {
                preview.innerHTML = '<span class="capture-placeholder-text">No signature uploaded yet</span>';
              }
            } else {
              preview.innerHTML = '<span class="capture-placeholder-text">No signature uploaded yet</span>';
            }
          };

          saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Compressing & saving...';
            const result = await global.ImageTools.compressToTargetKB(canvas, maxKB, 'image/png');

            if (profileId) {
              await saveToStorage(`profile_signature::${profileId}`, {
                base64: result.base64,
                kb: result.kb,
                width: targetW,
                height: targetH,
                updatedAt: Date.now(),
              });
            }

            showSavedThumbnail(preview, result.base64, `✓ Signature Saved (${targetW}×${targetH}px, ${result.kb} KB)`, async () => {
              if (profileId) await deleteProfileSignature(profileId);
              preview.innerHTML = '<span class="capture-placeholder-text">No signature uploaded yet</span>';
              newInput.value = '';
            });
          };

          actionsWrap.appendChild(saveBtn);
          actionsWrap.appendChild(cancelBtn);
          preview.appendChild(actionsWrap);
        } catch (err) {
          console.error('Signature scan error:', err);
          preview.innerHTML = `<span class="capture-error">Failed to scan signature: ${err.message}</span>`;
        } finally {
          isProcessing = false;
        }
      }

      runPipeline();
    });
  }

  // ---------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------
  function renderSensitivitySlider(container, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'capture-slider-wrap';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.fontSize = '11px';
    header.style.color = 'var(--color-text-muted, #475569)';
    header.style.marginBottom = '4px';

    const label = document.createElement('span');
    label.textContent = 'Scanner Stroke Contrast:';
    const valText = document.createElement('span');
    valText.textContent = `${value}`;
    header.appendChild(label);
    header.appendChild(valText);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '2';
    slider.max = '35';
    slider.value = String(value);
    slider.style.width = '100%';
    slider.style.cursor = 'pointer';

    slider.addEventListener('input', () => {
      valText.textContent = slider.value;
    });
    slider.addEventListener('change', () => {
      onChange(Number(slider.value));
    });

    wrap.appendChild(header);
    wrap.appendChild(slider);
    container.appendChild(wrap);
  }

  function showSavedThumbnail(container, base64, caption, onRemove, onAdjust = null) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'capture-saved-box';

    const img = document.createElement('img');
    img.src = base64;
    img.alt = 'Uploaded preview';
    img.className = 'capture-saved-img';
    wrap.appendChild(img);

    const infoRow = document.createElement('div');
    infoRow.className = 'capture-saved-info';

    const p = document.createElement('span');
    p.textContent = caption;
    infoRow.appendChild(p);

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '6px';
    btnGroup.style.alignItems = 'center';

    if (onAdjust) {
      const adjustBtn = document.createElement('button');
      adjustBtn.type = 'button';
      adjustBtn.className = 'button button--secondary button--small';
      adjustBtn.style.padding = '3px 8px';
      adjustBtn.style.fontSize = '12px';
      adjustBtn.innerHTML = '✂️ Adjust Crop';
      adjustBtn.onclick = onAdjust;
      btnGroup.appendChild(adjustBtn);
    }

    if (onRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'capture-remove-btn';
      removeBtn.innerHTML = '🗑️ Remove';
      removeBtn.onclick = onRemove;
      btnGroup.appendChild(removeBtn);
    }

    infoRow.appendChild(btnGroup);
    wrap.appendChild(infoRow);
    container.appendChild(wrap);
  }

  /**
   * Opens the interactive 1:1 cropper overlay over a canvas or image.
   */
  async function openPhotoCropper(sourceCanvasOrImg, profileId, previewContainer, initialRect = null, opts = {}) {
    const { targetW = 300, targetH = 300, maxKB = 100 } = opts;
    if (!previewContainer || !sourceCanvasOrImg) return;

    previewContainer.innerHTML = '';
    const stageWrap = document.createElement('div');
    stageWrap.className = 'capture-stage-wrapper';
    previewContainer.appendChild(stageWrap);

    let imgElement;
    if (sourceCanvasOrImg instanceof HTMLCanvasElement) {
      imgElement = new Image();
      imgElement.src = sourceCanvasOrImg.toDataURL('image/png');
      await new Promise(r => { imgElement.onload = r; });
    } else {
      imgElement = sourceCanvasOrImg;
    }

    const overlay = buildCropOverlay(stageWrap, imgElement, targetW, targetH, initialRect);

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'capture-controls-row';
    actionsWrap.style.marginTop = '8px';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'button button--primary capture-save-btn';
    saveBtn.innerHTML = `✓ Save Photo (${targetW}×${targetH})`;

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button button--secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      refreshPreviews(profileId);
    };

    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      const rect = overlay.getCropRect();
      const cropped = cropRectToCanvas(imgElement, rect, targetW, targetH);
      const result = await global.ImageTools.compressToTargetKB(cropped, maxKB, 'image/jpeg');

      if (profileId) {
        await saveProfilePhoto(profileId, {
          base64: result.base64,
          kb: result.kb,
          width: targetW,
          height: targetH,
        });
        setActiveMediaSource(profileId, 'photo', {
          canvas: sourceCanvasOrImg,
          rect,
        });
      }

      await refreshPreviews(profileId);
    };

    actionsWrap.appendChild(saveBtn);
    actionsWrap.appendChild(cancelBtn);
    previewContainer.appendChild(actionsWrap);
  }

  /**
   * Opens the interactive 300:80 cropper overlay over a canvas or image with CamScanner enhancement.
   */
  async function openSignatureCropper(sourceCanvasOrImg, profileId, previewContainer, initialRect = null, opts = {}) {
    const { targetW = 300, targetH = 80, maxKB = 60 } = opts;
    if (!previewContainer || !sourceCanvasOrImg) return;

    previewContainer.innerHTML = '';
    const stageWrap = document.createElement('div');
    stageWrap.className = 'capture-stage-wrapper';
    previewContainer.appendChild(stageWrap);

    let imgElement;
    if (sourceCanvasOrImg instanceof HTMLCanvasElement) {
      imgElement = new Image();
      imgElement.src = sourceCanvasOrImg.toDataURL('image/png');
      await new Promise(r => { imgElement.onload = r; });
    } else {
      imgElement = sourceCanvasOrImg;
    }

    const overlay = buildCropOverlay(stageWrap, imgElement, targetW, targetH, initialRect);

    let sensitivity = 12;
    renderSensitivitySlider(previewContainer, sensitivity, (val) => {
      sensitivity = val;
    });

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'capture-controls-row';
    actionsWrap.style.marginTop = '8px';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'button button--primary capture-save-btn';
    saveBtn.innerHTML = `✓ Save Signature (${targetW}×${targetH})`;

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button button--secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      refreshPreviews(profileId);
    };

    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Enhancing & saving...';
      const rect = overlay.getCropRect();
      const rawCrop = document.createElement('canvas');
      rawCrop.width = Math.max(10, rect.w);
      rawCrop.height = Math.max(10, rect.h);
      rawCrop.getContext('2d').drawImage(imgElement, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

      const processed = await global.ImageTools.processSignatureCanvas(rawCrop, {
        targetW,
        targetH,
        maxKB,
        sensitivity,
        autoCrop: true,
      });

      if (profileId && processed) {
        await saveProfileSignature(profileId, {
          base64: processed.base64,
          kb: processed.kb,
          width: targetW,
          height: targetH,
        });
        setActiveMediaSource(profileId, 'signature', {
          canvas: sourceCanvasOrImg,
          rect,
        });
      }

      await refreshPreviews(profileId);
    };

    actionsWrap.appendChild(saveBtn);
    actionsWrap.appendChild(cancelBtn);
    previewContainer.appendChild(actionsWrap);
  }

  // ---------------------------------------------------------------
  // Retrieval, save, and removal helpers
  // ---------------------------------------------------------------
  async function getProfilePhoto(profileId) {
    return getFromStorage(`profile_photo::${profileId}`);
  }

  async function getProfileSignature(profileId) {
    return getFromStorage(`profile_signature::${profileId}`);
  }

  async function saveProfilePhoto(profileId, { base64, kb }) {
    return saveToStorage(`profile_photo::${profileId}`, {
      base64,
      kb,
      updatedAt: new Date().toISOString()
    });
  }

  async function saveProfileSignature(profileId, { base64, kb }) {
    return saveToStorage(`profile_signature::${profileId}`, {
      base64,
      kb,
      updatedAt: new Date().toISOString()
    });
  }

  async function deleteProfilePhoto(profileId) {
    return removeFromStorage(`profile_photo::${profileId}`);
  }

  async function deleteProfileSignature(profileId) {
    return removeFromStorage(`profile_signature::${profileId}`);
  }

  async function refreshPreviews(profileId) {
    if (!profileId) return;
    const photoPrev = document.getElementById('photoPreview');
    const sigPrev = document.getElementById('sigPreview');
    const photoInput = document.getElementById('photoInput');
    const sigInput = document.getElementById('sigInput');

    if (photoPrev) {
      const p = await getProfilePhoto(profileId);
      if (p && p.base64) {
        const photoSource = getActiveMediaSource(profileId, 'photo');
        const onAdjust = photoSource ? () => {
          openPhotoCropper(photoSource.canvas, profileId, photoPrev, photoSource.rect);
        } : null;

        showSavedThumbnail(
          photoPrev,
          p.base64,
          `Photo: 300×300px (${p.kb} KB)`,
          async () => {
            await deleteProfilePhoto(profileId);
            photoPrev.innerHTML = '<span class="capture-placeholder-text">No photo uploaded yet (300×300px required)</span>';
            if (photoInput) photoInput.value = '';
          },
          onAdjust
        );
      }
    }

    if (sigPrev) {
      const s = await getProfileSignature(profileId);
      if (s && s.base64) {
        const sigSource = getActiveMediaSource(profileId, 'signature');
        const onAdjust = sigSource ? () => {
          openSignatureCropper(sigSource.canvas, profileId, sigPrev, sigSource.rect);
        } : null;

        showSavedThumbnail(
          sigPrev,
          s.base64,
          `Signature: 300×80px (${s.kb} KB)`,
          async () => {
            await deleteProfileSignature(profileId);
            sigPrev.innerHTML = '<span class="capture-placeholder-text">No signature uploaded yet (300×80px required)</span>';
            if (sigInput) sigInput.value = '';
          },
          onAdjust
        );
      }
    }
  }

  global.ProfileCapture = {
    initPhotoCapture,
    initSignatureCapture,
    openPhotoCropper,
    openSignatureCropper,
    setActiveMediaSource,
    getActiveMediaSource,
    getProfilePhoto,
    getProfileSignature,
    saveProfilePhoto,
    saveProfileSignature,
    deleteProfilePhoto,
    deleteProfileSignature,
    refreshPreviews,
    showSavedThumbnail,
  };
})(typeof window !== 'undefined' ? window : this);
