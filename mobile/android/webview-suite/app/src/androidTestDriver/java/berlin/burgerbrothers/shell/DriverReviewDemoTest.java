package berlin.burgerbrothers.shell;

import android.app.Instrumentation;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiSelector;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.util.regex.Pattern;
import java.io.ByteArrayInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/** Opt-in UiAutomator recording fixture. Real published Driver HTML/native code, simulated API/order/location.
 * No production login, order mutation, tracking upload or subscription is performed.
 */
public class DriverReviewDemoTest {
    private WebView findWeb(View view) {
        if(view instanceof WebView)return (WebView)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){
            WebView found=findWeb(((ViewGroup)view).getChildAt(i));if(found!=null)return found;
        }
        return null;
    }
    @Test public void recordUserStartedLocationAndNotificationStop() throws Exception {
        assumeTrue("Explicit review recording only", "true".equals(InstrumentationRegistry.getArguments().getString("bbRecordDriverDemo")));
        assumeTrue("Review recording requires Android 13+",android.os.Build.VERSION.SDK_INT>=33);
        assertEquals("driver",BuildConfig.APP_KIND);assertTrue(BuildConfig.DEBUG);
        Instrumentation inst=InstrumentationRegistry.getInstrumentation();Context ctx=inst.getTargetContext();
        AtomicInteger posts=new AtomicInteger(),stops=new AtomicInteger();
        MainActivity activity=null;
        HttpURLConnection connection=(HttpURLConnection)new URL("https://www.burger-brothers.berlin/driver").openConnection();
        connection.setConnectTimeout(15000);connection.setReadTimeout(20000);
        assertEquals(200,connection.getResponseCode());
        String html=new String(connection.getInputStream().readAllBytes(),StandardCharsets.UTF_8);connection.disconnect();
        String fixture="""
<script>
(()=>{
  localStorage.setItem('bb_current_driver_v1',JSON.stringify({id:'review-demo',name:'App Review'}));
  localStorage.setItem('bb_driver_remember','1');localStorage.setItem('bb_driver_lastname','App Review');
  const order={id:'DEMO-LOCATION-001',orderId:'DEMO-LOCATION-001',status:'ready',mode:'delivery',createdAt:Date.now(),ts:Date.now(),total:0,
    customer:{name:'Testlieferung – keine echte Bestellung',address:'Teststraße 1',zip:'13507',city:'Berlin'},
    items:[{name:'Testartikel',qty:1,price:0}],meta:{driver:{id:'review-demo',name:'App Review',assignedAt:Date.now()},deliveryGeo:{lat:52.55,lng:13.28}},driver:{id:'review-demo',name:'App Review'}};
  const response=x=>Promise.resolve(new Response(JSON.stringify(x),{status:200,headers:{'Content-Type':'application/json'}}));
  window.fetch=(input,options={})=>{
    const u=new URL(typeof input==='string'?input:input.url,location.href);
    if(!u.pathname.startsWith('/api/'))return Promise.reject(new Error('Review fixture blocks external fetch'));
    if(u.pathname==='/api/orders/list')return response({ok:true,orders:[order]});
    if(u.pathname==='/api/orders/status') {const b=JSON.parse(options.body||'{}');order.status=b.status||b.nextStatus||order.status;order.meta.status=order.status;return response({ok:true,order});}
    if(u.pathname==='/api/drivers')return response({ok:true,driver:{id:'review-demo',name:'App Review'}});
    if(u.pathname==='/api/native/driver/route')return response({ok:true,driverId:'review-demo',orderIds:order.status==='out_for_delivery'?[order.id]:[]});
    return response({ok:true,items:[],orders:[]});
  };
  window.EventSource=class{addEventListener(){}removeEventListener(){}close(){}};
  document.addEventListener('DOMContentLoaded',()=>{
    const badge=document.createElement('div');badge.textContent='ANDROID REVIEW DEMO · simulierte Lieferung & Position · keine Serverdaten';
    badge.style='position:fixed;bottom:0;left:0;right:0;z-index:2147483646;background:#804400;color:white;text-align:center;font:11px sans-serif;padding:4px;pointer-events:none';document.body.appendChild(badge);
  });
})();
</script>
""";
        html=html.replace("<head>","<head>"+fixture);final String document=html;
        Location point=new Location("review-fixture");point.setLatitude(52.55);point.setLongitude(13.28);point.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());
        DriverRouteService.testLocation=point;DriverRouteService.testIntervalMs=1000;
        DriverRouteService.testBackend=new DriverRouteService.Backend(){
            public JSONObject getRoute(String cookie)throws Exception{assertEquals("bb_driver_sess=review-fixture",cookie);return new JSONObject().put("ok",true).put("driverId","review-demo").put("orderIds",new JSONArray().put("DEMO-LOCATION-001"));}
            public void post(String path,String cookie,JSONObject body)throws Exception{if(path.equals("/api/native/driver/route")){assertFalse(body.getBoolean("active"));stops.incrementAndGet();}else{assertEquals(52.55,body.getDouble("lat"),0.00001);posts.incrementAndGet();}}
        };
        try {
            ctx.getSharedPreferences("native",0).edit().remove("trackingDeclined").apply();
            activity=(MainActivity)inst.startActivitySync(new Intent(ctx,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));final MainActivity screen=activity;
            inst.runOnMainSync(()->{
                WebView web=findWeb(screen.getWindow().getDecorView());assertNotNull(web);web.stopLoading();
                WebViewClient original=web.getWebViewClient();
                web.setWebViewClient(new WebViewClient(){
                    @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                        if(r.getUrl().getPath()!=null && r.getUrl().getPath().startsWith("/api/"))return new WebResourceResponse("application/json","UTF-8",new ByteArrayInputStream("{\"ok\":false,\"error\":\"review_fixture_network_blocked\"}".getBytes(StandardCharsets.UTF_8)));
                        return original.shouldInterceptRequest(v,r);
                    }
                    @Override public void onPageFinished(WebView v,String url){original.onPageFinished(v,url);}
                    @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return original.shouldOverrideUrlLoading(v,r);}
                });
                CookieManager.getInstance().setCookie("https://www.burger-brothers.berlin","bb_driver_sess=review-fixture; Path=/; Secure; SameSite=Strict");
                web.loadDataWithBaseURL("https://www.burger-brothers.berlin/driver",document,"text/html","UTF-8","https://www.burger-brothers.berlin/driver");
            });
            UiDevice device=UiDevice.getInstance(inst);
            if("com.android.systemui".equals(device.getCurrentPackageName())){device.pressBack();Thread.sleep(700);}
            UiObject2 mine=device.wait(Until.findObject(By.textContains("Meine")),20000);
            if(mine==null)device.dumpWindowHierarchy(new java.io.File(ctx.getExternalFilesDir(null),"driver-review-hierarchy.xml"));assertNotNull("Real Driver tabs missing",mine);Thread.sleep(2000);mine.click();Thread.sleep(1500);
            UiObject2 start=null;
            for(int swipe=0;swipe<6 && start==null;swipe++){
                start=device.findObject(By.text(Pattern.compile(".*Fahrt starten.*Lieferung.*")));
                if(start==null){device.swipe(device.getDisplayWidth()*9/10,device.getDisplayHeight()*4/5,device.getDisplayWidth()*9/10,device.getDisplayHeight()/3,30);Thread.sleep(700);}
            }
            assertNotNull("Real Fahrt starten button missing",start);Thread.sleep(1500);start.click();
            UiObject2 confirm=device.wait(Until.findObject(By.text("Ja, Fahrt starten")),5000);assertNotNull("Real trip confirmation missing",confirm);Thread.sleep(2000);confirm.click();
            UiObject2 consent=device.wait(Until.findObject(By.res("android","button1")),8000);
            assertNotNull("Real native location disclosure missing",consent);Thread.sleep(5000);consent.click();
            long deadline=SystemClock.elapsedRealtime()+60000;
            while(posts.get()==0 && SystemClock.elapsedRealtime()<deadline)Thread.sleep(250);
            assertTrue("UiAutomator did not start native route",posts.get()>0);
            assertTrue(DriverRuntime.running);assertTrue(ctx.getSystemService(NotificationManager.class).getActiveNotifications().length>0);
            int backgroundBefore=posts.get();Thread.sleep(2000);device.pressHome();Thread.sleep(3000);assertTrue("Location must continue with app backgrounded",posts.get()>backgroundBefore);
            assertTrue("Notification shade did not open",device.openNotification());
            UiObject2 title=device.wait(Until.findObject(By.text("BB Driver · Live-Standort")),5000);assertNotNull("Real service notification missing",title);
            UiObject2 stop=device.findObject(By.text(Pattern.compile("Stopp",Pattern.CASE_INSENSITIVE)));
            if(stop==null){UiObject2 expand=device.findObject(By.res("android","expand_button"));if(expand!=null)expand.click();Thread.sleep(700);stop=device.findObject(By.text(Pattern.compile("Stopp",Pattern.CASE_INSENSITIVE)));}
            assertNotNull("Real notification stop action missing",stop);Thread.sleep(5000);assertTrue("Real notification stop click failed",device.findObject(new UiSelector().textMatches("(?i)Stopp")).click());
            while(stops.get()==0 && SystemClock.elapsedRealtime()<deadline)Thread.sleep(250);
            assertTrue("UiAutomator must stop using real notification action",stops.get()>0);
            assertFalse(DriverRuntime.running);int after=posts.get();Thread.sleep(2000);assertEquals(after,posts.get());
            android.os.Bundle proof=new android.os.Bundle();proof.putString("reviewDemo","PASS: real native consent/service/notification/stop; simulated APIs/order/location; zero production mutations");inst.sendStatus(0,proof);
        } finally {
            ctx.stopService(new Intent(ctx,DriverRouteService.class));
            DriverRouteService.testBackend=null;DriverRouteService.testLocation=null;DriverRouteService.testIntervalMs=0;
            if(activity!=null){final MainActivity close=activity;inst.runOnMainSync(()->close.finish());}
        }
    }
}
