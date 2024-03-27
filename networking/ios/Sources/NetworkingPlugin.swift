// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import AVFoundation
import Tauri
import UIKit
import WebKit

class NetworkingPlugin: Plugin {
    var webView: WKWebView!
    var cameraView: CameraView!
    var captureSession: AVCaptureSession?
    var captureVideoPreviewLayer: AVCaptureVideoPreviewLayer?
    var metaOutput: AVCaptureMetadataOutput?

    var currentCamera = 0
    var frontCamera: AVCaptureDevice?
    var backCamera: AVCaptureDevice?

    var isScanning = false

    var windowed = false
    var previousBackgroundColor: UIColor? = UIColor.white

    var invoke: Invoke? = nil

    var scanFormats = [AVMetadataObject.ObjectType]()

    override public func load(webview: WKWebView) {
        webView = webview
        loadCamera()
    }

    @objc override func checkPermissions(_: Invoke) {}

    @objc override func requestPermissions(_: Invoke) {}

    @objc func openAppSettings(_: Invoke) {}
}

@_cdecl("init_plugin_webb_networking")
func initPlugin() -> Plugin {
    return NetworkingPlugin()
}
