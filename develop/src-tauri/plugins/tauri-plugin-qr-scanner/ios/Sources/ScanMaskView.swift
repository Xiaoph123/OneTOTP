// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import AVFoundation
import UIKit

/// 扫码取景蒙版（iOS）。
///
/// 与 Android 侧的 `ScanMaskView.kt` 保持同一套设计：四周压暗、中间镂空取景区、
/// 四角括号、上下往复的扫描线、顶部标题 + 左上角「返回」胶囊、底部提示与
/// 「手动输入代码」主按钮。两端视觉与交互一致，用户换机不会感到陌生。
///
/// 本视图**不参与任何相机逻辑**：不持有 AVCaptureSession / PreviewLayer 引用，
/// 只负责绘制与两个按钮的回调。移除它不会影响扫码功能。
final class ScanMaskView: UIView {

  // MARK: - 回调

  /// 左上角「返回」：由插件负责拒绝待处理的 scan Promise 并销毁相机
  var onBack: (() -> Void)?
  /// 「手动输入代码」：由插件负责通知前端切到手动页签
  var onManualInput: (() -> Void)?
  /// 布局变化（旋转 / 尺寸改变）后通知插件重算 rectOfInterest
  var onLayoutChanged: (() -> Void)?

  // MARK: - 几何

  /// 取景区（视图坐标）。插件据此换算 AVCaptureMetadataOutput.rectOfInterest
  private(set) var cutoutRect: CGRect = .zero

  /// 解码区域相对取景框的外扩比例。
  ///
  /// 二维码解码需要四周留出静区（quiet zone，规范要求 4 个模块宽）。
  /// 若严格按框边裁剪，用户把码「刚好放满」时静区被切掉，反而识别失败。
  /// 6% 的余量在 280pt 的框上约 17pt，足够容纳静区，同时框外较远的
  /// 二维码仍不会被扫到。
  private let cropMarginRatio: CGFloat = 0.06

  /// 带静区余量的解码矩形（视图坐标）
  var decodeRect: CGRect {
    guard !cutoutRect.isEmpty else { return .zero }
    let dx = cutoutRect.width * cropMarginRatio
    let dy = cutoutRect.height * cropMarginRatio
    return cutoutRect.insetBy(dx: -dx, dy: -dy)
  }

  private var backRect: CGRect = .zero
  private var manualRect: CGRect = .zero
  /// 返回按钮的触控热区：视觉 34pt 高，热区扩到 44pt 以满足移动端最小点击尺寸
  private var backHitRect: CGRect = .zero

  // MARK: - 文案

  /// 原生层拿不到前端 i18n，按系统语言二选一，避免出现中英混排
  private let zh = Locale.preferredLanguages.first?.hasPrefix("zh") ?? false

  private var textTitle: String { zh ? "扫描二维码" : "Scan QR code" }
  private var textBack: String { zh ? "返回" : "Back" }
  private var textTip: String {
    zh ? "将二维码放入框内，即可自动识别" : "Place the QR code inside the frame"
  }
  private var textManual: String { zh ? "手动输入代码" : "Enter code manually" }

  // MARK: - 画笔

  private let scrimColor = UIColor(white: 0, alpha: 0.6)
  private let cornerColor = UIColor(red: 0x16 / 255.0, green: 0x64 / 255.0, blue: 0xFF / 255.0, alpha: 1)
  private let brandColor = UIColor(red: 0x16 / 255.0, green: 0x64 / 255.0, blue: 0xFF / 255.0, alpha: 1)

  private let titleFont = UIFont.systemFont(ofSize: 15, weight: .semibold)
  private let backFont = UIFont.systemFont(ofSize: 13, weight: .semibold)
  private let tipFont = UIFont.systemFont(ofSize: 13, weight: .regular)
  private let btnFont = UIFont.systemFont(ofSize: 14, weight: .semibold)

  // MARK: - 动画

  private var displayLink: CADisplayLink?
  private var startTime: CFTimeInterval = CACurrentMediaTime()

  // MARK: - 触控

  /// 按下目标：0 无 / 1 返回 / 2 手动输入。用于避免按下后滑出仍触发点击
  private var pressedTarget = 0

  // MARK: - 初始化

  init() {
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = true
    isAccessibilityElement = false
    startTime = CACurrentMediaTime()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) 未实现")
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      stopAnimating()
    } else {
      startAnimating()
    }
  }

  deinit {
    stopAnimating()
  }

  private func startAnimating() {
    // 尊重系统「减少动态效果」偏好：停掉扫描线，只保留静态提示
    if UIAccessibility.isReduceMotionEnabled { return }
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(tick))
    // preferredFrameRateRange 需要 iOS 15+，部署目标为 13 时必须做可用性判断
    if #available(iOS 15.0, *) {
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60)
    }
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopAnimating() {
    displayLink?.invalidate()
    displayLink = nil
  }

  @objc private func tick() {
    setNeedsDisplay()
  }

  // MARK: - 布局

  override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width > 0, bounds.height > 0 else { return }

    // 顶部安全区：刘海机型上把胶囊与标题压到灵动岛下方，否则会被遮住
    let topInset = safeAreaInsets.top

    // 取景区：宽度 64%，中心略高于画面中线（给底部按钮留空间）
    let side = min(bounds.width * 0.64, bounds.height * 0.52)
    let cx = bounds.midX
    let cy = bounds.height * 0.42
    cutoutRect = CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side)

    // 返回胶囊：与标题同一水平线
    let pillH: CGFloat = 34
    let pillTop = max(8, topInset + 4)
    let arrowW: CGFloat = 18
    let gap: CGFloat = 3
    let padLeft: CGFloat = 9
    let padRight: CGFloat = 14
    let backTextW = (textBack as NSString).size(withAttributes: [.font: backFont]).width
    let pillW = padLeft + arrowW + gap + backTextW + padRight
    backRect = CGRect(x: 12, y: pillTop, width: pillW, height: pillH)

    let hitPad = (44 - pillH) / 2
    backHitRect = backRect.insetBy(dx: -4, dy: -hitPad)

    // 底部主按钮：避让底部手势条
    let bottomInset = safeAreaInsets.bottom
    let btnH: CGFloat = 46
    let btnBottom = bounds.height - max(34, bottomInset + 18)
    manualRect = CGRect(x: 22, y: btnBottom - btnH, width: bounds.width - 44, height: btnH)

    setNeedsDisplay()
    onLayoutChanged?()
  }

  // MARK: - 绘制

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext(), !cutoutRect.isEmpty else { return }

    // 1. 四周遮罩：单条路径 + 奇偶填充。
    //
    // 为什么不用四块矩形拼接：相邻矩形共享边界时，抗锯齿会让边界像素各自
    // 只覆盖约 50%，两次叠加仍不到 100% 不透明度，于是沿镂空边缘出现一条
    // 比周围更亮的细线（四个角是两条缝的交点，最明显）。
    let scrim = UIBezierPath(rect: bounds)
    scrim.append(UIBezierPath(rect: cutoutRect))
    scrim.usesEvenOddFillRule = true
    scrimColor.setFill()
    scrim.fill()

    // 2. 顶部再压暗一层，保证标题与返回按钮在极亮画面上可读
    let topGradientHeight: CGFloat = 118
    if let gradient = CGGradient(
      colorsSpace: CGColorSpaceCreateDeviceRGB(),
      colors: [
        UIColor(white: 0, alpha: 0.4).cgColor,
        UIColor(white: 0, alpha: 0).cgColor,
      ] as CFArray,
      locations: [0, 1]
    ) {
      ctx.saveGState()
      ctx.clip(to: CGRect(x: 0, y: 0, width: bounds.width, height: topGradientHeight))
      ctx.drawLinearGradient(
        gradient,
        start: CGPoint(x: 0, y: 0),
        end: CGPoint(x: 0, y: topGradientHeight),
        options: []
      )
      ctx.restoreGState()
    }

    // 3. 四角括号
    drawCorners()

    // 4. 扫描线
    drawScanline(in: ctx)

    // 5. 标题（与返回胶囊垂直居中对齐）
    drawCentered(
      textTitle,
      font: titleFont,
      color: .white,
      centerY: backRect.midY,
      x: bounds.midX
    )

    // 6. 返回胶囊
    let pillPath = UIBezierPath(roundedRect: backRect, cornerRadius: backRect.height / 2)
    UIColor(white: 0, alpha: 0.38).setFill()
    pillPath.fill()
    UIColor(white: 1, alpha: 0.16).setStroke()
    pillPath.lineWidth = 1
    pillPath.stroke()
    drawBackArrow()
    drawText(
      textBack,
      font: backFont,
      color: .white,
      point: CGPoint(x: backRect.minX + 9 + 18 + 3, y: backRect.midY),
      anchorY: .center
    )

    // 7. 底部提示
    drawCentered(
      textTip,
      font: tipFont,
      color: UIColor(white: 1, alpha: 0.88),
      centerY: manualRect.minY - 18,
      x: bounds.midX
    )

    // 8. 手动输入按钮
    let btnPath = UIBezierPath(roundedRect: manualRect, cornerRadius: 8)
    brandColor.setFill()
    btnPath.fill()
    drawCentered(
      textManual,
      font: btnFont,
      color: .white,
      centerY: manualRect.midY,
      x: manualRect.midX
    )
  }

  private func drawCorners() {
    let len: CGFloat = 26
    let r: CGFloat = 5
    let l = cutoutRect.minX
    let t = cutoutRect.minY
    let rt = cutoutRect.maxX
    let b = cutoutRect.maxY

    let path = UIBezierPath()
    // 左上
    path.move(to: CGPoint(x: l, y: t + len))
    path.addLine(to: CGPoint(x: l, y: t + r))
    path.addQuadCurve(to: CGPoint(x: l + r, y: t), controlPoint: CGPoint(x: l, y: t))
    path.addLine(to: CGPoint(x: l + len, y: t))
    // 右上
    path.move(to: CGPoint(x: rt - len, y: t))
    path.addLine(to: CGPoint(x: rt - r, y: t))
    path.addQuadCurve(to: CGPoint(x: rt, y: t + r), controlPoint: CGPoint(x: rt, y: t))
    path.addLine(to: CGPoint(x: rt, y: t + len))
    // 右下
    path.move(to: CGPoint(x: rt, y: b - len))
    path.addLine(to: CGPoint(x: rt, y: b - r))
    path.addQuadCurve(to: CGPoint(x: rt - r, y: b), controlPoint: CGPoint(x: rt, y: b))
    path.addLine(to: CGPoint(x: rt - len, y: b))
    // 左下
    path.move(to: CGPoint(x: l + len, y: b))
    path.addLine(to: CGPoint(x: l + r, y: b))
    path.addQuadCurve(to: CGPoint(x: l, y: b - r), controlPoint: CGPoint(x: l, y: b))
    path.addLine(to: CGPoint(x: l, y: b - len))

    path.lineWidth = 2.5
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    cornerColor.setStroke()
    path.stroke()
  }

  private func drawScanline(in ctx: CGContext) {
    // 「减少动态效果」时把扫描线固定在框内中部，作为静态装饰
    let progress: CGFloat
    let alpha: CGFloat
    if UIAccessibility.isReduceMotionEnabled {
      progress = 0.5
      alpha = 1
    } else {
      let period: CFTimeInterval = 2.4
      let elapsed = (CACurrentMediaTime() - startTime).truncatingRemainder(dividingBy: period)
      let p = CGFloat(elapsed / period)
      // 两端慢、中间快，比匀速更像真实扫描
      progress = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p)
      // 首尾淡入淡出，避免扫描线突然出现/消失
      if p < 0.12 {
        alpha = p / 0.12
      } else if p > 0.88 {
        alpha = (1 - p) / 0.12
      } else {
        alpha = 1
      }
    }

    let travel = cutoutRect.height - 12
    let y = cutoutRect.minY + 6 + travel * progress

    let left = cutoutRect.minX + 6
    let right = cutoutRect.maxX - 6

    guard
      let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
          UIColor(red: 0x16 / 255.0, green: 0x64 / 255.0, blue: 0xFF / 255.0, alpha: 0).cgColor,
          UIColor(red: 0x40 / 255.0, green: 0x80 / 255.0, blue: 0xFF / 255.0, alpha: 0.8).cgColor,
          UIColor(red: 0xA8 / 255.0, green: 0xC8 / 255.0, blue: 0xFF / 255.0, alpha: 1).cgColor,
          UIColor(red: 0x40 / 255.0, green: 0x80 / 255.0, blue: 0xFF / 255.0, alpha: 0.8).cgColor,
          UIColor(red: 0x16 / 255.0, green: 0x64 / 255.0, blue: 0xFF / 255.0, alpha: 0).cgColor,
        ] as CFArray,
        locations: [0, 0.2, 0.5, 0.8, 1]
      )
    else { return }

    ctx.saveGState()
    ctx.setAlpha(alpha)
    ctx.clip(to: CGRect(x: left, y: y - 1, width: right - left, height: 2))
    ctx.drawLinearGradient(
      gradient,
      start: CGPoint(x: left, y: y),
      end: CGPoint(x: right, y: y),
      options: []
    )
    ctx.restoreGState()
  }

  private func drawBackArrow() {
    let cx = backRect.minX + 9 + 18 / 2
    let cy = backRect.midY
    let s: CGFloat = 4.5
    let path = UIBezierPath()
    path.move(to: CGPoint(x: cx + s, y: cy - s))
    path.addLine(to: CGPoint(x: cx - s, y: cy))
    path.addLine(to: CGPoint(x: cx + s, y: cy + s))
    path.lineWidth = 2.4
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    UIColor.white.setStroke()
    path.stroke()
  }

  // MARK: - 文本绘制

  private enum TextAnchorY {
    case center
  }

  private func drawText(
    _ text: String,
    font: UIFont,
    color: UIColor,
    point: CGPoint,
    anchorY: TextAnchorY
  ) {
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let size = (text as NSString).size(withAttributes: attrs)
    let origin: CGPoint
    switch anchorY {
    case .center:
      origin = CGPoint(x: point.x, y: point.y - size.height / 2)
    }
    (text as NSString).draw(at: origin, withAttributes: attrs)
  }

  /// 以 x 为水平中心、centerY 为垂直中心绘制
  private func drawCentered(
    _ text: String,
    font: UIFont,
    color: UIColor,
    centerY: CGFloat,
    x: CGFloat
  ) {
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let size = (text as NSString).size(withAttributes: attrs)
    let origin = CGPoint(x: x - size.width / 2, y: centerY - size.height / 2)
    (text as NSString).draw(at: origin, withAttributes: attrs)
  }

  // MARK: - 触控

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let p = touches.first?.location(in: self) else { return }
    if backHitRect.contains(p) {
      pressedTarget = 1
    } else if manualRect.contains(p) {
      pressedTarget = 2
    } else {
      pressedTarget = 0
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard pressedTarget != 0, let p = touches.first?.location(in: self) else { return }
    // 手指滑出目标区域即取消，避免误触
    let stillInside = pressedTarget == 1 ? backHitRect.contains(p) : manualRect.contains(p)
    if !stillInside {
      pressedTarget = 0
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    let target = pressedTarget
    pressedTarget = 0
    guard let p = touches.first?.location(in: self) else { return }
    if target == 1 && backHitRect.contains(p) {
      onBack?()
    } else if target == 2 && manualRect.contains(p) {
      onManualInput?()
    }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    pressedTarget = 0
  }
}
