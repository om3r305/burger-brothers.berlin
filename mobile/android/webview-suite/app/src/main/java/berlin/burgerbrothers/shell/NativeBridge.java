package berlin.burgerbrothers.shell;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.Arrays;
import java.util.HashSet;
import org.json.JSONObject;

/** Origin-scoped main-frame messages, not a reflection-based JavascriptInterface. */
final class NativeBridge {
    static final int NOTIFICATIONS=23, TRACKING_LOCATION=24;
    private final MainActivity activity;
    private final WebView web;
    private JSONObject pendingRoute;
    private boolean askingRoute;
    NativeBridge(MainActivity activity,WebView web) {
        this.activity=activity;this.web=web;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(web,"BBAndroid",new HashSet<>(Arrays.asList("https://www.burger-brothers.berlin","https://burger-brothers.berlin")),(view,message,origin,mainFrame,reply)->{
            if (!mainFrame || !NavigationPolicy.trusted(origin.toString()) || !NavigationPolicy.trusted(web.getUrl())) return;
            String data=message.getData(); if(data==null || data.length()>16000)return;
            try {
                JSONObject input=new JSONObject(data);
                String action=input.optString("action");
                if ("requestNotifications".equals(action)) requestNotifications();
                else if ("refresh".equals(action)) publishState();
                else if ("driverRoute".equals(action) && "driver".equals(BuildConfig.APP_KIND) && ("/driver".equals(Uri.parse(web.getUrl()).getPath()) || Uri.parse(web.getUrl()).getPath().startsWith("/driver/"))) configureRoute(input);
            } catch (Exception ignored) { }
        });
    }
    private boolean trusted() { return !activity.isFinishing() && NavigationPolicy.trusted(web.getUrl()); }
    private void event(String name,JSONObject value) {
        if (!trusted()) return;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent("+JSONObject.quote(name)+",{detail:"+value.toString()+"}))",null);
    }
    void publishState() {
        if (!trusted() || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        boolean allowed=Notifications.permitted(activity);
        String permission=allowed?"granted":activity.getPreferences(0).getBoolean("notificationAsked",false)?"denied":"default";
        String token=allowed?activity.getSharedPreferences("native",0).getString("pushToken",""):"";
        String script="(()=>{if(!window.BBAndroid)return;const send=(action,params={})=>BBAndroid.postMessage(JSON.stringify({...params,action})); window.BurgerBrothersNative={platform:'android',appKind:"+JSONObject.quote(BuildConfig.APP_KIND)+",permission:"+JSONObject.quote(permission)+",pushToken:"+JSONObject.quote(token)+",requestNotifications:()=>send('requestNotifications'),updateDriverRoute:params=>send('driverRoute',params),refresh:()=>send('refresh')};window.dispatchEvent(new CustomEvent('bb:nativeReady'));})()";
        web.evaluateJavascript(script,null);
        if (allowed && !FirebaseApp.getApps(activity).isEmpty()) {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(value->{
                activity.getSharedPreferences("native",0).edit().putString("pushToken",value).apply();
                if (!trusted())return;
                web.evaluateJavascript("if(window.BurgerBrothersNative)window.BurgerBrothersNative.pushToken="+JSONObject.quote(value),null);
                try {event("bb:nativePushToken",new JSONObject().put("token",value));}catch(Exception ignored){}
            });
        }
    }
    void resumed() {
        try {event("bb:nativeResume",new JSONObject());}catch(Exception ignored){}
    }
    void requestNotifications() {
        if (!activity.resumed || !trusted())return;
        if (FirebaseApp.getApps(activity).isEmpty()) {
            Toast.makeText(activity,"Der Benachrichtigungsdienst ist noch nicht eingerichtet.",Toast.LENGTH_LONG).show();
            notificationResult();return;
        }
        activity.getPreferences(0).edit().putBoolean("notificationAsked",true).apply();
        if(Build.VERSION.SDK_INT>=33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
            activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFICATIONS);
        else notificationResult();
    }
    void notificationResult() {
        publishState();
        try {event("bb:nativePushPermission",new JSONObject().put("granted",Notifications.permitted(activity)));}catch(Exception ignored){}
    }
    private void configureRoute(JSONObject input) {
        if (!input.optBoolean("active")) {
            activity.getSharedPreferences("native",0).edit().remove("trackingDeclined").apply();
            activity.stopService(new Intent().setClassName(activity,"berlin.burgerbrothers.shell.DriverRouteService"));
            pendingRoute=null;return;
        }
        if (!activity.resumed || askingRoute || activity.getSharedPreferences("native",0).getBoolean("trackingDeclined",false)) return;
        pendingRoute=input;
        if (DriverRuntime.running) { startRoute();return; }
        askingRoute=true;
        new AlertDialog.Builder(activity).setTitle("Live-Standort bei Lieferungen")
            .setMessage("Während Ihrer aktiven Lieferung wird Ihr Standort auch bei gesperrtem Bildschirm an Burger Brothers übertragen. Eine dauerhafte Benachrichtigung zeigt die Übertragung und bietet Stopp. Nach der letzten Lieferung endet sie automatisch.")
            .setPositiveButton("Für aktive Lieferung starten",(d,w)->{askingRoute=false;
                if(activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED && activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)
                    activity.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},TRACKING_LOCATION);
                else startRoute();})
            .setNegativeButton("Nicht jetzt",(d,w)->declineRoute()).setOnCancelListener(d->declineRoute()).show();
    }
    private void declineRoute() { askingRoute=false;pendingRoute=null;activity.getSharedPreferences("native",0).edit().putBoolean("trackingDeclined",true).apply();trackingError(); }
    void locationResult() {
        if(activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED || activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)startRoute();
        else declineRoute();
    }
    private void trackingError() { try { event("bb:nativeTracking",new JSONObject().put("status","error").put("active",false).put("message","Live-Standort wurde nicht gestartet. Bitte Freigabe prüfen.")); }catch(Exception ignored){} }
    private void startRoute() {
        if(pendingRoute==null || !activity.resumed || !trusted())return;
        String cookies=CookieManager.getInstance().getCookie("https://www.burger-brothers.berlin");
        String session="";
        if(cookies!=null)for(String cookie:cookies.split(";"))if(cookie.trim().startsWith("bb_driver_sess="))session=cookie.trim();
        if(session.isEmpty()){trackingError();return;}
        try {
            Intent intent=new Intent().setClassName(activity,"berlin.burgerbrothers.shell.DriverRouteService").putExtra("cookie",session);
            activity.startForegroundService(intent);
        } catch(Exception error) {trackingError();}
        pendingRoute=null;
    }
}
