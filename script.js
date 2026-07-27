/* =========================================================
   I-MAP — script.js
   3つのモード: env(環境) / history(歴史) / crops(作物)
   ========================================================= */

const ENDPOINTS = {
  news:       "/api/news",
  history:    "/api/history",
  crops:      "/api/crops",
  cropDetail: "/api/crop-detail",
  contact:    "/api/contact",
};

const MODES = {
  env: {
    title: "環境世界地図",
    placeholder: "気になるテーマ (例: 温暖化, 再生可能エネルギー)",
    hint: "テーマを入力し、国をダブルクリックすると関連ニュースが開きます。",
    kind: "info", endpoint: ENDPOINTS.news,
  },
  history: {
    title: "歴史世界地図",
    placeholder: "歴史のテーマ (例: 革命, 独立, 産業革命)",
    hint: "テーマを入力し、国をダブルクリックすると関連する歴史情報が開きます。",
    kind: "info", endpoint: ENDPOINTS.history,
  },
  crops: {
    title: "作物世界地図",
    placeholder: "作物名 (例: 米, 小麦, とうもろこし, コーヒー, 大豆, じゃがいも)",
    hint: "作物名を入力して検索。収量で色が変わり、国をダブルクリックで詳細が出ます。",
    kind: "crops", endpoint: ENDPOINTS.crops,
  },
};

const TOPIC_EN = {
  "環境問題":"environment","環境":"environment","温暖化":"global warming","地球温暖化":"global warming",
  "気候変動":"climate change","再生可能エネルギー":"renewable energy","再エネ":"renewable energy",
  "脱炭素":"decarbonization","森林":"deforestation","森林破壊":"deforestation","大気汚染":"air pollution",
  "水質汚染":"water pollution","汚染":"pollution","海洋プラスチック":"ocean plastic","プラスチック":"plastic pollution",
  "ごみ":"waste","干ばつ":"drought","洪水":"flood","山火事":"wildfire","熱波":"heatwave",
  "生物多様性":"biodiversity","絶滅":"extinction","海面上昇":"sea level rise","水資源":"water resources","食料":"food security"
};
function topicToEn(t){ return TOPIC_EN[(t||"").trim()] || (t||"").trim() || "environment"; }

/* ========================================================= */
/* ビュー切替（ハッシュで復元）                              */
/* ========================================================= */
const views = {
  home:    document.getElementById("view-home"),
  map:     document.getElementById("view-map"),
  about:   document.getElementById("view-about"),
  contact: document.getElementById("view-contact"),
};
const MAP_MODES = ["env", "history", "crops"];
let mapReady = false;
let currentMode = "env";

function showView(name){
  const isMap = MAP_MODES.includes(name);
  const viewKey = isMap ? "map" : (views[name] ? name : "home");

  Object.entries(views).forEach(([k, el]) => { el.hidden = (k !== viewKey); });
  document.body.dataset.view = viewKey;
  closeMenu();

  if (isMap){
    currentMode = name;
    if (!mapReady) initMap().then(applyMode); else applyMode();
  }
  if (viewKey === "home") startSakura(); else stopSakura();

  const hash = isMap ? name : viewKey;
  if (location.hash !== `#${hash}`) history.replaceState(null, "", `#${hash}`);
}
window.addEventListener("hashchange", () => {
  const h = location.hash.replace("#", "");
  showView(h || "home");
});

/* 各モードのUI（検索欄・ヒント・地図色）を適用 */
function applyMode(){
  const m = MODES[currentMode];
  searchInput.placeholder = m.placeholder;
  document.getElementById("mapHint").textContent = m.hint;
  updateModeTitle();
  recolorMap();
}
function updateModeTitle(){
  const el = document.getElementById("mapModeTitle");
  const m = MODES[currentMode];
  if (currentMode === "crops" && cropData){
    el.textContent = `${m.title}：${cropData.ja}（${cropData.year}年・出典 ${cropData.source}）`;
  } else {
    el.textContent = m.title;
  }
}

/* ========================================================= */
/* ハンバーガーメニュー                                      */
/* ========================================================= */
const menuBtn = document.getElementById("menuBtn");
const navMenu = document.getElementById("navMenu");
const scrim   = document.getElementById("scrim");
function openMenu(){ document.body.classList.add("menu-open"); menuBtn.setAttribute("aria-expanded","true"); navMenu.setAttribute("aria-hidden","false"); scrim.hidden=false; }
function closeMenu(){ document.body.classList.remove("menu-open"); menuBtn.setAttribute("aria-expanded","false"); navMenu.setAttribute("aria-hidden","true"); scrim.hidden=true; }
menuBtn.addEventListener("click", () => document.body.classList.contains("menu-open") ? closeMenu() : openMenu());
scrim.addEventListener("click", closeMenu);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

/* ========================================================= */
/* 桜アニメーション                                          */
/* ========================================================= */
const canvas = document.getElementById("sakura");
const ctx = canvas.getContext("2d");
let petals = [], sakuraRAF = null, sakuraOn = false;
function sizeCanvas(){ const dpr = window.devicePixelRatio || 1; canvas.width = innerWidth*dpr; canvas.height = innerHeight*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
function makePetal(){ return { x:Math.random()*innerWidth, y:Math.random()*-innerHeight, r:6+Math.random()*8, sp:0.6+Math.random()*1.4, sway:Math.random()*Math.PI*2, swaySp:0.01+Math.random()*0.03, rot:Math.random()*Math.PI, rotSp:(Math.random()-0.5)*0.04, op:0.5+Math.random()*0.5 }; }
function drawPetal(p){ ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.globalAlpha=p.op; const g=ctx.createLinearGradient(-p.r,0,p.r,0); g.addColorStop(0,"#fbeef1"); g.addColorStop(1,"#f5cdd8"); ctx.fillStyle=g; ctx.beginPath(); ctx.moveTo(0,-p.r); ctx.quadraticCurveTo(p.r*0.9,-p.r*0.2,0,p.r); ctx.quadraticCurveTo(-p.r*0.9,-p.r*0.2,0,-p.r); ctx.fill(); ctx.restore(); }
function tick(){ ctx.clearRect(0,0,innerWidth,innerHeight); for(const p of petals){ p.sway+=p.swaySp; p.x+=Math.sin(p.sway)*0.8; p.y+=p.sp; p.rot+=p.rotSp; if(p.y-p.r>innerHeight){ Object.assign(p, makePetal(), {y:-10}); } drawPetal(p); } sakuraRAF=requestAnimationFrame(tick); }
function startSakura(){ if(sakuraOn) return; sakuraOn=true; sizeCanvas(); const n=Math.min(120,Math.round(innerWidth/13)); petals=Array.from({length:n},makePetal); tick(); }
function stopSakura(){ sakuraOn=false; if(sakuraRAF) cancelAnimationFrame(sakuraRAF); }
addEventListener("resize", () => { if (sakuraOn) sizeCanvas(); });

/* ========================================================= */
/* 世界地図（D3）                                            */
/* ========================================================= */
const svg = d3.select("#worldMap");
const loading = document.getElementById("mapLoading");
let gRoot, path, projection, geo, countrySel;
let cropData = null;   // 作物モードの現在データ

async function initMap(){
  mapReady = true;
  try {
    const topo = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    geo = topojson.feature(topo, topo.objects.countries).features;

    svg.append("rect").attr("class","ocean").attr("width","100%").attr("height","100%");
    const defs = svg.append("defs");
    const f = defs.append("filter").attr("id","lift").attr("x","-40%").attr("y","-40%").attr("width","180%").attr("height","180%");
    f.append("feDropShadow").attr("dx",0).attr("dy",4).attr("stdDeviation",6).attr("flood-color","#06202b").attr("flood-opacity",0.55);

    gRoot = svg.append("g");
    projection = d3.geoNaturalEarth1();
    path = d3.geoPath(projection);

    countrySel = gRoot.selectAll("path.country").data(geo).enter().append("path")
      .attr("class","country")
      .on("mouseenter", onEnter).on("mouseleave", onLeave)
      .on("dblclick", (e,d) => { e.preventDefault(); onCountryDblClick(d); });

    svg.on("mouseleave", resetHover);
    fitMap();
    loading.hidden = true;
    addEventListener("resize", () => { fitMap(); repositionCards(); });
  } catch (err){
    loading.textContent = "地図データを読み込めませんでした。インターネット接続をご確認ください。";
    console.error(err);
  }
}

function fitMap(){
  const w = window.innerWidth, h = window.innerHeight;
  svg.attr("width", w).attr("height", h);
  const fc = { type:"FeatureCollection", features: geo };
  projection.fitSize([w, h], fc);
  let b = d3.geoPath(projection).bounds(fc);
  const usedW = b[1][0]-b[0][0], usedH = b[1][1]-b[0][1];
  const k = Math.max(w/usedW, h/usedH) * 1.02;
  projection.scale(projection.scale()*k);
  b = d3.geoPath(projection).bounds(fc);
  const cx=(b[0][0]+b[1][0])/2, cy=(b[0][1]+b[1][1])/2;
  const [tx,ty]=projection.translate();
  projection.translate([tx+(w/2-cx), ty+(h/2-cy)]);
  path = d3.geoPath(projection);
  gRoot.selectAll("path.country").attr("d", path);
}

/* 収量→色（青=少ない → 赤=多い） */
const cropColor = d3.interpolateRgbBasis(["#2c7fb8","#7fcdbb","#fee08b","#f46d43","#d73027"]);
function colorForValue(v, max){ const t = Math.sqrt(Math.max(0,v)/max); return cropColor(Math.min(1,t)); }

function recolorMap(){
  if (!countrySel) return;
  if (currentMode === "crops" && cropData){
    const max = cropData.max || 1;
    countrySel.style("fill", d => {
      const v = cropData.data[d.properties.name];
      return (v == null) ? "var(--nodata)" : colorForValue(v, max);
    });
    showLegend();
  } else {
    countrySel.style("fill", null);   // CSSの緑に戻す
    hideLegend();
  }
}

/* ホバーで浮き上がり */
let hoveredNode = null;
function liftCountry(node, d){ const [cx,cy]=path.centroid(d); if(!isFinite(cx)) return; d3.select(node).raise().classed("is-hover",true).interrupt().transition().duration(200).ease(d3.easeCubicOut).attr("transform",`translate(${cx},${cy}) scale(1.09) translate(${-cx},${-cy})`); }
function restCountry(node){ d3.select(node).classed("is-hover",false).interrupt().transition().duration(200).ease(d3.easeCubicOut).attr("transform","translate(0,0) scale(1)"); }
function onEnter(event,d){ if(hoveredNode && hoveredNode!==this) restCountry(hoveredNode); hoveredNode=this; liftCountry(this,d); }
function onLeave(){ if(hoveredNode===this) hoveredNode=null; restCountry(this); }
function resetHover(){ if(hoveredNode){ restCountry(hoveredNode); hoveredNode=null; } }

function onCountryDblClick(feature){
  if (currentMode === "crops") openCropCard(feature);
  else openInfoCard(feature);
}

/* ========================================================= */
/* 凡例（作物モード）                                         */
/* ========================================================= */
const legendEl = document.getElementById("cropLegend");
function showLegend(){
  if (!cropData) return;
  legendEl.querySelector(".legend-title").textContent = `${cropData.ja}（${cropData.unit}）`;
  legendEl.querySelector(".legend-min").textContent = "少ない";
  legendEl.querySelector(".legend-max").textContent = `多い（最大 ${fmt(cropData.max)}）`;
  legendEl.querySelector(".legend-note").textContent = `${cropData.year}年 / 出典 ${cropData.source} / 灰色は未収録`;
  const bar = legendEl.querySelector(".legend-bar");
  const stops = [0,0.25,0.5,0.75,1].map(t => cropColor(t)).join(",");
  bar.style.background = `linear-gradient(90deg, ${stops})`;
  legendEl.hidden = false;
}
function hideLegend(){ legendEl.hidden = true; }
function fmt(n){ return (n>=1) ? n.toLocaleString("ja-JP") : n; }

/* ========================================================= */
/* 情報カード（env / history 共通）                           */
/* ========================================================= */
const cardLayer = document.getElementById("cardLayer");
const searchInput = document.getElementById("topicSearch");
const openCards = new Map();
const CARD_W = 300, GAP = 14;

function currentTopic(){
  const v = (searchInput.value || "").trim();
  if (v) return v;
  return currentMode === "history" ? "歴史" : "環境問題";
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

function headCard(titleJa, sub){
  return `<div class="card-head"><div><h2>${escapeHtml(titleJa)}</h2><span class="sample-tag">${escapeHtml(sub)}</span></div><button class="card-close" aria-label="閉じる">×</button></div>`;
}
function renderArticles(articles){
  return articles.map(a => {
    const src = a.source ? `<span class="news-src">${escapeHtml(a.source)}</span>` : "";
    const desc = a.desc ? `<span class="news-desc">${escapeHtml(a.desc).slice(0,90)}…</span>` : "";
    if (!a.url || a.url === "#") return `<li><span class="news-dead">${escapeHtml(a.title)}</span></li>`;
    return `<li><a href="${encodeURI(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}${desc}${src}</a></li>`;
  }).join("");
}

async function fetchInfo(en, ja, topic){
  const ep = MODES[currentMode].endpoint;
  try {
    const qs = new URLSearchParams({ country: ja, country_en: en, topic });
    const r = await fetch(`${ep}?${qs.toString()}`);
    if (r.ok){
      const d = await r.json();
      let note = "";
      if (!(d.articles && d.articles.length) && !d.overview){
        note = (d.reason === "error") ? "取得でエラーが発生しました。時間をおいて再度お試しください。"
                                      : "該当する情報が見つかりませんでした。テーマを変えて試してください。";
      }
      return { articles: d.articles || [], overview: d.overview || "", note };
    }
    return { articles:[], overview:"", note:"取得に失敗しました。少し待ってから再度お試しください。" };
  } catch (_) {
    return { articles:[], overview:"", note:"サーバーに接続できません。npm start でサーバーを起動し http://localhost:3000 を開いてください。" };
  }
}

async function loadInfoCard(card, feature){
  const en = feature.properties.name, ja = jaName(en), topic = currentTopic();
  const sub = `${MODES[currentMode].title.replace("世界地図","")}: ${topic}`;
  card.innerHTML = headCard(ja, sub) + `<div class="card-loading">検索しています…</div>`;
  card.querySelector(".card-close").addEventListener("click", () => closeCard(card._id));

  const { articles, overview, note } = await fetchInfo(en, ja, topic);
  let body = "";
  if (overview) body += `<div class="ai-overview"><span class="ai-tag">${currentMode==="history"?"AIによる歴史概説":"AIによる概況"}（参考情報）</span><p>${escapeHtml(overview)}</p></div>`;
  if (articles.length) body += `<ul class="news-list">${renderArticles(articles)}</ul>`;
  if (note) body += `<ul class="news-list"><li><span class="news-dead">${escapeHtml(note)}</span></li></ul>`;
  card.innerHTML = headCard(ja, sub) + body;
  card.querySelector(".card-close").addEventListener("click", () => closeCard(card._id));
}

async function openInfoCard(feature){
  const en = feature.properties.name;
  const id = "c" + (feature.id || en.replace(/\W/g,""));
  let entry = openCards.get(id);
  if (!entry){
    const card = document.createElement("div"); card.className="info-card"; card._id=id;
    cardLayer.appendChild(card); entry={card,feature,kind:"info"}; openCards.set(id, entry);
    positionCard(card, feature); card.style.zIndex=String(30+openCards.size);
    await loadInfoCard(card, feature);
  } else { positionCard(entry.card, feature); entry.card.style.zIndex=String(30+openCards.size); }
}

/* ========================================================= */
/* 作物カード                                                */
/* ========================================================= */
async function openCropCard(feature){
  if (!cropData){
    flashHint("先に作物名を入力して検索してください（例: 米, 小麦, コーヒー）。");
    return;
  }
  const en = feature.properties.name, ja = jaName(en);
  const id = "crop_" + (feature.id || en.replace(/\W/g,""));
  let entry = openCards.get(id);
  if (entry){ positionCard(entry.card, feature); entry.card.style.zIndex=String(30+openCards.size); return; }

  const card = document.createElement("div"); card.className="info-card"; card._id=id;
  cardLayer.appendChild(card); openCards.set(id, {card, feature, kind:"crop"});
  positionCard(card, feature); card.style.zIndex=String(30+openCards.size);

  const localVal = cropData.data[en];
  const sub = `${cropData.ja}（${cropData.year}年）`;
  card.innerHTML = headCard(ja, sub) + `<div class="card-loading">詳細を取得しています…</div>`;
  card.querySelector(".card-close").addEventListener("click", () => closeCard(id));

  let detail = {};
  try {
    const qs = new URLSearchParams({ crop: cropData.crop, country: en, country_ja: ja });
    const r = await fetch(`${ENDPOINTS.cropDetail}?${qs.toString()}`);
    if (r.ok) detail = await r.json();
  } catch (_) {}

  const prod = (detail.production != null) ? detail.production : localVal;
  let body = `<div class="crop-detail">`;
  if (prod != null){
    body += `<div class="crop-stat"><span class="cs-num">${fmt(prod)}</span><span class="cs-unit">${escapeHtml(cropData.unit)}</span></div>`;
    if (detail.rank) body += `<p class="crop-rank">収録国中 第${detail.rank}位 / ${detail.producers}か国中</p>`;
  } else {
    body += `<p class="crop-none">この作物の収録データにこの国は含まれていません。</p>`;
  }
  if (detail.ai) body += `<div class="ai-overview"><span class="ai-tag">AIによる補足（品種・産地など・参考情報）</span><p>${escapeHtml(detail.ai)}</p></div>`;
  body += `<p class="crop-src">出典: ${escapeHtml(cropData.source)}（${cropData.year}年・概算）</p></div>`;
  card.innerHTML = headCard(ja, sub) + body;
  card.querySelector(".card-close").addEventListener("click", () => closeCard(id));
}

/* ========================================================= */
/* カード位置・開閉                                          */
/* ========================================================= */
function positionCard(card, feature){
  const b = path.bounds(feature);
  let left = b[1][0] + GAP, top = b[0][1];
  const cardH = card.offsetHeight || 260;
  if (left + CARD_W > window.innerWidth - 8) left = b[0][0] - CARD_W - GAP;
  left = Math.max(8, Math.min(left, window.innerWidth - CARD_W - 8));
  top  = Math.max(70, Math.min(top,  window.innerHeight - cardH - 8));
  card.style.left = left+"px"; card.style.top = top+"px";
}
function repositionCards(){ openCards.forEach(({card,feature}) => positionCard(card, feature)); }
function closeCard(id){ openCards.get(id)?.card.remove(); openCards.delete(id); }

/* ========================================================= */
/* 検索（Enter / ボタン）                                     */
/* ========================================================= */
const searchBtn = document.getElementById("searchBtn");
function doSearch(){
  if (currentMode === "crops") searchCrop();
  else openCards.forEach(({card, feature, kind}) => { if (kind !== "crop") loadInfoCard(card, feature); });
}
searchInput.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); doSearch(); } });
searchBtn.addEventListener("click", doSearch);

async function searchCrop(){
  const name = (searchInput.value || "").trim();
  if (!name){ flashHint("作物名を入力してください（例: 米, 小麦, とうもろこし）。"); return; }
  try {
    const r = await fetch(`${ENDPOINTS.crops}?crop=${encodeURIComponent(name)}`);
    const d = await r.json();
    if (!d.ok){
      cropData = null; recolorMap(); updateModeTitle();
      flashHint(`「${name}」は未収録です。収録作物: ${(d.available||[]).join("、 ")}`);
      return;
    }
    cropData = d;
    recolorMap(); updateModeTitle();
    flashHint(`${d.ja} の収量で色分けしました。国をダブルクリックで詳細が見られます。`);
  } catch (_){
    flashHint("作物データの取得に失敗しました。サーバーが起動しているか確認してください。");
  }
}

let hintTimer = null;
function flashHint(msg){
  const el = document.getElementById("mapHint");
  el.textContent = msg; el.classList.add("flash");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.classList.remove("flash"); el.textContent = MODES[currentMode].hint; }, 6000);
}

/* ========================================================= */
/* 問い合わせフォーム                                        */
/* ========================================================= */
const form = document.getElementById("contactForm");
const note = document.getElementById("formNote");
form.addEventListener("submit", async e => {
  e.preventDefault();
  const data = new FormData(form);
  const name=(data.get("name")||"").toString().trim(), email=(data.get("email")||"").toString().trim(), msg=(data.get("message")||"").toString().trim();
  note.classList.remove("error");
  if (!name || !email || !msg){ note.textContent="すべての項目を入力してください。"; note.classList.add("error"); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ note.textContent="メールアドレスの形式をご確認ください。"; note.classList.add("error"); return; }
  const btn = form.querySelector('button[type="submit"]'); btn.disabled=true; note.textContent="送信しています…";
  try {
    const res = await fetch(ENDPOINTS.contact, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name,email,message:msg}) });
    const out = await res.json().catch(()=>({}));
    if (res.ok && out.ok){ form.reset(); note.textContent = out.mailed ? "お問い合わせを送信しました。ありがとうございます。" : "お問い合わせを受け付けました（サーバーに保存）。※メール送信は未設定のため配信されていません。"; }
    else { note.classList.add("error"); note.textContent = out.error || "送信に失敗しました。時間をおいて再度お試しください。"; }
  } catch (_){ note.classList.add("error"); note.textContent="サーバーに接続できませんでした。npm start でサーバーを起動してください。"; }
  finally { btn.disabled=false; }
});

/* ========================================================= */
/* 国名 英→日                                                */
/* ========================================================= */
function jaName(en){ return JA_COUNTRY[en] || en; }
const JA_COUNTRY = {
  "United States of America":"アメリカ合衆国","United States":"アメリカ合衆国","Russia":"ロシア","China":"中国","Japan":"日本","India":"インド",
  "Germany":"ドイツ","France":"フランス","United Kingdom":"イギリス","Italy":"イタリア","Spain":"スペイン","Portugal":"ポルトガル",
  "Netherlands":"オランダ","Belgium":"ベルギー","Switzerland":"スイス","Austria":"オーストリア","Poland":"ポーランド","Ukraine":"ウクライナ",
  "Sweden":"スウェーデン","Norway":"ノルウェー","Finland":"フィンランド","Denmark":"デンマーク","Iceland":"アイスランド","Ireland":"アイルランド",
  "Greece":"ギリシャ","Czechia":"チェコ","Romania":"ルーマニア","Hungary":"ハンガリー","Bulgaria":"ブルガリア","Serbia":"セルビア",
  "Croatia":"クロアチア","Slovakia":"スロバキア","Slovenia":"スロベニア","Belarus":"ベラルーシ","Lithuania":"リトアニア","Latvia":"ラトビア",
  "Estonia":"エストニア","Moldova":"モルドバ","Brazil":"ブラジル","Argentina":"アルゼンチン","Chile":"チリ","Peru":"ペルー",
  "Colombia":"コロンビア","Venezuela":"ベネズエラ","Bolivia":"ボリビア","Ecuador":"エクアドル","Paraguay":"パラグアイ","Uruguay":"ウルグアイ",
  "Mexico":"メキシコ","Cuba":"キューバ","Guatemala":"グアテマラ","Panama":"パナマ","Costa Rica":"コスタリカ","Honduras":"ホンジュラス",
  "Nicaragua":"ニカラグア","Canada":"カナダ","Greenland":"グリーンランド","Australia":"オーストラリア","New Zealand":"ニュージーランド",
  "Papua New Guinea":"パプアニューギニア","Indonesia":"インドネシア","Malaysia":"マレーシア","Philippines":"フィリピン","Thailand":"タイ",
  "Vietnam":"ベトナム","Myanmar":"ミャンマー","Cambodia":"カンボジア","Laos":"ラオス","South Korea":"韓国","North Korea":"北朝鮮",
  "Mongolia":"モンゴル","Taiwan":"台湾","Pakistan":"パキスタン","Bangladesh":"バングラデシュ","Afghanistan":"アフガニスタン","Nepal":"ネパール",
  "Sri Lanka":"スリランカ","Bhutan":"ブータン","Kazakhstan":"カザフスタン","Uzbekistan":"ウズベキスタン","Turkmenistan":"トルクメニスタン",
  "Kyrgyzstan":"キルギス","Tajikistan":"タジキスタン","Turkey":"トルコ","Iran":"イラン","Iraq":"イラク","Saudi Arabia":"サウジアラビア",
  "United Arab Emirates":"アラブ首長国連邦","Israel":"イスラエル","Jordan":"ヨルダン","Syria":"シリア","Lebanon":"レバノン","Yemen":"イエメン",
  "Oman":"オマーン","Qatar":"カタール","Kuwait":"クウェート","Georgia":"ジョージア","Armenia":"アルメニア","Azerbaijan":"アゼルバイジャン",
  "Egypt":"エジプト","Libya":"リビア","Tunisia":"チュニジア","Algeria":"アルジェリア","Morocco":"モロッコ","Sudan":"スーダン","South Sudan":"南スーダン",
  "Ethiopia":"エチオピア","Somalia":"ソマリア","Kenya":"ケニア","Tanzania":"タンザニア","Uganda":"ウガンダ","Nigeria":"ナイジェリア",
  "Ghana":"ガーナ","Ivory Coast":"コートジボワール","Côte d'Ivoire":"コートジボワール","Cameroon":"カメルーン","Senegal":"セネガル",
  "Mali":"マリ","Niger":"ニジェール","Chad":"チャド","Mauritania":"モーリタニア","Democratic Republic of the Congo":"コンゴ民主共和国",
  "Dem. Rep. Congo":"コンゴ民主共和国","Republic of the Congo":"コンゴ共和国","Congo":"コンゴ共和国","Angola":"アンゴラ","Zambia":"ザンビア",
  "Zimbabwe":"ジンバブエ","Mozambique":"モザンビーク","Madagascar":"マダガスカル","Namibia":"ナミビア","Botswana":"ボツワナ",
  "South Africa":"南アフリカ","Rwanda":"ルワンダ","Burundi":"ブルンジ","Malawi":"マラウイ",
};

/* ========================================================= */
/* 初期化                                                    */
/* ========================================================= */
document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.go)));
showView((location.hash.replace("#","")) || "home");
