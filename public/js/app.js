let selectedFile = null;
let currentPreset = 'actionfigure';
let currentScene = 'studio';

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('preview');
const previewThumb = document.getElementById('previewThumb');
const previewImg = document.getElementById('previewImg');
const resultImg = document.getElementById('resultImg');
const generateBtn = document.getElementById('generateBtn');
const errorEl = document.getElementById('error');
const stage = document.getElementById('stage');
const previewHint = document.getElementById('previewHint');
const loadingHint = document.getElementById('loadingHint');
const resultBar = document.getElementById('resultBar');
const resultDisclaimer = document.getElementById('resultDisclaimer');

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

const stageStates = ['examples', 'preview', 'loading', 'result'];

function setStage(state) {
  if (!stageStates.includes(state)) return;
  stage.dataset.state = state;
  previewImg.style.display = (state === 'preview' || state === 'loading') && previewImg.src ? 'block' : 'none';
  resultImg.style.display = state === 'result' && resultImg.src ? 'block' : 'none';
  previewHint.style.display = state === 'preview' ? 'block' : 'none';
  loadingHint.style.display = state === 'loading' ? 'block' : 'none';
  resultBar.style.display = state === 'result' ? 'flex' : 'none';
  resultDisclaimer.style.display = state === 'result' ? 'block' : 'none';
}

function selectStyle(preset) {
  currentPreset = preset;
  document.querySelectorAll('#stylePresets .preset-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === preset));
  document.querySelectorAll('.ex-card').forEach(c =>
    c.classList.toggle('active', c.dataset.preset === preset));
  if (stage.dataset.state === 'result') setStage('preview');
}

document.querySelectorAll('#stylePresets .preset-btn').forEach(btn => {
  btn.addEventListener('click', () => selectStyle(btn.dataset.preset));
});

// 右侧示例卡：点图即选风格
document.querySelectorAll('.ex-card').forEach(card => {
  card.addEventListener('click', () => selectStyle(card.dataset.preset));
});

// 场景切换：左栏选中态 + 右侧示例网格换图
function selectScene(scene) {
  currentScene = scene;
  document.querySelectorAll('#scenePresets .scene-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.scene === scene));
  document.querySelectorAll('.ex-card').forEach(c => {
    const img = c.querySelector('img');
    const m = (img.getAttribute('src') || '').match(/\/examples\/[a-z]+\/([a-z]+\.jpg)$/);
    if (m) img.src = '/examples/' + scene + '/' + m[1];
  });
}

document.querySelectorAll('#scenePresets .scene-btn').forEach(btn => {
  btn.addEventListener('click', () => selectScene(btn.dataset.scene));
});

function backToPreview() {
  setStage('preview');
}
window.backToPreview = backToPreview;

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
  const url = URL.createObjectURL(compressed);
  previewThumb.src = url;
  previewImg.src = url;
  preview.style.display = 'flex';
  generateBtn.disabled = false;
  errorEl.style.display = 'none';
  setStage('preview');
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
  previewImg.removeAttribute('src');
  resultImg.removeAttribute('src');
  generateBtn.disabled = true;
  setStage('examples');
}

async function generate() {
  const tr = t();
  const base = (window.__i18n && window.__i18n.base) || '';

  if (!selectedFile) {
    showError(tr.errNoFile || 'Please upload a photo first.');
    return;
  }

  errorEl.style.display = 'none';
  generateBtn.disabled = true;
  setStage('loading');

  try {
    const formData = new FormData();
    formData.append('style', currentPreset);
    formData.append('scene', currentScene);
    formData.append('image_0', selectedFile);

    const res = await fetch(base + '/api/generate', {
      method: 'POST',
      body: formData
    });

    if (res.status === 429) {
      setStage('preview');
      showError(tr.errRateLimit || 'Too many requests. Please wait a minute.');
      return;
    }

    const data = await res.json();
    if (!res.ok || !data.image) {
      const detail = data.code ? ' (' + data.code + ')' : '';
      setStage('preview');
      showError((data.error || (tr.errGeneric || 'Generation failed.')) + detail);
      return;
    }

    resultImg.src = 'data:image/png;base64,' + data.image;
    setStage('result');
    if (window.innerWidth <= 900) stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error(err);
    setStage('preview');
    showError(tr.errNetwork || 'Network error. Please try again.');
  } finally {
    generateBtn.disabled = false;
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