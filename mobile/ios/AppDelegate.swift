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
        print("[CallLog] [iOS] App didFinishLaunching: Initializing native CallKit & PushKit")
        setupCallKit()
        setupPushKitVoIP()
        return true
    }

    // MARK: - CallKit Setup
    private func setupCallKit() {
        let configuration = CXProviderConfiguration(localizedName: "Nesty")
        configuration.supportsVideo = true
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.iconTemplateImageData = UIImage(named: "AppIcon")?.pngData()
        configuration.ringtoneSound = "ringtone.caf"

        callKitProvider = CXProvider(configuration: configuration)
        callKitProvider?.setDelegate(self, queue: nil)
        print("[CallLog] [iOS] CXProvider initialized with localizedName: Nesty")
    }

    // MARK: - PushKit VoIP Registration
    private func setupPushKitVoIP() {
        voipRegistry = PKPushRegistry(queue: DispatchQueue.main)
        voipRegistry?.delegate = self
        voipRegistry?.desiredPushTypes = [.voIP]
        print("[CallLog] [iOS] PushKit VoIP registry configured for .voIP")
    }

    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02.2hhx", $0) }.joined()
        print("[CallLog] [iOS] PushKit VoIP token updated: \(token)")
        registerVoipTokenWithBackend(token: token)
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        print("[CallLog] [iOS] PushKit VoIP token invalidated")
    }

    // MARK: - Incoming VoIP Push (High-Priority Background Wake-up)
    // Mandatory for iOS 13+: Must report incoming call to CXProvider immediately in this callback!
    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP, let dict = payload.dictionaryPayload as? [String: Any] else {
            print("[CallLog] [iOS] Received invalid push payload, ignoring")
            completion()
            return
        }

        let action = dict["action"] as? String ?? ""
        let callId = dict["callId"] as? String ?? UUID().uuidString
        let callerName = dict["callerName"] as? String ?? "Nesty User"
        let callType = dict["callType"] as? String ?? "audio"

        print("[CallLog] [iOS] PushKit push received: action=\(action), callId=\(callId), caller=\(callerName), type=\(callType)")

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

            // Report immediately to CallKit -> Presents the native iOS full-screen call UI!
            print("[CallLog] [iOS] Reporting new incoming call to CXProvider: uuid=\(uuid)")
            callKitProvider?.reportNewIncomingCall(with: uuid, update: update) { error in
                if let error = error {
                    print("[CallLog] [iOS] Error reporting CallKit incoming call: \(error.localizedDescription)")
                } else {
                    print("[CallLog] [iOS] Successfully presented native iOS CallKit screen")
                }
                completion()
            }
        } else if action == "call_cancel" {
            print("[CallLog] [iOS] Received call_cancel: Ending CallKit ringing for callId=\(callId)")
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
        print("[CallLog] [iOS] CXProvider reset: clearing activeCallUUID")
        self.activeCallUUID = nil
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        print("[CallLog] [iOS] CXAnswerCallAction tapped: Launching app into active call screen")
        // User pressed "Answer" on native lock-screen / banner -> deep link into WebRTC view
        let url = URL(string: "devnest://call?action=answer")!
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        print("[CallLog] [iOS] CXEndCallAction tapped (Decline / End): Notifying backend")
        let url = URL(string: "devnest://call?action=decline")!
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        self.activeCallUUID = nil
        action.fulfill()
    }

    // MARK: - Backend Token Sync
    private func registerVoipTokenWithBackend(token: String) {
        let apiUrl = "https://nesty.onrender.com/api/devices"
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

        URLSession.shared.dataTask(with: request) { _, response, error in
            if let httpResp = response as? HTTPURLResponse {
                print("[CallLog] [iOS] Synced VoIP token to Nesty backend: HTTP \(httpResp.statusCode)")
            } else if let error = error {
                print("[CallLog] [iOS] Error syncing VoIP token: \(error.localizedDescription)")
            }
        }.resume()
    }
}
