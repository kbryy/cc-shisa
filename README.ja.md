# cc-shisa

> Claude Code の `PreToolUse` フックとして動く静的解析ツール。安全な
> コマンドは黙って通し、危険なコマンドだけ止める沖縄のシーサーです。

🇬🇧 [English README](./README.md)

Claude Code の Bash 権限管理は規模が大きくなるほど辛くなります。
allowlist は手で書き続けないと long tail に追いつきませんし、denylist
には穴がいくらでも開きます。`pnpm typecheck && pnpm build` のような
複合コマンドはそもそもどちらの方式でも素直に書けません。

cc-shisa は Claude Code が実行しようとする Bash コマンドを毎回受け取り、
本物の AST にパースしてセグメントごとに分類し、`allow` / `ask` /
`deny` を返します。これで `permissions.allow` を手で育て続ける必要は
なくなります。

名前は沖縄の守り神シーサー (獅子犬) から取りました。門前に対で置かれる
像の口の形 — 阿 (口を開けて招き入れる) と吽 (口を閉じて防ぐ) — が
そのままこのツールの役割になっています。安全なコマンドは通し、危険な
コマンドは止める。

## インストール

```bash
brew tap kbryy/homebrew-tap
brew install cc-shisa
cc-shisa init      # ~/.claude/settings.json にフックを登録
```

これで完了です。Claude Code を再起動するか、次に Bash が呼ばれた時点で
cc-shisa が割り込みを始めます。

ちゃんと動いているか確認するには:

```bash
cc-shisa check 'rm -rf /'
# Action:  deny
# Class:   dangerous
# Reason:  rm -rf against filesystem root
```

## 何をブロックするか

必須で常に有効な `_core` セットが、致命的・不可逆な約 23 パターンを
最初からブロックします:

- `rm -rf` で `/`、`$HOME`、`~`、`/Users/*`、システムパス、`.git` を
  消そうとするケース
- `dd` やシェルリダイレクトで raw デバイスへ書き込むケース
  (`/dev/disk*`、`/dev/sd*` など)
- `mkfs*`、`newfs*`、`fdisk` / `gdisk` / `parted`、`diskutil eraseDisk`
- 古典的な bash fork bomb
- `curl … | sh` / `wget … | bash` (zsh / fish / dash / ksh の派生も)
- `kill -9 1` / `killall -9 init`
- システムパスへの再帰的な `chown` / `chmod 777` / `a+rwx`
- `git push --force` / `--delete`、`git reset --hard`
- `shred` / `srm` / `wipe`、`rsync --delete`、`gpg --delete-secret-keys`
- `eval`、`bash -c`、`python -c`、`node -e` など (一部のインタープリタ
  については中身まで見ています — 後述「インタープリタの `-c` / `-e`
  を読む」を参照)

`_core` は常時ロードされ、無効化できません。これに加えて、`git`、
`gh`、`npm`、`pnpm`、`yarn`、`bun`、`docker`、`kubectl`、`cargo`、
`brew`、`coreutils` といったオプションモジュールを有効にしておくと、
日常的に使うコマンドのほとんどが安全側に分類され、毎回 `ask` で
止められることがなくなります。

## モジュールを選ぶ

インストール直後は `_core` のみが有効です。実際に使うモジュールを
選んで有効化してください:

```bash
cc-shisa modules                         # 対話ピッカー (TTY) / リスト表示 (非TTY)
cc-shisa modules enable coreutils git    # 有効化
cc-shisa modules disable gh              # 無効化
```

設定は `~/.config/cc-shisa/profile.json` に書き込まれ、次にフックが
発火したタイミングで反映されます。

| モジュール   | 内容                                          |
|-------------|----------------------------------------------|
| `_core`     | 致命的・不可逆パターン (常時 ON)               |
| `coreutils` | `ls`/`cat`/`grep`/`wc`/`pwd`/`mkdir`/`cp`/... |
| `git`       | `git status`/`log`/`diff`/`commit`/`switch`/...|
| `gh`        | `gh pr list`/`view`、`gh issue list`/...      |
| `bun`       | `bun test`/`bun run test/typecheck/lint`/...  |
| `npm`       | `npm test`/`npm run lint`/`npm ls`/...        |
| `pnpm`      | `pnpm test`/`typecheck`/`lint`/...            |
| `yarn`      | `yarn test`/`yarn run lint`/`yarn list`/...   |
| `docker`    | `docker ps`/`logs`/`inspect`/...              |
| `kubectl`   | `kubectl get`/`describe`/`logs`/...           |
| `cargo`     | `cargo check`/`build`/`test`/`fmt`/`clippy`/...|
| `brew`      | `brew list`/`info`/`outdated`/`search`/...    |

## レベルを選ぶ

セキュリティレベルは 3 段階用意してあります:

```bash
cc-shisa level                  # 現在のレベルとマッピングを表示
cc-shisa level set strict       # ~/.config/cc-shisa/profile.json に書き込む
```

| レベル   | 想定する状況                              | ふるまい |
|----------|------------------------------------------|----------|
| `strict` | 共有環境 (会社・チームのリソース)         | リモートへの書き込み (push、publish、gh pr create 等) はすべて `deny` |
| `safe`   | デフォルト。個人の日常作業                | 破壊的操作・動的コード・未知のバイナリは `ask`、通常の読み書きは通す |
| `loose`  | サンドボックス、CI、信頼できる手元のマシン | `dangerous` のみブロックし、それ以外はすべて通す |

クラス単位で挙動を変えたい場合は `~/.config/cc-shisa/profile.json`
の `overrides` で個別に設定できます (例: `"overrides": { "remote.write": "ask" }`)。

## 段階的な導入

cc-shisa には **shadow モード** があり、すべての判定を強制的に `allow`
に倒したうえで「本来なら何が起きていたか」を記録します。enforce する前に
動作を観察したい時に便利です:

```bash
# 1 週目: shadow モードで様子を見る
export CC_SHISA_SHADOW=1
```

ログは
`${XDG_STATE_HOME:-~/.local/state}/cc-shisa/decisions.jsonl` に書き
出されます。`cc-shisa logs summary` や `cc-shisa logs tail` でも
確認できます。チェックすべきポイントは 2 つ:

- `originalAction:"deny"` の行 — 本来ブロックされていたもの。本当に
  危ない操作だったか?
- `originalAction:"ask"` の行 — 本来は確認プロンプトが出ていたもの。
  頻度は許容範囲に収まっているか?

ルールに納得できたら enforce に切り替えます:

```bash
unset CC_SHISA_SHADOW
export CC_SHISA_LOG=1   # enforce 後も監査ログを残したい場合
```

## カスタムモジュール

チームやプロジェクト固有のルールは `~/.config/cc-shisa/modules/` に
JSON を置けば追加できます:

```json
{
  "name": "our-team",
  "rules": [
    {
      "id": "team.no-prod",
      "match": "regex",
      "pattern": "kubectl.*--context=prod",
      "class": "dangerous",
      "reason": "本番クラスタを触るのはオンコールの人だけ"
    }
  ]
}
```

ユーザーモジュールは自動でロードされるので `enable` する必要はありません。
最も厳しい判定が勝つ仕組みのため、ユーザー側のルールから `_core` を
緩めることは構造的に不可能です。安心して追加してください。

## インタープリタの `-c` / `-e` を読む

`python -c "..."` / `node -e "..."` / `ruby -e "..."` / `perl -e "..."`
は通常、構築された文字列の中身が cc-shisa から見えないため `dynamic`
として扱われます。ただしこれらのインタープリタについては言語別の
インスペクタが中身を解析し、より具体的なクラスに振り直します。たとえば
`os.system` なら `dangerous`、`fs.writeFileSync` なら `local.write`、
`console.log("hi")` なら `local.read`、といった具合です。

プロジェクト固有のライブラリは `~/.config/cc-shisa/interpreter.json`
にホワイトリストとして登録できます:

```jsonc
{
  "python": { "modules": { "pandas": "local.read", "boto3": "remote.write" } },
  "node":   { "modules": { "axios": "remote.read", "esbuild": "local.write" } },
  "ruby":   { "modules": { "faraday": "remote.read" } }
}
```

判定は最も厳しいものが勝つので、`pandas` を import しつつシェルアウト
するスクリプトは引き続き `dangerous` のままです。

## ディレクトリ別のプロファイル

`~/work` 配下では厳しめ、`~/personal-projects` では緩め、特定のリポジトリ
では `git push` を完全に拒否したい — そういった切り替えはディレクトリ
単位で登録できます。リポジトリには何も置かず、user 側の設定だけで完結
します:

```bash
cd ~/work/sensitive-repo

cc-shisa here set-level strict
cc-shisa here set-override remote.write deny

cc-shisa here          # 現在のディレクトリで効いている設定を表示
cc-shisa locations list
```

設定は `~/.config/cc-shisa/locations.json` (リポジトリ内ではなく自分の
ホーム) に保存されます。フック発火時には最長のパス前缀マッチで該当
エントリを適用するので、`~/work/sensitive-repo/src/foo` でも親ディレクトリ
の登録が拾われます。

ディレクトリごとに変えられるのは `level` と `overrides` だけ。モジュール
の有効・無効は引き続きグローバルの `~/.config/cc-shisa/profile.json`
から継承します。

## トラブルシューティング

> 「このコマンドはなぜ ask / 拒否されたのか?」

```bash
cc-shisa check 'gh pr create --title foo'
# → Action / Class / Reason / Rule / Segment
```

> 「最近よく ask されてるコマンドは?」

```bash
export CC_SHISA_LOG=1            # 監査ログをまだ有効にしていなければ
# … 後で:
cc-shisa logs summary            # クラス・ルール・理由ごとの集計
cc-shisa logs tail -n 50         # 直近 50 件の判定
cc-shisa logs path               # JSONL ファイルのパス
```

> 「使いたいモジュールはちゃんと有効になっている?」

```bash
cc-shisa modules list
# 新しくインストールした version で追加されたモジュールは
# `cc-shisa modules enable <name>` で有効化が必要
```

> 「一時的に緩めにしたい」

```bash
cc-shisa level                   # 現在のレベルとマッピングを表示
cc-shisa level set loose         # 致命的パターンだけブロック
cc-shisa level set safe          # デフォルトに戻す
```

> 「特定のクラスだけ挙動を変えたい」

`~/.config/cc-shisa/profile.json` の `overrides` で個別にクラスを
上書きできます:

```jsonc
{
  "level": "safe",
  "modules": ["coreutils", "git", "gh"],
  "overrides": {
    "remote.write": "ask",          // リモート書き込みは必ず確認
    "local.write.destroy": "deny"   // ローカル破壊系は問答無用で拒否
  }
}
```

> 「別のパーサーを試したい (再インストールせず)」

```bash
CC_SHISA_PARSER=tree-sitter cc-shisa check '<コマンド>'
```

cc-shisa の分類が誤っていると感じたら (厳しすぎる / 緩すぎる)、
`cc-shisa check '<cmd>'` の出力を添えて issue を立ててください。

## もっと知りたい場合

- [`CONTRIBUTING.ja.md`](./CONTRIBUTING.ja.md) — 内部の仕組み、
  ソースからのビルド、パーサーバックエンド、インスペクタの全パターン、
  テストの動かし方
- [`CLAUDE.md`](./CLAUDE.md) — エージェント向けの詳細なコンテキスト:
  ファイル構成、フックプロトコル、設計判断の履歴

## ライセンス

MIT — [`LICENSE`](./LICENSE) を参照してください。
