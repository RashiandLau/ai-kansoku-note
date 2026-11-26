# AI観測ノート

AI 関連の公式更新、ニュース、OSS の動きを集め、日本語と英語の短い紙面を GitHub Pages に公開する。収集・検証・ビルドは Node.js 22 以上の標準機能で動く。Web Push の送信には `web-push` 3.6.7 を使い、`package.json` と npm が生成した `package-lock.json` で固定する。

GitHub Actions が毎日 05:17 JST（cron `17 20 * * *`）に収集する。`main` に当日の raw があれば変更せず終了し、手動起動もできる。定期実行は数時間遅延する場合もある前提で運用し、公開時刻は固定しない。Dot は毎日 15:00 と 18:00 JST に Codex の執筆タスクを開始する。執筆タスクはチェックアウト済みの `main` で当日の日英両原稿があれば「本日分は作成済み」、当日の raw がなければ「当日の raw がまだない」と報告して PR を作成せず終了する。raw がある場合だけ両言語の原稿を作る。PR の検証が成功すると自動で squash merge し、`main` を対象に `publish.yml` を起動して、記事ができ次第公開する。公開ワークフローの定期実行は設けず、push と手動起動を使う。

文章は [AGENTS.md](AGENTS.md) の手順と、日本語の [WRITING.md](WRITING.md)、英語の [WRITING.en.md](WRITING.en.md) に従う。公開ファイルは `site/` に生成され、Git には含めない。

# ローカルで確認

同梱の紙面を検証してビルドする。

```sh
node scripts/validate.mjs 2026-11-15
node scripts/build.mjs
node --test --test-isolation=none
node scripts/notify.mjs --date 2026-11-15 --dry-run
```

`site/index.html` が最新号、`site/YYYY-MM-DD.html` が日別の紙面になる。英語版は `site/en/` 以下の同じ構成で、ヘッダーから同じ日付の別言語版へ移動できる。各言語の data が欠けるか不正なら、その版は raw の見出しのみを掲載する。両版とも検索エンジン向けの `noindex` を維持する。ライブ収集は `node scripts/collect.mjs`、npm を使う場合は `npm run collect`、`npm run validate -- 2026-11-15`、`npm run build`、`npm test` でも実行できる。

fixture を使うとネットワークなしで収集を再現できる。同じ日付の raw があれば固定済みの内容を返し、再取得・再選択・状態更新は行わない。`state/seen.json` は Claude Code/Codex のリリース版番号、`state/usage.json` は使い方候補と全欄の掲載済み URL を管理する。

```sh
node scripts/collect.mjs --fixtures fixtures --date 2026-11-15 --now 2026-11-15T03:00:00Z
```

初回の結果を確認するときは、同梱の raw と state を変更せず、独立した出力先と状態ファイルを指定する。

```sh
node scripts/collect.mjs --fixtures fixtures --date 2026-11-15 --now 2026-11-15T03:00:00Z --out .tmp/demo --state .tmp/demo/state/seen.json
```

同じ日付・出力先で再実行すると固定済み raw を再利用する。初回収集を再現するには新しい `.tmp/` 内の出力先を使う。明示した独立出力先での fixture 実行はその下に検証用の usage 状態も保存する。生成された raw を読んで `.tmp/demo/data/2026-11-15.json` と `.tmp/demo/data/2026-11-15.en.json` を執筆すれば、`node scripts/validate.mjs 2026-11-15 --root .tmp/demo` と `node scripts/build.mjs --root .tmp/demo` で確認できる。

fixtures は収集形式を検証するための保存済みスナップショットであり、現在のニュースの確認結果ではない。RSS、JSON、HTML の抽出を利用し、HTML は正規表現による抽出である。ブラウザで JavaScript を実行しないため、動的表示や配信元の構造変更によって取得できない情報がある。収集結果と失敗の記録を確認する。

# 使い方 / How people use AI

実践記事を既存の記事欄の後、ランキングの前に最大5件掲載する。日本語2件・英語1件を先に確保し、同一言語3件、掲載元2件、著者キー1件を上限とする。0〜2件の日はその件数のままにし、0件なら欄を表示しない。閾値の自動緩和や AI 執筆者による補充・選び直しは行わない。

公開7日以内の記事について、v2 の本文条件と、A（はてブ10以上、または HN20点・3コメント以上）か B（Zenn/Qiita 保存10以上・いいね5以上・保存比率0.25以上）を満たしたものを採る。例外の C は Simon Willison の `/atom/entries/` の英語長文のみで、800語以上、指定された実践タグを含み、`llm-release` / `live-blog` を含まないことを条件とする。承認済み著者リストは [config/usage-rules.json](config/usage-rules.json) に固定し、**所有者の明示的な決定がある場合だけ変更する**。詳しい辞書、日付境界、順位、取得上限は [docs/usage.md](docs/usage.md) を参照。

使い方欄の本番取得元は Zenn の12トピック、Qiita API v2 の日次最大2回の一覧、はてな IT/総合の現在の RSS と件数 API、日付分割した HN Algolia、Simon の entries Atom に限る。これは使い方欄の制限で、既存の公式ニュース・GitHub 急上昇欄の取得元は変えない。ソースの失敗は `raw.usageSources` に `missing` / `forbidden` / `truncated` として残し、他の収集を止めない。正常取得は `ok`。記事本文の全文は公開 raw に保存せず、筆者への帰属を明示した要約に使う600文字以内の平文抜粋とメタデータだけを残す。

`state/usage.json` の pending は公開＋7日まで毎日再確認し、初合格時に `firstQualifiedAt` を記録する。seen は過去 raw の selected URL と当日の他欄から初期化・更新し、14日を超える記録を削除する。URL 正規化は追跡クエリと fragment を除き、意味のあるクエリは残す。本番 usage 状態を書き込むのは `collect.yml` だけで、執筆・検証・ビルドは書き込まない。ローカルのライブ収集は usage 状態を保存しない。raw と状態をステージしたうえで raw を最後に確定し、Actions は両方を同じコミットに含める。

# GitHub と Dot の設定

GitHub の Pages の公開元を **GitHub Actions** にする。リポジトリでは Actions に必要な書き込み権限を認め、GitHub Actions による PR の操作と squash merge を許可する。ブランチ保護がある場合は、このワークフローのマージが許される設定にする。ワークフローの追加だけでは、これらのリポジトリ設定や Dot の定期実行は有効にならない。

Codex cloud の対象環境では **インターネットアクセスを OFF** にする。執筆タスクは収集済み raw だけを使い、`node scripts/collect.mjs` を実行しない。当日の raw がなければ「当日の raw がまだない」と報告して終了する。

# dot に登録する依頼文

Dot の定期タスク設定には次を貼り付ける。

```text
毎日 15:00 と 18:00 JST に、リポジトリ RashiandLau/ai-kansoku-note を対象に Codex cloud task を開始する。プロンプト: 「AGENTS.md の手順で今日の紙面データ（日本語版と英語版）を作成し、data/ の2ファイルだけを変更するPRを作成して」。作成済み・raw未着で終了した場合は通知しない。失敗した場合だけ通知する。
```

PR 検証ではイベント時点のベースコミットにある信頼済みスクリプトだけを実行する。変更可能なのは同じ日付の日本語・英語 data の2ファイルだけで、raw や state の変更は認めない。検証には信頼済みベースの raw を直接読み、候補側の raw は使用しない。ベースに当日の raw がなければ検証は失敗する。両 data は通常ファイルに限り、シンボリックリンクを認めない。変更パス一覧をイベントの不変な差分と照合し、検証した HEAD と一致するときだけマージする。

`pull_request` イベントでは deploy ジョブを実行しない。`GITHUB_TOKEN` によるマージは別の push ワークフローを起動しないため、マージ成功後に `gh workflow run publish.yml --ref main -f notify_date=YYYY-MM-DD` で新しい実行を起動する。この起動には check ジョブの `actions: write` 権限を使う。Pages 公開成功後、日付入力がある実行だけ通知する。手動で公開する際も任意の `notify_date` を指定でき、空なら通知しない。fork 由来の PR や権限制約がある環境では自動マージできない場合がある。

収集の raw push は通常の push 起動では原稿がなくても見出しのみの紙面を生成する。ただし `GITHUB_TOKEN` 自身による push は別ワークフローを起動しないため、収集ワークフローは変更を push した後に公開を明示起動する。収集後の公開では `notify_date` を渡さない。

# iPhone の通知登録

iOS 16.4 以降のホーム画面に追加した PWA から登録する。日本語版のフッターにだけ通知設定がある。

1. Safari で日本語版を開き、共有メニューからホーム画面に追加する。
2. ホーム画面のアイコンから開き、「通知を受け取る」をタップして通知を許可する。
3. 表示された「登録コード」をコピーまたは共有して管理者に送る。既に購読済みなら同じコードを再表示できる。
4. 管理者はコードの JSON オブジェクトを配列にまとめ、リポジトリの Actions secret `PUSH_SUBSCRIPTIONS` に設定する。1件でも配列にする。登録コードはファイルやGitに保存しない。
5. Actions secret `VAPID_PRIVATE_KEY` に既存の秘密鍵を設定する。対応する公開鍵と subject は `config/push.json` に保存している。

通知は日本語トップ記事の見出しと日付ページへのリンクを含み、有効期間は12時間。404/410の警告が出た購読は期限切れなので、secret 内の該当コードを更新する。ログの短い endpoint ハッシュで対象を識別し、endpoint や鍵自体はログに出さない。secret 未設定時は通知を省略して正常終了し、送信失敗でも公開ジョブは失敗にしない。同じ日付を指定して手動起動すると再送される。

ローカルで実送信する場合は `npm ci --omit=dev` で固定済み依存を用意し、両 secret を環境変数に設定して `node scripts/notify.mjs --date YYYY-MM-DD` を実行する。`--dry-run` は送信せずに確認するためのオプションである。サイトの service worker は `/ai-kansoku-note/` をスコープとし、通知の表示と日付ページを開く処理を担当する。
