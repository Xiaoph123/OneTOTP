package app.tauri.barcodescanner

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import kotlin.math.max
import kotlin.math.min

/**
 * 扫码取景蒙版。
 *
 * 为什么放在原生层而不是前端：`scan({ windowed: false })` 时 WebView 被压在
 * 原生相机预览之下，任何 CSS 遮罩都在画面背后不可见。本 View 与 PreviewView
 * 同属 `webView.parent`，叠在相机画面之上，因此能真正盖住取景内容。
 *
 * 本类**不参与任何相机逻辑**：不持有 Camera / Preview / ImageAnalysis 引用，
 * 只负责绘制与两个按钮的点击回调。移除它不会影响扫码功能。
 *
 * 绘制内容（对应设计稿 E3）：
 * - 四周 60% 黑色遮罩，中间镂空方形取景区
 * - 四角源力蓝括号
 * - 上下往复的扫描线（带辉光渐变）
 * - 顶部标题 + 左上角胶囊「返回」
 * - 底部提示文案 + 「手动输入代码」主按钮
 */
class ScanMaskView(
    context: Context,
    private val onBack: () -> Unit,
    private val onManualInput: () -> Unit,
) : View(context) {

    private fun dp(v: Float): Float =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)

    private fun sp(v: Float): Float =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, resources.displayMetrics)

    /** 原生层拿不到前端 i18n，按系统语言二选一，避免出现中英混排 */
    private val zh: Boolean =
        resources.configuration.locales[0].language.startsWith("zh")

    private val textTitle = if (zh) "扫描二维码" else "Scan QR code"
    private val textBack = if (zh) "返回" else "Back"
    private val textTip = if (zh) "将二维码放入框内，即可自动识别" else "Place the QR code inside the frame"
    private val textManual = if (zh) "手动输入代码" else "Enter code manually"

    private val scrimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(153, 0, 0, 0)
    }

    /**
     * 遮罩路径：外框 + 镂空内框，用奇偶填充一次画完。
     *
     * 为什么不用四块矩形拼接：相邻矩形共享边界时，抗锯齿会让边界像素各自
     * 只覆盖约 50%，两次叠加仍不到 100% 不透明度，于是沿镂空边缘出现一条
     * 比周围更亮的细线（四个角是两条缝的交点，最明显）。
     * 单条路径 + EVEN_ODD 没有拼接边界，内边缘还能保持平滑。
     */
    private val scrimPath = Path().apply {
        fillType = Path.FillType.EVEN_ODD
    }

    /** 顶部额外压暗一层：遮罩本身只有 60%，遇到白墙等极亮画面时白字仍可能发虚 */
    private val topScrimPaint = Paint(Paint.ANTI_ALIAS_FLAG)

    private val cornerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#1664FF")
        style = Paint.Style.STROKE
        strokeWidth = dp(2.5f)
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private val scanPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }

    private val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(97, 0, 0, 0)
        style = Paint.Style.FILL
    }

    private val pillBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(41, 255, 255, 255)
        style = Paint.Style.STROKE
        strokeWidth = dp(1f)
    }

    private val arrowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = dp(2.4f)
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = sp(15f)
        textAlign = Paint.Align.CENTER
        isFakeBoldText = true
    }

    private val backTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = sp(13f)
        textAlign = Paint.Align.LEFT
        isFakeBoldText = true
    }

    private val tipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(224, 255, 255, 255)
        textSize = sp(13f)
        textAlign = Paint.Align.CENTER
    }

    private val btnPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#1664FF")
        style = Paint.Style.FILL
    }

    private val btnTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = sp(14f)
        textAlign = Paint.Align.CENTER
        isFakeBoldText = true
    }

    private val cutout = RectF()
    private val backRect = RectF()
    private val manualRect = RectF()

    /** 返回按钮的触控热区：视觉 34dp 高，热区扩到 44dp 以满足移动端最小点击尺寸 */
    private val backHit = RectF()

    /**
     * 扫描线渐变缓存。
     *
     * 渐变是纯水平的（left → right，同一 y），与扫描线的纵向位置无关，
     * 因此只需在尺寸变化时构建一次，避免每帧 new 一个 LinearGradient。
     */
    private var scanShader: LinearGradient? = null

    private var startTime = 0L

    /** 按下目标：0 无 / 1 返回 / 2 手动输入。用于避免按下后滑出仍触发点击 */
    private var pressedTarget = 0

    init {
        isClickable = true
        startTime = System.currentTimeMillis()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)

        // 取景区：宽度 64%，中心略高于画面中线（给底部按钮留空间）
        val side = min(w * 0.64f, h * 0.52f)
        val cx = w / 2f
        val cy = h * 0.42f
        cutout.set(cx - side / 2f, cy - side / 2f, cx + side / 2f, cy + side / 2f)

        // 返回胶囊：与标题同一水平线
        val pillH = dp(34f)
        val pillTop = dp(8f)
        val arrowW = dp(18f)
        val gap = dp(3f)
        val padLeft = dp(9f)
        val padRight = dp(14f)
        val pillW = padLeft + arrowW + gap + backTextPaint.measureText(textBack) + padRight
        backRect.set(dp(12f), pillTop, dp(12f) + pillW, pillTop + pillH)

        val hitPad = (dp(44f) - pillH) / 2f
        backHit.set(backRect.left - dp(4f), backRect.top - hitPad, backRect.right + dp(4f), backRect.bottom + hitPad)

        // 底部主按钮
        val btnH = dp(46f)
        val btnBottom = h - dp(34f)
        manualRect.set(dp(22f), btnBottom - btnH, w - dp(22f), btnBottom)

        topScrimPaint.shader = LinearGradient(
            0f, 0f, 0f, dp(118f),
            intArrayOf(Color.argb(102, 0, 0, 0), Color.argb(0, 0, 0, 0)),
            floatArrayOf(0f, 1f),
            Shader.TileMode.CLAMP,
        )

        // 扫描线渐变：水平方向，与 y 无关，构建一次即可复用
        val left = cutout.left + dp(6f)
        val right = cutout.right - dp(6f)
        scanShader = LinearGradient(
            left, 0f, right, 0f,
            intArrayOf(
                Color.argb(0, 22, 100, 255),
                Color.argb(204, 64, 128, 255),
                Color.argb(255, 168, 200, 255),
                Color.argb(204, 64, 128, 255),
                Color.argb(0, 22, 100, 255),
            ),
            floatArrayOf(0f, 0.2f, 0.5f, 0.8f, 1f),
            Shader.TileMode.CLAMP,
        )
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        // 1. 四周遮罩：单条路径 + 奇偶填充，避免四块矩形拼接处的抗锯齿缝隙
        scrimPath.reset()
        scrimPath.fillType = Path.FillType.EVEN_ODD
        scrimPath.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        scrimPath.addRect(cutout, Path.Direction.CCW)
        canvas.drawPath(scrimPath, scrimPaint)

        // 2. 顶部再压暗一层，保证标题与返回按钮在亮色画面上可读
        canvas.drawRect(0f, 0f, width.toFloat(), dp(118f), topScrimPaint)

        // 3. 四角括号
        drawCorners(canvas)

        // 4. 扫描线
        drawScanline(canvas)

        // 5. 标题（与返回胶囊垂直居中对齐）
        val titleBaseline = backRect.centerY() - (titlePaint.descent() + titlePaint.ascent()) / 2f
        canvas.drawText(textTitle, width / 2f, titleBaseline, titlePaint)

        // 6. 返回胶囊
        val radius = backRect.height() / 2f
        canvas.drawRoundRect(backRect, radius, radius, pillPaint)
        canvas.drawRoundRect(backRect, radius, radius, pillBorderPaint)
        drawBackArrow(canvas)
        val backTextX = backRect.left + dp(9f) + dp(18f) + dp(3f)
        val backBaseline = backRect.centerY() - (backTextPaint.descent() + backTextPaint.ascent()) / 2f
        canvas.drawText(textBack, backTextX, backBaseline, backTextPaint)

        // 7. 底部提示
        val tipBaseline = manualRect.top - dp(18f)
        canvas.drawText(textTip, width / 2f, tipBaseline, tipPaint)

        // 8. 手动输入按钮
        canvas.drawRoundRect(manualRect, dp(8f), dp(8f), btnPaint)
        val btnBaseline = manualRect.centerY() - (btnTextPaint.descent() + btnTextPaint.ascent()) / 2f
        canvas.drawText(textManual, manualRect.centerX(), btnBaseline, btnTextPaint)

        // 扫描线需要持续重绘；本 View 只在扫码期间存在，开销可接受
        postInvalidateOnAnimation()
    }

    private fun drawCorners(canvas: Canvas) {
        val len = dp(26f)
        val r = dp(5f)
        val l = cutout.left
        val t = cutout.top
        val rt = cutout.right
        val b = cutout.bottom

        val path = Path()
        // 左上
        path.moveTo(l, t + len)
        path.lineTo(l, t + r)
        path.quadTo(l, t, l + r, t)
        path.lineTo(l + len, t)
        // 右上
        path.moveTo(rt - len, t)
        path.lineTo(rt - r, t)
        path.quadTo(rt, t, rt, t + r)
        path.lineTo(rt, t + len)
        // 右下
        path.moveTo(rt, b - len)
        path.lineTo(rt, b - r)
        path.quadTo(rt, b, rt - r, b)
        path.lineTo(rt - len, b)
        // 左下
        path.moveTo(l + len, b)
        path.lineTo(l + r, b)
        path.quadTo(l, b, l, b - r)
        path.lineTo(l, b - len)

        canvas.drawPath(path, cornerPaint)
    }

    private fun drawScanline(canvas: Canvas) {
        val period = 2400f
        val elapsed = (System.currentTimeMillis() - startTime) % period.toLong()
        val p = elapsed / period

        // 两端慢、中间快，比匀速更像真实扫描
        val eased = if (p < 0.5f) 2f * p * p else 1f - 2f * (1f - p) * (1f - p)
        val travel = cutout.height() - dp(12f)
        val y = cutout.top + dp(6f) + travel * eased

        // 首尾淡入淡出，避免扫描线突然出现/消失
        val alpha = when {
            p < 0.12f -> p / 0.12f
            p > 0.88f -> (1f - p) / 0.12f
            else -> 1f
        }.coerceIn(0f, 1f)

        val left = cutout.left + dp(6f)
        val right = cutout.right - dp(6f)
        scanPaint.shader = scanShader
        scanPaint.alpha = (alpha * 255).toInt()
        canvas.drawRect(left, y - dp(1f), right, y + dp(1f), scanPaint)
        scanPaint.alpha = 255
    }

    private fun drawBackArrow(canvas: Canvas) {
        val cx = backRect.left + dp(9f) + dp(18f) / 2f
        val cy = backRect.centerY()
        val s = dp(4.5f)
        val path = Path()
        path.moveTo(cx + s, cy - s)
        path.lineTo(cx - s, cy)
        path.lineTo(cx + s, cy + s)
        canvas.drawPath(path, arrowPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                pressedTarget = when {
                    backHit.contains(event.x, event.y) -> 1
                    manualRect.contains(event.x, event.y) -> 2
                    else -> 0
                }
                return pressedTarget != 0
            }

            MotionEvent.ACTION_UP -> {
                val target = pressedTarget
                pressedTarget = 0
                // 按下与抬起必须落在同一目标上，避免滑动误触
                if (target == 1 && backHit.contains(event.x, event.y)) {
                    performClick()
                    post { onBack() }
                    return true
                }
                if (target == 2 && manualRect.contains(event.x, event.y)) {
                    performClick()
                    post { onManualInput() }
                    return true
                }
                return target != 0
            }

            MotionEvent.ACTION_CANCEL -> {
                pressedTarget = 0
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    companion object {
        /**
         * 裁剪区域相对取景框的外扩比例。
         *
         * 二维码解码需要四周留出静区（quiet zone，规范要求 4 个模块宽）。
         * 若严格按框边裁剪，用户把码「刚好放满」时静区被切掉，反而识别失败。
         * 6% 的余量在 280dp 的框上约 17dp，足够容纳静区，同时框外较远的
         * 二维码仍不会被扫到。
         */
        private const val CROP_MARGIN_RATIO = 0.06f
    }

    /**
     * 把取景框（View 坐标）换算成分析帧的裁剪矩形（buffer 坐标）。
     *
     * 为什么需要换算：`analyze()` 拿到的是传感器原始帧，与屏幕上看到的预览
     * 既不同尺寸、也可能旋转了 90°。要让「只在框内解码」成立，必须把框的
     * 位置精确映射回帧坐标。
     *
     * 前提：`Preview` 与 `ImageAnalysis` 使用同一分辨率（见 SCAN_RESOLUTION），
     * 因此两者视野一致，映射只是「等比缩放 + 居中裁剪」，不涉及视野差异补偿。
     *
     * @param imageWidth  帧 buffer 宽度（未旋转）
     * @param imageHeight 帧 buffer 高度（未旋转）
     * @param rotationDegrees 顺时针旋转多少度后才是正向画面
     * @return buffer 坐标下的裁剪矩形；无法换算时返回 null（调用方回退整帧）
     */
    fun cropRectForImage(imageWidth: Int, imageHeight: Int, rotationDegrees: Int): Rect? {
        if (imageWidth <= 0 || imageHeight <= 0) return null
        if (width <= 0 || height <= 0) return null
        if (cutout.isEmpty) return null

        // 正向画面的尺寸：旋转 90 / 270 时宽高互换
        val rotated = rotationDegrees == 90 || rotationDegrees == 270
        val uprightW = if (rotated) imageHeight.toFloat() else imageWidth.toFloat()
        val uprightH = if (rotated) imageWidth.toFloat() else imageHeight.toFloat()

        // PreviewView 默认 FILL_CENTER：等比放大到铺满，超出部分居中裁掉
        val scale = max(width / uprightW, height / uprightH)
        if (scale <= 0f) return null
        val offsetX = (width - uprightW * scale) / 2f
        val offsetY = (height - uprightH * scale) / 2f

        // View 坐标 → 正向画面坐标。
        // 向外扩一圈：二维码需要静区（quiet zone）才能被正确识别，
        // 严格贴着框边裁会让「刚好放满」的码识别失败。扩 6% 既保留
        // 「框内才扫」的直觉，又不至于要求用户像素级对准。
        val margin = cutout.width() * CROP_MARGIN_RATIO
        var ux0 = (cutout.left - margin - offsetX) / scale
        var uy0 = (cutout.top - margin - offsetY) / scale
        var ux1 = (cutout.right + margin - offsetX) / scale
        var uy1 = (cutout.bottom + margin - offsetY) / scale

        // 夹到画面内，避免越界导致 ZXing 抛异常
        ux0 = ux0.coerceIn(0f, uprightW)
        ux1 = ux1.coerceIn(0f, uprightW)
        uy0 = uy0.coerceIn(0f, uprightH)
        uy1 = uy1.coerceIn(0f, uprightH)
        if (ux1 - ux0 < 8f || uy1 - uy0 < 8f) return null

        // 正向画面坐标 → buffer 坐标（按旋转角度反推）
        val w = imageWidth.toFloat()
        val h = imageHeight.toFloat()
        val bx0: Float
        val bx1: Float
        val by0: Float
        val by1: Float
        when (rotationDegrees) {
            90 -> {
                // 正向 (ux, uy) ← buffer (uy, h - ux)
                bx0 = uy0; bx1 = uy1
                by0 = h - ux1; by1 = h - ux0
            }
            180 -> {
                bx0 = w - ux1; bx1 = w - ux0
                by0 = h - uy1; by1 = h - uy0
            }
            270 -> {
                // 正向 (ux, uy) ← buffer (w - uy, ux)
                bx0 = w - uy1; bx1 = w - uy0
                by0 = ux0; by1 = ux1
            }
            else -> {
                bx0 = ux0; bx1 = ux1
                by0 = uy0; by1 = uy1
            }
        }

        val left = bx0.toInt().coerceIn(0, imageWidth - 1)
        val top = by0.toInt().coerceIn(0, imageHeight - 1)
        val right = bx1.toInt().coerceIn(left + 1, imageWidth)
        val bottom = by1.toInt().coerceIn(top + 1, imageHeight)
        return Rect(left, top, right, bottom)
    }
}
