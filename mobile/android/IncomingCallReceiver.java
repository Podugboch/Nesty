package com.devnest.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;
import androidx.core.app.NotificationManagerCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class IncomingCallReceiver extends BroadcastReceiver {
    public static final String ACTION_ANSWER = "com.devnest.app.ACTION_ANSWER_CALL";
    public static final String ACTION_DECLINE = "com.devnest.app.ACTION_DECLINE_CALL";
    private static final String TAG = "DevNestCall";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String callId = intent.getStringExtra("callId");
        String callerId = intent.getStringExtra("callerId");

        Log.d(TAG, "[CallLog] IncomingCallReceiver onReceive: action=" + action + ", callId=" + callId);

        // Stop the foreground ringing service and release wakelock immediately
        Intent stopService = new Intent(context, CallNotificationService.class);
        stopService.setAction(CallNotificationService.ACTION_STOP_CALL);
        stopService.putExtra("callId", callId);
        context.startService(stopService);

        // Cancel notification for this call
        if (callId != null && !callId.isEmpty()) {
            NotificationManagerCompat.from(context).cancel(CallNotificationService.getNotificationId(callId));
            Log.d(TAG, "[CallLog] Dismissed notification ID " + CallNotificationService.getNotificationId(callId));
        }

        if (ACTION_DECLINE.equals(action)) {
            Log.d(TAG, "[CallLog] Decline tapped for callId=" + callId + ", callerId=" + callerId);
            AndroidCallBridge.restoreLockScreen(null);
            // Dispatch decline signal asynchronously to the backend without bringing up full UI
            new Thread(() -> {
                try {
                    SharedPreferences prefs = context.getSharedPreferences("DevNestPrefs", Context.MODE_PRIVATE);
                    String token = prefs.getString("auth_token", "");
                    String apiUrl = prefs.getString("api_url", "https://piscine-devnest.onrender.com");
                    if (token.isEmpty()) {
                        SharedPreferences capPrefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
                        token = capPrefs.getString("token", "");
                    }

                    if (!token.isEmpty() && callerId != null && !callerId.isEmpty()) {
                        URL url = new URL(apiUrl + "/api/call/signal");
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("Content-Type", "application/json");
                        conn.setRequestProperty("Authorization", "Bearer " + token);
                        conn.setDoOutput(true);

                        String json = "{\"type\":\"call_declined\",\"to_user_id\":" + callerId + ",\"data\":{\"callId\":\"" + callId + "\"}}";
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(json.getBytes("UTF-8"));
                        }
                        int code = conn.getResponseCode();
                        Log.d(TAG, "[CallLog] Sent call_declined to backend: HTTP " + code);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "[CallLog] Failed sending decline signal: " + e.getMessage());
                }
            }).start();
        } else if (ACTION_ANSWER.equals(action)) {
            Log.d(TAG, "[CallLog] Answer tapped: launching MainActivity for callId=" + callId);
            // Launch / bring MainActivity to front directly into the call screen
            Intent answerIntent = new Intent();
            answerIntent.setClassName(context, "io.github.webviewtemplate.MainActivity");
            answerIntent.setAction(Intent.ACTION_VIEW);
            answerIntent.setData(Uri.parse("devnest://call?action=answer&callId=" + callId + "&callerId=" + callerId));
            answerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            context.startActivity(answerIntent);
        }
    }
}
