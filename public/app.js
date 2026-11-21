let currentVideoData = null;
let activePollingInterval = null;
let deferredPrompt = null;

const DEFAULT_ENGINE_URL = 'https://simulations-inspections-containers-wine.trycloudflare.com';
const LOCAL_LAN_URL = 'http://192.168.0.105:5000';

function getEngineBaseUrl() {
  const custom = localStorage.getItem('downloader_engine_url');
  if (custom && custom.trim().length > 0) {
    return custom.trim().replace(/\/+$/, '');
  }
  if (window.location.protocol.startsWith('http')) {
    return ''; // Relative path when served from Express
  }
  return DEFAULT_ENGINE_URL;
}

function getApiUrl(path) {
  const base = getEngineBaseUrl();
  return base ? `${base}${path}` : path;
}

async function checkEngineHealth() {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('engineStatusLabel');
  if (!dot || !label) return;

  const base = getEngineBaseUrl();
  const testUrl = (base ? base : '') + '/api/info';

  try {
    // Quick probe with OPTIONS or GET to see if engine responds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch((base ? base : '') + '/manifest.json', {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      dot.className = 'status-dot online';
      label.textContent = 'Engine Online';
      return true;
    }
  } catch (e) {
    // If default cloudflare failed and on file:, try fallback to local LAN IP
    if (window.location.protocol === 'file:' && !localStorage.getItem('downloader_engine_url')) {
      try {
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), 2000);
        const res2 = await fetch(LOCAL_LAN_URL + '/manifest.json', { signal: controller2.signal });
        clearTimeout(timeoutId2);
        if (res2.ok) {
          localStorage.setItem('downloader_engine_url', LOCAL_LAN_URL);
          dot.className = 'status-dot online';
          label.textContent = 'LAN Online';
          return true;
        }
      } catch (ignored) {}
    }
  }

  dot.className = 'status-dot offline';
  label.textContent = 'Offline (Tap)';
  return false;
}

function openEngineSettings() {
  const modal = document.getElementById('engineModal');
  const input = document.getElementById('engineUrlInput');
  const status = document.getElementById('engineTestStatus');
  if (modal && input) {
    input.value = localStorage.getItem('downloader_engine_url') || (window.location.protocol.startsWith('http') ? window.location.origin : DEFAULT_ENGINE_URL);
    if (status) status.textContent = '';
    modal.style.display = 'flex';
  }
}

function closeEngineSettings() {
  const modal = document.getElementById('engineModal');
  if (modal) modal.style.display = 'none';
}

async function saveEngineSettings() {
  const input = document.getElementById('engineUrlInput');
  const status = document.getElementById('engineTestStatus');
  let val = input ? input.value.trim().replace(/\/+$/, '') : '';
  if (val && !val.startsWith('http://') && !val.startsWith('https://')) {
    val = 'http://' + val;
  }
  if (status) status.textContent = 'Testing connection...';

  try {
    const res = await fetch(val + '/manifest.json');
    if (res.ok) {
      localStorage.setItem('downloader_engine_url', val);
      if (status) {
        status.style.color = '#10b981';
        status.textContent = '✅ Connected successfully!';
      }
      setTimeout(() => {
        closeEngineSettings();
        checkEngineHealth();
      }, 700);
      return;
    }
  } catch (err) {
    if (status) {
      status.style.color = '#ef4444';
      status.textContent = '❌ Failed to reach engine: ' + err.message;
    }
  }
}

function resetEngineSettings() {
  localStorage.removeItem('downloader_engine_url');
  const input = document.getElementById('engineUrlInput');
  if (input) input.value = DEFAULT_ENGINE_URL;
  saveEngineSettings();
}

// Global hook called directly from Android MainActivity on Share intent
window.onSharedUrlReceived = function (url) {
  if (!url) return;
  const urlInput = document.getElementById('videoUrl');
  if (urlInput) {
    urlInput.value = url.trim();
    handleInputChange();
    setTimeout(() => {
      handleFetchInfo();
    }, 150);
  }
};

// Register Service Worker for PWA
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('SW scope:', reg.scope))
      .catch((err) => console.warn('SW error:', err));
  });
}

// Handle PWA Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById('btnInstallApp');
  if (installBtn) installBtn.style.display = 'inline-flex';
});

async function handleInstallApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  const installBtn = document.getElementById('btnInstallApp');
  if (installBtn) installBtn.style.display = 'none';
}

window.addEventListener('appinstalled', () => {
  const installBtn = document.getElementById('btnInstallApp');
  if (installBtn) installBtn.style.display = 'none';
});

// Handle incoming Shared Links from Web Share Target
function handleIncomingShareTarget() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedUrl = urlParams.get('url');
  const sharedText = urlParams.get('text');
  const sharedTitle = urlParams.get('title');

  let extractedUrl = null;
  if (sharedUrl && sharedUrl.startsWith('http')) {
    extractedUrl = sharedUrl.trim();
  } else if (sharedText) {
    const match = sharedText.match(/(https?:\/\/[^\s]+)/i);
    if (match) extractedUrl = match[1].trim();
  } else if (sharedTitle) {
    const match = sharedTitle.match(/(https?:\/\/[^\s]+)/i);
    if (match) extractedUrl = match[1].trim();
  }

  if (extractedUrl) {
    window.onSharedUrlReceived(extractedUrl);
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  handleIncomingShareTarget();
  checkEngineHealth();
  setInterval(checkEngineHealth, 15000);
});

function handleInputChange() {
  const urlInput = document.getElementById('videoUrl');
  const clearBtn = document.getElementById('btnClear');
  if (clearBtn) {
    clearBtn.style.display = urlInput.value.trim().length > 0 ? 'flex' : 'none';
  }
}

function handleClearInput() {
  const urlInput = document.getElementById('videoUrl');
  urlInput.value = '';
  handleInputChange();
  clearError();
  urlInput.focus();
}

async function handlePaste() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      document.getElementById('videoUrl').value = text.trim();
      handleInputChange();
      handleFetchInfo();
    }
  } catch (err) {
    alert('Please allow clipboard access or paste directly into the box.');
  }
}

function showError(msg) {
  const alertBox = document.getElementById('errorAlert');
  alertBox.textContent = msg;
  alertBox.style.display = 'block';
}

function clearError() {
  const alertBox = document.getElementById('errorAlert');
  alertBox.textContent = '';
  alertBox.style.display = 'none';
}

async function handleFetchInfo(event) {
  if (event) event.preventDefault();
  clearError();

  const urlInput = document.getElementById('videoUrl');
  const url = urlInput.value.trim();
  if (!url) return;

  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');
  const btnAnalyze = document.getElementById('btnAnalyze');
  const previewSection = document.getElementById('previewSection');
  const progressSection = document.getElementById('progressSection');

  btnText.textContent = 'Analyzing...';
  btnSpinner.style.display = 'inline-block';
  btnAnalyze.disabled = true;
  previewSection.style.display = 'none';
  progressSection.style.display = 'none';

  try {
    const apiUrl = getApiUrl('/api/info');
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to analyze media link');
    }

    currentVideoData = data;
    renderMediaPreview(data);
  } catch (err) {
    showError(err.message + ' (Make sure Engine server is online)');
    checkEngineHealth();
  } finally {
    btnText.textContent = 'Analyze Link';
    btnSpinner.style.display = 'none';
    btnAnalyze.disabled = false;
  }
}

function renderMediaPreview(data) {
  const previewSection = document.getElementById('previewSection');
  const thumb = document.getElementById('videoThumb');
  const duration = document.getElementById('videoDuration');
  const title = document.getElementById('videoTitle');
  const author = document.getElementById('videoAuthor');
  const badge = document.getElementById('videoPlatformBadge');

  thumb.src = data.thumbnail || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" fill="%23334155"><rect width="200" height="120"/></svg>';
  duration.textContent = data.duration;
  title.textContent = data.title;
  author.textContent = data.uploader;

  badge.textContent = data.platform;
  badge.className = 'video-platform-badge ' + data.platform.toLowerCase().replace(/[^a-z]/g, '');

  const videoSection = document.getElementById('videoFormatSection');
  const videoGrid = document.getElementById('videoFormatGrid');
  videoGrid.innerHTML = '';

  if (data.options && data.options.video && data.options.video.length > 0) {
    videoSection.style.display = 'block';
    data.options.video.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = `format-btn ${opt.isBest ? 'best' : ''}`;
      btn.innerHTML = `
        <div class="format-btn-header">
          <span class="format-label">${opt.label}</span>
          <span class="format-tag">${opt.format.toUpperCase()}</span>
        </div>
        <div class="format-desc">${opt.isBest ? '★ Recommended: Highest Available' : (opt.height ? opt.height + 'p Resolution' : '')}</div>
      `;
      btn.onclick = () => startDownload(opt);
      videoGrid.appendChild(btn);
    });
  } else {
    videoSection.style.display = 'none';
  }

  // Render Audio Formats
  const audioSection = document.getElementById('audioFormatSection');
  const audioGrid = document.getElementById('audioFormatGrid');
  audioGrid.innerHTML = '';

  if (data.options && data.options.audio && data.options.audio.length > 0) {
    audioSection.style.display = 'block';
    data.options.audio.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'format-btn';
      btn.innerHTML = `
        <div class="format-btn-header">
          <span class="format-label">${opt.label}</span>
          <span class="format-tag">${opt.format.toUpperCase()}</span>
        </div>
        <div class="format-desc">Extract audio track only</div>
      `;
      btn.onclick = () => startDownload(opt);
      audioGrid.appendChild(btn);
    });
  } else {
    audioSection.style.display = 'none';
  }

  // Render High-Res Images & Covers
  const imageSection = document.getElementById('imageSection');
  const imageGrid = document.getElementById('imageGrid');
  imageGrid.innerHTML = '';

  if (data.images && data.images.length > 0) {
    imageSection.style.display = 'block';
    data.images.forEach((img, idx) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      const safeTitle = encodeURIComponent(data.title || `image-${idx + 1}`);
      const downloadPath = `/api/download-image?url=${encodeURIComponent(img.url)}&filename=${safeTitle}&ext=${img.ext || 'jpg'}`;
      const fullDownloadUrl = getApiUrl(downloadPath);

      card.innerHTML = `
        <div class="image-card-thumb-wrap">
          <img class="image-card-thumb" src="${img.url}" alt="${img.label}" loading="lazy" />
        </div>
        <div class="image-card-body">
          <div class="image-card-title">${img.label}</div>
          <div class="image-card-res">${img.resolution}</div>
          <a class="btn-download-img" href="${fullDownloadUrl}" download>
            ⬇️ Download Image (${(img.ext || 'jpg').toUpperCase()})
          </a>
        </div>
      `;
      imageGrid.appendChild(card);
    });
  } else {
    imageSection.style.display = 'none';
  }

  previewSection.style.display = 'block';
  previewSection.scrollIntoView({ behavior: 'smooth' });
}

async function startDownload(option) {
  if (!currentVideoData) return;

  const progressSection = document.getElementById('progressSection');
  const statusText = document.getElementById('progressStatusText');
  const percentText = document.getElementById('progressPercent');
  const barFill = document.getElementById('progressBarFill');
  const speedText = document.getElementById('progressSpeed');
  const etaText = document.getElementById('progressEta');
  const readyBox = document.getElementById('downloadReadyBox');

  progressSection.style.display = 'block';
  readyBox.style.display = 'none';
  statusText.textContent = 'Initializing download...';
  percentText.textContent = '0%';
  barFill.style.width = '0%';
  speedText.textContent = 'Speed: --';
  etaText.textContent = 'ETA: --';
  progressSection.scrollIntoView({ behavior: 'smooth' });

  if (activePollingInterval) {
    clearInterval(activePollingInterval);
  }

  try {
    const downloadApiUrl = getApiUrl('/api/download');
    const res = await fetch(downloadApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentVideoData.url,
        optionId: option.id,
        type: option.type,
        height: option.height || null,
        format: option.format
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start download');

    const jobId = data.jobId;

    activePollingInterval = setInterval(async () => {
      try {
        const statusRes = await fetch(getApiUrl(`/api/progress/${jobId}`));
        if (!statusRes.ok) return;

        const job = await statusRes.json();

        if (job.status === 'downloading' || job.status === 'processing') {
          statusText.textContent = job.statusText || 'Downloading...';
          percentText.textContent = Math.round(job.percent || 0) + '%';
          barFill.style.width = (job.percent || 0) + '%';
          speedText.textContent = job.speed ? `Speed: ${job.speed}` : 'Speed: Calculating...';
          etaText.textContent = job.eta ? `ETA: ${job.eta}` : '';
        } else if (job.status === 'completed') {
          clearInterval(activePollingInterval);
          statusText.textContent = 'Processing complete!';
          percentText.textContent = '100%';
          barFill.style.width = '100%';
          speedText.textContent = 'Done!';
          etaText.textContent = '';

          const fileUrl = getApiUrl(`/api/file/${jobId}`);
          const saveBtn = document.getElementById('btnSaveFile');
          saveBtn.href = fileUrl;
          readyBox.style.display = 'flex';

          const hiddenAnchor = document.createElement('a');
          hiddenAnchor.href = fileUrl;
          hiddenAnchor.download = job.fileName || 'download';
          document.body.appendChild(hiddenAnchor);
          hiddenAnchor.click();
          document.body.removeChild(hiddenAnchor);
        } else if (job.status === 'failed') {
          clearInterval(activePollingInterval);
          statusText.textContent = 'Download failed';
          showError(job.error || 'An error occurred during download.');
        }
      } catch (pollErr) {
        console.error('Polling error:', pollErr);
      }
    }, 800);
  } catch (err) {
    showError(err.message);
  }
}
