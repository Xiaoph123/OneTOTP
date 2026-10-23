// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package app.tauri.barcodescanner

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.util.Log
import android.util.Size
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.result.ActivityResult
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.ListenableFuture
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.util.Collections
import java.util.concurrent.ExecutionException

private const val TAG = "QrScannerPlugin"
private const val PERMISSION_ALIAS_CAMERA = "camera"
private const val PERMISSION_NAME = Manifest.permission.CAMERA

/**
 * 分析器分辨率：与 Aegis 一致，兼顾识别率与性能。
 */
private val SCAN_RESOLUTION = Size(1200, 1600)

@InvokeArg
class ScanOptions {
    var formats: Array<String>? = null
    var windowed: Boolean = false
    var cameraDirection: String? = null
}

/**
 * 离线二维码扫描插件（Android）。
 *
 * 与官方 tauri-plugin-barcode-scanner 的唯一区别：解码器从 Google ML Kit 换成 ZXing。
 * 原因：ML Kit 依赖 Google Play 服务（即使 bundled 版也引入 GMS 基础库），
 * 与「纯离线、不依赖 GMS」的定位冲突；ZXing 为纯 Java 实现，零 Google 依赖，
 * 且模型无需下载、完全离线。
 *
 * 解码流程参照 Aegis（beemdevelopment/Aegis）的 QrCodeAnalyzer：
 * 直接取 YUV_420_888 的 Y 平面构造 PlanarYUVLuminanceSource，避免 RGB 转换开销。
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera")
    ]
)
class BarcodeScannerPlugin(private val activity: Activity) : Plugin(activity),
    ImageAnalysis.Analyzer {
    private lateinit var webView: WebView
    private var previewView: PreviewView? = null
    private var cameraProviderFuture: ListenableFuture<ProcessCameraProvider>? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var graphicOverlay: GraphicOverlay? = null
    private var scanMaskView: ScanMaskView? = null
    private var camera: Camera? = null
        set(value) {
            field = value
            activeCamera = value
        }
    private var vibrator: Vibrator? = null

    /** ZXing 多格式读取器（本插件只用于二维码） */
    private var reader: MultiFormatReader? = null
    private var hints: Map<DecodeHintType, Any>? = null

    private var requestPermissionResponse: JSObject? = null
    private var windowed = false

    private val supportedFormats = supportedFormats()

    private var savedInvoke: Invoke? = null
    private var webViewBackground: Drawable? = null

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
    }

    private fun supportedFormats(): Map<String, BarcodeFormat> {
        val map: MutableMap<String, BarcodeFormat> = HashMap()
        map["UPC_A"] = BarcodeFormat.UPC_A
        map["UPC_E"] = BarcodeFormat.UPC_E
        map["EAN_8"] = BarcodeFormat.EAN_8
        map["EAN_13"] = BarcodeFormat.EAN_13
        map["CODE_39"] = BarcodeFormat.CODE_39
        map["CODE_93"] = BarcodeFormat.CODE_93
        map["CODE_128"] = BarcodeFormat.CODE_128
        map["CODABAR"] = BarcodeFormat.CODABAR
        map["ITF"] = BarcodeFormat.ITF
        map["AZTEC"] = BarcodeFormat.AZTEC
        map["DATA_MATRIX"] = BarcodeFormat.DATA_MATRIX
        map["PDF_417"] = BarcodeFormat.PDF_417
        map["QR_CODE"] = BarcodeFormat.QR_CODE
        return Collections.unmodifiableMap(map)
    }

    private fun hasCamera(): Boolean {
        return activity.packageManager
            .hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)
    }

    private fun setupCamera(cameraDirection: String, windowed: Boolean) {
        activity
            .runOnUiThread {
                val previewView = PreviewView(activity)
                previewView.layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                this.previewView = previewView

                val graphicOverlay = GraphicOverlay(activity)
                graphicOverlay.layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                this.graphicOverlay = graphicOverlay

                val parent = webView.parent as ViewGroup
                parent.addView(previewView)
                parent.addView(graphicOverlay)

                // 取景蒙版：叠在相机画面之上，只做视觉引导与两个按钮的点击，
                // 不参与任何相机逻辑（不持有 Camera / Preview / ImageAnalysis）。
                // 放在 graphicOverlay 之后，保证盖住未来可能添加的识别框。
                val mask = ScanMaskView(
                    activity,
                    onBack = { cancelScan() },
                    onManualInput = { requestManualInput() },
                )
                mask.layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                parent.addView(mask)
                this.scanMaskView = mask

                this.windowed = windowed
                if (windowed) {
                    webView.bringToFront()
                    webViewBackground = webView.background
                    webView.setBackgroundColor(Color.TRANSPARENT)
                }

                val cameraProviderFuture = ProcessCameraProvider.getInstance(activity)
                cameraProviderFuture.addListener(
                    {
                        try {
                            val cameraProvider = cameraProviderFuture.get()
                            bindPreview(
                                cameraProvider,
                                if (cameraDirection == "front") CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
                            )
                            this.cameraProvider = cameraProvider
                        } catch (e: InterruptedException) {
                            Log.e(TAG, "获取相机实例被中断", e)
                        } catch (e: ExecutionException) {
                            Log.e(TAG, "获取相机实例失败", e)
                        }
                    },
                    ContextCompat.getMainExecutor(activity)
                )
                this.cameraProviderFuture = cameraProviderFuture
            }
    }

    private fun bindPreview(cameraProvider: ProcessCameraProvider, cameraDirection: Int) {
        activity
            .runOnUiThread {
                // Preview 与分析帧使用同一分辨率。
                //
                // 为什么必须一致：蒙版要把「屏幕上的取景框」换算成「分析帧里的裁剪矩形」，
                // 这个换算只有在两者视野相同时才成立（否则预览看到的范围和分析的
                // 范围不同，框内框外就对不上）。CameraX 在未指定分辨率时会按 View
                // 宽高比挑一个，与 ImageAnalysis 的 3:4 不一致，因此这里显式对齐。
                //
                // 副作用：预览从「按屏幕比例」变成 3:4，横向视野略窄、画面更放大。
                // 对扫码是正向的（二维码更大更好认）。
                val preview = Preview.Builder()
                    .setTargetResolution(SCAN_RESOLUTION)
                    .build()
                val cameraSelector =
                    CameraSelector.Builder().requireLensFacing(cameraDirection).build()
                preview.setSurfaceProvider(previewView?.surfaceProvider)
                val imageAnalysis = ImageAnalysis.Builder()
                    // 只保留最新帧，防止解码慢于采集时帧堆积
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setTargetResolution(SCAN_RESOLUTION)
                    .build()
                imageAnalysis.setAnalyzer(
                    ContextCompat.getMainExecutor(activity),
                    this
                )

                try {
                    camera = cameraProvider.bindToLifecycle(
                        activity as LifecycleOwner,
                        cameraSelector,
                        preview,
                        imageAnalysis
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "绑定相机遇例失败", e)
                }
            }
    }

    private fun dismantleCamera() {
        activity
            .runOnUiThread {
                // 解绑相机只在 provider 就绪时才有意义
                cameraProvider?.unbindAll()
                // 视图移除必须无条件执行：蒙版在 provider 就绪前就已挂上，
                // 若相机初始化失败（权限被拒 / 无可用镜头），provider 为 null，
                // 用 provider 做守卫会让蒙版永久留在界面上。
                val parent = webView.parent as? ViewGroup
                parent?.removeView(previewView)
                parent?.removeView(graphicOverlay)
                parent?.removeView(scanMaskView)
                camera = null
                previewView = null
                graphicOverlay = null
                scanMaskView = null
            }
    }

    /**
     * 蒙版上的「返回」：与系统返回键走同一条路径。
     *
     * 先拒绝待处理的 scan Promise（前端 catch 到 "cancelled" 后回到扫码页签），
     * 再销毁相机。顺序不能反：destroy() 会清掉 savedInvoke 之外的状态，
     * 但 Promise 必须由 reject 结束，否则前端会一直停在「正在识别」。
     */
    private fun cancelScan() {
        savedInvoke?.reject("cancelled")
        savedInvoke = null
        destroy()
    }

    /**
     * 蒙版上的「手动输入代码」：通知前端切到「手动」页签。
     *
     * 这里**只**发通知，不主动关闭相机。关闭动作由前端钩子自己调用 `cancel()`，
     * 这样顺序是确定的：前端先置位「主动切换」标记 → 再 cancel → Promise 拒绝时
     * 标记已就绪，不会误报「已取消扫码」。若由原生先 reject，标记可能还没置位。
     */
    private fun requestManualInput() {
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "(window.__onScanManualInput && window.__onScanManualInput())",
                null
            )
        }
    }

    private fun getFormats(args: ScanOptions): List<BarcodeFormat> {
        val formats = ArrayList<BarcodeFormat>()
        for (format in args.formats ?: arrayOf()) {
            val targeted = supportedFormats[format]
            if (targeted != null) {
                formats.add(targeted)
            }
        }
        return formats
    }

    private fun prepare(direction: String, windowed: Boolean) {
        dismantleCamera()
        setupCamera(direction, windowed)
    }

    private fun destroy() {
        dismantleCamera()
        savedInvoke = null
        if (windowed) {
            if (webViewBackground != null) {
                webView.background = webViewBackground
                webViewBackground = null
            } else {
                webView.setBackgroundColor(Color.WHITE)
            }
        }
    }

    /** 初始化 ZXing 读取器与提示参数（仅需一次） */
    private fun configureReader(formats: List<BarcodeFormat>) {
        val reader = MultiFormatReader()
        val hints = HashMap<DecodeHintType, Any>()
        hints[DecodeHintType.POSSIBLE_FORMATS] =
            if (formats.isNotEmpty()) formats else listOf(BarcodeFormat.QR_CODE)
        // 关闭 TRY_HARDER：实时扫描优先保证帧率，且二维码本身易识别
        hints[DecodeHintType.TRY_HARDER] = false
        reader.setHints(hints)
        this.reader = reader
        this.hints = hints
    }

    /**
     * 逐帧解码：直接取 Y 平面给 ZXing，避免 YUV→RGB 转换。
     * 参照 Aegis 的 QrCodeAnalyzer 实现。
     *
     * 只解码取景框内的区域：蒙版把框的位置换算成帧坐标（见
     * [ScanMaskView.cropRectForImage]），这里按该矩形裁剪后再交给 ZXing。
     * 这样「框外扫不到」与用户直觉一致，也省掉框外区域的二值化开销。
     */
    @SuppressLint("UnsafeOptInUsageError")
    override fun analyze(image: ImageProxy) {
        try {
            if (image.format != android.graphics.ImageFormat.YUV_420_888) {
                Log.e(TAG, "非预期的图像格式: ${image.format}")
                return
            }
            val currentReader = reader ?: return
            val plane = image.planes[0]
            val buf = plane.buffer
            val data = ByteArray(buf.remaining())
            buf.get(data)
            buf.rewind()

            // 换算失败（蒙版尚未布局 / 尺寸异常）时回退整帧，宁可多扫也不要漏扫
            val crop = scanMaskView?.cropRectForImage(
                image.width,
                image.height,
                image.imageInfo.rotationDegrees,
            )
            val left = crop?.left ?: 0
            val top = crop?.top ?: 0
            val cropW = crop?.width() ?: image.width
            val cropH = crop?.height() ?: image.height

            val source = PlanarYUVLuminanceSource(
                data,
                plane.rowStride,
                image.height,
                left,
                top,
                cropW,
                cropH,
                false
            )
            val bitmap = BinaryBitmap(HybridBinarizer(source))

            try {
                val result = currentReader.decode(bitmap, hints)
                val rawValue = result.text ?: ""
                if (rawValue.isNotEmpty()) {
                    val jsObject = JSObject()
                    jsObject.put("content", rawValue)
                    jsObject.put("format", formatName(result.barcodeFormat))
                    jsObject.put("bounds", result.resultPoints?.joinToString(";") { "${it.x},${it.y}" })
                    savedInvoke?.resolve(jsObject)
                    destroy()
                }
            } catch (e: com.google.zxing.NotFoundException) {
                // 本帧未识别到码，属正常情况
            } catch (e: Exception) {
                Log.e(TAG, "解码异常", e)
            }
        } finally {
            image.close()
        }
    }

    private fun formatName(format: BarcodeFormat?): String? {
        if (format == null) return null
        for (entry in supportedFormats.entries) {
            if (entry.value == format) return entry.key
        }
        return null
    }

    @Command
    fun vibrate(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(
                VibrationEffect.createOneShot(
                    50,
                    VibrationEffect.DEFAULT_AMPLITUDE
                )
            )
        }
        invoke.resolve()
    }

    @Command
    fun cancel(invoke: Invoke) {
        // 先拒绝待处理的 scan Promise，再销毁，否则 Promise 永不结束。
        cancelScan()
        invoke.resolve()
    }

    @Command
    fun scan(invoke: Invoke) {
        val args = invoke.parseArgs(ScanOptions::class.java)

        savedInvoke = invoke
        if (hasCamera()) {
            if (getPermissionState("camera") != PermissionState.GRANTED) {
                throw Exception("No permission to use camera. Did you request it yet?")
            } else {
                webViewBackground = null
                configureReader(getFormats(args))
                prepare(args.cameraDirection ?: "back", args.windowed)
            }
        } else {
            invoke.reject("No camera available")
        }
    }

    @PermissionCallback
    fun cameraPermissionCallback(invoke: Invoke) {
        if (requestPermissionResponse == null) {
            return
        }

        val requestPermissionResponse = requestPermissionResponse!!

        val granted = getPermissionState(PERMISSION_ALIAS_CAMERA) === PermissionState.GRANTED

        if (granted) {
            requestPermissionResponse.put(PERMISSION_ALIAS_CAMERA, PermissionState.GRANTED)
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                requestPermissionResponse.put(PERMISSION_ALIAS_CAMERA, PermissionState.DENIED)
            } else {
                requestPermissionResponse.put(PERMISSION_ALIAS_CAMERA, PermissionState.GRANTED)
            }
        }

        invoke.resolve(requestPermissionResponse)
        this.requestPermissionResponse = null
    }

    @Command
    override fun requestPermissions(invoke: Invoke) {
        val requestPermissionResponse = JSObject()
        this.requestPermissionResponse = requestPermissionResponse
        if (getPermissionState(PERMISSION_ALIAS_CAMERA) === PermissionState.GRANTED) {
            requestPermissionResponse.put(PERMISSION_ALIAS_CAMERA, PermissionState.GRANTED)
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                requestPermissionForAlias(
                    PERMISSION_ALIAS_CAMERA,
                    invoke,
                    "cameraPermissionCallback"
                )
                return
            } else {
                requestPermissionResponse.put(PERMISSION_ALIAS_CAMERA, PermissionState.GRANTED)
            }
        }
        invoke.resolve(requestPermissionResponse)
    }

    @Command
    fun openAppSettings(invoke: Invoke) {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", activity.packageName, null)
        )
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivityForResult(invoke, intent, "openSettingsResult")
    }

    @ActivityCallback
    private fun openSettingsResult(invoke: Invoke, result: ActivityResult) {
        invoke.resolve()
    }

    companion object {
        @Volatile
        private var activeCamera: Camera? = null

        @JvmStatic
        fun getActiveCamera(): Camera? = activeCamera
    }
}
