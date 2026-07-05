/* =========================================================
   環境世界地図 — server.js（Currents API ＆ エラー完全防御版）
   - 静的ファイル配信（index.html / style.css / script.js）
   - POST /api/contact : 問い合わせ受信（保存＋任意でメール送信）
   - GET  /api/news    : ニュース取得（Currents API→無ければGDELT）
   ========================================================= */
const express = require("express");
const path = require("path");
const fs = require("fs");

// .env を読み込む
function parseEnvFile(file){
  const txt = fs.readFileSync(file, "utf8");
  let count = 0;
  txt.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) return;
    const k = m[1];
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined || process.env[k] === ""){ process.env[k] = v; count++; }
  });
  return count;
}
function loadEnv(){
  try { require("dotenv").config(); } catch (_) {}
  const candidates = [
    path.join(__dirname, ".env"),
    path.join(process.cwd(), ".env"),
    path.join(path.dirname(__dirname), ".env"),
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
}
loadEnv();

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

/* ---------- 任意: メール送信（SMTP設定） ---------- */
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS){
  try {
    const nodemailer = require("nodemailer");
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 5000,
    });
    transporter.verify().catch(err => console.warn("⚠ SMTP認証失敗:", err.message));
  } catch (e) { console.warn("nodemailerエラー:", e.message); }
}

/* =========================================================
   ① 問い合わせ
   ========================================================= */
app.post("/api/contact", async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ ok:false, error:"すべての項目を入力してください。" });
  
  const entry = { name, email, message, at: new Date().toISOString() };
  try {
    const file = path.join(__dirname, "submissions.json");
    const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    list.push(entry);
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
  } catch (e){ console.error("保存失敗:", e.message); }

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
    } catch (e){ console.error("メール送信失敗:", e.message); }
  }
  res.json({ ok:true, mailed });
});

/* =========================================================
   ③④ ニュース（Currents API 日本語 → 失敗時 GDELT 英語）
   ========================================================= */
const TOPIC_EN = {
  "環境問題":"environment","環境":"environment","気候変動":"climate change","再生可能エネルギー":"renewable energy"
};
const topicToEn = t => TOPIC_EN[(t||"").trim()] || (t||"").trim() || "environment";

const cache = new Map();
const TTL = 30 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// タイムアウト付きfetch
async function safeFetch(url, ms = 8000){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "env-world-map/1.0" } });
  } {
    clearTimeout(timer);
  }
}

function cleanQuery(...parts) {
  return parts
    .map(p => (p || "").toString().trim())
    .filter(p => p && p !== "undefined" && p !== "null")
    .join(" ");
}

// --- NEW: Currents API から取得する関数 ---
async function fromCurrents(ja, topic){
  if (!process.env.CURRENTS_KEY) {
    console.log("Currents API: CURRENTS_KEY が未設定です");
    return [];
  }
  
  const queryStr = cleanQuery(ja, topic);
  if (!queryStr) return [];

  const q = encodeURIComponent(queryStr);
  const url = `https://api.currentsapi.services/v1/search?keywords=${q}&language=ja&apiKey=${process.env.CURRENTS_KEY}`;
  
  try {
    const r = await safeFetch(url);
    if (!r.ok){
      const body = await r.text().catch(() => "");
      console.warn("CurrentsAPI失敗:", r.status, body.slice(0, 160));
      return [];
    }
    const d = await r.json().catch(() => ({}));
    // Currents APIは記事リストが「news」という配列に入っています
    return (d.news || []).slice(0, 6).map(a => ({
      title: a.title, url: a.url, source: a.author || "Currents", date: a.published || ""
    }));
  } catch (e) {
    console.warn("CurrentsAPI取得中にエラー（制限時間切れ等）:", e.message);
    return []; // エラーを外に漏らさず安全に空配列を返す
  }
}

// --- GDELT バックアップ ---
let gdeltLock = Promise.resolve();
let lastGdelt = 0;
const GDELT_MIN = 5000;

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
    if (!r.ok || !text.trim() || text.trim()[0] === "<") return { articles:[] };
    
    let d;
    try { d = JSON.parse(text); } catch { return { articles:[] }; }
    return { articles:(d.articles || []).map(a => ({
      title: a.title, url: a.url, source: a.domain || "", date: a.seendate || ""
    })) };
  } catch (e) {
    console.warn("GDELT取得中にエラー:", e.message);
    return { articles:[] };
  }
}

function fromGDELT(en, topic){
  const run = gdeltLock.then(async () => {
    const wait = Math.max(0, GDELT_MIN - (Date.now() - lastGdelt));
    if (wait) await sleep(wait);
    lastGdelt = Date.now();
    let res = await gdeltOnce(en, topic);
    if (res.rate){
      await sleep(6000);
      lastGdelt = Date.now();
      res = await gdeltOnce(en, topic);
    }
    return res;
  });
  gdeltLock = run.catch(() => {});
  return run.catch(() => ({ articles:[] }));
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
    
    // 1. Currents API を試す
    articles = await fromCurrents(ja, topic);
    
    // 2. ダメならバックアップの GDELT を試す
    if (!articles.length){
      const g = await fromGDELT(en, topic);
      articles = (g && g.articles) || [];
      if (!articles.length && g && g.rate) reason = "ratelimited";
    }
    
    if (articles.length) cache.set(key, { t: Date.now(), data: articles });
    res.json({ articles, reason });
  } catch (globalErr) {
    console.error("APIルートでエラー:", globalErr.message);
    res.json({ articles: [], reason: "error" });
  }
});

app.listen(PORT, () => {
  console.log("========================================");
  console.log(`  環境世界地図（Currents API版）が起動しました`);
  console.log(`  http://localhost:${PORT}`);
  console.log("========================================");
  if (process.env.CURRENTS_KEY) {
    console.log("CURRENTS_KEY: 読み込みOK");
  } else {
    console.warn("⚠ CURRENTS_KEY が環境変数に設定されていません！");
  }
});
