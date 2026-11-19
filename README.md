# Universal Video & Image Downloader 🚀
### Download Videos & High-Res Images from YouTube, Instagram, Facebook, and the Web (Up to 4K, Audio MP3, and Full HD Images)

A fast, modern media downloader web application powered by **Node.js**, **yt-dlp**, and **FFmpeg**.

---

## ✨ Features
- **YouTube:** Supports 360p, 480p, 720p, 1080p Full HD, 1440p (2K), and 2160p (4K), plus MP3 audio extraction.
- **YouTube High-Res Thumbnails:** Download Full HD (1920x1080) MaxRes covers, SD, and HQ video thumbnails.
- **Instagram:** Full original quality download for Reels, Videos, Photos, and multi-image Carousel posts.
- **Facebook:** High Definition (HD) and Standard Definition (SD) videos, covers, and photos.
- **Direct Image Downloader:** Paste direct image links (`.jpg`, `.png`, `.webp`, `.gif`) or web images to download instantly.
- **FFmpeg Muxing:** Automatically combines separated video and audio streams into single `.mp4` containers with zero quality loss.
- **Live Progress Bar:** Real-time download percentage, transfer speed, and ETA for video downloads.
- **1-Click Launch:** Simply run `start.bat` on Windows.
- **PWA Ready:** Installable on Android and iOS home screens directly from the browser.

---

## 🚀 How to Run Locally

### Option 1: Double-Click Launcher
Double-click `start.bat` in this folder. It will start the server and automatically open `http://127.0.0.1:5000` in your browser.

### Option 2: Command Line
```powershell
node server.js
```
Then visit [http://127.0.0.1:5000](http://127.0.0.1:5000) in your web browser.

---

## 📁 Project Structure
```
├── bin/
│   ├── yt-dlp.exe        # Standalone video extraction engine
│   ├── ffmpeg.exe        # High-performance audio/video muxer
│   └── ffprobe.exe       # Stream analyzer
├── public/
│   ├── index.html        # Modern responsive user interface
│   ├── app.js            # Frontend logic & progress tracking
│   ├── style.css         # Dark glassmorphic styling
│   └── manifest.json     # PWA manifest
├── server.js             # Express API & download queue manager
├── package.json          # Node.js dependencies
├── start.bat             # 1-click Windows launcher
└── README.md
```
