# LocalLink 地圖分區、聚焦遮罩與互動效果實作計畫

日期：2026-10-11。狀態：待實作。本次僅新增計畫文件，不修改介面或啟動 Claude。

## 1. 產品決策與範圍

延續 [極簡滿版地圖計畫](minimalist-floating-map-plan.md) 的滿版地圖與浮動面板，增加「分區探索 → 點選聚焦 → 主動篩選」流程。

- 第一版以 Houston 官方 Super Neighborhoods 作為分區候選，不使用 county 切城市內部，也不自動依每條道路產生碎片。道路、河流繼續提供視覺參照；county／人工道路分區留待後續需求。
- 保留目前工作目錄中的灰階低飽和底圖。先前示意圖的暖灰不是要求恢復舊色盤；新色彩主要用於 marker。
- 點選區塊先改變視覺聚焦，不改查詢、結果數與列表。只有按「只看此區」才啟用資料篩選。
- 七組 marker 視覺類型、區塊 hover、marker hover、列表聯動；不加入持續跳動、游標拖尾、3D 或新的地圖供應商。
- 保留搜尋、日期、圖層、私有項目授權、收藏、URL、純列表備援、外部商家來源區別及中英介面。

目前工作目錄仍有前一階段的未提交變更。實作開始時需重新檢查 diff、確認基礎功能與檢查結果，不能將本計畫視為前一階段已完整驗收的證據，也不能覆蓋或一併提交其他人的工作。

## 2. 原始碼基準與重要限制

| 現有位置                                                                  | 可重用／需調整處                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/map/map-canvas.tsx`                              | 持續存在的 Mapbox instance、群聚、獨立 selected-item source、外部結果 source；新增分區與遮罩圖層及命中優先序 |
| `apps/web/src/components/map/map-workspace.tsx`                           | URL、結果、選取與浮動面板 controller；新增暫時聚焦狀態與明確篩選動作                                         |
| `apps/web/src/lib/map-panel.ts`                                           | 面板與相機 padding；任何區域取景繼續沿用，不重建 canvas                                                      |
| `apps/web/src/lib/map-appearance.ts`                                      | 目前為灰階色盤；底圖 restyle 必須跳過所有新增 app sources                                                    |
| `packages/shared/src/categories.ts`                                       | 真正的地點分類與 `isFoodCategory`、`isRetailCategory`；不能另建不一致的 UI 分類清單                          |
| `packages/shared/src/index.ts`                                            | 目前 query 支援矩形 `area`，尚無 polygon region 篩選                                                         |
| `apps/web/src/features/map/query.ts`                                      | 目前有候選筆數上限，`total` 是截斷後結果長度；不能把它當作全區完整統計                                       |
| `apps/web/src/features/map/request.ts`、`apps/web/src/lib/map-session.ts` | 深連結、城市與 session 行為，新增 region 時需同步檢查                                                        |

這是原始碼規劃，不是目前應用程式的完整瀏覽器驗收。

## 3. 分區資料準備

### 官方來源與採用門檻

候選資料：[Houston 官方 Super Neighborhoods](https://www.houstontx.gov/superneighborhoods/index.html)、[官方 GIS polygon 圖層](https://geohwp.houstontx.gov/arcgis/rest/services/02_BaseData_Boundaries/COH/FeatureServer/1)。後者支援 GeoJSON，但頁面標示的更新日期為 2022-01-25，且明確說明分區未涵蓋整個 Houston。實作前須與市府現行資料核對；此連結不代表已驗證為最新版本。

1. 確認邊界版本、資料再利用條款與必要署名；空白 copyright 欄不等於無限制使用。
2. 取得固定快照，轉成 WGS84 經緯度，驗證 Polygon／MultiPolygon、閉合 rings、洞、有效座標及合理範圍。不可直接把來源投影座標當經緯度。
3. 只保留分區 ID、官方名稱、可選譯名、幾何、bbox 與標籤定位點；不要帶入人口等本功能不需要的屬性。
4. 建立穩定 app region ID 與來源 ID 對照，不依陣列 index 或未驗證穩定性的 OBJECTID。中文名稱未經確認時顯示官方英文，不自行杜撰翻譯。
5. 記錄 manifest：来源、取得日期、來源版本／更新日期、授權、SHA-256、座標系統、處理步驟、涵蓋與缺漏說明。
6. 保存完整查詢幾何與拓撲保真的簡化顯示幾何；同一版 manifest 關聯兩者。接壤邊界共同簡化，避免製造縫隙與重疊。

建議新增 `packages/shared/src/data/map-regions/` 存放固定快照與 manifest，完整幾何只由伺服器按需載入；簡化版本可作為 `apps/web/public/map/regions/` 的版本化資產。不要從 shared barrel 匯出大份 JSON，避免所有 client bundle 都包含邊界。新增可重現的匯入／驗證指令；實作時依既有工具選擇最小必要依賴。

### 未涵蓋區域

城市外、都市圈其他城市、官方分區空白處均保留正常地圖與 marker，不推測所屬分區，也不自動吸附到最近的區域。使用者在這些位置仍可搜尋與探索。已聚焦時它們屬於「聚焦區之外」，可以被遮罩淡化。

資料無法取得、驗證不合格或使用條款不明時，停用分區功能並記錄具體原因；一般地圖與 marker 效果仍可使用。不能用生成式模型補出地理邊界。

## 4. 分區、遮罩與事件規格

### 視覺層次

- 未聚焦：各區同一中性色，填色 0–3%，邊線約 1px；不做多色拼圖。
- 城市尺度先顯示區界與主要區名；靠近街道時降低未選區邊線。以 zoom 9–12／12–15 為調校起點，不將所有區名強制顯示而互相重疊。
- Hover：填色約 5–8%，邊線 1.5px，顯示區名，過渡約 150ms。
- 已聚焦：邊線約 2px，區外灰色遮罩預設 24% opacity，可在 20–30% 間視覺調校；不模糊地圖。
- 遮罩位於底圖與區界／app marker 之間；外部 marker 另以約 0.6 opacity 表示非聚焦範圍，選取 marker 保持清楚。浮動 UI、定位資訊與供應商 attribution 不套遮罩。
- 保留底圖明暗層次；遮罩不能讓区外道路、標籤變得無法辨識。選取外部 marker 不自動改變分區或篩選。

### 遮罩幾何與渲染

使用地理座標對齊的反向 polygon 遮罩。離線生成或在區域切換時取得「支援地圖範圍減去選定幾何」的有效差集；不能只替其他已知區塊填色，否則未分區處不會變暗。必須正確處理 MultiPolygon、多個洞、凹多邊形，以及地圖可移動範圍／world wrap；洞中的非選區應被遮住，不能整個 bbox 挖空。

拖曳、縮放與 resize 時交由 Mapbox 重新投影，不能每次 mousemove 重算整份 GeoJSON。分區使用穩定 feature ID 與 feature-state 更新 hover；選取區切換才更新必要的遮罩 source。初始化或 style reload 後以冪等方式還原 sources、順序與 state。

### 互動優先序

| 操作            | 結果                                                             |
| --------------- | ---------------------------------------------------------------- |
| Hover 分區      | 暫時高亮與名稱；不移鏡頭、不改結果                               |
| 點分區          | 設定 `focusedRegionId`，顯示遮罩與浮動區名摘要；不自動 fitBounds |
| 點同一分區      | 維持聚焦；由明確「清除聚焦」控制離開                             |
| 點另一分區      | 切換視覺聚焦；已啟用的資料篩選暫不更改                           |
| 「查看整區」    | 依分區 bbox 與面板 padding 取景；bbox 僅用於相機                 |
| 點 marker／群聚 | 優先處理 marker／群聚，不同時觸發下方分區 click                  |
| 拖曳／縮放結束  | 不當作分區點選，不自動改聚焦區                                   |
| 清除聚焦        | 移除遮罩，保留查詢與已選項目；若有區域篩選，篩選摘要仍明顯可見   |
| Escape          | 先關頂層選單／tooltip／詳細面板，再清除聚焦；不清除資料篩選      |
| 切城市          | 清除舊城市聚焦與不相容 region 篩選                               |

## 5. 狀態與「只看此區」契約

區分三種狀態：`hoveredRegionId`（暫時）、`focusedRegionId`（本頁視覺）、`region`（URL 中的正式資料篩選）。前兩者不寫入 URL 或持久偏好。開啟帶 `region` 的深連結時可預設聚焦該區；之後使用者仍能清除視覺聚焦。

浮動摘要須明示「聚焦：A」與「結果範圍：B」可能不同。按「只看此區」將 focused region 寫入 query，清除既有矩形 `area`、重設 page，展開結果。搜尋文字、類型、日期、圖層與權限保持不變。直接傳入同時含 `region` 和 `area` 的 URL 採交集；使用者後續「搜尋此範圍」也採交集，兩個條件皆提供可見清除入口。

`region` 僅接受受支援城市的已知穩定 ID。shared schema 驗證格式，伺服器 registry 驗證 ID 與城市。無效或過期 ID 應回報可辨識的無效範圍狀態與清除入口，不悄悄顯示全市資料並假裝已篩選。

### 真正的多邊形篩選

- 正式篩選由伺服器使用可信 registry 幾何執行；不接收客戶端任意 GeoJSON 或 SQL。
- 採邊界含在內的 point-in-polygon 語意（如 PostGIS `ST_Covers`），支援凹邊界與洞。只看一區時，該區邊線上的項目可包含在內；跨區資料以 item key 去重。
- 篩選必須在候選 `LIMIT`／截斷、排名與計數之前生效。盤點 catalog、curated layer、自訂地點及外部參照各查詢路徑，防止先截取全市項目再篩區而漏掉區內項目。
- 不以 bbox 取代 polygon，不以任意地點名稱字串推測歸屬。
- 線上、全市性與缺座標項目不宣稱位於此區；啟用 region 時排除在區內列表外，顯示一般性說明，不洩漏不可見資料的數量。
- 地圖、列表及摘要使用同一查詢結果與資料版本。延續現有截斷提示；在未提供完整 count query 前，顯示「目前載入 N 筆」而非「此區共有 N 筆」。
- 外部即時搜尋若不能支援同等 polygon 篩選，明示它是獨立搜尋範圍；對已回傳有座標結果可以做顯示篩選，但不能聲稱是全區完整結果。
- 正式篩選是額外查詢功能，不能在僅完成視覺遮罩時提前展示可用按鈕。此階段需要 persistence/query integration tests，但不預設要新增資料表或 migration。

## 6. Marker 視覺類型與來源規則

新增集中式 `markerPresentation` mapping：輸入 item kind／category／來源，輸出視覺類型 ID、色彩、圖示與字典 label。分類語意放 shared；色碼及圖示放 web 呈現層。先判斷 event／content，再以既有 place category 判斷，不改資料庫分類。

| 視覺類型       | 既有映射                       | 色彩             | 圖示                |
| -------------- | ------------------------------ | ---------------- | ------------------- |
| 餐飲、咖啡     | `isFoodCategory`               | 陶土棕 `#A66B4F` | 餐具；Cafe 可用杯子 |
| 購物、雜貨     | `isRetailCategory`             | 灰藍 `#5C7893`   | 購物袋              |
| 公園、戶外     | `Park`                         | 灰綠 `#617D59`   | 葉子                |
| 藝文、景點     | `Museum`                       | 灰紫 `#867098`   | 畫框                |
| 社區、服務     | `Community Center`、`Service`  | 藍綠 `#4F837D`   | 人群                |
| 活動           | 所有 event，優先於場地分類     | 玫瑰色 `#B15F73` | 日曆                |
| 在地資訊、其他 | content、Other、未知或缺少分類 | 石灰褐 `#81796E` | 文件／中性圓點      |

既有資料尚未明確分類的藝文或戶外地點先使用「其他」，不透過名称推斷。外部 provider 的類型需經明確映射；未知類型使用中性色，空心樣式繼續區別外部搜尋結果。

- 縮遠維持圓點；zoom 約 14 以上可顯示輕量圖示，先驗證密集區碰撞情形。
- 選取使用一致的深色外環＋淺色 halo，保留原本類型顏色；與群聚分離的 selected source 繼續保留。
- 混合群聚使用中性色與數字，不以任意一筆項目的色彩代表全群。
- 列表圖示、地圖 marker 與浮動圖例共用 mapping；圖例只負責解釋色彩，不暗中新增分類篩選行為。
- 類型文字／圖示提供非色彩辨識；圓點與淺色底圖對比不足時補深色邊線。可點擊範圍至少 44px，即使視覺標記很小。

## 7. Hover、點擊與無障礙

| 效果              | 規格                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| Marker hover      | 放大約 15%、薄外環，150ms 左右；hit area 尺寸不隨動畫抖動                |
| Hover tooltip     | 停留 250ms 顯示名稱＋類型／一行摘要；離開取消計時，避免過期 tooltip 跳出 |
| 列表 hover／focus | 對應 marker 高亮，不改 URL、不移鏡頭、不捲動另一側列表                   |
| Marker click      | 一次約 250ms 外圈提示，之後為穩定選取；不持續循環                        |
| 焦點衝突          | selected 優先於 hovered；滑出後保留選取框，不能清掉選取                  |

詳細內容仍用既有面板，tooltip 不放必須靠 hover 才能使用的按鈕。使用文字節點安全渲染來源名称與摘要，不插入來源 HTML。Tooltip 避開視窗邊緣與浮動控制，滑鼠可移入閱讀，Escape 可關閉；不宣告每一次滑鼠移動給螢幕閱讀器。

手機第一次 tap 執行區塊聚焦或 marker 選取，不模擬 hover。新增可鍵盤操作的分區選擇器，與地圖 click 共用狀態；列表 focus 提供 marker 聯動與可讀名稱。`prefers-reduced-motion` 時取消縮放、pulse 與相機動畫，保留靜態外框。既有 `FEATURE_MAP_EFFECTS` 關閉時仍提供必要的分類、聚焦與選取辨識，只停用裝飾動畫。

## 8. 分階段交付與檔案

| 階段           | 主要工作／建議檔案                                                                                         | 驗收出口                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0 基準與資料   | 檢查既有未提交變更與指引；官方資料版本、條款、快照、manifest、幾何驗證                                     | 來源可用、已知涵蓋缺口；基礎地圖可驗證                    |
| 1 分區與聚焦   | 新增 `map-regions.ts`／registry、`region-focus-control.tsx`；擴充 canvas、workspace、map CSS 與 dictionary | 點區只改外觀，遮罩涵蓋所有區外位置；無資料可退回一般地圖  |
| 2 類型與互動   | 新增 marker presentation mapping；修改 canvas、results、appearance 與圖例                                  | 七組映射一致，hover 不改鏡頭，手機與鍵盤可操作            |
| 3 正式區域篩選 | shared query schema／序列化、map request/query 及所需 repository 路徑、API 文件                            | polygon 在截斷前篩選；URL、Back、列表、地圖、權限一致     |
| 4 整合與交付   | 更新地圖指南與設計文件、截圖、效能與回歸證據                                                               | 下列測試完成或具體記錄受阻項目，再建立 scoped 本地 commit |

先交付可驗收的視覺階段；第三階段未完成前「只看此區」不作為可用功能釋出。實作 Next.js 變更前閱讀安裝版文件；Mapbox／資料來源 API 依當時官方文件與安裝 SDK types 核對。正常 render 不向市府 GIS 發請求，資料更新是明確的維護步驟。

## 9. 測試與完成標準

### 自動驗證

- 單元：所有既有 place categories 的映射、未知值 fallback、event 優先序、region query round-trip、無效／異城市 ID、幾何洞與 MultiPolygon、邊界點、hover／selected 優先序、reduced motion。
- Integration：區內、區外但在 bbox 內、洞內、邊界、無座標、重複 item、私有／隱藏項目；加入超过候選上限後才出現的區內資料，確認不先截斷再篩選。
- E2E：點区不改結果；按只看此區才改 URL；清除聚焦與清除篩選互不混淆；marker click 不誤選分區；列表 hover 不移鏡頭；Back/Forward；純列表下也能清除 region。
- 失效：邊界載入失敗不影響一般地圖；Mapbox／WebGL 失效時列表與已生效的伺服器篩選仍可用；在語系切換／樣式更新後區界、遮罩、選取不消失。
- 指令：`pnpm lint`、`pnpm typecheck`、受影響 `pnpm exec vitest run ...`、`pnpm test:integration`、相關 `pnpm exec playwright test ...`、`pnpm build`。測試檔名在新增時確定，不以尚不存在的指令聲稱已驗證。
- DB 與 E2E 前驗證有效 `DATABASE_URL` 是可丟棄測試資料庫，並確認測試伺服器設定一致；不可印出憑證、寫入 production 或執行 live extraction 作驗證。

### 視覺與效能

- 1440×900、1024×768、390×844、手機橫向、200% 縮放；英文／繁中、長區名、密集 marker、空結果、多分區接壤處。
- 截圖至少包含：全圖分區、hover 區、聚焦＋遮罩、已篩選列表、marker tooltip、手機聚焦、無地圖備援。
- 檢查文字對比（一般文字目標 4.5:1）、必要圖形邊界（3:1）、色覺差異、鍵盤順序、焦點回復與遮罩下的區外辨識度。
- 初步效能預算：簡化邊界 gzip ≤500KB；超過時先簡化或分級載入。桌面 hover 視覺更新目標 <50ms，切區避免 >100ms 主執行緒長任務；以固定裝置、相同資料量與變更前基準記錄結果，不把預算當成已量測事實。
- 不在 hover 發網路請求、重建 Mapbox instance 或重送完整 marker／邊界資料；各 listener、timer、animation frame 卸載時清理。

完成時回報已交付階段、改動檔案、來源版本、實際測試、截圖與受阻項目。沒有真實底圖或測試 DB 時，明確區分固定 fixture 驗證與未跑的真實整合測試。此計畫不授權部署、push 或 production 資料異動。

## 10. 實作參考

- [Mapbox 官方 feature-state hover 範例](https://docs.mapbox.com/mapbox-gl-js/example/hover-styles/)
- [Mapbox 官方 hover popup 範例](https://docs.mapbox.com/mapbox-gl-js/example/popup-on-hover/)
- [現有地圖設計說明](../design/jade-atlas-map.md)
- [地圖 API 契約](../reference/api.md)

以上外部文件是 API 與資料參考；本文件內的色碼、透明度、時序與效能預算是 LocalLink 的設計提案。
