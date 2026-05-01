# cc-shisa への貢献

エンドユーザー向けの説明は [`README.ja.md`](./README.ja.md) を参照
してください。このファイルは、内部の仕組みを理解したい人、ソースから
ビルドしたい人、PR を送りたい人のためのものです。

🇬🇧 [English version](./CONTRIBUTING.md)

## ソースからビルドする

```bash
git clone git@github.com:kbryy/cc-shisa.git && cd cc-shisa
mise install                 # mise.toml に書かれた bun のバージョンを取得
bun install
bun run typecheck            # tsc --noEmit
bun test                     # 459 件のテストが約 250ms で回ります
bun run build                # darwin-arm64 用に ./cc-shisa を生成
./cc-shisa init              # ~/.claude/settings.json にフックを登録
```

クロスプラットフォームのバイナリをまとめて作る場合:

```bash
bun run build:all   # darwin-arm64 + darwin-x64 + linux-arm64 + linux-x64
```

## 判定までの流れ

```
                 標準入力に PreToolUse JSON
                          │
                          ▼
     parse → 複合コマンドをセグメントに分解
            (デフォルト: bash-parser、tree-sitter は opt-in)
                          │
                          ▼
     normalize → sudo / timeout / env 系のラッパーを剥がす
                          │
                          ▼
     classify → ルールに照らし、最も厳しいクラスを採用
            (`dynamic` なセグメントはインタープリタインスペクタが再分類)
                          │
                          ▼
     policy → アクティブな level に従って class → allow/ask/deny
                          │
                          ▼
            標準出力に HookOutput JSON (exit 0)
```

**Fail-safe の原則**: どの層でも、判断がつかなければ `ask` にフォール
バックします。構文エラー、未知のバイナリ、未解決の変数、内部例外 — どの
ルートを通っても最終的に `ask` に落ち着きます。`allow` を返すのは明示
的な safe マッチがあったときだけ、`deny` を返すのは明示的な dangerous
マッチがあったときだけです。

## クラス体系

| クラス                  | 例                                                                              |
|-------------------------|--------------------------------------------------------------------------------|
| `dangerous`             | `rm -rf /`、fork bomb、`dd of=/dev/disk*`、`mkfs`、`chmod -R 777 /`             |
| `dynamic`               | `eval`、`bash -c`、`curl … \| sh`、`node -e`、`python -c` (中身が静的に見えない) |
| `unknown`               | どのルールにもマッチしないバイナリ                                              |
| `local.read`            | `git status`、`ls`、`cat`、`jq`、`pnpm typecheck`                              |
| `local.write`           | `git commit`、`mkdir`、`cp`、`mv`、`git stash`、`git switch`                   |
| `local.write.destroy`   | `git reset --hard`、`rm -rf .git`、`shred`、`rsync --delete`                   |
| `remote.read`           | `gh pr list`、`kubectl get`、`npm view`、`git fetch`、`ping`、`dig`            |
| `remote.write`          | `git push`、`gh pr create`、`npm publish`                                      |
| `remote.write.destroy`  | `git push --force`、`git push --delete`                                        |

階層は「場所 (`local.*` / `remote.*`) → 操作 (`read` / `write`)」の
順で並んでいます。`write` には不可逆な操作のための `destroy` サブ
バケットがあります。

レベルごとのマッピング (どのクラスが `allow` / `ask` / `deny` に
なるか) は `src/rules/level.ts` に集約しています。
[ユーザー README のレベル表](./README.ja.md#レベルを選ぶ) も参照
してください。

## インスペクタのパターンカタログ

インタープリタインスペクタ (`src/classifier/interpreter-inspect.ts`)
は次のバイナリの `dynamic` セグメントを再分類します: `python` /
`python3` / `python2`、JS+TS ランタイム (`node` / `nodejs` / `bun` /
`tsx` / `ts-node` / `deno`)、`ruby` / `irb`、`perl`。

| `-c` / `-e` の中身                                                       | 再分類後のクラス     |
|--------------------------------------------------------------------------|---------------------|
| シェル起動 / 子プロセス起動                                               | `dangerous`         |
| ファイル削除 (rm / unlink / rmtree / Path.unlink / FileUtils.rm_rf)       | `local.write.destroy` |
| ネット送信 (HTTP POST/PUT/DELETE、socket bind/listen、HTTP server)        | `remote.write`      |
| ネット取得 (HTTP GET、urllib request、fetch、Net::HTTP.get、LWP)          | `remote.read`       |
| ファイル書き込み (open w/a、makedirs、writeFile、File.write)              | `local.write`       |
| 純粋なリテラル / 算術 / `print` / `console.log` / `puts`                  | `local.read`        |
| 動的構文 (eval、vm.runIn*、instance_eval、eval-block)                     | `dynamic` のまま     |
| 上記いずれにも該当しないもの                                              | `dynamic` のまま (ask) |

`~/.config/cc-shisa/interpreter.json` の言語別ホワイトリストには、
インスペクタが `import` (Python)、`require` / `from … import` (Node)、
`require` (Ruby)、`use` (Perl) を検出した時にユーザーが指定したクラス
で再分類するモジュール一覧を記述します。最終的な判定は「組み込みの
DENY パターン ∪ ユーザー側ホワイトリスト」のうち、最も厳しいものが
勝ちます。

## パーサーバックエンド

cc-shisa は分類前に Bash コマンドを AST にパースします。同梱の
バックエンドは 2 種類で、`CC_SHISA_PARSER` 環境変数で切り替えます:

| バックエンド    | デフォルト | 利点                                          | 注意点                                                                |
|----------------|------------|----------------------------------------------|----------------------------------------------------------------------|
| `bash-parser`  | ✅         | 純 JS、追加ランタイム不要、cold start 約 22 ms | quoted heredoc 内の `(parens)` など、特定のエッジケースで失敗する      |
| `tree-sitter`  |            | 堅牢な grammar で実世界の bash を網羅         | cold start +約 7 ms、バイナリサイズ +1.6 MB                            |

アクティブなバックエンドが parse に失敗した場合、`src/parser/recovery.ts`
が以下の順でリカバリを試みます:

1. quoted-heredoc の本文を空にして再 parse
2. 行単位に分割して各行を独立に parse
3. それでも駄目なら `ask` (理由: "parser failed")

リカバリで吸収できるケースが多いので、ほとんどのユーザーはバックエンド
を切り替える必要はありません。tree-sitter を試したい場合は:

```bash
export CC_SHISA_PARSER=tree-sitter
```

grammar の WASM は `src/parser/impl/tree-sitter-bash.wasm` に、
web-tree-sitter のランタイム WASM は
`src/parser/impl/web-tree-sitter-runtime.wasm` に vendor しています。
`web-tree-sitter` をバージョンアップした際の更新手順は次の通り:

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

CI は両方のバックエンドを毎 PR で実行します
([`.github/workflows/ci.yml`](./.github/workflows/ci.yml))。

`tests/fixtures/` 配下の fixture スイートは cc-shisa を end-to-end で
検証するためのものです:

```bash
cc-shisa test                              # 標準ケース (約 220 件)
cc-shisa test tests/fixtures/redteam.json  # 難読化・回避ケース
```

標準スイートは全モジュールが有効な前提で書かれているので、ローカルで
動かす前に `cc-shisa modules pick` で全部 ON にするか、一時的に
`loose` レベルのプロファイルを使うと、`ask` クラスのミスマッチを
避けられます。

## PR の出し方

- PR を出す前に `bun run typecheck && bun test` を通してください
- 新しいルールは `src/rules/data/<module>.json` に書きます。自明でない
  振る舞いに対しては `tests/fixtures/cases.json` と
  `tests/fixtures/redteam.json` に fixture を追加してください
- 依存グラフは小さく保ちます。新しい `bun add` は毎回セキュリティ
  レビュー扱いです — このツールを自前で書いている目的のひとつが、
  npm のサプライチェーンリスクを避けることなので
- ファイル構成、フックプロトコル、設計判断の履歴など、より深い
  コンテキストは [`CLAUDE.md`](./CLAUDE.md) を参照してください

## ライセンス

MIT — [`LICENSE`](./LICENSE) を参照してください。
