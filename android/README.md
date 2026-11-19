# Universal Downloader - Android Mobile APK Project

This folder contains the complete native Android project configured to wrap the Universal Downloader into an Android APK with full system Share Sheet integration.

---

## 📱 Features of the Android App
- **Share Sheet Integration:** When you tap "Share" on any video/photo in YouTube, Instagram, or Facebook, "Downloader" appears in the native Android share menu.
- **Native Download Manager:** Intercepts video/image downloads and uses Android's native `DownloadManager` with notification bar progress and direct saving to the phone's `Downloads` folder.
- **Hardware Acceleration:** Smooth 60fps glassmorphic UI rendering.

---

## 🛠️ How to Build the `.apk` File

### Option 1: Using Android Studio (Recommended for Developers)
1. Open **Android Studio**.
2. Select **Open an Existing Project** and choose this `android/` folder.
3. Wait for Gradle sync to complete.
4. Click **Build** in the top menu &rarr; **Build Bundle(s) / APK(s)** &rarr; **Build APK(s)**.
5. Android Studio will generate the `app-debug.apk` file in `android/app/build/outputs/apk/debug/`.
6. Transfer this `.apk` to your phone and tap to install!

### Option 2: 1-Click Cloud APK Generator (No Android Studio Needed)
If you host this web application on your website, VPS, or a free tunnel (like Cloudflare Tunnel or ngrok):
1. Go to **[https://www.pwabuilder.com](https://www.pwabuilder.com)** (Microsoft's official open-source PWA to APK tool).
2. Enter your site URL and click **Start**.
3. Click **Package for Android**.
4. Download the ready-to-install signed `.apk` file!

### Option 3: Instant WebAPK (Easiest & Fastest)
You don't even need to compile code manually:
1. Open the website on your Android phone's Chrome or Edge browser.
2. Tap the green **"📲 Install App / Add to Share Menu"** button (or Chrome 3-dots menu &rarr; **Install App**).
3. Android will automatically generate and install a native **WebAPK** onto your phone with full share menu support.
