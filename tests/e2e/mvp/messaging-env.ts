import path from "node:path";
/*
 * Test-only chat channel settings for the "Send places from chat" browser
 * tests, shared by playwright.config.ts (the dev server) and the spec,
 * which signs webhook bodies with the same secrets. Never real credentials.
 * Replies are captured as files under this run's capture directory, which
 * tests/e2e/global-teardown.ts removes.
 */
export const e2eMessaging = {
  lineSecret: "e2e-line-channel-secret-0123456789",
  instagramSecret: "e2e-instagram-app-secret-0123456789",
  instagramVerifyToken: "e2e-instagram-verify-token-0123456789",
};
export function messagingCaptureDir() {
  return path.join(process.env.E2E_MAIL_CAPTURE_DIR ?? "", "messaging");
}
export function messagingServerEnv(): Record<string, string> {
  return {
    FEATURE_CHAT_CAPTURE: "true",
    LINE_CHANNEL_SECRET: e2eMessaging.lineSecret,
    LINE_CHANNEL_ACCESS_TOKEN: "e2e-line-access-token",
    LINE_ADD_FRIEND_URL: "https://line.me/R/ti/p/@locallink-e2e",
    INSTAGRAM_APP_SECRET: e2eMessaging.instagramSecret,
    INSTAGRAM_VERIFY_TOKEN: e2eMessaging.instagramVerifyToken,
    INSTAGRAM_ACCESS_TOKEN: "e2e-instagram-access-token",
    INSTAGRAM_ACCOUNT_HANDLE: "locallink.e2e",
    MESSAGING_PROVIDER: "capture",
    MESSAGING_CAPTURE_DIR: messagingCaptureDir(),
  };
}
