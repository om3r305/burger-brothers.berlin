package berlin.burgerbrothers.shell;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.android.gms.tasks.Tasks;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
@RunWith(AndroidJUnit4.class)
public class FirebaseClientTest {
    @Test public void firebaseIssuesCaseSensitiveTokenForConfiguredApp()throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertFalse("Firebase client configuration is missing",FirebaseApp.getApps(context).isEmpty());
        String token=Tasks.await(FirebaseMessaging.getInstance().getToken(),45,TimeUnit.SECONDS);
        assertNotNull(token);assertTrue(token.matches("[A-Za-z0-9:_-]{20,4096}"));
        context.getSharedPreferences("native",Context.MODE_PRIVATE).edit().putString("pushToken",token).commit();
        // No token is printed in instrumentation output. No order/subscription is created.
    }
}
