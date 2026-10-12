import UIKit
import PushKit
import CallKit
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, PKPushRegistryDelegate, CXProviderDelegate {

    var window: UIWindow?
    var callKitProvider: CXProvider?
    var voipRegistry: PKPushRegistry?
    var activeCallUUID: UUID?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        setupCallKit()
        setupPushKitVoIP()
        return true
    }

    // MARK: - CallKit Setup
    private func setupCallKit() {
        let configuration = CXProviderConfiguration(localizedName: "DevNest")
        configuration.supportsVideo = true
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.iconTemplateImageData = UIImage(named: "AppIcon")?.pngData()

        callKitProvider = CXProvider(configuration: configuration)
        callKitProvider?.setDelegate(self, queue: nil)
    }

    // MARK: - PushKit VoIP Registration
    private func setupPushKitVoIP() {
        voipRegistry = PKPushRegistry(queue: DispatchQueue.main)
        voipRegistry?.delegate = self
        voipRegistry?.desiredPushTypes = [.voIP]
    }

    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02.2hhx", $0) }.joined()
        print("[PushKit] VoIP Token: \(token)")
        registerVoipTokenWithBackend(token: token)
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        print("[PushKit] VoIP Token invalidated")
    }

    // MARK: - Incoming VoIP Push (High-Priority Background Wake-up)
    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP, let dict = payload.dictionaryPayload as? [String: Any] else {
            completion()
            return
        }

        let action = dict["action"] as? String ?? ""
        let callId = dict["callId"] as? String ?? UUID().uuidString
        let callerName = dict["callerName"] as? String ?? "DevNest User"
        let callType = dict["callType"] as? String ?? "audio"

        if action == "call_invite" {
            let uuid = UUID()
            self.activeCallUUID = uuid

            let update = CXCallUpdate()
            update.remoteHandle = CXHandle(type: .generic, value: callerName)
            update.localizedCallerName = callerName
            update.hasVideo = (callType == "video")
            update.supportsGrouping = false
            update.supportsUngrouping = false
            update.supportsHolding = false

            // Report incoming call to iOS system -> Triggers native full screen CallKit UI!
            callKitProvider?.reportNewIncomingCall(with: uuid, update: update) { error in
                if let error = error {
                    print("[CallKit] Error reporting call: \(error)")
                }
                completion()
            }
        } else if action == "call_cancel" {
            // Dismiss active ringing
            if let uuid = self.activeCallUUID {
                callKitProvider?.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
                self.activeCallUUID = nil
            }
            completion()
        } else {
            completion()
        }
    }

    // MARK: - CXProviderDelegate Actions
    func providerDidReset(_ provider: CXProvider) {
        self.activeCallUUID = nil
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        // User tapped 'Answer' on the native iOS CallKit screen
        // Foreground/launch app directly into the call screen
        let url = URL(string: "devnest://call?action=answer")!
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        // User tapped 'Decline' on native CallKit screen -> Notify backend
        let url = URL(string: "devnest://call?action=decline")!
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        self.activeCallUUID = nil
        action.fulfill()
    }

    // MARK: - Backend Token Sync
    private func registerVoipTokenWithBackend(token: String) {
        let apiUrl = "https://piscine-devnest.onrender.com/api/devices"
        guard let url = URL(string: apiUrl) else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "token": token,
            "platform": "ios",
            "voip_token": token
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [])

        URLSession.shared.dataTask(with: request).resume()
    }
}
