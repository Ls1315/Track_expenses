# Firebase JS SDK（瀏覽器版，13.4.0）

來源：npm 套件 `firebase@13.4.0` 裡的 `firebase-app.js`、`firebase-auth.js`、`firebase-firestore.js`（與官方 CDN 同一份建置）。
授權：Apache-2.0（Google LLC）。

唯一的修改：把 `https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js` 的 import 改成 `./firebase-app.js`，並移除 sourcemap 註解。
放在 repo 裡是為了讓 Service Worker 能一起快取，離線也能開啟 App。

升級方式：`npm pack firebase@<新版本>`，解開後把這三個檔案照上面的方式替換，並把 `sw.js` 的 `CACHE` 版本號 +1。
