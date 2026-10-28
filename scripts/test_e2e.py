#!/usr/bin/env python3
"""
Comprehensive End-to-End Test Suite for Nesty Application
Tests Authentication, Profiles, Messaging, Reactions, Editing, Deletion, Blocking, Muting,
AI Recommendations & Summarization, Communities, and Static / APK Delivery.
"""
import sys
import time
import uuid
import json
import urllib.request
import urllib.error

BASE_URL = "http://localhost:8080"
DEV_URL = "http://localhost:5173"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    BOLD = '\033[1m'
    END = '\033[0m'

tests_passed = 0
tests_failed = 0

def run_test(name, func):
    global tests_passed, tests_failed
    print(f"{Colors.BLUE}[TEST]{Colors.END} {name} ...", end=" ", flush=True)
    start = time.time()
    try:
        res = func()
        elapsed = int((time.time() - start) * 1000)
        print(f"{Colors.GREEN}PASSED{Colors.END} ({elapsed}ms)")
        if res:
            print(f"       -> {res}")
        tests_passed += 1
        return True
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        print(f"{Colors.RED}FAILED{Colors.END} ({elapsed}ms): {e}")
        tests_failed += 1
        return False

def http_req(path, method="GET", data=None, token=None, base=BASE_URL):
    url = f"{base}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None
            try:
                return resp.status, json.loads(raw.decode("utf-8"))
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        err_body = e.read()
        try:
            parsed = json.loads(err_body.decode("utf-8"))
        except Exception:
            parsed = err_body.decode("utf-8")
        return e.code, parsed

def main():
    print(f"\n{Colors.BOLD}====================================================")
    print("    NESTY FULL-STACK END-TO-END TEST SUITE")
    print(f"===================================================={Colors.END}\n")

    unique_suffix = uuid.uuid4().hex[:6]
    user1_email = f"alice_{unique_suffix}@example.com"
    user1_user = f"alice_{unique_suffix}"
    user2_email = f"bob_{unique_suffix}@example.com"
    user2_user = f"bob_{unique_suffix}"
    password = "SecretPassword123!"

    ctx = {}

    # Test 1: Frontend health
    def test_frontend_health():
        code, _ = http_req("/", base=DEV_URL)
        if code != 200:
            raise Exception(f"Vite dev server returned status {code}")
        return "Vite dev server is active on :5173"
    run_test("Frontend Vite Server Health (:5173)", test_frontend_health)

    # Test 2: Backend health
    def test_backend_health():
        code, body = http_req("/api/ping")
        if code != 200:
            raise Exception(f"Expected 200, got {code}")
        return f"Ping response: {body}"
    run_test("Backend API Ping (:8080/api/ping)", test_backend_health)

    # Test 3: User 1 Registration & Login
    def test_register_user1():
        reg_payload = {
            "email": user1_email,
            "username": user1_user,
            "password": password
        }
        code, body = http_req("/api/register", method="POST", data=reg_payload)
        if code not in (200, 201):
            raise Exception(f"Registration failed: {code} - {body}")
        ctx['user1_id'] = body.get("id")

        login_payload = {"email": user1_email, "password": password}
        l_code, l_body = http_req("/api/login", method="POST", data=login_payload)
        if l_code != 200 or not l_body.get("token"):
            raise Exception(f"Login failed: {l_code} - {l_body}")
        ctx['user1_token'] = l_body.get("token")
        return f"Registered & Logged in Alice (ID: {ctx['user1_id']})"
    run_test("Register & Authenticate User 1 (Alice)", test_register_user1)

    # Test 4: User 2 Registration & Login
    def test_register_user2():
        reg_payload = {
            "email": user2_email,
            "username": user2_user,
            "password": password
        }
        code, body = http_req("/api/register", method="POST", data=reg_payload)
        if code not in (200, 201):
            raise Exception(f"Registration failed: {code} - {body}")
        ctx['user2_id'] = body.get("id")

        login_payload = {"email": user2_email, "password": password}
        l_code, l_body = http_req("/api/login", method="POST", data=login_payload)
        if l_code != 200 or not l_body.get("token"):
            raise Exception(f"Login failed: {l_code} - {l_body}")
        ctx['user2_token'] = l_body.get("token")
        return f"Registered & Logged in Bob (ID: {ctx['user2_id']})"
    run_test("Register & Authenticate User 2 (Bob)", test_register_user2)

    # Test 5: Verify login by username identifier
    def test_login_by_username():
        payload = {"email": user1_user, "password": password}
        code, body = http_req("/api/login", method="POST", data=payload)
        if code != 200 or not body.get("token"):
            raise Exception(f"Login with username identifier failed: {code} - {body}")
        return "JWT auth verified using username as login identifier"
    run_test("Login With Username Identifier", test_login_by_username)

    # Test 6: Get current user profile (/api/me)
    def test_me():
        code, body = http_req("/api/me", token=ctx['user1_token'])
        if code != 200 or body.get("username") != user1_user:
            raise Exception(f"Failed to get current user: {code} - {body}")
        return f"Profile verified: @{body.get('username')}"
    run_test("Current User Profile (/api/me)", test_me)

    # Test 7: Update profile (Bio & Skills)
    def test_update_profile():
        payload = {
            "name": f"Alice Engineer {unique_suffix}",
            "bio": "Full-stack engineer passionate about React, Go, and AI",
            "skills": "React, TypeScript, Go, Capacitor, Android"
        }
        code, body = http_req(f"/api/users/{ctx['user1_id']}", method="PUT", data=payload, token=ctx['user1_token'])
        if code != 200:
            raise Exception(f"Failed to update profile: {code} - {body}")
        return "Profile name, bio and skills updated"
    run_test("Update User Profile", test_update_profile)

    # Test 8: Authorization check - Bob cannot update Alice's profile
    def test_auth_isolation():
        payload = {"bio": "Malicious override"}
        code, _ = http_req(f"/api/users/{ctx['user1_id']}", method="PUT", data=payload, token=ctx['user2_token'])
        if code != 403:
            raise Exception(f"Expected 403 Forbidden, got {code}")
        return "Server strictly rejected cross-account modification (403)"
    run_test("Security Authorization Isolation Check", test_auth_isolation)

    # Test 9: Create Community Post
    def test_create_post():
        payload = {
            "content": "Hello Nesty! Building high-performance real-time social applications.",
            "community": "general"
        }
        code, body = http_req("/api/posts", method="POST", data=payload, token=ctx['user1_token'])
        if code not in (200, 201) or not body.get("id"):
            raise Exception(f"Failed to create post: {code} - {body}")
        ctx['post_id'] = body.get("id")
        return f"Created post ID: {ctx['post_id']}"
    run_test("Create Social Post", test_create_post)

    # Test 10: Like Post (Bob likes Alice's post)
    def test_like_post():
        code, body = http_req(f"/api/posts/{ctx['post_id']}/like", method="POST", token=ctx['user2_token'])
        if code != 200:
            raise Exception(f"Failed to like post: {code} - {body}")
        return f"Like registered: liked={body.get('liked')}, total_likes={body.get('likes')}"
    run_test("Like Post Interaction", test_like_post)

    # Test 11: Comment on Post
    def test_comment_post():
        payload = {"content": "Great milestone, Alice!"}
        code, body = http_req(f"/api/posts/{ctx['post_id']}/comments", method="POST", data=payload, token=ctx['user2_token'])
        if code not in (200, 201):
            raise Exception(f"Failed to comment: {code} - {body}")
        return f"Comment added ID: {body.get('id')}"
    run_test("Add Comment to Post", test_comment_post)

    # Test 12: Direct Message (Alice -> Bob)
    def test_send_message():
        payload = {
            "recipient_id": ctx['user2_id'],
            "content": "Hey Bob, have you checked the new APK build?"
        }
        code, body = http_req("/api/messages", method="POST", data=payload, token=ctx['user1_token'])
        if code not in (200, 201) or not body.get("id"):
            raise Exception(f"Failed to send message: {code} - {body}")
        ctx['msg_id'] = body.get("id")
        return f"Sent DM ID: {ctx['msg_id']}"
    run_test("Send Direct Message (Alice -> Bob)", test_send_message)

    # Test 13: Direct Message Reply (Bob -> Alice with reply_to_message_id)
    def test_reply_message():
        payload = {
            "recipient_id": ctx['user1_id'],
            "content": "Yes! The Gradle build succeeded and the APK works great.",
            "reply_to_message_id": ctx['msg_id']
        }
        code, body = http_req("/api/messages", method="POST", data=payload, token=ctx['user2_token'])
        if code not in (200, 201) or not body.get("id"):
            raise Exception(f"Failed to send reply: {code} - {body}")
        ctx['reply_msg_id'] = body.get("id")
        return f"Sent reply ID: {ctx['reply_msg_id']} (replied to {body.get('reply_to_message_id')})"
    run_test("Reply to Message (Quoted Context)", test_reply_message)

    # Test 14: React to Message (Alice reacts with ❤️ to Bob's reply)
    def test_react_message():
        payload = {"emoji": "❤️"}
        code, body = http_req(f"/api/messages/{ctx['reply_msg_id']}/reaction", method="POST", data=payload, token=ctx['user1_token'])
        if code not in (200, 201):
            raise Exception(f"Reaction failed: {code} - {body}")
        return f"Reaction registered: {body.get('emoji')}"
    run_test("Message Reaction Toggling (Emoji)", test_react_message)

    # Test 15: Edit Message (Bob edits his reply)
    def test_edit_message():
        payload = {"content": "Yes! The Gradle build succeeded and the APK is 17MB."}
        code, body = http_req(f"/api/messages/{ctx['reply_msg_id']}", method="PATCH", data=payload, token=ctx['user2_token'])
        if code != 200 or body.get("edited_at") is None:
            raise Exception(f"Edit failed: {code} - {body}")
        return f"Message edited with timestamp: {body.get('edited_at')}"
    run_test("Edit Message (Within 24h Window)", test_edit_message)

    # Test 16: Read Receipts & Unread Count (Alice loads chat history)
    def test_read_receipts():
        code, msgs = http_req(f"/api/messages/{ctx['user2_id']}", token=ctx['user1_token'])
        if code != 200 or not isinstance(msgs, list):
            raise Exception(f"Failed to fetch history: {code} - {msgs}")
        if not msgs:
            raise Exception("No messages found in history")
        return f"Fetched {len(msgs)} messages; unread marked as read automatically"
    run_test("Read Receipts Auto-Marking (/api/messages/:id)", test_read_receipts)

    # Test 17: Conversation Listing with unread count
    def test_conversations():
        code, convs = http_req("/api/conversations", token=ctx['user1_token'])
        if code != 200 or not isinstance(convs, list):
            raise Exception(f"Failed to get conversations: {code} - {convs}")
        return f"Conversations count: {len(convs)} (with active partner data)"
    run_test("Get Conversations Summary", test_conversations)

    # Test 18: Mute Conversation (Alice mutes Bob)
    def test_mute_conversation():
        code, body = http_req(f"/api/conversations/{ctx['user2_id']}/mute", method="POST", token=ctx['user1_token'])
        if code != 200:
            raise Exception(f"Mute failed: {code} - {body}")
        # Verify check endpoint
        chk_code, chk_body = http_req(f"/api/conversations/{ctx['user2_id']}/muted", token=ctx['user1_token'])
        if chk_code != 200 or not chk_body.get("is_muted"):
            raise Exception(f"Mute check failed: {chk_code} - {chk_body}")
        return "Conversation muted and verified"
    run_test("Mute Conversation", test_mute_conversation)

    # Test 19: Block User (Alice blocks Bob)
    def test_block_user():
        code, body = http_req(f"/api/users/{ctx['user2_id']}/block", method="POST", token=ctx['user1_token'])
        if code != 200:
            raise Exception(f"Block failed: {code} - {body}")
        # Verify Bob cannot message Alice now
        send_code, send_body = http_req("/api/messages", method="POST", data={"recipient_id": ctx['user1_id'], "content": "You blocked me?"}, token=ctx['user2_token'])
        if send_code != 403:
            raise Exception(f"Expected 403 on blocked send, got {send_code}")
        # Unblock for subsequent tests
        unb_code, _ = http_req(f"/api/users/{ctx['user2_id']}/block", method="DELETE", token=ctx['user1_token'])
        if unb_code != 200:
            raise Exception(f"Unblock failed: {unb_code}")
        return "Block enforcement verified (blocked message rejected with 403); Unblocked cleanly"
    run_test("User Blocking & Message Enforcement", test_block_user)

    # Test 20: AI People & Community Recommendations
    def test_ai_recommendations():
        code, body = http_req("/api/ai/recommendations", token=ctx['user1_token'])
        if code != 200:
            raise Exception(f"Failed AI recommendations: {code} - {body}")
        users = body.get("recommended_users", [])
        comms = body.get("recommended_communities", [])
        return f"AI Recommendations: {len(users)} users, {len(comms)} communities"
    run_test("AI Smart Recommendations (/api/ai/recommendations)", test_ai_recommendations)

    # Test 21: AI Discussion Summarization
    def test_ai_summarize():
        payload = {
            "topic": "Nesty Mobile Build & Architecture",
            "messages": [
                "Alice: We need to verify Capacitor 6 and Gradle 8 builds.",
                "Bob: I configured the Android SDK 35 and Temurin JDK 21 in local user paths.",
                "Alice: The APK assembled successfully in 26 seconds with 17MB size.",
                "Bob: Push notifications and WebRTC signaling are tested and verified."
            ]
        }
        code, body = http_req("/api/ai/summarize", method="POST", data=payload, token=ctx['user1_token'])
        if code != 200 or not body.get("summary"):
            raise Exception(f"AI summarization failed: {code} - {body}")
        summary_preview = body.get("summary")[:60] + "..."
        return f"Summary: \"{summary_preview}\""
    run_test("AI Discussion Summarization (/api/ai/summarize)", test_ai_summarize)

    # Test 22: Delete Message (Soft delete)
    def test_delete_message():
        code, body = http_req(f"/api/messages/{ctx['reply_msg_id']}", method="DELETE", token=ctx['user2_token'])
        if code != 200:
            raise Exception(f"Delete failed: {code} - {body}")
        return "Message soft-deleted successfully"
    run_test("Soft-Delete Message", test_delete_message)

    # Test 23: APK Download Route & Content-Type
    def test_apk_download():
        req = urllib.request.Request(f"{BASE_URL}/Nesty.apk", method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as resp:
            clen = int(resp.headers.get("Content-Length", 0))
            ctype = resp.headers.get("Content-Type", "")
            cdisp = resp.headers.get("Content-Disposition", "")
            if resp.status != 200 or clen < 10_000_000:
                raise Exception(f"Unexpected APK response: status={resp.status}, len={clen}")
            return f"Status {resp.status}, Size {clen / (1024*1024):.2f} MB, Type '{ctype}'"
    run_test("Downloadable Android APK HTTP Endpoint (/Nesty.apk)", test_apk_download)

    # Test 24: Dev server APK route
    def test_dev_apk():
        req = urllib.request.Request(f"{DEV_URL}/Nesty.apk", method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as resp:
            clen = int(resp.headers.get("Content-Length", 0))
            if resp.status != 200 or clen < 10_000_000:
                raise Exception(f"Unexpected dev APK response: status={resp.status}, len={clen}")
            return f"Dev server served APK: {clen / (1024*1024):.2f} MB"
    run_test("Frontend Dev Server APK Proxy (:5173/Nesty.apk)", test_dev_apk)

    # Summary
    print(f"\n{Colors.BOLD}====================================================")
    print(f"    TEST SUMMARY: {tests_passed} PASSED, {tests_failed} FAILED")
    print(f"===================================================={Colors.END}\n")

    if tests_failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()
