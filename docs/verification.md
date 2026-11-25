# 実装・検証記録

今回の対象は、日々の収集をGitHub Actionsに分離し、執筆PRを同じ日付の日本語・英語dataの2ファイルに戻す変更である。既存の英語版、Web Push、通知日付付き公開dispatch、service workerは維持する。ネットワークへの実リクエスト、依存パッケージの追加、Gitの状態変更コマンドは実行しない。fixtures/、ref/、raw/、state/、data/は変更しない。今回の統合検証結果を下表に記録する。

## 今回の変更

- 執筆手順: JSTの今日を確定した後、チェックアウト済みのmainで最初に日英dataを確認する。両方あれば「本日分は作成済み」、次にrawがなければ「当日の raw がまだない」と報告し、PRを作らず終了する。執筆タスクで収集は実行せず、Codex cloudのインターネットアクセスはOFFにする。
- 信頼境界: `scripts/validate.mjs`と`scripts/validate-writer-pr.mjs`で文章とPR変更範囲を検証する。変更は同じ日付の日英dataの通常ファイル2つだけに限定し、raw/state変更とsymlinkを拒否する。信頼済みベースのrawを直接読み、候補rawは使用しない。ベースrawがなければ検証は失敗する。
- Actions: 05:17 JST（cron `17 20 * * *`）の収集、手動起動、既存rawのスキップ。数時間の遅延も許容する。マージ後の通知日付付きdispatchとPages公開成功後の通知は維持する。
- Dot: 15:00と18:00 JSTの執筆依頼文をREADMEに記載する。作成済み・raw未着の終了は通知せず、失敗だけ通知する。Dotへの実登録は含まない。
- 文書: raw/stateを執筆PRに追加できる例外と、候補rawの検証に関する説明を削除する。

## 実行結果

| 実行 | 結果 |
| --- | --- |
| `node --test --test-isolation=none` | 236 tests、236 pass、0 fail、0 skipped。 |
| `node scripts/validate.mjs 2026-11-15` | 日英両版の検証成功、終了コード0。 |
| `node scripts/build.mjs` | 11日分を日英各版に生成、終了コード0。原稿のない11月16〜25日は両版とも想定どおり見出しのみ。 |
| `node scripts/notify.mjs --date 2026-11-15 --dry-run` | 終了コード0。`VAPID_PRIVATE_KEY`または`PUSH_SUBSCRIPTIONS`がないため送信を省略。 |
| CLIの変更範囲検証 | `validate.mjs --changed-files --root .`は保存済み11月15日の日英dataの組を受理。raw/stateを加えた4ファイルは拒否し、このコマンドから削除した`--base-root`は不明な引数として拒否。 |
| 開始時とのSHA-256照合 | fixtures/、ref/、raw/、state/、data/、.git/と保持対象の英語版・通知・依存ファイルの計235ファイルが一致。追加・削除もなし。 |

## 維持する機能と検証範囲

英語サンプルは日本語と同じ記事6件、GitHubランキング5件。Hugging Faceのモデル3件はrawから描画する。英語版の執筆規約、日英レンダリングと同日言語リンク、両版の欠稿fallbackは維持する。

E2Eの検証範囲はリポジトリ内の一時ディレクトリでのfixture収集、両言語dataの検証とビルド、両版の原稿、同日リンク、indexと日付ページの一致、service worker出力である。欠稿、JSON構文エラー、カテゴリ不一致などでは見出しのみを表示する。

通知のテストは偽の送信器とNode.jsのVMを使い、実通信しない。対象はpayload、raw.top優先、12時間TTL、secret不足、dry-run、404/410、複数購読の送信継続、秘密情報を含む例外のログ抑制である。ブラウザAPIを模したVMではiPhoneのホーム画面案内、許可操作、既存購読の再表示、コピー・共有、拒否と失敗、通知クリックのfocus/navigationを扱う。実機のWeb Push成功を証明するテストではない。

ワークフローは信頼済みベースの検証コード、イベント時点の不変な差分との照合、HEAD固定マージを維持する。通知日付は環境変数経由で渡し、形式をチェックしてから依存の準備・送信を行う。通知失敗は公開ジョブを失敗にしない。収集のGITHUB_TOKEN pushでは別ワークフローが起動しないため、変更がある場合だけ通知日付なしで公開を明示起動する。

収集では既存rawを確認したJST日付を収集コマンドとコミットメッセージにも渡す。実行中に日付が変わって別の日のrawを上書きすることを防ぐ。PR検証の対象はdata2ファイルの変更範囲、日付一致、信頼済みベースrawの存在と直接参照、通常ファイル条件、symlink拒否である。候補側のrawとstateを追加・変更しても執筆PRの例外にはならない。

## 今回の対象と保持する既存変更

| 対象 | ファイル |
| --- | --- |
| ワークフロー | `.github/workflows/collect.yml`, `.github/workflows/publish.yml` |
| 手順・記録 | `AGENTS.md`, `README.md`, `docs/implementation-plan.md`, `docs/verification.md` |
| 検証 | `scripts/validate.mjs`, `scripts/validate-writer-pr.mjs` |
| テスト | `test/validate.test.mjs`, `test/writer-workflow.test.mjs` |
| 使用先がなくなったため削除 | `scripts/validate-raw.mjs`, `test/validate-raw.test.mjs` |
| 既存の英語版を保持 | `WRITING.en.md`, `data/2026-11-15.en.json`, 日英レンダリング関連のコードとテスト |
| 既存の通知を保持 | `config/push.json`, `scripts/notify.mjs`, `scripts/lib/push.mjs`, 通知UI・service worker関連のコードとテスト |
| 開始時からあった依存変更を保持 | `package.json`, `package-lock.json`（今回手編集・再生成していない） |

`site/`以下の生成物と`.tmp/`のテスト記録はGit対象外である。

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

ライブ収集、GitHub上のActions実行、自動マージ、Pagesへの実デプロイ、Dotの登録、secret登録、iPhone実機の購読・受信は行っていない。ネットワーク禁止のため外部YAML検証ツールの導入やブラウザでの外部画像・フォント読み込みも行っていない。ワークフロー内のスコープ処理はJSの動作テスト、YAMLの条件・引数・権限はローカルの静的テストとレビューで確認する。運用設定と通知登録手順はREADMEに記載する。
