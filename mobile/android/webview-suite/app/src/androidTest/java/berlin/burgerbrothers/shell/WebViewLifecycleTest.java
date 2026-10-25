package berlin.burgerbrothers.shell;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** In-memory first-party fixture: no payment, order or server mutation. */
@RunWith(AndroidJUnit4.class)
public class WebViewLifecycleTest {
    private Instrumentation instrumentation;
    private MainActivity activity;
    private WebView web;
    private WebView findWeb(View view){
        if(view instanceof WebView)return (WebView)view;
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){WebView result=findWeb(group.getChildAt(i));if(result!=null)return result;}}
        return null;
    }
    private String evaluate(String script)throws Exception{
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        instrumentation.runOnMainSync(()->web.evaluateJavascript(script,value->{result.set(value);done.countDown();}));
        assertTrue("JavaScript callback timed out",done.await(5,TimeUnit.SECONDS));return result.get();
    }
    private void await(String expression,String expected)throws Exception{
        long deadline=SystemClock.elapsedRealtime()+8000;String value;
        do{value=evaluate(expression);if(expected.equals(value))return;Thread.sleep(50);}while(SystemClock.elapsedRealtime()<deadline);
        assertEquals(expected,value);
    }
    @Before public void setup()throws Exception{
        instrumentation=InstrumentationRegistry.getInstrumentation();
        activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(()->{
            web=findWeb(activity.getWindow().getDecorView());assertNotNull(web);web.stopLoading();
            String html="<html><body><div role='dialog'><button data-bb-dialog-close onclick=\"this.parentElement.remove();window.fixtureClosed=true\">Anderer Testtext</button></div><script>window.fixtureReady=true;window.resumeCount=0;window.addEventListener('bb:nativeResume',()=>window.resumeCount++);</script></body></html>";
            web.loadDataWithBaseURL("https://www.burger-brothers.berlin/native-test-fixture",html,"text/html","UTF-8","https://www.burger-brothers.berlin/native-test-fixture");
        });
        await("window.fixtureReady === true","true");
        AtomicReference<String> loaded=new AtomicReference<>();instrumentation.runOnMainSync(()->loaded.set(web.getUrl()));
        assertTrue("Fixture must have a trusted main-frame URL: "+loaded.get(),NavigationPolicy.trusted(loaded.get()));
    }
    @After public void teardown(){if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());}
    @Test public void markedModalConsumesNativeBackBeforeHistory()throws Exception{
        instrumentation.runOnMainSync(()->activity.onBackPressed());
        await("window.fixtureClosed === true && !document.querySelector('[role=dialog]')","true");
        assertFalse(activity.isFinishing());
    }
    @Test public void nativeResumeSignalReachesTheWebView()throws Exception{
        instrumentation.runOnMainSync(()->{instrumentation.callActivityOnPause(activity);instrumentation.callActivityOnResume(activity);});
        await("window.resumeCount > 0","true");
    }
}
