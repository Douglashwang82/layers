# Send places from chat: connecting LINE and Instagram

Members connect their LINE or Instagram chat on **Profile → Send places from chat** (`/profile/connections`). Then they send a Google Maps link to our official account in a direct message, and the place is added to the layer they chose (or to a private **Inbox** layer). Design: [docs/plans/dm-link-to-layer-design.md](../plans/dm-link-to-layer-design.md). Endpoints: [api.md](../reference/api.md#send-places-from-chat).

This guide lists the operator steps to set the accounts up. Each channel works on its own, so you can enable LINE first and add Instagram later.

## What is built (and what is not yet)

- Both channels connect with a one-time code (`LL-XXXX-XXXX`). The member gets it on the web, sends it in the chat, then taps **Confirm** on the web. The confirm step stops someone who sees a code from attaching their own chat to your account.
- Google Maps place links and `?q=` links are added through the same resolver, budget and import as the web editor. Instagram post links get a reply saying what the caption mentions, but nothing is added, because caption matches need review.
- Replies are plain text, sent as LINE reply messages (free; they don't count toward the monthly quota) or as Instagram replies within the 24-hour window. No push messages are sent.
- Not yet built (design phase 1b and later): LINE's native account-link flow, Flex cards, quick-reply "Move to…", Undo, and the "via LINE" badge. See the design doc §11.

## 1. Prerequisites (both channels)

1. Layer writes must be on (the default), and `GOOGLE_MAPS_LINK_API_KEY` must be a real server key.
2. Apply migration `0032_quick_madrox` (tables `messaging_link`, `messaging_link_attempt`, `messaging_receipt`) the usual way. See [database.md](../reference/database.md).
3. `AUTH_SECRET` must be set. It keys the HMAC used to store sender IDs; raw LINE/Instagram user IDs are never stored. Changing `AUTH_SECRET` disconnects every chat.
4. Put all secrets below in the existing Vercel / GitHub `Production` environment. Do not create a new environment. Never use a `NEXT_PUBLIC_` prefix.

## 2. LINE

1. **Create the official account.** Go to [LINE Official Account Manager](https://manager.line.biz/) and create a LINE Official Account. Choose the country and plan; the plan sets the free monthly message quota. Replies are free, and this feature only sends replies.
2. **Enable the Messaging API.** In the Official Account Manager, open **Settings → Messaging API → Enable Messaging API** and pick (or create) a **provider**. Use one provider for every city. LINE user IDs differ per provider, and a future LINE Login channel must sit under the same one.
3. **Get the channel credentials.** In the [LINE Developers console](https://developers.line.biz/console/), open the new channel:
   - **Basic settings → Channel secret** → `LINE_CHANNEL_SECRET`
   - **Messaging API → Channel access token (long-lived) → Issue** → `LINE_CHANNEL_ACCESS_TOKEN`
4. **Set the webhook.** On the **Messaging API** tab:
   - Webhook URL: `https://<your-domain>/api/webhooks/line`
   - Turn on **Use webhook**.
   - Turn on **Webhook redelivery** (processing is idempotent).
   - Click **Verify** after step 6 is deployed. It should succeed: the verify call carries no events, and the endpoint answers 200.
5. **Turn off the automatic replies.** In the Official Account Manager, open **Settings → Response settings**: turn **Chat** off, **Auto-response messages** off, and **Greeting message** off. Our bot sends its own greeting on `follow`. Otherwise LINE answers first with its default text.
6. **Configure and deploy.** Set:
   ```
   FEATURE_CHAT_CAPTURE=true
   LINE_CHANNEL_SECRET=<channel secret>
   LINE_CHANNEL_ACCESS_TOKEN=<long-lived token>
   LINE_ADD_FRIEND_URL=https://line.me/R/ti/p/@<basic id>
   ```
   The basic ID (`@xxxx`) is on the Messaging API tab. Redeploy.
7. **Smoke test** with a member account:
   1. Add the account as a friend (QR code on the Messaging API tab). You should get the bilingual greeting.
   2. On the web, open **Profile → Send places from chat → Connect LINE** and send the code in the chat. The bot replies "Almost done…".
   3. Tap **Confirm LINE** on the web page.
   4. Choose a layer under **Where sent places go**, or leave it on Inbox.
   5. Share a place from Google Maps to the chat. You should get "Added … to "<layer>"" with a link, and the place appears in the layer and under **Recently sent**.
   6. Block the account in LINE. The page now shows **Not connected**.

## 3. Instagram

Instagram messaging needs an Instagram **professional** (business or creator) account and a Meta app using **Instagram API with Instagram Login**.

1. **Professional account.** Switch the official Instagram account to a business or creator account (Instagram app → Settings → Account type and tools).
2. **Create the Meta app.** In [Meta for Developers](https://developers.facebook.com/apps/), create an app of type **Business**. Add the **Instagram** product and choose **API setup with Instagram login**.
3. **Permissions.** Request `instagram_business_basic` and `instagram_business_manage_messages`.
   - With **Standard Access**, only people with a role on the app (admins, developers, testers) can use it. This is enough for a staging test.
   - Opening it to all members needs **Advanced Access**, which requires **App Review** and **Business Verification**. Plan for days to weeks of lead time.
4. **Generate a token.** Under **Instagram → API setup with Instagram login → Generate access tokens**, add the professional account and generate a token → `INSTAGRAM_ACCESS_TOKEN`.
   - Use a long-lived token and calendar its refresh. Long-lived Instagram User tokens expire after about 60 days unless refreshed.
   - On the same page, turn on **Allow access to messages** in the Instagram app (Settings → Messages and story replies → Message controls → Connected tools).
5. **App secret.** **App settings → Basic → App secret** → `INSTAGRAM_APP_SECRET`.
6. **Webhook.**
   1. Generate a random verify token (`openssl rand -hex 24`) → `INSTAGRAM_VERIFY_TOKEN`.
   2. Deploy step 7 first.
   3. Then, under **Instagram → Webhooks**, set the callback URL to `https://<your-domain>/api/webhooks/instagram` and the verify token to the same value, and click **Verify and save**. The endpoint echoes `hub.challenge` only when the token matches.
   4. Subscribe to the **messages** field.
7. **Configure and deploy.** Set:
   ```
   FEATURE_CHAT_CAPTURE=true
   INSTAGRAM_APP_SECRET=<app secret>
   INSTAGRAM_VERIFY_TOKEN=<random, 16+ characters>
   INSTAGRAM_ACCESS_TOKEN=<Instagram User access token>
   INSTAGRAM_ACCOUNT_HANDLE=<handle without @>
   # Optional; defaults to v26.0
   INSTAGRAM_GRAPH_VERSION=v26.0
   ```
8. **Smoke test.** Use an Instagram account that has a role on the app (needed under Standard Access):
   1. On the web, click **Connect Instagram**, open the chat with **Open Instagram**, send the code, and confirm on the web.
   2. Send a Google Maps link in the DM. The reply confirms the layer, and the place appears in it.
   3. Share an Instagram post. The bot names what the caption mentions but adds nothing.

## 4. Operating notes

- **Turning it off.** Set `FEATURE_CHAT_CAPTURE=false`. The webhooks return 404, the profile row disappears, and bindings stay in place for when it is turned back on. To disable one channel only, unset its secrets; the page then shows "Not available yet" for it.
- **Limits.**
  - Up to three links per message.
  - The web paste budget applies (150 links per member per 10 minutes).
  - Ten codes per member per hour.
  - Ten code tries per chat per 10 minutes.
  - One onboarding reply per unknown chat per 10 minutes.
- **Privacy.**
  - Message text is never stored. `messaging_receipt` keeps the first canonical URL, the outcome and the layer, for the 30-day **Recently sent** list.
  - Sender IDs are stored only as HMACs.
  - Logs carry no message text or IDs.
  - Deleting a member cascades to their bindings and receipts.
- **Rotating secrets.** If you rotate the LINE channel secret or the Meta app secret, update the env at the same time. Webhooks signed with the old secret are rejected with 401.
- **Troubleshooting.** Webhook calls appear in the platform consoles. Outbound replies are logged in `external_api_call` as provider `line` / `instagram` (metadata only). A LINE reply token expires within seconds, so slow resolver calls can make a reply fail even though the place was added; check **Recently sent**.

## 5. Tests

- Unit (`tests/unit/messaging.test.ts`): signature verification, LINE and Instagram payload parsing, link and code extraction, the capture transport, and copy parity between locales.
- Integration (`tests/integration/messaging.test.ts`, needs the migrated local test DB):
  - code linking, including expired, reused and stolen codes, a chat already taken, and the pending-confirm gate
  - Inbox creation, the chosen layer from LINE and Instagram, and duplicates
  - the public-layer guard, fallback when edit rights are lost, unsupported and not-found links, redelivery, and unfollow
- Browser (`tests/e2e/mvp/messaging.spec.ts`, run by `pnpm test:e2e`): the Instagram handshake and the bad-signature check. In the full flow, a member connects LINE and Instagram on the web, the spec sends signed webhook calls, both places land in the chosen layer, and **Recently sent** and disconnect are checked. The server runs with test-only secrets from `tests/e2e/mvp/messaging-env.ts` and `MESSAGING_PROVIDER=capture`, so no LINE or Meta API is called.
