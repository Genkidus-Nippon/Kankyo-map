/* =========================================================
   特化型・年代別の代表値データ（1950〜2020, 10年刻み）
   ※厳密な統計ではなく、傾向を示す「代表値モデル」です。
     各国のアンカー値（おおむね2020年相当）に、年代係数tを掛けて算出します。
     t = (year - 1950) / 70  （1950→0, 2020→1）
   ========================================================= */

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

const METRICS = {
  warming: {
    ja: "温暖化（気温上昇）", unit: "℃",
    source: "代表値モデル（IPCC等の傾向に基づく概算）",
    note: "1950年を基準（0）とした平均気温の上昇の概算",
    lowLabel: "小さい", highLabel: "大きい",
    model: (a, t) => +(a * t).toFixed(2),        // 1950=0 → 2020=a
    anchor: {
      "Greenland":3.0,"Russia":2.4,"Canada":2.2,"Mongolia":2.2,"Finland":2.1,"Norway":2.1,
      "Sweden":2.0,"Kazakhstan":1.9,"Ukraine":1.8,"Iceland":1.8,"Poland":1.7,"Germany":1.7,
      "China":1.6,"Japan":1.6,"France":1.6,"Iran":1.6,"Spain":1.6,"Italy":1.6,
      "United Kingdom":1.5,"Australia":1.5,"Turkey":1.5,"Saudi Arabia":1.5,
      "United States of America":1.4,"Algeria":1.4,"Morocco":1.4,"Egypt":1.3,"Mexico":1.3,
      "South Africa":1.2,"Pakistan":1.2,"India":1.0,"Brazil":1.0,"Argentina":1.1,"Chile":1.1,
      "Kenya":1.1,"Nigeria":1.0,"Peru":1.0,"Thailand":1.0,"Vietnam":1.0,"Indonesia":0.9,
    },
  },

  desert: {
    ja: "砂漠化（乾燥地の割合）", unit: "%",
    source: "代表値モデル（UNEP乾燥地区分の傾向に基づく概算）",
    note: "国土に占める乾燥地の割合の概算（年代とともに緩やかに増加）",
    lowLabel: "低い", highLabel: "高い",
    model: (a, t) => Math.min(100, +(a * (1 + 0.06 * t)).toFixed(0)),
    anchor: {
      "Libya":99,"Saudi Arabia":98,"Egypt":96,"Mauritania":95,"Namibia":92,"Somalia":90,
      "Yemen":90,"Jordan":90,"Turkmenistan":90,"Niger":90,"Algeria":85,"Mali":85,"Chad":85,
      "Iran":85,"Botswana":84,"Afghanistan":80,"Sudan":80,"Uzbekistan":80,"Tunisia":75,
      "Iraq":75,"Pakistan":75,"Australia":70,"Morocco":70,"Kazakhstan":66,"Syria":60,
      "Mexico":52,"Kenya":50,"South Africa":50,"Ethiopia":45,"Argentina":40,"India":32,
      "Spain":32,"China":30,"United States of America":30,"Turkey":30,"Mongolia":78,"Russia":15,
    },
  },

  forest: {
    ja: "森林減少（1950年比）", unit: "%",
    source: "代表値モデル（FAO等の傾向に基づく概算）",
    note: "1950年の森林面積からの累積減少率の概算（マイナスは増加＝再植林傾向）",
    lowLabel: "少ない/増加", highLabel: "多い",
    model: (a, t) => +(a * t).toFixed(1),
    anchor: {
      "Ivory Coast":45,"Nigeria":40,"Madagascar":40,"Honduras":30,"Philippines":30,"Ghana":33,
      "Indonesia":26,"Cambodia":26,"Paraguay":25,"Thailand":25,"Guatemala":25,"Malaysia":24,
      "Brazil":22,"Laos":22,"Myanmar":20,"Argentina":20,"Ethiopia":20,"Tanzania":18,
      "Cameroon":18,"Bolivia":15,"Democratic Republic of the Congo":14,"Colombia":12,
      "Mexico":12,"Angola":12,"Papua New Guinea":10,"Peru":9,"India":8,"Australia":6,
      "Russia":3,"Canada":2,"United States of America":2,"Vietnam":-10,"China":-15,
    },
  },

  water: {
    ja: "水不足（水ストレス）", unit: "指数(0-100)",
    source: "代表値モデル（WRI等の傾向に基づく概算）",
    note: "取水量/利用可能水量に基づく水ストレスの概算指数（年代とともに上昇）",
    lowLabel: "低い", highLabel: "高い",
    model: (a, t) => Math.min(100, +(a * (0.7 + 0.3 * t)).toFixed(0)),
    anchor: {
      "Saudi Arabia":95,"United Arab Emirates":95,"Qatar":95,"Kuwait":95,"Egypt":92,"Jordan":92,
      "Yemen":90,"Libya":90,"Turkmenistan":90,"Israel":88,"Uzbekistan":88,"Iran":85,"Pakistan":82,
      "Tunisia":80,"India":80,"Syria":78,"Algeria":78,"Iraq":75,"Morocco":72,"Afghanistan":70,
      "Sudan":68,"China":65,"Spain":62,"South Africa":62,"Turkey":60,"Mexico":60,"Italy":58,
      "Chile":58,"United States of America":55,"Greece":55,"Kazakhstan":55,"Australia":50,
      "Portugal":50,"Ethiopia":45,
    },
  },

  air: {
    ja: "大気汚染（PM2.5）", unit: "µg/m³",
    source: "代表値モデル（WHO/IQAir等の傾向に基づく概算）",
    note: "年平均PM2.5濃度の概算（発展にともなう上昇傾向を反映）",
    lowLabel: "低い", highLabel: "高い",
    model: (a, t) => +(a * (0.55 + 0.45 * t)).toFixed(0),
    anchor: {
      "Bangladesh":65,"Pakistan":60,"India":55,"Nepal":50,"Iraq":50,"Egypt":50,"Nigeria":45,
      "Saudi Arabia":45,"China":40,"Iran":38,"Ghana":38,"Indonesia":35,"Ethiopia":35,"Vietnam":30,
      "Turkey":28,"Thailand":26,"South Africa":25,"South Korea":24,"Kazakhstan":24,"Kenya":22,
      "Mexico":22,"Poland":20,"Ukraine":18,"Russia":16,"Italy":16,"Brazil":14,"France":12,
      "Germany":11,"Spain":11,"Japan":11,"United Kingdom":10,"United States of America":9,
      "Canada":8,"Australia":8,
    },
  },
};

function getTheme(metric, decade){
  const m = METRICS[metric];
  if (!m) return null;
  let year = Number(decade) || 2020;
  if (year < 1950) year = 1950; if (year > 2020) year = 2020;
  const t = (year - 1950) / 70;
  const data = {};
  for (const [c, a] of Object.entries(m.anchor)) data[c] = m.model(a, t);
  const vals = Object.values(data);
  return {
    ok: true, metric, ja: m.ja, unit: m.unit, source: m.source, note: m.note,
    lowLabel: m.lowLabel, highLabel: m.highLabel,
    year, decades: DECADES, data,
    max: Math.max(...vals, 0.0001), min: Math.min(...vals),
  };
}

module.exports = { METRICS, DECADES, getTheme };
