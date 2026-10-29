package com.devnest.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Window;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private AndroidCallBridge callBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Position app content directly below camera notch and status bar, dynamically matching system light/dark theme
        boolean isNight = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        applyStatusBarTheme(isNight);

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (view, insets) -> {
            Insets statusBarInsets = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(0, statusBarInsets.top, 0, 0);
            return insets;
        });

        // 2. Register native Android bridge for calling & system permissions
        initBridgeInterface();

        // 3. Handle lock screen takeover & cold-start incoming call intent
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        );

        Intent startIntent = getIntent();
        if (startIntent != null) {
            AndroidCallBridge.handleNewIntent(this, startIntent);
        }

        // 4. Prompt runtime permissions on startup
        requestAppPermissions();
    }

    public void applyStatusBarTheme(boolean isDark) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            int color = isDark ? Color.parseColor("#000000") : Color.parseColor("#edf2ef");
            window.setStatusBarColor(color);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, window.getDecorView());
                controller.setAppearanceLightStatusBars(!isDark);
            }
        }
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean isNight = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        applyStatusBarTheme(isNight);
    }

    private void initBridgeInterface() {
        if (callBridge == null) {
            callBridge = new AndroidCallBridge(this);
        }
        if (bridge != null && bridge.getWebView() != null) {
            AndroidCallBridge.setWebView(bridge.getWebView());
            bridge.getWebView().addJavascriptInterface(callBridge, "AndroidCallBridge");
            bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        AndroidCallBridge.handleNewIntent(this, intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (bridge != null && bridge.getWebView() != null) {
            AndroidCallBridge.setWebView(bridge.getWebView());
        }
        Intent currentIntent = getIntent();
        if (currentIntent != null && currentIntent.getData() != null) {
            AndroidCallBridge.handleNewIntent(this, currentIntent);
        }
        boolean isNight = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        applyStatusBarTheme(isNight);
        notifyPermissionsChanged();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        notifyPermissionsChanged();
    }

    public void notifyPermissionsChanged() {
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().post(() -> {
                bridge.getWebView().evaluateJavascript(
                    "if (window.refreshCallPermissions) { window.refreshCallPermissions(); }",
                    null
                );
            });
        }
    }

    public void requestAppPermissions() {
        List<String> neededPermissions = new ArrayList<>();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.RECORD_AUDIO);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.CAMERA);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.MODIFY_AUDIO_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.POST_NOTIFICATIONS);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.READ_MEDIA_IMAGES);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VIDEO) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.READ_MEDIA_VIDEO);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.READ_MEDIA_AUDIO);
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    neededPermissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
                }
            }
        }

        if (!neededPermissions.isEmpty()) {
            ActivityCompat.requestPermissions(this, neededPermissions.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }

    public void openAppSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", getPackageName(), null);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            // ignore
        }
    }
}
