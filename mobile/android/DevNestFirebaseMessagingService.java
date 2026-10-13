package com.devnest.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

public class DevNestFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "DevNestCall";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) {
            Log.d(TAG, "[CallLog] Received FCM push with empty data payload, ignoring");
            return;
        }

        String action = data.get("action");
        String callId = data.get("callId");
        String callerId = data.get("callerId");
        String callerName = data.get("callerName");
        String callerAvatarUrl = data.get("callerAvatarUrl");
        String callType = data.get("callType");

        Log.d(TAG, "[CallLog] Push received in native background: action=" + action + ", callId=" + callId + ", caller=" + callerName + ", type=" + callType);

        if ("call_invite".equals(action)) {
            Log.d(TAG, "[CallLog] Starting foreground CallNotificationService immediately without waiting for WebView");
            Intent serviceIntent = new Intent(this, CallNotificationService.class);
            serviceIntent.setAction(CallNotificationService.ACTION_INCOMING_CALL);
            serviceIntent.putExtra("callId", callId != null ? callId : "");
            serviceIntent.putExtra("callerId", callerId != null ? callerId : "");
            serviceIntent.putExtra("callerName", callerName != null ? callerName : "DevNest User");
            serviceIntent.putExtra("callerAvatarUrl", callerAvatarUrl != null ? callerAvatarUrl : "");
            serviceIntent.putExtra("callType", callType != null ? callType : "audio");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } else if ("call_cancel".equals(action)) {
            Log.d(TAG, "[CallLog] Received call_cancel: dismissing callId=" + callId);
            Intent stopIntent = new Intent(this, CallNotificationService.class);
            stopIntent.setAction(CallNotificationService.ACTION_CANCEL_CALL);
            stopIntent.putExtra("callId", callId);
            startService(stopIntent);

            if (callId != null && !callId.isEmpty()) {
                NotificationManagerCompat.from(this).cancel(CallNotificationService.getNotificationId(callId));
            }
        } else if ("missed_call".equals(action)) {
            Log.d(TAG, "[CallLog] Received missed_call for callId=" + callId);
            Intent missedIntent = new Intent(this, CallNotificationService.class);
            missedIntent.setAction(CallNotificationService.ACTION_MISSED_CALL);
            missedIntent.putExtra("callId", callId);
            missedIntent.putExtra("callerName", callerName);
            missedIntent.putExtra("callType", callType);
            startService(missedIntent);
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        Log.d(TAG, "[CallLog] FCM device token updated: " + token);

        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        prefs.edit().putString("devnest_device_token", token).apply();

        String authToken = prefs.getString("token", "");
        String apiUrl = prefs.getString("api_url", "https://piscine-devnest.onrender.com");

        if (!authToken.isEmpty()) {
            new Thread(() -> {
                try {
                    URL url = new URL(apiUrl + "/api/devices");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("Authorization", "Bearer " + authToken);
                    conn.setDoOutput(true);

                    String json = "{\"token\":\"" + token + "\",\"platform\":\"android\"}";
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(json.getBytes("UTF-8"));
                    }
                    int responseCode = conn.getResponseCode();
                    Log.d(TAG, "[CallLog] Synced FCM token to DevNest backend: HTTP " + responseCode);
                } catch (Exception e) {
                    Log.e(TAG, "[CallLog] Error syncing device token: " + e.getMessage());
                }
            }).start();
        }
    }
}
