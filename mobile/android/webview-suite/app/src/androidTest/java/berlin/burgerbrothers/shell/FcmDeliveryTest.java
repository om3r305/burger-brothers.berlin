package berlin.burgerbrothers.shell;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Explicit opt-in live-delivery test. The token stays in the debug app's private preferences. */
@RunWith(AndroidJUnit4.class)
public class FcmDeliveryTest {
    private static String encode(byte[] value){return android.util.Base64.encodeToString(value,android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING);}
    @Test public void deliveryAndTap()throws Exception{
        Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        Context context=instrumentation.getTargetContext();Bundle args=InstrumentationRegistry.getArguments();
        String eventId=args.getString("bbFcmEventId","");
        // Ordinary connected-test runs must not wait for a real network sender.
        org.junit.Assume.assumeTrue(eventId.matches("bb-fcm-test-[a-z0-9-]{1,100}"));
        assertTrue(context.getPackageName().endsWith(".webviewdebug"));
        String mode=args.getString("bbFcmMode","");assertTrue(mode.equals("foreground")||mode.equals("background"));
        String path=args.getString("bbFcmPath","");
        String expected="https://www.burger-brothers.berlin"+path;
        assertEquals(expected,Notifications.safeUrl(path));
        assertTrue("Notification permission must be granted to the debug app",Notifications.permitted(context));
        String token=Tasks.await(FirebaseMessaging.getInstance().getToken(),45,TimeUnit.SECONDS);
        assertNotNull(token);assertTrue(token.matches("[A-Za-z0-9:_-]{20,4096}"));
        assertTrue(context.getSharedPreferences("native",Context.MODE_PRIVATE).edit().putString("pushToken",token).commit());
        Activity initial=instrumentation.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        Activity opened=null;
        Instrumentation.ActivityMonitor monitor=null;
        try{
            if(mode.equals("background")){
                try(android.os.ParcelFileDescriptor fd=instrumentation.getUiAutomation().executeShellCommand("input keyevent KEYCODE_HOME");java.io.FileInputStream stream=new java.io.FileInputStream(fd.getFileDescriptor())){byte[] block=new byte[512];while(stream.read(block)!=-1){}}
                Thread.sleep(800);
            }
            // The host owns an ephemeral RSA private key. Never print a plaintext token.
            byte[] publicBytes=android.util.Base64.decode(args.getString("bbFcmPublicKey",""),android.util.Base64.URL_SAFE);
            java.security.PublicKey hostKey=java.security.KeyFactory.getInstance("RSA").generatePublic(new java.security.spec.X509EncodedKeySpec(publicBytes));
            java.security.SecureRandom random=new java.security.SecureRandom();byte[] aesKey=new byte[32],nonce=new byte[12];random.nextBytes(aesKey);random.nextBytes(nonce);
            javax.crypto.Cipher aes=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
            aes.init(javax.crypto.Cipher.ENCRYPT_MODE,new javax.crypto.spec.SecretKeySpec(aesKey,"AES"),new javax.crypto.spec.GCMParameterSpec(128,nonce));
            byte[] encryptedToken=aes.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            javax.crypto.Cipher rsa=javax.crypto.Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
            rsa.init(javax.crypto.Cipher.ENCRYPT_MODE,hostKey,new javax.crypto.spec.OAEPParameterSpec("SHA-256","MGF1",java.security.spec.MGF1ParameterSpec.SHA256,javax.crypto.spec.PSource.PSpecified.DEFAULT));
            org.json.JSONObject envelope=new org.json.JSONObject().put("key",encode(rsa.doFinal(aesKey))).put("nonce",encode(nonce)).put("token",encode(encryptedToken));
            java.util.Arrays.fill(aesKey,(byte)0);
            Bundle ready=new Bundle();ready.putString("bbFcmTokenEnvelope",encode(envelope.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));ready.putString("bbFcmPhase","READY:"+eventId);instrumentation.sendStatus(2,ready);
            long deadline=SystemClock.elapsedRealtime()+60000;StatusBarNotification delivered=null;
            while(delivered==null && SystemClock.elapsedRealtime()<deadline){
                for(StatusBarNotification item:manager.getActiveNotifications())if(eventId.equals(item.getTag())){delivered=item;break;}
                if(delivered==null)Thread.sleep(100);
            }
            assertNotNull("Timed out waiting for the targeted FCM notification",delivered);
            assertEquals("Android-Benachrichtigungstest",delivered.getNotification().extras.getCharSequence(Notification.EXTRA_TITLE).toString());
            assertEquals("Lokaler Zustelltest - keine Bestellung.",delivered.getNotification().extras.getCharSequence(Notification.EXTRA_TEXT).toString());
            assertEquals("bb_orders",delivered.getNotification().getChannelId());
            // Native foreground service uses ID 1; the pinned Firebase background renderer uses ID 0.
            assertEquals("Wrong foreground/background notification route",mode.equals("foreground")?1:0,delivered.getId());
            assertNotNull(delivered.getNotification().contentIntent);
            instrumentation.runOnMainSync(initial::finish);instrumentation.waitForIdleSync();
            monitor=instrumentation.addMonitor(MainActivity.class.getName(),null,false);
            delivered.getNotification().contentIntent.send();
            opened=instrumentation.waitForMonitorWithTimeout(monitor,10000);
            assertNotNull("Notification tap did not return to the target app",opened);
            assertEquals(context.getPackageName(),opened.getPackageName());
            String target=opened.getIntent().getDataString();
            if(target==null)target=Notifications.safeUrl(opened.getIntent().getStringExtra("url"));
            assertEquals(expected,target);
            Bundle result=new Bundle();result.putString("bbFcmPhase","DELIVERED_AND_TAPPED:"+eventId);instrumentation.sendStatus(2,result);
        }finally{
            if(monitor!=null)instrumentation.removeMonitor(monitor);
            for(StatusBarNotification item:manager.getActiveNotifications())if(eventId.equals(item.getTag()))manager.cancel(item.getTag(),item.getId());
            Activity finalOpened=opened;instrumentation.runOnMainSync(()->{initial.finish();if(finalOpened!=null)finalOpened.finish();});
        }
    }
}
