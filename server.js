const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = '127.0.0.1';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BIN_DIR = path.join(__dirname, 'bin');
const YTDLP_BIN = path.join(BIN_DIR, 'yt-dlp.exe');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// In-memory job tracker
const jobs = new Map();

// Helper to locate FFmpeg
function getFFmpegLocation() {
  const localFFmpeg = path.join(BIN_DIR, 'ffmpeg.exe');
  if (fs.existsSync(localFFmpeg)) return localFFmpeg;

  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    const wingetPackagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetPackagesDir)) {
      try {
        const entries = fs.readdirSync(wingetPackagesDir);
        for (const entry of entries) {
          if (entry.toLowerCase().includes('gyan.ffmpeg')) {
            const pkgPath = path.join(wingetPackagesDir, entry);
            const subEntries = fs.readdirSync(pkgPath);
            for (const sub of subEntries) {
              const candidate = path.join(pkgPath, sub, 'bin', 'ffmpeg.exe');
              if (fs.existsSync(candidate)) return candidate;
              const directCandidate = path.join(pkgPath, sub, 'ffmpeg.exe');
              if (fs.existsSync(directCandidate)) return directCandidate;
            }
          }
        }
      } catch (e) {}
    }
  }
  return 'ffmpeg';
}

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function detectPlatform(url) {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube';
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return 'Facebook';
  if (lower.includes('tiktok.com')) return 'TikTok';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X (Twitter)';
  if (lower.includes('pinterest.com') || lower.includes('pin.it')) return 'Pinterest';
  if (/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(lower)) return 'Direct Image';
  return 'Web Video / Media';
}

// 1. POST /api/info - Inspect metadata, video/audio formats, and images/thumbnails
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'Please provide a valid video or image URL.' });
  }

  const cleanUrl = url.trim();
  const platform = detectPlatform(cleanUrl);

  // Check if it is a direct image URL
  if (/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(cleanUrl)) {
    const filename = cleanUrl.split('/').pop().split('?')[0] || 'image.jpg';
    return res.json({
      id: crypto.randomUUID().slice(0, 8),
      title: filename,
      thumbnail: cleanUrl,
      duration: 'Image',
      uploader: 'Direct Link',
      platform: 'Direct Image',
      url: cleanUrl,
      isImageOnly: true,
      options: { video: [], audio: [] },
      images: [
        {
          label: 'Original High-Res Image',
          resolution: 'Original',
          url: cleanUrl,
          ext: filename.split('.').pop() || 'jpg'
        }
      ]
    });
  }

  const ffmpegPath = getFFmpegLocation();
  const args = ['-J', '--no-playlist', '--no-warnings', cleanUrl];

  if (ffmpegPath !== 'ffmpeg') {
    args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  }

  const ytdlp = spawn(YTDLP_BIN, args);
  let stdoutData = '';
  let stderrData = '';

  ytdlp.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  ytdlp.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp error:', stderrData);
      return res.status(500).json({
        error: 'Unable to fetch media information. Ensure the post is public and the link is valid.',
        details: stderrData.trim().split('\n').pop()
      });
    }

    try {
      const info = JSON.parse(stdoutData);
      const isMultiItem = Array.isArray(info.entries) && info.entries.length > 0;

      // Extract unique resolution formats
      const availableHeights = new Set();
      if (Array.isArray(info.formats)) {
        info.formats.forEach((f) => {
          if (f.height && f.height > 0) {
            availableHeights.add(f.height);
          }
        });
      }

      const standardTiers = [
        { label: '4K Ultra HD', height: 2160, tag: '2160p' },
        { label: '2K Quad HD', height: 1440, tag: '1440p' },
        { label: '1080p Full HD', height: 1080, tag: '1080p' },
        { label: '720p HD', height: 720, tag: '720p' },
        { label: '480p Standard', height: 480, tag: '480p' },
        { label: '360p Low', height: 360, tag: '360p' }
      ];

      const videoOptions = [];
      const hasFormats = availableHeights.size > 0 || (info.formats && info.formats.length > 0);

      if (hasFormats) {
        videoOptions.push({
          id: 'best_video',
          label: 'Best Available Quality (Full HD/4K)',
          format: 'mp4',
          type: 'video',
          isBest: true
        });

        standardTiers.forEach((tier) => {
          const hasHeight = Array.from(availableHeights).some((h) => h >= tier.height);
          if (hasHeight) {
            videoOptions.push({
              id: `video_${tier.height}`,
              height: tier.height,
              label: `${tier.tag} (${tier.label})`,
              format: 'mp4',
              type: 'video'
            });
          }
        });
      }

      // Audio options
      const audioOptions = hasFormats ? [
        {
          id: 'audio_mp3',
          label: 'MP3 Audio (High Quality 320kbps)',
          format: 'mp3',
          type: 'audio'
        },
        {
          id: 'audio_m4a',
          label: 'M4A Audio (Original Stream)',
          format: 'm4a',
          type: 'audio'
        }
      ] : [];

      // Extract Images & High-Res Thumbnails
      const images = [];

      // 1. YouTube High-Res Thumbnails
      if (platform === 'YouTube' && info.id) {
        images.push({
          label: 'Ultra HD MaxRes Thumbnail',
          resolution: '1920x1080 (Full HD)',
          url: `https://i.ytimg.com/vi/${info.id}/maxresdefault.jpg`,
          ext: 'jpg',
          isCover: true
        });
        images.push({
          label: 'Standard HD Thumbnail',
          resolution: '640x480 (SD)',
          url: `https://i.ytimg.com/vi/${info.id}/sddefault.jpg`,
          ext: 'jpg'
        });
        images.push({
          label: 'High Quality Thumbnail',
          resolution: '480x360 (HQ)',
          url: `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
          ext: 'jpg'
        });
      }

      // 2. Instagram Carousel / Multi-photo entries
      if (isMultiItem) {
        info.entries.forEach((entry, idx) => {
          const imgUrl = entry.thumbnail || (entry.thumbnails && entry.thumbnails.slice(-1)[0]?.url);
          if (imgUrl) {
            images.push({
              label: `Instagram Photo #${idx + 1}`,
              resolution: 'Full Original',
              url: imgUrl,
              ext: 'jpg'
            });
          }
        });
      }

      // 3. Extracted Thumbnails from metadata (for Instagram, Facebook, TikTok)
      if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0 && images.length === 0) {
        const sortedThumbs = [...info.thumbnails]
          .filter((t) => t.url && !t.url.endsWith('.webp'))
          .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));

        if (sortedThumbs.length > 0) {
          const bestThumb = sortedThumbs[0];
          images.push({
            label: `${platform} Original Image / Cover`,
            resolution: bestThumb.width && bestThumb.height ? `${bestThumb.width}x${bestThumb.height}` : 'Original High-Res',
            url: bestThumb.url,
            ext: 'jpg',
            isCover: true
          });
        }
      }

      // Fallback single thumbnail if not already present
      if (images.length === 0 && info.thumbnail) {
        images.push({
          label: `${platform} Cover Image`,
          resolution: 'Original Quality',
          url: info.thumbnail,
          ext: 'jpg',
          isCover: true
        });
      }

      return res.json({
        id: info.id || crypto.randomUUID().slice(0, 8),
        title: info.title || `${platform} Media`,
        thumbnail: info.thumbnail || (images[0] ? images[0].url : ''),
        duration: info.duration ? formatDuration(info.duration) : (videoOptions.length ? 'Video' : 'Image'),
        uploader: info.uploader || info.channel || platform,
        platform,
        url: cleanUrl,
        isImageOnly: videoOptions.length === 0,
        options: {
          video: videoOptions,
          audio: audioOptions
        },
        images
      });
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr);
      return res.status(500).json({ error: 'Failed to parse media metadata.' });
    }
  });
});

// 2. POST /api/download - Initiate a video/audio download job
app.post('/api/download', (req, res) => {
  const { url, optionId, type, height, format } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing media URL.' });
  }

  const jobId = crypto.randomUUID();
  const jobFolder = path.join(DOWNLOADS_DIR, jobId);
  fs.mkdirSync(jobFolder, { recursive: true });

  const ffmpegPath = getFFmpegLocation();
  const args = ['--no-playlist', '--newline'];

  if (ffmpegPath !== 'ffmpeg') {
    args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  }

  // Format selection logic
  if (type === 'audio') {
    args.push('-x');
    args.push('--audio-format', format === 'm4a' ? 'm4a' : 'mp3');
    args.push('--audio-quality', '0');
    args.push('-o', path.join(jobFolder, '%(title).100B.%(ext)s'));
  } else {
    // Video
    let formatFilter = 'bestvideo+bestaudio/best';
    if (height && !isNaN(height)) {
      formatFilter = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
    }
    args.push('-f', formatFilter);
    args.push('--merge-output-format', 'mp4');
    args.push('-o', path.join(jobFolder, '%(title).100B.%(ext)s'));
  }

  args.push(url);

  console.log(`Starting job ${jobId} with args:`, args.join(' '));

  const ytdlp = spawn(YTDLP_BIN, args);

  jobs.set(jobId, {
    status: 'starting',
    percent: 0,
    speed: '',
    eta: '',
    statusText: 'Connecting to media stream...',
    filePath: null,
    fileName: null,
    error: null,
    createdAt: Date.now()
  });

  ytdlp.stdout.on('data', (data) => {
    const text = data.toString();
    const job = jobs.get(jobId);
    if (!job) return;

    const percentMatch = text.match(/(\d+\.?\d*)%/);
    if (percentMatch) {
      job.percent = parseFloat(percentMatch[1]);
      job.status = 'downloading';
      job.statusText = 'Downloading stream...';
    }

    const speedMatch = text.match(/at\s+([\d\.]+\w+\/s)/);
    if (speedMatch) job.speed = speedMatch[1];

    const etaMatch = text.match(/ETA\s+([\d:]+)/);
    if (etaMatch) job.eta = etaMatch[1];

    if (text.includes('[Merger]') || text.includes('Merging formats') || text.includes('[ExtractAudio]')) {
      job.status = 'processing';
      job.statusText = 'Merging high-quality audio and video with FFmpeg...';
      job.percent = 99;
    }
  });

  ytdlp.stderr.on('data', (data) => {
    console.error(`[Job ${jobId} err]:`, data.toString());
  });

  ytdlp.on('close', (code) => {
    const job = jobs.get(jobId);
    if (!job) return;

    if (code !== 0) {
      job.status = 'failed';
      job.error = 'Download failed. Please verify the URL or try a different resolution.';
      return;
    }

    try {
      const files = fs.readdirSync(jobFolder);
      if (files.length > 0) {
        job.fileName = files[0];
        job.filePath = path.join(jobFolder, files[0]);
        job.status = 'completed';
        job.percent = 100;
        job.statusText = 'Ready for download!';
      } else {
        job.status = 'failed';
        job.error = 'No output file was created.';
      }
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
    }
  });

  res.json({ jobId });
});

// 3. GET /api/download-image - Direct Image Proxy & Downloader
app.get('/api/download-image', async (req, res) => {
  const { url, filename, ext } = req.query;
  if (!url) {
    return res.status(400).send('Missing image URL');
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch image from source.');
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const cleanExt = ext || (contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg');
    let safeTitle = (filename || 'downloaded-image').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
    if (!safeTitle) safeTitle = 'image';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${cleanExt}"`);

    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Image download error:', err);
    return res.status(500).send('Error downloading image: ' + err.message);
  }
});

// 4. GET /api/progress/:jobId - Poll job status
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    statusText: job.statusText,
    fileName: job.fileName,
    error: job.error
  });
});

// 5. GET /api/file/:jobId - Download the finished video file
app.get('/api/file/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job || job.status !== 'completed' || !job.filePath) {
    return res.status(404).send('File not found or still processing.');
  }

  res.download(job.filePath, job.fileName, (err) => {
    if (err) console.error('Error sending file:', err);
    setTimeout(() => {
      try {
        const folder = path.dirname(job.filePath);
        fs.rmSync(folder, { recursive: true, force: true });
        jobs.delete(jobId);
      } catch (e) {}
    }, 10 * 60 * 1000);
  });
});

app.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(` Universal Video & Image Downloader is running!`);
  console.log(` Web Interface: http://${HOST}:${PORT}`);
  console.log(` Discovered FFmpeg: ${getFFmpegLocation()}`);
  console.log(`====================================================`);
});
