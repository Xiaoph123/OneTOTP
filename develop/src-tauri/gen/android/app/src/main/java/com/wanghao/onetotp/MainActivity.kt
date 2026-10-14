package com.wanghao.onetotp

import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  /** 捕获 WebView 引用，供返回键逻辑调用前端处理 */
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView

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
}
