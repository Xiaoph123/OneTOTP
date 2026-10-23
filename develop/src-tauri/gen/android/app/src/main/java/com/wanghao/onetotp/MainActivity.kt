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
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  /**
   * 启动阶段（HTML 尚未绘制）使用的底色。
   *
   * 与前端 `splash.css` / `tokens.css` 的 `--color-bg-2` 对齐：
   * 亮色 `#FCFDFE` / 暗色 `#141619`。
   *
   * 为什么需要它：WebView 与 Activity 窗口在 HTML 绘制前会先显示自身背景色
   * （默认近白）。深色模式下这就会表现为「启动瞬间白屏一闪」。
   * 这里按系统夜间模式取色，抹掉那一帧。
   */
  private fun backgroundForSystemTheme(): Int {
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES
    return Color.parseColor(if (night) "#141619" else "#FCFDFE")
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
    fun systemIsDark(): Boolean = backgroundForSystemTheme() == Color.parseColor("#141619")
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

    // Android 15+ 强制 edge-to-edge：用系统栏 inset 为内容加内边距，
    // 避免内容被状态栏 / 导航栏 / 刘海遮挡
    val root = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
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
  }

  /** 系统明暗切换时（Manifest 已声明 configChanges=uiMode，不会重建 Activity）同步刷新底色 */
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // WebView 保持透明，只更新窗口底色，透出的就是新的系统色
    window.setBackgroundDrawable(ColorDrawable(backgroundForSystemTheme()))
  }
}
