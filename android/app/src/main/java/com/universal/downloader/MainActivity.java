package com.universal.downloader;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private WebView webView;
    private FrameLayout rootLayout;
    private LinearLayout errorLayout;
    private TextView errorText;

    private static final String PREFS_NAME = "DownloaderPrefs";
    private static final String KEY_SERVER_URL = "server_url";
    // Default server address set to your PC's Wi-Fi IP
    private static final String DEFAULT_SERVER_URL = "http://192.168.0.102:5000";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.parseColor("#090D16"));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.parseColor("#090D16"));
        rootLayout.addView(webView);

        setupErrorView();
        rootLayout.addView(errorLayout);

        setContentView(rootLayout);

        setupWebView();
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void setupErrorView() {
        errorLayout = new LinearLayout(this);
        errorLayout.setOrientation(LinearLayout.VERTICAL);
        errorLayout.setGravity(Gravity.CENTER);
        errorLayout.setPadding(40, 40, 40, 40);
        errorLayout.setBackgroundColor(Color.parseColor("#090D16"));
        errorLayout.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("⚡ Universal Downloader");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 0, 0, 20);
        errorLayout.addView(title);

        errorText = new TextView(this);
        errorText.setTextColor(Color.parseColor("#94A3B8"));
        errorText.setTextSize(14);
        errorText.setGravity(Gravity.CENTER);
        errorText.setLineSpacing(6, 1);
        errorText.setPadding(0, 0, 0, 30);
        errorLayout.addView(errorText);

        Button btnRetry = new Button(this);
        btnRetry.setText("🔄 Retry Connection");
        btnRetry.setTextColor(Color.WHITE);
        btnRetry.setBackgroundColor(Color.parseColor("#6366F1"));
        btnRetry.setPadding(30, 20, 30, 20);
        btnRetry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideError();
                webView.loadUrl(getServerUrl());
            }
        });
        errorLayout.addView(btnRetry);

        Button btnChangeUrl = new Button(this);
        btnChangeUrl.setText("⚙️ Change Server IP / URL");
        btnChangeUrl.setTextColor(Color.parseColor("#A5B4FC"));
        btnChangeUrl.setBackgroundColor(Color.TRANSPARENT);
        btnChangeUrl.setPadding(30, 20, 30, 20);
        btnChangeUrl.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showChangeUrlDialog();
            }
        });
        errorLayout.addView(btnChangeUrl);
    }

    private void showError(String desc) {
        errorLayout.setVisibility(View.VISIBLE);
        webView.setVisibility(View.GONE);
        errorText.setText("Cannot connect to server at:\n" + getServerUrl() + "\n\n"
                + "Please ensure:\n"
                + "1. Your PC and phone are on the same Wi-Fi.\n"
                + "2. 'server.js' is running on your PC.\n\n"
                + "(" + desc + ")");
    }

    private void hideError() {
        errorLayout.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private void showChangeUrlDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Configure Server URL");
        builder.setMessage("Enter the IP address or domain of your downloader server:");

        final EditText input = new EditText(this);
        input.setText(getServerUrl());
        input.setSelection(input.getText().length());
        builder.setView(input);

        builder.setPositiveButton("Save & Connect", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                String newUrl = input.getText().toString().trim();
                if (!TextUtils.isEmpty(newUrl)) {
                    if (!newUrl.startsWith("http://") && !newUrl.startsWith("https://")) {
                        newUrl = "http://" + newUrl;
                    }
                    setServerUrl(newUrl);
                    hideError();
                    webView.loadUrl(newUrl);
                }
            }
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " UniversalDownloaderApp/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                } catch (Exception e) {
                    return true;
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                hideError();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    showError(error != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            ? error.getDescription().toString() : "Connection failed");
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
                    request.addRequestHeader("cookie", cookies);
                    request.addRequestHeader("User-Agent", userAgent);

                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    request.setDescription("Downloading media file...");
                    request.setTitle(fileName);
                    request.allowScanningByMediaScanner();
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(request);
                        Toast.makeText(MainActivity.this, "Downloading: " + fileName, Toast.LENGTH_LONG).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Download error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void handleIncomingIntent(Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        String type = intent != null ? intent.getType() : null;

        String targetUrl = getServerUrl();

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText != null) {
                String extractedUrl = extractUrl(sharedText);
                if (extractedUrl != null) {
                    try {
                        String encodedUrl = URLEncoder.encode(extractedUrl, "UTF-8");
                        targetUrl += "/?url=" + encodedUrl;
                    } catch (UnsupportedEncodingException ignored) {
                        targetUrl += "/?url=" + extractedUrl;
                    }
                }
            }
        }

        webView.loadUrl(targetUrl);
    }

    private String extractUrl(String text) {
        Pattern pattern = Pattern.compile("(https?://\\S+)");
        Matcher matcher = pattern.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return null;
    }

    private String getServerUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        return prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
    }

    public void setServerUrl(String url) {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit();
        editor.putString(KEY_SERVER_URL, url);
        editor.apply();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
