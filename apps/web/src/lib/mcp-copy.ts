/** Copy for the OAuth consent screen MCP connectors (ChatGPT, Claude) send members to. */
export const mcpConsentEn = {
  pageTitle: "Connect an app",
  title: "Connect {client} to {brand}",
  intro: "{client} is asking to use your {brand} account.",
  returnsTo: "After you choose, you’ll go back to {host}.",
  scopesHeading: "If you allow it, it can:",
  scopeRead: "See your layers, your groups’ layers and the places on them",
  scopeWrite: "Create layers and add or remove places on layers you can edit",
  scopeOffline: "Stay connected without asking you to sign in again",
  trust:
    "Only allow apps you trust. It acts as you and can see your private layers.",
  allow: "Allow",
  deny: "Deny",
  working: "Working…",
  failed: "Something went wrong. Please try again.",
  invalid:
    "This connection request is invalid or has expired. Start again from the app you were using.",
  notMember: "Only {brand} members can connect apps.",
  unknownClient: "An app",
};
export type McpConsentCopy = typeof mcpConsentEn;
export const mcpConsentZh: McpConsentCopy = {
  pageTitle: "連結應用程式",
  title: "將{client}連結到{brand}",
  intro: "{client}要求使用你的{brand}帳號。",
  returnsTo: "選擇後，你將回到{host}。",
  scopesHeading: "允許後，它可以：",
  scopeRead: "查看你的圖層、你群組的圖層，以及其中的地點",
  scopeWrite: "建立圖層，並在你可編輯的圖層中新增或移除地點",
  scopeOffline: "保持連結，不必再次登入",
  trust: "只允許你信任的應用程式。它會以你的身分操作，並能看到你的私人圖層。",
  allow: "允許",
  deny: "拒絕",
  working: "處理中…",
  failed: "發生錯誤，請再試一次。",
  invalid: "此連結請求無效或已過期，請回到原本使用的應用程式重新開始。",
  notMember: "只有{brand}會員可以連結應用程式。",
  unknownClient: "某個應用程式",
};
