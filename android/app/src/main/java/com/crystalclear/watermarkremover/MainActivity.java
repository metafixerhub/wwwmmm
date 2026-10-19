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
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
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
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Hardware Acceleration for Ultra-Fast GPU Canvas rendering
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);

        // Native Android Bridge for direct saving to Gallery / Photos
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
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
     * Saves processed video bytes directly to the phone's public Movies / Gallery folder.
     */
    public class AndroidBridge {
        @JavascriptInterface
        public boolean isAndroidApp() {
            return true;
        }

        @JavascriptInterface
        public void saveVideoBase64(final String base64Data, final String filename, final String mimeType) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        byte[] videoBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                        String cleanFilename = (filename != null && !filename.trim().isEmpty()) ? filename : "crystal_clear_" + System.currentTimeMillis() + ".mp4";
                        String cleanMime = (mimeType != null && !mimeType.trim().isEmpty()) ? mimeType : "video/mp4";

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            android.content.ContentValues values = new android.content.ContentValues();
                            values.put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, cleanFilename);
                            values.put(android.provider.MediaStore.Video.Media.MIME_TYPE, cleanMime);
                            values.put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, android.os.Environment.DIRECTORY_MOVIES + "/CrystalClear");
                            values.put(android.provider.MediaStore.Video.Media.IS_PENDING, 1);

                            android.content.ContentResolver resolver = getContentResolver();
                            Uri collection = android.provider.MediaStore.Video.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY);
                            Uri itemUri = resolver.insert(collection, values);

                            if (itemUri != null) {
                                java.io.OutputStream os = resolver.openOutputStream(itemUri);
                                if (os != null) {
                                    os.write(videoBytes);
                                    os.flush();
                                    os.close();
                                }
                                values.clear();
                                values.put(android.provider.MediaStore.Video.Media.IS_PENDING, 0);
                                resolver.update(itemUri, values, null, null);

                                android.widget.Toast.makeText(MainActivity.this, "🎉 Video saved to Gallery / Movies!", android.widget.Toast.LENGTH_LONG).show();
                            }
                        } else {
                            java.io.File moviesDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_MOVIES);
                            java.io.File appDir = new java.io.File(moviesDir, "CrystalClear");
                            if (!appDir.exists()) appDir.mkdirs();
                            java.io.File outFile = new java.io.File(appDir, cleanFilename);

                            java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile);
                            fos.write(videoBytes);
                            fos.flush();
                            fos.close();

                            android.media.MediaScannerConnection.scanFile(
                                MainActivity.this,
                                new String[]{outFile.getAbsolutePath()},
                                new String[]{cleanMime},
                                null
                            );
                            android.widget.Toast.makeText(MainActivity.this, "🎉 Video saved to Gallery: " + outFile.getName(), android.widget.Toast.LENGTH_LONG).show();
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                        android.widget.Toast.makeText(MainActivity.this, "Download error: " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show();
                    }
                }
            });
        }
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
            if (checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.READ_EXTERNAL_STORAGE, android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, PERMISSION_REQUEST_CODE);
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
