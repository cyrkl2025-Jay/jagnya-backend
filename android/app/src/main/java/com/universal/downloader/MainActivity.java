package com.universal.downloader;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.StrictMode;
import android.text.TextUtils;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Comparator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private WebView webView;
    private String pendingSharedUrl = null;
    private String lastDetectedClipboardUrl = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            getWindow().setFormat(PixelFormat.RGBA_8888);
        } catch (Exception ignored) {}

        // Allow sharing file:// URIs without VmPolicy restrictions
        try {
            StrictMode.VmPolicy.Builder builder = new StrictMode.VmPolicy.Builder();
            StrictMode.setVmPolicy(builder.build());
        } catch (Exception ignored) {}

        checkStoragePermissions();

        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.parseColor("#090D16"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090D16"));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        rootLayout.addView(webView);

        setContentView(rootLayout);

        setupWebView();
        handleIncomingIntent(getIntent());

        // Always load bundled ultra-fast offline assets - zero black screen lag!
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        checkClipboardForMediaUrl();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            checkClipboardForMediaUrl();
        }
    }

    private void checkClipboardForMediaUrl() {
        try {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard != null && clipboard.hasPrimaryClip()) {
                ClipData clip = clipboard.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) {
                    CharSequence text = clip.getItemAt(0).getText();
                    if (text != null) {
                        String extracted = extractUrl(text.toString());
                        if (extracted != null && isSupportedMediaUrl(extracted)) {
                            if (!extracted.equals(lastDetectedClipboardUrl)) {
                                lastDetectedClipboardUrl = extracted;
                                deliverClipboardUrlToJs(extracted);
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private boolean isSupportedMediaUrl(String url) {
        String lower = url.toLowerCase();
        return lower.contains("youtu.be") ||
               lower.contains("youtube.com") ||
               lower.contains("instagram.com") ||
               lower.contains("facebook.com") ||
               lower.contains("fb.watch") ||
               lower.contains("tiktok.com") ||
               lower.contains("threads.net") ||
               lower.contains("twitter.com") ||
               lower.contains("x.com");
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
        try {
            settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
        } catch (Exception ignored) {}
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " UniversalDownloaderApp/2.0");

        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:///android_asset/") || url.contains("onrender.com") || url.contains("trycloudflare.com") || url.contains(":5000")) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!TextUtils.isEmpty(pendingSharedUrl)) {
                    deliverSharedUrlToJs(pendingSharedUrl);
                    pendingSharedUrl = null;
                } else {
                    checkClipboardForMediaUrl();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient());

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setMimeType(mimeType);

                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) request.addRequestHeader("cookie", cookies);
                    request.addRequestHeader("User-Agent", userAgent);

                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    request.setDescription("Downloading file: " + fileName);
                    request.setTitle(fileName);
                    request.allowScanningByMediaScanner();
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(request);
                        Toast.makeText(MainActivity.this, "📥 Downloading: " + fileName, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Download error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText != null) {
                String extractedUrl = extractUrl(sharedText);
                if (extractedUrl != null) {
                    deliverSharedUrlToJs(extractedUrl);
                }
            }
        }
    }

    private void deliverSharedUrlToJs(final String url) {
        pendingSharedUrl = url;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                String safe = url.replace("'", "\\'");
                webView.evaluateJavascript("if (window.onSharedUrlReceived) { window.onSharedUrlReceived('" + safe + "'); }", null);
            }
        });
    }

    private void deliverClipboardUrlToJs(final String url) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                String safe = url.replace("'", "\\'");
                webView.evaluateJavascript("if (window.onClipboardUrlDetected) { window.onClipboardUrlDetected('" + safe + "'); }", null);
            }
        });
    }

    private void checkStoragePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{
                        android.Manifest.permission.READ_EXTERNAL_STORAGE,
                        android.Manifest.permission.WRITE_EXTERNAL_STORAGE
                }, 101);
            }
        }
    }

    private String extractUrl(String text) {
        Pattern pattern = Pattern.compile("(https?://\\S+)");
        Matcher matcher = pattern.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    public class WebAppInterface {
        Context mContext;

        WebAppInterface(Context c) {
            mContext = c;
        }

        @JavascriptInterface
        public void showToast(String toast) {
            Toast.makeText(mContext, toast, Toast.LENGTH_SHORT).show();
        }

        @JavascriptInterface
        public void markUrlHandled(String url) {
            lastDetectedClipboardUrl = url;
        }

        @JavascriptInterface
        public boolean hasStoragePermission() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
            return checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestStoragePermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    checkStoragePermissions();
                }
            });
        }
    }
}
