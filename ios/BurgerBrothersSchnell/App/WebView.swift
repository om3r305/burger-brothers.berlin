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

/// Which URLs stay inside the app and which are handed to Safari / other apps.
enum WebPolicy {
    static let siteHosts: Set<String> = ["burger-brothers.berlin", "www.burger-brothers.berlin"]

    static func isSite(_ url: URL?) -> Bool {
        siteHosts.contains(url?.host?.lowercased() ?? "")
    }

    /// Stripe Checkout, Stripe 3-D Secure hooks and Stripe's own frames.
    static func isPayment(_ url: URL?) -> Bool {
        let host = url?.host?.lowercased() ?? ""
        return host == "stripe.com" || host.hasSuffix(".stripe.com")
            || host == "stripe.network" || host.hasSuffix(".stripe.network")
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
        config.allowsInlineMediaPlayback = true
        // Keep Safari's full mobile user agent (Stripe, Google Maps and the
        // site's mobile detection rely on it) and only append the app token.
        config.applicationNameForUserAgent = "Mobile/15E148 BurgerBrothers-iOS/\(AppConfig.appKind)"
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
        // Horizontal swipes belong to the web menu, never page history.
        webView.allowsBackForwardNavigationGestures = false

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

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let model: WebViewModel
        weak var webView: WKWebView?

        private let monitor = NWPathMonitor()
        private let queue = DispatchQueue(label: "bb.network.\(AppConfig.appKind)")
        private var tokenObserver: NSObjectProtocol?
        private var urlObserver: NSObjectProtocol?

        /// True from the moment a Stripe page is reached until the site loads
        /// again. Banks (3-D Secure), PayPal and Klarna continue the payment on
        /// their own domains and must stay inside the app during that time.
        private var inPaymentFlow = false
        /// The last main-frame load failed because of the network.
        private var lastLoadFailed = false

        init(model: WebViewModel) {
            self.model = model
        }

        @objc func refresh(_ sender: UIRefreshControl) {
            reloadOrStart()
            sender.endRefreshing()
        }

        private func reloadOrStart() {
            guard let webView else { return }
            if webView.url == nil {
                webView.load(URLRequest(url: AppConfig.startURL))
            } else {
                webView.reload()
            }
        }

        func start() {
            monitor.pathUpdateHandler = { @Sendable [weak self] path in
                let online = path.status == .satisfied
                Task { @MainActor [weak self] in
                    self?.networkChanged(online: online)
                }
            }
            monitor.start(queue: queue)

            tokenObserver = NotificationCenter.default.addObserver(
                forName: AppDelegate.pushTokenNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                guard let token = note.userInfo?["token"] as? String else { return }
                Task { @MainActor [weak self] in
                    self?.sendToken(token)
                }
            }

            urlObserver = NotificationCenter.default.addObserver(
                forName: WebViewModel.openURLNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                guard let url = note.userInfo?["url"] as? URL, WebPolicy.isSite(url) else { return }
                Task { @MainActor [weak self] in
                    self?.model.open(url)
                }
            }
        }

        func stop() {
            monitor.cancel()
            if let tokenObserver { NotificationCenter.default.removeObserver(tokenObserver) }
            if let urlObserver { NotificationCenter.default.removeObserver(urlObserver) }
        }

        private func networkChanged(online: Bool) {
            let cameBack = online && !model.isOnline
            model.isOnline = online
            if cameBack && lastLoadFailed {
                reloadOrStart()
            }
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

        // MARK: - Navigation

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            if WebPolicy.isPayment(webView.url) {
                inPaymentFlow = true
            } else if WebPolicy.isSite(webView.url) {
                inPaymentFlow = false
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            lastLoadFailed = false
            if let token = UserDefaults.standard.string(forKey: "bb.apnsToken") {
                sendToken(token)
            }
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            let nsError = error as NSError
            guard nsError.domain == NSURLErrorDomain else { return }
            let networkCodes = [
                NSURLErrorNotConnectedToInternet,
                NSURLErrorNetworkConnectionLost,
                NSURLErrorTimedOut,
                NSURLErrorCannotFindHost,
                NSURLErrorCannotConnectToHost,
                NSURLErrorDNSLookupFailed
            ]
            if networkCodes.contains(nsError.code) {
                lastLoadFailed = true
            }
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            reloadOrStart()
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
            switch scheme {
            case "http", "https":
                break
            case "about", "blob", "data", "javascript":
                decisionHandler(.allow)
                return
            default:
                // tel:, mailto:, sms:, maps: and banking-app hand-offs.
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            // New windows (target=_blank / window.open) are handled in createWebViewWith.
            guard let targetFrame = navigationAction.targetFrame else {
                decisionHandler(.allow)
                return
            }

            // Stripe, 3-D Secure and map iframes always load inside the page.
            if !targetFrame.isMainFrame {
                decisionHandler(.allow)
                return
            }

            if WebPolicy.isSite(url) {
                decisionHandler(.allow)
                return
            }

            if WebPolicy.isPayment(url) {
                inPaymentFlow = true
                decisionHandler(.allow)
                return
            }

            if inPaymentFlow {
                decisionHandler(.allow)
                return
            }

            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
                if WebPolicy.isSite(url) {
                    webView.load(navigationAction.request)
                } else {
                    UIApplication.shared.open(url)
                }
            }
            return nil
        }

        // MARK: - JavaScript dialogs (alert / confirm / prompt)

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            guard let vc = UIApplication.shared.bbTopViewController else {
                completionHandler()
                return
            }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            vc.present(alert, animated: true)
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            guard let vc = UIApplication.shared.bbTopViewController else {
                completionHandler(false)
                return
            }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Abbrechen", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            vc.present(alert, animated: true)
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            guard let vc = UIApplication.shared.bbTopViewController else {
                completionHandler(nil)
                return
            }
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "Abbrechen", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                completionHandler(alert.textFields?.first?.text ?? "")
            })
            vc.present(alert, animated: true)
        }

        // MARK: - Bridge

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard WebPolicy.isSite(message.frameInfo.request.url),
                  let body = message.body as? [String: Any],
                  let action = body["action"] as? String else { return }

            switch action {
            case "requestNotifications":
                Task { @MainActor in
                    _ = await NotificationManager.shared.requestPermission()
                }

            case "openNotificationSettings":
                NotificationManager.shared.openSettings()

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
