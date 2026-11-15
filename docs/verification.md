# 実装・検証記録

実行環境はWindows PowerShell、Node.js v24.19.0。実装はNode.js 22以上の組み込み機能を使用し、依存パッケージは追加していない。ネットワークへの実リクエストとGitの状態変更コマンドは実行していない。fixtures/とref/は読み取りにのみ使用した。

## 作成したファイル

- `scripts/collect.mjs`, `scripts/validate.mjs`, `scripts/build.mjs`
- `scripts/lib/core.mjs`, `scripts/lib/parsers.mjs`, `scripts/lib/selection.mjs`, `scripts/lib/render.mjs`, `scripts/lib/style.mjs`
- `test/core.test.mjs`, `test/parsers.test.mjs`, `test/collect.test.mjs`, `test/validate.test.mjs`, `test/build.test.mjs`, `test/e2e.test.mjs`
- `.github/workflows/collect.yml`, `.github/workflows/publish.yml`
- `AGENTS.md`, `WRITING.md`, `README.md`, `package.json`, `.gitignore`
- `raw/2026-11-15.json`, `data/2026-11-15.json`, `state/seen.json`
- `docs/implementation-plan.md`, `docs/verification.md`
- 生成物: `site/index.html`, `site/2026-11-15.html`, `site/archive.html`, `site/.nojekyll`, `site/manifest.webmanifest`, `site/icon.svg`

## 実行結果

| 実行 | 結果 |
| --- | --- |
| `node --test` | このsandboxで子プロセス起動が `spawn EPERM`。20回再試行しても実行できなかった。 |
| `node --test --test-isolation=none` | 72 tests、72 pass、0 fail、0 skipped。 |
| `node scripts/collect.mjs --fixtures fixtures --date 2026-11-15 --now 2026-11-15T03:00:00Z` | 14件選択、収集エラー0件。 |
| `node scripts/validate.mjs 2026-11-15` | 検証成功、終了コード0。 |
| `node scripts/build.mjs` | 1日分のページと共通ファイルを生成、終了コード0。 |
| `--changed-files`へ有効なdataパスを標準入力 | 終了コード0。scriptsのパスは日本語・英語の理由付きで終了コード1。 |
| `node scripts/validate.mjs 2026-02-30` | 不正日付の理由付きで終了コード1。 |

サンプルは記事9件、GitHubランキング5件、Hugging Faceモデル3件。元投稿ボタンは17個で、日本語記事の見出しがrawと一致することと、index.htmlと日付ページの一致を別途確認した。

E2Eでは一時ディレクトリへ収集し、rawのIDから検証用dataを作成、検証、ビルドまで実行した。dataの欠落、JSON構文エラー、記事欠落のそれぞれで見出しのみの表示を確認した。通信処理の並行数、タイムアウト、リダイレクト時のGitHubトークン制限、エラー応答のbody解放は、実通信せず応答を注入して確認した。

## ソース別の解析上の注意

| ソース | 注意・確認範囲 |
| --- | --- |
| Claude Code | `## x.y.z` のセクションを数値順に扱う。元のCHANGELOGに公開日がないためpublishedは取得日時。同一URLでも別バージョンは残し、本文は3000文字で切る。 |
| Codex | `rust-vx.y.z`、`x.y.z`形式に対応。draft、prerelease、alpha/beta/rcを除外し、本文は3000文字で切る。APIの取得対象は指定どおり先頭10リリース。 |
| Hacker News | タイトルの語境界を使う固定フィルター。タイトルに対象語がないAI記事は選ばれない。作成日時で36時間窓を判定し、更新日時は使わない。 |
| 公式RSS/Atom | 5つのRSS fixtureと合成Atomを確認。一般的なitem/entryと日付フィールドを正規表現で抽出するため、完全なXMLパーサーではない。固定時刻ではGoogleのfixture記事は期間外で、選択0件。 |
| ITmedia AI＋ / @IT | AI＋は期間内全件、@ITは見出しでAI判定。説明だけにAIが現れる@IT記事は選ばれず、今回の@IT選択は0件。日本語見出しはrawの文字列をそのまま採用。 |
| GitHub Trending | `article.Box-row`内の見出し、説明、言語、スター表示に依存する。構造変更には追従が必要。日次のためpublishedは取得日時。 |
| Hugging Face Models | API応答のtrending順を保って作成14日以内の上位3件を選ぶ。作成日時基準なので、古いモデルの更新は対象外。 |
| 記事ページ・画像 | HTMLのOG属性と本文を抽出し、JavaScriptは実行しない。本文は空白を圧縮して1500文字以内。両article fixtureで解析を確認したが、fixture収集ではページ取得を省略するためサンプル画像は出典名入りの灰色表示。 |

URLの重複判定は指定どおりquery/hash/末尾スラッシュを除くため、queryだけで区別される別記事は同一URLとして扱われる。HNの重複先に議論情報を残し、再分類後にも日付順・スター順を保つ。HNとCodexリリースが重なる場合は本文を持つリリースを残す。

## 未実施の確認

ライブ収集、GitHub上のActions実行、自動マージ、Pagesへの実デプロイ、Dotの登録、実ブラウザ・実機での表示確認は行っていない。ワークフローは目視確認であり、外部YAML検証ツールの導入はしていない。リポジトリのPages・権限設定とDotの登録方法はREADMEに記載した。
