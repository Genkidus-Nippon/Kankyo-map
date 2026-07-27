/* =========================================================
   作物世界地図 用データ
   各作物ごとに「国名(英・world-atlas準拠) → 生産量(百万トン)」。
   出典: FAOSTAT を基にした概算値（年次は各作物の year）。
   ※あくまで代表的な生産国の概算です。網羅ではありません。
   ========================================================= */

const CROPS = {
  rice: {
    ja: "米（もみ）", unit: "百万トン", year: 2022, source: "FAOSTAT",
    data: {
      "China": 208, "India": 196, "Bangladesh": 57, "Indonesia": 54, "Vietnam": 43,
      "Thailand": 34, "Myanmar": 24, "Philippines": 20, "Pakistan": 14, "Cambodia": 12,
      "Japan": 10, "Brazil": 10, "United States of America": 9, "Nigeria": 8, "Egypt": 5,
      "South Korea": 5, "Nepal": 5, "Sri Lanka": 4, "Madagascar": 4,
    },
  },
  wheat: {
    ja: "小麦", unit: "百万トン", year: 2022, source: "FAOSTAT",
    data: {
      "China": 138, "India": 108, "Russia": 104, "United States of America": 45,
      "Australia": 36, "France": 34, "Canada": 34, "Ukraine": 33, "Pakistan": 27,
      "Germany": 22, "Argentina": 22, "Turkey": 19, "Kazakhstan": 16, "United Kingdom": 14,
      "Poland": 12, "Iran": 12, "Egypt": 9, "Brazil": 9,
    },
  },
  maize: {
    ja: "とうもろこし", unit: "百万トン", year: 2022, source: "FAOSTAT",
    data: {
      "United States of America": 348, "China": 277, "Brazil": 109, "Argentina": 59,
      "India": 33, "Mexico": 27, "Ukraine": 27, "Indonesia": 23, "South Africa": 16,
      "France": 15, "Russia": 15, "Canada": 14, "Nigeria": 12, "Ethiopia": 10,
    },
  },
  soybean: {
    ja: "大豆", unit: "百万トン", year: 2022, source: "FAOSTAT",
    data: {
      "Brazil": 121, "United States of America": 116, "Argentina": 44, "China": 20,
      "India": 13, "Paraguay": 10, "Canada": 7, "Russia": 6, "Ukraine": 4, "Bolivia": 3,
    },
  },
  coffee: {
    ja: "コーヒー（生豆）", unit: "百万トン", year: 2022, source: "FAOSTAT",
    data: {
      "Brazil": 3.17, "Vietnam": 1.95, "Colombia": 0.86, "Indonesia": 0.77,
      "Ethiopia": 0.58, "Honduras": 0.48, "Uganda": 0.38, "Peru": 0.36, "India": 0.33,
      "Mexico": 0.28, "Guatemala": 0.24, "Nicaragua": 0.15, "China": 0.12, "Kenya": 0.05,
    },
  },
  potato: {
    ja: "じゃがいも", unit: "百万トン", year: 2022, source: "FAOSTAT",
    data: {
      "China": 95, "India": 56, "Ukraine": 21, "United States of America": 18, "Russia": 18,
      "Germany": 11, "Bangladesh": 11, "France": 8, "Netherlands": 7, "Poland": 7,
      "Peru": 5, "Canada": 5, "United Kingdom": 5, "Egypt": 5,
    },
  },
};

// 作物名の別名（日本語・英語ゆらぎ）→ 正規キー
const CROP_ALIASES = {
  "米": "rice", "コメ": "rice", "こめ": "rice", "ライス": "rice", "稲": "rice", "rice": "rice",
  "小麦": "wheat", "こむぎ": "wheat", "コムギ": "wheat", "麦": "wheat", "wheat": "wheat",
  "とうもろこし": "maize", "トウモロコシ": "maize", "コーン": "maize", "玉蜀黍": "maize",
  "corn": "maize", "maize": "maize",
  "大豆": "soybean", "だいず": "soybean", "ダイズ": "soybean", "soy": "soybean", "soybean": "soybean",
  "コーヒー": "coffee", "珈琲": "coffee", "coffee": "coffee",
  "じゃがいも": "potato", "ジャガイモ": "potato", "馬鈴薯": "potato", "ポテト": "potato",
  "potato": "potato",
};

function resolveCrop(name){
  if (!name) return null;
  const raw = name.trim();
  const low = raw.toLowerCase();
  if (CROPS[low]) return low;
  return CROP_ALIASES[raw] || CROP_ALIASES[low] || null;
}

function cropList(){ return Object.keys(CROPS).map(k => CROPS[k].ja); }

module.exports = { CROPS, CROP_ALIASES, resolveCrop, cropList };
