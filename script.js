/* =========================================================
   I-MAP — script.js
   モード: env(環境) / society(現社) / history(歴史) / crops(作物)
   ========================================================= */

const ENDPOINTS = {
  news:"/api/news", history:"/api/history", crops:"/api/crops",
  cropDetail:"/api/crop-detail", theme:"/api/theme", themeDetail:"/api/theme-detail",
  contact:"/api/contact",
};

/* 最終構成: I-Map(記事統合) / 環境(データ) / 作物 / SDGs（＋ユーザー） */
const MODES = {
  imap:    { title:"I-Map", type:"info", endpoint:ENDPOINTS.news,
             hint:"テーマを選び、国をダブルクリックすると関連する記事・情報が開きます。" },
  env:     { title:"環境世界地図", type:"envdata",
             hint:"テーマ（温暖化など）と年代を選ぶと、進行度が色で分かります。国クリックで詳細。" },
  crops:   { title:"作物世界地図", type:"crops", endpoint:ENDPOINTS.crops,
             hint:"作物を選んで表示。収量で色が変わり、国をダブルクリックで詳細が出ます。" },
  sdg:     { title:"SDGs世界地図", type:"sdg",
             hint:"目標と指標を選ぶと、達成状況が色で分かります。国クリックで詳細（定量目標つき）。" },
  user:    { title:"ユーザー世界地図", type:"user",
             hint:"利用者の声が多い国ほど赤。国をダブルクリックで声の一覧が見られます。" },
};
const MAP_MODES = ["imap","env","crops","sdg","user"];
const HOME_MAPS = ["imap","env","crops","sdg"];   // HOMEに並べる4つ

const ENV_METRICS = { "温暖化":"warming","砂漠化":"desert","森林減少":"forest","水不足":"water","大気汚染":"air" };
let currentMetric = null;

/* 選択肢（テーマはこちらで提供） */
const THEMES = {
  imap: ["温暖化","気候変動","森林破壊","大気汚染","海洋プラスチック","生物多様性","水資源","再生可能エネルギー",
         "貧困","難民・移民","紛争・戦争","ジェンダー平等","教育","感染症","食料危機","経済格差","人権","災害","人口問題"],
  env:  ["温暖化","砂漠化","森林減少","水不足","大気汚染"],   // env はメトリクスを選ぶ
};
const CROP_OPTIONS = ["米","小麦","とうもろこし","大豆","コーヒー","じゃがいも"];

const TOPIC_EN = {
  "環境問題":"environment","環境":"environment","温暖化":"global warming","気候変動":"climate change",
  "再生可能エネルギー":"renewable energy","森林破壊":"deforestation","大気汚染":"air pollution",
  "海洋プラスチック":"ocean plastic","干ばつ":"drought","山火事":"wildfire","生物多様性":"biodiversity",
  "水資源":"water resources","貧困":"poverty","難民・移民":"refugees migration","紛争・戦争":"conflict war",
  "ジェンダー平等":"gender equality","教育格差":"education gap","人口問題":"population","感染症":"epidemic",
  "食料危機":"food crisis","経済格差":"inequality","人権":"human rights"
};
function topicToEn(t){ return TOPIC_EN[(t||"").trim()] || (t||"").trim() || "environment"; }

/* ========================================================= */
/* ビュー切替（最初は必ずHOME）                              */
/* ========================================================= */
const views = {
  home:document.getElementById("view-home"), map:document.getElementById("view-map"),
  about:document.getElementById("view-about"), contact:document.getElementById("view-contact"),
  sources:document.getElementById("view-sources"),
};
let mapReady=false, currentMode="env";

function showView(name){
  const isMap = MAP_MODES.includes(name);
  const viewKey = isMap ? "map" : (views[name] ? name : "home");
  Object.entries(views).forEach(([k,el]) => { if(el) el.hidden = (k!==viewKey); });
  document.body.dataset.view = viewKey;
  closeMenu();
  closeAllCards();                 // 画面遷移でカードを閉じる

  if (isMap){
    currentMode = name;
    if (!mapReady) initMap().then(applyMode); else applyMode();
  }
  if (viewKey==="home") startSakura(); else stopSakura();

  const hash = isMap ? name : viewKey;
  if (location.hash !== `#${hash}`) history.replaceState(null,"",`#${hash}`);
}
window.addEventListener("hashchange", () => showView(location.hash.replace("#","")||"home"));

/* モードごとのUIを適用（テーマ選択肢の入替＝検索内容のリセットも兼ねる） */
function applyMode(){
  const m = MODES[currentMode];
  mapSelect.value = currentMode;
  setControls(m.type);
  document.getElementById("mapHint").textContent = m.hint;
  cropData=null; themeData=null; sdgData=null; userData=null; currentMetric=null;
  if (m.type === "envdata"){
    populateThemeSelect();          // メトリクス（温暖化等）を選ぶ
    updateModeTitle(); recolorMap();
  } else if (m.type === "sdg"){
    initSdgControls();
  } else if (m.type === "user"){
    loadUser();
  } else {
    if (m.type === "info" || m.type === "crops") populateThemeSelect();
    updateModeTitle();
    recolorMap();
  }
}
function setControls(type){
  themeSelect.hidden   = !(type==="info" || type==="crops" || type==="envdata");
  applyBtn.hidden      = !(type==="info" || type==="crops");
  decadeControl.hidden = (type!=="envdata");
  goalSelect.hidden     = (type!=="sdg");
  indicatorSelect.hidden= (type!=="sdg");
}
function populateThemeSelect(){
  const isCrop = (currentMode==="crops");
  const opts = isCrop ? CROP_OPTIONS : THEMES[currentMode];
  const ph = isCrop ? "作物を選ぼう" : (currentMode==="env" ? "テーマを選ぼう（温暖化など）" : "テーマを設定しよう");
  themeSelect.innerHTML = `<option value="" disabled selected>${ph}</option>`
    + opts.map(o => `<option value="${o}">${o}</option>`).join("");
}
function updateModeTitle(){
  const el = document.getElementById("mapModeTitle"), m = MODES[currentMode];
  if (currentMode==="crops" && cropData){
    el.textContent = `${m.title}：${cropData.ja}（${cropData.year}年・出典 ${cropData.source}）`;
  } else if (currentMode==="sdg" && sdgData){
    el.textContent = `目標${sdgData.goalId}：${sdgData.goalTitle} ／ ${sdgData.label}`;
  } else if (currentMode==="user"){
    el.textContent = "ユーザー世界地図";
  } else if (currentMode==="env" && themeData){
    el.textContent = `環境世界地図：${themeData.ja}／${themeData.year}年`;
  } else {
    el.textContent = m.title;
  }
}

/* ========================================================= */
/* メニュー                                                  */
/* ========================================================= */
const menuBtn=document.getElementById("menuBtn"), navMenu=document.getElementById("navMenu"), scrim=document.getElementById("scrim");
function openMenu(){ document.body.classList.add("menu-open"); menuBtn.setAttribute("aria-expanded","true"); navMenu.setAttribute("aria-hidden","false"); scrim.hidden=false; }
function closeMenu(){ document.body.classList.remove("menu-open"); menuBtn.setAttribute("aria-expanded","false"); navMenu.setAttribute("aria-hidden","true"); scrim.hidden=true; }
menuBtn.addEventListener("click", ()=> document.body.classList.contains("menu-open")?closeMenu():openMenu());
scrim.addEventListener("click", closeMenu);
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeMenu(); });

/* ========================================================= */
/* 桜アニメーション                                          */
/* ========================================================= */
const canvas=document.getElementById("sakura"), ctx=canvas.getContext("2d");
let petals=[], sakuraRAF=null, sakuraOn=false;
function sizeCanvas(){ const d=window.devicePixelRatio||1; canvas.width=innerWidth*d; canvas.height=innerHeight*d; ctx.setTransform(d,0,0,d,0,0); }
function makePetal(){ return {x:Math.random()*innerWidth,y:Math.random()*-innerHeight,r:6+Math.random()*8,sp:0.6+Math.random()*1.4,sway:Math.random()*Math.PI*2,swaySp:0.01+Math.random()*0.03,rot:Math.random()*Math.PI,rotSp:(Math.random()-0.5)*0.04,op:0.5+Math.random()*0.5}; }
function drawPetal(p){ ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.globalAlpha=p.op; const g=ctx.createLinearGradient(-p.r,0,p.r,0); g.addColorStop(0,"#f9c3d6"); g.addColorStop(1,"#f08bb0"); ctx.fillStyle=g; ctx.beginPath(); ctx.moveTo(0,-p.r); ctx.quadraticCurveTo(p.r*0.9,-p.r*0.2,0,p.r); ctx.quadraticCurveTo(-p.r*0.9,-p.r*0.2,0,-p.r); ctx.fill(); ctx.restore(); }
function tick(){ ctx.clearRect(0,0,innerWidth,innerHeight); for(const p of petals){ p.sway+=p.swaySp; p.x+=Math.sin(p.sway)*0.8; p.y+=p.sp; p.rot+=p.rotSp; if(p.y-p.r>innerHeight){ Object.assign(p,makePetal(),{y:-10}); } drawPetal(p); } sakuraRAF=requestAnimationFrame(tick); }
function startSakura(){ if(sakuraOn) return; sakuraOn=true; sizeCanvas(); const n=Math.min(120,Math.round(innerWidth/13)); petals=Array.from({length:n},makePetal); tick(); }
function stopSakura(){ sakuraOn=false; if(sakuraRAF) cancelAnimationFrame(sakuraRAF); }
addEventListener("resize", ()=>{ if(sakuraOn) sizeCanvas(); });

/* ========================================================= */
/* 世界地図                                                  */
/* ========================================================= */
const svg=d3.select("#worldMap"), loading=document.getElementById("mapLoading");
let gRoot,path,projection,geo,countrySel;
let cropData=null;     // 作物モードのデータ
let themeData=null;    // 特化型モードのデータ
let sdgData=null;      // SDGsモードのデータ
let userData=null;     // ユーザーモードのデータ
function activeChoro(){
  if (currentMode==="crops") return cropData;
  if (currentMode==="sdg") return sdgData;
  if (currentMode==="user") return userData;
  if (MODES[currentMode].type==="envdata") return themeData;
  return null;
}

async function initMap(){
  mapReady=true;
  try{
    const topo=await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    geo=topojson.feature(topo,topo.objects.countries).features;
    svg.append("rect").attr("class","ocean").attr("width","100%").attr("height","100%");
    const defs=svg.append("defs");
    const f=defs.append("filter").attr("id","lift").attr("x","-40%").attr("y","-40%").attr("width","180%").attr("height","180%");
    f.append("feDropShadow").attr("dx",0).attr("dy",4).attr("stdDeviation",6).attr("flood-color","#06202b").attr("flood-opacity",0.55);
    gRoot=svg.append("g");
    projection=d3.geoNaturalEarth1(); path=d3.geoPath(projection);
    countrySel=gRoot.selectAll("path.country").data(geo).enter().append("path")
      .attr("class","country").on("mouseenter",onEnter).on("mouseleave",onLeave)
      .on("dblclick",(e,d)=>{ e.preventDefault(); onCountryDblClick(d); });
    svg.on("mouseleave",resetHover);
    fitMap(); loading.hidden=true;
    addEventListener("resize", ()=>{ fitMap(); repositionCards(); });
  }catch(err){ loading.textContent="地図データを読み込めませんでした。インターネット接続をご確認ください。"; console.error(err); }
}
function fitMap(){
  const w=innerWidth,h=innerHeight; svg.attr("width",w).attr("height",h);
  const fc={type:"FeatureCollection",features:geo};
  projection.fitSize([w,h],fc);
  let b=d3.geoPath(projection).bounds(fc);
  const k=Math.max(w/(b[1][0]-b[0][0]),h/(b[1][1]-b[0][1]))*1.02;
  projection.scale(projection.scale()*k);
  b=d3.geoPath(projection).bounds(fc);
  const cx=(b[0][0]+b[1][0])/2, cy=(b[0][1]+b[1][1])/2, [tx,ty]=projection.translate();
  projection.translate([tx+(w/2-cx),ty+(h/2-cy)]);
  path=d3.geoPath(projection); gRoot.selectAll("path.country").attr("d",path);
}

/* 収量→色（青=少 → 赤=多） */
const cropColor=d3.interpolateRgbBasis(["#2c7fb8","#7fcdbb","#fee08b","#f46d43","#d73027"]);
function colorForValue(v,max){ return cropColor(Math.min(1,Math.sqrt(Math.max(0,v)/max))); }
function recolorMap(){
  if(!countrySel) return;
  const dd = activeChoro();
  if(dd){
    if(dd.scoreData){                          // SDGs: 良好=青, 課題大=赤（0..1のスコア）
      countrySel.style("fill", d=>{ const s=dd.scoreData[d.properties.name]; return s==null?"var(--nodata)":cropColor(s); });
    } else {
      const max = dd.colorMax || dd.max || 1;   // 特化型は固定スケール
      countrySel.style("fill", d=>{ const v=dd.data[d.properties.name]; return v==null?"var(--nodata)":colorForValue(v,max); });
    }
    showLegend();
  }else{
    countrySel.style("fill",null); hideLegend();
  }
}

/* ホバー */
let hoveredNode=null;
function liftCountry(node,d){ const [cx,cy]=path.centroid(d); if(!isFinite(cx)) return; d3.select(node).raise().classed("is-hover",true).interrupt().transition().duration(200).ease(d3.easeCubicOut).attr("transform",`translate(${cx},${cy}) scale(1.09) translate(${-cx},${-cy})`); }
function restCountry(node){ d3.select(node).classed("is-hover",false).interrupt().transition().duration(200).ease(d3.easeCubicOut).attr("transform","translate(0,0) scale(1)"); }
function onEnter(event,d){ if(hoveredNode&&hoveredNode!==this) restCountry(hoveredNode); hoveredNode=this; liftCountry(this,d); }
function onLeave(){ if(hoveredNode===this) hoveredNode=null; restCountry(this); }
function resetHover(){ if(hoveredNode){ restCountry(hoveredNode); hoveredNode=null; } }
function onCountryDblClick(feature){
  const type = MODES[currentMode].type;
  if (type==="crops") openCropCard(feature);
  else if (type==="envdata") openThemeCard(feature);
  else if (type==="sdg") openSdgCard(feature);
  else if (type==="user") openUserCard(feature);
  else openInfoCard(feature);
}

/* ========================================================= */
/* 凡例                                                      */
/* ========================================================= */
const legendEl=document.getElementById("cropLegend");
function showLegend(){
  const dd = activeChoro(); if(!dd) return;
  const lowL = dd.lowLabel || "少ない", highL = dd.highLabel || "多い";
  const scaleTop = dd.colorMax || dd.max;   // 赤端は固定スケール基準（年代で変えない）
  legendEl.querySelector(".legend-title").textContent=`${dd.label||dd.ja}（${dd.unit}）`;
  legendEl.querySelector(".legend-min").textContent=lowL;
  legendEl.querySelector(".legend-max").textContent=`${highL}（基準 ${fmt(scaleTop)}）`;
  const noteSrc = dd.note ? `${dd.note} / ` : "";
  const yearTxt = dd.year ? `${dd.year}年 / ` : "";
  legendEl.querySelector(".legend-note").textContent=`${noteSrc}${yearTxt}出典 ${dd.source} / 灰色は未収録`;
  legendEl.querySelector(".legend-bar").style.background=`linear-gradient(90deg, ${[0,.25,.5,.75,1].map(t=>cropColor(t)).join(",")})`;
  legendEl.hidden=false;
}
function hideLegend(){ legendEl.hidden=true; }
function fmt(n){ return (n>=1)?n.toLocaleString("ja-JP"):n; }

/* ========================================================= */
/* カード（1国のみ同時表示・画面外に出さない）               */
/* ========================================================= */
const cardLayer=document.getElementById("cardLayer");
const openCards=new Map();
const CARD_W=300, GAP=14;
function currentTopic(){ return (themeSelect.value||"").trim(); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function closeAllCards(){ openCards.forEach(({card})=>card.remove()); openCards.clear(); }

function headCard(titleJa,sub){ return `<div class="card-head"><div><h2>${escapeHtml(titleJa)}</h2><span class="sample-tag">${escapeHtml(sub)}</span></div><button class="card-close" aria-label="閉じる">×</button></div>`; }
function renderArticles(articles, visible=8){
  return articles.map((a,i)=>{
    const hid = i>=visible ? " hidden" : "";
    const src=a.source?`<span class="news-src">${escapeHtml(a.source)}</span>`:"";
    const desc=a.desc?`<span class="news-desc">${escapeHtml(a.desc).slice(0,90)}…</span>`:"";
    if(!a.url||a.url==="#") return `<li${hid}><span class="news-dead">${escapeHtml(a.title)}</span></li>`;
    return `<li${hid}><a href="${encodeURI(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}${desc}${src}</a></li>`;
  }).join("");
}
function bindMore(card){
  const btn=card.querySelector("[data-more]");
  if(!btn) return;
  btn.addEventListener("click", ()=>{
    card.querySelectorAll(".news-list li[hidden]").forEach(li=>li.removeAttribute("hidden"));
    btn.remove();
    requestAnimationFrame(()=>{ const e=openCards.get(card._id); if(e) positionCard(card,e.feature); });
  });
}
function bindSrcLink(card){
  card.querySelectorAll(".src-link[data-go]").forEach(a=>{
    a.addEventListener("click", e=>{ e.preventDefault(); showView("sources"); });
  });
}
async function fetchInfo(en,ja,topic){
  const ep=MODES[currentMode].endpoint;
  try{
    const qs=new URLSearchParams({country:ja,country_en:en,topic});
    const r=await fetch(`${ep}?${qs.toString()}`);
    if(r.ok){
      const d=await r.json(); let note="";
      if(!(d.articles&&d.articles.length)&&!d.overview) note=(d.reason==="error")?"取得でエラーが発生しました。時間をおいて再度お試しください。":"該当する情報が見つかりませんでした。別のテーマもお試しください。";
      return { articles:d.articles||[], overview:d.overview||"", note };
    }
    return { articles:[], overview:"", note:"取得に失敗しました。少し待ってから再度お試しください。" };
  }catch(_){ return { articles:[], overview:"", note:"サーバーに接続できません。npm start でサーバーを起動し http://localhost:3000 を開いてください。" }; }
}
async function loadInfoCard(card,feature){
  const en=feature.properties.name, ja=jaName(en), topic=currentTopic();
  const sub=`${MODES[currentMode].title.replace("世界地図","")}: ${topic}`;
  card.innerHTML=headCard(ja,sub)+`<div class="card-loading">検索しています…</div>`;
  bindClose(card);
  const {articles,overview,note}=await fetchInfo(en,ja,topic);
  let body="";
  if(overview) body+=`<div class="ai-overview"><span class="ai-tag">${currentMode==="history"?"AIによる歴史概説":"AIによる概況"}（参考情報）</span><p>${escapeHtml(overview)}</p></div>`;
  if(articles.length){
    body+=`<ul class="news-list">${renderArticles(articles)}</ul>`;
    if(articles.length>8) body+=`<button class="more-btn" data-more>もっと見る（残り${articles.length-8}件）</button>`;
  }
  if(note) body+=`<ul class="news-list"><li><span class="news-dead">${escapeHtml(note)}</span></li></ul>`;
  card.innerHTML=headCard(ja,sub)+body;
  bindClose(card); bindMore(card);
  requestAnimationFrame(()=>positionCard(card,feature));  // 内容確定後に位置を再計算（画面外防止）
}
function bindClose(card){ card.querySelector(".card-close").addEventListener("click",()=>closeCard(card._id)); }

async function openInfoCard(feature){
  if(!currentTopic()){ flashHint("上のプルダウンからテーマを選んでください。"); return; }
  closeAllCards();                                   // 同時表示は1国のみ
  const en=feature.properties.name, id="c"+(feature.id||en.replace(/\W/g,""));
  const card=document.createElement("div"); card.className="info-card"; card._id=id;
  cardLayer.appendChild(card); openCards.set(id,{card,feature,kind:"info"});
  positionCard(card,feature); card.style.zIndex="40";
  await loadInfoCard(card,feature);
}

async function openCropCard(feature){
  if(!cropData){ flashHint("先に作物を選んで「表示」してください（例: 米, 小麦, コーヒー）。"); return; }
  closeAllCards();
  const en=feature.properties.name, ja=jaName(en), id="crop_"+(feature.id||en.replace(/\W/g,""));
  const card=document.createElement("div"); card.className="info-card"; card._id=id;
  cardLayer.appendChild(card); openCards.set(id,{card,feature,kind:"crop"});
  positionCard(card,feature); card.style.zIndex="40";
  const sub=`${cropData.ja}（${cropData.year}年）`;
  card.innerHTML=headCard(ja,sub)+`<div class="card-loading">詳細を取得しています…</div>`;
  bindClose(card);
  let detail={};
  try{ const qs=new URLSearchParams({crop:cropData.crop,country:en,country_ja:ja}); const r=await fetch(`${ENDPOINTS.cropDetail}?${qs.toString()}`); if(r.ok) detail=await r.json(); }catch(_){}
  const prod=(detail.production!=null)?detail.production:cropData.data[en];
  let body=`<div class="crop-detail">`;
  if(prod!=null){ body+=`<div class="crop-stat"><span class="cs-num">${fmt(prod)}</span><span class="cs-unit">${escapeHtml(cropData.unit)}</span></div>`; if(detail.rank) body+=`<p class="crop-rank">収録国中 第${detail.rank}位 / ${detail.producers}か国中</p>`; }
  else body+=`<p class="crop-none">この作物の収録データにこの国は含まれていません。</p>`;
  if(detail.ai) body+=`<div class="ai-overview"><span class="ai-tag">AIによる補足（品種・産地など・参考情報）</span><p>${escapeHtml(detail.ai)}</p></div>`;
  body+=`<p class="crop-src">${cropData.year}年・概算 <a href="#sources" class="src-link" data-go="sources">出典</a></p></div>`;
  card.innerHTML=headCard(ja,sub)+body; bindClose(card); bindSrcLink(card);
  requestAnimationFrame(()=>positionCard(card,feature));
}

/* 特化型（温暖化等）のクリック詳細 */
async function openThemeCard(feature){
  if(!themeData){ flashHint("テーマ（温暖化など）を選んでください。"); return; }
  closeAllCards();
  const en=feature.properties.name, ja=jaName(en), id="theme_"+(feature.id||en.replace(/\W/g,""));
  const card=document.createElement("div"); card.className="info-card"; card._id=id;
  cardLayer.appendChild(card); openCards.set(id,{card,feature,kind:"theme"});
  positionCard(card,feature); card.style.zIndex="40";
  const sub=`${themeData.ja}／${themeData.year}年`;
  card.innerHTML=headCard(ja,sub)+`<div class="card-loading">詳細を取得しています…</div>`;
  bindClose(card);

  let detail={};
  try{
    const qs=new URLSearchParams({ metric:currentMetric, decade:themeData.year, country:en, country_ja:ja });
    const r=await fetch(`${ENDPOINTS.themeDetail}?${qs.toString()}`);
    if(r.ok) detail=await r.json();
  }catch(_){}

  const val=(detail.value!=null)?detail.value:themeData.data[en];
  let body=`<div class="crop-detail">`;
  if(val!=null){
    body+=`<div class="crop-stat"><span class="cs-num">${fmt(val)}</span><span class="cs-unit">${escapeHtml(themeData.unit)}</span></div>`;
    if(val<0) body+=`<p class="crop-rank">（マイナスは増加＝改善傾向）</p>`;
    if(detail.rank) body+=`<p class="crop-rank">収録国中 第${detail.rank}位 / ${detail.producers}か国中（${themeData.year}年）</p>`;
  }else{
    body+=`<p class="crop-none">この指標の収録データにこの国は含まれていません。</p>`;
  }
  if(detail.ai) body+=`<div class="ai-overview"><span class="ai-tag">AIによる補足（参考情報）</span><p>${escapeHtml(detail.ai)}</p></div>`;
  body+=`<p class="crop-src">${escapeHtml(themeData.note||"")} <a href="#sources" class="src-link" data-go="sources">出典</a></p></div>`;
  card.innerHTML=headCard(ja,sub)+body; bindClose(card); bindSrcLink(card);
  requestAnimationFrame(()=>positionCard(card,feature));
}

async function loadUser(){
  try{
    const r=await fetch("/api/user"); const d=await r.json();
    if(!d.ok){ flashHint("ユーザーデータの取得に失敗しました。"); return; }
    userData=d; recolorMap(); updateModeTitle();
  }catch(_){ flashHint("サーバーに接続できません。npm start で起動してください。"); }
}
async function openUserCard(feature){
  if(!userData){ flashHint("データを読み込み中です。"); return; }
  closeAllCards();
  const en=feature.properties.name, ja=jaName(en), id="user_"+(feature.id||en.replace(/\W/g,""));
  const msgs=(userData.messages&&userData.messages[en])||[];
  const card=document.createElement("div"); card.className="info-card"; card._id=id;
  cardLayer.appendChild(card); openCards.set(id,{card,feature,kind:"user"});
  positionCard(card,feature); card.style.zIndex="40";
  const sub=`利用者の声 ${msgs.length}件`;
  let body="";
  if(msgs.length){
    body=`<ul class="news-list">`+msgs.map(m=>`<li><span class="news-dead">${escapeHtml(m)}</span></li>`).join("")+`</ul>`;
  }else{
    body=`<p class="crop-none" style="padding:14px">この国にはまだ声が登録されていません。</p>`;
  }
  card.innerHTML=headCard(ja,sub)+body; bindClose(card);
  requestAnimationFrame(()=>positionCard(card,feature));
}

async function loadTheme(metric, decade){
  try{
    const r=await fetch(`${ENDPOINTS.theme}?metric=${metric}&decade=${decade}`);
    const d=await r.json();
    if(!d.ok){ flashHint("データの取得に失敗しました。"); return; }
    themeData=d; decadeLabel.textContent=`${d.year}年`;
    recolorMap(); updateModeTitle();
  }catch(_){ flashHint("サーバーに接続できません。npm start で起動してください。"); }
}

/* 画面外に出さない位置決め（内容の高さを測って上下左右をクランプ） */
function positionCard(card,feature){
  const b=path.bounds(feature);
  const cardH=card.offsetHeight||260, cardW=card.offsetWidth||CARD_W;
  let left=b[1][0]+GAP, top=b[0][1];
  if(left+cardW>innerWidth-8) left=b[0][0]-cardW-GAP;   // 右にはみ出すなら左へ
  left=Math.max(8, Math.min(left, innerWidth-cardW-8));
  top =Math.max(70, Math.min(top,  innerHeight-cardH-8));
  card.style.left=left+"px"; card.style.top=top+"px";
}
function repositionCards(){ openCards.forEach(({card,feature})=>positionCard(card,feature)); }
function closeCard(id){ openCards.get(id)?.card.remove(); openCards.delete(id); }

/* ========================================================= */
/* 地図・テーマの選択とモーション                            */
/* ========================================================= */
const mapSelect=document.getElementById("mapSelect");
const themeSelect=document.getElementById("themeSelect");
const applyBtn=document.getElementById("applyBtn");
const toastEl=document.getElementById("mapToast");
const pulseEl=document.getElementById("mapPulse");
const decadeControl=document.getElementById("decadeControl");
const decadeSlider=document.getElementById("decadeSlider");
const decadeLabel=document.getElementById("decadeLabel");
const goalSelect=document.getElementById("goalSelect");
const indicatorSelect=document.getElementById("indicatorSelect");
let sdgGoals=null;   // 目標メタ（一度だけ取得）

async function initSdgControls(){
  if(!sdgGoals){
    try{ const r=await fetch("/api/sdg/goals"); const d=await r.json(); sdgGoals=d.goals||[]; }
    catch(_){ flashHint("SDGsデータの取得に失敗しました。サーバー起動を確認してください。"); return; }
  }
  goalSelect.innerHTML=sdgGoals.map(g=>`<option value="${g.id}">${g.id}. ${g.title}</option>`).join("");
  goalSelect.selectedIndex=0;
  populateIndicatorSelect();
  loadSdg();
}
function populateIndicatorSelect(){
  const g=sdgGoals.find(x=>String(x.id)===goalSelect.value)||sdgGoals[0];
  indicatorSelect.innerHTML=g.indicators.map(i=>`<option value="${i.key}">${i.label}</option>`).join("");
  indicatorSelect.selectedIndex=0;
  indicatorSelect.hidden = (g.indicators.length<=1) ? false : false; // 常に表示（1つでも見せる）
}
async function loadSdg(){
  playPulse(); closeAllCards();
  try{
    const r=await fetch(`/api/sdg?goal=${goalSelect.value}&indicator=${indicatorSelect.value}`);
    const d=await r.json();
    if(!d.ok){ flashHint("指標データが見つかりませんでした。"); return; }
    sdgData=d; recolorMap(); updateModeTitle();
    showToast(`目標${d.goalId}「${d.label}」で表示中`);
  }catch(_){ flashHint("サーバーに接続できません。"); }
}
goalSelect.addEventListener("change", ()=>{ populateIndicatorSelect(); loadSdg(); });
indicatorSelect.addEventListener("change", loadSdg);

async function openSdgCard(feature){
  if(!sdgData){ flashHint("目標と指標を選んでください。"); return; }
  closeAllCards();
  const en=feature.properties.name, ja=jaName(en), id="sdg_"+(feature.id||en.replace(/\W/g,""));
  const card=document.createElement("div"); card.className="info-card"; card._id=id;
  cardLayer.appendChild(card); openCards.set(id,{card,feature,kind:"sdg"});
  positionCard(card,feature); card.style.zIndex="40";
  const sub=`目標${sdgData.goalId} / ${sdgData.label}`;
  card.innerHTML=headCard(ja,sub)+`<div class="card-loading">詳細を取得しています…</div>`; bindClose(card);
  let detail={};
  try{ const qs=new URLSearchParams({goal:sdgData.goalId,indicator:sdgData.key,country:en,country_ja:ja}); const r=await fetch(`/api/sdg-detail?${qs.toString()}`); if(r.ok) detail=await r.json(); }catch(_){}
  const val=(detail.value!=null)?detail.value:sdgData.data[en];
  let body=`<div class="crop-detail">`;
  if(val!=null){
    body+=`<div class="crop-stat"><span class="cs-num">${fmt(val)}</span><span class="cs-unit">${escapeHtml(sdgData.unit)}</span></div>`;
    if(detail.rank) body+=`<p class="crop-rank">${sdgData.higherIsBetter?"良い順":"課題が小さい順"}で 第${detail.rank}位 / ${detail.producers}か国中</p>`;
  }else body+=`<p class="crop-none">この指標の収録データにこの国は含まれていません。</p>`;
  if(sdgData.target){ body+=`<p class="sdg-target">🎯 SDGs定量目標：${escapeHtml(sdgData.target)}</p>`; }
  if(detail.ai) body+=`<div class="ai-overview"><span class="ai-tag">AIによる補足（参考情報）</span><p>${escapeHtml(detail.ai)}</p></div>`;
  body+=`<p class="crop-src">${escapeHtml(sdgData.goalTitle)} <a href="#sources" class="src-link" data-go="sources">出典</a></p></div>`;
  card.innerHTML=headCard(ja,sub)+body; bindClose(card); bindSrcLink(card);
  requestAnimationFrame(()=>positionCard(card,feature));
}

// 地図選択プルダウンを一度だけ構築
mapSelect.innerHTML=MAP_MODES.map(m=>`<option value="${m}">${MODES[m].title}</option>`).join("");
mapSelect.addEventListener("change", ()=> showView(mapSelect.value));

// 年代スライダー（特化型マップ）
decadeSlider.addEventListener("input", ()=>{
  decadeLabel.textContent=`${decadeSlider.value}年`;
});
decadeSlider.addEventListener("change", ()=>{
  if(currentMode==="env" && currentMetric){
    playPulse(); closeAllCards();
    loadTheme(currentMetric, +decadeSlider.value);
    showToast(`${decadeSlider.value}年で表示中`);
  }
});

function applyTheme(){
  const val=themeSelect.value;
  if(!val){ flashHint(currentMode==="crops"?"作物を選んでください。":"テーマを選んでください。"); return; }
  playPulse();
  if(currentMode==="crops"){ searchCrop(val); }
  else if(currentMode==="env"){
    currentMetric = ENV_METRICS[val] || "warming";
    loadTheme(currentMetric, +decadeSlider.value);
    showToast(`「${val}」で表示中`);
  }
  else{
    showToast(`「${val}」で表示中`);
    openCards.forEach(({card,feature,kind})=>{ if(kind!=="crop") loadInfoCard(card,feature); });
  }
}
applyBtn.addEventListener("click", applyTheme);
themeSelect.addEventListener("change", applyTheme);

function playPulse(){
  pulseEl.classList.remove("go"); void pulseEl.offsetWidth; pulseEl.classList.add("go");
}
let toastTimer=null;
function showToast(msg){
  toastEl.textContent=msg; toastEl.hidden=false; toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{ toastEl.classList.remove("show"); setTimeout(()=>toastEl.hidden=true,300); }, 2400);
}
let hintTimer=null;
function flashHint(msg){
  const el=document.getElementById("mapHint"); el.textContent=msg; el.classList.add("flash");
  clearTimeout(hintTimer); hintTimer=setTimeout(()=>{ el.classList.remove("flash"); el.textContent=MODES[currentMode].hint; },6000);
}

async function searchCrop(name){
  try{
    const r=await fetch(`${ENDPOINTS.crops}?crop=${encodeURIComponent(name)}`);
    const d=await r.json();
    if(!d.ok){ cropData=null; recolorMap(); updateModeTitle(); flashHint(`「${name}」は未収録です。収録作物: ${(d.available||[]).join("、 ")}`); return; }
    cropData=d; recolorMap(); updateModeTitle();
    showToast(`${d.ja} の収量で色分けしました`);
  }catch(_){ flashHint("作物データの取得に失敗しました。サーバーが起動しているか確認してください。"); }
}

/* ========================================================= */
/* 問い合わせ                                                */
/* ========================================================= */
const form=document.getElementById("contactForm"), note=document.getElementById("formNote");
form.addEventListener("submit", async e=>{
  e.preventDefault();
  const data=new FormData(form);
  const name=(data.get("name")||"").toString().trim(), email=(data.get("email")||"").toString().trim(), msg=(data.get("message")||"").toString().trim();
  note.classList.remove("error");
  if(!name||!email||!msg){ note.textContent="すべての項目を入力してください。"; note.classList.add("error"); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ note.textContent="メールアドレスの形式をご確認ください。"; note.classList.add("error"); return; }
  const btn=form.querySelector('button[type="submit"]'); btn.disabled=true; note.textContent="送信しています…";
  try{
    const res=await fetch(ENDPOINTS.contact,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,email,message:msg})});
    const out=await res.json().catch(()=>({}));
    if(res.ok&&out.ok){ form.reset(); note.textContent=out.mailed?"お問い合わせを送信しました。ありがとうございます。":"お問い合わせを受け付けました（サーバーに保存）。※メール送信は未設定のため配信されていません。"; }
    else{ note.classList.add("error"); note.textContent=out.error||"送信に失敗しました。時間をおいて再度お試しください。"; }
  }catch(_){ note.classList.add("error"); note.textContent="サーバーに接続できませんでした。npm start でサーバーを起動してください。"; }
  finally{ btn.disabled=false; }
});

/* ========================================================= */
/* 国名 英→日                                                */
/* ========================================================= */
function jaName(en){ return JA_COUNTRY[en]||en; }
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
/* 初期化：最初は必ずHOME                                    */
/* ========================================================= */
document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>showView(btn.dataset.go)));
history.replaceState(null,"","#home");
showView("home");
