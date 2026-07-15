/**
 * Linkify — shared tool logic.
 * Each page (image, video, audio, sticker, document) calls
 * LinkifyTool.mount(config) with its own rules. Keeps upload,
 * validation, compression, and copy-to-clipboard in one place.
 *
 * config = {
 *   cloudName:    string   — Cloudinary cloud name
 *   uploadPreset: string   — Cloudinary unsigned upload preset
 *   resourceType: 'image' | 'video' | 'raw'   — Cloudinary upload endpoint
 *   routePrefix:  string   — e.g. '/img', '/video' (used to build the short link)
 *   allowedMime:  string[] | null   — checked against file.type when present
 *   allowedExt:   string[] | null   — fallback/extra check against filename extension
 *   maxBytes:     number
 *   compress:     boolean  — re-encode via canvas before upload (images only)
 * }
 */
window.LinkifyTool = (function () {
  "use strict";

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getExt(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function mount(config) {
    const {
      cloudName, uploadPreset, resourceType, routePrefix,
      allowedMime, allowedExt, maxBytes, compress,
    } = config;

    const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

    const dropzone         = document.getElementById('dropzone');
    const fileInput         = document.getElementById('fileInput');
    const dropzoneEmpty     = document.getElementById('dropzoneEmpty');
    const dropzonePreview   = document.getElementById('dropzonePreview');
    const previewImg        = document.getElementById('previewImg');
    const previewIcon       = document.getElementById('previewIcon');
    const fileNameEl        = document.getElementById('fileName');
    const fileMetaEl        = document.getElementById('fileMeta');
    const changeFileBtn     = document.getElementById('changeFileBtn');
    const validationError   = document.getElementById('validationError');
    const generateBtn       = document.getElementById('generateBtn');
    const generateBtnLabel  = document.getElementById('generateBtnLabel');
    const generateSpinner   = document.getElementById('generateSpinner');
    const uploadError       = document.getElementById('uploadError');
    const uploadErrorDetail = document.getElementById('uploadErrorDetail');
    const resultCard        = document.getElementById('resultCard');
    const resultLink        = document.getElementById('resultLink');
    const openLink            = document.getElementById('openLink');
    const copyBtn              = document.getElementById('copyBtn');
    const toast                 = document.getElementById('toast');

    let selectedFile = null;
    let toastTimer = null;

    function showValidationError(message) {
      validationError.textContent = message;
      validationError.classList.remove('hidden');
    }
    function clearValidationError() {
      validationError.classList.add('hidden');
      validationError.textContent = '';
    }
    function resetResult() {
      resultCard.classList.add('hidden');
      uploadError.classList.add('hidden');
    }

    function validateFile(file) {
      const ext = getExt(file.name);
      const mimeOk = allowedMime ? allowedMime.includes(file.type) : true;
      const extOk = allowedExt ? allowedExt.includes(ext) : true;

      // If we have a mime list, pass on mime OR extension match (some mobile
      // browsers report a blank/incorrect type for less common formats).
      if (allowedMime && !mimeOk && !extOk) {
        return `Unsupported file type. Allowed: ${(allowedExt || allowedMime).join(', ').toUpperCase()}.`;
      }
      if (!allowedMime && allowedExt && !extOk) {
        return `Unsupported file type. Allowed: ${allowedExt.join(', ').toUpperCase()}.`;
      }
      if (file.size > maxBytes) {
        return `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(maxBytes)}.`;
      }
      return null;
    }

    function handleFileSelected(file) {
      clearValidationError();
      resetResult();

      const error = validateFile(file);
      if (error) {
        showValidationError(error);
        selectedFile = null;
        generateBtn.disabled = true;
        return;
      }

      selectedFile = file;
      generateBtn.disabled = false;

      fileNameEl.textContent = file.name;
      fileMetaEl.textContent = `${formatBytes(file.size)} · ${getExt(file.name).toUpperCase()}`;

      if (previewImg && file.type.startsWith('image/')) {
        previewImg.src = URL.createObjectURL(file);
        previewImg.classList.remove('hidden');
        if (previewIcon) previewIcon.classList.add('hidden');
      } else if (previewIcon) {
        previewIcon.classList.remove('hidden');
        if (previewImg) previewImg.classList.add('hidden');
      }

      dropzoneEmpty.classList.add('hidden');
      dropzonePreview.classList.remove('hidden');
      dropzonePreview.classList.add('flex');
    }

    function resetDropzone() {
      selectedFile = null;
      fileInput.value = '';
      generateBtn.disabled = true;
      dropzonePreview.classList.add('hidden');
      dropzonePreview.classList.remove('flex');
      dropzoneEmpty.classList.remove('hidden');
      clearValidationError();
      resetResult();
    }

    function setUploading(isUploading) {
      generateBtn.disabled = isUploading;
      if (!isUploading) generateBtnLabel.textContent = 'Generate Permanent Link';
      generateSpinner.classList.toggle('hidden', !isUploading);
      dropzone.classList.toggle('drop-active', isUploading);
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.add('hidden'), 1800);
    }

    // ---- image compression (used only when config.compress is true) ----
    const MAX_DIMENSION = 1920;
    const JPEG_QUALITY = 0.82;

    function compressImage(file) {
      return new Promise((resolve) => {
        if (!compress || file.type === 'image/gif') { resolve(file); return; }

        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          let { width, height } = img;
          if (width <= MAX_DIMENSION && height <= MAX_DIMENSION && file.size < 1.5 * 1024 * 1024) {
            resolve(file);
            return;
          }
          const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
            resolve(compressed.size < file.size ? compressed : file);
          }, 'image/jpeg', JPEG_QUALITY);
        };
        img.onerror = () => resolve(file);
        img.src = objectUrl;
      });
    }

    // ---- upload with progress ----
    function uploadToCloudinary(file, onProgress) {
      return new Promise((resolve, reject) => {
        if (!cloudName || !uploadPreset || cloudName === 'YOUR_CLOUD_NAME') {
          reject(new Error('Cloudinary is not configured yet.'));
          return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', uploadPreset);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', UPLOAD_URL, true);

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        });

        xhr.onload = () => {
          let data;
          try { data = JSON.parse(xhr.responseText); }
          catch (_) { reject(new Error('Server sent an unreadable response.')); return; }

          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(data?.error?.message || `Server responded with ${xhr.status}.`));
            return;
          }
          if (!data.public_id) {
            reject(new Error('Upload succeeded but no file ID was returned.'));
            return;
          }

          // Build a short, version-free link through this site's own domain.
          // e.g. /img/<public_id>.<ext> — see vercel.json for the proxy rules.
          let ext = data.format || getExt(file.name);
          let name = data.public_id;
          if (ext && !name.toLowerCase().endsWith('.' + ext.toLowerCase())) {
            name += '.' + ext;
          }
          resolve(`${window.location.origin}${routePrefix}/${name}`);
        };

        xhr.onerror = () => reject(new Error('Network error — check your connection and try again.'));
        xhr.send(formData);
      });
    }

    async function handleGenerateClick() {
      if (!selectedFile) return;
      resetResult();
      setUploading(true);

      try {
        generateBtnLabel.textContent = 'Optimizing…';
        const fileToUpload = await compressImage(selectedFile);

        const url = await uploadToCloudinary(fileToUpload, (pct) => {
          generateBtnLabel.textContent = `Uploading… ${pct}%`;
        });

        resultLink.value = url;
        if (openLink) openLink.href = url;
        resultCard.classList.remove('hidden');
      } catch (err) {
        uploadErrorDetail.textContent = err.message || 'Something went wrong. Please try again.';
        uploadError.classList.remove('hidden');
      } finally {
        setUploading(false);
      }
    }

    async function handleCopyClick() {
      const value = resultLink.value;
      if (!value) return;
      try { await navigator.clipboard.writeText(value); }
      catch (_) { resultLink.select(); document.execCommand('copy'); }

      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('border-good', 'text-good');
      showToast('Link copied to clipboard');
      setTimeout(() => {
        copyBtn.textContent = original;
        copyBtn.classList.remove('border-good', 'text-good');
      }, 1500);
    }

    // ---- wiring ----
    dropzone.addEventListener('click', (e) => {
      if (e.target === changeFileBtn) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelected(file);
    });
    changeFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetDropzone();
      fileInput.click();
    });
    ['dragenter', 'dragover'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.add('drop-active');
      });
    });
    dropzone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('drop-active');
      const file = e.dataTransfer.files?.[0];
      if (file) handleFileSelected(file);
    });
    generateBtn.addEventListener('click', handleGenerateClick);
    copyBtn.addEventListener('click', handleCopyClick);
  }

  return { mount };
})();
