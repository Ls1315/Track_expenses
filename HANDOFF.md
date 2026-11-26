# 記帳 App 交接摘要

更新日期：2026-11-26（v0.2 開發）

## 目標
自製 iPhone 記帳工具，免費、不上架。解決市售 App 的兩個痛點：記一筆太麻煩、分類／報表不合用。

## 目前狀態：v0.2.0 家庭共用版（程式完成、已填 Firebase 設定值，**尚未推送、尚未在真機測試**）
- 技術：PWA（純 HTML／JS，沒有編譯步驟）＋ Firebase（Firestore＋Authentication，Spark 免費方案）
- Firebase SDK 13.4.0 放在 `vendor/firebase/`（從 npm 套件複製，讓離線快取能涵蓋）
- 登入：Google（先試彈出視窗，被擋時改整頁跳轉）
- 資料：`users/{uid}`（分類、家庭 id、上次選的帳本）、`users/{uid}/tx`（個人帳）、`families/{fid}`（成員、邀請碼）、`families/{fid}/tx`（家庭帳，記錄是誰記的）、`invites/{code}`
- 已決定（2026-11-26 使用者選擇）：家人用 **8 碼邀請碼**加入；分類**每人各自一份**；記帳時**記住上次選的帳本**
- 權限：個人帳只有本人；家庭帳成員都能讀、改、刪，但不能改「誰記的」；非成員要有正確邀請碼才能加入，且只能加入自己
- 舊資料：v0.1 匯出 CSV → v0.2 匯入（可選個人帳或家庭帳）
- 測試（都在雲端容器用 Firebase 本機模擬器跑，**不是真的 Firebase、不是真的 iPhone**）：
  - 安全規則 35 項（個人帳隔離、非成員讀不到、錯碼／舊碼不能加入、不能冒名、不能踢人）全過
  - 兩個帳號的瀏覽器端到端 27 項（建立／加入／離開家庭、個人帳家人看不到、記住帳本、報表篩選、CSV 匯入、離線記帳、刪除同步）全過
  - 測試腳本沒放進 repo
- 順手修掉 v0.1 的 bug：編輯視窗先按過「儲存」，下次按「刪除」會被當成儲存，把刪掉的紀錄寫回去

## 下一步
1. ~~填入 `firebaseConfig`~~（已完成，專案 `track-expenses-46a33`）；使用者需確認主控台步驟 3～6（Google 登入、授權網域、建立 Firestore、發布 firestore.rules）都已做完
2. 使用者確認後推送到 GitHub，開 GitHub Pages
3. **在真的 iPhone 主畫面 App 測 Google 登入**：iOS 主畫面 App 裡彈出視窗和整頁跳轉登入是否可行**未驗證**；Safari 封鎖第三方儲存可能讓整頁跳轉登入失敗（App 在 github.io、登入頁在 firebaseapp.com 是不同網域）。失敗的話備案：改用 Firebase Hosting 部署（同網域）或其他登入方式

## 其他討論過、暫緩的事
- **載具發票自動匯入**：財政部 API 要申請 AppID 和 APIKey，個人能不能申請**未確認**（可打 0800-521-988 問）。比較低成本的做法是確認電子發票平台能否匯出明細檔案，再寫匯入功能，這也還沒確認。
- **網站加密碼**：純前端做的密碼畫面擋不住人。真的要限制存取可以考慮 Cloudflare Access，但跟 iPhone PWA 是否相容未驗證。

## 已知限制（v0.2）
只記支出、金額只能是整數、沒有「午餐 120」這種一句話輸入；加入家庭要連網；每次開 App 會從雲端讀一次全部紀錄（免費額度每天 5 萬次讀取）；別人記的家庭帳刪除後無法復原。

## 檔案索引
| 檔案 | 用途 |
|---|---|
| `index.html` | 畫面結構（記帳／明細／報表／設定 四個分頁＋編輯視窗） |
| `app.js` | 主要邏輯（登入畫面、記帳、明細、報表、分類、家庭設定、CSV） |
| `store.js` | Firebase 資料層（登入、個人／家庭帳讀寫、建立／加入／離開家庭、邀請碼）。取代 v0.1 的 `db.js`（已刪除） |
| `firebase-config.js` | Firebase 網頁 App 設定值（專案 track-expenses-46a33；非機密） |
| `firestore.rules` | Firestore 安全規則，要貼到 Firebase 主控台發布 |
| `vendor/firebase/` | Firebase JS SDK 13.4.0（app／auth／firestore）與來源、升級說明 |
| `style.css` | 樣式（支援深色模式、iPhone 安全區域） |
| `sw.js` | 離線快取（改了檔案要把 `CACHE` 版本號 +1） |
| `manifest.webmanifest` | PWA 設定 |
| `icons/` | App 圖示 |
| `.nojekyll` | 空檔，讓 GitHub Pages 跳過 Jekyll、照原樣發布檔案 |
| `README.md` | 功能、Firebase 設定步驟、部署與安裝說明 |
| `HANDOFF.md` | 本交接摘要 |
| `CLAUDE.md` | 給 Claude 的專案規則（禁止寫入機密、推送前先確認） |
