import SwiftUI
import WebKit
import UIKit
import Network
import Combine

@MainActor
final class WebViewModel: ObservableObject {
    static let openURLNotification = Notification.Name("bb.web.openURL")

    @Published var isOnline = true
    fileprivate weak var webView: WKWebView?

    func open(_ url: URL) {
        webView?.load(URLRequest(url: url))
    }
}

struct BurgerWebView: UIViewRepresentable {
    @ObservedObject var model: WebViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.userContentController.add(context.coordinator, name: "bbNative")

        let js = """
        (() => {
          window.BurgerBrothersNative = {
            platform: 'ios',
            appKind: '\(AppConfig.appKind)',
            requestNotifications: () =>
              window.webkit.messageHandlers.bbNative.postMessage({action:'requestNotifications'}),
            openNotificationSettings: () =>
              window.webkit.messageHandlers.bbNative.postMessage({action:'openNotificationSettings'}),
            share: (title, text, url) =>
              window.webkit.messageHandlers.bbNative.postMessage({
                action:'share', title:title || '', text:text || '', url:url || location.href
              })
          };
          window.dispatchEvent(new CustomEvent('bb:nativeReady', {
            detail: { platform:'ios', appKind:'\(AppConfig.appKind)' }
          }));
        })();
        """
        config.userContentController.addUserScript(
            WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = "BurgerBrothers-iOS/\(AppConfig.appKind)"

        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        context.coordinator.webView = webView
        model.webView = webView
        context.coordinator.start()

        webView.load(URLRequest(url: AppConfig.startURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.stop()
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "bbNative")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let model: WebViewModel
        weak var webView: WKWebView?

        private let monitor = NWPathMonitor()
        private let queue = DispatchQueue(label: "bb.network.\(AppConfig.appKind)")
        private var tokenObserver: NSObjectProtocol?
        private var urlObserver: NSObjectProtocol?

        init(model: WebViewModel) {
            self.model = model
        }

        @objc func refresh(_ sender: UIRefreshControl) {
            webView?.reload()
            sender.endRefreshing()
        }

        func start() {
            monitor.pathUpdateHandler = { [weak self] path in
                Task { @MainActor in
                    self?.model.isOnline = path.status == .satisfied
                }
            }
            monitor.start(queue: queue)

            tokenObserver = NotificationCenter.default.addObserver(
                forName: AppDelegate.pushTokenNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                if let token = note.userInfo?["token"] as? String {
                    self?.sendToken(token)
                }
            }

            urlObserver = NotificationCenter.default.addObserver(
                forName: WebViewModel.openURLNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                if let url = note.userInfo?["url"] as? URL {
                    self?.model.open(url)
                }
            }
        }

        func stop() {
            monitor.cancel()
            if let tokenObserver { NotificationCenter.default.removeObserver(tokenObserver) }
            if let urlObserver { NotificationCenter.default.removeObserver(urlObserver) }
        }

        private func sendToken(_ token: String) {
            let payload = [
                "token": token,
                "platform": "ios",
                "appKind": AppConfig.appKind
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }

            webView?.evaluateJavaScript("""
            window.dispatchEvent(new CustomEvent('bb:nativePushToken', { detail: \(json) }));
            """)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if let token = UserDefaults.standard.string(forKey: "bb.apnsToken") {
                sendToken(token)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            let scheme = url.scheme?.lowercased() ?? ""
            if ["tel", "mailto", "sms"].contains(scheme) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            if scheme == "http" || scheme == "https" {
                let host = url.host?.lowercased() ?? ""
                let trusted = host == "burger-brothers.berlin" || host == "www.burger-brothers.berlin"

                if trusted {
                    decisionHandler(.allow)
                } else {
                    UIApplication.shared.open(url)
                    decisionHandler(.cancel)
                }
                return
            }

            decisionHandler(.allow)
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any],
                  let action = body["action"] as? String else { return }

            switch action {
            case "requestNotifications":
                Task { @MainActor in
                    _ = await NotificationManager.shared.requestPermission()
                }

            case "openNotificationSettings":
                Task { @MainActor in
                    NotificationManager.shared.openSettings()
                }

            case "share":
                let title = body["title"] as? String ?? ""
                let text = body["text"] as? String ?? ""
                let raw = body["url"] as? String ?? ""
                var items: [Any] = []
                if !title.isEmpty { items.append(title) }
                if !text.isEmpty { items.append(text) }
                if let url = URL(string: raw) { items.append(url) }

                guard let vc = UIApplication.shared.bbTopViewController, !items.isEmpty else { return }

                let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
                if let popover = activity.popoverPresentationController {
                    popover.sourceView = vc.view
                    popover.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
                }
                vc.present(activity, animated: true)

            default:
                break
            }
        }
    }
}

private extension UIApplication {
    var bbTopViewController: UIViewController? {
        guard let scene = connectedScenes.compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
              let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
            return nil
        }

        var current = root
        while let presented = current.presentedViewController {
            current = presented
        }
        return current
    }
}
