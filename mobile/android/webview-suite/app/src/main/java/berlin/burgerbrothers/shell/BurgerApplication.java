package berlin.burgerbrothers.shell;

import android.app.Application;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

public final class BurgerApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        Notifications.createChannels(this);
        if (!BuildConfig.FIREBASE_APP_ID.isEmpty() && !BuildConfig.FIREBASE_API_KEY.isEmpty()) {
            FirebaseApp.initializeApp(this,new FirebaseOptions.Builder()
                .setApplicationId(BuildConfig.FIREBASE_APP_ID).setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setProjectId(BuildConfig.FIREBASE_PROJECT).setGcmSenderId(BuildConfig.FIREBASE_SENDER).build());
        }
    }
}
