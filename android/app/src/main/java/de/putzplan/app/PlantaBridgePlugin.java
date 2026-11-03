package de.putzplan.app;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Brücke zwischen der Web-App und dem Planta-Benachrichtigungsdienst. */
@CapacitorPlugin(name = "PlantaBridge")
public class PlantaBridgePlugin extends Plugin {
    private static PlantaBridgePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static void notifyNewItems() {
        PlantaBridgePlugin plugin = instance;
        if (plugin != null) plugin.notifyListeners("plantaNotification", new JSObject());
    }

    /** Hat der Nutzer Putzplan den Benachrichtigungszugriff erlaubt? */
    @PluginMethod
    public void status(PluginCall call) {
        boolean enabled = NotificationManagerCompat.getEnabledListenerPackages(getContext())
            .contains(getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        result.put("package", PlantaNotificationService.PLANTA_PACKAGE);
        call.resolve(result);
    }

    /** Öffnet die Android-Einstellung für den Benachrichtigungszugriff. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            intent.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                new ComponentName(getContext(), PlantaNotificationService.class).flattenToString());
        } else {
            intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
        call.resolve();
    }

    /** Öffnet die App-Infos von Putzplan (für „Eingeschränkte Einstellungen zulassen“). */
    @PluginMethod
    public void openAppInfo(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            android.net.Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Noch nicht verarbeitete Planta-Benachrichtigungen. */
    @PluginMethod
    public void getPending(PluginCall call) {
        JSONArray queue = PlantaStore.read(getContext());
        JSArray items = new JSArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item == null) continue;
            try {
                items.put(new JSObject(item.toString()));
            } catch (JSONException e) {
                // fehlerhaften Eintrag überspringen
            }
        }
        JSObject result = new JSObject();
        result.put("items", items);
        call.resolve(result);
    }

    /** Entfernt verarbeitete Einträge (Schlüssel: id + "|" + postedAt). */
    @PluginMethod
    public void clear(PluginCall call) {
        JSArray keys = call.getArray("keys");
        Set<String> set = new HashSet<>();
        if (keys != null) {
            for (int i = 0; i < keys.length(); i++) {
                String k = keys.optString(i, null);
                if (k != null) set.add(k);
            }
        }
        PlantaStore.remove(getContext(), set);
        call.resolve();
    }
}
