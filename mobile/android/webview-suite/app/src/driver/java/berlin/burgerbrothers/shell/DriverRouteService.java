package berlin.burgerbrothers.shell;

import android.Manifest;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** User-started, visible, route-scoped location service. No boot receiver or silent restart. */
public final class DriverRouteService extends Service implements LocationListener {
    static final String STOP="berlin.burgerbrothers.STOP_TRACKING";
    interface Backend { JSONObject getRoute(String cookie) throws Exception; void post(String path,String cookie,JSONObject body) throws Exception; }
    static final class HttpFailure extends Exception { final int status;HttpFailure(int status){super("HTTP_"+status);this.status=status;} }
    // Package-private instrumentation seam, never accepted from intents or web messages.
    static Backend testBackend;
    static Location testLocation;
    static long testIntervalMs;
    private ScheduledExecutorService worker;
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile Location lastLocation;
    private volatile String cookie="";
    private LocationManager locations;
    private boolean listening;
    private volatile boolean stopping;
    private final Object lifecycleLock=new Object();
    private long lastSuccess;
    private long startedAt;
    private Backend backend;
    private String driverId="";
    private String sessionId="";
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onCreate(){super.onCreate();worker=Executors.newSingleThreadScheduledExecutor();locations=getSystemService(LocationManager.class);backend=BuildConfig.DEBUG && testBackend!=null?testBackend:new HttpBackend();}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(!"driver".equals(BuildConfig.APP_KIND)){stopSelf();return START_NOT_STICKY;}
        if(intent==null || STOP.equals(intent.getAction())){
            if(intent!=null)getSharedPreferences("native",MODE_PRIVATE).edit().putBoolean("trackingDeclined",true).apply();
            stopRoute("Live-Standort beendet.");return START_NOT_STICKY;
        }
        String incoming=intent.getStringExtra("cookie");
        if(incoming==null || !incoming.startsWith("bb_driver_sess=") || incoming.length()>8192 || incoming.contains("\r") || incoming.contains("\n")){stopSelf();return START_NOT_STICKY;}
        cookie=incoming;
        if(DriverRuntime.running)return START_NOT_STICKY;
        if(checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){stopRoute("Standortfreigabe fehlt.");return START_NOT_STICKY;}
        startForeground(410,notice("Aktive Lieferung wird geprüft …"));
        DriverRuntime.running=true;startedAt=SystemClock.elapsedRealtime();lastSuccess=startedAt;
        long interval=BuildConfig.DEBUG && testIntervalMs>0?testIntervalMs:15000;
        worker.scheduleWithFixedDelay(this::tick,0,interval,TimeUnit.MILLISECONDS);
        return START_NOT_STICKY;
    }
    private Notification notice(String text){
        Intent stop=new Intent(this,DriverRouteService.class).setAction(STOP);
        PendingIntent action=PendingIntent.getService(this,411,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,"bb_tracking").setSmallIcon(R.drawable.ic_notification).setContentTitle("BB Driver · Live-Standort")
            .setContentText(text).setOngoing(true).setContentIntent(Notifications.open(this,"/driver",410))
            .addAction(new Notification.Action.Builder(null,"Stopp",action).build()).build();
    }
    private void updateNotice(String text){getSystemService(android.app.NotificationManager.class).notify(410,notice(text));}
    private void tick(){
        if(stopping)return;
        try {
            if(SystemClock.elapsedRealtime()-startedAt>12*60*60*1000L){stopRoute("Fahrtzeit abgelaufen. Bitte in der App erneut starten.");return;}
            JSONObject route=backend.getRoute(cookie);
            String nextDriver=route.optString("driverId");JSONArray ids=route.optJSONArray("orderIds");
            if(!route.optBoolean("ok") || nextDriver.isEmpty() || ids==null || ids.length()==0 || ids.length()>20){stopRoute("Keine aktive Lieferung. Live-Standort beendet.");return;}
            if(!driverId.isEmpty() && !driverId.equals(nextDriver)){stopRoute("Fahrer-Anmeldung wurde geändert.");return;}
            driverId=nextDriver;
            java.text.SimpleDateFormat date=new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.ROOT);date.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
            sessionId="driver_"+date.format(new java.util.Date())+"_"+driverId.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9_-]","-").substring(0,Math.min(64,driverId.length()));
            lastSuccess=SystemClock.elapsedRealtime();
            main.post(this::listen);
            Location position=BuildConfig.DEBUG && testLocation!=null?testLocation:lastLocation;
            if(position==null || (!BuildConfig.DEBUG || testLocation==null) && SystemClock.elapsedRealtimeNanos()-position.getElapsedRealtimeNanos()>45_000_000_000L){updateNotice("Standort wird gesucht …");state("starting",null,null);return;}
            JSONObject body=new JSONObject().put("active",true).put("driverId",driverId).put("orderIds",ids).put("lat",position.getLatitude()).put("lng",position.getLongitude());
            synchronized(lifecycleLock){
                if(stopping)return;
                backend.post("/api/track/"+sessionId,cookie,body);
            }
            if(stopping)return;
            updateNotice("Live-Standort aktiv · "+ids.length()+" Lieferung(en)");
            state("live",position,null);
        }catch(HttpFailure error){
            if(error.status==401 || error.status==403 || error.status==404){stopRoute("Anmeldung oder aktive Lieferung nicht bestätigt. Bitte App öffnen.");return;}
            connectionProblem();
        }catch(Exception ignored){connectionProblem();}
    }
    private void connectionProblem(){
        if(stopping)return;
        updateNotice("Verbindung unterbrochen · erneuter Versuch …");state("error",null,"Live-Standort konnte nicht übertragen werden.");
        if(SystemClock.elapsedRealtime()-lastSuccess>5*60_000)stopRoute("Verbindung zu lange unterbrochen. Bitte App öffnen.");
    }
    private void listen(){
        if(stopping || listening || BuildConfig.DEBUG && testLocation!=null)return;
        try{
            if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED && locations.isProviderEnabled(LocationManager.GPS_PROVIDER))locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,5000,5,this,Looper.getMainLooper());
            if(locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,5000,5,this,Looper.getMainLooper());
            listening=true;
        }catch(SecurityException denied){stopRoute("Standortfreigabe wurde entzogen.");}
    }
    private void state(String status,Location position,String message){
        Intent event=new Intent("berlin.burgerbrothers.TRACKING_STATE").setPackage(getPackageName()).putExtra("status",status).putExtra("active",!stopping);
        if(position!=null)event.putExtra("lat",position.getLatitude()).putExtra("lng",position.getLongitude()).putExtra("ts",System.currentTimeMillis());
        if(message!=null)event.putExtra("message",message);sendBroadcast(event);
    }
    private void stopRoute(String message){
        synchronized(lifecycleLock){if(stopping)return;stopping=true;DriverRuntime.running=false;}
        queueBackendStop();
        main.post(()->{try{locations.removeUpdates(this);}catch(Exception ignored){}stopForeground(STOP_FOREGROUND_REMOVE);state("inactive",null,message);stopSelf();});
    }
    private void queueBackendStop(){
        final String stopCookie=cookie;
        if(!stopCookie.isEmpty() && worker!=null && !worker.isShutdown())worker.execute(()->{try{backend.post("/api/native/driver/route",stopCookie,new JSONObject().put("active",false));}catch(Exception ignored){} });
    }
    @Override public void onLocationChanged(Location location){lastLocation=new Location(location);}
    @Override public void onProviderEnabled(String provider){}
    @Override public void onProviderDisabled(String provider){updateNotice("Standortdienst deaktiviert. Bitte GPS prüfen.");}
    @Override public void onStatusChanged(String provider,int status,Bundle extras){}
    @Override public void onDestroy(){
        synchronized(lifecycleLock){
            if(!stopping){stopping=true;queueBackendStop();}
            DriverRuntime.running=false;
        }
        try{locations.removeUpdates(this);}catch(Exception ignored){}
        if(worker!=null)worker.shutdown();stopForeground(STOP_FOREGROUND_REMOVE);cookie="";super.onDestroy();
    }
    static final class HttpBackend implements Backend {
        private JSONObject request(String path,String cookie,JSONObject body)throws Exception{
            if(!path.startsWith("/api/track/") && !path.equals("/api/native/driver/route"))throw new IllegalArgumentException("invalid_path");
            HttpURLConnection connection=(HttpURLConnection)new URL("https://www.burger-brothers.berlin"+path).openConnection();
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(6000);connection.setReadTimeout(6000);
            connection.setRequestProperty("Cookie",cookie);connection.setRequestProperty("Origin","https://www.burger-brothers.berlin");connection.setRequestProperty("Accept","application/json");
            try{
                if(body!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(java.io.OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
                int status=connection.getResponseCode();if(status<200 || status>=300)throw new HttpFailure(status);
                try(InputStream input=connection.getInputStream();java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream()){
                    byte[] block=new byte[4096];int count;while((count=input.read(block))!=-1){output.write(block,0,count);if(output.size()>65536)throw new IllegalStateException("response_too_large");}
                    return new JSONObject(output.toString("UTF-8"));
                }
            }finally{connection.disconnect();}
        }
        public JSONObject getRoute(String cookie)throws Exception{return request("/api/native/driver/route",cookie,null);}
        public void post(String path,String cookie,JSONObject body)throws Exception{request(path,cookie,body);}
    }
}
