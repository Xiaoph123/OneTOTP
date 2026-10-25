// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import AVFoundation
import UIKit

/// 相机预览容器。
///
/// 职责只有两件事：铺满父视图、随设备方向同步预览图层的方向。
class CameraView: UIView {
  var videoPreviewLayer: AVCaptureVideoPreviewLayer?

  func interfaceOrientationToVideoOrientation(_ orientation: UIInterfaceOrientation)
    -> AVCaptureVideoOrientation
  {
    switch orientation {
    case UIInterfaceOrientation.portrait:
      return AVCaptureVideoOrientation.portrait
    case UIInterfaceOrientation.portraitUpsideDown:
      return AVCaptureVideoOrientation.portraitUpsideDown
    case UIInterfaceOrientation.landscapeLeft:
      return AVCaptureVideoOrientation.landscapeLeft
    case UIInterfaceOrientation.landscapeRight:
      return AVCaptureVideoOrientation.landscapeRight
    default:
      return AVCaptureVideoOrientation.portrait
    }
  }

  /// 设备方向 → 顺时针旋转角度。
  ///
  /// iOS 17 起 `videoOrientation` 被废弃，官方替代是 `videoRotationAngle`。
  /// 两者对「画面前方」的定义不同：rotationAngle 以传感器原始方向为 0°，
  /// 竖向手持时需要 90°。这里按 interfaceOrientation 换算。
  private func rotationAngle(for orientation: UIInterfaceOrientation) -> CGFloat {
    switch orientation {
    case .portrait:
      return 90
    case .portraitUpsideDown:
      return 270
    case .landscapeLeft:
      return 0
    case .landscapeRight:
      return 180
    default:
      return 90
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if let sublayers = self.layer.sublayers {
      for layer in sublayers {
        layer.frame = self.bounds
      }
    }

    guard
      let interfaceOrientation = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .first(where: { $0.activationState == .foregroundActive })?
        .interfaceOrientation
    else { return }

    guard let connection = videoPreviewLayer?.connection else { return }
    if #available(iOS 17.0, *) {
      // 角度在部分镜头组合下不可任意设置，越界会抛异常，先校验再赋值
      let angle = rotationAngle(for: interfaceOrientation)
      if connection.isVideoRotationAngleSupported(angle) {
        connection.videoRotationAngle = angle
      }
    } else {
      connection.videoOrientation = interfaceOrientationToVideoOrientation(interfaceOrientation)
    }
  }

  func addPreviewLayer(_ previewLayer: AVCaptureVideoPreviewLayer?) {
    previewLayer!.videoGravity = AVLayerVideoGravity.resizeAspectFill
    previewLayer!.frame = self.bounds
    self.layer.addSublayer(previewLayer!)
    self.videoPreviewLayer = previewLayer
  }

  func removePreviewLayer() {
    if self.videoPreviewLayer != nil {
      self.videoPreviewLayer!.removeFromSuperlayer()
      self.videoPreviewLayer = nil
    }
  }
}
