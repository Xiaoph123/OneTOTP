// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import AVFoundation
import Tauri
import UIKit
import WebKit

struct ScanOptions: Decodable {
  var formats: [SupportedFormat]?
  var windowed: Bool?
  var cameraDirection: String?
}

enum SupportedFormat: String, CaseIterable, Decodable {
  // UPC_A not supported
  case UPC_E
  case EAN_8
  case EAN_13
  case CODE_39
  case CODE_93
  case CODE_128
  // CODABAR not supported
  case ITF
  case AZTEC
  case DATA_MATRIX
  case PDF_417
  case QR_CODE
  case GS1_DATA_BAR
  case GS1_DATA_BAR_LIMITED
  case GS1_DATA_BAR_EXPANDED

  var value: AVMetadataObject.ObjectType? {
    switch self {
    case .UPC_E: return AVMetadataObject.ObjectType.upce
    case .EAN_8: return AVMetadataObject.ObjectType.ean8
    case .EAN_13: return AVMetadataObject.ObjectType.ean13
    case .CODE_39: return AVMetadataObject.ObjectType.code39
    case .CODE_93: return AVMetadataObject.ObjectType.code93
    case .CODE_128: return AVMetadataObject.ObjectType.code128
    case .ITF: return AVMetadataObject.ObjectType.interleaved2of5
    case .AZTEC: return AVMetadataObject.ObjectType.aztec
    case .DATA_MATRIX: return AVMetadataObject.ObjectType.dataMatrix
    case .PDF_417: return AVMetadataObject.ObjectType.pdf417
    case .QR_CODE: return AVMetadataObject.ObjectType.qr
    case .GS1_DATA_BAR:
      if #available(iOS 15.4, *) {
        return AVMetadataObject.ObjectType.gs1DataBar
      } else {
        return nil
      }
    case .GS1_DATA_BAR_LIMITED:
      if #available(iOS 15.4, *) {
        return AVMetadataObject.ObjectType.gs1DataBarLimited
      } else {
        return nil
      }
    case .GS1_DATA_BAR_EXPANDED:
      if #available(iOS 15.4, *) {
        return AVMetadataObject.ObjectType.gs1DataBarExpanded
      } else {
        return nil
      }
    }
  }
}

enum CaptureError: Error {
  case backCameraUnavailable
  case frontCameraUnavailable
  case couldNotCaptureInput(error: NSError)
}

class BarcodeScannerPlugin: Plugin, AVCaptureMetadataOutputObjectsDelegate {
  var webView: WKWebView!
  var cameraView: CameraView!
  var captureSession: AVCaptureSession?
  var captureVideoPreviewLayer: AVCaptureVideoPreviewLayer?
  var metaOutput: AVCaptureMetadataOutput?
  /// 取景蒙版：与 Android 侧设计保持一致
  var scanMaskView: ScanMaskView?

  var currentCamera = 0
  var frontCamera: AVCaptureDevice?
  var backCamera: AVCaptureDevice?

  var isScanning = false

  var windowed = false
  var previousBackgroundColor: UIColor? = UIColor.white

  var invoke: Invoke? = nil

  var scanFormats = [AVMetadataObject.ObjectType]()

  public override func load(webview: WKWebView) {
    self.webView = webview
    loadCamera()
  }

  private func loadCamera() {
    cameraView = CameraView(frame: UIScreen.main.bounds)
    cameraView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  public func metadataOutput(
    _ captureOutput: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    if metadataObjects.count == 0 || !self.isScanning {
      // while nothing is detected, or if scanning is false, do nothing.
      return
    }

    guard let found = metadataObjects[0] as? AVMetadataMachineReadableCodeObject else { return }
    if scanFormats.contains(found.type) {
      var jsObject: JsonObject = [:]

      jsObject["format"] = formatStringFromMetadata(found.type)
      if found.stringValue != nil {
        jsObject["content"] = found.stringValue
      }

      // 命中时给一次轻触反馈，与 Android 侧 vibrate() 的体验对齐
      let generator = UIImpactFeedbackGenerator(style: .medium)
      generator.impactOccurred()

      invoke?.resolve(jsObject)
      destroy()
    }
  }

  private func setupCamera(direction: String, windowed: Bool) {
    do {
      var cameraDirection = direction
      cameraView.backgroundColor = UIColor.clear
      if windowed {
        webView.superview?.insertSubview(cameraView, belowSubview: webView)
      } else {
        webView.superview?.insertSubview(cameraView, aboveSubview: webView)
      }

      let availableVideoDevices = discoverCaptureDevices()
      for device in availableVideoDevices {
        if device.position == AVCaptureDevice.Position.back {
          backCamera = device
        } else if device.position == AVCaptureDevice.Position.front {
          frontCamera = device
        }
      }

      // older iPods have no back camera
      if cameraDirection == "back" {
        if backCamera == nil {
          cameraDirection = "front"
        }
      } else {
        if frontCamera == nil {
          cameraDirection = "back"
        }
      }

      let input: AVCaptureDeviceInput
      input = try createCaptureDeviceInput(
        cameraDirection: cameraDirection, backCamera: backCamera, frontCamera: frontCamera)
      captureSession = AVCaptureSession()
      captureSession!.addInput(input)
      metaOutput = AVCaptureMetadataOutput()
      captureSession!.addOutput(metaOutput!)
      metaOutput!.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
      captureVideoPreviewLayer = AVCaptureVideoPreviewLayer(session: captureSession!)
      cameraView.addPreviewLayer(captureVideoPreviewLayer)

      // 二维码通常只有几厘米，连续自动对焦能让识别「秒出」；
      // 单次对焦在近距离下容易锁在无穷远，表现为一直扫不上。
      configureContinuousFocus(device: input.device)

      // 取景蒙版：叠在相机画面之上，绘制遮罩 / 括号 / 扫描线 / 两个按钮
      let mask = ScanMaskView()
      mask.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      mask.frame = (webView.superview?.bounds) ?? UIScreen.main.bounds
      mask.onBack = { [weak self] in self?.cancelScan() }
      mask.onManualInput = { [weak self] in self?.requestManualInput() }
      // 旋转或尺寸变化后，取景框位置随之改变，必须重算解码区域
      mask.onLayoutChanged = { [weak self] in self?.updateRectOfInterest() }
      webView.superview?.addSubview(mask)
      scanMaskView = mask

      self.windowed = windowed
      if windowed {
        self.previousBackgroundColor = self.webView.backgroundColor
        self.webView.isOpaque = false
        self.webView.backgroundColor = UIColor.clear
        self.webView.scrollView.backgroundColor = UIColor.clear
      }
    } catch CaptureError.backCameraUnavailable {
      //
    } catch CaptureError.frontCameraUnavailable {
      //
    } catch CaptureError.couldNotCaptureInput {
      //
    } catch {
      //
    }
  }

  /// 连续自动对焦 + 兴趣点居中，兼顾「远距离整屏扫码」与「近距离贴近扫码」
  private func configureContinuousFocus(device: AVCaptureDevice) {
    guard device.isFocusModeSupported(.continuousAutoFocus) else { return }
    do {
      try device.lockForConfiguration()
      device.focusMode = .continuousAutoFocus
      if device.isAutoFocusRangeRestrictionSupported {
        device.autoFocusRangeRestriction = .near
      }
      device.unlockForConfiguration()
    } catch {
      // 配置失败不影响扫码，只是对焦策略退回系统默认
    }
  }

  /// 把取景框换算成 `AVCaptureMetadataOutput.rectOfInterest`。
  ///
  /// 为什么需要换算：`rectOfInterest` 用的是「预览图层坐标系」。
  /// 直接拿视图坐标赋值会因为坐标系不一致而完全错位（常见表现是
  /// 框内扫不到、框外反而能扫到）。系统提供的
  /// `metadataOutputRectConverted(fromLayerRect:)` 正是为此设计。
  ///
  /// 换算失败（蒙版尚未布局 / 尺寸为 0）时保持整屏识别，宁可多扫也不漏扫。
  private func updateRectOfInterest() {
    guard let output = metaOutput else { return }
    // rectOfInterest 在 metadataObjectTypes 为空时赋值会抛 NSInvalidArgumentException。
    // 蒙版的首次布局早于 runScanner（那时格式还没设置），必须在这里挡住。
    guard !output.metadataObjectTypes.isEmpty else { return }
    guard let layer = captureVideoPreviewLayer else { return }
    guard let mask = scanMaskView, !mask.decodeRect.isEmpty else {
      output.rectOfInterest = CGRect(x: 0, y: 0, width: 1, height: 1)
      return
    }
    // 蒙版与相机视图同属一个父视图且尺寸相同，坐标可直接转换
    let inLayer = layer.metadataOutputRectConverted(fromLayerRect: mask.decodeRect)
    guard inLayer.width > 0, inLayer.height > 0 else { return }
    // 夹到合法范围，越界会让 AVCaptureMetadataOutput 抛异常
    output.rectOfInterest = inLayer.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
  }

  private func dismantleCamera() {
    if self.captureSession != nil {
      self.captureSession!.stopRunning()
      self.cameraView.removePreviewLayer()
      self.cameraView.removeFromSuperview()
      self.captureVideoPreviewLayer = nil
      self.metaOutput = nil
      self.captureSession = nil
      self.frontCamera = nil
      self.backCamera = nil
    }

    // 蒙版移除必须无条件执行：它可能在相机初始化失败前就已挂上，
    // 若用 session 做守卫会让蒙版永久留在界面上（与 Android 侧同理）。
    self.scanMaskView?.removeFromSuperview()
    self.scanMaskView = nil

    self.isScanning = false
  }

  private func destroy() {
    dismantleCamera()
    invoke = nil
    if windowed {
      let backgroundColor = previousBackgroundColor ?? UIColor.white
      webView.isOpaque = true
      webView.backgroundColor = backgroundColor
      webView.scrollView.backgroundColor = backgroundColor
    }
  }

  /// 蒙版上的「返回」：与 Android 侧走同一条路径。
  ///
  /// 先拒绝待处理的 scan Promise（前端 catch 到 "cancelled" 后回到扫码页签），
  /// 再销毁相机。顺序不能反：destroy() 之后 invoke 已被清空，Promise 永不结束。
  private func cancelScan() {
    invoke?.reject("cancelled")
    invoke = nil
    destroy()
  }

  /// 蒙版上的「手动输入代码」：通知前端切到「手动」页签。
  ///
  /// 这里**只**发通知，不主动关闭相机。关闭动作由前端钩子自己调用 `cancel()`，
  /// 这样顺序是确定的：前端先置位「主动切换」标记 → 再 cancel → Promise 拒绝时
  /// 标记已就绪，不会误报「已取消扫码」。
  private func requestManualInput() {
    DispatchQueue.main.async {
      self.webView.evaluateJavaScript(
        "(window.__onScanManualInput && window.__onScanManualInput())", completionHandler: nil)
    }
  }

  private func getPermissionState() -> String {
    var permissionState: String

    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      permissionState = "granted"
    case .denied:
      permissionState = "denied"
    default:
      permissionState = "prompt"
    }

    return permissionState
  }

  @objc override func checkPermissions(_ invoke: Invoke) {
    let permissionState = getPermissionState()
    invoke.resolve(["camera": permissionState])
  }

  @objc override func requestPermissions(_ invoke: Invoke) {
    let state = getPermissionState()
    if state == "prompt" {
      AVCaptureDevice.requestAccess(for: .video) { (authorized) in
        invoke.resolve(["camera": authorized ? "granted" : "denied"])
      }
    } else {
      invoke.resolve(["camera": state])
    }
  }

  @objc func openAppSettings(_ invoke: Invoke) {
    guard let settingsUrl = URL(string: UIApplication.openSettingsURLString) else {
      return
    }

    DispatchQueue.main.async {
      if UIApplication.shared.canOpenURL(settingsUrl) {
        UIApplication.shared.open(
          settingsUrl,
          completionHandler: { (success) in
            invoke.resolve()
          })
      }
    }
  }

  /// 轻触反馈。
  ///
  /// iOS 没有 Android 那样的任意时长震动接口（`AudioServicesPlaySystemSound`
  /// 的 kSystemSoundID_Vibrate 在部分机型上无效），统一用触感反馈代替。
  @objc func vibrate(_ invoke: Invoke) {
    let generator = UIImpactFeedbackGenerator(style: .medium)
    generator.impactOccurred()
    invoke.resolve()
  }

  private func runScanner(_ invoke: Invoke, args: ScanOptions) {
    if getPermissionState() != "granted" {
      invoke.reject("Camera permission denied or not yet requested")
      return
    }

    guard let output = metaOutput, let session = captureSession else {
      invoke.reject("Camera is not ready")
      return
    }

    scanFormats = [AVMetadataObject.ObjectType]()

    for format in args.formats ?? [] {
      if let formatValue = format.value {
        scanFormats.append(formatValue)
      } else {
        invoke.reject("Unsupported barcode format on this iOS version: \(format)")
        return
      }
    }

    if scanFormats.isEmpty {
      for supportedFormat in SupportedFormat.allCases {
        if let formatValue = supportedFormat.value {
          scanFormats.append(formatValue)
        }
      }
    }

    // 逐帧解码的格式列表必须在 session 启动前设置好
    output.metadataObjectTypes = scanFormats
    updateRectOfInterest()

    DispatchQueue.main.async {
      session.startRunning()
    }

    self.isScanning = true
  }

  @objc private func scan(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ScanOptions.self)

    self.invoke = invoke

    let entry = Bundle.main.infoDictionary?["NSCameraUsageDescription"] as? String

    if entry == nil || entry?.count == 0 {
      invoke.reject("NSCameraUsageDescription is not in the app Info.plist")
      return
    }

    // Check if camera is available on this platform (iOS simulator doesn't have cameras)
    let availableVideoDevices = discoverCaptureDevices()
    if availableVideoDevices.isEmpty {
      invoke.reject("No camera available on this device (e.g., iOS Simulator)")
      return
    }

    var iOS14min: Bool = false
    if #available(iOS 14.0, *) { iOS14min = true }
    if !iOS14min && self.getPermissionState() != "granted" {
      var authorized = false
      AVCaptureDevice.requestAccess(for: .video) { (isAuthorized) in
        authorized = isAuthorized
      }
      if !authorized {
        invoke.reject("denied by the user")
        return
      }
    }

    DispatchQueue.main.async { [self] in
      self.loadCamera()
      self.dismantleCamera()
      self.setupCamera(
        direction: args.cameraDirection ?? "back",
        windowed: args.windowed ?? false
      )
      self.runScanner(invoke, args: args)
    }
  }

  @objc private func cancel(_ invoke: Invoke) {
    DispatchQueue.main.async { [self] in
      self.cancelScan()
      invoke.resolve()
    }
  }
}

@_cdecl("init_plugin_barcode_scanner")
public func initPlugin() -> Plugin {
  return BarcodeScannerPlugin()
}
