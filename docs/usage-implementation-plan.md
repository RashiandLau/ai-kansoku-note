# 使い方欄の実装・検証計画

承認済みの依頼と保存済み `usage-research.md`、`research-rules.json`、`research-analyze.py`、`research-backtest.py` を仕様とする。ネットワーク接続、依存追加、Git の状態変更、既存 raw/data/ref の編集は行わない。

- 判定：`config/usage-rules.json` と `scripts/lib/usage.mjs` に辞書、本文特徴、A/B/C、日付窓、順位、枠、pending/seen を集約する。研究コードと境界値をテストする。
- 取得：`scripts/lib/usage-sources.mjs` で許可された5系統の API/RSS と本文を扱う。保存済み縮約 fixture と注入した fetch/clock だけで形式、待機、403/429、上限、失敗分離を検証する。
- 統合：`scripts/collect.mjs` で既存欄を先に確定し、過去 raw と当日欄を usage の seen に反映する。`usage-store.mjs` で状態読込、書込権限、ステージ保存を分離する。同一号は固定 raw を再利用する。
- 表示・執筆：日英の usage 記事を既存記事欄の後、ランキングの前へ置く。収集済み抜粋だけから執筆し、id/category、字数、原題、禁則を検証する。スマートフォン幅も確認する。
- 完了条件：全 Node テスト、`validate.mjs 2026-11-15`、`build.mjs` を実行し、変更パスと禁止領域の非変更を確認する。実接続は未実施として報告する。

ルート C の順位は、研究の A→B の順を維持して C を末尾に追加する。同じ言語・掲載元・著者の上限を適用し、英語予約枠の対象にする。ルート C に人気の加点は与えない。
