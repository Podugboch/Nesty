package com.devnest.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

public class DevNestFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data.isEmpty()) return;

        String action = data.get("action");
        String callId = data.get("callId");
        String callerId = data.get("callerId");
        String callerName = data.get("callerName");
        String callerAvatarUrl = data.get("callerAvatarUrl");
        String callType = data.get("callType");

        if ("call_invite".equals(action)) {
            // Wake up phone and trigger incoming call full-screen takeover
            Intent serviceIntent = new Intent(this, CallNotificationService.class);
            serviceIntent.setAction(CallNotificationService.ACTION_INCOMING_CALL);
            serviceIntent.putExtra("callId", callId);
            serviceIntent.putExtra("callerId", callerId);
            serviceIntent.putExtra("callerName", callerName);
            serviceIntent.putExtra("callerAvatarUrl", callerAvatarUrl);
            serviceIntent.putExtra("callType", callType);

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } else if ("call_cancel".equals(action)) {
            // Caller cancelled / hung up before answer -> dismiss ringing
            Intent stopIntent = new Intent(this, CallNotificationService.class);
            stopIntent.setAction(CallNotificationService.ACTION_STOP_CALL);
            startService(stopIntent);
        } else if ("missed_call".equals(action)) {
            // Stop ringing and show missed call notification
            Intent stopIntent = new Intent(this, CallNotificationService.class);
            stopIntent.setAction(CallNotificationService.ACTION_STOP_CALL);
            startService(stopIntent);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CallNotificationService.CHANNEL_ID)
                    .setContentTitle("Missed Call")
                    .setContentText("Missed call from " + (callerName != null ? callerName : "User"))
                    .setSmallIcon(android.R.drawable.sym_call_missed)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH);

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify((int) System.currentTimeMillis(), builder.build());
            }
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        // Persist token locally and upload to Go backend
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
                    conn.getResponseCode();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }).start();
        }
    }
}
