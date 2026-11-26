// Firebase 網頁 App 設定值。
// 依 Firebase 官方說明，這些值（apiKey、projectId 等）不是機密，可以放在公開 repo；
// 資料安全由 firestore.rules（Firestore 安全規則）把關。
// 到 Firebase 主控台 → 專案設定 → 一般 → 你的應用程式 → SDK 設定，選「設定（Config）」，
// 把 firebaseConfig 物件整個貼在下面，取代 null。
export const firebaseConfig = {
  apiKey: 'AIzaSyBKSiDZd6d5tKcEuunNiNnrMN3JZNdwoEU',
  authDomain: 'track-expenses-46a33.firebaseapp.com',
  projectId: 'track-expenses-46a33',
  storageBucket: 'track-expenses-46a33.firebasestorage.app',
  messagingSenderId: '587385580992',
  appId: '1:587385580992:web:0f588ce0a894ce9d05ec25',
  measurementId: 'G-W4D91NPPKB', // Analytics 用，本 App 沒載入 Analytics
};
