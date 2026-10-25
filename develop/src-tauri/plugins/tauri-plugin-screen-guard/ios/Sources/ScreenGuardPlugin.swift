// 截屏 / 录屏保护（iOS）。
//
// 原理：把一个 `isSecureTextEntry = true` 的 `UITextField` 的图层
// 与窗口图层建立父子关系。系统认为这一层是密码输入，会把它的整棵子树
// 从所有捕获管线（截屏、录屏、AirPlay、后台多任务快照）里剔除，
// 于是整窗呈黑屏。
//
// 为什么不用「叠一层透明视图」：透明视图只是盖住，窗口内容仍在下面被
// 单独捕获，截出来的图依然是完整界面。必须让系统**认定这一层是安全内容**。
//
// 具体做法（业界通行写法，Proton / 1Password / 银行 App 均为此）：
//   1. 把 secure field 加进 window，并居中约束（只为触发布局，
//      它的实际尺寸无关紧要）
//   2. 把 field 的图层挂到 window 图层的父层上
//   3. 把 window 图层挂进 field 的画布子层
// 这样 window 的全部内容都成了安全子树的子孙。
//
// 为什么只挂一次、后续只切 `isSecureTextEntry`：
// 图层父子关系一旦建立就不要再动。关闭保护时仅把该属性置 false，
// 系统立刻恢复子树输出，无需还原图层结构。反复开关也不会把层级改乱
// （「还原式」实现在这里最容易出错：sublayers 顺序与原生渲染层都可能
// 被破坏，表现为界面空白）。
//
// 这是未公开行为，但从 iOS 7 稳定到 iOS 18。唯一副作用是无障碍读屏
// 可能跳过该子树——对验证码类应用代价可接受。

import SwiftRs
import Tauri
import UIKit
import WebKit

struct SetSecureOptions: Decodable {
  let enabled: Bool
}

class ScreenGuardPlugin: Plugin {
  private var webView: WKWebView!

  /// 承载安全子树的输入框（强引用：释放后子树一起消失）
  private var secureField: UITextField?
  /// 是否已建立图层关系
  private var installed = false

  public override func load(webview: WKWebView) {
    self.webView = webview
  }

  @objc private func setSecure(_ invoke: Invoke) throws {
    let options = try invoke.parseArgs(SetSecureOptions.self)
    DispatchQueue.main.async { [weak self] in
      self?.apply(enabled: options.enabled)
      invoke.resolve()
    }
  }

  private func apply(enabled: Bool) {
    if enabled {
      installIfNeeded()
    }
    // 切换开关即可，不改动图层结构
    secureField?.isSecureTextEntry = enabled
  }

  /// 首次开启时建立「window → 安全画布」的图层关系
  private func installIfNeeded() {
    guard !installed else { return }
    guard let window = keyWindow() else { return }
    guard let windowSuperlayer = window.layer.superlayer else { return }

    let field = UITextField()
    field.isSecureTextEntry = true
    // 不可交互：不能让用户点到它、也不能弹出键盘
    field.isUserInteractionEnabled = false
    field.isAccessibilityElement = false
    field.translatesAutoresizingMaskIntoConstraints = false
    field.backgroundColor = .clear

    window.addSubview(field)
    NSLayoutConstraint.activate([
      field.centerXAnchor.constraint(equalTo: window.centerXAnchor),
      field.centerYAnchor.constraint(equalTo: window.centerYAnchor),
    ])
    // 让 field 完成一次布局，内部生成承载安全内容的画布层
    window.layoutIfNeeded()

    guard let canvas = field.layer.sublayers?.first else {
      // 画布尚未生成：保留 field，下次开关时再试
      secureField = field
      return
    }

    // ① field 图层挂到 window 图层的父层（脱离 window.layer 的父子关系）
    windowSuperlayer.addSublayer(field.layer)
    // ② window 图层挂进 field 的安全画布：整窗内容从此都属于安全子树
    canvas.addSublayer(window.layer)

    secureField = field
    installed = true
  }

  private func keyWindow() -> UIWindow? {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first(where: { $0.isKeyWindow })
  }
}

@_cdecl("init_plugin_screen_guard")
public func initPlugin() -> Plugin {
  return ScreenGuardPlugin()
}
