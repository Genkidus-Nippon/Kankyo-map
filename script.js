/* =========================================================
   環境世界地図 — script.js
   ① 問い合わせ: /api/contact へPOST（メールアプリを開かない）
   ② リロード維持: URLハッシュで現在の画面を復元
   ③ テーマ検索: 検索欄の語で国クリック時のニュースを絞り込み
   ④ 直リンク: 見出しクリックで記事本文へ直接遷移（検索を経由しない）
   ========================================================= */

/* ====== 設定 ====== */
const CONTACT_ENDPOINT = "/api/contact";  // バックエンド(server.js)
const NEWS_ENDPOINT    = "/api/news";     // バックエンド(server.js)

/* テーマ日本語→英語（バックエンドが無いときのGDELT直叩き用） */
const TOPIC_EN = {
  "環境問題":"environment", "環境":"environment",
  "温暖化":"global warming", "地球温暖化":"global warming", "気候変動":"climate change",
  "再生可能エネルギー":"renewable energy", "再エネ":"renewable energy", "脱炭素":"decarbonization",
  "森林":"deforestation", "森林破壊":"deforestation", "森林伐採":"deforestation",
  "大気汚染":"air pollution", "水質汚染":"water pollution", "汚染":"pollution",
  "海洋プラスチック":"ocean plastic", "プラスチック":"plastic pollution", "ごみ":"waste",
  "干ばつ":"drought", "洪水":"flood", "山火事":"wildfire", "熱波":"heatwave",
  "生物多様性":"biodiversity", "絶滅":"extinction", "海面上昇":"sea level rise",
  "水資源":"water resources", "食料":"food security"
};
function topicToEn(t){ return TOPIC_EN[(t||"").trim()] || (t||"").trim() || "environment"; }

/* ========================================================= */
/* ② ビュー切り替え（ハッシュで復元）                        */
/* ========================================================= */
const views = {
  home:    document.getElementById("view-home"),
  map:     document.getElementById("view-map"),
  about:   document.getElementById("view-about"),
  contact: document.getElementById("view-contact"),
};
let mapReady = false;

function showView(name){
  if (!views[name]) name = "home";
  Object.entries(views).forEach(([k, el]) => { el.hidden = (k !== name); });
  document.body.dataset.view = name;
  closeMenu();

  if (name === "map" && !mapReady) initMap();
  if (name === "home") startSakura(); else stopSakura();

  if (location.hash !== `#${name}`){
    history.replaceState(null, "", `#${name}`);   // 履歴を汚さず現在地を記録
  }
}
window.addEventListener("hashchange", () => {
  showView((location.hash.replace("#","")) || "home");
});

/* ========================================================= */
/* ハンバーガーメニュー                                      */
/* ========================================================= */
const menuBtn = document.getElementById("menuBtn");
const navMenu = document.getElementById("navMenu");
const scrim   = document.getElementById("scrim");

function openMenu(){
  document.body.classList.add("menu-open");
  menuBtn.setAttribute("aria-expanded","true");
  navMenu.setAttribute("aria-hidden","false");
  scrim.hidden = false;
}
function closeMenu(){
  document.body.classList.remove("menu-open");
  menuBtn.setAttribute("aria-expanded","false");
  navMenu.setAttribute("aria-hidden","true");
  scrim.hidden = true;
}
menuBtn.addEventListener("click", () =>
  document.body.classList.contains("menu-open") ? closeMenu() : openMenu()
);
scrim.addEventListener("click", closeMenu);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

/* ========================================================= */
/* 桜アニメーション（トップ画）                              */
/* ========================================================= */
const canvas = document.getElementById("sakura");
const ctx = canvas.getContext("2d");
let petals = [], sakuraRAF = null, sakuraOn = false;

function sizeCanvas(){
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = innerWidth  * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function makePetal(){
  return {
    x: Math.random() * innerWidth,
    y: Math.random() * -innerHeight,
    r: 6 + Math.random() * 8,
    sp: 0.6 + Math.random() * 1.4,
    sway: Math.random() * Math.PI * 2,
    swaySp: 0.01 + Math.random() * 0.03,
    rot: Math.random() * Math.PI,
    rotSp: (Math.random() - 0.5) * 0.04,
    op: 0.5 + Math.random() * 0.5,
  };
}
function drawPetal(p){
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.globalAlpha = p.op;
  const g = ctx.createLinearGradient(-p.r, 0, p.r, 0);
  g.addColorStop(0, "#fbeef1");
  g.addColorStop(1, "#f5cdd8");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -p.r);
  ctx.quadraticCurveTo(p.r * 0.9, -p.r * 0.2, 0, p.r);
  ctx.quadraticCurveTo(-p.r * 0.9, -p.r * 0.2, 0, -p.r);
  ctx.fill();
  ctx.restore();
}
function tick(){
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of petals){
    p.sway += p.swaySp;
    p.x += Math.sin(p.sway) * 0.8;
    p.y += p.sp;
    p.rot += p.rotSp;
    if (p.y - p.r > innerHeight){ Object.assign(p, makePetal(), { y: -10 }); }
    drawPetal(p);
  }
  sakuraRAF = requestAnimationFrame(tick);
}
function startSakura(){
  if (sakuraOn) return;
  sakuraOn = true;
  sizeCanvas();
  const count = Math.min(120, Math.round(innerWidth / 13));
  petals = Array.from({ length: count }, makePetal);
  tick();
}
function stopSakura(){
  sakuraOn = false;
  if (sakuraRAF) cancelAnimationFrame(sakuraRAF);
}
addEventListener("resize", () => { if (sakuraOn) sizeCanvas(); });

/* ========================================================= */
/* 世界地図（D3 + world-atlas）                              */
/* ========================================================= */
const svg = d3.select("#worldMap");
const loading = document.getElementById("mapLoading");
let gRoot, path, projection, geo;

async function initMap(){
  mapReady = true;
  try {
    const topo = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    geo = topojson.feature(topo, topo.objects.countries).features;

    svg.append("rect").attr("class","ocean").attr("width","100%").attr("height","100%");

    const defs = svg.append("defs");
    const f = defs.append("filter").attr("id","lift")
      .attr("x","-40%").attr("y","-40%").attr("width","180%").attr("height","180%");
    f.append("feDropShadow")
      .attr("dx",0).attr("dy",4).attr("stdDeviation",6)
      .attr("flood-color","#06202b").attr("flood-opacity",0.55);

    gRoot = svg.append("g");
    projection = d3.geoNaturalEarth1();
    path = d3.geoPath(projection);

    gRoot.selectAll("path.country")
      .data(geo).enter().append("path")
      .attr("class","country")
      .on("mouseenter", onEnter)
      .on("mouseleave", onLeave)
      .on("dblclick", (e,d) => { e.preventDefault(); openCountryCard(d); });

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
  const usedW = b[1][0] - b[0][0], usedH = b[1][1] - b[0][1];
  const k = Math.max(w / usedW, h / usedH) * 1.02;
  projection.scale(projection.scale() * k);

  b = d3.geoPath(projection).bounds(fc);
  const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
  const [tx, ty] = projection.translate();
  projection.translate([tx + (w / 2 - cx), ty + (h / 2 - cy)]);

  path = d3.geoPath(projection);
  gRoot.selectAll("path.country").attr("d", path);
}

/* ホバーで浮き上がり（1国だけ・確実に戻す） */
let hoveredNode = null;
function liftCountry(node, d){
  const [cx, cy] = path.centroid(d);
  if (!isFinite(cx)) return;
  d3.select(node).raise().classed("is-hover", true)
    .interrupt()
    .transition().duration(200).ease(d3.easeCubicOut)
    .attr("transform", `translate(${cx},${cy}) scale(1.09) translate(${-cx},${-cy})`);
}
function restCountry(node){
  d3.select(node).classed("is-hover", false)
    .interrupt()
    .transition().duration(200).ease(d3.easeCubicOut)
    .attr("transform", "translate(0,0) scale(1)");
}
function onEnter(event, d){
  if (hoveredNode && hoveredNode !== this) restCountry(hoveredNode);
  hoveredNode = this;
  liftCountry(this, d);
}
function onLeave(){
  if (hoveredNode === this) hoveredNode = null;
  restCountry(this);
}
function resetHover(){
  if (hoveredNode){ restCountry(hoveredNode); hoveredNode = null; }
}

/* ========================================================= */
/* ③④ ニュース取得（バックエンド→無ければブラウザから直接）  */
/* ========================================================= */
async function fetchNews(en, ja, topic){
  // 1) 自前バックエンド（APIキーを隠せる・CORS回避）
  try {
    const qs = new URLSearchParams({ country: ja, country_en: en, topic });
    const r = await fetch(`${NEWS_ENDPOINT}?${qs.toString()}`);
    if (r.ok){
      const d = await r.json();
      if (Array.isArray(d.articles) && d.articles.length) return d.articles;
      if (d.reason === "ratelimited"){
        return [{ title:"アクセスが混み合っています。数十秒おいて再度お試しください。（安定させるには GNEWS_KEY の設定がおすすめです）", url:"#" }];
      }
      return [{ title:"このテーマの関連ニュースが見つかりませんでした。テーマを変えて試してください。", url:"#" }];
    }
    return [{ title:"ニュース取得に失敗しました。少し待ってから再度お試しください。", url:"#" }];
  } catch (_) {
    // サーバーに接続できない（index.htmlを直接開いた等）→ ブラウザから直接GDELT
    const arts = await fetchGdeltFromBrowser(en, topic);
    const failed = arts.length === 1 && arts[0].url === "#";
    if (failed){
      return [{ title:"サーバーが起動していません。start（起動アイコン）を実行し、http://localhost:3000 を開いてください。", url:"#" }];
    }
    return arts;
  }
}

async function fetchGdeltFromBrowser(en, topicJa){
  const q = `${en} ${topicToEn(topicJa)}`;
  const url = "https://api.gdeltproject.org/api/v2/doc/doc"
            + `?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=6&sort=datedesc`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [{ title:"ニュースを取得できませんでした。", url:"#" }];
    const d = await r.json();
    const arts = (d.articles || []).map(a => ({
      title: a.title, url: a.url, source: a.domain || "", date: a.seendate || ""
    }));
    return arts.length ? arts : [{ title:"関連するニュースが見つかりませんでした。", url:"#" }];
  } catch (e){
    console.error(e);
    return [{ title:"通信エラーが発生しました。", url:"#" }];
  }
}

/* ========================================================= */
/* ③④ ダブルクリックで国のそばに記事カード                   */
/* ========================================================= */
const cardLayer = document.getElementById("cardLayer");
const searchInput = document.getElementById("topicSearch");
const openCards = new Map();   // id -> {card, feature}
const CARD_W = 300, GAP = 14;

function currentTopic(){ return (searchInput.value || "").trim() || "環境問題"; }

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function headCard(ja, topic){
  return `
    <div class="card-head">
      <div><h2>${escapeHtml(ja)}</h2><span class="sample-tag">テーマ: ${escapeHtml(topic)}</span></div>
      <button class="card-close" aria-label="閉じる">×</button>
    </div>`;
}
function renderArticles(articles){
  return articles.map(a => {
    const src = a.source ? `<span class="news-src">${escapeHtml(a.source)}</span>` : "";
    if (!a.url || a.url === "#"){
      return `<li><span class="news-dead">${escapeHtml(a.title)}</span></li>`;
    }
    // ④ 記事URLへ直接リンク
    return `<li><a href="${encodeURI(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}${src}</a></li>`;
  }).join("");
}

async function loadIntoCard(card, feature){
  const en = feature.properties.name;
  const ja = jaName(en);
  const topic = currentTopic();

  card.innerHTML = headCard(ja, topic) + `<div class="card-loading">ニュースを検索しています…</div>`;
  card.querySelector(".card-close").addEventListener("click", () => closeCard(card._id));

  const articles = await fetchNews(en, ja, topic);
  card.innerHTML = headCard(ja, topic) + `<ul class="news-list">${renderArticles(articles)}</ul>`;
  card.querySelector(".card-close").addEventListener("click", () => closeCard(card._id));
}

async function openCountryCard(feature){
  const en = feature.properties.name;
  const id = "c" + (feature.id || en.replace(/\W/g,""));

  let entry = openCards.get(id);
  if (!entry){
    const card = document.createElement("div");
    card.className = "info-card";
    card._id = id;
    cardLayer.appendChild(card);
    entry = { card, feature };
    openCards.set(id, entry);
    positionCard(card, feature);
    card.style.zIndex = String(30 + openCards.size);
    await loadIntoCard(card, feature);   // ③④ 取得して表示
  } else {
    positionCard(entry.card, feature);
    entry.card.style.zIndex = String(30 + openCards.size);
  }
}

function positionCard(card, feature){
  const b = path.bounds(feature);
  let left = b[1][0] + GAP;
  let top  = b[0][1];
  const cardH = card.offsetHeight || 260;

  if (left + CARD_W > window.innerWidth - 8) left = b[0][0] - CARD_W - GAP; // 右にはみ出すなら左へ
  left = Math.max(8, Math.min(left, window.innerWidth  - CARD_W - 8));
  top  = Math.max(70, Math.min(top,  window.innerHeight - cardH - 8));
  card.style.left = left + "px";
  card.style.top  = top  + "px";
}
function repositionCards(){
  openCards.forEach(({card, feature}) => positionCard(card, feature));
}
function closeCard(id){
  openCards.get(id)?.card.remove();
  openCards.delete(id);
}

/* ③ 検索語を変えてEnter → 開いているカードを新テーマで更新 */
searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter"){
    e.preventDefault();
    openCards.forEach(({card, feature}) => loadIntoCard(card, feature));
  }
});

/* ========================================================= */
/* ① 問い合わせフォーム（バックエンドへ直接送信）             */
/* ========================================================= */
const form = document.getElementById("contactForm");
const note = document.getElementById("formNote");

form.addEventListener("submit", async e => {
  e.preventDefault();
  const data  = new FormData(form);
  const name  = (data.get("name")||"").toString().trim();
  const email = (data.get("email")||"").toString().trim();
  const msg   = (data.get("message")||"").toString().trim();
  note.classList.remove("error");

  if (!name || !email || !msg){
    note.textContent = "すべての項目を入力してください。"; note.classList.add("error"); return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    note.textContent = "メールアドレスの形式をご確認ください。"; note.classList.add("error"); return;
  }

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  note.textContent = "送信しています…";

  try {
    const res = await fetch(CONTACT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, message: msg }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.ok){
      form.reset();
      note.textContent = out.mailed
        ? "お問い合わせを送信しました。ありがとうございます。"
        : "お問い合わせを受け付けました。ありがとうございます。";
    } else {
      note.classList.add("error");
      note.textContent = out.error || "送信に失敗しました。時間をおいて再度お試しください。";
    }
  } catch (err){
    note.classList.add("error");
    note.textContent = "サーバーに接続できませんでした。`npm start` でサーバーを起動し、http://localhost:3000 から開いてください。";
  } finally {
    btn.disabled = false;
  }
});

/* ========================================================= */
/* 国名 英→日 変換（未登録は英語名のまま）                    */
/* ========================================================= */
function jaName(en){ return JA_COUNTRY[en] || en; }
const JA_COUNTRY = {
  "United States of America":"アメリカ合衆国","United States":"アメリカ合衆国",
  "Russia":"ロシア","China":"中国","Japan":"日本","India":"インド",
  "Germany":"ドイツ","France":"フランス","United Kingdom":"イギリス","Italy":"イタリア",
  "Spain":"スペイン","Portugal":"ポルトガル","Netherlands":"オランダ","Belgium":"ベルギー",
  "Switzerland":"スイス","Austria":"オーストリア","Poland":"ポーランド","Ukraine":"ウクライナ",
  "Sweden":"スウェーデン","Norway":"ノルウェー","Finland":"フィンランド","Denmark":"デンマーク",
  "Iceland":"アイスランド","Ireland":"アイルランド","Greece":"ギリシャ","Czechia":"チェコ",
  "Romania":"ルーマニア","Hungary":"ハンガリー","Bulgaria":"ブルガリア","Serbia":"セルビア",
  "Croatia":"クロアチア","Slovakia":"スロバキア","Slovenia":"スロベニア","Belarus":"ベラルーシ",
  "Lithuania":"リトアニア","Latvia":"ラトビア","Estonia":"エストニア","Moldova":"モルドバ",
  "Brazil":"ブラジル","Argentina":"アルゼンチン","Chile":"チリ","Peru":"ペルー",
  "Colombia":"コロンビア","Venezuela":"ベネズエラ","Bolivia":"ボリビア","Ecuador":"エクアドル",
  "Paraguay":"パラグアイ","Uruguay":"ウルグアイ","Mexico":"メキシコ","Cuba":"キューバ",
  "Guatemala":"グアテマラ","Panama":"パナマ","Costa Rica":"コスタリカ",
  "Canada":"カナダ","Greenland":"グリーンランド",
  "Australia":"オーストラリア","New Zealand":"ニュージーランド","Papua New Guinea":"パプアニューギニア",
  "Indonesia":"インドネシア","Malaysia":"マレーシア","Philippines":"フィリピン","Thailand":"タイ",
  "Vietnam":"ベトナム","Myanmar":"ミャンマー","Cambodia":"カンボジア","Laos":"ラオス",
  "South Korea":"韓国","North Korea":"北朝鮮","Mongolia":"モンゴル","Taiwan":"台湾",
  "Pakistan":"パキスタン","Bangladesh":"バングラデシュ","Afghanistan":"アフガニスタン",
  "Nepal":"ネパール","Sri Lanka":"スリランカ","Bhutan":"ブータン",
  "Kazakhstan":"カザフスタン","Uzbekistan":"ウズベキスタン","Turkmenistan":"トルクメニスタン",
  "Kyrgyzstan":"キルギス","Tajikistan":"タジキスタン",
  "Turkey":"トルコ","Iran":"イラン","Iraq":"イラク","Saudi Arabia":"サウジアラビア",
  "United Arab Emirates":"アラブ首長国連邦","Israel":"イスラエル","Jordan":"ヨルダン",
  "Syria":"シリア","Lebanon":"レバノン","Yemen":"イエメン","Oman":"オマーン",
  "Qatar":"カタール","Kuwait":"クウェート","Georgia":"ジョージア","Armenia":"アルメニア",
  "Azerbaijan":"アゼルバイジャン",
  "Egypt":"エジプト","Libya":"リビア","Tunisia":"チュニジア","Algeria":"アルジェリア",
  "Morocco":"モロッコ","Sudan":"スーダン","South Sudan":"南スーダン","Ethiopia":"エチオピア",
  "Somalia":"ソマリア","Kenya":"ケニア","Tanzania":"タンザニア","Uganda":"ウガンダ",
  "Nigeria":"ナイジェリア","Ghana":"ガーナ","Ivory Coast":"コートジボワール",
  "Côte d'Ivoire":"コートジボワール","Cameroon":"カメルーン","Senegal":"セネガル",
  "Mali":"マリ","Niger":"ニジェール","Chad":"チャド","Mauritania":"モーリタニア",
  "Democratic Republic of the Congo":"コンゴ民主共和国","Dem. Rep. Congo":"コンゴ民主共和国",
  "Republic of the Congo":"コンゴ共和国","Congo":"コンゴ共和国","Angola":"アンゴラ",
  "Zambia":"ザンビア","Zimbabwe":"ジンバブエ","Mozambique":"モザンビーク",
  "Madagascar":"マダガスカル","Namibia":"ナミビア","Botswana":"ボツワナ",
  "South Africa":"南アフリカ","Rwanda":"ルワンダ","Burundi":"ブルンジ","Malawi":"マラウイ",
};

/* ========================================================= */
/* 初期化（すべて定義後に実行）                              */
/* ========================================================= */
document.querySelectorAll("[data-go]").forEach(btn =>
  btn.addEventListener("click", () => showView(btn.dataset.go))
);
document.getElementById("enterBtn").addEventListener("click", () => showView("map"));

showView((location.hash.replace("#","")) || "home");   // ② リロード時は現在の画面を復元