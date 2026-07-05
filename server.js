/* =========================================================
   環境世界地図 — server.js（Express バックエンド・修正強化版）
   - 静的ファイル配信（index.html / style.css / script.js）
   - POST /api/contact : 問い合わせ受信（保存＋任意でメール送信）
   - GET  /api/news    : ニュース取得（GNews→無ければGDELT）
   Node.js 18 以上が必要です（グローバル fetch を使用）。
   ========================================================= */
const express = require("express");
const path = require("path");
const fs = require("fs");

// .env を読み込む（dotenvが入っていなくても自前で読む・複数箇所を探索）
function parseEnvFile(file){
  const txt = fs.readFileSync(file, "utf8");
  let count = 0;
  txt.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) return;                                  // 空行や # コメントは無視
    const k = m[1];
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined || process.env[k] === ""){ process.env[k] = v; count++; }
  });
  return count;
}
function loadEnv(){
  try { require("dotenv").config(); } catch (_) { /* dotenv未導入でも下で読む */ }
  const candidates = [
    path.join(__dirname, ".env"),                 // server.js と同じ場所（本命）
    path.join(process.cwd(), ".env"),             // 実行時のフォルダ
    path.join(path.dirname(__dirname), ".env"),   // 1つ上のフォルダ
  ];
  const seen = new Set();
  let loadedFrom = null;
  for (const p of candidates){
    if (seen.has(p)) continue; seen.add(p);
    try {
      if (fs.existsSync(p)){
        const n = parseEnvFile(p);
        loadedFrom = p;
        console.log(`.env を読み込みました（${n}項目）→ ${p}`);
        break;
      }
    } catch (e){ console.warn(".env 読み込み失敗:", p, e.message); }
  }
  if (!loadedFrom){
    const hostEnv = process.env.GNEWS_KEY || process.env.SMTP_HOST || process.env.RENDER || process.env.PORT;
    if (hostEnv){
      console.log("（.envファイルなし。ホストの環境変数を使用します）");
    } else {
      console.warn("⚠ .env が見つかりませんでした。次のいずれかに置いてください:");
      candidates.forEach(p => console.warn("   " + p));
    }
  }
}
loadEnv();

const app = express();
app.use(express.json());
app.use(express.static(__dirname));   // このフォルダをそのまま公開

const PORT = process.env.PORT || 3000;

/* ---------- 任意: メール送信（SMTPが設定されていれば有効） ---------- */
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS){
  try {
    const nodemailer = require("nodemailer");
    const pass = process.env.SMTP_PASS;
    // 診断表示（中身は伏せる）
    console.log(`SMTP_USER: ${process.env.SMTP_USER}`);
    console.log(`SMTP_PASS: ${pass.length}文字` + (/\s/.test(pass) ? " ← ⚠ スペースが含まれています（詰めてください）" : "")
                + (pass.length !== 16 ? " ← ⚠ アプリパスワードは通常16文字です" : ""));
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass },
      connectionTimeout: 5000, // 長時間待機でサーバーが詰まるのを防ぐ（5秒）
    });
    // 認証を起動時に検証（失敗理由をすぐ表示）
    transporter.verify()
      .then(() => console.log("メール送信: 有効（SMTP認証OK）"))
      .catch(err => {
        console.warn("⚠ メール送信の認証に失敗:", err.message);
        console.warn("  → SMTP_PASS は通常のパスワードではなく『アプリパスワード(16桁)』が必要です。");
        console.warn("     2段階認証を有効化 → https://myaccount.google.com/apppasswords で発行してください。");
      });
  } catch (e){
    console.warn("nodemailer 未インストールのためメール送信は無効:", e.message);
  }
} else {
  console.log("メール送信: 無効（submissions.json に保存のみ）");
}

/* =========================================================
   ① 問い合わせ
   ========================================================= */
app.post("/api/contact", async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message)
    return res.status(400).json({ ok:false, error:"すべての項目を入力してください。" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ ok:false, error:"メールアドレスの形式が正しくありません。" });

  const entry = { name, email, message, at: new Date().toISOString() };

  // 1) 保存（メール未設定でも記録は残る）
  try {
    const file = path.join(__dirname, "submissions.json");
    const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    list.push(entry);
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
  } catch (e){ console.error("保存に失敗:", e.message); }

  // 2) メール送信（設定があれば）
  let mailed = false;
  if (transporter){
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to:   process.env.MAIL_TO   || process.env.SMTP_USER,
        replyTo: email,
        subject: `【環境世界地図】${name} 様からのお問い合わせ`,
        text: `お名前: ${name}\nメール: ${email}\n\n${message}`,
      });
      mailed = true;
    } catch (e){
      console.error("メール送信に失敗:", e.message);
      return res.status(500).json({ ok:false, error:"メール送信に失敗しました: " + e.message + "（内容はサーバーに保存済みです）" });
    }
  }
  res.json({ ok:true, mailed });
});

/* =========================================================
   ③④ ニュース（GNews 日本語 → 失敗時 GDELT 英語）
   ========================================================= */
const TOPIC_EN = {
  "環境問題":"environment","環境":"environment",
  "温暖化":"global warming","地球温暖化":"global warming","気候変動":"climate change",
  "再生可能エネルギー":"renewable energy","再エネ":"renewable energy","脱炭素":"decarbonization",
  "森林":"deforestation","森林破壊":"deforestation","森林伐採":"deforestation",
  "大気汚染":"air pollution","水質汚染":"water pollution","汚染":"pollution",
  "海洋プラスチック":"ocean plastic","プラスチック":"plastic pollution","ごみ":"waste",
  "干ばつ":"drought","洪水":"flood","山火事":"wildfire","熱波":"heatwave",
  "生物多様性":"biodiversity","絶滅":"extinction","海面上昇":"sea level rise",
  "水資源":"water resources","食料":"food security"
};
const topicToEn = t => TOPIC_EN[(t||"").trim()] || (t||"").trim() || "environment";

const cache = new Map();              // 簡易キャッシュ（30分）
const TTL = 30 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// タイムアウト付きfetch（UAヘッダ付与）
async function safeFetch(url, ms = 8000){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "env-world-map/1.0" } });
  } finally { clearTimeout(timer); }
}

// 検索ワードから空文字や"undefined"などのゴミを除くクリーンアップ関数
function cleanQuery(...parts) {
  return parts
    .map(p => (p || "").toString().trim())
    .filter(p => p && p !== "undefined" && p !== "null")
    .join(" ");
}

async function fromGNews(ja, topic){
  if (!process.env.GNEWS_KEY) return [];
  
  const queryStr = cleanQuery(ja, topic);
  if (!queryStr) return []; // 検索ワードが完全に空ならパス

  const q = encodeURIComponent(queryStr);
  const url = `https://gnews.io/api/v4/search?q=${q}&lang=ja&max=6&sortby=publishedAt&apikey=${process.env.GNEWS_KEY}`;
  
  try {
    const r = await safeFetch(url);
    if (!r.ok){
      const body = await r.text().catch(() => "");
      console.warn("GNews失敗:", r.status, body.slice(0, 160));  // 403=キー不正, 429=上限
      return [];
    }
    const d = await r.json().catch(() => ({}));
    return (d.articles || []).map(a => ({
      title: a.title, url: a.url, source: (a.source && a.source.name) || "", date: a.publishedAt || ""
    }));
  } catch (e) {
    console.warn("GNews取得中にエラー（タイムアウト等）:", e.message);
    return [];
  }
}

// --- GDELT: 429対策（直列化 + 最小間隔 + 1回リトライ）---
let gdeltLock = Promise.resolve();
let lastGdelt = 0;
const GDELT_MIN = 5000;   // 呼び出し間隔を最低5秒あける

async function gdeltOnce(en, topic){
  const enTopic = topicToEn(topic);
  const queryStr = cleanQuery(en, enTopic);
  if (!queryStr) return { articles:[] };

  const url = "https://api.gdeltproject.org/api/v2/doc/doc"
            + `?query=${encodeURIComponent(queryStr)}&mode=artlist&format=json&maxrecords=6&sort=datedesc`;
  
  try {
    const r = await safeFetch(url);
    if (r.status === 429){ console.warn("GDELT 429（混雑）"); return { rate:true, articles:[] }; }
    const text = await r.text().catch(() => "");
    if (!r.ok || !text.trim() || text.trim()[0] === "<"){
      console.warn("GDELT失敗:", r.status, text.slice(0, 120));
      return { articles:[] };
    }
    let d;
    try { d = JSON.parse(text); }
    catch { console.warn("GDELT非JSON:", text.slice(0, 120)); return { articles:[] }; }
    return { articles:(d.articles || []).map(a => ({
      title: a.title, url: a.url, source: a.domain || "", date: a.seendate || ""
    })) };
  } catch (e) {
    console.warn("GDELT取得中にエラー（タイムアウト等）:", e.message);
    return { articles:[] };
  }
}

function fromGDELT(en, topic){
  const run = gdeltLock.then(async () => {
    const wait = Math.max(0, GDELT_MIN - (Date.now() - lastGdelt));
    if (wait) await sleep(wait);
    lastGdelt = Date.now();
    let res = await gdeltOnce(en, topic);
    if (res.rate){                       // 429 → 6秒待って1回だけ再試行
      await sleep(6000);
      lastGdelt = Date.now();
      res = await gdeltOnce(en, topic);
    }
    return res;
  });
  gdeltLock = run.catch(() => {});       // 失敗しても次の呼び出しは進める
  return run.catch(() => ({ articles:[] })); // 呼び出し元にエラーを漏らさないように防御
}

app.get("/api/news", async (req, res) => {
  try {
    const ja    = (req.query.country || "").toString();
    const en    = (req.query.country_en || ja).toString();
    const topic = (req.query.topic || "環境問題").toString();
    const key = `${ja}|${en}|${topic}`;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < TTL) return res.json({ articles: hit.data, cached:true });

    let articles = [], reason = "";
    
    // 1. GNewsを試す
    articles = await fromGNews(ja, topic);
    
    // 2. GNewsが全滅、または未設定ならGDELTを試す
    if (!articles.length){
      const g = await fromGDELT(en, topic);
      articles = (g && g.articles) || [];
      if (!articles.length && g && g.rate) reason = "ratelimited";
    }
    
    if (articles.length) cache.set(key, { t: Date.now(), data: articles });
    res.json({ articles, reason });
  } catch (globalErr) {
    console.error("APIルートで予期せぬエラー:", globalErr.message);
    res.json({ articles: [], reason: "error" });
  }
});

app.listen(PORT, () => {
  console.log("========================================");
  console.log(`  環境世界地図が起動しました`);
  console.log(`  ブラウザで開く → http://localhost:${PORT}`);
  console.log("========================================");
  if (typeof fetch === "undefined"){
    console.warn("⚠ このNode.jsは古く、ニュース取得に必要な fetch がありません。Node.js 18以上をご利用ください（node -v で確認）。");
  }
  const gk = process.env.GNEWS_KEY || "";
  const placeholder = /貼る|ここに|your|xxxx/i.test(gk);
  if (gk && !placeholder){
    console.log(`GNEWS_KEY: 読み込みOK（先頭 ${gk.slice(0,4)}… / ${gk.length}文字, GNews優先）`);
  } else if (placeholder){
    console.warn("GNEWS_KEY: プレースホルダのままです。実際のキーに置き換えてください（今はGDELTを使用）。");
  } else {
    console.log("GNEWS_KEY: 未設定（GDELTを使用）");
  }
});

// 起動確認用
app.get("/api/health", (_req, res) => res.json({
  ok: true,
  fetch: typeof fetch !== "undefined",
  gnews: !!(process.env.GNEWS_KEY && !/貼る|ここに|your|xxxx/i.test(process.env.GNEWS_KEY))
}));
