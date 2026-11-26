# 使い方欄の検証記録

2026-11-26。所有者の承認済みルールに基づくローカル実装。外部ネットワーク、依存追加、Git の状態変更コマンドは使用していない。

## 実行結果

| 検証 | 結果 |
| --- | --- |
| `node --test --test-isolation=none` | 339 tests、339 pass、0 fail、0 skipped |
| `node scripts/validate.mjs 2026-11-15` | 日英とも成功、終了コード0 |
| `node scripts/build.mjs` | 11日分を日英に生成、終了コード0。11月16〜25日は既存の原稿欠落により想定どおり見出しのみ |
| 調査コードとの照合 | 保存済み665記事の本文特徴量について、担当エージェントが Python `research-analyze.py` と Node の一致を確認。公開テストには短い3断片と Python の期待値を固定し、ルート担当も直接実行して成功を確認 |
| 書込失敗 | 状態置換後の失敗からの復元、固定 raw の再実行、同一号への同時保存拒否、別 cwd からの本番 usage 状態書込拒否を確認 |
| 画面 | 日英の順序、0〜2件、原記事/議論リンク、反応欠損、エスケープ、狭幅向けの折り返し CSS をテスト。オフライン Edge の実起動は `spawn EPERM` で拒否され、320/390/768px の実測と画像確認は未完了 |
| 変更範囲 | `raw/`、`data/`、`ref/`、既存 `state/`、`package.json`、`package-lock.json` は変更なし |

テストは保存済みレスポンスの縮約 fixture と合成入力のみを使う。収集→usage選出→日英data検証→ビルドの E2E も一時ディレクトリで実行し、収集・ビルド先を本番データと分けた。本文全文は raw/state に残らず、抜粋は600文字以内になることを確認した。

## 変更ファイル

| 範囲 | ファイル |
| --- | --- |
| 固定ルール・収集・状態 | `config/usage-rules.json`, `scripts/lib/usage.mjs`, `scripts/lib/usage-sources.mjs`, `scripts/lib/usage-store.mjs`, `scripts/collect.mjs`, `scripts/lib/selection.mjs`, `.github/workflows/collect.yml` |
| 表示・検証 | `scripts/lib/render.mjs`, `scripts/lib/style.mjs`, `scripts/validate.mjs` |
| 執筆・運用文書 | `AGENTS.md`, `WRITING.md`, `WRITING.en.md`, `README.md`, `docs/usage.md`, `docs/usage-implementation-plan.md`, `docs/usage-verification.md` |
| テスト | `test/usage.test.mjs`, `test/usage-sources.test.mjs`, `test/usage-store.test.mjs`, `test/usage-render.test.mjs`, `test/collect.test.mjs`, `test/build.test.mjs`, `test/e2e.test.mjs` |
| 縮約fixture | `fixtures/usage/README.md`, `features.json`, `hatena-count.json`, `hatena.xml`, `hn-article.html`, `hn.json`, `manifest.json`, `note.html`, `qiita-list.json`, `robots.txt`, `simon-entries.xml`, `zenn-article.json`, `zenn-list.json`（すべて `fixtures/usage/` 内） |

## 未実施・運用上の限界

ライブ収集、GitHub Actions 上の実行、Pages 公開は未実施。Simon の entries フィードのライブ応答は保存調査に含まれていないため、fixture は保存された長文記事から entries 形式へ変換した合成見本として明示している。実際の entries が summary のみなら、robots に従って元記事を取得し、本文として summary を代用しない。

ブラウザー起動の権限エラーは回避していない。目視確認と実機 iPhone 確認は残る。`site/` と `.tmp/` の生成物は Git 対象外。設定ファイルを含む変更は作業ツリーにあり、ユーザー指示どおりコミット・PR作成は行っていない。

ルート C は A/B の既存順序を維持して末尾に追加し、強度0、英語枠として扱う。これは今回の実装上の決定であり、元の A/B 参考試算が C の採用数を実証したものではない。
