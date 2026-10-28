package com.devnest.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class CallNotificationService extends Service {
    private static final String TAG = "DevNestCall";

    private static Thread sNativeListenerThread = null;
    private static volatile boolean sKeepListening = false;

    // 1. Android Notification Channel Identifiers
    public static final String CHANNEL_INCOMING_CALLS_V3 = "incoming_calls_v3";
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

    private MediaPlayer mediaPlayer;
    private Ringtone ringtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private Handler fallbackRingtoneHandler;
    private Runnable fallbackRingtoneRunnable;

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
                    manager.deleteNotificationChannel("incoming_calls_v2");
                    manager.deleteNotificationChannel("nesty_calling_listener");
                } catch (Exception ignored) {}

                // Channel 1: incoming_calls_v3 (IMPORTANCE_HIGH, looping ringtone, DND bypass, repeating vibration)
                NotificationChannel incomingChannel = new NotificationChannel(
                        CHANNEL_INCOMING_CALLS_V3,
                        "Nesty Incoming Calls",
                        NotificationManager.IMPORTANCE_HIGH
                );
                incomingChannel.setDescription("High-priority full-screen incoming call alerts with looping ringtone");
                incomingChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                incomingChannel.setBypassDnd(true);
                incomingChannel.setShowBadge(false);

                Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (ringtoneUri == null) {
                    ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                }
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setLegacyStreamType(AudioManager.STREAM_RING)
                        .build();
                incomingChannel.setSound(ringtoneUri, audioAttributes);
                incomingChannel.enableVibration(true);
                incomingChannel.setVibrationPattern(new long[]{0, 1000, 1000, 1000, 1000, 1000});
                manager.createNotificationChannel(incomingChannel);

                // Channel 2: ongoing_calls (IMPORTANCE_LOW, silent foreground service)
                NotificationChannel ongoingChannel = new NotificationChannel(
                        CHANNEL_ONGOING_CALLS,
                        "Nesty Ongoing Call",
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
                        "Nesty Missed Calls",
                        NotificationManager.IMPORTANCE_DEFAULT
                );
                missedChannel.setDescription("Notifications for missed calls");
                missedChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(missedChannel);

                Log.d(TAG, "[CallLog] Notification channels created natively: incoming_calls_v3, ongoing_calls, missed_calls");
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
            stopNativeEventListener();
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
            if (sKeepListening) {
                Notification listenerNotification = buildListenerNotification();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(LISTENER_NOTIFICATION_ID, listenerNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                } else {
                    startForeground(LISTENER_NOTIFICATION_ID, listenerNotification);
                }
                return START_STICKY;
            } else {
                stopForeground(true);
                return START_NOT_STICKY;
            }
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
            if (sKeepListening) {
                Notification listenerNotification = buildListenerNotification();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(LISTENER_NOTIFICATION_ID, listenerNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                } else {
                    startForeground(LISTENER_NOTIFICATION_ID, listenerNotification);
                }
                return START_STICKY;
            } else {
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        if (ACTION_MISSED_CALL.equals(action)) {
            String callId = intent.getStringExtra("callId");
            String callerName = intent.getStringExtra("callerName");
            String callType = intent.getStringExtra("callType");
            if (callerName == null || callerName.isEmpty()) callerName = "Nesty User";
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
            if (sKeepListening) {
                Notification listenerNotification = buildListenerNotification();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(LISTENER_NOTIFICATION_ID, listenerNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                } else {
                    startForeground(LISTENER_NOTIFICATION_ID, listenerNotification);
                }
                return START_STICKY;
            } else {
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        if (ACTION_START_LISTENER.equals(action)) {
            Notification listenerNotification = buildListenerNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(LISTENER_NOTIFICATION_ID, listenerNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(LISTENER_NOTIFICATION_ID, listenerNotification);
            }
            startNativeEventListener();
            return START_STICKY;
        }

        // ACTION_INCOMING_CALL
        String callId = intent.getStringExtra("callId");
        String callerName = intent.getStringExtra("callerName");
        String callerId = intent.getStringExtra("callerId");
        String callType = intent.getStringExtra("callType");
        String callerAvatarUrl = intent.getStringExtra("callerAvatarUrl");
        if (callerName == null || callerName.isEmpty()) callerName = "Nesty User";

        int notificationId = getNotificationId(callId);
        Log.d(TAG, "[CallLog] Incoming call received: callId=" + callId + ", caller=" + callerName + ", type=" + callType + ", notifId=" + notificationId);

        acquireScreenWakeLock();
        startRingtoneAndVibration();

        Notification notification = buildIncomingCallNotification(callId, callerId, callerName, callType, callerAvatarUrl);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
        } else {
            startForeground(notificationId, notification);
        }
        Log.d(TAG, "[CallLog] Incoming call notification posted as foreground service: notifId=" + notificationId);

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
                        "Nesty:IncomingCallWakeLock"
                );
                wakeLock.acquire(30000);
                Log.d(TAG, "[CallLog] Acquired FULL_WAKE_LOCK for 30 seconds");
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error acquiring wake lock: " + e.getMessage());
        }
    }

    private synchronized void startRingtoneAndVibration() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            int ringerMode = am != null ? am.getRingerMode() : AudioManager.RINGER_MODE_NORMAL;
            Log.d(TAG, "[CallLog] startRingtoneAndVibration: ringerMode=" + ringerMode);

            // 1. Play continuous looping ringtone if not in silent mode
            if (ringerMode != AudioManager.RINGER_MODE_SILENT) {
                try {
                    Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                    if (ringtoneUri == null) {
                        ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    }

                    if (mediaPlayer != null) {
                        try {
                            if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                        } catch (Exception ignored) {}
                        try {
                            mediaPlayer.release();
                        } catch (Exception ignored) {}
                        mediaPlayer = null;
                    }

                    mediaPlayer = new MediaPlayer();
                    mediaPlayer.setDataSource(getApplicationContext(), ringtoneUri);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .setLegacyStreamType(AudioManager.STREAM_RING)
                                .build();
                        mediaPlayer.setAudioAttributes(audioAttributes);
                    } else {
                        mediaPlayer.setAudioStreamType(AudioManager.STREAM_RING);
                    }
                    mediaPlayer.setLooping(true);
                    mediaPlayer.prepare();
                    mediaPlayer.start();
                    Log.d(TAG, "[CallLog] MediaPlayer looping ringtone started successfully");
                } catch (Exception e) {
                    Log.w(TAG, "[CallLog] MediaPlayer failed: " + e.getMessage() + ", falling back to RingtoneManager");
                    try {
                        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                        if (ringtoneUri == null) {
                            ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                        }
                        ringtone = RingtoneManager.getRingtone(getApplicationContext(), ringtoneUri);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && ringtone != null) {
                            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .setLegacyStreamType(AudioManager.STREAM_RING)
                                    .build();
                            ringtone.setAudioAttributes(audioAttributes);
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && ringtone != null) {
                            ringtone.setLooping(true);
                        }
                        if (ringtone != null && !ringtone.isPlaying()) {
                            ringtone.play();
                            Log.d(TAG, "[CallLog] Fallback Ringtone started");
                        }

                        // Loop fallback for devices where Ringtone.play() doesn't loop
                        if (fallbackRingtoneHandler == null) {
                            fallbackRingtoneHandler = new Handler(Looper.getMainLooper());
                        }
                        fallbackRingtoneRunnable = new Runnable() {
                            @Override
                            public void run() {
                                if (ringtone != null && !ringtone.isPlaying()) {
                                    try {
                                        ringtone.play();
                                    } catch (Exception ignored) {}
                                }
                                if (fallbackRingtoneHandler != null) {
                                    fallbackRingtoneHandler.postDelayed(this, 3000);
                                }
                            }
                        };
                        fallbackRingtoneHandler.postDelayed(fallbackRingtoneRunnable, 3000);
                    } catch (Exception ex) {
                        Log.e(TAG, "[CallLog] Fallback Ringtone also failed: " + ex.getMessage());
                    }
                }
            }

            // 2. Play continuous vibration pattern if not in silent mode
            if (ringerMode != AudioManager.RINGER_MODE_SILENT) {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (vibrator != null) {
                    long[] pattern = {0, 1000, 1000, 1000, 1000, 1000};
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, 1));
                    } else {
                        vibrator.vibrate(pattern, 1);
                    }
                    Log.d(TAG, "[CallLog] Repeating vibration pattern started");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error playing ringtone/vibrator: " + e.getMessage());
        }
    }

    private synchronized void stopCallAlerts() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
                Log.d(TAG, "[CallLog] WakeLock released");
            }
        } catch (Exception ignored) {}
        try {
            if (mediaPlayer != null) {
                try {
                    if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                } catch (Exception ignored) {}
                try {
                    mediaPlayer.release();
                } catch (Exception ignored) {}
                mediaPlayer = null;
                Log.d(TAG, "[CallLog] MediaPlayer stopped & released");
            }
            if (fallbackRingtoneHandler != null && fallbackRingtoneRunnable != null) {
                fallbackRingtoneHandler.removeCallbacks(fallbackRingtoneRunnable);
                fallbackRingtoneHandler = null;
                fallbackRingtoneRunnable = null;
            }
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

        Uri ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (ringUri == null) ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_INCOMING_CALLS_V3)
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
                .setSound(ringUri, AudioManager.STREAM_RING)
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

        Notification notif = builder.build();
        notif.flags |= Notification.FLAG_INSISTENT;
        return notif;
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
                .setContentTitle("Nesty Calling Service")
                .setContentText("Active in background • Ready for calls")
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();
    }

    private synchronized void startNativeEventListener() {
        if (sKeepListening && sNativeListenerThread != null && sNativeListenerThread.isAlive()) {
            return;
        }
        sKeepListening = true;
        sNativeListenerThread = new Thread(() -> {
            Log.d(TAG, "[CallLog] Native background call event listener thread started");
            while (sKeepListening) {
                SharedPreferences prefs = getSharedPreferences("DevNestPrefs", Context.MODE_PRIVATE);
                String authToken = prefs.getString("auth_token", "");
                String apiUrl = prefs.getString("api_url", "https://nesty.onrender.com");

                if (authToken.isEmpty()) {
                    SharedPreferences capPrefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
                    authToken = capPrefs.getString("token", "");
                }

                if (authToken.isEmpty()) {
                    try {
                        Thread.sleep(3000);
                    } catch (InterruptedException ie) {
                        break;
                    }
                    continue;
                }

                HttpURLConnection conn = null;
                try {
                    String streamUrl = apiUrl.replaceAll("/+$", "") + "/api/call/events";
                    Log.d(TAG, "[CallLog] Connecting native background SSE to: " + streamUrl);
                    URL url = new URL(streamUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("Authorization", "Bearer " + authToken);
                    conn.setRequestProperty("Accept", "text/event-stream");
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(45000);

                    int responseCode = conn.getResponseCode();
                    Log.d(TAG, "[CallLog] Native background SSE connected: HTTP " + responseCode);

                    if (responseCode == 200) {
                        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                        String line;
                        while (sKeepListening && (line = reader.readLine()) != null) {
                            line = line.trim();
                            if (line.startsWith("data:")) {
                                String jsonStr = line.substring(5).trim();
                                handleNativeBackgroundCallSignal(jsonStr);
                            }
                        }
                    } else if (responseCode == 401) {
                        Log.w(TAG, "[CallLog] Native background SSE 401 unauthorized, waiting 10s");
                        Thread.sleep(10000);
                    } else {
                        Log.w(TAG, "[CallLog] Native background SSE HTTP " + responseCode + ", waiting 5s");
                        Thread.sleep(5000);
                    }
                } catch (Exception e) {
                    if (sKeepListening) {
                        Log.w(TAG, "[CallLog] Native background SSE connection interrupted: " + e.getMessage() + ", reconnecting in 3s");
                        try {
                            Thread.sleep(3000);
                        } catch (InterruptedException ie) {
                            break;
                        }
                    }
                } finally {
                    if (conn != null) {
                        try { conn.disconnect(); } catch (Exception ignored) {}
                    }
                }
            }
            Log.d(TAG, "[CallLog] Native background call event listener thread terminated");
        }, "Nesty-NativeListener");
        sNativeListenerThread.setDaemon(true);
        sNativeListenerThread.start();
    }

    private synchronized void stopNativeEventListener() {
        sKeepListening = false;
        if (sNativeListenerThread != null) {
            try {
                sNativeListenerThread.interrupt();
            } catch (Exception ignored) {}
            sNativeListenerThread = null;
        }
    }

    private void handleNativeBackgroundCallSignal(String jsonStr) {
        try {
            JSONObject obj = new JSONObject(jsonStr);
            String type = obj.optString("type", "");
            Log.d(TAG, "[CallLog] Native background event received: type=" + type);

            if ("call_invite".equals(type)) {
                JSONObject data = obj.optJSONObject("data");
                String callId = data != null ? data.optString("callId", "") : obj.optString("callId", "");
                boolean isVideo = data != null ? data.optBoolean("isVideo", false) : false;
                String callType = isVideo ? "video" : "audio";

                String fromUserId = String.valueOf(obj.opt("from_user_id"));
                String callerName = "Nesty User";
                String callerAvatarUrl = "";
                JSONObject caller = obj.optJSONObject("caller");
                if (caller != null) {
                    callerName = caller.optString("name", caller.optString("username", "Nesty User"));
                    callerAvatarUrl = caller.optString("avatar_url", "");
                }

                // If app is in foreground and phone is unlocked, in-app modal handles it
                boolean isFg = AndroidCallBridge.isAppForeground();
                boolean isLocked = AndroidCallBridge.isDeviceLocked(this);
                if (isFg && !isLocked) {
                    Log.d(TAG, "[CallLog] App is in foreground and unlocked; in-app UI handles call");
                    return;
                }

                Intent incomingIntent = new Intent(this, CallNotificationService.class);
                incomingIntent.setAction(ACTION_INCOMING_CALL);
                incomingIntent.putExtra("callId", callId);
                incomingIntent.putExtra("callerId", fromUserId);
                incomingIntent.putExtra("callerName", callerName);
                incomingIntent.putExtra("callerAvatarUrl", callerAvatarUrl);
                incomingIntent.putExtra("callType", callType);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(incomingIntent);
                } else {
                    startService(incomingIntent);
                }
            } else if ("call_cancelled".equals(type) || "call_declined".equals(type) || "call_ended".equals(type)) {
                JSONObject data = obj.optJSONObject("data");
                String callId = data != null ? data.optString("callId", "") : "";
                stopCallAlerts();
                if (!callId.isEmpty()) {
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null) {
                        nm.cancel(getNotificationId(callId));
                    }
                }
                AndroidCallBridge.restoreLockScreen(null);

                // Restore listener notification
                if (sKeepListening) {
                    Notification listenerNotification = buildListenerNotification();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(LISTENER_NOTIFICATION_ID, listenerNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                    } else {
                        startForeground(LISTENER_NOTIFICATION_ID, listenerNotification);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error parsing native call signal: " + e.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        stopCallAlerts();
        stopNativeEventListener();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
