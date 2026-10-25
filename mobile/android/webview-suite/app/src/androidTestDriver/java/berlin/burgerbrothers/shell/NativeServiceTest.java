package berlin.burgerbrothers.shell;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeServiceTest {
    private Context context;
    private Activity activity;
    private volatile boolean empty;
    private volatile boolean forbidden;
    private volatile java.util.concurrent.CountDownLatch routeEntered;
    private volatile java.util.concurrent.CountDownLatch routeRelease;
    private final AtomicInteger posts=new AtomicInteger();
    private final AtomicInteger stops=new AtomicInteger();
    interface Check { boolean ready(); }
    private void waitFor(Check check)throws Exception {long deadline=SystemClock.elapsedRealtime()+8000;while(!check.ready() && SystemClock.elapsedRealtime()<deadline)Thread.sleep(50);assertTrue("Timed out waiting for native service",check.ready());}
    private void shell(String command)throws Exception{try(android.os.ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);java.io.FileInputStream input=new java.io.FileInputStream(fd.getFileDescriptor())){byte[] bytes=new byte[512];while(input.read(bytes)!=-1){}}}
    @Before public void setup()throws Exception{
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        shell("pm grant "+context.getPackageName()+" android.permission.ACCESS_FINE_LOCATION");
        shell("pm grant "+context.getPackageName()+" android.permission.ACCESS_COARSE_LOCATION");
        if(android.os.Build.VERSION.SDK_INT>=33)shell("pm grant "+context.getPackageName()+" android.permission.POST_NOTIFICATIONS");
        activity=InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Location point=new Location("fixture");point.setLatitude(52.5);point.setLongitude(13.4);point.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());
        DriverRouteService.testLocation=point;DriverRouteService.testIntervalMs=150;
        DriverRouteService.testBackend=new DriverRouteService.Backend(){
            public JSONObject getRoute(String cookie)throws Exception{
                assertEquals("bb_driver_sess=fixture",cookie);
                if(routeEntered!=null){routeEntered.countDown();routeRelease.await(5,java.util.concurrent.TimeUnit.SECONDS);}
                if(forbidden)throw new DriverRouteService.HttpFailure(401);
                return new JSONObject().put("ok",true).put("driverId","fixture-driver").put("orderIds",empty?new JSONArray():new JSONArray().put("fixture-order"));
            }
            public void post(String path,String cookie,JSONObject body)throws Exception{
                if(path.equals("/api/native/driver/route")){assertFalse(body.getBoolean("active"));stops.incrementAndGet();return;}
                assertTrue(path.startsWith("/api/track/driver_"));assertEquals("fixture-driver",body.getString("driverId"));assertEquals(52.5,body.getDouble("lat"),0.00001);assertEquals("fixture-order",body.getJSONArray("orderIds").getString(0));posts.incrementAndGet();
            }
        };
    }
    private void start() {context.startForegroundService(new Intent(context,DriverRouteService.class).putExtra("cookie","bb_driver_sess=fixture"));}
    @After public void teardown()throws Exception{
        context.stopService(new Intent(context,DriverRouteService.class));
        waitFor(()->!DriverRuntime.running);
        DriverRouteService.testBackend=null;DriverRouteService.testLocation=null;DriverRouteService.testIntervalMs=0;
        if(activity!=null)activity.finish();
        shell("input keyevent KEYCODE_WAKEUP");
    }
    @Test public void locationContinuesInBackgroundAndStopsWhenRouteEnds()throws Exception{
        if(!"driver".equals(BuildConfig.APP_KIND))return;
        start();waitFor(()->posts.get()>0);
        assertTrue(DriverRuntime.running);
        assertTrue(context.getSystemService(NotificationManager.class).getActiveNotifications().length>0);
        int before=posts.get();shell("input keyevent KEYCODE_HOME");waitFor(()->posts.get()>before+1);
        empty=true;waitFor(()->!DriverRuntime.running);waitFor(()->stops.get()>0);
        int stopped=posts.get();Thread.sleep(500);assertEquals(stopped,posts.get());
    }
    @Test public void expiredSessionStopsWithoutPublishingLocation()throws Exception{
        if(!"driver".equals(BuildConfig.APP_KIND))return;
        forbidden=true;start();waitFor(()->stops.get()>0);assertFalse(DriverRuntime.running);assertEquals(0,posts.get());
    }
    @Test public void notificationStopActionStopsLocation()throws Exception{
        if(!"driver".equals(BuildConfig.APP_KIND))return;
        start();waitFor(()->posts.get()>0);
        context.startService(new Intent(context,DriverRouteService.class).setAction(DriverRouteService.STOP));
        waitFor(()->!DriverRuntime.running);waitFor(()->stops.get()>0);
    }
    @Test public void directStopClosesBackendAndRejectsInFlightLocation()throws Exception{
        routeEntered=new java.util.concurrent.CountDownLatch(1);routeRelease=new java.util.concurrent.CountDownLatch(1);
        start();assertTrue(routeEntered.await(5,java.util.concurrent.TimeUnit.SECONDS));
        context.stopService(new Intent(context,DriverRouteService.class));
        waitFor(()->!DriverRuntime.running);routeRelease.countDown();
        waitFor(()->stops.get()>0);Thread.sleep(400);assertEquals(0,posts.get());
    }
    @Test public void notificationUrlCannotOpenExternalOrigin(){
        assertTrue(Notifications.safeUrl("https://evil.test/").startsWith("https://www.burger-brothers.berlin/"));
        assertTrue(Notifications.safeUrl("//evil.test/").startsWith("https://www.burger-brothers.berlin/"));
        assertTrue(Notifications.safeUrl("javascript:alert(1)").startsWith("https://www.burger-brothers.berlin/"));
        assertEquals("https://www.burger-brothers.berlin"+("driver".equals(BuildConfig.APP_KIND)?"/driver":"schnell".equals(BuildConfig.APP_KIND)?"/schnellbestellung":"/menu"),Notifications.safeUrl(null));
    }
}
