package com.devnest.app;

import android.app.Activity;
import android.app.Application;
import android.app.KeyguardManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.NotificationManagerCompat;

public class AndroidCallBridge {
    private static final String TAG = "DevNestCall";
    private static Activity sActivity = null;
    private static WebView sWebView = null;
    private static String sPendingCallActionJson = null;
    private static volatile boolean sIsForeground = false;
    private static boolean sLifecycleRegistered = false;

    private final Context context;

    public AndroidCallBridge(Context context) {
        this.context = context;
        if (context instanceof Activity) {
            sActivity = (Activity) context;
            handleNewIntent(sActivity, sActivity.getIntent());
            registerLifecycle(sActivity);
        }
        // Ensure channels are created as soon as bridge is instantiated on app start
        try {
            CallNotificationService.createNotificationChannels(context);
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error creating notification channels in bridge: " + e.getMessage());
        }
    }

    private static synchronized void registerLifecycle(Activity activity) {
        if (sLifecycleRegistered || activity == null) return;
        try {
            Application app = activity.getApplication();
            if (app != null) {
                app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
                    @Override
                    public void onActivityResumed(Activity a) {
                        if (a == sActivity) {
                            sIsForeground = true;
                            Log.d(TAG, "[CallLog] DevNest activity resumed -> isForeground=true");
                        }
                    }

                    @Override
                    public void onActivityPaused(Activity a) {
                        if (a == sActivity) {
                            sIsForeground = false;
                            Log.d(TAG, "[CallLog] DevNest activity paused -> isForeground=false");
                        }
                    }

                    @Override public void onActivityCreated(Activity a, Bundle b) {}
                    @Override public void onActivityStarted(Activity a) {}
                    @Override public void onActivityStopped(Activity a) {}
                    @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
                    @Override public void onActivityDestroyed(Activity a) {
                        if (a == sActivity) {
                            sActivity = null;
                            sIsForeground = false;
                        }
                    }
                });
                sLifecycleRegistered = true;
                sIsForeground = true;
            }
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error registering lifecycle callbacks: " + e.getMessage());
        }
    }

    public static boolean isAppForeground() {
        return sIsForeground;
    }

    public static boolean isDeviceLocked(Context ctx) {
        if (ctx == null) ctx = sActivity;
        if (ctx == null) return false;
        try {
            KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
            return km != null && km.isKeyguardLocked();
        } catch (Exception e) {
            return false;
        }
    }

    public static void setWebView(WebView webView) {
        sWebView = webView;
    }

    public static void handleNewIntent(Activity activity, Intent intent) {
        if (activity != null) {
            sActivity = activity;
        }
        if (intent == null) return;

        Uri data = intent.getData();
        Log.d(TAG, "[CallLog] handleNewIntent data=" + data);

        if (data != null && "devnest".equalsIgnoreCase(data.getScheme()) && "call".equalsIgnoreCase(data.getHost())) {
            String action = data.getQueryParameter("action");
            String callId = data.getQueryParameter("callId");
            String callerId = data.getQueryParameter("callerId");
            String callType = data.getQueryParameter("callType");
            String callerName = data.getQueryParameter("callerName");

            if (action == null) action = "incoming";
            if (callId == null) callId = "";
            if (callerId == null) callerId = "";
            if (callType == null) callType = "video";
            if (callerName == null) callerName = "Nesty User";

            sPendingCallActionJson = "{" +
                    "\"action\":\"" + action + "\"," +
                    "\"callId\":\"" + callId + "\"," +
                    "\"callerId\":\"" + callerId + "\"," +
                    "\"callType\":\"" + callType + "\"," +
                    "\"callerName\":\"" + callerName + "\"" +
                    "}";

            // If incoming or answer on locked screen, wake up screen and show over keyguard
            takeOverLockScreen(activity);

            // If WebView is ready, trigger JavaScript handler immediately
            if (sWebView != null) {
                final String jsAction = action;
                final String jsCallId = callId;
                final String jsCallerId = callerId;
                final String jsCallType = callType;
                sWebView.post(() -> {
                    String script = "if (window.handleNativeCallAction) { window.handleNativeCallAction('" +
                            jsAction + "', '" + jsCallId + "', '" + jsCallerId + "', '" + jsCallType + "'); }";
                    sWebView.evaluateJavascript(script, null);
                });
            }
        }
    }

    public static void takeOverLockScreen(Activity activity) {
        if (activity == null) activity = sActivity;
        if (activity == null) return;

        final Activity act = activity;
        act.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    act.setShowWhenLocked(true);
                    act.setTurnScreenOn(true);
                }
                act.getWindow().addFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                );
                Log.d(TAG, "[CallLog] Window flags applied for lock-screen takeover");
            } catch (Exception e) {
                Log.e(TAG, "[CallLog] Error in takeOverLockScreen: " + e.getMessage());
            }
        });
    }

    public static void restoreLockScreen(Activity activity) {
        if (activity == null) activity = sActivity;
        if (activity == null) return;

        final Activity act = activity;
        act.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    act.setShowWhenLocked(false);
                    act.setTurnScreenOn(false);
                }
                act.getWindow().clearFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                );

                KeyguardManager km = (KeyguardManager) act.getSystemService(Context.KEYGUARD_SERVICE);
                if (km != null && km.isKeyguardLocked()) {
                    Log.d(TAG, "[CallLog] Device is locked; moving task to back to return to secure lock screen");
                    act.moveTaskToBack(true);
                } else {
                    Log.d(TAG, "[CallLog] Device is unlocked; keeping app in current state");
                }
            } catch (Exception e) {
                Log.e(TAG, "[CallLog] Error in restoreLockScreen: " + e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public boolean isDeviceLocked() {
        try {
            KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
            return km != null && km.isKeyguardLocked();
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public void takeOverLockScreen() {
        takeOverLockScreen(sActivity);
    }

    @JavascriptInterface
    public void restoreLockScreen() {
        restoreLockScreen(sActivity);
    }

    @JavascriptInterface
    public void onCallEnded() {
        stopCallAlerts();
        restoreLockScreen(sActivity);
    }

    @JavascriptInterface
    public String getPendingCallAction() {
        String pending = sPendingCallActionJson;
        sPendingCallActionJson = null;
        return pending != null ? pending : "";
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
                NotificationChannel channel = nm.getNotificationChannel(CallNotificationService.CHANNEL_INCOMING_CALLS_V3);
                if (channel != null) {
                    channelImportance = channel.getImportance();
                    channelValid = (channelImportance >= NotificationManager.IMPORTANCE_HIGH);
                } else {
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
            String chId = (channelId != null && !channelId.isEmpty()) ? channelId : CallNotificationService.CHANNEL_INCOMING_CALLS_V3;
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
        final String name = (callerName != null && !callerName.isEmpty()) ? callerName : "Nesty Test Caller";
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
        onIncomingCall(callId, callerId, callerName, callType, false);
    }

    @JavascriptInterface
    public void onIncomingCall(String callId, String callerId, String callerName, String callType, boolean isForeground) {
        try {
            boolean locked = isDeviceLocked();
            Log.d(TAG, "[CallLog] onIncomingCall received: callId=" + callId + ", caller=" + callerName + ", isForeground=" + isForeground + ", isLocked=" + locked);

            // If app is currently visible to the user and the phone is unlocked,
            // the WebView in-app UI is already displaying the Decline and Answer buttons!
            // We suppress posting the heads-up notification banner to avoid duplicate 2 decline & 2 answer buttons!
            if (isForeground && !locked) {
                Log.d(TAG, "[CallLog] App is in foreground and phone is unlocked; in-app UI handles call — suppressing notification banner.");
                return;
            }

            Intent serviceIntent = new Intent(context, CallNotificationService.class);
            serviceIntent.setAction(CallNotificationService.ACTION_INCOMING_CALL);
            serviceIntent.putExtra("callId", callId != null ? callId : "");
            serviceIntent.putExtra("callerId", callerId != null ? callerId : "");
            serviceIntent.putExtra("callerName", callerName != null ? callerName : "Nesty User");
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
    public void dismissNotification(String callId) {
        try {
            Intent stopIntent = new Intent(context, CallNotificationService.class);
            stopIntent.setAction(CallNotificationService.ACTION_DISMISS_NOTIFICATION);
            stopIntent.putExtra("callId", callId != null ? callId : "");
            context.startService(stopIntent);
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error in dismissNotification: " + e.getMessage());
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
    public void setAuthToken(String token, String apiUrl) {
        if (token == null) token = "";
        if (apiUrl == null || apiUrl.isEmpty()) apiUrl = "https://nesty.onrender.com";
        try {
            SharedPreferences prefs = context.getSharedPreferences("DevNestPrefs", Context.MODE_PRIVATE);
            prefs.edit().putString("auth_token", token).putString("api_url", apiUrl).apply();
            Log.d(TAG, "[CallLog] Saved auth token in DevNestPrefs (token len=" + token.length() + ")");
            // Start or refresh background calling listener
            startBackgroundListener();
        } catch (Exception e) {
            Log.e(TAG, "[CallLog] Error saving auth token in bridge: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public String getDeviceToken() {
        try {
            SharedPreferences prefs = context.getSharedPreferences("DevNestPrefs", Context.MODE_PRIVATE);
            String token = prefs.getString("fcm_token", "");
            if (token.isEmpty()) {
                token = prefs.getString("native_device_id", "");
                if (token.isEmpty()) {
                    token = "native_android_" + System.currentTimeMillis();
                    prefs.edit().putString("native_device_id", token).apply();
                }
            }
            return token;
        } catch (Exception e) {
            return "native_android_" + System.currentTimeMillis();
        }
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    @JavascriptInterface
    public void setOrientation(String mode) {
        if (sActivity == null) return;
        sActivity.runOnUiThread(() -> {
            try {
                if ("landscape".equalsIgnoreCase(mode)) {
                    sActivity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                } else if ("portrait".equalsIgnoreCase(mode)) {
                    sActivity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                } else {
                    sActivity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                }
            } catch (Exception e) {
                Log.e(TAG, "[CallLog] Error setting orientation: " + e.getMessage());
            }
        });
    }
}
