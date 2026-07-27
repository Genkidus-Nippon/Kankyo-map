# I-MAP

世界地図から情報にアプローチするプラットフォーム。現在3つの地図を収録しています。

- **環境世界地図** … テーマ検索 → 国をダブルクリック → 環境ニュース（信頼ソース優先・日本語化）
- **歴史世界地図** … 歴史テーマ検索 → 国をダブルクリック → 関連する日本語Wikipedia記事＋AI概説
- **作物世界地図** … 作物名で検索 → 収量で世界地図を赤(多)〜青(少)に着色 → 国クリックで生産量・順位・品種などの詳細

トップ（HOME）は「I-MAP」で、右上メニューから各地図・About・問い合わせに移動できます。

## 起動
```bash
npm install      # 初回のみ
npm start        # → http://localhost:3000
```
Windowsは `start-windows.bat`、Macは `start-mac.command` をダブルクリックでも起動できます。

## 環境変数（.env またはホストの環境変数）
| 変数 | 用途 | 必須 |
|------|------|------|
| `CURRENTS_KEY` | 環境ニュース（Currents API） | 推奨（無ければGDELT併用） |
| `ANTHROPIC_API_KEY` | 見出しの日本語翻訳・AI概況・歴史概説・作物の品種補足 | 任意（無ければ英語見出し・概況なし） |
| `ANTHROPIC_MODEL` | 使用モデル（既定 claude-haiku-4-5-20251001） | 任意 |
| `RESEND_KEY` | 問い合わせメール送信（HTTPS。Render等で確実） | 任意 |
| `SMTP_*` / `MAIL_TO` / `MAIL_FROM` | 問い合わせメール送信（ローカル向け） | 任意 |

## データソース
- 環境ニュース: Currents API（日本語優先）→ 不足時 GDELT。信頼できる報道・公的機関のドメインに絞り込み。
- 歴史: 日本語版 Wikipedia 検索API（実在記事・直リンク）。
- 作物: FAOSTAT をもとにした概算データ（`crops-data.js` に同梱、年次明記）。主要作物・主要生産国の代表値で、網羅ではありません。
- AI: 翻訳・概況・品種補足は Anthropic API。事実に基づく範囲に限定し、存在しない出典やURL・統計数字は生成しません。AI生成部分は「参考情報」と明示します。

## 収録作物（現在）
米 / 小麦 / とうもろこし / 大豆 / コーヒー / じゃがいも
（`crops-data.js` に国と生産量を追記すれば拡張できます）

## API エンドポイント
- `GET /api/news?country=&country_en=&topic=` … 環境ニュース
- `GET /api/history?country=&topic=` … 歴史（Wikipedia＋AI）
- `GET /api/crops?crop=` … 作物の国別データ（着色用）
- `GET /api/crop-detail?crop=&country=&country_ja=` … 作物のクリック詳細
- `POST /api/contact` … 問い合わせ
- `GET /api/health` … 稼働・設定の確認
