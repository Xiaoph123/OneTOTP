# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── 原生扫码插件（CameraX + ZXing）──
# Tauri 插件模板存在 consumer-rules.pro 缺失的已知问题，导致插件自带的混淆规则
# 未生效（见 gen/android/gradle.properties 中 android.proguard.failOnMissingFiles=false）。
# ZXing 在解码时通过反射/内部类工作，且插件本身由 JNI 注册，需保留。
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**

# CameraX：预览与图像分析用例
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**

# 插件本体与扫描结果对象（含 JNI/反射调用）
-keep class app.tauri.barcodescanner.** { *; }
-keep class app.tauri.plugin.** { *; }