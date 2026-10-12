package com.devnest.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.webkit.JavascriptInterface;

public class AndroidCallBridge {
    private final Context context;

    public AndroidCallBridge(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public void onIncomingCall(String callId, String callerId, String callerName, String callType) {
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                PowerManager.WakeLock wl = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK |
                        PowerManager.ACQUIRE_CAUSES_WAKEUP |
                        PowerManager.ON_AFTER_RELEASE,
                        "DevNest:BridgeWakeLock"
                );
                wl.acquire(45000);
            }

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

            Intent bringToFront = new Intent();
            bringToFront.setClassName(context, "io.github.webviewtemplate.MainActivity");
            bringToFront.setAction(Intent.ACTION_VIEW);
            bringToFront.setData(Uri.parse("devnest://call?action=incoming&callId=" + callId + "&callerId=" + callerId + "&callType=" + callType));
            bringToFront.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            context.startActivity(bringToFront);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @JavascriptInterface
    public void stopCallAlerts() {
        try {
            Intent stopIntent = new Intent(context, CallNotificationService.class);
            stopIntent.setAction(CallNotificationService.ACTION_STOP_CALL);
            context.startService(stopIntent);
        } catch (Exception e) {
            e.printStackTrace();
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

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
                    Intent req = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    req.setData(Uri.parse("package:" + context.getPackageName()));
                    req.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(req);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @JavascriptInterface
    public void stopBackgroundListener() {
        try {
            Intent stopIntent = new Intent(context, CallNotificationService.class);
            stopIntent.setAction(CallNotificationService.ACTION_STOP_LISTENER);
            context.startService(stopIntent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }
}
