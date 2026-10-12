package com.devnest.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class IncomingCallReceiver extends BroadcastReceiver {
    public static final String ACTION_ANSWER = "com.devnest.app.ACTION_ANSWER_CALL";
    public static final String ACTION_DECLINE = "com.devnest.app.ACTION_DECLINE_CALL";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String callId = intent.getStringExtra("callId");
        String callerId = intent.getStringExtra("callerId");

        // Stop the foreground ringing service immediately
        Intent stopService = new Intent(context, CallNotificationService.class);
        stopService.setAction(CallNotificationService.ACTION_STOP_CALL);
        context.startService(stopService);

        if (ACTION_DECLINE.equals(action)) {
            // Send decline signal asynchronously to the backend without launching the app
            new Thread(() -> {
                try {
                    SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
                    String token = prefs.getString("token", "");
                    String apiUrl = prefs.getString("api_url", "https://piscine-devnest.onrender.com");

                    if (!token.isEmpty() && callerId != null) {
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
                        conn.getResponseCode();
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }).start();
        } else if (ACTION_ANSWER.equals(action)) {
            // Launch / foreground MainActivity directly to call screen
            Intent answerIntent = new Intent();
            answerIntent.setClassName(context, "io.github.webviewtemplate.MainActivity");
            answerIntent.setAction(Intent.ACTION_VIEW);
            answerIntent.setData(Uri.parse("devnest://call?action=answer&callId=" + callId + "&callerId=" + callerId));
            answerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            context.startActivity(answerIntent);
        }
    }
}
