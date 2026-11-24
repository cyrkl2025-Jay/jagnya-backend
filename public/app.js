let currentVideoData = null;
let activePollingInterval = null;
let deferredPrompt = null;

const CANDIDATE_URLS = [
  'https://jagnya-backend.onrender.com'
];

let activeEngineBase = 'https://jagnya-backend.onrender.com';

function getEngineBaseUrl() {
  if (activeEngineBase) return activeEngineBase;
  const custom = localStorage.getItem('downloader_engine_url');
  if (custom && custom.trim().length > 0 && custom.includes('onrender.com')) {
    return custom.trim().replace(/\/+$/, '');
  }
  if (window.location.protocol.startsWith('http')) {
    return ''; // Relative path when served directly from Express
  }
  return CANDIDATE_URLS[0];
}

function getApiUrl(path) {
  const base = getEngineBaseUrl();
  return base ? `${base}${path}` : path;
}

async function testCandidate(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch((url || '') + '/manifest.json', { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function checkEngineHealth() {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('engineStatusLabel');

  if (label) label.textContent = 'Connecting...';

  // Check permanent cloud server first
  for (const candidate of CANDIDATE_URLS) {
    if (await testCandidate(candidate)) {
      activeEngineBase = candidate;
      localStorage.setItem('downloader_engine_url', candidate);
      if (dot) dot.className = 'status-dot online';
      if (label) label.textContent = 'Engine Online';
      return true;
    }
  }

  // If on web (http), check relative
  if (window.location.protocol.startsWith('http')) {
    if (await testCandidate('')) {
      activeEngineBase = '';
      if (dot) dot.className = 'status-dot online';
      if (label) label.textContent = 'Engine Online';
      return true;
    }
  }

  // Check saved custom URL
  const custom = localStorage.getItem('downloader_engine_url');
  if (custom && await testCandidate(custom)) {
    activeEngineBase = custom;
    if (dot) dot.className = 'status-dot online';
    if (label) label.textContent = 'Engine Online';
    return true;
  } else if (custom) {
    localStorage.removeItem('downloader_engine_url');
  }

  // Still default to permanent cloud URL so requests can trigger wake-up
  activeEngineBase = CANDIDATE_URLS[0];
  if (dot) dot.className = 'status-dot online';
  if (label) label.textContent = 'Engine Cloud';
  return true;
}

function selectPreset(url) {
  const input = document.getElementById('engineUrlInput');
  if (input) input.value = url;
  saveEngineSettings();
}

function openEngineSettings() {
  const modal = document.getElementById('engineModal');
  const input = document.getElementById('engineUrlInput');
  const status = document.getElementById('engineTestStatus');
  if (modal && input) {
    input.value = localStorage.getItem('downloader_engine_url') || activeEngineBase || CANDIDATE_URLS[0];
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
  initSpeedBooster();
  checkEngineHealth();
  setInterval(checkEngineHealth, 15000);
});

function isSpeedBoosterEnabled() {
  return localStorage.getItem('downloader_speed_booster') !== 'false';
}

function initSpeedBooster() {
  const chk = document.getElementById('chkSpeedBooster');
  const bar = document.getElementById('boosterBar');
  const enabled = isSpeedBoosterEnabled();
  if (chk) chk.checked = enabled;
  if (bar) {
    if (enabled) bar.classList.add('active');
    else bar.classList.remove('active');
  }
}

function toggleSpeedBooster(forceVal) {
  const chk = document.getElementById('chkSpeedBooster');
  const bar = document.getElementById('boosterBar');
  const nextVal = typeof forceVal === 'boolean' ? forceVal : !(chk ? chk.checked : true);
  if (chk) chk.checked = nextVal;
  localStorage.setItem('downloader_speed_booster', nextVal ? 'true' : 'false');
  if (bar) {
    if (nextVal) bar.classList.add('active');
    else bar.classList.remove('active');
  }
}

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
  let url = urlInput ? urlInput.value.trim() : '';
  if (!url) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    urlInput.value = url;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      showError('Please paste a complete valid URL (e.g. https://youtu.be/... or from Instagram / Facebook).');
      return;
    }
    const cleanHost = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if ((cleanHost === 'youtube.com' || cleanHost === 'm.youtube.com') && (parsed.pathname === '/' || parsed.pathname === '')) {
      showError('Please paste a specific YouTube video link (e.g. from the video\'s "Share" button), not just youtube.com.');
      return;
    }
  } catch (e) {
    showError('Please paste a valid video URL starting with https://');
    return;
  }

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
  const playlistSection = document.getElementById('playlistSection');
  if (playlistSection) playlistSection.style.display = 'none';
  const carouselSection = document.getElementById('carouselSection');
  if (carouselSection) carouselSection.style.display = 'none';

  try {
    const apiUrl = getApiUrl('/api/info');
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.details || data.error || 'Failed to analyze media link');
    }

    currentVideoData = data;
    if (data.isCarousel) {
      renderCarouselView(data);
    } else if (data.isPlaylist) {
      renderPlaylistView(data);
    } else {
      renderMediaPreview(data);
    }
  } catch (err) {
    showError(err.message);
    checkEngineHealth();
  } finally {
    btnText.textContent = 'Analyze Link';
    btnSpinner.style.display = 'none';
    btnAnalyze.disabled = false;
  }
}

function renderMediaPreview(data) {
  const carouselSection = document.getElementById('carouselSection');
  if (carouselSection) carouselSection.style.display = 'none';
  const playlistSection = document.getElementById('playlistSection');
  if (playlistSection) playlistSection.style.display = 'none';
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

  // Setup Trim & Clip Tool for videos
  const trimSection = document.getElementById('trimSection');
  if (trimSection) {
    if (data.options && data.options.video && data.options.video.length > 0) {
      trimSection.style.display = 'block';
      resetTrim();
    } else {
      trimSection.style.display = 'none';
    }
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

  const boosterOn = isSpeedBoosterEnabled();
  const turboBadge = document.getElementById('turboProgressBadge');
  if (turboBadge) turboBadge.style.display = boosterOn ? 'inline-flex' : 'none';

  statusText.textContent = isTrimActive
    ? 'Trimming & preparing highlight clip...'
    : (boosterOn ? 'Accelerating stream with 16 parallel threads...' : 'Initializing download...');
  percentText.textContent = '0%';
  barFill.style.width = '0%';
  speedText.textContent = 'Speed: --';
  etaText.textContent = 'ETA: --';
  progressSection.scrollIntoView({ behavior: 'smooth' });

  if (activePollingInterval) {
    clearInterval(activePollingInterval);
  }

  try {
    const downloadPayload = {
      url: currentVideoData.url,
      optionId: option.id,
      type: option.type,
      height: option.height || null,
      format: option.format,
      speedBooster: boosterOn
    };

    if (isTrimActive) {
      const startInput = document.getElementById('trimStartTime');
      const endInput = document.getElementById('trimEndTime');
      if (startInput && startInput.value.trim()) downloadPayload.trimStart = startInput.value.trim();
      if (endInput && endInput.value.trim()) downloadPayload.trimEnd = endInput.value.trim();
    }

    const downloadApiUrl = getApiUrl('/api/download');
    const res = await fetch(downloadApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(downloadPayload)
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


// ============================================
// Auto-Clipboard Detection
// ============================================
let detectedClipboardUrl = null;
let lastDismissedUrl = null;

function isMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase().trim();
  return lower.includes('youtu.be/') ||
         lower.includes('youtube.com/') ||
         lower.includes('instagram.com/') ||
         lower.includes('facebook.com/') ||
         lower.includes('fb.watch/') ||
         lower.includes('tiktok.com/') ||
         lower.includes('threads.net/') ||
         lower.includes('twitter.com/') ||
         lower.includes('x.com/') ||
         lower.includes('vimeo.com/');
}

window.onClipboardUrlDetected = function(url) {
  if (!url) return;
  url = url.trim();
  if (url === lastDismissedUrl) return;

  const currentInput = document.getElementById('videoUrl') ? document.getElementById('videoUrl').value.trim() : '';
  if (currentInput === url) return;

  detectedClipboardUrl = url;
  const banner = document.getElementById('clipboardBanner');
  const urlDisplay = document.getElementById('clipboardDetectedUrl');
  if (banner && urlDisplay) {
    urlDisplay.textContent = url;
    banner.style.display = 'block';
  }
};

function acceptClipboardUrl() {
  if (!detectedClipboardUrl) return;
  const url = detectedClipboardUrl;
  const urlInput = document.getElementById('videoUrl');
  if (urlInput) {
    urlInput.value = url;
    handleInputChange();
  }
  dismissClipboardBanner();
  handleFetchInfo();
}

function dismissClipboardBanner() {
  const banner = document.getElementById('clipboardBanner');
  if (banner) {
    banner.classList.add('slide-out');
    setTimeout(() => {
      banner.style.display = 'none';
      banner.classList.remove('slide-out');
    }, 240);
  }
  lastDismissedUrl = detectedClipboardUrl;
  detectedClipboardUrl = null;
}

// Auto-check clipboard when browser / web app tab gains focus
async function checkBrowserClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.readText) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const match = text.match(/(https?:\/\/[^\s]+)/i);
      if (match) {
        const foundUrl = match[1].trim();
        if (isMediaUrl(foundUrl)) {
          window.onClipboardUrlDetected(foundUrl);
        }
      }
    }
  } catch (ignored) {
    // Clipboard permission not granted or backgrounded
  }
}

window.addEventListener('focus', checkBrowserClipboard);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkBrowserClipboard();
  }
});


// ============================================
// Trim & Clip Feature Helpers
// ============================================
let isTrimActive = false;

function toggleTrimCollapse() {
  const body = document.getElementById('trimBody');
  const toggleBtn = document.getElementById('btnTrimToggle');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'flex' : 'none';
  if (toggleBtn) {
    if (isHidden) toggleBtn.classList.add('open');
    else toggleBtn.classList.remove('open');
  }
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function formatSecondsToTime(sec) {
  if (isNaN(sec) || sec < 0) return '00:00:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `00:${pad(m)}:${pad(s)}`;
}

function updateTrimDuration() {
  const startInput = document.getElementById('trimStartTime');
  const endInput = document.getElementById('trimEndTime');
  const card = document.getElementById('trimSection');
  const badge = document.getElementById('trimStatusBadge');
  const valDisplay = document.getElementById('trimDurationValue');

  const startVal = startInput ? startInput.value.trim() : '';
  const endVal = endInput ? endInput.value.trim() : '';

  const startSec = parseTimeToSeconds(startVal);
  const endSec = parseTimeToSeconds(endVal);

  const hasStart = startSec !== null && startSec > 0;
  const hasEnd = endSec !== null && endSec > 0 && (!currentVideoData || !currentVideoData.durationSeconds || endSec < currentVideoData.durationSeconds);

  if (hasStart || hasEnd) {
    isTrimActive = true;
    if (badge) {
      badge.textContent = 'Active';
      badge.classList.add('active');
    }
    if (card) card.classList.add('active');

    if (startSec !== null && endSec !== null && endSec > startSec) {
      const diff = endSec - startSec;
      if (valDisplay) valDisplay.textContent = `${formatSecondsToTime(diff)} (${startVal} to ${endVal})`;
    } else if (startSec !== null && (!endVal || endSec === null)) {
      if (valDisplay) valDisplay.textContent = `From ${startVal} to end`;
    } else if (endSec !== null) {
      if (valDisplay) valDisplay.textContent = `From start to ${endVal}`;
    }
  } else {
    isTrimActive = false;
    if (badge) {
      badge.textContent = 'Off';
      badge.classList.remove('active');
    }
    if (card) card.classList.remove('active');
    if (valDisplay) valDisplay.textContent = 'Full Video';
  }
}

function applyTrimPreset(startSec, endSec) {
  const startInput = document.getElementById('trimStartTime');
  const endInput = document.getElementById('trimEndTime');
  if (startInput) startInput.value = formatSecondsToTime(startSec);
  if (endInput) endInput.value = formatSecondsToTime(endSec);
  updateTrimDuration();
}

function resetTrim() {
  const startInput = document.getElementById('trimStartTime');
  const endInput = document.getElementById('trimEndTime');
  if (startInput) startInput.value = '00:00:00';
  if (endInput) {
    if (currentVideoData && currentVideoData.durationSeconds) {
      endInput.value = formatSecondsToTime(currentVideoData.durationSeconds);
    } else {
      endInput.value = '';
    }
  }
  isTrimActive = false;
  const badge = document.getElementById('trimStatusBadge');
  const card = document.getElementById('trimSection');
  const valDisplay = document.getElementById('trimDurationValue');
  if (badge) {
    badge.textContent = 'Off';
    badge.classList.remove('active');
  }
  if (card) card.classList.remove('active');
  if (valDisplay) valDisplay.textContent = 'Full Video';
}

// ============================================
// YouTube Playlist & Channel Downloader Logic
// ============================================
let currentPlaylistData = null;
let isBatchCancelled = false;

function renderPlaylistView(data) {
  currentPlaylistData = data;
  const carouselSection = document.getElementById('carouselSection');
  if (carouselSection) carouselSection.style.display = 'none';
  const playlistSection = document.getElementById('playlistSection');
  const previewSection = document.getElementById('previewSection');
  if (previewSection) previewSection.style.display = 'none';

  const thumb = document.getElementById('playlistThumb');
  const badge = document.getElementById('playlistBadge');
  const title = document.getElementById('playlistTitle');
  const uploader = document.getElementById('playlistUploader');
  const itemsList = document.getElementById('playlistItemsList');
  const chkSelectAll = document.getElementById('chkSelectAll');

  thumb.src = data.thumbnail || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" fill="%23334155"><rect width="200" height="120"/></svg>';
  badge.textContent = `${data.totalCount || data.items.length} Videos`;
  title.textContent = data.title;
  uploader.textContent = data.uploader;

  if (chkSelectAll) chkSelectAll.checked = true;

  itemsList.innerHTML = '';
  data.items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'playlist-item-card';
    card.id = `playlist-item-${idx}`;
    card.innerHTML = `
      <input type="checkbox" class="item-chk" data-index="${idx}" checked onchange="updateBatchCount()" />
      <span class="item-index">#${item.index}</span>
      <div class="item-thumb-wrap">
        <img class="item-thumb" src="${item.thumbnail}" alt="" loading="lazy" />
      </div>
      <div class="item-details">
        <div class="item-title" title="${item.title}">${item.title}</div>
        <div class="item-duration">⏱️ ${item.duration}</div>
      </div>
      <button type="button" class="btn-item-download" onclick="downloadSinglePlaylistItem(${idx})" title="Download this video">
        ⬇️ Download
      </button>
    `;
    itemsList.appendChild(card);
  });

  updateBatchCount();
  playlistSection.style.display = 'block';
  playlistSection.scrollIntoView({ behavior: 'smooth' });
}

function toggleSelectAll(checked) {
  const chks = document.querySelectorAll('.playlist-items-list .item-chk');
  chks.forEach(chk => chk.checked = checked);
  updateBatchCount();
}

function updateBatchCount() {
  const chks = document.querySelectorAll('.playlist-items-list .item-chk:checked');
  const allChks = document.querySelectorAll('.playlist-items-list .item-chk');
  const count = chks.length;

  const btnCount = document.getElementById('batchBtnCount');
  const selectedCount = document.getElementById('playlistSelectedCount');
  const chkSelectAll = document.getElementById('chkSelectAll');

  if (btnCount) btnCount.textContent = count;
  if (selectedCount) selectedCount.textContent = `${count} of ${allChks.length} selected`;
  if (chkSelectAll) chkSelectAll.checked = (count === allChks.length && allChks.length > 0);
}

async function downloadSinglePlaylistItem(idx) {
  if (!currentPlaylistData || !currentPlaylistData.items[idx]) return;
  const item = currentPlaylistData.items[idx];
  const urlInput = document.getElementById('videoUrl');
  if (urlInput) {
    urlInput.value = item.url;
    handleInputChange();
  }
  handleFetchInfo();
}

async function startBatchDownload() {
  if (!currentPlaylistData) return;
  const chks = document.querySelectorAll('.playlist-items-list .item-chk:checked');
  if (chks.length === 0) {
    alert('Please select at least one video to download.');
    return;
  }

  const selectedIndices = Array.from(chks).map(c => parseInt(c.dataset.index, 10));
  const formatSelect = document.getElementById('batchFormatSelect');
  const selectedFormatVal = formatSelect ? formatSelect.value : 'best_video';

  let optionType = 'video';
  let optionId = 'best_video';
  let optionHeight = null;
  let fileExt = 'mp4';

  if (selectedFormatVal === 'video_720') {
    optionHeight = 720;
    optionId = 'video_720';
  } else if (selectedFormatVal === 'best_audio') {
    optionType = 'audio';
    optionId = 'best_audio';
    fileExt = 'mp3';
  }

  const progressBox = document.getElementById('batchProgressBox');
  const progressTitle = document.getElementById('batchProgressTitle');
  const progressPercent = document.getElementById('batchProgressPercent');
  const barFill = document.getElementById('batchProgressBarFill');
  const currentItemTitle = document.getElementById('batchCurrentItemTitle');

  progressBox.style.display = 'block';
  progressBox.scrollIntoView({ behavior: 'smooth' });
  isBatchCancelled = false;

  const total = selectedIndices.length;

  for (let i = 0; i < total; i++) {
    if (isBatchCancelled) {
      currentItemTitle.textContent = 'Batch download cancelled.';
      break;
    }

    const itemIdx = selectedIndices[i];
    const item = currentPlaylistData.items[itemIdx];

    progressTitle.textContent = `Downloading ${i + 1} of ${total}: "${item.title.slice(0, 30)}..."`;
    const overallPct = Math.round((i / total) * 100);
    progressPercent.textContent = `${overallPct}%`;
    barFill.style.width = `${overallPct}%`;
    currentItemTitle.textContent = `Processing #${item.index}: ${item.title}...`;

    try {
      const res = await fetch(getApiUrl('/api/download'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: item.url,
          optionId: optionId,
          type: optionType,
          height: optionHeight,
          format: fileExt,
          speedBooster: isSpeedBoosterEnabled()
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed item download');

      const jobId = data.jobId;

      await new Promise((resolve) => {
        const interval = setInterval(async () => {
          if (isBatchCancelled) {
            clearInterval(interval);
            return resolve();
          }
          try {
            const statusRes = await fetch(getApiUrl(`/api/progress/${jobId}`));
            if (!statusRes.ok) return;
            const job = await statusRes.json();

            if (job.status === 'downloading' || job.status === 'processing') {
              const itemPct = Math.round(job.percent || 0);
              currentItemTitle.textContent = `Item ${i + 1}/${total} (${itemPct}%) - ${job.speed || ''}`;
            } else if (job.status === 'completed') {
              clearInterval(interval);
              const fileUrl = getApiUrl(`/api/file/${jobId}`);
              const a = document.createElement('a');
              a.href = fileUrl;
              a.download = job.fileName || `video-${item.index}`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              resolve();
            } else if (job.status === 'failed') {
              clearInterval(interval);
              resolve();
            }
          } catch (e) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

    } catch (itemErr) {
      console.warn('Batch item error:', itemErr);
    }
  }

  if (!isBatchCancelled) {
    progressTitle.textContent = `All ${total} downloads completed!`;
    progressPercent.textContent = '100%';
    barFill.style.width = '100%';
    currentItemTitle.textContent = 'Files saved to your downloads folder.';
  }
}

function cancelBatchDownload() {
  isBatchCancelled = true;
}

// ============================================
// Instagram Carousel Downloader Logic
// ============================================
let currentCarouselData = null;

function renderCarouselView(data) {
  currentCarouselData = data;
  const carouselSection = document.getElementById('carouselSection');
  const previewSection = document.getElementById('previewSection');
  const playlistSection = document.getElementById('playlistSection');
  const progressSection = document.getElementById('progressSection');

  if (previewSection) previewSection.style.display = 'none';
  if (playlistSection) playlistSection.style.display = 'none';
  if (progressSection) progressSection.style.display = 'none';

  const title = document.getElementById('carouselTitle');
  const uploader = document.getElementById('carouselUploader');
  const badge = document.getElementById('carouselSlideBadge');
  const grid = document.getElementById('carouselSlidesGrid');

  if (title) title.textContent = data.title || 'Instagram Carousel';
  if (uploader) uploader.textContent = `@${data.uploader || 'Creator'}`;
  const totalSlides = data.totalSlides || (data.slides ? data.slides.length : 0);
  if (badge) badge.textContent = `${totalSlides} Slide${totalSlides > 1 ? 's' : ''}`;

  if (grid) {
    grid.innerHTML = '';
    (data.slides || []).forEach((slide) => {
      const card = document.createElement('div');
      card.className = 'carousel-slide-card';
      const isVideo = slide.type === 'video';
      const icon = isVideo ? '🎬' : '📷';
      const typeLabel = isVideo ? 'Video' : 'Photo';
      const dlUrl = getApiUrl(slide.downloadUrl);

      card.innerHTML = `
        <div class="carousel-slide-media">
          <img src="${slide.thumbnail || slide.url}" alt="Slide #${slide.index}" loading="lazy" />
          <span class="carousel-slide-num">#${slide.index}</span>
          <span class="carousel-slide-type-badge ${isVideo ? 'video' : 'photo'}">${icon} ${typeLabel}</span>
        </div>
        <div class="carousel-slide-footer">
          <a href="${dlUrl}" download="${(data.title || 'instagram')}-slide-${slide.index}.${slide.ext}" class="btn-download-slide" target="_blank">
            ⬇️ Download ${typeLabel}
          </a>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  if (carouselSection) {
    carouselSection.style.display = 'block';
    carouselSection.scrollIntoView({ behavior: 'smooth' });
  }
}

async function downloadAllCarouselSlides() {
  if (!currentCarouselData || !currentCarouselData.slides || currentCarouselData.slides.length === 0) return;
  const slides = currentCarouselData.slides;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const dlUrl = getApiUrl(slide.downloadUrl);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = `${(currentCarouselData.title || 'instagram')}-slide-${slide.index}.${slide.ext || (slide.type === 'video' ? 'mp4' : 'jpg')}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (i < slides.length - 1) {
      await new Promise(r => setTimeout(r, 600));
    }
  }
}


