import SwiftUI

struct RootView: View {
    @StateObject private var web = WebViewModel()
    @StateObject private var notifications = NotificationManager.shared
    @AppStorage("bb.notificationPromptHandled.v1") private var promptHandled = false
    @State private var showPrompt = false

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
            await notifications.registerIfAlreadyAllowed()
            if !promptHandled {
                try? await Task.sleep(for: .milliseconds(800))
                await notifications.refresh()
                if notifications.authorizationStatus == .notDetermined {
                    showPrompt = true
                } else {
                    promptHandled = true
                }
            }
        }
        .sheet(isPresented: $showPrompt) {
            VStack(spacing: 18) {
                Image(systemName: "bell.badge.fill")
                    .font(.system(size: 42))
                Text("Benachrichtigungen aktivieren?")
                    .font(.title2.bold())
                Text("Erhalte Bestellstatus und wichtige Burger Brothers Hinweise direkt auf dein iPhone.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                Button("Aktivieren") {
                    Task {
                        _ = await notifications.requestPermission()
                        promptHandled = true
                        showPrompt = false
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Button("Später") {
                    promptHandled = true
                    showPrompt = false
                }
                .foregroundStyle(.secondary)
            }
            .padding(24)
            .presentationDetents([.height(350)])
        }
    }
}
