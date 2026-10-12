package com.devnest.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;

public class CallNotificationService extends Service {
    public static final String CHANNEL_ID = "nesty_incoming_calls";
    public static final int NOTIFICATION_ID = 20261;

    public static final String ACTION_INCOMING_CALL = "com.devnest.app.INCOMING_CALL";
    public static final String ACTION_STOP_CALL = "com.devnest.app.STOP_CALL";

    private Ringtone ringtone;
    private Vibrator vibrator;
    private android.os.PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_STOP_CALL.equals(action)) {
            stopCallAlerts();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String callId = intent.getStringExtra("callId");
        String callerName = intent.getStringExtra("callerName");
        String callerId = intent.getStringExtra("callerId");
        String callType = intent.getStringExtra("callType");
        if (callerName == null || callerName.isEmpty()) callerName = "DevNest User";

        acquireScreenWakeLock();
        startRingtoneAndVibration();
        Notification notification = buildIncomingCallNotification(callId, callerId, callerName, callType);
        startForeground(NOTIFICATION_ID, notification);

        // Disturb screen by bringing DevNest call interface to front
        try {
            Intent bringToFront = new Intent();
            bringToFront.setClassName(this, "io.github.webviewtemplate.MainActivity");
            bringToFront.setAction(Intent.ACTION_VIEW);
            bringToFront.setData(Uri.parse("devnest://call?action=incoming&callId=" + callId + "&callerId=" + callerId + "&callType=" + callType));
            bringToFront.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(bringToFront);
        } catch (Exception ignored) {}

        return START_NOT_STICKY;
    }

    private void acquireScreenWakeLock() {
        try {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                if (wakeLock != null && wakeLock.isHeld()) {
                    try { wakeLock.release(); } catch (Exception ignored) {}
                }
                wakeLock = pm.newWakeLock(
                        android.os.PowerManager.FULL_WAKE_LOCK |
                        android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP |
                        android.os.PowerManager.ON_AFTER_RELEASE,
                        "DevNest:IncomingCallWakeLock"
                );
                wakeLock.acquire(45000);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void startRingtoneAndVibration() {
        try {
            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            ringtone = RingtoneManager.getRingtone(getApplicationContext(), ringtoneUri);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                ringtone.setAudioAttributes(audioAttributes);
            }
            if (ringtone != null && !ringtone.isPlaying()) {
                ringtone.play();
            }

            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null) {
                long[] pattern = {0, 1000, 1000, 1000, 1000};
                vibrator.vibrate(pattern, 1);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void stopCallAlerts() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
            }
        } catch (Exception ignored) {}
        try {
            if (ringtone != null && ringtone.isPlaying()) {
                ringtone.stop();
            }
            if (vibrator != null) {
                vibrator.cancel();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private Notification buildIncomingCallNotification(String callId, String callerId, String callerName, String callType) {
        // Full-screen takeover intent when screen is locked or app backgrounded
        Intent fullScreenIntent = new Intent();
        fullScreenIntent.setClassName(this, "io.github.webviewtemplate.MainActivity");
        fullScreenIntent.setAction(Intent.ACTION_VIEW);
        fullScreenIntent.setData(Uri.parse("devnest://call?action=incoming&callId=" + callId + "&callerId=" + callerId + "&callType=" + callType));
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                this, 0, fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Answer Action: Launches / foregrounds Nesty directly into call screen
        Intent answerIntent = new Intent();
        answerIntent.setClassName(this, "io.github.webviewtemplate.MainActivity");
        answerIntent.setAction(Intent.ACTION_VIEW);
        answerIntent.setData(Uri.parse("devnest://call?action=answer&callId=" + callId + "&callerId=" + callerId + "&callType=" + callType));
        answerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent answerPendingIntent = PendingIntent.getActivity(
                this, 1, answerIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Decline Action: Broadcasts decline signal and stops ringing without opening the full app
        Intent declineIntent = new Intent(this, IncomingCallReceiver.class);
        declineIntent.setAction(IncomingCallReceiver.ACTION_DECLINE);
        declineIntent.putExtra("callId", callId);
        declineIntent.putExtra("callerId", callerId);
        PendingIntent declinePendingIntent = PendingIntent.getBroadcast(
                this, 2, declineIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        boolean isVideo = "video".equalsIgnoreCase(callType);
        String title = isVideo ? "📹 Incoming Video Call" : "📞 Incoming Voice Call";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(callerName + " is calling you on DevNest")
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(false)
                .setOngoing(true)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setContentIntent(fullScreenPendingIntent)
                .addAction(android.R.drawable.sym_call_outgoing, "Answer", answerPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "DevNest Incoming Calls",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("High-priority full-screen incoming call alerts");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(true);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        stopCallAlerts();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
