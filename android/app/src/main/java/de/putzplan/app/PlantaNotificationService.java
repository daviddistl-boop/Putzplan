package de.putzplan.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Liest ausschließlich Benachrichtigungen der Planta-App mit (z. B. „Zeit zum Gießen“),
 * damit Putzplan daraus Aufgaben machen kann. Alle anderen Benachrichtigungen werden ignoriert.
 */
public class PlantaNotificationService extends NotificationListenerService {
    static final String PLANTA_PACKAGE = "com.stromming.planta";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !PLANTA_PACKAGE.equals(sbn.getPackageName())) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle extras = n.extras;
        if (extras == null) return;
        String title = str(extras.getCharSequence(Notification.EXTRA_TITLE));
        String text = str(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (text.isEmpty()) text = str(extras.getCharSequence(Notification.EXTRA_TEXT));
        if (title.isEmpty() && text.isEmpty()) return;
        PlantaStore.add(this, sbn.getKey(), title, text, sbn.getPostTime());
        PlantaBridgePlugin.notifyNewItems();
    }

    private static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }
}
