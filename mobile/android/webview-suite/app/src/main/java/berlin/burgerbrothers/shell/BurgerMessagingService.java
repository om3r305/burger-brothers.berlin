package berlin.burgerbrothers.shell;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class BurgerMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        getSharedPreferences("native",MODE_PRIVATE).edit().putString("pushToken",token).apply();
        // The next trusted-page handshake rebinds a rotated token with its authenticated cookie.
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        if (!BuildConfig.APP_KIND.equals(message.getData().get("appKind"))) return;
        RemoteMessage.Notification notice = message.getNotification();
        if (notice == null) return;
        Notifications.show(this,notice.getTitle(),notice.getBody(),message.getData().get("url"),message.getData().get("eventId"));
    }
}
