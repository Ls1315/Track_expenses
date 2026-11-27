// 線條圖示（自繪 SVG，24×24，筆畫用 currentColor）
// 分類圖示依「分類名稱的關鍵字」自動對應；對應不到的用 tag。新增圖示：在 PATHS 加一筆，再到 CAT_RULES 加關鍵字。

const PATHS = {
  // 分類
  egg: '<path d="M7 10.5A3.8 3.8 0 0 1 8 3h8a3.8 3.8 0 0 1 1 7.5V20H7z"/><circle cx="12" cy="14" r="2.3"/>',
  bowl: '<path d="M3 12h18a9 9 0 0 1-18 0z"/><path d="M8 21h8"/><path d="M14 3l-3.5 7"/><path d="M19 4l-5.5 6"/>',
  cup: '<path d="M6 8h12l-1.4 12.1a1 1 0 0 1-1 .9H8.4a1 1 0 0 1-1-.9z"/><path d="M5 8h14"/><path d="M12 8l2-5h3"/><path d="M6.6 13h10.8"/>',
  cookie: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="10" r="1"/><circle cx="10" cy="15" r="1"/><circle cx="15.5" cy="15" r="1"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16"/><path d="M7 18v3M17 18v3"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/><path d="M9 6h6"/>',
  basket: '<path d="M3 10h18l-2 10H5z"/><path d="M7 10l4-6M17 10l-4-6"/><path d="M9 14v3M12 14v3M15 14v3"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M15 7v10" stroke-dasharray="2 2"/>',
  med: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M9 6V4h6v2"/><path d="M12 10v6M9 13h6"/>',
  house: '<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
  bolt: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  shirt: '<path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c0 2-1.5 3-4 3S8 5 8 3z"/>',
  paw: '<circle cx="6" cy="10" r="1.8"/><circle cx="9.5" cy="5.5" r="1.8"/><circle cx="14.5" cy="5.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M12 11c-3 0-6 4.5-6 7 0 1.7 1.3 2.5 3 2.5 1.2 0 2-.5 3-.5s1.8.5 3 .5c1.7 0 3-.8 3-2.5 0-2.5-3-7-6-7z"/>',
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  plane: '<path d="M10.5 3.5c0-1 .7-1.5 1.5-1.5s1.5.5 1.5 1.5V9l7.5 4.5V16l-7.5-2.5V18l2 1.5V21L12 20l-3.5 1v-1.5l2-1.5v-4.5L3 16v-2.5L10.5 9z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9"/><path d="M12 8v13"/><path d="M12 8c-1.5-4-6-4-6-1.5C6 8 9 8 12 8zM12 8c1.5-4 6-4 6-1.5C18 8 15 8 12 8z"/>',
  heart: '<path d="M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20z"/>',
  car: '<path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2M18 17v2"/><circle cx="7.5" cy="14" r=".8"/><circle cx="16.5" cy="14" r=".8"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.9 2.5 2-1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8M12 16v1.5"/>',
  dots: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  // 介面
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.9 2.9-6 6.5-6s6.5 2.1 6.5 6"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.3c2.4.6 4 2.6 4 5.7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 20h14"/>',
  upload: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 20h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  back: '<path d="M21 6H9l-6 6 6 6h12z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  note: '<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || PATHS.tag}</svg>`;
}

// 依序比對，先符合的先用
const CAT_RULES = [
  ['egg', /早餐|早午餐|蛋/],
  ['cup', /飲料|咖啡|茶|手搖|酒|飲/],
  ['cookie', /零食|點心|甜點|餅乾|宵夜/],
  ['bowl', /午餐|晚餐|餐|飯|食|吃|麵/],
  ['car', /汽車|機車|油|停車|保養/],
  ['bus', /交通|車|捷運|公車|高鐵|計程|uber|悠遊/i],
  ['basket', /日用|生活用品|超市|雜貨|量販/],
  ['shirt', /服|衣|鞋|穿/],
  ['bag', /購物|買|網購/],
  ['ticket', /娛樂|電影|遊戲|門票|休閒|唱歌/],
  ['med', /醫|藥|健康|診|保健|牙/],
  ['house', /房|租|住|居家|家具|貸/],
  ['bolt', /水電|電費|水費|瓦斯|帳單|繳費/],
  ['phone', /電信|手機|網路|通訊|訂閱/],
  ['paw', /寵物|貓|狗/],
  ['book', /教育|書|學|課/],
  ['plane', /旅|遊|機票|住宿/],
  ['gift', /禮|社交|紅包|聚會|請客/],
  ['heart', /美容|保養品|美髮|化妝|孝親|捐/],
  ['dumbbell', /運動|健身|球/],
  ['coin', /保險|稅|投資|手續費|罰/],
  ['dots', /其他|雜項/],
];

export function catIconName(cat) {
  const s = String(cat || '');
  for (const [name, re] of CAT_RULES) if (re.test(s)) return name;
  return 'tag';
}

// 分類底色：暖色系 8 色，依分類名稱固定挑一個（同名分類顏色永遠一樣）
const TINTS = 8;
export function catTint(cat) {
  let h = 0;
  for (const ch of String(cat || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % TINTS;
}

export function catIcon(cat, cls = '') {
  return `<span class="cat-ic t${catTint(cat)} ${cls}">${icon(catIconName(cat))}</span>`;
}
