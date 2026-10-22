package com.crystalclear.watermarkremover;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int PERMISSION_REQUEST_CODE = 2001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        requestAppPermissions();
        configureWebView();

        // Load offline standalone single-file inpainter from assets
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Hardware Acceleration for Ultra-Fast GPU Canvas rendering
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);

        // Native Android Bridge for chunked streaming save to Gallery & Downloads
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d("CrystalClearJS", consoleMessage.message() + " -- Line "
                        + consoleMessage.lineNumber() + " of "
                        + consoleMessage.sourceId());
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                result.confirm();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                result.confirm();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                              FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("video/*");
                startActivityForResult(Intent.createChooser(intent, "Select Video to Clean"), FILE_CHOOSER_REQUEST_CODE);
                return true;
            }
        });
    }

    /**
     * Native Android Bridge accessible from JavaScript:
     * Provides chunked streaming to write videos directly to Gallery & Downloads
     * without hitting Android Binder / IPC message size limits.
     */
    public class AndroidBridge {
        private File tempSaveFile = null;
        private FileOutputStream tempSaveFos = null;
        private String pendingFilename = null;
        private String pendingMimeType = null;

        @JavascriptInterface
        public boolean isAndroidApp() {
            return true;
        }

        private synchronized boolean initSaveInternal(final String filename, final String mimeType) {
            try {
                cleanupTemp();
                String cleanName = (filename != null && !filename.trim().isEmpty())
                        ? filename.trim().replaceAll("[\\\\/:*?\"<>|]", "_")
                        : "crystal_clear_" + System.currentTimeMillis() + ".mp4";

                if (!cleanName.endsWith(".mp4") && !cleanName.endsWith(".webm")) {
                    cleanName += ".mp4";
                }

                String cleanMime = (mimeType != null) ? mimeType.trim() : "";
                if (cleanMime.contains(";")) {
                    cleanMime = cleanMime.substring(0, cleanMime.indexOf(";")).trim();
                }
                if (cleanMime.isEmpty() || cleanMime.equals("application/octet-stream")) {
                    cleanMime = cleanName.endsWith(".webm") ? "video/webm" : "video/mp4";
                }

                pendingFilename = cleanName;
                pendingMimeType = cleanMime;

                File cacheDir = getCacheDir();
                tempSaveFile = new File(cacheDir, "temp_stream_" + System.currentTimeMillis() + "_" + cleanName);
                tempSaveFos = new FileOutputStream(tempSaveFile);
                Log.d("CrystalClear", "startSave initialized: " + cleanName + " (" + cleanMime + ")");
                return true;
            } catch (Exception e) {
                Log.e("CrystalClear", "startSave error", e);
                showToast("Failed to initialize save: " + e.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public boolean startSave(final String filename, final String mimeType) {
            return initSaveInternal(filename, mimeType);
        }

        @JavascriptInterface
        public boolean startSave(final String filename, final String mimeType, final double totalBytes) {
            return initSaveInternal(filename, mimeType);
        }

        @JavascriptInterface
        public boolean startSave(final String filename, final String mimeType, final int totalBytes) {
            return initSaveInternal(filename, mimeType);
        }

        @JavascriptInterface
        public boolean startSave(final String filename, final String mimeType, final String totalBytes) {
            return initSaveInternal(filename, mimeType);
        }

        @JavascriptInterface
        public synchronized boolean appendChunk(final String base64Chunk) {
            try {
                if (tempSaveFos == null || base64Chunk == null || base64Chunk.isEmpty()) {
                    Log.w("CrystalClear", "appendChunk received null/empty or null stream");
                    return false;
                }
                byte[] chunk = Base64.decode(base64Chunk, Base64.DEFAULT);
                tempSaveFos.write(chunk);
                return true;
            } catch (Exception e) {
                Log.e("CrystalClear", "appendChunk error", e);
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean finishSave() {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (tempSaveFos != null) {
                            tempSaveFos.flush();
                            tempSaveFos.close();
                            tempSaveFos = null;
                        }

                        if (tempSaveFile == null || !tempSaveFile.exists() || tempSaveFile.length() == 0) {
                            showToast("Download error: No video data received.");
                            return;
                        }

                        final String saveName = pendingFilename;
                        final String saveMime = pendingMimeType;
                        final File sourceFile = tempSaveFile;

                        Log.d("CrystalClear", "finishSave exporting file: " + sourceFile.length() + " bytes as " + saveName);
                        boolean saved = exportVideoToGalleryAndDownloads(sourceFile, saveName, saveMime);
                        if (saved) {
                            showToast("🎉 Video saved to Gallery & Downloads!");
                        } else {
                            showToast("⚠️ Could not write to storage. Check app permissions.");
                        }
                    } catch (Exception e) {
                        Log.e("CrystalClear", "finishSave error", e);
                        showToast("Download error: " + e.getMessage());
                    } finally {
                        cleanupTemp();
                    }
                }
            }).start();
            return true;
        }

        @JavascriptInterface
        public void cancelSave() {
            cleanupTemp();
        }

        private synchronized void cleanupTemp() {
            try {
                if (tempSaveFos != null) {
                    tempSaveFos.close();
                    tempSaveFos = null;
                }
                if (tempSaveFile != null && tempSaveFile.exists()) {
                    tempSaveFile.delete();
                    tempSaveFile = null;
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void saveVideoBase64(final String base64Data, final String filename, final String mimeType) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    File cacheFile = null;
                    try {
                        byte[] videoBytes = Base64.decode(base64Data, Base64.DEFAULT);
                        String cleanName = (filename != null && !filename.trim().isEmpty())
                                ? filename.trim().replaceAll("[\\\\/:*?\"<>|]", "_")
                                : "crystal_clear_" + System.currentTimeMillis() + ".mp4";
                        String cleanMime = (mimeType != null) ? mimeType.trim() : "";
                        if (cleanMime.contains(";")) {
                            cleanMime = cleanMime.substring(0, cleanMime.indexOf(";")).trim();
                        }
                        if (cleanMime.isEmpty()) {
                            cleanMime = cleanName.endsWith(".webm") ? "video/webm" : "video/mp4";
                        }

                        cacheFile = new File(getCacheDir(), "legacy_" + cleanName);
                        FileOutputStream fos = new FileOutputStream(cacheFile);
                        fos.write(videoBytes);
                        fos.flush();
                        fos.close();

                        boolean ok = exportVideoToGalleryAndDownloads(cacheFile, cleanName, cleanMime);
                        if (ok) {
                            showToast("🎉 Video saved to Gallery & Downloads!");
                        } else {
                            showToast("⚠️ Save error. Check storage permissions.");
                        }
                    } catch (Exception e) {
                        Log.e("CrystalClear", "saveVideoBase64 error", e);
                        showToast("Download error: " + e.getMessage());
                    } finally {
                        if (cacheFile != null && cacheFile.exists()) {
                            cacheFile.delete();
                        }
                    }
                }
            }).start();
        }
    }

    private boolean exportVideoToGalleryAndDownloads(File sourceFile, String filename, String mimeType) {
        boolean savedAny = false;

        // 1. Android 10+ (API 29+) Scoped Storage via MediaStore
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Save to MediaStore Video (Movies / Gallery)
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Video.Media.DISPLAY_NAME, filename);
                values.put(MediaStore.Video.Media.MIME_TYPE, mimeType);
                values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/CrystalClear");
                values.put(MediaStore.Video.Media.IS_PENDING, 1);

                ContentResolver resolver = getContentResolver();
                Uri uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES);
                    uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                }

                if (uri != null) {
                    try (InputStream in = new FileInputStream(sourceFile);
                         OutputStream out = resolver.openOutputStream(uri)) {
                        copyStream(in, out);
                    }
                    values.clear();
                    values.put(MediaStore.Video.Media.IS_PENDING, 0);
                    resolver.update(uri, values, null, null);
                    savedAny = true;
                    Log.d("CrystalClear", "Saved to MediaStore Video: " + uri);
                }
            } catch (Exception e) {
                Log.e("CrystalClear", "MediaStore Video insert failed", e);
            }

            // Also save a copy to MediaStore Downloads folder
            try {
                ContentValues dlValues = new ContentValues();
                dlValues.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                dlValues.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                dlValues.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/CrystalClear");
                dlValues.put(MediaStore.Downloads.IS_PENDING, 1);

                ContentResolver resolver = getContentResolver();
                Uri dlUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, dlValues);
                if (dlUri == null) {
                    dlValues.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    dlUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, dlValues);
                }

                if (dlUri != null) {
                    try (InputStream in = new FileInputStream(sourceFile);
                         OutputStream out = resolver.openOutputStream(dlUri)) {
                        copyStream(in, out);
                    }
                    dlValues.clear();
                    dlValues.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver.update(dlUri, dlValues, null, null);
                    savedAny = true;
                    Log.d("CrystalClear", "Saved to MediaStore Downloads: " + dlUri);
                }
            } catch (Exception e) {
                Log.e("CrystalClear", "MediaStore Downloads insert failed", e);
            }
        }

        // 2. Direct File writing for Android 9 and lower, or if MediaStore above failed
        if (!savedAny) {
            try {
                File moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                File appMoviesDir = new File(moviesDir, "CrystalClear");
                if (!appMoviesDir.exists()) appMoviesDir.mkdirs();
                File targetMovie = new File(appMoviesDir, filename);
                copyFile(sourceFile, targetMovie);

                File dlDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File appDlDir = new File(dlDir, "CrystalClear");
                if (!appDlDir.exists()) appDlDir.mkdirs();
                File targetDl = new File(appDlDir, filename);
                copyFile(sourceFile, targetDl);

                MediaScannerConnection.scanFile(
                        MainActivity.this,
                        new String[]{targetMovie.getAbsolutePath(), targetDl.getAbsolutePath()},
                        new String[]{mimeType, mimeType},
                        null
                );
                savedAny = true;
                Log.d("CrystalClear", "Saved via direct File writing: " + targetMovie.getAbsolutePath());
            } catch (Exception e) {
                Log.e("CrystalClear", "Direct file save failed", e);
            }
        }

        // 3. Fallback to app external files dir (always writable on all Android versions)
        if (!savedAny) {
            try {
                File extDir = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                if (extDir != null) {
                    File target = new File(extDir, filename);
                    copyFile(sourceFile, target);
                    MediaScannerConnection.scanFile(
                            MainActivity.this,
                            new String[]{target.getAbsolutePath()},
                            new String[]{mimeType},
                            null
                    );
                    savedAny = true;
                    Log.d("CrystalClear", "Saved via getExternalFilesDir: " + target.getAbsolutePath());
                }
            } catch (Exception e) {
                Log.e("CrystalClear", "App external files save failed", e);
            }
        }

        return savedAny;
    }

    private void copyStream(InputStream in, OutputStream out) throws java.io.IOException {
        byte[] buf = new byte[65536];
        int len;
        while ((len = in.read(buf)) > 0) {
            out.write(buf, 0, len);
        }
        out.flush();
    }

    private void copyFile(File src, File dst) throws java.io.IOException {
        try (InputStream in = new FileInputStream(src);
             OutputStream out = new FileOutputStream(dst)) {
            copyStream(in, out);
        }
    }

    private void showToast(final String message) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                } else if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    private void requestAppPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.READ_MEDIA_VIDEO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.READ_MEDIA_VIDEO}, PERMISSION_REQUEST_CODE);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean readGranted = checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
            boolean writeGranted = checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
            if (!readGranted || !writeGranted) {
                requestPermissions(new String[]{
                        android.Manifest.permission.READ_EXTERNAL_STORAGE,
                        android.Manifest.permission.WRITE_EXTERNAL_STORAGE
                }, PERMISSION_REQUEST_CODE);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
