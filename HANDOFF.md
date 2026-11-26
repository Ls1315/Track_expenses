# 記帳 App 交接摘要

更新日期：2026-11-26

## 目標
自製 iPhone 記帳工具，免費、不上架。解決市售 App 的兩個痛點：記一筆太麻煩、分類／報表不合用。

## 目前狀態：v0.1.0 單機版（已完成）
- 技術：PWA（純 HTML／JS，沒有編譯步驟），資料存在手機的 IndexedDB
- Repo：https://github.com/Ls1315/Track_expenses（public，`main` 分支，commit `c682b16`）
- 功能：自訂數字鍵盤＋點分類即存、4 秒內可復原、常用組合一鍵記、明細編輯／刪除、月報表、分類管理、CSV 匯出匯入
- 測試：只在 Chromium 模擬 iPhone 13 自動測過；**沒有在真的 iPhone 上測過**
- 尚未完成：GitHub Pages 還沒開（Settings → Pages → main / root，要使用者自己在網頁上按）

## 下一階段：v0.2 家庭共用版（還沒開始做）
已決定的事項：
- 後端：Firebase（Firestore＋Authentication，免費 Spark 方案）。選它的理由：網頁版內建離線快取 `persistentLocalCache`
- 登入：Google 帳號
- 可見範圍：**個人帳＋家庭帳分開**。每筆可以選「只有我看得到」或「家庭共用」
- 舊資料：用既有的 CSV 匯出／匯入功能，搬進新版
- 需要設計：建立家庭、邀請家人加入的流程，以及 Firestore 安全規則（非成員讀不到，個人帳只有本人讀得到）

待使用者處理：
- 自己建立 Firebase 專案，把網頁 App 的設定值給 Claude（這些設定值不是機密）
- 開啟 Google 登入，並把 GitHub Pages 網域加進 Firebase 的授權網域

## 其他討論過、暫緩的事
- **載具發票自動匯入**：財政部 API 要申請 AppID 和 APIKey，個人能不能申請**未確認**（可打 0800-521-988 問）。比較低成本的做法是確認電子發票平台能否匯出明細檔案，再寫匯入功能，這也還沒確認。
- **網站加密碼**：純前端做的密碼畫面擋不住人。真的要限制存取可以考慮 Cloudflare Access，但跟 iPhone PWA 是否相容未驗證。

## 已知限制（v0.1）
只記支出、金額只能是整數、沒有跨裝置同步、沒有「午餐 120」這種一句話輸入。

## 檔案索引
| 檔案 | 用途 |
|---|---|
| `index.html` | 畫面結構（記帳／明細／報表／設定 四個分頁＋編輯視窗） |
| `app.js` | 主要邏輯（記帳、明細、報表、分類管理、CSV） |
| `db.js` | IndexedDB 封裝（`tx` 存交易、`meta` 存分類） |
| `style.css` | 樣式（支援深色模式、iPhone 安全區域） |
| `sw.js` | 離線快取（改了檔案要把 `CACHE` 版本號 +1） |
| `manifest.webmanifest` | PWA 設定 |
| `icons/` | App 圖示 |
| `README.md` | 部署與安裝說明 |
| `HANDOFF.md` | 本交接摘要 |
| `CLAUDE.md` | 給 Claude 的專案規則（禁止寫入機密、推送前先確認） |
