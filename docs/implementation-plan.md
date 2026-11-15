# AI観測ノート 実装計画

仕様はこのセッションの依頼文。Node.js 22以上のESMと組み込み機能だけで、固定ルールによる収集、文章だけの編集データ検証、静的HTML生成を分離する。fixturesとrefは読み取り専用とし、実行時の一時ファイルもリポジトリ内に置く。ネットワーク接続、依存パッケージ追加、Gitの状態変更は実施しない。

- [x] 収集担当: `scripts/collect.mjs` とパーサーを実装。全fixture、時間窓、バージョン、重複URL、部分障害をテストした。
- [x] 描画担当: `scripts/build.mjs` と描画ヘルパーで参照デザインを移植。raw由来のリンク、記事分類、アーカイブ、PWA、欠稿時の見出し表示を確認した。
- [x] CI・文書担当: Actions、執筆手順、文体・JSONスキーマ、ローカル実行手順を作成した。PRは変更ファイルを制限し、信頼した検証コードで確認してから同じworkflowでデプロイする。
- [x] 統合担当: `scripts/validate.mjs` は `validateData(raw, data, expectedDate = raw.date): string[]` を公開。文字数、禁止表現、未知フィールド、IDの完全一致をテストした。
- [x] 統合担当: fixtureを `2026-11-15T03:00:00Z` に固定して収集し、日本語サンプルを執筆した。リポジトリの状態は一度だけ更新した。
- [x] 統合担当: リポジトリ内の一時ディレクトリでcollect→validate→buildのE2Eと欠稿・不正データのfallbackを実行。通常の `node --test` はsandboxのspawn EPERMで失敗し、20回再試行後も同じだった。`--test-isolation=none` では72件が成功した。サンプルのvalidateとbuildは直接実行で成功した。

raw.selectedは表示順のID配列。itemsはIDから記事への辞書。公開日がないCHANGELOGと日次ランキングでは取得時刻をpublishedに用い、その意味を記録する。同一CHANGELOG URLの複数バージョンは別記事として残す。HNの重複は公式・国内・ランキングの記事へ議論情報とtop指定を引き継ぐ。
