# AI観測ノート

AI 関連の公式更新、ニュース、OSS の動きを集め、日本語の短い紙面を GitHub Pages に公開する。Node.js 22 以上の標準機能だけで動き、依存パッケージのインストールは不要。

毎日 06:00 JST に GitHub Actions が素材を `raw/` へ収集する。06:30 JST に Dot から Codex の執筆タスクを開始し、`data/` の 1 ファイルだけを変更する PR を作る。PR の検証が成功すると自動で squash merge し、`main` を対象に `publish.yml` の新しい実行を起動して公開する。07:30 JST の定期実行でも公開を試みる。GitHub Actions の定期実行には遅延があり得る。

文章は [AGENTS.md](AGENTS.md) の手順と [WRITING.md](WRITING.md) の規約に従う。公開ファイルは `site/` に生成され、Git には含めない。

# ローカルで確認

同梱の紙面を検証してビルドする。

```sh
node scripts/validate.mjs 2026-11-15
node scripts/build.mjs
node --test
```

`site/index.html` が最新号、`site/YYYY-MM-DD.html` が日別の紙面になる。ライブ収集は `node scripts/collect.mjs`、npm を使う場合は `npm run collect`、`npm run validate -- 2026-11-15`、`npm run build`、`npm test` でも実行できる。

fixture を使うとネットワークなしで収集を再現できる。基本のコマンドは次のとおりで、raw と state をリポジトリ内に書き出す。既存の `state/seen.json` に登録済みの記事は重複除外されるため、同梱データがある状態で実行すると記事数が初回と異なる。

```sh
node scripts/collect.mjs --fixtures fixtures --date 2026-11-15 --now 2026-11-15T03:00:00Z
```

初回の結果を確認するときは、同梱の raw と state を変更せず、独立した出力先と状態ファイルを指定する。

```sh
node scripts/collect.mjs --fixtures fixtures --date 2026-11-15 --now 2026-11-15T03:00:00Z --out .tmp/demo --state .tmp/demo/state/seen.json
```

同じ出力先で再実行すると、その状態ファイルによる重複除外が働く。初回収集を再現するには新しい `.tmp/` 内の出力先と状態ファイルを使う。生成された raw を読んで `.tmp/demo/data/2026-11-15.json` を執筆すれば、`node scripts/validate.mjs 2026-11-15 --root .tmp/demo` と `node scripts/build.mjs --root .tmp/demo` で確認できる。

fixtures は収集形式を検証するための保存済みスナップショットであり、現在のニュースの確認結果ではない。RSS、JSON、HTML の抽出を利用し、HTML は正規表現による抽出である。ブラウザで JavaScript を実行しないため、動的表示や配信元の構造変更によって取得できない情報がある。収集結果と失敗の記録を確認する。

# GitHub と Dot の設定

GitHub の Pages の公開元を **GitHub Actions** にする。リポジトリでは Actions に必要な書き込み権限を認め、GitHub Actions による PR の操作と squash merge を許可する。ブランチ保護がある場合は、このワークフローのマージが許される設定にする。ワークフローの追加だけでは、これらのリポジトリ設定や Dot の定期実行は有効にならない。

# dot に登録する依頼文

Dot の定期タスク設定には次を貼り付ける。

```text
毎日 06:30 JST に、リポジトリ RashiandLau/ai-kansoku-note を対象に Codex cloud task を開始する。
タスクへのプロンプトは次の文をそのまま使う。
AGENTS.md の手順で今日の紙面データを作成し、data/ の1ファイルだけを変更するPRを作成して
通知は失敗した場合だけ行う。
```

PR 検証では main 側の信頼済み validator と raw を使い、PR 側のプログラムを実行しない。変更は日付付き data 1 ファイルに限定し、検証したコミットに一致するときだけマージする。`pull_request` イベントでは deploy ジョブを実行しない。`GITHUB_TOKEN` によるマージは別の push ワークフローを起動しないため、マージ成功後に `gh workflow run publish.yml --ref main` で `workflow_dispatch` の新しい実行を起動する。この起動には check ジョブの `actions: write` 権限を使い、Pages への公開は `main` を対象とする新しい実行が担当する。fork 由来の PR や権限制約がある環境では自動マージできない場合がある。
