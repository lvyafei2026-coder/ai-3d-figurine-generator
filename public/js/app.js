let selectedFile = null;
let currentPreset = 'chibi';

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('preview');
const previewImg = document.getElementById('previewImg');
const generateBtn = document.getElementById('generateBtn');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const resultImg = document.getElementById('resultImg');

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (f) handleFile(f);
});

document.querySelectorAll('#stylePresets .preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#stylePresets .preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPreset = btn.dataset.preset;
  });
});

async function handleFile(file) {
  const tr = t();
  if (!file.type.startsWith('image/')) {
    showError(tr.errType || 'Please upload an image.');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showError(tr.errSize || 'Image must be under 5MB.');
    return;
  }

  const compressed = await compressImage(file, 512);
  selectedFile = compressed;
  previewImg.src = URL.createObjectURL(compressed);
  preview.style.display = 'block';
  generateBtn.disabled = false;
  errorEl.style.display = 'none';
  resultEl.classList.remove('show');
}

function compressImage(file, maxSize) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = Math.round((height / width) * maxSize); width = maxSize; }
          else { width = Math.round((width / height) * maxSize); height = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          resolve(new File([blob], 'image.png', { type: 'image/png' }));
        }, 'image/png');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearImage() {
  selectedFile = null;
  fileInput.value = '';
  preview.style.display = 'none';
  generateBtn.disabled = true;
  resultEl.classList.remove('show');
}

async function generate() {
  const tr = t();
  const base = (window.__i18n && window.__i18n.base) || '';

  if (!selectedFile) {
    showError(tr.errNoFile || 'Please upload a photo first.');
    return;
  }

  errorEl.style.display = 'none';
  resultEl.classList.remove('show');
  generateBtn.disabled = true;
  loadingEl.style.display = 'flex';

  try {
    const formData = new FormData();
    formData.append('style', currentPreset);
    formData.append('image_0', selectedFile);

    const res = await fetch(base + '/api/generate', {
      method: 'POST',
      body: formData
    });

    if (res.status === 429) {
      showError(tr.errRateLimit || 'Too many requests. Please wait a minute.');
      return;
    }

    const data = await res.json();
    if (!res.ok || !data.image) {
      const detail = data.code ? ' (' + data.code + ')' : '';
      showError((data.error || (tr.errGeneric || 'Generation failed.')) + detail);
      return;
    }

    resultImg.src = 'data:image/png;base64,' + data.image;
    resultEl.classList.add('show');
  } catch (err) {
    console.error(err);
    showError(tr.errNetwork || 'Network error. Please try again.');
  } finally {
    generateBtn.disabled = false;
    loadingEl.style.display = 'none';
  }
}

function downloadResult() {
  const img = resultImg;
  if (!img.src) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = '3d-figurine-' + Date.now() + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function t() { return (window.__i18n && window.__i18n.t) || {}; }

window.generate = generate;
window.clearImage = clearImage;
window.downloadResult = downloadResult;