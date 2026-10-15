import SwiftUI

struct RootView: View {
    @StateObject private var web = WebViewModel()
    @StateObject private var notifications = NotificationManager.shared

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            BurgerWebView(model: web)
                .ignoresSafeArea(edges: .bottom)

            if !web.isOnline {
                VStack {
                    Text("Keine Internetverbindung")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 8)
                    Spacer()
                }
            }
        }
        .task {
            // The permission question itself is asked by the website
            // ("Benachrichtigungen aktivieren?") through the bbNative bridge,
            // so the consent choice and the server registration stay in one place.
            await notifications.registerIfAlreadyAllowed()
        }
    }
}
