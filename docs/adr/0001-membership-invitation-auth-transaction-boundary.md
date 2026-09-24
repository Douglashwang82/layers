# ADR 0001：邀請制會員的 Better Auth 交易邊界（S0 實證）

日期：2026-09-24。狀態：已完成實證，供 [邀請制會員工程執行方案](../invitation-membership-implementation-plan.md) 第 6 節「第一個工程里程碑」使用。本文件只記錄已驗證的行為與其後果；不包含任何 schema、API 或 UI 實作。

## 1. 背景與待答問題

執行方案第 6 節提出「首選要求」：新 user、admission、邀請兌換與 audit 寫入須落在同一個 transaction-scoped adapter 操作內；並明確禁止假定 `user.create.after` 與自訂 `pool.query()` 共享交易。本 ADR 的任務是針對本次讀取的安裝版（`better-auth@1.7.5`、`better-auth/adapters/drizzle`）驗證：

1. `databaseHooks.user.create.before/after` 是否、何時與既有 DB 交易共用邊界。
2. 目前專案的 Drizzle adapter 設定是否已啟用任何交易保證。
3. 三條會建立 `user` 的路徑（Email／密碼、Email OTP 自動建號、Google 首次登入）彼此的交易行為是否一致。
4. 若首選要求無法達成，是否有其他受支援手段，其代價為何。

以下每項結論均附來源檔案與行號（相對於本次安裝之 `node_modules`），並附 `tests/integration/membership-auth-transaction-spike.test.ts` 的實測結果佐證（4/4 通過，已對照本機 disposable dev DB 執行；執行方式見本文件末）。

## 2. 已驗證的事實

### 2.1 `after` hook 一律在交易提交後才執行

`getWithHooks`（`db/with-hooks.mjs:32-41`）對每個 `create.after` hook 使用 `queueAfterTransactionHook` 包裝。該函式（`@better-auth/core` 的 `context/transaction.mjs:96-114`）行為為：若目前存在啟用中的交易（`store.isTransactionActive`），則把 hook 推進 `pendingHooks` 佇列，等交易的 `adapter.transaction(cb)` resolve **之後**才逐一執行；若沒有啟用中的交易，則立即執行。

結論：`user.create.after`（目前專案唯一使用中的 hook，寫入 `analyticsEvent` 的 `user_signed_up`）**在任何設定下都不會與 user 建立在同一筆交易內**，這與現有程式碼的既定認知一致，本次已用原始碼確認而非臆測。

### 2.2 `before` hook 是否共用交易，取決於它怎麼寫

`createWithHooks`（`db/with-hooks.mjs:7-24`）在呼叫 adapter 實際 `create()` 之前，同步執行所有 `before` hook；此時若外層已有 `runWithTransaction` 建立的 AsyncLocalStorage 交易上下文，hook 內呼叫 `getCurrentAdapter()`（`@better-auth/core/context`）取得的會是**交易範圍內的 adapter**，用它寫入就會加入同一筆交易。

但若 hook 改用專案自己的 `db`／`pool`（例如 `apps/web`、`packages/database` 目前的寫法）直接下 SQL，那條連線與 `runWithTransaction` 開的交易完全無關，**無論 hook 在 before 或 after、無論交易是否存在，都不會被一起 commit 或 rollback**。這是本次最容易被誤用的一點：時機正確不代表交易正確。

### 2.3 是否存在交易，因路由而異——三條建號路徑並不一致

| 路徑                                                                     | 是否包 `runWithTransaction`                                                                           | 來源                                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/sign-up/email`（Email／密碼，目前 `emailAndPassword.enabled=true`）    | 是，整個 handler 包在 `runWithTransaction(ctx.context.adapter, ...)`                                  | `api/routes/sign-up.mjs:143`                                                                                                  |
| Google 首次登入（`handleOAuthUserInfo`，被 `/callback/:id` 呼叫）        | 是，`createUser`＋`createAccount` 包在 `runWithTransaction(c.context.adapter, ...)`                   | `oauth2/link-account.mjs:214`                                                                                                 |
| `/sign-in/email-otp`（Email OTP 自動建號，**本方案預設的主要加入方式**） | **否**。直接呼叫 `ctx.context.internalAdapter.createUser(...)`，呼叫鏈中完全沒有 `runWithTransaction` | `plugins/email-otp/routes.mjs:406-420`；`internalAdapter.createUser`（`db/internal-adapter.mjs:140-169`）本身也不自帶交易包裝 |

換言之：即使我們把 adapter 設成支援交易，OTP 建號路徑在這個版本裡也沒有交易可加入——沒有 `runWithTransaction`，就沒有 `getCurrentAdapter()` 可以取得的交易範圍 adapter。

### 2.4 目前專案設定尚未啟用任何真交易；啟用是受支援選項，但只覆蓋 email/password 與 OAuth

`@better-auth/core` 的 adapter 工廠（`db/adapter/factory.mjs:31`）：`transaction: cfg.transaction ?? false`；`cfg.transaction` 由各 adapter 實作提供。目前 `apps/web/src/lib/auth.ts:6` 的設定是 `drizzleAdapter(db, { provider: "pg", schema })`，**沒有傳 `transaction: true`**。

Drizzle adapter 套件（`@better-auth/drizzle-adapter/dist/index.mjs:557-565`）明確地把 `transaction` 設計成一個公開、受支援的 adapter option：

```js
transaction: (config.transaction ?? false)
  ? (cb) =>
      db.transaction((tx) =>
        cb(
          createAdapterFactory(
            { ...adapterOptions.config, transaction: false },
            createCustomAdapter(tx, true),
          )(lazyOptions),
        ),
      )
  : false;
```

不傳這個選項時，`adapter.transaction(cb)` 是 `createAsIsTransaction`（`db/adapter/factory.mjs:18`）：`(fn) => fn(adapter)`，也就是**完全不開真正的資料庫交易，直接執行**。這代表：即使 `/sign-up/email` 本身有包 `runWithTransaction`，只要 adapter 沒開 `transaction: true`，那也只是一層沒有實質交易保護的殼。

補上 `transaction: true` 是文件化、受支援的用法（不是讀原始碼才發現的內部行為），但只對「本來就有包 `runWithTransaction` 的路徑」有效——對照 2.3 的表，這代表它能保護 email/password 與 Google 首次登入，**不能**保護 Email OTP 自動建號。

### 2.5 若要讓自訂寫入加入交易，需要一個未宣告、未在官方文件出現的內部套件

要在 `before` hook 內用 `getCurrentAdapter()` 加入交易，程式碼必須 `import { getCurrentAdapter, runWithTransaction, queueAfterTransactionHook } from "@better-auth/core/context"`。實測：

```
$ node -e "import('@better-auth/core/context').then(...).catch(e=>console.log('FAIL', e.message))"
FAIL Cannot find package '@better-auth/core' imported from ...
```

`@better-auth/core` 是 `better-auth` 的內部相依套件，pnpm 嚴格模式下**沒有**被提升到 workspace 可解析的位置，也不是任何 `package.json` 宣告的直接相依；官方 [Email OTP](https://www.better-auth.com/docs/plugins/email-otp) 與 [database hooks](https://www.better-auth.com/docs/concepts/database) 文件都沒有提到這個 context API。要用它，等於：(a) 把 `@better-auth/core` 加為專案的直接相依，且 (b) 依賴一個未文件化、可能隨 semver-minor 改變介面的內部模組。

### 2.6 OTP 路徑一旦建立 user，session 會在同一次呼叫內無條件建立

`plugins/email-otp/routes.mjs:406-430`：`createUser` 成功後立即 `createSession` 再 `setSessionCookie`，中間沒有任何可攔截點可以「先確認 admission 完成才發 session」。方案第 6 節第 5 條要求的「交易完成且確認 admission 後，才建立／對外發出可用 session」**無法透過原樣呼叫 `/sign-in/email-otp` 達成**——這個內建路由本身就是「建號即發 session」，沒有暴露 hook 讓我們在兩者之間插入自己的 admission 交易。

## 3. 實測驗證（tests/integration/membership-auth-transaction-spike.test.ts）

針對本機 disposable dev DB（`DATABASE_URL` 指向 `localhost/taiwanhub`）建立兩個臨時 `betterAuth` 實例（分別為預設 adapter 設定、`transaction: true`），在 `databaseHooks.user.create.before` 內用專案自己的 `db` 寫入一筆標記用的 `verification` row，再回傳 `false` 中止建號，驗證：

| 情境                                               | user 是否建立 | hook 自訂寫入是否仍然 commit                         |
| -------------------------------------------------- | ------------- | ---------------------------------------------------- |
| `/sign-up/email`，adapter 預設（無 `transaction`） | 否            | **是**（未被回滾）                                   |
| `/sign-up/email`，adapter `transaction: true`      | 否            | **是**（未被回滾——因為寫入沒有經過交易範圍 adapter） |
| `/sign-in/email-otp` 自動建號                      | 否            | **是**（未被回滾）                                   |
| 基準情境：不中止的 `/sign-up/email`                | 是            | —                                                    |

四個測試全數通過（`pnpm exec vitest run --config vitest.integration.config.ts tests/integration/membership-auth-transaction-spike.test.ts`）。這驗證了 2.1–2.4 的推論，且特別證明「開啟 `transaction: true` 但仍用專案自己的 `db`/`pool` 直接寫入 hook」是一個看似安全、實則毫無交易保護的陷阱——這正是實作團隊最可能不小心踩進去的寫法。

## 4. 決策：首選要求不成立，採用替代設計

**首選要求（單一交易涵蓋新 user、admission、邀請兌換、audit）在本次安裝版本下，對 Email OTP 路徑不成立**，且不存在受支援、文件化的方式讓它成立（2.3、2.5）。對 Email／密碼與 Google OAuth 路徑，理論上可透過 `drizzleAdapter({ transaction: true })` ＋ 未文件化的 `@better-auth/core/context` 達成，但：(a) 本方案的預設加入方式是 OTP，這條路徑用不上；(b) 依賴未宣告的內部套件不符合方案「使用受支援的 hook／plugin／adapter extension」的要求。

因此採用方案第 6 節已預留的替代路線：**不追求跨系統原子性，改用「預留＋確認＋可重試收斂」的兩段式設計**，並把 session 延後發放的要求，實作為「明確可重跑的收尾步驟」而非「單一交易的隱含結果」：

1. 邀請兌換前的 join context 建立、OTP 寄送/驗證，全部沿用 Better Auth 內建端點（不 fork 或重寫其路由邏輯），因為第 2.3–2.6 節已證明無法安全地在其中插入我們自己的交易。
2. **不使用 `/sign-in/email-otp` 直接發 session。** 改為：在我們自己的 `POST /api/v1/membership/join/email/complete` 端點內，先呼叫 Better Auth 的 OTP 驗證（例如 `auth.api.signInEmailOTP` 或等效底層驗證呼叫）取得「Email 已驗證、user 已存在或剛建立」的結果，取得使用者身分後，**在我們自己開的交易裡**完成 admission 寫入（`membership_admission`、`membership_invitation.status=redeemed`、`membership_nomination.status=joined`、audit）。只有這筆交易成功 commit，才呼叫 Better Auth 對外發放 session（或直接建立/回傳一個新 session token）。這與方案原文「交易完成且確認 admission 後，才建立／對外發出可用 session」一致，但是用「兩個先後交易＋以 admission 完成為發 session 的前置條件」達成，而不是「一個涵蓋兩者的交易」。
3. 因為 user 建立與 admission 完成是兩筆交易，中間可能中斷（進程崩潰、逾時），必須把「使用者存在但沒有對應 admission，且仍有效的已批准邀請」視為**可安全重試的正常過渡狀態**，而不是異常：
   - 下一次同一使用者用同一 Email 再次完成 OTP 驗證時，先查有沒有已完成的 admission；沒有的話，重跑「確認 admission」步驟（用 `membership_invitation_id` 的 UNIQUE 約束＋idempotent upsert 保證只會產生一筆 admission，不會重複發 session 以外的副作用）。
   - 這代表 S2/S4 的 accept 端點必須把「驗證身分」與「完成 admission」拆成可各自重試、合併後仍冪等的兩步，並各自有失敗訊號；不能假設一次成功呼叫就代表兩者都完成。
4. Email／密碼與 Google 首次登入若日後也要走邀請 gate（方案第 6 節第 4、7 條），可以額外加上 `drizzleAdapter({ transaction: true })`——這對它們是有效的（2.4），但仍需最終走上面同一套「以我們自己的 admission 交易為準、Better Auth 交易只保護它自己內部的 user+account」模式，避免混用兩種不同保證層級的程式碼路徑。**是否啟用 `transaction: true`** 需要在 S1/S4 一併評估：它會讓 Better Auth 內部（user+account/session 等）的多筆寫入變成真交易，屬於對既有登入路徑的行為變更，需回歸測試涵蓋（尤其密碼登入、既有 session 建立）。

## 5. 對後續票的直接影響

- **S1（schema）**：`membership_invitation.nomination_id` UNIQUE、`membership_admission.invitation_id` UNIQUE、`membership_admission.user_id` PK 三個約束，是替代設計能安全重試的關鍵防線，必須先於服務層邏輯落地並由 disposable DB migration 測試覆蓋。
- **S2（service）**：admission 確認邏輯需設計成「輸入：已驗證身分的 user id ＋ 有效 invitation」「輸出：admission 是否已存在／新建立」的冪等函式，可在同一請求重跑，也可在下一次請求重跑。
- **S3（mail）**：不受影響，本 ADR 未涉及寄信路徑。
- **S4（auth 整合）**：`lib/auth.ts` 需新增自訂端點（membership 的 join/email/complete、join/google/start 等），**不能只靠 databaseHooks** 插入准入邏輯；`disableSignUp` 仍要設為 true（阻擋未經我們端點的直接 OTP 呼叫），但真正的准入決策與 session 發放時機由我們自己的路由掌控，這點在方案原文已提到，本 ADR 補上「為什麼非如此不可」的實證依據。
- 若團隊之後想追求更接近「單一交易」的方案，唯一路徑是升級/更換 adapter 策略或改用官方尚未在本次安裝版本中提供的機制；這超出本次 S0 範圍，若要重新評估，需先確認新版本是否讓 `/sign-in/email-otp` 也走 `runWithTransaction`（可用本文件附的 spike 測試在升級後重跑一次即可驗證是否改變結論）。

## 6. 端點／帳號建立路徑清單（本次資料庫可建立 `user` 列的所有已知途徑）

| 途徑                                                                                                    | 目前是否啟用                                                                          | 交易行為（2.3）                                          | 是否已有／需要准入攔截                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/sign-up/email`（Better Auth 內建）                                                      | 是（`emailAndPassword.enabled=true`，`apps/web/src/lib/auth.ts:9`）                   | 有 `runWithTransaction`，預設 adapter 未開真交易         | 需要：方案要求永久停用公開呼叫此端點建立新帳號（第 6 節第 2 條）                                                                                                                                                                                                                                                                        |
| `POST /api/auth/sign-in/email-otp`（Better Auth 內建，Email OTP plugin，**目前尚未在 `auth.ts` 註冊**） | 否（尚未加入方案）                                                                    | 無交易（2.3、2.6）                                       | 需要：這是本方案預設加入方式，必須透過自訂端點包住，不可直接暴露內建路由                                                                                                                                                                                                                                                                |
| Google OAuth `/api/auth/callback/google`（Better Auth 內建）                                            | 條件啟用（`GOOGLE_CLIENT_ID`/`SECRET` 皆設定時，`apps/web/src/lib/auth.ts:19-27`）    | 有 `runWithTransaction`（`oauth2/link-account.mjs:214`） | 需要：方案第 6 節第 4、6 條要求同樣的 gate 與 Email 相符檢查                                                                                                                                                                                                                                                                            |
| `pnpm admin:grant`（`packages/database/src/grant-admin.ts`）                                            | 是，但只能 `UPDATE` 既有帳號的 `role`，`rowCount` 為 0 會丟錯（`grant-admin.ts:5-9`） | 不適用（非建號路徑）                                     | 不需要：本來就不能建立新帳號，符合方案第 2 節表格的既有認知                                                                                                                                                                                                                                                                             |
| `pnpm db:seed`（`packages/database/src/seed.ts:41`）                                                    | 是，直接 `db.insert(schema.user)`，完全繞過 Better Auth                               | 不適用（單一 drizzle insert，非 Better Auth 交易）       | 需要：方案第 9 節要求 backfill 前用已知 seed id 排除，而非用 Email domain 猜測；`seed.ts:311` 已標註「demo users 不能登入」，但沒有阻擋登入的技術機制（demo 帳號沒有 `account`/密碼列，Email OTP 若啟用會讓它們「合法」補建 `account` 並登入——這點需要在 S6 backfill/legacy 設計中明確處理，不在本 ADR 範圍內解決，但在此記錄以免遺漏） |

最後一項（demo/seed 使用者一旦 Email OTP 上線就可能被「借殼登入」）是本次盤點順帶發現、但不屬於 S0 範圍的風險，記錄於此提醒 S4/S6 設計時一併處理（例如：admission 判定必須排除 seed 來源，而不是只看「帳號是否存在」）。

## 7. 直接繞過／中斷復原測試現況

- 已完成並通過：`tests/integration/membership-auth-transaction-spike.test.ts` 涵蓋「中斷點：user 建立前的自訂寫入是否隨建號失敗回滾」，對應方案第 12 節「至少注入三個中斷點」的第一個中斷點（user 建立前）。
- 尚未實作（留待 S2/S4，屆時 admission/invitation schema 與服務都已存在，才可能寫出有意義的測試）：
  - 中斷點二：user/admission transaction 提交前中斷。
  - 中斷點三：提交後、session 回應前中斷。
  - 直接呼叫 `/sign-in/email-otp`／`/sign-up/email`／OAuth callback 繞過邀請 gate 的測試（需要 S4 的 `disableSignUp`/自訂端點落地後才有東西可測）。
  - 同一邀請並發兌換測試（需要 S1 的唯一約束落地）。

這些留待對應票號時一併補上，本 ADR 只交付 S0 要求的「验证＋ADR＋路徑清單＋（可行範圍內的）中斷復原測試」。

## 8. 如何重跑本次實證

```sh
docker compose up -d
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/membership-auth-transaction-spike.test.ts
```

執行前請先確認 `DATABASE_URL` 指向本機 disposable dev DB（本次為 `localhost/taiwanhub`），不要對正式環境執行。測試會建立並清除以 `spike-*@example.test` 為 Email、`spike:*` 為 `verification.identifier` 前綴的暫存列。
