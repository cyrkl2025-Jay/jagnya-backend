const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BIN_DIR = path.join(__dirname, 'bin');

function getYtDlpLocation() {
  const localExe = path.join(BIN_DIR, 'yt-dlp.exe');
  if (fs.existsSync(localExe)) return localExe;
  const localBin = path.join(BIN_DIR, 'yt-dlp');
  if (fs.existsSync(localBin)) return localBin;
  return 'yt-dlp';
}

const YTDLP_BIN = getYtDlpLocation();
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// In-memory job tracker
const jobs = new Map();

// Helper to locate FFmpeg
function getFFmpegLocation() {
  const localFFmpeg = path.join(BIN_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
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

function isPlaylistUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes('watch?v=') && !lower.includes('list=pl')) {
    return false;
  }
  if (lower.includes('list=') ||
      lower.includes('/playlist') ||
      lower.includes('/channel/') ||
      lower.includes('/c/') ||
      lower.includes('/user/') ||
      (lower.includes('youtube.com/@') && !lower.includes('/watch'))) {
    return true;
  }
  if (lower.includes('instagram.com/')) {
    const isSinglePost = lower.includes('/p/') || lower.includes('/reel/') || lower.includes('/stories/') || lower.includes('/tv/');
    if (!isSinglePost) {
      return true;
    }
  }
  return false;
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

// In-memory cache for ultra-fast instant metadata re-analysis
const metadataCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Scrapes all embedded and content images from any regular webpage
 */
async function extractImagesFromWebpage(pageUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: controller.signal
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Failed to load page: HTTP ${response.status}`);
  }

  const html = await response.text();
  const baseUri = new URL(pageUrl);

  // Extract page title
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim().replace(/\s+/g, ' ');
  }
  if (!title) {
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitle && ogTitle[1]) title = ogTitle[1].trim();
  }
  if (!title) {
    title = baseUri.hostname;
  }

  const imageUrls = new Set();

  const addCandidate = (rawUrl) => {
    if (!rawUrl || typeof rawUrl !== 'string') return;
    rawUrl = rawUrl.trim().replace(/&amp;/g, '&');
    if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('javascript:')) return;
    try {
      const resolved = new URL(rawUrl, baseUri).href;
      const lower = resolved.toLowerCase();
      // Filter tracking pixels, SVGs, and tiny analytics markers
      if (lower.includes('1x1') || lower.includes('pixel') || lower.includes('analytics') || lower.includes('favicon.ico')) return;
      if (lower.endsWith('.svg')) return;
      imageUrls.add(resolved);
    } catch {}
  };

  // 1. Meta OpenGraph & Twitter image tags (primary high-resolution previews)
  const metaRegex = /<meta[^>]*(?:property|name)=["'](og:image|twitter:image|twitter:image:src)["'][^>]*content=["']([^"']+)["']/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    addCandidate(match[2]);
  }
  const metaRegex2 = /<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](og:image|twitter:image)["']/gi;
  while ((match = metaRegex2.exec(html)) !== null) {
    addCandidate(match[1]);
  }

  // 2. Link rel="image_src"
  const linkRegex = /<link[^>]*rel=["'](?:image_src|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    addCandidate(match[1]);
  }

  // 3. <img> tags: src, data-src, data-original, data-highres, srcset
  const imgTagRegex = /<img\b([^>]*)>/gi;
  while ((match = imgTagRegex.exec(html)) !== null) {
    const attrs = match[1];
    const highRes = attrs.match(/\b(?:data-original|data-highres|data-full|data-src|data-lazy-src)=["']([^"']+)["']/i);
    if (highRes && highRes[1]) addCandidate(highRes[1]);

    const srcsetAttr = attrs.match(/\b(?:data-srcset|srcset)=["']([^"']+)["']/i);
    if (srcsetAttr && srcsetAttr[1]) {
      const parts = srcsetAttr[1].split(',');
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1].trim().split(/\s+/)[0];
        addCandidate(lastPart);
      }
    }

    const srcAttr = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (srcAttr && srcAttr[1]) addCandidate(srcAttr[1]);
  }

  // 4. Background images in style tags or attributes
  const bgRegex = /url\(['"]?([^'"()]+?\.(?:jpg|jpeg|png|webp))['"]?\)/gi;
  while ((match = bgRegex.exec(html)) !== null) {
    addCandidate(match[1]);
  }

  const cleanTitle = (title || 'image').slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');
  const slides = Array.from(imageUrls).map((imgUrl, idx) => {
    let ext = 'jpg';
    try {
      const pathname = new URL(imgUrl).pathname.toLowerCase();
      if (pathname.endsWith('.png')) ext = 'png';
      else if (pathname.endsWith('.webp')) ext = 'webp';
      else if (pathname.endsWith('.gif')) ext = 'gif';
    } catch {}

    const proxyDownloadUrl = `/api/proxy-image?url=${encodeURIComponent(imgUrl)}&name=${encodeURIComponent(cleanTitle)}-img-${idx + 1}.${ext}&referer=${encodeURIComponent(pageUrl)}`;

    return {
      index: idx + 1,
      type: 'image',
      url: imgUrl,
      displayUrl: imgUrl,
      thumbnail: imgUrl,
      downloadUrl: proxyDownloadUrl,
      ext: ext,
      resolution: 'High Resolution'
    };
  });

  return {
    id: crypto.randomUUID().slice(0, 8),
    title: title || 'Website Images',
    thumbnail: slides.length > 0 ? slides[0].thumbnail : '',
    duration: `${slides.length} Images`,
    uploader: baseUri.hostname,
    platform: 'Website Image Gallery',
    isCarousel: true,
    isWebsiteGallery: true,
    totalSlides: slides.length,
    slides: slides
  };
}

// 1. POST /api/info - Inspect metadata, video/audio formats, and images/thumbnails
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'Please provide a valid video or image URL.' });
  }

  const cleanUrl = url.trim();

  // Instant cache hit: return in 0.001s
  const cached = metadataCache.get(cleanUrl);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return res.json(cached.data);
  }

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
  const isPlaylist = isPlaylistUrl(cleanUrl);
  const isInstagramPost = cleanUrl.includes('instagram.com/p/') || cleanUrl.includes('instagram.com/reel/');
  const args = [
    '-J',
    '--skip-download',
    '--no-warnings',
    '--no-check-certificates',
    '--socket-timeout', '10'
  ];

  if (isPlaylist) {
    args.push('--flat-playlist');
  } else if (!isInstagramPost) {
    args.push('--no-playlist');
  }
  if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
    args.push('--extractor-args', 'youtube:player_client=android');
  } else if (cleanUrl.includes('instagram.com')) {
    args.push('--extractor-args', 'instagram:api_client=android');
  }
  args.push(cleanUrl);

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

  ytdlp.on('close', async (code) => {
    if (code !== 0) {
      console.log('yt-dlp exited with non-zero code. Attempting website image scraping fallback for:', cleanUrl);
      try {
        const websiteGallery = await extractImagesFromWebpage(cleanUrl);
        if (websiteGallery && websiteGallery.slides && websiteGallery.slides.length > 0) {
          metadataCache.set(cleanUrl, { timestamp: Date.now(), data: websiteGallery });
          return res.json(websiteGallery);
        }
      } catch (scrapeErr) {
        console.error('Website image scrape fallback error:', scrapeErr.message);
      }

      console.error('yt-dlp error:', stderrData);
      return res.status(500).json({
        error: 'Unable to fetch media information. Ensure the post is public and the link is valid.',
        details: stderrData.trim().split('\n').pop()
      });
    }

    try {
      const info = JSON.parse(stdoutData);

      // 1. Handle Playlists, Channels, and Instagram Profiles
      if (info._type === 'playlist' && !cleanUrl.includes('/p/') && !cleanUrl.includes('/reel/')) {
        // If it's a generic webpage (e.g. Wikipedia or blog) that yt-dlp parsed as a playlist of audio snippets, prioritize website image extraction
        if (info.extractor === 'generic' || (!cleanUrl.includes('youtube.com') && !cleanUrl.includes('instagram.com'))) {
          try {
            const websiteGallery = await extractImagesFromWebpage(cleanUrl);
            if (websiteGallery && websiteGallery.slides && websiteGallery.slides.length > 0) {
              metadataCache.set(cleanUrl, { timestamp: Date.now(), data: websiteGallery });
              return res.json(websiteGallery);
            }
          } catch (scrapeErr) {
            console.error('Website image fallback check error:', scrapeErr.message);
          }
        }

        const isInstagram = cleanUrl.includes('instagram.com');
        const entries = (info.entries || []).map((entry, index) => {
          let thumb = '';
          if (entry.thumbnails && entry.thumbnails.length) {
            thumb = entry.thumbnails[entry.thumbnails.length - 1].url;
          } else if (entry.thumbnail) {
            thumb = entry.thumbnail;
          } else if (entry.id && !isInstagram) {
            thumb = `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;
          }
          return {
            index: index + 1,
            id: entry.id,
            title: entry.title || (isInstagram ? `Instagram Reel #${index + 1}` : `Episode #${index + 1}`),
            duration: formatDuration(entry.duration),
            url: entry.url || (isInstagram ? (entry.webpage_url || cleanUrl) : `https://www.youtube.com/watch?v=${entry.id}`),
            thumbnail: thumb
          };
        });

        return res.json({
          isPlaylist: true,
          id: info.id || crypto.randomUUID().slice(0, 8),
          title: info.title || (isInstagram ? `@${info.uploader || 'Creator'} Reels` : 'Playlist / Channel'),
          uploader: info.uploader || info.channel || 'Creator',
          platform: isInstagram ? 'Instagram Profile' : 'YouTube Playlist',
          url: cleanUrl,
          thumbnail: (info.thumbnails && info.thumbnails.length)
            ? info.thumbnails[info.thumbnails.length - 1].url
            : (entries[0] ? entries[0].thumbnail : ''),
          totalCount: info.playlist_count || entries.length,
          items: entries
        });
      }

      // 2. Handle Multi-Slide Instagram Carousel Post
      const isInstagramCarousel = (cleanUrl.includes('instagram.com') || platform === 'Instagram') &&
                                  Array.isArray(info.entries) &&
                                  info.entries.length > 1;

      if (isInstagramCarousel) {
        const slides = info.entries.map((entry, idx) => {
          const isVideo = (entry.formats && entry.formats.some(f => f.vcodec !== 'none')) ||
                          entry.ext === 'mp4' ||
                          (entry.video_ext && entry.video_ext !== 'none');

          let mediaUrl = entry.url || '';
          if (!mediaUrl && entry.formats && entry.formats.length > 0) {
            mediaUrl = entry.formats[entry.formats.length - 1].url;
          }

          let thumbUrl = entry.thumbnail || (entry.thumbnails && entry.thumbnails.length ? entry.thumbnails[entry.thumbnails.length - 1].url : '');
          if (!thumbUrl) thumbUrl = mediaUrl;

          return {
            index: idx + 1,
            id: entry.id || `slide-${idx + 1}`,
            type: isVideo ? 'video' : 'image',
            label: isVideo ? `Slide #${idx + 1} (Video)` : `Slide #${idx + 1} (Photo)`,
            ext: isVideo ? 'mp4' : 'jpg',
            duration: isVideo ? formatDuration(entry.duration) : null,
            url: mediaUrl || thumbUrl,
            thumbnail: thumbUrl,
            downloadUrl: isVideo
              ? `/api/download-media?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent((info.title || 'instagram-video') + '-' + (idx + 1))}&ext=mp4`
              : `/api/download-media?url=${encodeURIComponent(thumbUrl || mediaUrl)}&filename=${encodeURIComponent((info.title || 'instagram-photo') + '-' + (idx + 1))}&ext=jpg`
          };
        });

        return res.json({
          isCarousel: true,
          id: info.id || crypto.randomUUID().slice(0, 8),
          title: info.title || 'Instagram Carousel Post',
          uploader: info.uploader || 'Instagram User',
          platform: 'Instagram Carousel',
          url: cleanUrl,
          totalSlides: slides.length,
          slides: slides
        });
      }

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

      if (videoOptions.length === 0 && platform === 'Web Video / Media') {
        try {
          const websiteGallery = await extractImagesFromWebpage(cleanUrl);
          if (websiteGallery && websiteGallery.slides && websiteGallery.slides.length > 0) {
            metadataCache.set(cleanUrl, { timestamp: Date.now(), data: websiteGallery });
            return res.json(websiteGallery);
          }
        } catch (scrapeErr) {
          console.error('Website image scrape fallback error:', scrapeErr.message);
        }
      }

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

      const resultData = {
        id: info.id || crypto.randomUUID().slice(0, 8),
        title: info.title || `${platform} Media`,
        thumbnail: info.thumbnail || (images[0] ? images[0].url : ''),
        duration: info.duration ? formatDuration(info.duration) : (videoOptions.length ? 'Video' : 'Image'),
        durationSeconds: typeof info.duration === 'number' ? info.duration : null,
        uploader: info.uploader || info.channel || platform,
        platform,
        url: cleanUrl,
        isImageOnly: videoOptions.length === 0,
        options: {
          video: videoOptions,
          audio: audioOptions
        },
        images
      };

      // Save in LRU memory cache
      metadataCache.set(cleanUrl, { timestamp: Date.now(), data: resultData });
      if (metadataCache.size > 250) {
        const oldest = metadataCache.keys().next().value;
        metadataCache.delete(oldest);
      }

      return res.json(resultData);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr);
      return res.status(500).json({ error: 'Failed to parse media metadata.' });
    }
  });
});

// 2. POST /api/download - Initiate a video/audio download job
app.post('/api/download', (req, res) => {
  const { url, optionId, type, height, format, trimStart, trimEnd, speedBooster } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing media URL.' });
  }

  const jobId = crypto.randomUUID();
  const jobFolder = path.join(DOWNLOADS_DIR, jobId);
  fs.mkdirSync(jobFolder, { recursive: true });

  const ffmpegPath = getFFmpegLocation();
  const args = ['--no-playlist', '--newline'];
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    args.push('--extractor-args', 'youtube:player_client=android,web');
  }

  if (ffmpegPath !== 'ffmpeg') {
    args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  }

  // Trim / Clip Support
  const cleanStart = trimStart && typeof trimStart === 'string' ? trimStart.trim().replace(/[^0-9:\.]/g, '') : '';
  const cleanEnd = trimEnd && typeof trimEnd === 'string' ? trimEnd.trim().replace(/[^0-9:\.]/g, '') : '';
  if (cleanStart || cleanEnd) {
    const startVal = cleanStart || '0';
    const endVal = cleanEnd || 'inf';
    args.push('--download-sections', `*${startVal}-${endVal}`);
    args.push('--force-keyframes-at-cuts');
  }

  // Speed Booster: Multi-threaded parallel downloading
  const aria2Local = path.join(__dirname, 'bin', process.platform === 'win32' ? 'aria2c.exe' : 'aria2c');
  const hasAria2 = fs.existsSync(aria2Local);
  const useSpeedBooster = speedBooster !== false;

  if (useSpeedBooster) {
    args.push('--concurrent-fragments', '16');
    args.push('--buffer-size', '1024K');
    args.push('--http-chunk-size', '10M');

    if (!cleanStart && !cleanEnd) {
      if (hasAria2) {
        args.push('--downloader', `aria2c:${aria2Local}`);
        args.push('--downloader-args', 'aria2c:-x 16 -s 16 -j 16 -k 1M --summary-interval=1');
      } else if (process.platform !== 'win32') {
        args.push('--downloader', 'aria2c');
        args.push('--downloader-args', 'aria2c:-x 16 -s 16 -j 16 -k 1M --summary-interval=1');
      }
    }
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
      job.statusText = 'Downloading stream (multi-threaded)...';
    }

    const speedMatch = text.match(/(?:at\s+|DL:)\s*([\d\.]+\w+(?:\/s)?)/i);
    if (speedMatch) job.speed = speedMatch[1].toLowerCase().endsWith('/s') ? speedMatch[1] : `${speedMatch[1]}/s`;

    const etaMatch = text.match(/ETA:?\s*([\d:]+\w*)/i);
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

// 3. GET /api/download-media, /api/download-image & /api/proxy-image - Direct Media Proxy & Downloader
app.get(['/api/download-image', '/api/download-media', '/api/proxy-image'], async (req, res) => {
  const { url, filename, name, ext, referer } = req.query;
  const targetUrl = url;
  if (!targetUrl) {
    return res.status(400).send('Missing media URL');
  }

  try {
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
    };
    if (referer) {
      fetchHeaders['Referer'] = referer;
    }

    const response = await fetch(targetUrl, {
      headers: fetchHeaders
    });

    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch media from source.');
    }

    const contentType = response.headers.get('content-type') || (ext === 'mp4' ? 'video/mp4' : 'image/jpeg');
    const cleanExt = ext || (contentType.includes('mp4') ? 'mp4' : contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg');
    let safeTitle = (name || filename || 'downloaded-media').replace(/[^a-zA-Z0-9_\-\s\.]/g, '').trim();
    if (!safeTitle) safeTitle = 'media';
    if (!safeTitle.toLowerCase().endsWith(`.${cleanExt}`) && !/\.(jpg|jpeg|png|webp|gif|mp4)$/i.test(safeTitle)) {
      safeTitle = `${safeTitle}.${cleanExt}`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch (err) {
    console.error('Media download error:', err);
    return res.status(500).send('Error downloading media: ' + err.message);
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
