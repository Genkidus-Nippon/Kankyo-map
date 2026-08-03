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

// Google Custom Search（ウェブ全体を検索。歴史・文化も拾える）
const GOOGLE_CSE_KEY = process.env.GOOGLE_CSE_KEY;
const GOOGLE_CSE_ID  = process.env.GOOGLE_CSE_ID;
const googleReady = () => !!(GOOGLE_CSE_KEY && GOOGLE_CSE_ID);
async function fromGoogle(query, lang){
  if (!googleReady()) return [];
  const hl = (lang || "ja").slice(0, 2);
  const url = `https://www.googleapis.com/customsearch/v1`
            + `?key=${GOOGLE_CSE_KEY}&cx=${GOOGLE_CSE_ID}&num=10&hl=${hl}&q=${encodeURIComponent(query)}`;
  const r = await safeFetch(url, 10000);
  if (!r.ok){ console.warn("Google CSE失敗:", r.status, (await r.text()).slice(0,160)); return []; }
  const d = await r.json().catch(() => ({}));
  return (d.items || []).map(it => ({
    title: it.title, url: it.link, source: domainOf(it.link), desc: it.snippet || ""
  }));
}

// Brave Search（ウェブ全体を検索。新規登録しやすく無料枠あり）
const BRAVE_KEY = process.env.BRAVE_KEY;
const braveReady = () => !!BRAVE_KEY;
async function fromBrave(query, lang){
  if (!braveReady()) return [];
  const sl = (lang || "ja").slice(0, 2);
  const url = `https://api.search.brave.com/res/v1/web/search`
            + `?q=${encodeURIComponent(query)}&count=20&search_lang=${sl}`;
  const r = await safeFetch(url, 10000, {
    headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json" },
  });
  if (!r.ok){ console.warn("Brave失敗:", r.status, (await r.text()).slice(0,160)); return []; }
  const d = await r.json().catch(() => ({}));
  const items = (d.web && d.web.results) || [];
  return items.map(it => ({
    title: it.title, url: it.url,
    source: (it.meta_url && it.meta_url.hostname) || domainOf(it.url),
    desc: it.description || ""
  }));
}

// 統一ウェブ検索: Brave優先 → Google → 無ければ空（ニュースAPIにフォールバック）
const webReady = () => braveReady() || googleReady();
async function webSearch(query, lang){
  if (braveReady())  return await fromBrave(query, lang);
  if (googleReady()) return await fromGoogle(query, lang);
  return [];
}

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

// Currents をメインに（関連性重視：日本語→英語で同じテーマを検索）
async function fromCurrents(ja, en, topic){
  if (!process.env.CURRENTS_KEY) return [];
  let arts = await currentsSearch(`${ja} ${topic}`, "ja");           // 国×テーマ（日本語）
  if (arts.length < 4){
    const enArts = await currentsSearch(`${en} ${topicToEn(topic)}`, "en");  // 国×テーマ（英語）で補完
    const seen = new Set(arts.map(a => a.url));
    for (const a of enArts) if (!seen.has(a.url)) arts.push(a);
  }
  if (!arts.length) console.warn(`Currents: 「${ja} ${topic}」該当なし → GDELTへ`);
  return arts.slice(0, 16);
}

// --- GDELT: 429対策（直列化 + 最小間隔 + 1回リトライ）---
let gdeltLock = Promise.resolve();
let lastGdelt = 0;
const GDELT_MIN = 600;   // 呼び出し間隔（速度優先。429時は自動で待って再試行）

async function gdeltOnce(en, topic){
  try {
    const q = `${en} ${topicToEn(topic)}`;
    const url = "https://api.gdeltproject.org/api/v2/doc/doc"
              + `?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=25&timespan=2m&sort=datedesc`;
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
  // Currents(関連性・日本語) と GDELT(英語) を並列取得
  const [cur, gd] = await Promise.all([
    fromCurrents(ja, en, topic).catch(() => []),
    fromGDELT(en, topic).then(g => g.articles || []).catch(() => []),
  ]);

  const seen = new Set();
  const dedupe = list => {
    const out = [];
    for (const a of list){ if (a && a.url && a.title && !seen.has(a.url)){ seen.add(a.url); out.push(a); } }
    return out;
  };
  const curU = dedupe(cur);
  const gdU  = dedupe(gd);
  const gdTrusted = gdU.filter(a => isTrusted(a.url));
  const gdRest    = gdU.filter(a => !isTrusted(a.url));

  // 関連性の高いCurrentsを先頭 → 信頼できるGDELT → 残り
  let ordered = [...curU, ...gdTrusted, ...gdRest];

  // 少なすぎる国は、国名＋環境の広い条件でGDELT補完
  if (ordered.length < 8){
    let broadArts = [];
    try { const g = await fromGDELT(en, "environment OR climate OR pollution OR wildlife"); broadArts = g.articles || []; }
    catch (_) {}
    ordered = ordered.concat(dedupe(broadArts));
  }
  return ordered.slice(0, 30);
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

// ③ 見出しの翻訳（利用者の言語へ）。日本語見出しはJA向けのときスキップ
const hasJapanese = s => /[\u3040-\u30ff\u4e00-\u9faf]/.test(s || "");
const DEEPL = process.env.DEEPL_KEY;

// 利用者の言語 → DeepLターゲット / AI用の言語名
const LANGS = {
  ja:{deepl:"JA",name:"日本語"}, en:{deepl:"EN-US",name:"English"}, fr:{deepl:"FR",name:"français"},
  de:{deepl:"DE",name:"Deutsch"}, es:{deepl:"ES",name:"español"}, it:{deepl:"IT",name:"italiano"},
  pt:{deepl:"PT-PT",name:"português"}, nl:{deepl:"NL",name:"Nederlands"}, pl:{deepl:"PL",name:"polski"},
  ru:{deepl:"RU",name:"русский"}, zh:{deepl:"ZH",name:"中文"}, ko:{deepl:"KO",name:"한국어"},
  id:{deepl:"ID",name:"Bahasa Indonesia"}, tr:{deepl:"TR",name:"Türkçe"}, uk:{deepl:"UK",name:"українська"},
};
function langInfo(lang){ return LANGS[(lang||"ja").toString().slice(0,2).toLowerCase()] || LANGS.ja; }

// DeepL 翻訳（設定時のみ）。無料キーは末尾 ":fx"
async function deeplTranslate(texts, target="JA"){
  if (!DEEPL || !texts.length) return null;
  const base = DEEPL.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const params = new URLSearchParams();
  params.set("target_lang", target);
  for (const t of texts) params.append("text", t);
  const r = await safeFetch(base + "/v2/translate", 12000, {
    method: "POST",
    headers: { "Authorization": `DeepL-Auth-Key ${DEEPL}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok){ console.warn("DeepL失敗:", r.status); return null; }
  const d = await r.json().catch(() => ({}));
  const out = (d.translations || []).map(x => x.text);
  return out.length === texts.length ? out : null;
}

async function translateTitles(articles, lang){
  const info = langInfo(lang);
  const isJa = info.deepl === "JA";
  const targets = articles.slice(0, 12)
    .map((a, i) => ({ i, t: a.title }))
    .filter(o => isJa ? !hasJapanese(o.t) : true);   // JA向けは日本語をスキップ、他言語は全訳
  if (!targets.length) return articles;

  const dl = await deeplTranslate(targets.map(o => o.t), info.deepl);
  if (dl){
    const map = new Map(targets.map((o, k) => [o.i, dl[k]]));
    return articles.map((a, i) => map.has(i) ? { ...a, title: map.get(i) } : a);
  }

  if (!ANTHROPIC) return articles;
  const out = await claudeText(
    `あなたは翻訳者です。ニュース見出しを自然な${info.name}に訳します。`,
    `次の各見出しを${info.name}にしてください。出力はJSON配列のみ：{\"i\":番号,\"ja\":\"訳\"} 。説明は書かないでください。\n\n${JSON.stringify(targets, null, 0)}`,
    900
  );
  try {
    const arr = JSON.parse(out.replace(/```json|```/g, "").trim());
    const map = new Map(arr.map(o => [o.i, o.ja]));
    return articles.map((a, i) => map.has(i) ? { ...a, title: map.get(i) } : a);
  } catch { return articles; }
}

// 関連性フィルタ: 国名かテーマを含む記事を優先（十分あれば関連のみ）
function relevanceFilter(articles, ja, en, topic){
  const enL = (en || "").toLowerCase(), topEn = topicToEn(topic).toLowerCase();
  const hit = a => {
    const t = `${a.title || ""} ${a.desc || ""}`, tl = t.toLowerCase();
    return t.includes(ja) || (enL && tl.includes(enL)) || t.includes(topic) || (topEn && tl.includes(topEn));
  };
  const rel = articles.filter(hit);
  return rel.length >= 3 ? rel : articles;
}

// 「まとめ・一覧・ランキング」系の記事を判定（個別トピックを優先するため）
function isRoundup(title){
  const t = (title || "");
  const tl = t.toLowerCase();
  // 英語: list of / top 10 / 10 best / 7 things / ranking / roundup / guide など
  if (/\b(list of|top\s*\d+|\d+\s*(best|things|ways|places|reasons|facts|examples|types)|best\s*\d+|ranking|round[\s-]?up|ultimate guide|complete guide|everything you need)\b/i.test(tl)) return true;
  // 数字始まり（"10 Festivals ..." など）
  if (/^\s*\d+\s+\S/.test(t)) return true;
  // 日本語: 一覧 / まとめ / ランキング / ○選 / おすすめ / ベスト / トップ / 特集 / 完全ガイド / 総まとめ
  if (/(一覧|まとめ|ランキング|\d+\s*選|おすすめ|ベスト\s*\d+|トップ\s*\d+|特集|完全ガイド|総まとめ|徹底比較)/.test(t)) return true;
  return false;
}
// 個別トピックの記事を優先。十分あればまとめ記事は除外する
function screenRoundups(list){
  const single = list.filter(a => !isRoundup(a.title));
  const round  = list.filter(a =>  isRoundup(a.title));
  return single.length >= 4 ? single : single.concat(round);
}

// ② 記事が少ないときのAI概況（出典URLは作らない・AI生成と明示）
async function aiOverview(ja, topic, lang){
  if (!ANTHROPIC) return "";
  const info = langInfo(lang);
  return await claudeText(
    `あなたは中立的な解説者です。事実にもとづき、断定や統計数値の創作を避け、${info.name}で回答します。`,
    `${ja}の「${topic}」に関する一般的な状況を、${info.name}で3〜4文にまとめてください。`,
    500
  );
}

app.get("/api/news", async (req, res) => {
  const ja    = (req.query.country || "").toString();
  const en    = (req.query.country_en || ja).toString();
  const topic = (req.query.topic || "環境問題").toString();
  const lang  = (req.query.lang || "ja").toString();
  const key = `news|${lang}|${ja}|${en}|${topic}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.json({ ...hit.data, cached:true });

  // ── 第1段階（高速）──
  // Google Custom Searchが使えるならウェブ全体を検索（歴史・文化も拾える）。
  // 無ければニュースAPI（Currents）。いずれもWikipediaを添える。
  let articles = [], reason = "";
  try {
    const gq = /^ja/i.test(lang) ? `${ja} ${topic}` : `${en} ${topicToEn(topic)}`;
    const [g, cur, wikiRaw] = await Promise.all([
      webSearch(gq, lang).catch(() => []),
      webReady() ? Promise.resolve([]) : fromCurrents(ja, en, topic).catch(() => []),
      fromWikipedia(ja, topic).catch(() => []),
    ]);

    const seen = new Set();
    const push = list => { for (const a of list) if (a.url && a.title && !seen.has(a.url)){ seen.add(a.url); articles.push(a); } };
    // 信頼できるドメインを優先（ブランド・信頼性で選別）
    push((g || []).filter(a => isTrusted(a.url)));
    push(cur.filter(a => isTrusted(a.url)));
    push(g || []);
    push(cur);
    const wiki = wikiRaw.filter(w => w.title.includes(ja) || w.title.includes(topic)).slice(0, 2);
    push(wiki);

    articles = screenRoundups(relevanceFilter(articles, ja, en, topic));
    articles = await translateTitles(articles, lang);
    if (!articles.length) reason = "empty_fast";
  } catch (e){ console.warn("news(fast)エラー:", e.message); reason = "error"; }

  res.json({ articles, overview:"", reason, stage:1 });
});

// ── 第2段階（重い）: GDELT + AI概況。第1段階に追記する ──
app.get("/api/news-enrich", async (req, res) => {
  const ja    = (req.query.country || "").toString();
  const en    = (req.query.country_en || ja).toString();
  const topic = (req.query.topic || "環境問題").toString();
  const lang  = (req.query.lang || "ja").toString();

  let articles = [], overview = "";
  try {
    let gd = [];
    try { const g = await fromGDELT(en, topic); gd = g.articles || []; } catch (_) {}
    if (gd.length < 6){
      try { const g2 = await fromGDELT(en, "environment OR climate OR pollution"); gd = gd.concat(g2.articles || []); } catch (_) {}
    }
    const seen = new Set();
    for (const a of gd) if (a.url && a.title && !seen.has(a.url)){ seen.add(a.url); articles.push(a); }
    const trusted = articles.filter(a => isTrusted(a.url));
    const rest    = articles.filter(a => !isTrusted(a.url));
    articles = trusted.concat(rest);
    articles = screenRoundups(relevanceFilter(articles, ja, en, topic));
    articles = await translateTitles(articles, lang);
    overview = await aiOverview(ja, topic, lang);   // 空でも可
  } catch (e){ console.warn("news-enrichエラー:", e.message); }

  res.json({ articles, overview });
});

/* ========================================================= */
/* 歴史世界地図：日本語Wikipedia + 任意でAI概況                */
/* ========================================================= */
async function fromWikipedia(ja, topic){
  const q = encodeURIComponent(`${ja} ${topic}`.trim());
  const url = `https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=6&format=json`;
  const r = await safeFetch(url);
  if (!r.ok) return [];
  const d = await r.json().catch(() => ({}));
  const hits = (d.query && d.query.search) || [];
  return hits.map(h => ({
    title: h.title,
    url: "https://ja.wikipedia.org/wiki/" + encodeURIComponent(h.title.replace(/ /g, "_")),
    source: "Wikipedia",
    desc: (h.snippet || "").replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim(),
  }));
}
async function aiHistoryOverview(ja, topic){
  if (!ANTHROPIC) return "";
  return await claudeText(
    "あなたは歴史の中立的な解説者です。事実に基づき、年号や固有名詞は一般に知られた範囲で述べ、不確かな断定や出典・URLの創作はしないでください。",
    `${ja}の歴史、特に「${topic}」に関わる出来事や背景を、日本語で3〜4文でわかりやすく説明してください。`,
    500
  );
}
app.get("/api/history", async (req, res) => {
  const ja    = (req.query.country || "").toString();
  const topic = (req.query.topic || "歴史").toString();
  const key = `hist|${ja}|${topic}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.json({ ...hit.data, cached:true });

  let articles = [], overview = "", reason = "";
  try {
    articles = await fromWikipedia(ja, topic);
    if (articles.length < 3) overview = await aiHistoryOverview(ja, topic);
    if (!articles.length && !overview) reason = "empty";
  } catch (e){ console.warn("history取得エラー:", e.message); reason = "error"; }

  const payload = { articles, overview, reason };
  if (articles.length || overview) cache.set(key, { t: Date.now(), data: payload });
  res.json(payload);
});

/* ========================================================= */
/* 作物世界地図：FAOベースのデータ + クリック時にAI補足        */
/* ========================================================= */
const { CROPS, resolveCrop, cropList } = require("./crops-data");

app.get("/api/crops", (req, res) => {
  const k = resolveCrop(req.query.crop);
  if (!k){
    return res.json({ ok:false, error:"未収録の作物です。", available: cropList() });
  }
  const c = CROPS[k];
  const vals = Object.values(c.data);
  res.json({
    ok:true, crop:k, ja:c.ja, unit:c.unit, year:c.year, source:c.source,
    data:c.data, max:Math.max(...vals), min:Math.min(...vals),
  });
});

async function aiCropDetail(cropJa, countryJa){
  if (!ANTHROPIC) return "";
  return await claudeText(
    "あなたは農業の解説者です。事実に基づき、主要な栽培品種や産地、特徴を簡潔に述べます。数量の断定や不確かな統計の創作はしないでください。",
    `${countryJa}における「${cropJa}」の栽培について、主な産地・代表的な品種・特徴を日本語で2〜3文で説明してください。`,
    400
  );
}
app.get("/api/crop-detail", async (req, res) => {
  const k = resolveCrop(req.query.crop);
  const country   = (req.query.country || "").toString();     // 英語名（world-atlas）
  const countryJa = (req.query.country_ja || country).toString();
  if (!k) return res.json({ ok:false });
  const c = CROPS[k];
  const entries = Object.entries(c.data).sort((a, b) => b[1] - a[1]);
  const idx = entries.findIndex(([n]) => n === country);
  const production = idx >= 0 ? entries[idx][1] : null;
  const rank = idx >= 0 ? idx + 1 : null;

  let ai = "";
  try { ai = await aiCropDetail(c.ja, countryJa); } catch (_) {}
  res.json({
    ok:true, ja:c.ja, unit:c.unit, year:c.year, source:c.source,
    production, rank, producers: entries.length, ai,
  });
});

/* ========================================================= */
/* 特化型・年代別マップ（温暖化/砂漠化/森林/水/大気）          */
/* ========================================================= */
const { getTheme } = require("./theme-data");

app.get("/api/theme", (req, res) => {
  const t = getTheme(req.query.metric, req.query.decade);
  if (!t) return res.json({ ok:false, error:"未対応の指標です。" });
  res.json(t);
});

app.get("/api/theme-detail", async (req, res) => {
  const t = getTheme(req.query.metric, req.query.decade);
  const country   = (req.query.country || "").toString();
  const countryJa = (req.query.country_ja || country).toString();
  if (!t) return res.json({ ok:false });
  const entries = Object.entries(t.data).sort((a, b) => b[1] - a[1]);
  const idx = entries.findIndex(([n]) => n === country);
  const value = idx >= 0 ? entries[idx][1] : null;
  const rank  = idx >= 0 ? idx + 1 : null;

  let ai = "";
  if (ANTHROPIC){
    try {
      ai = await claudeText(
        "あなたは環境問題の中立的な解説者です。事実に基づき、断定や統計数字の創作を避けてください。",
        `${countryJa}における「${t.ja}」の一般的な状況や背景を、日本語で2〜3文で説明してください。`,
        400
      );
    } catch (_) {}
  }
  res.json({ ok:true, ja:t.ja, unit:t.unit, year:t.year, source:t.source, note:t.note, value, rank, producers:entries.length, ai });
});

/* ========================================================= */
/* SDGs世界地図（17目標×指標・年代なし）                     */
/* ========================================================= */
const { getSdg, goalsMeta } = require("./sdg-data");

app.get("/api/sdg/goals", (_req, res) => res.json({ ok:true, goals: goalsMeta() }));

app.get("/api/sdg", (req, res) => {
  const d = getSdg(req.query.goal, req.query.indicator);
  if (!d) return res.json({ ok:false, error:"指標が見つかりません。" });
  res.json(d);
});

/* ========================================================= */
/* ユーザー世界地図（利用者の声・手動反映）                    */
/* ========================================================= */
app.get("/api/user", (_req, res) => {
  let voices = {};
  try { delete require.cache[require.resolve("./user-data")]; voices = require("./user-data") || {}; }
  catch (e){ console.warn("user-data 読み込み失敗:", e.message); }
  const data = {}; let max = 0;
  for (const [c, arr] of Object.entries(voices)){
    const n = Array.isArray(arr) ? arr.length : 0;
    data[c] = n; if (n > max) max = n;
  }
  res.json({
    ok:true, data, messages:voices, colorMax:Math.max(max,1),
    unit:"件", label:"利用者の声", source:"問い合わせ（手動反映）",
    lowLabel:"少ない", highLabel:"多い",
  });
});

app.get("/api/sdg-detail", async (req, res) => {
  const d = getSdg(req.query.goal, req.query.indicator);
  const country   = (req.query.country || "").toString();
  const countryJa = (req.query.country_ja || country).toString();
  if (!d) return res.json({ ok:false });
  const entries = Object.entries(d.data).sort((a,b) => d.higherIsBetter ? b[1]-a[1] : a[1]-b[1]);
  const idx = entries.findIndex(([n]) => n === country);
  const value = idx>=0 ? entries[idx][1] : null;
  const rank  = idx>=0 ? idx+1 : null;
  let ai = "";
  if (ANTHROPIC){
    try {
      ai = await claudeText(
        "あなたは国際開発・SDGsの中立的な解説者です。事実に基づき、断定や統計数字の創作を避けてください。",
        `${countryJa}における「SDG目標${d.goalId}：${d.goalTitle}」、特に「${d.label}」の状況を、日本語で2〜3文で概観してください。`,
        400
      );
    } catch (_) {}
  }
  res.json({ ok:true, goalTitle:d.goalTitle, label:d.label, unit:d.unit, value, rank,
             producers:entries.length, higherIsBetter:d.higherIsBetter, ai });
});

/* ========================================================= */
/* AI-Map：AIが生成する解説記事（Web記事ではない・参考情報）  */
/* ========================================================= */
// 「国 テーマ」でWeb検索し、ヒット件数（情報量の目安）を返す
async function gdeltCount(en, topic){
  const q = `${en} ${topicToEn(topic)}`;
  const url = "https://api.gdeltproject.org/api/v2/doc/doc"
            + `?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=40&timespan=3m&sort=datedesc`;
  const r = await safeFetch(url, 12000);
  if (!r.ok) return 0;
  const d = await r.json().catch(() => ({}));
  return (d.articles || []).length;
}
app.get("/api/search-count", async (req, res) => {
  const en    = (req.query.country_en || "").toString();
  const ja    = (req.query.country || en).toString();
  const topic = (req.query.topic || "").toString();
  const lang  = (req.query.lang || "ja").toString();
  const key = `cnt|${en}|${topic}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.json({ ok:true, count:hit.data, cached:true });
  let count = 0;
  try {
    if (webReady()){
      const gq = /^ja/i.test(lang) ? `${ja} ${topic}` : `${en} ${topicToEn(topic)}`;
      count = (await webSearch(gq, lang)).length;   // ヒット件数（0〜20）
    } else {
      count = await gdeltCount(en, topic);
    }
  } catch (_) {}
  cache.set(key, { t: Date.now(), data: count });
  res.json({ ok:true, count });
});

app.get("/api/ai-articles", async (req, res) => {
  const ja    = (req.query.country || "").toString();
  const en    = (req.query.country_en || ja).toString();
  const topic = (req.query.topic || "").toString();
  const lang  = (req.query.lang || "ja").toString();
  const n     = Math.max(2, Math.min(6, parseInt(req.query.n, 10) || 4));   // 検索件数に応じた本数
  const info  = langInfo(lang);
  if (!ANTHROPIC) return res.json({ ok:false, reason:"no_ai", message:"AI-Mapの利用には ANTHROPIC_API_KEY が必要です。" });
  if (!topic)     return res.json({ ok:false, reason:"no_topic" });

  const key = `ai|${lang}|${n}|${ja}|${topic}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.json({ ...hit.data, cached:true });

  const out = await claudeText(
    `あなたは教育向けの解説ライターです。事実にもとづく一般的な知識のみで、${info.name}の短い解説記事を書きます。具体的な統計数値・年月日・人物の発言・存在しない出典やURLは創作しないでください。断定を避け、わかりやすく中立に書きます。`,
    `「${ja}」の「${topic}」について、読者の興味を引く${info.name}の解説記事を${n}本作成してください。各記事は必ず {"title":"見出し","body":"2〜3文の本文"} の形にし、出力は JSON オブジェクトのみ： {"articles":[ ... ]} 。前後の説明・コードブロック記号は書かないでください。`,
    1800
  );
  let articles = [];
  try {
    let txt = (out || "").replace(/```json|```/g, "").trim();
    const st = txt.search(/[\[{]/);
    const en2 = Math.max(txt.lastIndexOf("]"), txt.lastIndexOf("}"));
    if (st >= 0 && en2 > st) txt = txt.slice(st, en2 + 1);
    const parsed = JSON.parse(txt);
    articles = Array.isArray(parsed) ? parsed : (parsed.articles || []);
  } catch (err) {
    console.warn("AI-Map parse失敗:", err.message, "| raw:", (out || "").slice(0, 240));
  }
  articles = (articles || [])
    .filter(a => a && (a.title || a.body))
    .map(a => ({ title: (a.title || "記事").toString(), body: (a.body || "").toString() }))
    .slice(0, 6);

  // JSONにできなかったが本文はある場合は1本の記事として返す（空振り防止）
  if (!articles.length && out && out.trim()){
    articles = [{ title: `${ja}の${topic}`, body: out.replace(/```/g, "").trim().slice(0, 400) }];
  }
  if (!articles.length) console.warn(`AI-Map: 生成できず（${ja}/${topic}）ANTHROPIC=${!!ANTHROPIC} model=${AI_MODEL}`);

  if (!articles.length){
    return res.json({ ok:false, reason:"ai_failed",
      message:"AI記事を生成できませんでした。サーバーの ANTHROPIC_API_KEY とモデル設定（ANTHROPIC_MODEL）をご確認ください。" });
  }
  const payload = { ok:true, articles, count:articles.length };
  if (articles.length) cache.set(key, { t: Date.now(), data: payload });
  res.json(payload);
});

// コールドスタート対策: 稼働中は自分自身を定期的に叩いて休止を防ぐ（Render等）
if (process.env.RENDER_EXTERNAL_URL){
  const selfUrl = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "") + "/api/health";
  setInterval(() => { safeFetch(selfUrl, 8000).catch(() => {}); }, 10 * 60 * 1000);
  console.log("キープアライブ: 10分ごとに", selfUrl);
}

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
  console.log("DeepL翻訳:", DEEPL ? "有効" : "無効（DEEPL_KEY 未設定）");
  console.log("ウェブ検索:", braveReady() ? "Brave（有効・ウェブ全体）" : (googleReady() ? "Google CSE（有効）" : "無効（BRAVE_KEY 等 未設定 → ニュースAPIを使用）"));
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
