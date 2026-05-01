# cc-shisa のコントリビューション

エンドユーザー向けドキュメントは [`README.ja.md`](./README.ja.md)
を参照してください。本ファイルは内部実装を理解したい人、ソースから
ビルドしたい人、PR を送りたい人向けです。

🇬🇧 [English version](./CONTRIBUTING.md)

## ソースからビルド

```bash
git clone git@github.com:kbryy/cc-shisa.git && cd cc-shisa
mise install                 # mise.toml の bun バージョンを取得
bun install
bun run typecheck            # tsc --noEmit
bun test                     # 459 tests, ~250ms
bun run build                # darwin-arm64 用の ./cc-shisa を生成
./cc-shisa init              # ~/.claude/settings.json にフックを書き込む
```

クロスプラットフォームバイナリ:

```bash
bun run build:all   # darwin-arm64 + darwin-x64 + linux-arm64 + linux-x64
```

## 判定の流れ

```
                 標準入力に PreToolUse JSON
                          │
                          ▼
     parse → 複合コマンドをセグメントに分解
            (bash-parser デフォルト / tree-sitter は opt-in)
                          │
                          ▼
     normalize → sudo / timeout / env 系のラッパーを剥がす
                          │
                          ▼
     classify → ルールにマッチさせ、最も厳しいクラスを選ぶ
            (interpreter inspector が `dynamic` セグメントを refine)
                          │
                          ▼
     policy → アクティブな level に従い class → allow/ask/deny
                          │
                          ▼
            標準出力に HookOutput JSON (exit 0)
```

**Fail-safe 原則**: 各層は失敗時に `ask` をデフォルトにする。構文
エラー、未知のバイナリ、解決不能な変数、内部例外 — すべて `ask`
に落ちる。`allow` を返すのは明示的な safe マッチがあった時だけ、
`deny` を返すのは明示的な dangerous マッチがあった時だけ。

## クラス体系

| クラス                  | 例                                                                              |
|-------------------------|--------------------------------------------------------------------------------|
| `dangerous`             | `rm -rf /`、fork bomb、`dd of=/dev/disk*`、`mkfs`、`chmod -R 777 /`             |
| `dynamic`               | `eval`、`bash -c`、`curl … \| sh`、`node -e`、`python -c` (中身が opaque)      |
| `unknown`               | どのルールにもマッチしないバイナリ                                              |
| `local.read`            | `git status`、`ls`、`cat`、`jq`、`pnpm typecheck`                              |
| `local.write`           | `git commit`、`mkdir`、`cp`、`mv`、`git stash`、`git switch`                   |
| `local.write.destroy`   | `git reset --hard`、`rm -rf .git`、`shred`、`rsync --delete`                   |
| `remote.read`           | `gh pr list`、`kubectl get`、`npm view`、`git fetch`、`ping`、`dig`            |
| `remote.write`          | `git push`、`gh pr create`、`npm publish`                                      |
| `remote.write.destroy`  | `git push --force`、`git push --delete`                                        |

階層: 場所 (`local.*` / `remote.*`) を上位、操作 (`read` / `write`)
を下位に配置。`write` には不可逆操作用の `destroy` サブバケットがある。

レベルごとのマッピング (どの class が `allow` / `ask` / `deny` に
なるか) は `src/rules/level.ts` に集約されている。
[ユーザー README のレベル表](./README.ja.md#レベルを選ぶ) も参照。

## インスペクターのパターンカタログ

インタープリターインスペクター
(`src/classifier/interpreter-inspect.ts`) は `python` / `python3` /
`python2`、JS+TS ランタイム (`node` / `nodejs` / `bun` / `tsx` /
`ts-node` / `deno`)、`ruby` / `irb`、`perl` の `dynamic` セグメント
を refine する。

| `-c`/`-e` の内容                                                          | 分類後の class       |
|---------------------------------------------------------------------------|---------------------|
| シェル起動 / 子プロセス起動                                                | `dangerous`         |
| ファイル削除 (rm / unlink / rmtree / Path.unlink / FileUtils.rm_rf)        | `local.write.destroy` |
| ネット送信 (HTTP POST/PUT/DELETE、socket bind/listen、HTTP server)         | `remote.write`      |
| ネット取得 (HTTP GET、urllib request、fetch、Net::HTTP.get、LWP)           | `remote.read`       |
| ファイル書き込み (open w/a、makedirs、writeFile、File.write)               | `local.write`       |
| 純粋な `print` / `console.log` / `puts` リテラル / 算術                    | `local.read`        |
| 動的構文 (eval、vm.runIn*、instance_eval、eval-block)                      | `dynamic` のまま     |
| 上記いずれにも当たらない                                                   | `dynamic` のまま (ask) |

言語別 whitelist ファイル (`~/.config/cc-shisa/interpreter.json`) は、
インスペクターが `import` (Python) / `require` / `from … import`
(Node) / `require` (Ruby) / `use` (Perl) を検出するとユーザー指定の
class でセグメントを分類する。strictest match (組み込み DENY ∪
ユーザー whitelist) が勝つ。

## パーサーバックエンド

cc-shisa は Bash コマンドを AST にパースしてから分類する。2 つの
バックエンドが同梱されており、`CC_SHISA_PARSER` 環境変数で切替:

| バックエンド    | デフォルト | 利点                                          | 欠点                                                                  |
|----------------|------------|----------------------------------------------|----------------------------------------------------------------------|
| `bash-parser`  | ✅         | 純 JS、追加ランタイム不要、cold start ~22 ms  | 特定エッジケース (quoted heredoc 内の `(parens)` 等) で失敗            |
| `tree-sitter`  |            | 堅牢な grammar、実世界の bash を網羅          | +~7 ms cold start、+1.6 MB バイナリ                                    |

active backend の parse が失敗した場合、`src/parser/recovery.ts` が
次の順で recovery:

1. quoted-heredoc body を空にして再 parse
2. 行単位で split し各行を独立 parse
3. 全部ダメなら `ask` (理由: "parser failed")

通常 recovery で十分なので、大半のユーザーは切り替え不要。tree-sitter
を試したい場合:

```bash
export CC_SHISA_PARSER=tree-sitter
```

grammar WASM は `src/parser/impl/tree-sitter-bash.wasm` に vendor、
web-tree-sitter ランタイム WASM は
`src/parser/impl/web-tree-sitter-runtime.wasm` に vendor している。
`web-tree-sitter` のバージョン更新時の再同期手順:

```bash
bun add web-tree-sitter@x.y.z
bun run vendor:wasm   # cp node_modules/web-tree-sitter/web-tree-sitter.wasm src/parser/impl/
git diff              # 更新された wasm をコミット
```

## テスト

```bash
bun test                                # デフォルトバックエンド (bash-parser)
CC_SHISA_PARSER=tree-sitter bun test    # tree-sitter バックエンド
```

CI は両 backend を毎 PR で実行
([`.github/workflows/ci.yml`](./.github/workflows/ci.yml))。

`tests/fixtures/` の fixture スイートは cc-shisa を end-to-end で
検証する:

```bash
cc-shisa test                              # 標準ケース (約 220)
cc-shisa test tests/fixtures/redteam.json  # 難読化 / 回避ケース
```

標準スイートは全モジュール有効化を前提としているので、ローカルで
fixture を回す前に `cc-shisa modules pick` で全モジュールを ON に
するか、一時的な `loose` プロファイルを使うと `ask` クラスの fixture
ミスマッチを避けられる。

## PR の出し方

- PR を出す前に `bun run typecheck && bun test` を通す
- 新規ルールは `src/rules/data/<module>.json`。非自明な振る舞いは
  `tests/fixtures/cases.json` と `tests/fixtures/redteam.json` に
  fixture を追加する
- 依存グラフは小さく保つ。新しい `bun add` は毎回セキュリティレビュー
  扱い — このツールを自前で書いている目的の一つは npm の supply-chain
  リスクを避けることなので
- ファイルレイアウト、フックプロトコル、決定ログ等の深いコンテキスト
  は [`CLAUDE.md`](./CLAUDE.md) を参照

## ライセンス

MIT — [`LICENSE`](./LICENSE) を参照。
