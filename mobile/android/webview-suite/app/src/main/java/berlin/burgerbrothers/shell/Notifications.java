package berlin.burgerbrothers.shell;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

public final class Notifications {
    public static void createChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("bb_orders","Bestellungen",NotificationManager.IMPORTANCE_HIGH));
        manager.createNotificationChannel(new NotificationChannel("bb_tracking","Aktive Lieferung",NotificationManager.IMPORTANCE_LOW));
    }
    public static boolean permitted(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)
            && context.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }
    public static String safeUrl(String raw) {
        String fallback = "driver".equals(BuildConfig.APP_KIND) ? "/driver" : "schnell".equals(BuildConfig.APP_KIND) ? "/schnellbestellung" : "/menu";
        String url = raw != null && raw.startsWith("/") && !raw.startsWith("//") && !raw.contains("\\") ? "https://www.burger-brothers.berlin"+raw : raw;
        if (!NavigationPolicy.trusted(url)) return "https://www.burger-brothers.berlin"+fallback;
        String path = Uri.parse(url).getPath();
        if ("driver".equals(BuildConfig.APP_KIND) && !("/driver".equals(path)||path.startsWith("/driver/"))) return "https://www.burger-brothers.berlin/driver";
        if ("schnell".equals(BuildConfig.APP_KIND) && !("/schnellbestellung".equals(path)||path.startsWith("/schnellbestellung/"))) return "https://www.burger-brothers.berlin/schnellbestellung";
        return url;
    }
    public static PendingIntent open(Context context,String url,int code) {
        Intent intent = new Intent(context,MainActivity.class).setData(Uri.parse(safeUrl(url)));
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context,code,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    public static void show(Context context,String title,String body,String url,String eventId) {
        if (!permitted(context)) return;
        String tag = eventId == null || eventId.isEmpty() ? "order" : eventId;
        Notification notice = new Notification.Builder(context,"bb_orders").setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(open(context,url,tag.hashCode())).setAutoCancel(true).build();
        context.getSystemService(NotificationManager.class).notify(tag,1,notice);
    }
    private Notifications() {}
}
