import { brand } from "@taiwanhub/shared";
/*
 * Bot replies for "Send places from chat", English and Traditional Chinese.
 * A linked sender gets their preferred language; an unlinked sender gets
 * both, since we do not know who they are yet.
 */
export type BotLocale = "en" | "zh-TW";
type Copy = {
  welcome: (connectUrl: string) => string;
  codeUnknown: (connectUrl: string) => string;
  codeTaken: string;
  pending: (connectUrl: string) => string;
  pendingStill: (connectUrl: string) => string;
  help: (layer: string) => string;
  added: (names: string[], layer: string, layerUrl: string) => string;
  duplicate: (layer: string, layerUrl: string) => string;
  fellBack: (layer: string) => string;
  notFound: string;
  unsupportedList: string;
  instagramFound: (names: string[], layerUrl: string) => string;
  instagramNotFound: string;
  tooMany: (max: number) => string;
  busy: string;
  unavailable: string;
  notMember: string;
};
const en: Copy = {
  welcome: (url) =>
    `Hi! Send me a Google Maps link and I'll add the place to your ${brand.name} layer.\n\nFirst, connect your account: open ${url}, choose Connect, and send me the code it shows.`,
  codeUnknown: (url) =>
    `That code didn't work. It may have expired or been used. Get a new one at ${url}`,
  codeTaken:
    "This chat is already connected to another account. Disconnect it there first.",
  pending: (url) =>
    `Almost done. Go back to ${url} and tap Confirm to finish connecting.`,
  pendingStill: (url) =>
    `Your connection isn't confirmed yet. Tap Confirm at ${url}`,
  help: (layer) =>
    `Send me a Google Maps link and I'll add it to "${layer}". Change where places go on the ${brand.name} connections page.`,
  added: (names, layer, url) =>
    `Added ${names.join(", ")} to "${layer}".\n${url}`,
  duplicate: (layer, url) => `That place is already in "${layer}".\n${url}`,
  fellBack: (layer) =>
    `Your chosen layer isn't available, so this went to "${layer}".`,
  notFound:
    "I couldn't find a place from that link. Try sharing it from the place's page in Google Maps.",
  unsupportedList:
    "Google Maps lists can't be added from chat. Use Import a shared map on the website instead.",
  instagramFound: (names, url) =>
    `This Instagram post mentions ${names.join(", ")}. Instagram captions aren't verified, so please send the Google Maps link for the place, or add it on the website: ${url}`,
  instagramNotFound:
    "I couldn't read a place from that Instagram post. Send the place's Google Maps link instead.",
  tooMany: (max) => `I only read the first ${max} links in a message.`,
  busy: "You've sent a lot of links. Please wait a few minutes and try again.",
  unavailable:
    "Adding places from chat is unavailable right now. Please try again later.",
  notMember: `Your ${brand.name} membership isn't active, so I can't add places for you.`,
};
const zh: Copy = {
  welcome: (url) =>
    `嗨！傳 Google 地圖連結給我，我會把地點加進你的 ${brand.name} 圖層。\n\n請先連結帳號：打開 ${url}，按「連結」，再把畫面上的代碼傳給我。`,
  codeUnknown: (url) =>
    `這組代碼無效，可能已過期或用過了。請到 ${url} 取得新的代碼。`,
  codeTaken: "這個聊天已連結到另一個帳號。請先在那個帳號解除連結。",
  pending: (url) => `快完成了！回到 ${url} 按「確認」完成連結。`,
  pendingStill: (url) => `你的連結還沒確認。請到 ${url} 按「確認」。`,
  help: (layer) =>
    `傳 Google 地圖連結給我，我會加進「${layer}」。可以在 ${brand.name} 的連結設定頁變更地點要放的圖層。`,
  added: (names, layer, url) =>
    `已將 ${names.join("、")} 加進「${layer}」。\n${url}`,
  duplicate: (layer, url) => `這個地點已經在「${layer}」裡了。\n${url}`,
  fellBack: (layer) => `你選的圖層目前無法使用，所以先放進「${layer}」。`,
  notFound: "找不到這個連結的地點。請從 Google 地圖的地點頁面分享連結。",
  unsupportedList:
    "無法從聊天加入 Google 地圖清單。請改用網站上的「匯入共用地圖」。",
  instagramFound: (names, url) =>
    `這則 Instagram 貼文提到 ${names.join("、")}。貼文內容未經查證，請傳該地點的 Google 地圖連結，或到網站加入：${url}`,
  instagramNotFound:
    "無法從這則 Instagram 貼文讀出地點。請改傳該地點的 Google 地圖連結。",
  tooMany: (max) => `一則訊息我只會讀前 ${max} 個連結。`,
  busy: "你傳了很多連結，請稍等幾分鐘再試。",
  unavailable: "目前無法從聊天加入地點，請稍後再試。",
  notMember: `你的 ${brand.name} 會員資格未啟用，所以無法幫你加入地點。`,
};
export const botCopy: Record<BotLocale, Copy> = { en, "zh-TW": zh };
export function botLocale(preferred: string | null | undefined): BotLocale {
  return preferred === "zh-TW" ? "zh-TW" : "en";
}
/** For senders we don't know yet: both languages, English first. */
export function bilingual(pick: (c: Copy) => string) {
  return `${pick(en)}\n\n${pick(zh)}`;
}
