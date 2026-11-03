package de.putzplan.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Zwischenspeicher für Planta-Benachrichtigungen, bis die App sie abholt.
 * Gespeichert werden nur Titel, Text und Zeitpunkt – im privaten Speicher der App.
 */
final class PlantaStore {
    private static final String PREFS = "planta";
    private static final String KEY = "queue";
    private static final int MAX_ITEMS = 50;

    private PlantaStore() {}

    static synchronized void add(Context context, String id, String title, String text, long postedAt) {
        JSONArray queue = read(context);
        // Dieselbe Benachrichtigung (z. B. aktualisiert) nicht doppelt aufnehmen.
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && id.equals(item.optString("id")) && text.equals(item.optString("text"))) return;
        }
        try {
            JSONObject item = new JSONObject();
            item.put("id", id);
            item.put("title", title);
            item.put("text", text);
            item.put("postedAt", postedAt);
            queue.put(item);
        } catch (JSONException e) {
            return;
        }
        JSONArray trimmed = new JSONArray();
        for (int i = Math.max(0, queue.length() - MAX_ITEMS); i < queue.length(); i++) trimmed.put(queue.opt(i));
        write(context, trimmed);
    }

    static synchronized JSONArray read(Context context) {
        String raw = prefs(context).getString(KEY, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static synchronized void remove(Context context, java.util.Set<String> ids) {
        JSONArray queue = read(context);
        JSONArray rest = new JSONArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && !ids.contains(item.optString("id") + "|" + item.optLong("postedAt"))) rest.put(item);
        }
        write(context, rest);
    }

    private static void write(Context context, JSONArray queue) {
        prefs(context).edit().putString(KEY, queue.toString()).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
