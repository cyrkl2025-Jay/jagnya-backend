let currentVideoData = null;
let activePollingInterval = null;
let deferredPrompt = null;

// Register Service Worker for PWA & Share Target
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('Service Worker registered successfully:', reg.scope);
      })
      .catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
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
  console.log(`User response to install prompt: ${outcome}`);
  deferredPrompt = null;
  const installBtn = document.getElementById('btnInstallApp');
  if (installBtn) installBtn.style.display = 'none';
}

window.addEventListener('appinstalled', () => {
  console.log('PWA was installed successfully');
  const installBtn = document.getElementById('btnInstallApp');
  if (installBtn) installBtn.style.display = 'none';
});

// Handle incoming Shared Links from Android/Desktop Share Sheet
function handleIncomingShareTarget() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedUrl = urlParams.get('url');
  const sharedText = urlParams.get('text');
  const sharedTitle = urlParams.get('title');

  let extractedUrl = null;

  // Check URL param first
  if (sharedUrl && sharedUrl.startsWith('http')) {
    extractedUrl = sharedUrl.trim();
  } else if (sharedText) {
    // Look for URL inside shared text (e.g., YouTube app shares "Check out this video: https://youtu.be/...")
    const match = sharedText.match(/(https?:\/\/[^\s]+)/i);
    if (match) {
      extractedUrl = match[1].trim();
    }
  } else if (sharedTitle) {
    const match = sharedTitle.match(/(https?:\/\/[^\s]+)/i);
    if (match) {
      extractedUrl = match[1].trim();
    }
  }

  if (extractedUrl) {
    const urlInput = document.getElementById('videoUrl');
    urlInput.value = extractedUrl;

    // Clean URL bar to avoid re-triggering on manual refresh
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Automatically analyze the shared link
    setTimeout(() => {
      handleFetchInfo();
    }, 200);
  }
}

// Check for shared links when the page loads
window.addEventListener('DOMContentLoaded', handleIncomingShareTarget);

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
    const res = await fetch('/api/info', {
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
    showError(err.message);
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
      const downloadUrl = `/api/download-image?url=${encodeURIComponent(img.url)}&filename=${safeTitle}&ext=${img.ext || 'jpg'}`;

      card.innerHTML = `
        <div class="image-card-thumb-wrap">
          <img class="image-card-thumb" src="${img.url}" alt="${img.label}" loading="lazy" />
        </div>
        <div class="image-card-body">
          <div class="image-card-title">${img.label}</div>
          <div class="image-card-res">${img.resolution}</div>
          <a class="btn-download-img" href="${downloadUrl}" download>
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
    const res = await fetch('/api/download', {
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
        const statusRes = await fetch(`/api/progress/${jobId}`);
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

          const fileUrl = `/api/file/${jobId}`;
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
