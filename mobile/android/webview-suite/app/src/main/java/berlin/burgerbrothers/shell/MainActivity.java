package berlin.burgerbrothers.shell;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/** Native host for first-party HTTPS content. No Custom Tabs, TWA, or JS bridge. */
public final class MainActivity extends Activity {
    private static final int CAMERA = 20, LOCATION = 21, FILE_PICKER = 22;
    private WebView web;
    private LinearLayout errorPanel;
    private TextView errorText;
    private ProgressBar progress;
    private PermissionRequest cameraRequest;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private ValueCallback<Uri[]> fileCallback;
    private String lastTrustedUrl = BuildConfig.START_URL;
    private boolean backPending;
    boolean resumed;
    private NativeBridge nativeBridge;
    private final android.content.BroadcastReceiver trackingReceiver = new android.content.BroadcastReceiver() {
        @Override public void onReceive(android.content.Context context,Intent intent) {
            if(!NavigationPolicy.trusted(web.getUrl()))return;
            try {
                org.json.JSONObject value=new org.json.JSONObject().put("status",intent.getStringExtra("status")).put("active",intent.getBooleanExtra("active",false));
                if(intent.hasExtra("lat"))value.put("position",new org.json.JSONObject().put("lat",intent.getDoubleExtra("lat",0)).put("lng",intent.getDoubleExtra("lng",0)).put("ts",intent.getLongExtra("ts",0)));
                if(intent.hasExtra("message"))value.put("message",intent.getStringExtra("message"));
                web.evaluateJavascript("window.dispatchEvent(new CustomEvent('bb:nativeTracking',{detail:"+value+"}))",null);
            }catch(Exception ignored){}
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(getColor(R.color.app_background));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(-1, 6));
        errorPanel = new LinearLayout(this);
        errorPanel.setPadding(32, 40, 32, 40);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorText = new TextView(this);
        errorText.setTextColor(Color.WHITE);
        errorText.setTextSize(18);
        errorPanel.addView(errorText);
        Button retry = new Button(this);
        retry.setText("Erneut versuchen");
        retry.setOnClickListener(v -> loadTrusted(lastTrustedUrl));
        errorPanel.addView(retry);
        root.addView(errorPanel);
        errorPanel.setVisibility(View.GONE);
        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return insets;
            });
        } else root.setFitsSystemWindows(true);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " BurgerBrothers-Android/" + BuildConfig.APP_KIND);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        nativeBridge = new NativeBridge(this,web);
        android.content.IntentFilter trackingFilter=new android.content.IntentFilter("berlin.burgerbrothers.TRACKING_STATE");
        androidx.core.content.ContextCompat.registerReceiver(this,trackingReceiver,trackingFilter,androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
        web.setWebViewClient(new SiteClient());
        web.setWebChromeClient(new SiteChrome());
        String incoming = getIntent().getDataString();
        if (incoming == null && getIntent().hasExtra("url")) incoming = Notifications.safeUrl(getIntent().getStringExtra("url"));
        if (incoming != null && NavigationPolicy.trusted(incoming)) loadTrusted(incoming);
        else if (state == null || web.restoreState(state) == null || !NavigationPolicy.trusted(web.getUrl())) loadTrusted(BuildConfig.START_URL);
    }

    private void loadTrusted(String url) {
        if (!NavigationPolicy.trusted(url)) return;
        lastTrustedUrl = url;
        errorPanel.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(url);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent.getDataString();
        if(url == null && intent.hasExtra("url"))url = Notifications.safeUrl(intent.getStringExtra("url"));
        if (NavigationPolicy.trusted(url)) loadTrusted(url);
    }

    private boolean navigate(String url, boolean userGesture) {
        NavigationPolicy.Target target = NavigationPolicy.target(url);
        if (target == NavigationPolicy.Target.INTERNAL) return false;
        // Allow HTTPS payment redirects to the system browser; block automatic tel/mail launches.
        if (target == NavigationPolicy.Target.EXTERNAL && (url.startsWith("https://") || userGesture)) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                startActivity(intent);
            } catch (ActivityNotFoundException ignored) {
                Toast.makeText(this, "Keine passende App gefunden.", Toast.LENGTH_SHORT).show();
            }
        }
        return true;
    }

    private void showError(String text) {
        progress.setVisibility(View.GONE);
        web.setVisibility(View.GONE);
        errorText.setText(text);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private final class SiteClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request.isForMainFrame() && navigate(request.getUrl().toString(), request.hasGesture());
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            if (!NavigationPolicy.trusted(url)) { view.stopLoading(); showError("Diese Seite kann nicht in der App geöffnet werden."); return; }
            lastTrustedUrl = url;
            progress.setVisibility(View.VISIBLE);
        }
        @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); nativeBridge.publishState(); }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showError("Die Seite konnte nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung.");
        }
        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            showError("Die sichere Verbindung konnte nicht bestätigt werden.");
        }
    }

    private final class SiteChrome extends WebChromeClient {
        @Override public void onProgressChanged(WebView view, int value) {
            progress.setProgress(value);
            progress.setVisibility(value < 100 && errorPanel.getVisibility() != View.VISIBLE ? View.VISIBLE : View.GONE);
        }
        @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            if (!NavigationPolicy.trusted(url)) { result.cancel(); return true; }
            new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK", (d, w) -> result.confirm())
                .setOnCancelListener(d -> result.cancel()).show();
            return true;
        }
        @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            if (!NavigationPolicy.trusted(url)) { result.cancel(); return true; }
            new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK", (d, w) -> result.confirm())
                .setNegativeButton("Abbrechen", (d, w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show();
            return true;
        }
        @Override public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!NavigationPolicy.trusted(request.getOrigin().toString()) || !NavigationPolicy.trusted(web.getUrl())
                    || request.getResources().length != 1 || !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(request.getResources()[0])
                    || cameraRequest != null) { request.deny(); return; }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) request.grant(request.getResources());
                else { cameraRequest = request; requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA); }
            });
        }
        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            if (cameraRequest == request) cameraRequest = null;
        }
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!NavigationPolicy.trusted(origin) || !NavigationPolicy.trusted(web.getUrl()) || locationCallback != null) { callback.invoke(origin, false, false); return; }
            if (hasLocation()) callback.invoke(origin, true, false);
            else { locationOrigin = origin; locationCallback = callback; requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION); }
        }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!NavigationPolicy.trusted(web.getUrl())) return false;
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try { startActivityForResult(params.createIntent(), FILE_PICKER); }
            catch (ActivityNotFoundException ignored) { callback.onReceiveValue(null); fileCallback = null; }
            return true;
        }
        @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
            if (!userGesture || !NavigationPolicy.trusted(web.getUrl())) return false;
            WebView popup = new WebView(MainActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    if (NavigationPolicy.trusted(url)) loadTrusted(url); else navigate(url, true);
                    child.post(child::destroy);
                    return true;
                }
            });
            ((WebView.WebViewTransport) result.obj).setWebView(popup);
            result.sendToTarget();
            return true;
        }
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if(code == NativeBridge.NOTIFICATIONS) nativeBridge.notificationResult();
        if(code == NativeBridge.TRACKING_LOCATION) nativeBridge.locationResult();
        if (code == CAMERA && cameraRequest != null) {
            if (NavigationPolicy.trusted(web.getUrl()) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) cameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else cameraRequest.deny();
            cameraRequest = null;
        }
        if (code == LOCATION && locationCallback != null) {
            locationCallback.invoke(locationOrigin, NavigationPolicy.trusted(web.getUrl()) && hasLocation(), false);
            locationCallback = null;
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_PICKER && fileCallback != null) {
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(result, data);
            if (!NavigationPolicy.trusted(web.getUrl())) selected = null;
            if (selected != null) {
                for (Uri uri : selected) {
                    if (uri == null || !"content".equals(uri.getScheme())) { selected = null; break; }
                }
            }
            fileCallback.onReceiveValue(selected);
            fileCallback = null;
        }
    }
    private void handleBack() {
        if (backPending) return;
        if (!NavigationPolicy.trusted(web.getUrl())) { finish(); return; }
        backPending = true;
        web.evaluateJavascript("(() => { const dialogs = [...document.querySelectorAll('[role=dialog]')].filter(e => e.getClientRects().length); const dialog = dialogs[dialogs.length - 1]; if (!dialog) return false; const button = [...dialog.querySelectorAll('button')].find(b => /^(Schließen|Abbrechen|Erst Menü ansehen)$/.test(b.textContent.trim())); if (button) { button.click(); return true; } window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); return false; })()", value -> {
            backPending = false;
            if ("true".equals(value)) return;
            if (web.canGoBack()) web.goBack(); else finish();
        });
    }
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onSaveInstanceState(Bundle out) { web.saveState(out); super.onSaveInstanceState(out); }
    @Override protected void onPause() { resumed=false; web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); resumed=true; if (web != null) {web.onResume(); if(nativeBridge!=null)nativeBridge.publishState();} }
    @Override protected void onDestroy() {
        if (cameraRequest != null) cameraRequest.deny();
        if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        unregisterReceiver(trackingReceiver);
        web.stopLoading(); web.destroy();
        super.onDestroy();
    }
}
