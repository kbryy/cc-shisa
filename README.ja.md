# cc-shisa

> Claude Code の `PreToolUse` フックとして動く静的解析ツール — 安全な
> コマンドは黙って通し、危険なコマンドだけ止める沖縄シーサー。

🇬🇧 [English README](./README.md)

Claude Code の Bash 権限管理は、規模が大きくなると破綻します。手作りの
allowlist は long tail をカバーできず、denylist は穴だらけ、`pnpm
typecheck && pnpm build` のような複合コマンドはどちらの方式でも検出
できません。

cc-shisa は Claude Code が実行しようとする Bash コマンドをすべて監視
し、本物の AST にパースしてセグメントごとに分類、`allow` / `ask` /
`deny` を返します。これで `permissions.allow` を手作業で育てる必要が
なくなります。

名前は沖縄の守り神シーサー (獅子犬) に由来します。門前に対で置かれる
像の口の形 — 阿 (口を開けて招く) と吽 (口を閉じて防ぐ) — がそのまま
このツールの役割になっています。安全なコマンドを通し、危険なコマンドを
止める。

## ステータス

v0.2.3 公開済み。Homebrew tap (`kbryy/homebrew-tap`) は稼働中で、
リリースワークフローが tag 毎に自動でバイナリと Formula を公開して
います。実装済みの機能: パーサー、コンテンツ検査付き分類器
(`python -c` の中身解析)、9 クラスポリシー (`strict` / `safe` /
`loose` の 3 段階)、フック I/O、shadow モード、`init` / `modules` /
`level` / `logs` サブコマンド。

## インストール

```bash
brew tap kbryy/homebrew-tap
brew install cc-shisa
cc-shisa init      # ~/.claude/settings.json にフックを登録
```

ソースからビルドする場合:

```bash
git clone git@github.com:kbryy/cc-shisa.git && cd cc-shisa
mise install                 # mise.toml の bun バージョンを取得
bun install
bun run build                # darwin-arm64 用の ./cc-shisa を生成
./cc-shisa init              # ~/.claude/settings.json にフックを書き込む
```

## 何をブロックするか

組み込みの `_core.json` は約 23 個の致命的・不可逆パターンをカバー:

- `rm -rf /`、`$HOME`、`~`、`/Users/*`、`/etc`、`/usr`、`/var`、... (システムパス)
- `rm -rf .git` (リポジトリ破壊)
- `dd of=/dev/{disk,sd,nvme,hd,rdisk}*` (raw デバイス書き込み)
- raw デバイスへのシェルリダイレクト (`> /dev/sda`、`>> /dev/disk0`)
- `mkfs*`、`newfs*` (ファイルシステム作成)
- `fdisk` / `gdisk` / `parted` (パーティション操作)
- `diskutil eraseDisk` / `partitionDisk` / `secureErase` / ...
- 古典的な bash fork bomb
- `curl … | sh`、`wget … | bash` (zsh / fish / dash / ksh の派生も)
- `kill -9 1` / `killall -9 init` (PID 1 への SIGKILL)
- システムパスへの再帰的 `chown`
- `chmod -R 777` / `a+rwx`
- `git push --force` / `-f` / `--force-with-lease` / `--delete`
- `git reset --hard`
- `shred` / `srm` / `wipe`
- `rsync --delete`
- `gpg --delete-secret-keys`
- `eval` / `bash -c` / `sh -c` / `zsh -c`
- 言語ランタイムの inline `-e` / `--eval` / `-c` (`node -e`、
  `python -c`、`perl -e`、`ruby -e` など — 後述の
  [Python `-c` インスペクター](#python--c-) 参照)

ツール固有のモジュール (git、gh、npm、pnpm、yarn、bun、docker、
kubectl、cargo、brew、coreutils) は `cc-shisa modules` でオプトイン
有効化でき、数百種類の通常作業コマンドを `local.read` / `local.write`
/ `remote.read` に分類して `ask` 連発を防ぎます。

## 判定の流れ

```
                 標準入力に PreToolUse JSON
                          │
                          ▼
     parse → 複合コマンドをセグメントに分解
                          │
                          ▼
     normalize → sudo / timeout / env 系のラッパーを剥がす
                          │
                          ▼
     classify → ルールにマッチさせ、最も厳しいクラスを選ぶ
                          │
                          ▼
     policy → クラスを allow / ask / deny にマッピング
                          │
                          ▼
            標準出力に HookOutput JSON (exit 0)
```

すべての失敗系 (構文エラー、未知のバイナリ、解決不能な変数、内部例外
など) は `ask` にフォールバックします。

## ロギング

cc-shisa はデフォルトオフのモードを 2 つ持ち、いずれも
`${XDG_STATE_HOME:-~/.local/state}/cc-shisa/decisions.jsonl` に
JSONL を書き込みます:

```bash
# 監査のみ: enforce はそのまま、すべての判定をログに残す
export CC_SHISA_LOG=1

# シャドウ: すべての判定を強制的に "allow" にしてログに残す
# 最初の 1 週間ほど、ルールが想定通りか観察するのに使う
export CC_SHISA_SHADOW=1
```

両方セットすると `CC_SHISA_SHADOW` が勝ちます (1 判定あたり 1 ログ
エントリ、action は allow に固定)。

推奨ロールアウト:

1. `CC_SHISA_SHADOW=1` で約 1 週間運用
2. ログを確認:
   - `originalAction:"deny"` 行 — ブロックしようとしたもの。本当に
     危険だったか?
   - `originalAction:"ask"` 行 — プロンプトしようとしたもの。頻度は
     許容範囲か?
3. 必要なら `_core.json` を調整
4. `unset CC_SHISA_SHADOW` で Claude Code を再起動して enforce モードへ
   `CC_SHISA_LOG=1` は残しておけば監査ログだけ取り続けられます

## 単一コマンドを試す

```bash
cc-shisa check 'rm -rf /'
# Action:  deny
# Class:   dangerous
# Reason:  rm -rf against filesystem root
# Rule:    core.rm.rf.root
# Segment: rm -rf /
```

## ルールフィクスチャを実行

```bash
cc-shisa test                              # 標準ケース (約 220 件)
cc-shisa test tests/fixtures/redteam.json  # 難読化 / 回避ケース
```

これは hook と同じパイプラインでフィクスチャデータを評価するので、
インストール済みのバイナリの動作を既知のコーパスで検証するのに使え
ます。注意: 標準スイートは全モジュール有効化を前提としているので、
事前に `cc-shisa modules pick` で全モジュールを ON にするか、一時
プロファイルで `loose` を使ってください。

## モジュール

cc-shisa は必須の安全ベースライン (`_core`) と、よく使うコマンドを
read-only として分類するオプトインモジュール群を同梱しています。
インストール直後は `_core` のみ有効。実際に使うモジュールを選ぶ:

```bash
cc-shisa modules                         # 対話ピッカー (TTY) / list (非TTY)
cc-shisa modules list                    # ステータス込みで一覧表示
cc-shisa modules enable coreutils git    # 有効化
cc-shisa modules disable gh              # 無効化
cc-shisa modules pick                    # 明示的にピッカー起動
```

設定は `~/.config/cc-shisa/profile.json` に書き込まれます。Claude
Code を再起動するか、次回の hook 発火時に反映されます。

組み込みモジュール:

| 名前        | デフォルト | 内容                                          |
|-------------|------------|----------------------------------------------|
| `_core`     | 常時       | 約 23 個の致命的 + 不可逆パターン。**無効化不可** |
| `coreutils` | off        | `ls`/`cat`/`grep`/`wc`/`pwd`/...              |
| `git`       | off        | `git status`/`log`/`diff`/`show`/...          |
| `gh`        | off        | `gh pr list`/`view`、`gh issue list`/...      |
| `bun`       | off        | `bun test`/`bun run test/typecheck/lint`/...  |
| `npm`       | off        | `npm test`/`npm run lint`/`npm ls`/...        |
| `pnpm`      | off        | `pnpm test`/`typecheck`/`lint`/...            |
| `yarn`      | off        | `yarn test`/`yarn run lint`/`yarn list`/...   |
| `docker`    | off        | `docker ps`/`logs`/`inspect`/...              |
| `kubectl`   | off        | `kubectl get`/`describe`/`logs`/...           |
| `cargo`     | off        | `cargo check`/`build`/`test`/`fmt`/`clippy`/...|
| `brew`      | off        | `brew list`/`info`/`outdated`/`search`/...    |

カスタムモジュールは `~/.config/cc-shisa/modules/*.json` に置けます:

```json
{
  "name": "our-team",
  "rules": [
    {
      "id": "team.no-prod",
      "match": "regex",
      "pattern": "kubectl.*--context=prod",
      "class": "dangerous",
      "reason": "本番クラスタに触るのはオンコールだけ"
    }
  ]
}
```

ユーザーモジュールは自動ロードされ、`enable` する必要はありません。
strictest-class-wins ロジックにより `_core` を緩めることはできない
ので、安全に追加できます。

## セキュリティレベル

cc-shisa は 3 段階のレベル `strict` / `safe` (デフォルト) / `loose`
を提供します。状況に応じて切り替えてください:

```bash
cc-shisa level                  # 現在の level + マッピングを表示
cc-shisa level list             # すべての組み込み level を一覧
cc-shisa level set strict       # ~/.config/cc-shisa/profile.json に書き込む
```

クラス別マッピング:

| Class                   | `strict` | `safe` (default) | `loose` |
|-------------------------|----------|------------------|---------|
| `dangerous`             | deny     | deny             | deny    |
| `dynamic`               | ask      | ask              | allow   |
| `unknown`               | ask      | ask              | allow   |
| `local.read`            | allow    | allow            | allow   |
| `local.write`           | allow    | allow            | allow   |
| `local.write.destroy`   | ask      | ask              | allow   |
| `remote.read`           | allow    | allow            | allow   |
| `remote.write`          | **deny** | allow            | allow   |
| `remote.write.destroy`  | **deny** | ask              | allow   |

階層: 場所 (`local.*` / `remote.*`) を上位、操作 (`read` / `write`)
を下位に配置。`write` には不可逆操作用の `destroy` サブバケットが
あります (`git reset --hard`、`git push --force`、`shred`、
`rsync --delete` など)。階層に乗らないフラットな 3 つの special:
`dangerous` (確認済み致命的パターン)、`dynamic` (cc-shisa が中身を
見えないもの — eval / bash -c / curl|sh / node -e)、`unknown`
(どのルールにもマッチしない)。

- `strict` は共有リソース環境 (会社・チーム) 向け。Claude が他人に
  見える状態を勝手に書き換えないよう、リモート書きをすべて deny。
- `safe` は日常的な default — リスキーなものは ask、routine は通す。
- `loose` は信頼できる手元のマシン、サンドボックス、CI agent 向け。
  `dangerous` だけブロックして、それ以外は通します。

クラス別の override は `~/.config/cc-shisa/profile.json` で設定可能
(例: `"overrides": { "dynamic": "deny" }`)。リポジトリ別設定
(`.claude/cc-shisa.json`) は v0.4 で対応予定。

## インタープリター `-c` / `-e` の中身解析

`bash -c` / `python -c` / `node -e` のように構築済み文字列を実行する
コマンドは通常 `dynamic` (cc-shisa が中身を見られない) として分類
されます。言語インタープリターの inline 形式に対しては、cc-shisa が
言語別の regex インスペクターをかけて class を refine します。

対応バイナリ:
- Python: `python` / `python3` / `python2`
- JS / TypeScript ランタイム: `node` / `nodejs` / `bun` / `tsx` /
  `ts-node` / `deno` (Deno は共通パターンに加えて `Deno.*`
  名前空間 — `Deno.run`、`Deno.writeTextFile`、`Deno.serve` 等)
- Ruby: `ruby` / `irb`
- Perl: `perl`

判定形は言語をまたいで同じ — 組み込み DENY パターンと user
whitelist で最も厳しい match を採用します:

| `-c`/`-e` の内容                                                          | 分類後の class       |
|---------------------------------------------------------------------------|---------------------|
| シェル起動 / 子プロセス起動                                                | `dangerous`         |
| ファイル削除 (rm / unlink / rmtree / FileUtils.rm_rf)                      | `local.write.destroy` |
| ネット送信 (HTTP POST/PUT/DELETE、socket bind/listen、HTTP server)         | `remote.write`      |
| ネット取得 (HTTP GET、urllib request、fetch、Net::HTTP.get、LWP)           | `remote.read`       |
| ファイル書き込み (open w/a、makedirs、writeFile、File.write)               | `local.write`       |
| 純粋な `print` / `console.log` / `puts` リテラル / 算術                    | `local.read`        |
| 動的構文 (eval、vm.runIn*、instance_eval、eval-block)                      | `dynamic` のまま     |
| 上記いずれにも当たらない                                                   | `dynamic` のまま (ask) |

プロジェクト固有のライブラリは言語別に
`~/.config/cc-shisa/interpreter.json` で whitelist できます:

```jsonc
{
  "python": {
    "modules": {
      "pandas":   "local.read",
      "numpy":    "local.read",
      "polars":   "local.read",
      "httpx":    "remote.read",
      "boto3":    "remote.write"
    }
  },
  "node": {
    "modules": {
      "axios":    "remote.read",
      "esbuild":  "local.write",
      "prettier": "local.write"
    }
  },
  "ruby": {
    "modules": {
      "faraday":  "remote.read",
      "oj":       "local.read"
    }
  }
}
```

インスペクターが `import` (Python) / `require` / `from … import`
(Node) / `require` (Ruby) / `use` (Perl) で whitelist 登録された
モジュールを検出すると、ユーザー指定の class でセグメントを分類
します。組み込み DENY パターンと strictest-wins で合成されるので、
危険なシステムコールが混在していれば依然 `dangerous` 判定になります。

## パーサーバックエンド

cc-shisa は Bash コマンドを AST にパースしてから分類します。2 つの
バックエンドが同梱されており `CC_SHISA_PARSER` で切替可能:

| バックエンド | デフォルト | 利点 | 欠点 |
|---|---|---|---|
| `bash-parser` | ✅ | 純 JS、追加ランタイム不要、cold start ~22ms | 特定エッジケース (quoted heredoc 内の `(parens)` 等) で失敗 |
| `tree-sitter` |   | 堅牢な grammar、実世界の bash を網羅 | +~7ms cold start、+1.6 MB バイナリ |

active backend の parse が失敗した場合、cc-shisa は次の順で recovery:

1. quoted-heredoc body を空にして再 parse
2. 行単位で split し各行を独立 parse
3. 全部ダメなら `ask` (理由: "parser failed")

通常 recovery で十分なので、大半のユーザーは切り替え不要。tree-sitter
を試したい場合:

```bash
export CC_SHISA_PARSER=tree-sitter
```

## ドキュメント

- [`CLAUDE.md`](./CLAUDE.md) — エージェント向けコンテキスト:
  アーキテクチャ、クラスシステム、フックプロトコル、決定ログ。
  AI アシスタントやコントリビューターはこちらを最初に読んでください。

## ライセンス

MIT — [`LICENSE`](./LICENSE) を参照。
