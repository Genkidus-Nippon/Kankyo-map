/* =========================================================
   環境世界地図 — server.js（Express バックエンド）
   - 静的ファイル配信（index.html / style.css / script.js）
   - POST /api/contact : 問い合わせ受信（保存＋任意でメール送信）
   - GET  /api/news    : ニュース取得（Currents→無ければGDELT）
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
    if (!m) return;                          // 空行や # コメントは無視
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
    const hostEnv = process.env.CURRENTS_KEY || process.env.SMTP_HOST || process.env.RENDER || process.env.PORT;
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

// 万一どこかで拾い漏れた非同期エラーが出ても、落とさず警告だけにする
process.on("unhandledRejection", err => {
  const msg = (err && err.message) ? err.message : String(err);
  if (err && err.name === "AbortError"){
    console.warn("通信タイムアウト（処理は継続します）");   // 外部APIが遅いだけ
  } else {
    console.warn("未処理の非同期エラー:", msg);
  }
});
process.on("uncaughtException", err => {
  console.error("予期しないエラー:", err.message);
});

const PORT = process.env.PORT || 3000;

/* ---------- 任意: メール送信（SMTPが設定されていれば有効） ---------- */
/* ---------- メール送信の準備 ----------
   優先1: Resend（HTTPS/443。RenderなどSMTPポートが塞がれた環境向け）
   優先2: SMTP（ローカルなどSMTPが使える環境向け）                */
let transporter = null;
let smtpVerified = false;
let smtpLastError = null;
const useResend = !!process.env.RESEND_KEY;

if (useResend){
  console.log("メール送信: Resend を使用（HTTPS送信のためポート制限を受けません）");
} else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS){
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
      connectionTimeout: 10000,   // 接続が固まらないように
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    // 認証を起動時に検証（失敗しても必ず握りつぶす）
    Promise.resolve()
      .then(() => transporter.verify())
      .then(() => { smtpVerified = true; console.log("メール送信: 有効（SMTP認証OK）"); })
      .catch(err => {
        smtpLastError = err && err.message ? err.message : String(err);
        console.warn("⚠ メール送信の認証に失敗:", smtpLastError);
        if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(smtpLastError)){
          console.warn("  → 接続自体ができていません。ホスト(Render等)がSMTPポートを塞いでいる可能性大です。");
          console.warn("     対策: RESEND_KEY を設定してResend(HTTPS)で送るのが確実です。");
        } else {
          console.warn("  → SMTP_PASS は通常のパスワードではなく『アプリパスワード(16桁)』が必要です。");
          console.warn("     Google Workspaceの場合、管理者がSMTP認証を禁止していると失敗します。");
        }
      });
  } catch (e){
    smtpLastError = e.message;
    console.warn("nodemailer 未インストールのためメール送信は無効:", e.message);
  }
} else {
  console.log("メール送信: 無効（SMTP_HOST / SMTP_USER / SMTP_PASS が未設定 → submissions.json に保存のみ）");
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

  // 2) メール送信（Resend優先 → SMTP）
  let mailed = false;
  const subject = `【環境世界地図】${name} 様からのお問い合わせ`;
  const text = `お名前: ${name}\nメール: ${email}\n\n${message}`;
  const to = process.env.MAIL_TO || process.env.SMTP_USER;

  if (useResend){
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM || "onboarding@resend.dev",
          to: [to], reply_to: email, subject, text,
        }),
      });
      if (!r.ok){
        const body = await r.text().catch(() => "");
        smtpLastError = `Resend ${r.status}: ${body.slice(0,160)}`;
        console.error("メール送信に失敗:", smtpLastError);
        return res.status(500).json({ ok:false, error:"メール送信に失敗しました: " + smtpLastError + "（内容はサーバーに保存済みです）" });
      }
      mailed = true; smtpVerified = true; smtpLastError = null;
      console.log("メール送信: 成功（Resend）→", to);
    } catch (e){
      smtpLastError = e.message;
      console.error("メール送信に失敗:", e.message);
      return res.status(500).json({ ok:false, error:"メール送信に失敗しました: " + e.message + "（内容はサーバーに保存済みです）" });
    }
  } else if (transporter){
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to, replyTo: email, subject, text,
      });
      mailed = true;
      smtpVerified = true; smtpLastError = null;
      console.log("メール送信: 成功（SMTP）→", to);
    } catch (e){
      smtpLastError = e.message;
      console.error("メール送信に失敗:", e.message);
      return res.status(500).json({ ok:false, error:"メール送信に失敗しました: " + e.message + "（内容はサーバーに保存済みです）" });
    }
  } else {
    console.warn("⚠ 問い合わせを受信しましたが、メール送信未設定のため配信していません（保存のみ）。");
  }
  res.json({ ok:true, mailed });
});

/* =========================================================
   ③④ ニュース（Currents API → 失敗時 GDELT）
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

// タイムアウト付きfetch。中断・通信失敗でも例外を投げず、失敗扱いのオブジェクトを返す
async function safeFetch(url, ms = 12000, opts = {}){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { "User-Agent": "env-world-map/1.0", ...(opts.headers || {}) },
    });
  } catch (e){
    console.warn("fetch失敗:", e.name || e.message);
    return { ok:false, status:0, async text(){ return ""; }, async json(){ return {}; } };
  } finally {
    clearTimeout(timer);
  }
}

// URLからドメイン名を取り出す（出典表示用）
function domainOf(u){ try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }

// Currents API 検索（1回分）
async function currentsSearch(keywords, language){
  const kw = encodeURIComponent(keywords.trim());
  const url = `https://api.currentsapi.services/v1/search?keywords=${kw}&language=${language}&apiKey=${process.env.CURRENTS_KEY}`;
  const r = await safeFetch(url);
  if (!r.ok){
    const body = await r.text().catch(() => "");
    console.warn("Currents失敗:", r.status, body.slice(0, 160));  // 401=キー不正, 429=上限
    return [];
  }
  const d = await r.json();
  return (d.news || []).map(a => ({
    title: a.title, url: a.url, source: domainOf(a.url), date: a.published || ""
  }));
}

// Currents をメインに（日本語→英語の順で試す）
async function fromCurrents(ja, en, topic){
  if (!process.env.CURRENTS_KEY) return [];
  // 1) 日本語（国 × テーマ）
  let arts = await currentsSearch(`${ja} ${topic}`, "ja");
  // 2) 0件なら日本語で「国 × 環境」に広げる
  if (!arts.length && topic !== "環境") arts = await currentsSearch(`${ja} 環境`, "ja");
  // 3) それでも0件なら英語（国 × テーマ英訳）
  if (!arts.length) arts = await currentsSearch(`${en} ${topicToEn(topic)}`, "en");
  if (!arts.length) console.warn(`Currents: 「${ja} ${topic}」該当なし → GDELTを試します`);
  return arts.slice(0, 8);
}

// --- GDELT: 429対策（直列化 + 最小間隔 + 1回リトライ）---
let gdeltLock = Promise.resolve();
let lastGdelt = 0;
const GDELT_MIN = 2000;   // 呼び出し間隔を最低2秒あける

async function gdeltOnce(en, topic){
  try {
    const q = `${en} ${topicToEn(topic)}`;
    const url = "https://api.gdeltproject.org/api/v2/doc/doc"
              + `?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=12&timespan=1m&sort=datedesc`;
    const r = await safeFetch(url, 15000);   // GDELTは遅いので長めに待つ
    if (r.status === 429){ console.warn("GDELT 429（混雑）"); return { rate:true, articles:[] }; }
    const text = await r.text();
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
  } catch (e){
    console.warn("GDELT通信エラー:", e.message);   // タイムアウト/ネットワーク等でも落とさない
    return { articles:[] };
  }
}

function fromGDELT(en, topic){
  const run = gdeltLock.then(async () => {
    try {
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
    } catch (e){
      console.warn("GDELT処理エラー:", e.message);
      return { articles: [] };             // 例外を外に出さない
    }
  });
  gdeltLock = run.then(() => {}, () => {}); // 次の呼び出しを必ず進める（拒否も握る）
  return run;
}

/* ---------- ①信頼できる情報源のみに絞る ---------- */
const TRUSTED = [
  // 国際報道
  "reuters.com","apnews.com","bbc.com","bbc.co.uk","theguardian.com","nytimes.com",
  "washingtonpost.com","economist.com","aljazeera.com","cnn.com","bloomberg.com","ft.com",
  "time.com","dw.com","france24.com","npr.org","scientificamerican.com",
  // 科学・環境・公的機関
  "nature.com","science.org","nationalgeographic.com","un.org","unep.org","who.int",
  "worldbank.org","nasa.gov","noaa.gov","europa.eu","iea.org","ipcc.ch","climate.gov",
  // 日本
  "nhk.or.jp","www3.nhk.or.jp","asahi.com","yomiuri.co.jp","mainichi.jp","nikkei.com",
  "jiji.com","kyodo.co.jp","nordot.app","env.go.jp","jma.go.jp","afpbb.com","cnn.co.jp",
  "natgeo.nikkeibp.co.jp","natgeo.com","jetro.go.jp","unic.or.jp"
];
function isTrusted(url){
  const h = domainOf(url);
  return !!h && TRUSTED.some(d => h === d || h.endsWith("." + d));
}

// Currents / GDELT を集めて重複除去し、信頼ソースを優先
async function gatherArticles(ja, en, topic){
  let arts = await fromCurrents(ja, en, topic);
  if (arts.length < 6){
    const g = await fromGDELT(en, topic);
    arts = arts.concat(g.articles || []);
  }
  const seen = new Set(), uniq = [];
  for (const a of arts){
    if (a.url && a.title && !seen.has(a.url)){ seen.add(a.url); uniq.push(a); }
  }
  const trusted = uniq.filter(a => isTrusted(a.url));
  const rest    = uniq.filter(a => !isTrusted(a.url));
  // 信頼ソースを先頭に。信頼ソースが十分あればそれだけ、少なければ他も添える
  const ordered = trusted.length >= 4 ? trusted : trusted.concat(rest);
  return ordered.slice(0, 8);
}

/* ---------- ②③ AI（Anthropic API）で翻訳・概況生成 ---------- */
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

async function claudeText(system, user, maxTokens = 800){
  if (!ANTHROPIC) return "";
  const r = await safeFetch("https://api.anthropic.com/v1/messages", 20000, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL, max_tokens: maxTokens,
      system, messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok){ console.warn("Anthropic失敗:", r.status, (await r.text()).slice(0,160)); return ""; }
  const d = await r.json();
  return (d.content || []).map(b => b.text || "").join("").trim();
}

// ③ 英語などの見出しを日本語へ翻訳（既に日本語ならそのまま）
async function translateTitles(articles){
  if (!ANTHROPIC || !articles.length) return articles;
  const items = articles.map((a, i) => ({ i, t: a.title }));
  const out = await claudeText(
    "あなたは翻訳者です。ニュース見出しを自然な日本語に訳します。固有名詞は一般的な日本語表記にします。",
    `次の各見出しを日本語にしてください。すでに日本語ならそのまま返します。出力はJSON配列のみで、各要素は {\"i\":番号,\"ja\":\"日本語見出し\"} の形式。前後の説明は一切書かないでください。\n\n${JSON.stringify(items, null, 0)}`,
    1200
  );
  try {
    const arr = JSON.parse(out.replace(/```json|```/g, "").trim());
    const map = new Map(arr.map(o => [o.i, o.ja]));
    return articles.map((a, i) => map.has(i) ? { ...a, title: map.get(i) } : a);
  } catch { return articles; }  // 失敗時は原文のまま
}

// ② 記事が少ないときのAI概況（出典URLは作らない・AI生成と明示）
async function aiOverview(ja, topic){
  if (!ANTHROPIC) return "";
  return await claudeText(
    "あなたは環境問題の中立的な解説者です。事実に基づき、断定を避け、存在しない出典やURL・具体的な日付や統計の数字を創作しないでください。",
    `${ja}における環境問題、特に「${topic}」に関する一般的な状況を、日本語で3〜4文にまとめてください。最新の個別ニュースの断定はせず、背景知識として概観を説明してください。`,
    500
  );
}

app.get("/api/news", async (req, res) => {
  const ja    = (req.query.country || "").toString();
  const en    = (req.query.country_en || ja).toString();
  const topic = (req.query.topic || "環境問題").toString();
  const key = `${ja}|${en}|${topic}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.json({ ...hit.data, cached:true });

  let articles = [], overview = "", reason = "";
  try {
    articles = await gatherArticles(ja, en, topic);      // ① 信頼ソース優先で収集
    articles = await translateTitles(articles);          // ③ 見出しを日本語化
    if (articles.length < 3){                            // ② 記事が少なければAI概況で補う
      overview = await aiOverview(ja, topic);
    }
    if (!articles.length && !overview) reason = "empty";
  } catch (e){
    console.warn("news取得エラー:", e.message);
    reason = "error";
  }

  const payload = { articles, overview, reason };
  if (articles.length || overview) cache.set(key, { t: Date.now(), data: payload });
  res.json(payload);
});

app.listen(PORT, () => {
  console.log("========================================");
  console.log(`  環境世界地図が起動しました`);
  console.log(`  ブラウザで開く → http://localhost:${PORT}`);
  console.log("========================================");
  if (typeof fetch === "undefined"){
    console.warn("⚠ このNode.jsは古く、ニュース取得に必要な fetch がありません。Node.js 18以上をご利用ください（node -v で確認）。");
  }
  const ck = process.env.CURRENTS_KEY || "";
  const placeholder = /貼る|ここに|your|xxxx/i.test(ck);
  if (ck && !placeholder){
    console.log(`CURRENTS_KEY: 読み込みOK（先頭 ${ck.slice(0,4)}… / ${ck.length}文字, Currents優先）`);
  } else if (placeholder){
    console.warn("CURRENTS_KEY: プレースホルダのままです。実際のキーに置き換えてください（今はGDELTを使用）。");
  } else {
    console.log("CURRENTS_KEY: 未設定（GDELTを使用）");
  }
  console.log("AI補助（翻訳・概況）:", ANTHROPIC ? `有効（model=${AI_MODEL}）` : "無効（ANTHROPIC_API_KEY 未設定）");
});

// 起動確認用
const isPlaceholder = v => !v || /貼る|ここに|your|xxxx|example\.com/i.test(v);

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  fetch: typeof fetch !== "undefined",
  currents: !isPlaceholder(process.env.CURRENTS_KEY),
  mail: {
    mode: useResend ? "resend" : (transporter ? "smtp" : "none"),
    transporter: useResend || !!transporter,
    verified: useResend ? true : smtpVerified,
    host: useResend ? "api.resend.com" : (process.env.SMTP_HOST || null),
    port: useResend ? 443 : (process.env.SMTP_PORT || null),
    user_set: !isPlaceholder(process.env.SMTP_USER),
    pass_len: (process.env.SMTP_PASS || "").length,
    pass_has_space: /\s/.test(process.env.SMTP_PASS || ""),
    to_set: !isPlaceholder(process.env.MAIL_TO),
    last_error: smtpLastError,
  }
}));
