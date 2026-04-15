// 상태
let files = [];
let selectedIndex = -1;
let adjustments = { brightness: 0, saturation: 0, sharpness: 0 };
let previewMode = 'after';
let processedBlobs = [];
let failedFiles = [];
let zipBlob = null;

// DOM 요소
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileSelectBtn = document.getElementById('file-select-btn');
const thumbnailList = document.getElementById('thumbnail-list');
const fileCount = document.getElementById('file-count');
const clearAllBtn = document.getElementById('clear-all-btn');
const previewArea = document.getElementById('preview-area');
const beforeCanvas = document.getElementById('before-canvas');
const afterCanvas = document.getElementById('after-canvas');
const previewTitle = document.getElementById('preview-title');
const previewStatusText = document.getElementById('preview-status-text');
const compareBtn = document.getElementById('compare-btn');
const brightnessSlider = document.getElementById('brightness-slider');
const brightnessValue = document.getElementById('brightness-value');
const saturationSlider = document.getElementById('saturation-slider');
const saturationValue = document.getElementById('saturation-value');
const sharpnessSlider = document.getElementById('sharpness-slider');
const sharpnessValue = document.getElementById('sharpness-value');
const brightnessReset = document.getElementById('brightness-reset');
const saturationReset = document.getElementById('saturation-reset');
const sharpnessReset = document.getElementById('sharpness-reset');
const applyAllBtn = document.getElementById('apply-all-btn');
const progressOverlay = document.getElementById('progress-overlay');
const progressFill = document.getElementById('progress-fill');
const progressMeta = document.getElementById('progress-meta');
const errorList = document.getElementById('error-list');

// 유틸리티
function isSupportedImageFile(file) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
         /\.(jpe?g|png|webp)$/i.test(file.name);
}

function normalizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._\-가-힣]/g, '_');
}

async function loadImageMetadata(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      reject(new Error('이미지 로드 실패'));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

function createThumbnail(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 52;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(img.src);
      resolve(thumbnailUrl);
    };
    img.src = URL.createObjectURL(file);
  });
}

function clamp(value, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = ((gn - bn) / delta) % 6;
        break;
      case gn:
        h = (bn - rn) / delta + 2;
        break;
      case bn:
        h = (rn - gn) / delta + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h >= 0 && h < 60) {
    r1 = c;
    g1 = x;
  } else if (h >= 60 && h < 120) {
    r1 = x;
    g1 = c;
  } else if (h >= 120 && h < 180) {
    g1 = c;
    b1 = x;
  } else if (h >= 180 && h < 240) {
    g1 = x;
    b1 = c;
  } else if (h >= 240 && h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: clamp(Math.round((r1 + m) * 255)),
    g: clamp(Math.round((g1 + m) * 255)),
    b: clamp(Math.round((b1 + m) * 255)),
  };
}

function applyColorAdjustments(data, adjustments) {
  const brightnessFactor = 1 + (adjustments.brightness / 200);
  const saturationAmount = adjustments.saturation * 0.008;

  for (let i = 0; i < data.data.length; i += 4) {
    let r = data.data[i];
    let g = data.data[i + 1];
    let b = data.data[i + 2];
    const a = data.data[i + 3];

    r = clamp(r * brightnessFactor);
    g = clamp(g * brightnessFactor);
    b = clamp(b * brightnessFactor);

    if (saturationAmount !== 0) {
      const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
      r = clamp(gray + (r - gray) * (1 + saturationAmount));
      g = clamp(gray + (g - gray) * (1 + saturationAmount));
      b = clamp(gray + (b - gray) * (1 + saturationAmount));
    }

    data.data[i] = r;
    data.data[i + 1] = g;
    data.data[i + 2] = b;
    data.data[i + 3] = a;
  }
}

function applySharpen(data, sharpness) {
  if (sharpness <= 0) {
    return;
  }

  const width = data.width;
  const height = data.height;
  const copy = new Uint8ClampedArray(data.data);
  const amount = (sharpness / 100) * 0.8;
  const index = (x, y, c) => (y * width + x) * 4 + c;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const center = copy[index(x, y, channel)];
        const left = copy[index(x - 1, y, channel)];
        const right = copy[index(x + 1, y, channel)];
        const top = copy[index(x, y - 1, channel)];
        const bottom = copy[index(x, y + 1, channel)];
        const edgeStrength = Math.abs(center - left) + Math.abs(center - right) +
                            Math.abs(center - top) + Math.abs(center - bottom);

        if (edgeStrength > 6) {
          const sharpened = center + (center - (left + right + top + bottom) / 4) * amount;
          data.data[index(x, y, channel)] = clamp(Math.round(sharpened));
        }
      }
    }
  }
}

async function renderPreviewToCanvas(canvas, imageUrl, adjustments, mode) {
  const img = new Image();
  img.src = imageUrl;
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('미리보기 로드 실패'));
  });

  const width = img.naturalWidth;
  const height = img.naturalHeight;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  if (mode === 'after' && (adjustments.brightness || adjustments.saturation || adjustments.sharpness)) {
    const imageData = ctx.getImageData(0, 0, width, height);
    applyColorAdjustments(imageData, adjustments);
    if (adjustments.sharpness > 0) {
      applySharpen(imageData, adjustments.sharpness);
    }
    ctx.putImageData(imageData, 0, 0);
  }
}

async function processImageFile(file, adjustments) {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  let canvas;
  let ctx;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
  }

  if (!ctx) {
    throw new Error('Canvas context unavailable');
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  if (adjustments.brightness || adjustments.saturation || adjustments.sharpness) {
    const imageData = ctx.getImageData(0, 0, width, height);
    applyColorAdjustments(imageData, adjustments);
    if (adjustments.sharpness > 0) {
      applySharpen(imageData, adjustments.sharpness);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  const type = file.type || 'image/png';
  const quality = type === 'image/jpeg' ? 0.95 : undefined;

  if (canvas.convertToBlob) {
    return await canvas.convertToBlob({ type, quality });
  }

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Blob 생성 실패'));
    }, type, quality);
  });
}

function updateFileCount() {
  fileCount.textContent = `이미지 ${files.length}장`;
  clearAllBtn.disabled = files.length === 0;
  applyAllBtn.disabled = files.length === 0;
}

function updateThumbnails() {
  thumbnailList.innerHTML = '';
  files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = `thumbnail-item${selectedIndex === index ? ' selected' : ''}`;
    item.onclick = () => selectImage(index);
    item.innerHTML = `
      <img src="${file.thumbnailUrl}" alt="${file.name}">
      <div class="thumb-info">
        <strong>${file.name}</strong>
        <span>${file.width}×${file.height}</span>
      </div>
    `;
    thumbnailList.appendChild(item);
  });
}

function selectImage(index) {
  selectedIndex = index;
  updateThumbnails();
  updatePreview();
}

function updatePreview() {
  const file = files[selectedIndex];
  const emptyMessage = previewArea.querySelector('.empty-preview');

  if (!file) {
    beforeCanvas.style.display = 'none';
    afterCanvas.style.display = 'none';
    if (emptyMessage) emptyMessage.style.display = 'block';
    previewTitle.textContent = '선택된 이미지 없음';
    previewStatusText.textContent = '원본과 편집본 비교 중';
    return;
  }

  if (emptyMessage) emptyMessage.style.display = 'none';
  previewTitle.textContent = file.name;

  renderPreviewToCanvas(beforeCanvas, file.previewUrl, adjustments, 'before').catch(() => {});
  renderPreviewToCanvas(afterCanvas, file.previewUrl, adjustments, 'after').catch(() => {});
  updatePreviewDisplay();
}

function updatePreviewDisplay() {
  if (previewMode === 'before') {
    beforeCanvas.style.display = 'block';
    afterCanvas.style.display = 'none';
    previewStatusText.textContent = '원본 보기 중';
  } else {
    beforeCanvas.style.display = 'none';
    afterCanvas.style.display = 'block';
    previewStatusText.textContent = '편집본 보기 중';
  }
}

function updateAdjustmentValues() {
  brightnessValue.textContent = adjustments.brightness;
  saturationValue.textContent = adjustments.saturation;
  sharpnessValue.textContent = adjustments.sharpness;
  updateSliderVisuals();
}

function updateSliderVisuals() {
  setRangeBackground(brightnessSlider, adjustments.brightness, true);
  setRangeBackground(saturationSlider, adjustments.saturation, true);
  setRangeBackground(sharpnessSlider, adjustments.sharpness, false);
}

function setRangeBackground(slider, value, centered) {
  if (centered) {
    const percent = Math.min(Math.max((value + 100) / 2, 0), 100);
    const mid = 50;

    if (value > 0) {
      slider.style.background = `linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.08) ${mid}%, #5eb5ff ${mid}%, #5eb5ff ${percent}%, rgba(255,255,255,0.08) ${percent}%, rgba(255,255,255,0.08) 100%)`;
    } else if (value < 0) {
      slider.style.background = `linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.08) ${percent}%, #5eb5ff ${percent}%, #5eb5ff ${mid}%, rgba(255,255,255,0.08) ${mid}%, rgba(255,255,255,0.08) 100%)`;
    } else {
      slider.style.background = 'linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.08) 100%)';
    }
  } else {
    const percent = Math.min(Math.max(value, 0), 100);
    slider.style.background = `linear-gradient(90deg, #5eb5ff 0%, #5eb5ff ${percent}%, rgba(255,255,255,0.08) ${percent}%, rgba(255,255,255,0.08) 100%)`;
  }

  slider.style.backgroundRepeat = 'no-repeat';
  slider.style.backgroundPosition = 'center';
  slider.style.backgroundSize = '100% 12px';
}

function handleFiles(fileList) {
  const validFiles = [];
  const invalidNames = [];

  const tasks = Array.from(fileList).map(async (file) => {
    if (!isSupportedImageFile(file)) {
      invalidNames.push(file.name);
      return;
    }

    try {
      const metadata = await loadImageMetadata(file);
      const thumbnailUrl = await createThumbnail(file);
      const previewUrl = URL.createObjectURL(file);
      validFiles.push({
        file,
        name: file.name,
        type: file.type,
        size: file.size,
        thumbnailUrl,
        previewUrl,
        width: metadata.width,
        height: metadata.height,
      });
    } catch (error) {
      invalidNames.push(file.name);
    }
  });

  Promise.all(tasks).then(() => {
    if (invalidNames.length) {
      alert(`지원하지 않는 파일 또는 로드 실패: ${invalidNames.join(', ')}`);
    }

    if (validFiles.length > 0) {
      files.push(...validFiles);
      if (selectedIndex === -1) selectedIndex = 0;
      updateFileCount();
      updateThumbnails();
      updatePreview();
    }
  });
}

function resetAppState() {
  files.forEach((file) => {
    URL.revokeObjectURL(file.previewUrl);
  });
  files = [];
  selectedIndex = -1;
  processedBlobs = [];
  failedFiles = [];
  zipBlob = null;
  updateFileCount();
  updateThumbnails();
  updatePreview();
}

function updateAfterPreview() {
  if (files[selectedIndex]) {
    renderPreviewToCanvas(afterCanvas, files[selectedIndex].previewUrl, adjustments, 'after').catch(() => {});
  }
}

function attachEventListeners() {
  fileSelectBtn.onclick = () => fileInput.click();

  fileInput.onchange = (event) => {
    const fileList = event.target.files;
    if (fileList) handleFiles(fileList);
  };

  dropZone.ondragover = (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
  };

  dropZone.ondragleave = () => {
    dropZone.classList.remove('drag-over');
  };

  dropZone.ondrop = (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(event.dataTransfer.files);
  };

  clearAllBtn.onclick = () => resetAppState();

  brightnessSlider.oninput = (event) => {
    adjustments.brightness = Number(event.target.value);
    updateAdjustmentValues();
    updateAfterPreview();
  };

  saturationSlider.oninput = (event) => {
    adjustments.saturation = Number(event.target.value);
    updateAdjustmentValues();
    updateAfterPreview();
  };

  sharpnessSlider.oninput = (event) => {
    adjustments.sharpness = Number(event.target.value);
    updateAdjustmentValues();
    updateAfterPreview();
  };

  brightnessReset.onclick = () => {
    adjustments.brightness = 0;
    brightnessSlider.value = '0';
    updateAdjustmentValues();
    updatePreview();
  };

  saturationReset.onclick = () => {
    adjustments.saturation = 0;
    saturationSlider.value = '0';
    updateAdjustmentValues();
    updatePreview();
  };

  sharpnessReset.onclick = () => {
    adjustments.sharpness = 0;
    sharpnessSlider.value = '0';
    updateAdjustmentValues();
    updatePreview();
  };

  compareBtn.addEventListener('mousedown', () => {
    previewMode = 'before';
    updatePreviewDisplay();
  });

  compareBtn.addEventListener('mouseup', () => {
    previewMode = 'after';
    updatePreviewDisplay();
  });

  compareBtn.addEventListener('mouseleave', () => {
    previewMode = 'after';
    updatePreviewDisplay();
  });

  compareBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    previewMode = 'before';
    updatePreviewDisplay();
  });

  compareBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    previewMode = 'after';
    updatePreviewDisplay();
  });

  applyAllBtn.onclick = async () => {
    if (!files.length) return;

    progressOverlay.style.display = 'grid';
    progressFill.style.width = '0%';
    progressMeta.textContent = `0 / ${files.length} 처리 중`;
    errorList.style.display = 'none';
    processedBlobs = [];
    failedFiles = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      progressMeta.textContent = `${i + 1} / ${files.length} 처리 중 - ${file.name}`;
      progressFill.style.width = `${((i + 1) / files.length) * 100}%`;

      try {
        const blob = await processImageFile(file.file, adjustments);
        processedBlobs.push({
          name: normalizeFilename(`edited_${file.name}`),
          blob,
        });
      } catch (error) {
        failedFiles.push(file.name);
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (failedFiles.length) {
      errorList.textContent = `실패: ${failedFiles.join(', ')}`;
      errorList.style.display = 'block';
    }

    progressMeta.textContent = 'ZIP 생성 중...';

    try {
      const zip = new JSZip();
      processedBlobs.forEach((item) => {
        zip.file(item.name, item.blob);
      });
      zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

      if (typeof saveAs === 'function') {
        saveAs(zipBlob, 'edited-images.zip');
      } else {
        const a = document.createElement('a');
        const url = URL.createObjectURL(zipBlob);
        a.href = url;
        a.download = 'edited-images.zip';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (error) {
      alert('ZIP 생성 중 오류가 발생했습니다.');
    }

    progressOverlay.style.display = 'none';
  };
}

function initializeApp() {
  attachEventListeners();
  updateFileCount();
  updateAdjustmentValues();
}

initializeApp();
