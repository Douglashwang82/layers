# TaiwanHub 邀請制會員：工程執行方案

日期：2026-09-24。狀態：工程交接規格，尚未實作。

本文件將已討論的產品方向轉成可拆票的執行方案。只新增規劃文件；不代表資料庫、登入或線上政策已改變。文中新增路由、資料表、設定及命令均為待實作項目。正式環境的遷移、權限指派、寄信與部署須另有涵蓋該環境的授權。

## 1. 目標、已確認決策與建議預設

目標：建立高品質且可控制規模的初期會員族群；會員能參與推薦及審核，受邀者以最少操作完成加入。

### 已確認的產品方向

- 不提供公開註冊或陌生人自行申請入口；一般訪客仍可瀏覽公開內容。
- 初期會員由管理員手動發送邀請碼／連結，作為建立第一批會員的例外途徑。
- 後續新會員必須由既有會員推薦。推薦者只需填 Email，推薦說明選填。
- 部分受信任會員具有審核資格；一般會員不自動獲得批准權。
- 一位非推薦者的審核會員批准即可發邀請，不需要管理員逐案批准。
- 審核在發邀請之前完成。受邀者不填加入原因、問卷、自我介紹或頭像。
- 邀請綁定 Email、單次使用、有期限、可撤銷；以連結自動帶入邀請碼。
- 推薦、批准與接受邀請留下可追溯紀錄。平台邀請與群組邀請分開處理。

### 本方案採用的工程／營運預設

以下不是先前已逐項確認的產品承諾；團隊可依此估工及開發，變更時同步修訂規格。

| 項目           | 第一版預設                                                                    |
| -------------- | ----------------------------------------------------------------------------- |
| 新會員登入方式 | Email OTP 免密碼為必要路徑；已設定的 Google 可作為選項，但須通過相同邀請限制  |
| 舊會員         | 保留既有登入方式及權益；不要求重新被邀請；未驗證 Email 者先驗證才能推薦或審核 |
| 審核資格來源   | 第一版僅 ADMIN 指派／撤銷；審核會員互相提名升任留到後續                       |
| 邀請期限       | 發出後 14 天；時間以資料庫時間為準                                            |
| 分批名額       | 第一批建議 20 人；由 ADMIN 建立批次及設定上限，無自動擴大                     |
| OTP            | 6 位數、5 分鐘有效、最多 3 次錯誤；重寄至少間隔 60 秒                         |
| 顯示名稱       | 可選填；Email 加入預設「TaiwanHub 會員」，不從 Email 前綴產生公開名稱         |
| 社群約定       | 接受邀請按鈕旁顯示簡短約定及連結；記錄接受版本及時間，不加問卷                |
| 自動寄信       | 推薦經批准後寄邀請信；管理員初期邀請預設只產生連結，由管理員手動傳送          |

不在第一版：公開候補名單、投票排行榜、積分自動升任、付費邀請、批次匯入聯絡人、階層式推薦獎勵、新的全站停權系統、強制手機／證件／住址驗證。

## 2. 現有程式與需要調整的部分

以本次讀取的儲存庫為準：Better Auth 1.7.5、Next.js 16.3.5；維持現有 Next.js／Drizzle／PostgreSQL 架構及 pnpm lockfile。

| 現況                                                                                        | 交接重點                                                              |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web/src/lib/auth.ts` 啟用 Email／密碼及可選 Google，建立 user 後記錄 `user_signed_up` | 必須在所有新帳號建立路徑執行 admission gate；新增 OTP，不能只隱藏按鈕 |
| `apps/web/src/components/auth-form.tsx` 切換登入／註冊                                      | 移除公開註冊切換；登入、受邀加入分流                                  |
| `apps/web/src/lib/session.ts` 的 actor 只有 id、role                                        | 審核資格需服務端查詢，不能相信前端或長效 session 中的舊資格           |
| `USER / MODERATOR / ADMIN` 用於既有內容權限                                                 | 不新增可誤用於內容管理的 REVIEWER role；新增獨立能力表                |
| `group_invite` 綁 Email、14 天到期，要求已登入接受                                          | 不能作為平台准入憑證；新會員需先走平台邀請                            |
| `docs/deployment.md` 明確說明尚無實際 Email delivery                                        | 郵件介面、供應商、測試 transport、失敗重試均屬本次實作範圍            |
| `tests/e2e/{flows,groups,map,moderation,extraction}.spec.ts` 使用公開註冊建立測試使用者     | 一併遷移測試 fixture，禁止為測試留下公開註冊後門                      |
| `pnpm admin:grant` 只能提升已存在帳號                                                       | 新環境需要受控 bootstrap 工具，不能依賴先公開註冊                     |

相關既有文件：[架構](architecture.md)、[HTTP API](api.md)、[資料庫](database.md)、[部署](deployment.md)。撰寫 Next.js 程式前，工程師須按 `apps/web/AGENTS.md` 讀取安裝版本的 Next.js 文件。

## 3. 使用者流程與畫面

### A. 管理員建立第一批會員

1. ADMIN 在 `/admin/membership` 選擇開放批次，填 Email。
2. 系統建立 `admin_direct` 推薦紀錄、批准紀錄及邀請，佔用一個名額。
3. 此次回應顯示一次性的「複製邀請連結／邀請碼」；管理員自行傳送。
4. 邀請列表只保留狀態及收件 Email；不提供再次讀取原始 token 的 API。
5. 遺失連結時使用「重新發出」，舊碼立即作廢；名額不重複計算。

ADMIN 直接邀請是明確、有稽核的 bootstrap／營運例外；一般推薦案件即使由 ADMIN 推薦，也不能使用一般批准 API 自行批准。介面須清楚區分兩者。

### B. 既有會員推薦，其他審核會員批准

1. 已驗證 Email 的會員在 `/membership` 填「朋友的 Email」，可展開選填推薦說明（最多 300 字）。
2. 提交後顯示「已送交審核」，此時沒有邀請碼，也不寄信給被推薦者。
3. 審核會員在 `/membership/review` 查看 Email、推薦者顯示名稱、推薦說明及時間。
4. 選「批准」即建立邀請及郵件待寄工作；不得要求被推薦者先填表。
5. 若需要了解更多，選「請推薦者補充」並留下簡短問題；推薦者補充後再送審。
6. 推薦者可查看自己推薦的狀態；不能讀取其他人的名單或內部審核備註。

有疑慮先走補充流程。最終拒絕由 ADMIN 處理並留理由，避免單一審核會員永久否決；一般批准不需 ADMIN。第一版不用多數決或多人同時簽核。

### C. 受邀者加入：不重填已知資料

邀請 URL 建議為 `/join#invite=<opaque-code>`；fragment 不送到伺服器 access log。頁面擷取後立即清除網址中的 fragment，以 POST body 換成短效加入 context。

- 邀請頁只顯示遮罩 Email、推薦者顯示名稱、邀請有效狀態與簡短社群約定。
- 「接受邀請，以 Email 繼續」：將 OTP 寄到邀請綁定 Email，不再輸入 Email；下一步只輸入 OTP。
- Google 已啟用時可顯示「以 Google 接受邀請」；回傳且已驗證的 Email 必須與邀請相同。
- 不強制填名稱、密碼、城市、bio、頭像或加入原因；完成後進入原本目的頁，否則回首頁。
- `/join` 無 fragment 時顯示一個「邀請碼」欄位，貼碼後進入相同流程。邀請碼與連結內憑證是同一份高熵 token，不另做易猜的短碼。
- 受邀者端顯示名稱之後可到個人頁修改；不把 Email 當成公開名稱。

「沒有邀請」畫面：『TaiwanHub 目前採會員邀請制。請認識的會員推薦你加入；你也可以先瀏覽公開內容。』不提供申請／候補表。

### D. 例外畫面

| 狀況                 | 行為                                                                |
| -------------------- | ------------------------------------------------------------------- |
| 無效／過期／撤銷邀請 | 統一顯示「邀請已失效，請聯絡邀請你的會員」，不洩漏 Email 或內部原因 |
| Google Email 不符    | 不建立新帳號、不消耗邀請；提供切換 Google 帳號或 Email OTP          |
| 已登入另一帳號       | 不直接開通或自動連結；要求切換帳號                                  |
| 已有相同 Email 帳號  | 經現有登入／OTP 證明持有後繼續，不建第二個帳號、不增加會員數        |
| OTP 過期／錯誤       | 保留邀請 context，可重寄；重寄換碼使舊 OTP 失效                     |
| 郵件發送失敗         | 推薦仍維持已批准；顯示待寄／失敗並可重試，不重新審核                |
| 建立帳號後回應中斷   | 重試或重新登入應回到同一帳號，不能永久卡住已兌換邀請                |
| 邀請已成功用過       | 未驗證者只看到一般失效訊息；完成身分驗證的同一帳號可正常登入        |

## 4. 權限矩陣與共同審核準則

| 操作                               | 一般會員           | 有效審核會員           | ADMIN                            |
| ---------------------------------- | ------------------ | ---------------------- | -------------------------------- |
| 推薦、查看／撤回自己的待審案件     | 是，Email 須已驗證 | 是                     | 是                               |
| 查看待審佇列                       | 否                 | 是                     | 是                               |
| 批准別人的待審案件                 | 否                 | 是                     | 是                               |
| 批准自己的推薦                     | 否                 | 否                     | 一般案件否；另走有紀錄的直接邀請 |
| 請推薦者補充                       | 否                 | 是                     | 是                               |
| 最終拒絕、處理爭議                 | 否                 | 否                     | 是                               |
| 撤銷／重發尚未接受的自己推薦之邀請 | 是                 | 是                     | 可處理全部                       |
| 指派／撤銷審核資格、管理名額       | 否                 | 否                     | 是                               |
| 內容審核／刪除內容                 | 維持原權限         | 不因審核會員資格而取得 | 維持原權限                       |

MODERATOR 不自動獲得會員審核權。後端每次操作查詢有效資格；資格撤銷後下一次請求即失效。角色／資格／推薦者／批准者一律由伺服器決定。批准交易鎖住並重查 actor 的 user／reviewer 資格列，資格撤銷也鎖相同列；以交易提交順序決定並發結果。

共同標準：與在地生活有實際需求；願意友善互動及遵守規範；分享資訊時願意說明來源及修正錯誤。不得將年資、發文量、職位或族裔身分作為自動批准門檻。這是審核者指引，不是受邀者必填問卷。

## 5. 資料模型與狀態轉移

下列表名為建議命名；新增 Drizzle schema、migration、snapshot、journal，保留已套用的歷史 migration。時間均使用 `timestamptz`。

| 表                        | 主要欄位／約束                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `membership_reviewer`     | `user_id` PK/FK、`granted_by`、`granted_at`、`revoked_by?`、`revoked_at?`；歷次變更另寫 audit                                                                                                                  |
| `membership_batch`        | `id`、`name`、`capacity` 正整數、`status=open/closed`、`created_by?`、timestamps；部分唯一索引限制一個 open 批次，一般批准使用該批次；created_by 僅 operator bootstrap 可空                                    |
| `membership_nomination`   | `id`、`email_normalized`、`nominator_id?`、`source=member/admin_direct/operator_bootstrap`、`note?`、`status`、`revision`、`approved_by?`、`approved_at?`、timestamps；nominator_id 僅 operator bootstrap 可空 |
| `membership_invitation`   | `id`、`nomination_id` UNIQUE、`batch_id`、`delivery=manual/email`、`token_hash` UNIQUE、`token_version`、`expires_at`、`status`、`redeemed_by?`、`redeemed_at?`、`revoked_by?`、timestamps                     |
| `membership_admission`    | `user_id` PK/FK、`source=legacy/invitation/operator_bootstrap`、`invitation_id?` UNIQUE/FK、`admitted_at`、`terms_version?`、`terms_accepted_at?`；legacy 不虛構同意紀錄                                       |
| `membership_join_context` | `id`、隨機 cookie secret 的 hash、`invitation_id`、`token_version`、`expires_at`、`terms_version?`、`terms_accepted_at?`、`consumed_at?`；伺服器保存推薦／Email 關聯，不由 client 指定                         |
| `membership_audit`        | append-only：`id`、`actor_id?`、`action`、`nomination_id?`、`invitation_id?`、`target_user_id?`、必要前後狀態、`reason?`、`created_at`；不含 token／OTP                                                        |
| `mail_outbox`             | `id`、`kind`、`dedupe_key` UNIQUE、`recipient`、加密 payload、`status`、`attempts`、`next_attempt_at`、`lease_until?`、`provider_message_id?`、去識別化 error code、timestamps                                 |
| `membership_request`      | `actor_id`、`operation`、`idempotency_key` 組合唯一；`request_hash`、`result_entity_id`、`result_version`、`created_at`；不儲存含原始 token 的回應；與業務 mutation 同交易寫入，至少保留 30 天                 |

Email 正規化：trim + lowercase，與本專案既有邀請一致；不刪 Gmail 點號、不移除 `+tag`。上線前只讀檢查既有 user 的正規化碰撞；發現衝突需人工處理，不能自動合併帳號。新增一致的唯一性防護，不能只有前端比對。

`membership_nomination` 狀態：

```text
pending_review -> needs_info -> pending_review
pending_review -> approved -> joined
pending_review / needs_info -> withdrawn
pending_review / needs_info -> rejected  (ADMIN)
approved -> closed  (邀請撤銷或到期)
```

`membership_invitation` 狀態：`issued -> redeemed | revoked | expired`。寄信狀態獨立，避免把「寄出」誤認成「接受」。重新發出未過期邀請為 `issued -> issued` 並提升 token version、換 hash、更新到期日；舊 context 全部失效。重發沿用 delivery；manual 只回一次性新碼，email 排入寄送，不讓一般會員取得收件者 OTP。

資料完整性：

- 對 `pending_review / needs_info / approved` 的 `email_normalized` 建部分唯一索引；一個 Email 同時只有一個有效推薦流程。
- 一個推薦案最多一筆 invitation、一個 invitation 最多一筆 admission、一個 user 最多一筆 admission。
- 不能在部分索引條件中使用 `now()`；到期由狀態轉移及每次服務檢查執行。新推薦或發行時先處理同 Email 已到期案件，不能等背景任務才解鎖。
- member 來源的批准者不得為推薦者；ADMIN direct 明確例外。DB check 能表達者放 DB，其餘服務端在交易中驗證。
- 狀態、批准／兌換時間及對應人員欄位須有一致性 check；audit 保留歷史，避免硬刪推薦／邀請。
- 同 Email 重複推薦：同推薦者回傳既有案件；其他推薦者取得一般性「無法建立此推薦」，不披露會員存在與其他推薦者資料。
- 已有會員的 Email 不建立新推薦；以同樣的一般訊息回應。修改被推薦 Email 須撤回後新建，不允許批准後改收件人。

### 名額定義

批次已使用量 = `redeemed` 邀請數 + 尚未過期的 `issued` 邀請數。批准／直接邀請時預留名額；接受邀請不再扣第二次。到期或撤銷釋放未使用名額，既有會員及 legacy backfill 不計入。

發行時鎖住 batch row，處理過期資料、重新計算可用量，接著建立 invitation、更新 nomination、寫 audit，delivery=email 時排入 outbox，同一交易提交。重發未過期邀請不增加名額。已到期／撤銷案件不復活，需新推薦或 ADMIN direct。不能把 capacity 調低於目前已使用量。

`batch.closed` 僅停止新發行；已發出的有效邀請仍可接受。緊急暫停使用 `MEMBERSHIP_MODE=closed`，暫停兌換時保留舊會員登入。關閉批次不自動撤銷已發邀請。

## 6. 身分驗證、兌換與交易邊界

### 第一個工程里程碑：驗證 Better Auth 接入方案

實證與結論已記錄於 [ADR 0001：邀請制會員的 Better Auth 交易邊界](adr/0001-membership-invitation-auth-transaction-boundary.md)。結論：首選要求對 Email OTP 路徑不成立，改採該文件第 4 節的替代設計；此里程碑視為已完成，後續票號可依 ADR 第 5 節的影響清單展開。

安裝版已有 Email OTP plugin，型別包含 `disableSignUp`、`storeOTP`、`allowedAttempts`、`expiresIn`；本次讀到的 `signInEmailOTP` 在驗證 OTP 後可建立 user。官方文件也指出 OTP 可能自動註冊。因此啟用 plugin 本身不等於邀請制。

本次讀到 `db/with-hooks.mjs` 的 after hook 會經 `queueAfterTransactionHook`。**不得假定現有 `user.create.after` 與自訂 `pool.query()` 共享交易。** 也不能用 before 查邀請、after 扣邀請，就宣稱已避免競態。

先做小型實證與 ADR（architecture decision record）：使用受支援的 Better Auth hook／plugin／adapter extension，確立 request-scoped join context 如何跨 OTP／Google callback 傳遞，以及 user 建立與 invitation/admission 如何共用同一資料庫交易。不得修改 `node_modules`、另建 JWT 系統或自行實作密碼雜湊。

**首選要求：在同一 transaction-scoped adapter 操作內，完成新 user、admission、邀請兌換及 audit 寫入。** 需檢查安裝版 Drizzle adapter 支援範圍，不能把此描述當成已確認存在的 API。若安裝版無法可靠做到，先提出替代設計及失敗復原測試供工程設計審查；不得改成先發有效 session 再補 admission。此里程碑未通過，不可上線新的開戶路徑。

### 必須成立的伺服器規則

1. 所有新 user 建立途徑預設拒絕；只有有效 join context 且已驗證匹配 Email 的准入流程，或明確的本地／營運 bootstrap 工具可建立。
2. 公開 `/sign-up/email` 永久停止新建 user；保留既有 Email／密碼登入。
3. OTP 的公開直接呼叫，即使 OTP 正確但沒有有效邀請 context，也不能建立陌生帳號。`disableSignUp` 是全域布林選項，不能將它誤當成每位受邀者的授權；如何搭配受控新建流程由 ADR 確認。
4. Google 的首次登入也必須經 gate；OAuth state、nonce／PKCE（依 provider 流程）、已驗證 Email 由 Better Auth 處理。邀請上下文在伺服器保存，不能只靠 client `callbackURL` 或 request body。
5. `emailVerified`、role、reviewer、admission source 不能由 client 指定。邀請碼證明受邀資格，不證明 Email 所有權；手動轉傳邀請碼仍需 OTP／已驗證 Google。
6. Google 未驗證 Email 或不相符時拒絕新建及兌換；不得擅自連結既有同 Email 帳號。檢查 Better Auth account linking 設定，測試未驗證舊帳號衝突。
7. 有效舊會員正常登入無需邀請；被允許的既有 user 路徑須有 legacy／invitation admission。所有線上 auth 入口，包括直接呼叫及 provider callback，均套用相同規則。

### 接受邀請協定

1. POST token 到 context endpoint。查 token hash、有效期限及狀態；建立 15 分鐘 context，設置 Secure、HttpOnly、SameSite=Lax cookie（localhost 測試例外）。GET／Email 掃描器預覽不兌換、不寄 OTP、不建立帳號。
2. 使用者明確按接受後，記錄 server 決定的約定版本與接受時間於 context。OTP 只寄到 context 指定的 Email；Google 開始／callback 綁同一個 context。
3. 取得可驗證的身分證明後，進入完成准入交易。固定鎖定順序 `actor user/reviewer（需授權時）-> batch -> nomination -> invitation -> join_context`，其餘寫入也依同序或其子序列，避免死鎖。鎖多個同類紀錄時依 id 排序。
4. 重查 expiry、token version、撤銷狀態、緊急暫停及 Email；建立 user 與 admission，標記 invitation redeemed、nomination joined，寫 audit 和必要分析事件，一起提交。
5. 交易完成且確認 admission 後，才建立／對外發出可用 session。session 建立失敗時保留已完成的 admission，使用者可由 Email OTP 再登入。
6. 同一邀請在不同瀏覽器同時兌換只允許一個 user；重試若已是同一個經驗證 user，回傳既有成功結果。不同 Email 永遠失敗。
7. 若有效既有會員已持有相同 Email，驗證後將 invitation 撤銷，audit reason=`already_member`，釋放預留名額；保留原 admission，正常登入。

撤銷／到期／重發與兌換要用相同鎖及版本檢查。先提交的結果有效；若兌換先完成，撤銷回 `INVITE_ALREADY_REDEEMED`，不能把撤銷邀請當成撤銷會員。

### 憑證與限制

- 邀請 token 使用 CSPRNG 至少 128-bit entropy，資料庫只存 hash。token／OTP／context secret 禁止寫入分析、一般 logs、錯誤監控及推薦備註。
- `/join` 與驗證頁 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、noindex；不載入會蒐集網址或表單的第三方分析。
- `returnTo` 僅接受經驗證的本站相對路徑；拒絕 `//`、反斜線與外部／編碼繞過，不讓邀請帶入任意跳轉。
- cookie 認證的寫入驗證 Origin／CSRF；native bearer 無 Origin 的既有合約保留，但 bearer 不得繞過新帳號准入。
- PostgreSQL 共用限流：推薦初始 5 次／會員／日、OTP 發送 5 次／Email／小時及 20 次／IP／小時、context 交換 30 次／IP／10 分鐘。這些是可調預設，與 Better Auth 既有限流取較嚴者。
- OTP 以 hashed 模式存放；無法發信時不得回報「已寄達」。未知 Email 的一般登入回應不披露帳號存在；有有效 context 的受邀者可看到可操作的寄送失敗訊息。

## 7. 擬定 API 合約

沿用 `/api/v1` 的 `{data}`／`{error:{code,message}}`；Better Auth endpoint 保留原生合約。新業務路由使用 `membership` namespace，避免與既有群組 `/invites/{token}/accept` 衝突。列表預設 20 筆，最大 50，排序穩定。

| Method / route                                                    | 輸入                                    | 授權與結果                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /api/v1/membership/me`                                       | 無                                      | 已登入；自身推薦、審核能力及可用批次摘要，不回別人的 Email                                  |
| `POST /api/v1/membership/nominations`                             | `{email,note?}`                         | 已驗證會員；建立 pending，201；同推薦者重試回既有，200                                      |
| `GET /api/v1/membership/nominations?scope=mine/review&cursor=...` | scope                                   | mine 只回自己；review 需審核權，不回 token                                                  |
| `GET /api/v1/membership/nominations/{id}`                         | 無                                      | 擁有者／審核者／ADMIN 的欄位投影；無權限者 404                                              |
| `PATCH /api/v1/membership/nominations/{id}`                       | `{note,revision}`                       | 推薦者修改 pending／needs_info；不改 Email；補充後回 pending                                |
| `POST /api/v1/membership/nominations/{id}/withdraw`               | `{revision}`                            | 本人／ADMIN；限 pending／needs_info                                                         |
| `POST /api/v1/membership/nominations/{id}/decision`               | `{decision,revision,reason?}`           | `approve / needs_info / reject`；needs_info、reject 要理由；reject 限 ADMIN                 |
| `POST /api/v1/membership/invitations/{id}/revoke`                 | `{reason?}`                             | 推薦者／ADMIN；尚未接受                                                                     |
| `POST /api/v1/membership/invitations/{id}/reissue`                | 無                                      | 推薦者／ADMIN；限有效 issued，換碼、清除舊 context；email 建新寄信工作，manual 回一次性新碼 |
| `POST /api/v1/membership/join/context`                            | `{token,returnTo?}`                     | 無登入；設 cookie，回遮罩 Email、推薦者名稱、到期時間，不回 secret                          |
| `POST /api/v1/membership/join/email/start`                        | `{acceptTerms:true}`                    | 有效 context；寄綁定 Email OTP，202；約定版本伺服器決定                                     |
| `POST /api/v1/membership/join/email/complete`                     | `{otp}`                                 | 有效 context；完成准入與 Better Auth session，不接受 client userId/email/role               |
| `POST /api/v1/membership/join/google/start`                       | `{acceptTerms:true}`                    | 有效 context；啟動 Better Auth OAuth，callback 由既有 auth route 承接                       |
| `GET /api/v1/membership/admin/invitations?cursor=...`             | 篩選狀態                                | ADMIN；批次／寄送／兌換狀態，無原始 token                                                   |
| `POST /api/v1/membership/admin/invitations`                       | `{email,batchId,delivery:manual/email}` | ADMIN direct；manual 回一次性連結／碼，email 回 delivery pending                            |
| `GET /api/v1/membership/admin/reviewers`                          | 無                                      | ADMIN；有效及已撤銷審核者                                                                   |
| `PUT /api/v1/membership/admin/reviewers/{userId}`                 | `{enabled,reason?}`                     | ADMIN；grant／revoke 與 audit 同交易，不修改 user.role                                      |
| `GET / POST / PATCH /api/v1/membership/admin/batches[/{id}]`      | 建立／修改 `{name?,capacity?,status?}`  | ADMIN；schema 依 method 分開，不能降至使用量以下                                            |
| `POST /api/v1/membership/admin/mail/{id}/retry`                   | 無                                      | ADMIN；只重試仍有效的 invitation mail，不重建批准或名額                                     |

新增錯誤碼：`INVITE_REQUIRED`、`INVITE_INVALID`、`INVITE_EMAIL_MISMATCH`、`INVITE_ALREADY_REDEEMED`、`SELF_APPROVAL_FORBIDDEN`、`REVIEWER_REQUIRED`、`EMAIL_VERIFICATION_REQUIRED`、`NOMINATION_UNAVAILABLE`、`REVISION_CONFLICT`、`BATCH_FULL`、`MEMBERSHIP_PAUSED`、`MAIL_UNAVAILABLE`。無效邀請統一 404，授權錯誤 403，狀態競態 409，限流 429，暫時性郵件／緊急暫停可用 503；對外 message 走雙語字典，不直接呈現 provider error。

所有建立／批准／直接邀請／重發需支援 actor-scoped `Idempotency-Key`，以伺服器請求紀錄或等效 DB 唯一鍵保證同 payload 重試不重扣名額／重寄；同 key 不同 payload 回 409。manual 發行若回應遺失，重試回 invitation id 與「連結不可恢復」，使用明確的重發動作取得新碼，不能永久儲存 plaintext 回應。

## 8. 郵件與可靠寄送

- 新增 server-only `Mailer` 介面，支援 invitation／OTP；正式 provider 由團隊選定並查官方文件及 SDK 型別。不得假設已有 Resend／SES／SMTP 帳戶。
- delivery=email 的 invitation 發行及 outbox enqueue 同交易；manual 不寄信。outbox 用 row lock／lease、有限重試及唯一 dedupe key 防止多 worker 重複處理。
- invitation 交易表只存 token hash；為可靠寄送，outbox 暫存加密的收件資料／token payload，使用獨立 server-only 金鑰與 key version。送達供應商或工作作廢後移除敏感 payload；永久失敗保留的 payload 也有到期清除。
- worker 寄送前重查 token version、有效期限及 revoked 狀態。舊版重發工作標記 superseded。供應商 timeout 時以穩定 provider idempotency key 重試（若支援）；無法保證完全一次寄送時，允許同一邀請信重複，但不重建邀請／名額。
- invitation 重試建議 1 分鐘、5 分鐘、30 分鐘、2 小時，最多 5 次嘗試；永久退信停止自動重試。區分 queued、provider accepted、failed；provider accepted 不能標成已讀或已加入。
- OTP 不能等數小時才送；在可靠的短生命週期寄送流程中提交 provider，失敗可重寄，避免 serverless 未 await 工作遭中斷。選定 durable invocation／排程機制並列入部署，不依賴 request 結束後的裸 Promise。
- 建議新增配置名稱：`MAIL_PROVIDER`、`MAIL_FROM`、provider secret、`MAIL_OUTBOX_ENCRYPTION_KEY`；實作時只在 `.env.example` 寫 placeholder，不能覆蓋既有 `.env`。
- dev／CI 使用 local test transport。OTP／郵件只在受限本機測試收件匣讀取；正式環境拒絕 test transport，不印 token 到終端或提供公開取 OTP API。
- 每日到期／payload 清除與 outbox worker 均需可部署的執行方式、健康檢查及失敗訊號；平台排程的具體供應商屬上線前依賴。

## 9. 群組邀請、舊會員與 bootstrap

### 群組

保留既有群組邀請權限：群組 owner 可以邀加入群組，不能因此繞過平台准入。第一版不自動將 group_invite 轉成已批准的平台邀請。

群組管理畫面加入「需要平台帳號？推薦加入 TaiwanHub」入口，預填相同 Email；仍是會員推薦流程，不多問被推薦者問題。既有平台邀請可帶安全的 group join return path，完成帳號後回到原群組邀請頁，依既有規則接受群組邀請。平台批准不自動加入群組，不提前顯示私人圖層或成員。

只有群組邀請、沒有平台邀請的訪客看到明確說明「請邀請者先完成 TaiwanHub 會員推薦」；不得導向已移除的公開註冊。此為第一版刻意的界線，後續可把推薦入口合併，但不能減少審核。

### 舊會員及切換

- 遷移切換前既有真實 user 建立 `source=legacy` admission；保留原角色及 emailVerified，不能把未驗證者標成已驗證。
- seed demo users 不取得審核能力、不寄信、不成為真實新增會員指標；測試 fixture 有明確測試標記／隔離 DB。backfill 前檢查 seed 的已知 ID，不能只靠 Email domain 猜哪些是真實會員。
- 舊登入可繼續使用，未驗證會員首次推薦／審核時完成一次 Email 驗證；不要求重新取得推薦。
- 切換時短暫封鎖所有新 user 建立入口，完成最後一輪 idempotent legacy backfill，再啟用 invitation-only gate。需要處理舊 deployment 及進行中的 OAuth callback，不能讓切換窗口新建的 user 漏入。
- backfill 使用固定切換界線；切換後不再用「缺 admission 就視為 legacy」的自動補齊，否則等於繞過邀請。

### 全新環境首位管理員

新增受控 CLI（建議命名 `pnpm membership:bootstrap --email ...`，尚不存在）：只在沒有 ADMIN 時，建立限該 Email 的 bootstrap invitation 與容量為 1 的批次；nomination.source=`operator_bootstrap`，人員 FK 可空但須記錄操作來源。經正常驗證完成 user 後，操作員再用現有 `pnpm admin:grant` 賦權。全站只能有一個有效或已兌換的 bootstrap 流程；以資料庫鎖／唯一約束防止同時執行重複建立。

工具須防重跑、記錄 `operator_bootstrap`、不建立通用邀請碼或預設密碼；只有明確本機／營運命令可使用，不能由 HTTP 或 client field 啟用。憑證以受保護檔案等方式交付，避免 CI logs。已存在 ADMIN 的部署使用正常 ADMIN direct 流程。

## 10. 稽核、觀測與資料可見性

推薦 Email 及說明只提供推薦者、有效審核者及 ADMIN；其他會員不可讀，受邀者不看到內部備註。審核者可看處理所需欄位，第一版沒有整站 Email 匯出功能。

業務 audit 與通用 analytics 分離。審核、撤銷、名額與資格變更、兌換在對應交易中記錄 audit；analytics properties 不含 Email、推薦文字、token 或精確位置。

建議事件：`membership_nominated`、`membership_approved`、`membership_invite_issued`、`membership_joined`。`user_signed_up` 只記一次，與現有 after hook 去重；不能為了新增事件重複計算帳號。邀請重發不是新會員。

第一版營運可觀察：待審數與等待時間、各批名額、invitation 寄送失敗、已發／已加入比例、受邀加入失敗原因分類、加入後 7 日有實際使用的比例。小樣本先看個案及絕對數，不建立公開推薦者排名。

建議初始資料保留政策：到期 join context 24 小時內清除；OTP 按驗證層到期清理；未加入案件結束 90 天後清除 Email／自由文字，保留最小狀態及 actor/id audit。正式啟用前由營運確認保留政策；已加入者推薦來源保存為會員管理紀錄，刪除帳號請求需有一致處理規則。此非要求收集更多資料。

## 11. 工程拆票、相依與交付物

估計是工作量範圍，不含外部郵件帳戶準備／核准時間；S0 後重新估算。兩名工程師加部分 QA 可規劃約 3–5 週，實際以 auth 實證結果為準。

| 票號 | 工作／主要檔案                                                                           | 相依                    | 驗收交付物                                                          | 粗估人日 |
| ---- | ---------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------- | -------- |
| S0   | Auth 接入實證；安裝版 Better Auth OTP、Google、hook／adapter 交易與 account linking      | 無                      | ADR、端點建立路徑清單、直接繞過／並發／中斷復原測試；未通過禁止上線 | 2–3      |
| S1   | shared Zod／型別、`packages/database/src/schema.ts` 及 migration                         | S0 定案                 | 約束、索引、狀態／名額交易、disposable DB migration 測試            | 2–3      |
| S2   | `apps/web/src/features/membership/{service,repository,access}.ts` 與業務 API             | S1                      | 推薦、資格管理、批准、撤回、重發、名額、audit、idempotency          | 3–4      |
| S3   | server-only mail adapter、outbox worker、test transport                                  | S1                      | 模板、失敗重試、過期清除、可部署 worker 及無憑證外洩測試            | 2–3      |
| S4   | `lib/auth.ts`、`lib/session.ts`、join context／准入整合                                  | S0、S1、S3              | OTP 及已啟用 Google gate、舊登入相容、單次兌換／恢復                | 3–5      |
| S5   | `/join`、`/membership`、`/membership/review`、`/admin/membership`；auth form、dictionary | S2、S4；可先依合約做 UI | 英／繁中、手機／鍵盤可用、受邀者零問卷、清楚錯誤狀態                | 3–4      |
| S6   | 群組導引、legacy backfill、bootstrap CLI、flags／上線 runbook                            | S2、S4                  | 無公開註冊依賴的新環境建立及切換演練、群組回跳                      | 2–3      |
| S7   | 更新全部 signup E2E fixture、回歸測試、README／api／database／deployment 文件            | S2–S6                   | CI 完整通過、staging 驗收、正式 rollout／rollback 清單              | 2–4      |

S2 與 S3 可由工程團隊平行開發；S5 可先依固定 DTO 製作。不要在 auth／資料模型尚未定案時同時實作不同的資格判斷。

## 12. 測試與可驗收條件

### 必須通過的產品驗收

- AC01：訪客仍能瀏覽；所有公開入口均沒有 Sign up／申請表。
- AC02：普通會員只填 Email 即可送出推薦；選填說明不阻擋提交。
- AC03：無審核資格者直接呼叫批准 API 得 403；MODERATOR 不自動通過。
- AC04：審核會員能批准別人的推薦；自己的推薦被拒；ADMIN direct 明確記錄例外。
- AC05：受邀者不用填 Email、名稱、密碼或問卷，即可用 OTP 完成加入。
- AC06：Email OTP、Google 初次登入、原生 auth endpoint 直接呼叫都無法繞過邀請 gate。
- AC07：錯誤 Email、過期、撤銷、重發後的舊碼／舊 context 都不能開戶。
- AC08：同一邀請並發只建一個 user、一個 admission、一筆加入事件；名額不可超額。
- AC09：Google callback、寄信或 session 回應失敗不造成永久卡住，能恢復且不重複開戶。
- AC10：撤銷 reviewer 後舊 session 不能繼續批准；其內容權限不受此資格影響。
- AC11：舊會員正常登入、收藏、投稿、RSVP；群組邀請不授予平台資格或洩漏私人資料。
- AC12：所有畫面英／繁中、375px 手機、鍵盤操作與可讀狀態訊息通過。

### 測試層級

| 層級             | 覆蓋                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit             | Zod unknown 輸入、Email 正規化、狀態轉移、權限矩陣、self approval、expiry boundary、returnTo、遮罩／DTO、token hash、mail error mapping                                                                         |
| DB integration   | 真 Postgres 唯一約束、最後一席並發批准、雙重兌換、撤銷／重發與兌換競態、reviewer 撤銷競態、transaction rollback、重複 idempotency key、outbox lease／重試、migration/backfill                                   |
| Auth integration | 真 Better Auth handler + 測試 mail／mock OAuth；OTP 自動註冊繞過、直接 password signup、Google 首次 callback、未驗證 Email、account linking 衝突、無 context、過期 context、user commit 後 session failure 恢復 |
| E2E              | 管理員手動邀請、會員推薦→另一人批准→Email 加入、needs_info、批次額滿、撤銷／重發、既有登入、群組回跳、手機／雙語                                                                                                |

所有 auth plugin 的新增 endpoint／client 可寫 user field 列入 threat-oriented 回歸清單。整合測試至少注入三個中斷點：user 建立前、user/admission transaction 提交前、提交後 session 回應前。只有 mock 服務函式成功不足以證明 gate 有效。

E2E 共用 `createInvitedMember` fixture，透過受控 DB setup／測試 transport 建立邀請；至少一條 E2E 從 UI 完成完整推薦及批准。禁止 `NODE_ENV=test` 以外可啟用的 HTTP bootstrap／OTP 讀取後門。Google 真實 provider 另列 staging smoke test，CI 不呼叫真信箱或付費服務。

工程完成後依序執行，並先確認 integration／E2E 的有效 `DATABASE_URL` 是 disposable test DB（不印出憑證）：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

本次只撰寫文件，不宣稱以上應用測試已執行。文件驗證使用 scoped Prettier、相對連結檢查及 diff 檢查。

## 13. 上線順序與回復

1. 完成 S0 設計閘門、確認 mail provider／寄件網域／worker 環境及 UI 約定文案；Google 未能通過 gate 時，關閉新的 Google 開戶選項，保留既有 Google 會員登入。
2. 在 disposable DB 演練 schema migration、legacy backfill、全新環境 bootstrap；不要對 production seed。
3. 部署 additive schema 及相容程式至 staging，配置 server-only mail secret，執行完整 suite 與少量測試收件者驗收。
4. 準備 server-side `MEMBERSHIP_MODE=closed/invite_only`：closed 禁止所有新開戶但保留舊登入；invite_only 開啟本流程。另以 `MEMBERSHIP_ISSUANCE_PAUSED` 暫停批准／發碼而不影響既有有效邀請兌換；缺失／未知配置對新開戶 fail closed。不得提供意外回到 public signup 的 fallback。
5. 經授權，短暫關閉正式環境所有新開戶路徑，處理舊 deployment／in-flight callback，記錄 cutoff 並執行 legacy backfill；核對 ADMIN 可登入及真實 user 均有 admission。
6. 指派少量 reviewer、建立第一批名額，切換 invite_only；先由管理員測試一份手動邀請，再測試一份會員推薦批准。
7. 核對 OTP／Google（若啟用）、寄送失敗訊號、批次計數、私人資料權限及 audit，再分批邀請。

故障時先設 closed 或 issuance pause，保留既有登入、已建立會員、邀請及 audit。回退版本必須仍含拒絕公開 signup 的 gate；**不能直接回退到本次改造前的公開註冊版本**。若只能回舊版，先在外層封鎖全部新帳號建立及新 provider onboarding 路徑。schema 以保留為主，不刪除新會員或反向清除 audit。

### 上線前需要落定，但不阻擋先估工的事項

- Mail provider、寄件身分與 worker／排程環境。
- 第一批 reviewer 名單、批次名額與正式邀請期限。
- OTP 作為預設加入方式，以及 Google 是否同批推出；本規格以 OTP 必備估工。
- 社群約定／隱私文案及資料保留期限。
- S0 ADR 確認的 auth transaction／recovery 具體接入方式。

## 14. 參考與實證邊界

- [Better Auth Email OTP](https://www.better-auth.com/docs/plugins/email-otp)：自動 signup 及 OTP 選項，實際以安裝版型別／測試為準。
- [Better Auth database hooks](https://www.better-auth.com/docs/concepts/database)：hook 介面；不保證任意外部 SQL 參與同一交易。
- [Better Auth Google](https://www.better-auth.com/docs/authentication/google)：provider 設定與驗證整合。
- [ADR 0001：邀請制會員的 Better Auth 交易邊界](adr/0001-membership-invitation-auth-transaction-boundary.md)：S0 執行實證，含逐行原始碼引用與 `tests/integration/membership-auth-transaction-spike.test.ts` 的實測結果，已確認首選要求對 Email OTP 路徑不成立並記錄替代設計。
- [Superhuman 早期使用者研究](https://blog.superhuman.com/how-superhuman-built-an-engine-to-find-product-market-fit/)、[Dribbble 邀請制度演進](https://dribbble.com/stories/2021/04/29/a-bigger-more-inclusive-dribbble)、[Bluesky 分批邀請與審核能力](https://bsky.social/about/blog/6-02-2023-beta-update)：產品方向背景，不是本案數字預設或效果的保證。
