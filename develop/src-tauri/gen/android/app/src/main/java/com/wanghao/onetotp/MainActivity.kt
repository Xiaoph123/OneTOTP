package com.wanghao.onetotp

import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  /**
   * 最近一次收到的安全区尺寸（px，已按 density 换算为 CSS px）。
   *
   * 为什么需要缓存：insets 监听在 onCreate 里注册，但 WebView 由 Tauri
   * 在稍后的 onWebViewCreate 回调中创建。若 insets 先到，此时 webView
   * 还是 null，直接注入会丢失。缓存下来，等 WebView 就绪后补一次。
   */
  private var safeTop = 0
  private var safeBottom = 0
  private var safeLeft = 0
  private var safeRight = 0

  /**
   * 启动阶段（HTML 尚未绘制）使用的底色。
   *
   * 与前端 `splash.css` / `tokens.css` 的 `--color-bg-2` 对齐：
   * 亮色 `#FCFDFE` / 暗色 `#0A0B0D`。
   *
   * 为什么需要它：WebView 与 Activity 窗口在 HTML 绘制前会先显示自身背景色
   * （默认近白）。深色模式下这就会表现为「启动瞬间白屏一闪」。
   * 这里按系统夜间模式取色，抹掉那一帧。
   */
  private fun backgroundForSystemTheme(): Int {
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES
    return Color.parseColor(if (night) "#0A0B0D" else "#FCFDFE")
  }

  /** 系统当前是否为深色模式 */
  private fun isSystemDark(): Boolean {
    return (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES
  }

  /**
   * 让状态栏与导航栏透明，由应用背景透上来。
   *
   * 为什么需要显式设置：`enableEdgeToEdge()` 只是把内容延伸到系统栏下方，
   * 系统栏本身的底色仍由 Tauri 的窗口配置流程决定（默认取 tauri.conf 的
   * backgroundColor，本项目为近白 #FCFDFE）。深色模式下这会在顶部留下
   * 一条亮色带，与近黑的应用背景形成明显断层。
   *
   * 图标明暗必须跟随主题：深色背景配白色图标，浅色背景配深色图标，
   * 否则深色模式下图标会「消失」在背景里。
   */
  private fun applySystemBarStyle() {
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !isSystemDark()
      isAppearanceLightNavigationBars = !isSystemDark()
    }
  }

  /**
   * 截屏 / 录屏保护桥。
   *
   * 只暴露一个开关方法，不读写任何业务数据；页面本身由 CSP 限制为本地资源，
   * 不存在第三方脚本调用该接口的路径。
   */
  inner class ScreenProtectBridge {
    @JavascriptInterface
    fun setSecure(enabled: Boolean) {
      runOnUiThread {
        if (enabled) {
          window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
          window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
      }
    }

    /**
     * 把应用切到后台（等价于用户按 Home 键）。
     *
     * 用于「复制后自动隐藏窗口」：桌面端是隐藏窗口让用户去粘贴，
     * 移动端没有窗口概念，切后台是语义等价的操作。
     * 不结束进程，用户从最近任务切回即可继续使用。
     */
    @JavascriptInterface
    fun moveToBackground() {
      runOnUiThread { moveTaskToBack(true) }
    }

    /**
     * 系统当前是否为深色模式（供首屏主题判定使用）。
     *
     * 为什么需要原生回答：WebView 在首帧那一刻往往尚未完成深色模式初始化，
     * 此时 `matchMedia("(prefers-color-scheme: dark)")` 会返回 false，
     * 导致启动画面被画成亮色（整屏白一闪），随后才纠正为暗色。
     * 这里直接读 Activity 的 `uiMode`，第一帧就是准确值。
     */
    @JavascriptInterface
    fun systemIsDark(): Boolean = isSystemDark()
  }

  /** 捕获 WebView 引用，供返回键逻辑调用前端处理 */
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // 关键：WebView 自身背景设为**透明**，让它后面的窗口底色透出来。
    //
    // 为什么不是直接设成暗色：WebView 在首帧之前会用自己的 base background
    // 绘制一帧（Chromium 默认近白）。设成透明后，那一帧等于「什么都不画」，
    // 显示的是我们在 onCreate 里设置的窗口底色（已按系统明暗取色），
    // 于是无论 WebView 何时完成首帧，都不会出现白屏。
    webView.setBackgroundColor(Color.TRANSPARENT)
    // Tauri 可能在其窗口配置流程中、晚于本回调应用 tauri.conf 的 backgroundColor
    // （本项目为近白 #FCFDFE），那会把上面的透明值盖回白色。这里在消息队列里
    // 再补两次，确保最终生效的是透明（真正显示的是窗口底色）。
    webView.post { webView.setBackgroundColor(Color.TRANSPARENT) }
    webView.postDelayed({ webView.setBackgroundColor(Color.TRANSPARENT) }, 60L)
    // 供前端设置 FLAG_SECURE：开启后系统截屏失败，录屏 / 投屏 / 多任务预览呈黑屏
    webView.addJavascriptInterface(ScreenProtectBridge(), "OneTotpNative")

    // 补注入安全区：insets 监听在 onCreate 注册，可能早于本回调触发，
    // 那时 webView 还是 null，值只进了缓存。
    //
    // 这里用多次延迟重试而不是覆写 webViewClient：Tauri 自己设置了
    // WebViewClient 处理 asset:// 资源加载，覆写会破坏页面加载。
    // 页面在几百毫秒内完成首帧，几次重试足以覆盖。
    injectSafeArea()
    listOf(80L, 200L, 500L, 1200L).forEach { delay ->
      webView.postDelayed({ injectSafeArea() }, delay)
    }

    // 接管系统返回键：优先交给前端路由处理，前端无法返回时再退出应用
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = webView
        if (wv == null) {
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
          return
        }
        // 前端定义 window.__handleAndroidBack()，返回 true 表示已处理（返回上一级）
        wv.evaluateJavascript("(window.__handleAndroidBack && window.__handleAndroidBack()) === true") { result ->
          if (result != "true") {
            // 前端已在根页面：退出应用
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    })
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 窗口背景同样对齐系统明暗：Activity 创建到 WebView 首次绘制之间
    // 显示的就是这块底色，用近白色会在深色系统上闪一下白。
    window.setBackgroundDrawable(ColorDrawable(backgroundForSystemTheme()))
    // 系统栏透明，让上面的窗口底色透上来（否则顶部会留一条亮色带）
    applySystemBarStyle()

    // Android 15+ 强制 edge-to-edge。
    //
    // 关键：这里**不给根视图加内边距**，而是把安全区尺寸通过 CSS 变量
    // 传给前端，由 .app-window 的 padding 来避让。
    //
    // 为什么不能用 view.setPadding：那样 WebView 会被整体推到状态栏下方，
    // 状态栏区域露出的是原生窗口底色（纯色），而应用区域是「底色 + 噪点纹理」，
    // 两者平均亮度差 3~4 个色阶，视觉上就是一条明显的色差带。
    // 让 WebView 铺满整屏后，纹理能一直画到状态栏下方，颜色完全连续。
    val root = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      applySafeAreaToWebView(bars.top, bars.bottom, bars.left, bars.right)
      insets
    }
  }

  /**
   * 把安全区尺寸写进 CSS 变量，供前端避让状态栏 / 导航栏 / 刘海。
   *
   * 用 CSS 变量而不是原生 padding：WebView 必须铺满整屏，
   * 背景纹理才能连续覆盖到状态栏下方（见 onCreate 的说明）。
   */
  private fun applySafeAreaToWebView(top: Int, bottom: Int, left: Int, right: Int) {
    val density = resources.displayMetrics.density
    safeTop = (top / density).toInt()
    safeBottom = (bottom / density).toInt()
    safeLeft = (left / density).toInt()
    safeRight = (right / density).toInt()
    injectSafeArea()
  }

  /** 把缓存的 safe* 值注入页面；WebView 未就绪时静默跳过 */
  private fun injectSafeArea() {
    val wv = webView ?: return
    wv.post {
      wv.evaluateJavascript(
        "document.documentElement.style.setProperty('--safe-top','${safeTop}px');" +
          "document.documentElement.style.setProperty('--safe-bottom','${safeBottom}px');" +
          "document.documentElement.style.setProperty('--safe-left','${safeLeft}px');" +
          "document.documentElement.style.setProperty('--safe-right','${safeRight}px');",
        null
      )
    }
  }

  /**
   * 每次回到前台都重新贴一次窗口底色。
   *
   * 原因：Tauri 会在窗口/WebView 创建流程中应用配置里的 `backgroundColor`
   * （本项目为 #FCFDFE，近白）。若它晚于 onCreate 生效，就会把我们在
   * onCreate 设的暗色盖回白色，于是深色系统上又闪一下白。
   * onResume 在窗口配置流程之后执行，这里再贴一次可确保最终生效的是系统色。
   */
  override fun onResume() {
    super.onResume()
    window.setBackgroundDrawable(ColorDrawable(backgroundForSystemTheme()))
    // Tauri 的窗口配置流程可能晚于 onCreate 重置系统栏颜色，这里再贴一次
    applySystemBarStyle()
  }

  /** 系统明暗切换时（Manifest 已声明 configChanges=uiMode，不会重建 Activity）同步刷新底色 */
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // WebView 保持透明，只更新窗口底色，透出的就是新的系统色
    window.setBackgroundDrawable(ColorDrawable(backgroundForSystemTheme()))
    // 明暗切换后图标颜色也要跟着翻转，否则会看不清
    applySystemBarStyle()
  }
}
