# cc-shisa

> Claude Code の `PreToolUse` フックとして動く静的解析ツール — 安全な
> コマンドは黙って通し、危険なコマンドだけ止める沖縄シーサー。

🇬🇧 [English README](./README.md)

Claude Code の Bash 権限管理は、規模が大きくなると破綻します。手作りの
allowlist は long tail をカバーできず、denylist は穴だらけ、
`pnpm typecheck && pnpm build` のような複合コマンドはどちらの方式でも
検出できません。

cc-shisa は Claude Code が実行しようとする Bash コマンドをすべて監視
し、本物の AST にパースしてセグメントごとに分類、`allow` / `ask` /
`deny` を返します。これで `permissions.allow` を手作業で育てる必要が
なくなります。

名前は沖縄の守り神シーサー (獅子犬) に由来します。門前に対で置かれる
像の口の形 — 阿 (口を開けて招く) と吽 (口を閉じて防ぐ) — がそのまま
このツールの役割になっています。安全なコマンドを通し、危険なコマンドを
止める。

## インストール

```bash
brew tap kbryy/homebrew-tap
brew install cc-shisa
cc-shisa init      # ~/.claude/settings.json にフックを登録
```

これだけです。Claude Code を再起動 (または次の Bash 呼び出しを待つ)
すれば cc-shisa が割り込みを始めます。

動作確認:

```bash
cc-shisa check 'rm -rf /'
# Action:  deny
# Class:   dangerous
# Reason:  rm -rf against filesystem root
```

## 何をブロックするか

必須の `_core` ベースラインが約 23 個の致命的・不可逆パターンを最初から
ブロックします:

- `rm -rf` の対象が `/`、`$HOME`、`~`、`/Users/*`、システムパス、`.git`
- `dd` / シェルリダイレクトで raw デバイスへ書き込み (`/dev/disk*`、
  `/dev/sd*` 等)
- `mkfs*`、`newfs*`、`fdisk` / `gdisk` / `parted`、`diskutil eraseDisk`
- 古典的な bash fork bomb
- `curl … | sh` / `wget … | bash` (zsh / fish / dash / ksh の派生も)
- `kill -9 1` / `killall -9 init`
- システムパスへの再帰的 `chown` / `chmod 777` / `a+rwx`
- `git push --force` / `--delete`、`git reset --hard`
- `shred` / `srm` / `wipe`、`rsync --delete`、`gpg --delete-secret-keys`
- `eval`、`bash -c`、`python -c`、`node -e` 等 (一部のインタープリター
  は中身検査あり — 後述「インタープリター `-c` / `-e` の中身検査」)

`_core` は常時ロードで無効化不可。オプションモジュール (`git`、`gh`、
`npm`、`pnpm`、`yarn`、`bun`、`docker`、`kubectl`、`cargo`、`brew`、
`coreutils`) を有効にすると、数百種類の通常作業コマンドが安全側に分類
され、毎回 `ask` されることがなくなります。

## モジュールを選ぶ

インストール直後は `_core` のみ有効。実際に使うモジュールを選んで
有効化します:

```bash
cc-shisa modules                         # 対話ピッカー (TTY) / list (非TTY)
cc-shisa modules enable coreutils git    # 有効化
cc-shisa modules disable gh              # 無効化
```

設定は `~/.config/cc-shisa/profile.json` に書き込まれ、次回フック発火時
に反映されます。

| 名前        | 内容                                          |
|-------------|----------------------------------------------|
| `_core`     | 致命的 + 不可逆パターン (常時 ON)              |
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

3 段階のセキュリティレベルが同梱されています:

```bash
cc-shisa level                  # 現在のレベル + マッピングを表示
cc-shisa level set strict       # ~/.config/cc-shisa/profile.json に書き込む
```

| レベル   | 適した状況                              | 振る舞い |
|----------|----------------------------------------|----------|
| `strict` | 共有リソース環境 (会社・チーム)          | リモート書き込み (push、publish、gh pr create) を全 deny |
| `safe`   | デフォルト — 日常の個人利用              | destroy / dynamic / unknown は ask、routine な read + write は通す |
| `loose`  | サンドボックス / CI / 信頼できる手元 PC  | `dangerous` のみブロック、それ以外は全部通す |

クラス別の override は `~/.config/cc-shisa/profile.json` で設定可能
(例: `"overrides": { "remote.write": "ask" }`)。

## 推奨ロールアウト

cc-shisa は **shadow モード** をサポートしていて、判定をすべて強制的に
`allow` にしながら「本来なら何が起きていたか」を記録します:

```bash
# 1 週目: shadow — 判定はすべて allow に強制 + ログ
export CC_SHISA_SHADOW=1
```

ログは `${XDG_STATE_HOME:-~/.local/state}/cc-shisa/decisions.jsonl`
に書かれます (または `cc-shisa logs summary` / `cc-shisa logs tail`):

- `originalAction:"deny"` 行 — 本来ブロックする予定だったもの。本当に
  危険だったか?
- `originalAction:"ask"` 行 — 本来 prompt する予定だったもの。頻度は
  許容範囲か?

ルールが信頼できると判断したら:

```bash
unset CC_SHISA_SHADOW
export CC_SHISA_LOG=1   # 任意: enforce モードでも監査ログを残す
```

## カスタムモジュール

チーム / プロジェクト固有のルールは `~/.config/cc-shisa/modules/` に
JSON ファイルを置いて定義できます:

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

ユーザーモジュールは自動ロードされ `enable` 不要。strictest-class-wins
により `_core` を緩めることはできないので、安全に追加できます。

## インタープリター `-c` / `-e` の中身検査

`python -c "..."` / `node -e "..."` / `ruby -e "..."` / `perl -e "..."`
の中身は通常 `dynamic` (cc-shisa が中身を見られない) として分類され
ますが、これらのバイナリに対しては言語別インスペクターが内容を解析
してクラスを refine します。`os.system` は `dangerous`、
`fs.writeFileSync` は `local.write`、`console.log("hi")` は
`local.read`、といった具合です。

プロジェクト固有のライブラリは `~/.config/cc-shisa/interpreter.json`
で whitelist 登録できます:

```jsonc
{
  "python": { "modules": { "pandas": "local.read", "boto3": "remote.write" } },
  "node":   { "modules": { "axios": "remote.read", "esbuild": "local.write" } },
  "ruby":   { "modules": { "faraday": "remote.read" } }
}
```

strictest match が勝つので、`pandas` を import しつつシェルアウトする
スクリプトは依然 `dangerous` 判定です。

## もっと知りたい場合

- [`CONTRIBUTING.ja.md`](./CONTRIBUTING.ja.md) — 内部の動作、ソース
  からのビルド、パーサーバックエンド、インスペクター全パターン、テスト
  実行
- [`CLAUDE.md`](./CLAUDE.md) — エージェント向けコンテキスト: ファイル
  レイアウト、フックプロトコル、決定ログ

## ライセンス

MIT — [`LICENSE`](./LICENSE) を参照。
