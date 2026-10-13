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
import android.os.PowerManager;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

public class CallNotificationService extends Service {
    private static final String TAG = "DevNestCall";

    // 1. Android Notification Channel Identifiers
    public static final String CHANNEL_INCOMING_CALLS_V2 = "incoming_calls_v2";
    public static final String CHANNEL_ONGOING_CALLS = "ongoing_calls";
    public static final String CHANNEL_MISSED_CALLS = "missed_calls";

    // Default listener notification ID
    public static final int LISTENER_NOTIFICATION_ID = 20260;

    // Service Intent Actions
    public static final String ACTION_INCOMING_CALL = "com.devnest.app.INCOMING_CALL";
    public static final String ACTION_STOP_CALL = "com.devnest.app.STOP_CALL";
    public static final String ACTION_CANCEL_CALL = "com.devnest.app.CANCEL_CALL";
    public static final String ACTION_DISMISS_NOTIFICATION = "com.devnest.app.DISMISS_NOTIFICATION";
    public static final String ACTION_MISSED_CALL = "com.devnest.app.MISSED_CALL";
    public static final String ACTION_START_LISTENER = "com.devnest.app.START_LISTENER";
    public static final String ACTION_STOP_LISTENER = "com.devnest.app.STOP_LISTENER";

    private Ringtone ringtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    public static int getNotificationId(String callId) {
        if (callId == null || callId.isEmpty()) {
            return 20261;
        }
        return Math.abs(callId.hashCode() % 800000) + 10000;
    }

    public static void createNotificationChannels(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                // Delete previous obsolete or misconfigured channels
                try {
                    manager.deleteNotificationChannel("nesty_incoming_calls");
                    manager.deleteNotificationChannel("incoming_calls");
                    manager.deleteNotificationChannel("nesty_calling_listener");
                } catch (Exception ignored) {}

                // Channel 1: incoming_calls_v2 (IMPORTANCE_HIGH, looping ringtone, DND bypass, repeating vibration)
                NotificationChannel incomingChannel = new NotificationChannel(
                        CHANNEL_INCOMING_CALLS_V2,
                        "DevNest Incoming Calls",
                        NotificationManager.IMPORTANCE_HIGH
                );
                incomingChannel.setDescription("High-priority full-screen incoming call alerts with looping ringtone");
                incomingChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                incomingChannel.setBypassDnd(true);
                incomingChannel.setShowBadge(false);

                Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                incomingChannel.setSound(ringtoneUri, audioAttributes);
                incomingChannel.enableVibration(true);
                incomingChannel.setVibrationPattern(new long[]{0, 1000, 1000, 1000});
                manager.createNotificationChannel(incomingChannel);

                // Channel 2: ongoing_calls (IMPORTANCE_LOW, silent foreground service)
                NotificationChannel ongoingChannel = new NotificationChannel(
                        CHANNEL_ONGOING_CALLS,
                        "DevNest Ongoing Call",
                        NotificationManager.IMPORTANCE_LOW
                );
                ongoingChannel.setDescription("Foreground service status during an active call or background connection");
                ongoingChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                ongoingChannel.setSound(null, null);
                ongoingChannel.enableVibration(false);
                manager.createNotificationChannel(ongoingChannel);

                // Channel 3: missed_calls (IMPORTANCE_DEFAULT)
                NotificationChannel missedChannel = new NotificationChannel(
                        CHANNEL_MISSED_CALLS,
                        "DevNest Missed Calls",
                        NotificationManager.IMPORTANCE_DEFAULT
                );
                missedChannel.setDescription("Notifications for missed calls");
                missedChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(missedChannel);

                Log.d(TAG, "[CallLog] Notification channels created natively: incoming_calls_v2, ongoing_calls, missed_calls");
            }
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        Log.d(TAG, "[CallLog] CallNotificationService handling action: " + action);

        if (ACTION_STOP_LISTENER.equals(action)) {
            stopCallAlerts();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_DISMISS_NOTIFICATION.equals(action)) {
            String callId = intent.getStringExtra("callId");
            stopCallAlerts();
            if (callId != null && !callId.isEmpty()) {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel(getNotificationId(callId));
                }
            }
            stopForeground(true);
            return START_NOT_STICKY;
        }

        if (ACTION_CANCEL_CALL.equals(action) || ACTION_STOP_CALL.equals(action)) {
            String callId = intent.getStringExtra("callId");
            stopCallAlerts();
            if (callId != null && !callId.isEmpty()) {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel(getNotificationId(callId));
                }
                Log.d(TAG, "[CallLog] Dismissed call notification for callId=" + callId);
            }
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_MISSED_CALL.equals(action)) {
            String callId = intent.getStringExtra("callId");
            String callerName = intent.getStringExtra("callerName");
            String callType = intent.getStringExtra("callType");
            if (callerName == null || callerName.isEmpty()) callerName = "DevNest User";
            boolean isVideo = "video".equalsIgnoreCase(callType);

            stopCallAlerts();
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                if (callId != null && !callId.isEmpty()) {
                    nm.cancel(getNotificationId(callId));
                }
                NotificationCompat.Builder missedBuilder = new NotificationCompat.Builder(this, CHANNEL_MISSED_CALLS)
                        .setSmallIcon(android.R.drawable.sym_call_missed)
                        .setContentTitle("Missed " + (isVideo ? "Video" : "Audio") + " Call")
                        .setContentText("Missed call from " + callerName)
                        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                        .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
                        .setAutoCancel(true)
                        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                nm.notify((int) System.currentTimeMillis(), missedBuilder.build());
                Log.d(TAG, "[CallLog] Missed call notification posted in missed_calls channel");
            }
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START_LISTENER.equals(action)) {
            Notification listenerNotification = buildListenerNotification();
            startForeground(LISTENER_NOTIFICATION_ID, listenerNotification);
            return START_STICKY;
        }

        // ACTION_INCOMING_CALL
        String callId = intent.getStringExtra("callId");
        String callerName = intent.getStringExtra("callerName");
        String callerId = intent.getStringExtra("callerId");
        String callType = intent.getStringExtra("callType");
        String callerAvatarUrl = intent.getStringExtra("callerAvatarUrl");
        if (callerName == null || callerName.isEmpty()) callerName = "DevNest User";

        int notificationId = getNotificationId(callId);
        Log.d(TAG, "[CallLog] Incoming call received: callId=" + callId + ", caller=" + callerName + ", type=" + callType + ", notifId=" + notificationId);

        acquireScreenWakeLock();
        startRingtoneAndVibration();

        Notification notification = buildIncomingCallNotification(callId, callerId, callerName, callType, callerAvatarUrl);
        startForeground(notificationId, notification);
        Log.d(TAG, "[CallLog] Incoming call notification posted as foreground service: notifId=" + notificationId);

        // NOTE: We do NOT call startActivity directly from background here!
        // Direct startActivity from a Service is prohibited on Android 10+ when the device is unlocked and in use,
        // causing crashes/stops. The notification's setFullScreenIntent automatically handles lock-screen takeover
        // when the screen is locked/off, and displays heads-up action buttons when the user is using the phone.

        return START_NOT_STICKY;
    }

    private void acquireScreenWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                if (wakeLock != null && wakeLock.isHeld()) {
                    try { wakeLock.release(); } catch (Exception ignored) {}
                }
                wakeLock = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK |
                        PowerManager.ACQUIRE_CAUSES_WAKEUP |
                        PowerManager.ON_AFTER_RELEASE,
                        "DevNest:IncomingCallWakeLock"
                );
                wakeLock.acquire(30000);
                Log.d(TAG, "[CallLog] Acquired FULL_WAKE_LOCK for 30 seconds");
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error acquiring wake lock: " + e.getMessage());
        }
    }

    private void startRingtoneAndVibration() {
        try {
            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            ringtone = RingtoneManager.getRingtone(getApplicationContext(), ringtoneUri);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && ringtone != null) {
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                ringtone.setAudioAttributes(audioAttributes);
            }
            if (ringtone != null && !ringtone.isPlaying()) {
                ringtone.play();
                Log.d(TAG, "[CallLog] Ringtone started (USAGE_NOTIFICATION_RINGTONE)");
            }

            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null) {
                long[] pattern = {0, 1000, 1000, 1000};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, 1));
                } else {
                    vibrator.vibrate(pattern, 1);
                }
                Log.d(TAG, "[CallLog] Repeating vibration pattern started");
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error playing ringtone/vibrator: " + e.getMessage());
        }
    }

    private void stopCallAlerts() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
                Log.d(TAG, "[CallLog] WakeLock released");
            }
        } catch (Exception ignored) {}
        try {
            if (ringtone != null && ringtone.isPlaying()) {
                ringtone.stop();
                ringtone = null;
                Log.d(TAG, "[CallLog] Ringtone stopped");
            }
            if (vibrator != null) {
                vibrator.cancel();
                vibrator = null;
                Log.d(TAG, "[CallLog] Vibrator cancelled");
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error stopping ringtone/vibrator: " + e.getMessage());
        }
    }

    private Notification buildIncomingCallNotification(String callId, String callerId, String callerName, String callType, String callerAvatarUrl) {
        boolean isVideo = "video".equalsIgnoreCase(callType);
        String callTypeText = isVideo ? "Incoming Video Call" : "Incoming Audio Call";

        // Full-screen takeover intent when screen is locked or app is backgrounded
        Intent fullScreenIntent = new Intent();
        fullScreenIntent.setClassName(this, "io.github.webviewtemplate.MainActivity");
        fullScreenIntent.setAction(Intent.ACTION_VIEW);
        fullScreenIntent.setData(Uri.parse("devnest://call?action=incoming&callId=" + callId + "&callerId=" + callerId + "&callType=" + callType + "&callerName=" + Uri.encode(callerName)));
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                this, (callId + "_fs").hashCode(), fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Answer Action
        Intent answerIntent = new Intent();
        answerIntent.setClassName(this, "io.github.webviewtemplate.MainActivity");
        answerIntent.setAction(Intent.ACTION_VIEW);
        answerIntent.setData(Uri.parse("devnest://call?action=answer&callId=" + callId + "&callerId=" + callerId + "&callType=" + callType + "&callerName=" + Uri.encode(callerName)));
        answerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent answerPendingIntent = PendingIntent.getActivity(
                this, (callId + "_ans").hashCode(), answerIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Decline Action
        Intent declineIntent = new Intent(this, IncomingCallReceiver.class);
        declineIntent.setAction(IncomingCallReceiver.ACTION_DECLINE);
        declineIntent.putExtra("callId", callId);
        declineIntent.putExtra("callerId", callerId);
        PendingIntent declinePendingIntent = PendingIntent.getBroadcast(
                this, (callId + "_dec").hashCode(), declineIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Person person = new Person.Builder()
                .setName(callerName)
                .setKey(callerId)
                .build();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_INCOMING_CALLS_V2)
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle(callerName)
                .setContentText(callTypeText)
                .setSubText(isVideo ? "Video call" : "Audio call")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setTimeoutAfter(30000)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setContentIntent(fullScreenPendingIntent);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+ CallStyle notification
            NotificationCompat.CallStyle callStyle = NotificationCompat.CallStyle.forIncomingCall(
                    person,
                    declinePendingIntent,
                    answerPendingIntent
            ).setIsVideo(isVideo);
            builder.setStyle(callStyle);
            Log.d(TAG, "[CallLog] Styled notification using NotificationCompat.CallStyle (Android 12+)");
        } else {
            // Heads-up actions for older Android versions
            builder.addAction(android.R.drawable.sym_call_outgoing, "Answer", answerPendingIntent);
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePendingIntent);
            Log.d(TAG, "[CallLog] Styled notification using heads-up action buttons");
        }

        return builder.build();
    }

    private Notification buildListenerNotification() {
        Intent launchIntent = new Intent();
        launchIntent.setClassName(this, "io.github.webviewtemplate.MainActivity");
        launchIntent.setAction(Intent.ACTION_MAIN);
        launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ONGOING_CALLS)
                .setContentTitle("DevNest Calling Service")
                .setContentText("Active in background • Ready for calls")
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();
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
