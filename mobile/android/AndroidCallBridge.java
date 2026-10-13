package com.devnest.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;
import androidx.core.app.NotificationManagerCompat;

public class AndroidCallBridge {
    private static final String TAG = "DevNestCall";
    private final Context context;

    public AndroidCallBridge(Context context) {
        this.context = context;
        // Ensure channels are created as soon as bridge is instantiated on app start
        try {
            CallNotificationService.createNotificationChannels(context);
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error creating notification channels in bridge: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public void ensureChannelsCreated() {
        CallNotificationService.createNotificationChannels(context);
    }

    @JavascriptInterface
    public String checkNotificationPermissions() {
        boolean notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
        int channelImportance = NotificationManager.IMPORTANCE_DEFAULT;
        boolean channelValid = true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) {
                NotificationChannel channel = nm.getNotificationChannel(CallNotificationService.CHANNEL_INCOMING_CALLS_V2);
                if (channel != null) {
                    channelImportance = channel.getImportance();
                    channelValid = (channelImportance >= NotificationManager.IMPORTANCE_HIGH);
                } else {
                    // Not created yet -> create now
                    CallNotificationService.createNotificationChannels(context);
                }
            }
        }

        boolean canUseFullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) { // Android 14+ (API 34)
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) {
                canUseFullScreen = nm.canUseFullScreenIntent();
            }
        }

        boolean isIgnoringBattery = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                isIgnoringBattery = pm.isIgnoringBatteryOptimizations(context.getPackageName());
            }
        }

        String brand = Build.MANUFACTURER != null ? Build.MANUFACTURER.toLowerCase() : "";
        Log.d(TAG, "[CallLog] Permission check: notifs=" + notificationsEnabled +
                ", channelValid=" + channelValid +
                ", fullScreen=" + canUseFullScreen +
                ", batteryIgnored=" + isIgnoringBattery +
                ", brand=" + brand);

        return "{" +
                "\"notificationsEnabled\":" + notificationsEnabled + "," +
                "\"channelImportance\":" + channelImportance + "," +
                "\"channelValid\":" + channelValid + "," +
                "\"canUseFullScreenIntent\":" + canUseFullScreen + "," +
                "\"isIgnoringBatteryOptimizations\":" + isIgnoringBattery + "," +
                "\"brand\":\"" + brand + "\"" +
                "}";
    }

    @JavascriptInterface
    public void openNotificationSettings() {
        try {
            Intent intent = new Intent();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            } else {
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            Log.d(TAG, "[CallLog] Opened app notification settings");
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error opening notification settings: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public void openChannelSettings(String channelId) {
        try {
            String chId = (channelId != null && !channelId.isEmpty()) ? channelId : CallNotificationService.CHANNEL_INCOMING_CALLS_V2;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
                intent.putExtra(Settings.EXTRA_CHANNEL_ID, chId);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                Log.d(TAG, "[CallLog] Opened channel settings for " + chId);
            } else {
                openNotificationSettings();
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error opening channel settings: " + e.getMessage());
            openNotificationSettings();
        }
    }

    @JavascriptInterface
    public void openFullScreenIntentSettings() {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                Log.d(TAG, "[CallLog] Opened Android 14 full-screen intent settings");
            } else {
                openNotificationSettings();
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error opening full screen intent settings: " + e.getMessage());
            openNotificationSettings();
        }
    }

    @JavascriptInterface
    public void openBatteryOptimizationSettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                } else {
                    Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                }
                Log.d(TAG, "[CallLog] Opened battery optimization settings");
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error opening battery optimization settings: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public void testIncomingCall(String callerName, String callType, int delaySeconds) {
        final String name = (callerName != null && !callerName.isEmpty()) ? callerName : "DevNest Test Caller";
        final String type = (callType != null && !callType.isEmpty()) ? callType : "video";
        final int delay = Math.max(0, delaySeconds);
        final String testCallId = "test_call_" + System.currentTimeMillis();

        Log.d(TAG, "[CallLog] Scheduling local test incoming call: caller=" + name + ", type=" + type + ", delay=" + delay + "s, callId=" + testCallId);

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                Intent serviceIntent = new Intent(context, CallNotificationService.class);
                serviceIntent.setAction(CallNotificationService.ACTION_INCOMING_CALL);
                serviceIntent.putExtra("callId", testCallId);
                serviceIntent.putExtra("callerId", "999");
                serviceIntent.putExtra("callerName", name);
                serviceIntent.putExtra("callType", type);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
                Log.d(TAG, "[CallLog] Local test incoming call triggered successfully");
            } catch (Exception e) {
                Log.e(TAG, "[CallLog] Error triggering local test incoming call: " + e.getMessage());
            }
        }, delay * 1000L);
    }

    @JavascriptInterface
    public void onIncomingCall(String callId, String callerId, String callerName, String callType) {
        try {
            Log.d(TAG, "[CallLog] onIncomingCall received from WebView bridge: callId=" + callId + ", caller=" + callerName);
            Intent serviceIntent = new Intent(context, CallNotificationService.class);
            serviceIntent.setAction(CallNotificationService.ACTION_INCOMING_CALL);
            serviceIntent.putExtra("callId", callId != null ? callId : "");
            serviceIntent.putExtra("callerId", callerId != null ? callerId : "");
            serviceIntent.putExtra("callerName", callerName != null ? callerName : "DevNest User");
            serviceIntent.putExtra("callType", callType != null ? callType : "audio");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error in onIncomingCall: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public void stopCallAlerts() {
        try {
            Log.d(TAG, "[CallLog] stopCallAlerts received from WebView bridge");
            Intent stopIntent = new Intent(context, CallNotificationService.class);
            stopIntent.setAction(CallNotificationService.ACTION_STOP_CALL);
            context.startService(stopIntent);
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error in stopCallAlerts: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public void startBackgroundListener() {
        try {
            Intent serviceIntent = new Intent(context, CallNotificationService.class);
            serviceIntent.setAction(CallNotificationService.ACTION_START_LISTENER);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error starting background listener: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public void stopBackgroundListener() {
        try {
            Intent stopIntent = new Intent(context, CallNotificationService.class);
            stopIntent.setAction(CallNotificationService.ACTION_STOP_LISTENER);
            context.startService(stopIntent);
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error stopping background listener: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }
}
