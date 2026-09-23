---
title: "Z.ai Coding PlanをCodexアプリで使う"
emoji: "🧭"
type: "tech"
topics: ["codex", "glm", "zai", "ai", "llm"]
published: false
---

## 結論――Codex用のエンドポイントは`/api/v1`

Z.aiのCoding Planは、Codexからそのまま使えます。定額のサブスク枠で、GLMがCodexのエージェントループを回します。プロキシも変換レイヤも要りません。

ただし**接続先を間違えると「使えない」という結論になります**。Z.aiはツールごとに別のエンドポイントを持っているからです。

| 用途 | エンドポイント | API形式 |
| --- | --- | --- |
| Claude Code | `https://api.z.ai/api/anthropic` | Anthropic Messages |
| OpenCode / Cline | `https://api.z.ai/api/coding/paas/v4` | OpenAI chat/completions |
| **Codex** | **`https://api.z.ai/api/v1`** | **OpenAI Responses** |

Coding Planのドキュメントでよく見るのは`/api/coding/paas/v4`のほうですが、ここにCodexが必要とするResponses APIはありません。Codex用は`/api/v1`です。

```toml
[model_providers.zai]
name = "Z.ai Coding Plan"
base_url = "https://api.z.ai/api/v1"
wire_api = "responses"
```

この記事では、この設定でCLIとCodexアプリの両方から使えるようにします。

:::message
カスタムプロバイダの足し方、プロファイルの作り方、Codexアプリで2つ目のインスタンスを立てる方法は、前記事で詳しく書きました。共通部分はそちらを参照してください。
[CodexにOpenRouterを足して、ChatGPT枠を保ったまま別モデルを使う](https://zenn.dev/ttokunaga-ja/articles/2026-09-22-codex-openrouter-custom-provider)
:::

## 検証環境

| 項目 | バージョン |
| --- | --- |
| Codex CLI | `codex-cli 0.155.1` |
| Codexアプリ | `26.915.31945` |
| OS | macOS 27.0 |
| プラン | Z.ai GLM Coding Plan |

## 最小手順

### 1. APIキーをファイルに置く

Z.aiのダッシュボードでCoding Plan用のAPIキーを取得し、ファイルに保存します。

```bash
printf %s 'あなたのキー' > ~/.codex/zai.key
chmod 600 ~/.codex/zai.key
```

すでにOpenCodeやClaude CodeでCoding Planを使っているなら、**同じキーがそのまま使えます**。用途ごとにキーを分ける必要はありません。

### 2. プロバイダを足す

`~/.codex/config.toml`の末尾に追記します。

```toml
[model_providers.zai]
name = "Z.ai Coding Plan"
base_url = "https://api.z.ai/api/v1"
wire_api = "responses"

[model_providers.zai.auth]
command = "/bin/cat"
args = ["/Users/yourname/.codex/zai.key"]
```

Z.aiの公式ドキュメントは`experimental_bearer_token`にキーを直接書く例を載せていますが、`auth.command`にしておくと設定ファイルに秘密が残りません。

:::message alert
`args`は絶対パスで書いてください。`~`は展開されません。
:::

プロファイルを1本作ります。

```bash
cat > ~/.codex/zai-glm.config.toml <<'TOML'
model_provider = "zai"
model = "glm-5.3"
model_reasoning_effort = "high"
TOML
```

グローバルの`model_provider`は書き換えません。素の`codex`はこれまでどおりChatGPTのアカウントで動きます。

### 3. モデルカタログはZ.aiが配信している

ここが気持ちのいいところです。`GET /api/v1/models`が、**Codex内部形式のモデルカタログをそのまま返します**。

```bash
curl -s https://api.z.ai/api/v1/models \
  -H "authorization: Bearer $(cat ~/.codex/zai.key)" \
  > ~/.codex-zai/zai_models.json
```

返ってくるJSONのフィールドを見ると、Codex向けに作られていることが分かります。

```json
{
  "models": [
    {
      "slug": "glm-5.3",
      "display_name": "glm-5.3",
      "description": "Z.ai's latest flagship model",
      "context_window": 1048576,
      "default_reasoning_level": "max",
      "supported_reasoning_levels": ["low", "high", "max"],
      "shell_type": "shell_command",
      "apply_patch_tool_type": "freeform",
      "supports_parallel_tool_calls": true,
      "visibility": "list"
    }
  ]
}
```

`shell_type`や`apply_patch_tool_type`といったCodex固有のフィールドまで含まれています。**カタログを自作する必要はありません。**取得したファイルを`model_catalog_json`に指定するだけです。

配信されているのは次の3モデルでした（執筆時点）。

| slug | コンテキスト | カタログが申告するreasoning |
| --- | ---: | --- |
| `glm-5.3` | 1,048,576 | low / high / max（既定 max） |
| `glm-5.3-flash` | 1,048,576 | 同上 |
| `glm-5-turbo` | 204,800 | （空） |

:::message alert
このカタログをそのまま使うと、**アプリのEffortスライダーが2段しか出ません**。`glm-5-turbo`にいたってはEffortの申告が空です。原因と直し方は後述の落とし穴に書きました。先に直しておくなら、取得後にこの1手間を挟んでください。

```bash
python3 - <<'PY'
import json
P="/Users/yourname/.codex-zai/zai_models.json"
LEVELS=[("low","Light reasoning"),("medium","Balanced reasoning"),
        ("high","Enhanced reasoning"),("xhigh","Extended reasoning"),
        ("max","Deep reasoning")]
d=json.load(open(P))
for m in d["models"]:
    m["supported_reasoning_levels"]=[{"effort":e,"description":x} for e,x in LEVELS]
    m["default_reasoning_level"]="high"
json.dump(d, open(P,"w"), ensure_ascii=False)
PY
```
:::

### 4. 動作確認

```bash
codex exec -p zai-glm --skip-git-repo-check -s read-only \
  'Run the shell command: echo zai-ok — then report the exact output.'
```

```text
model: glm-5.3
provider: zai
reasoning effort: high

exec
  /bin/zsh -lc 'echo zai-ok'
  succeeded in 0ms:
  zai-ok

codex
  `zai-ok`
tokens used 48,065
```

`exec`が出てシェルの出力が返っていれば成功です。**tool callが通ることが重要**で、ここが通らないとCodexはコマンドを一切実行できず、エージェントとして機能しません。

### 5. アプリで使う

Codexアプリで使うには、前記事と同じく`CODEX_HOME`を分けた2つ目のインスタンスを立てます。

`~/.codex-zai/config.toml`を作ります。

```toml
model_provider = "zai"
model = "glm-5.3"
model_reasoning_effort = "high"
model_catalog_json = "/Users/yourname/.codex-zai/zai_models.json"

[model_providers.zai]
name = "Z.ai Coding Plan"
base_url = "https://api.z.ai/api/v1"
wire_api = "responses"
requires_openai_auth = false

[model_providers.zai.auth]
command = "/bin/cat"
args = ["/Users/yourname/.codex/zai.key"]
```

`requires_openai_auth = false`で、ChatGPTへのサインインなしで動く状態になります。

```bash
open -n \
  --env "CODEX_HOME=$HOME/.codex-zai" \
  --env "CODEX_ELECTRON_USER_DATA_PATH=$HOME/Library/Application Support/Codex Zai/user-data" \
  /Applications/ChatGPT.app \
  --args --user-data-dir="$HOME/Library/Application Support/Codex Zai/user-data"
```

モデルピッカーに`glm-5.3`・`glm-5.3-flash`・`glm-5-turbo`が並びます。

なお、1つのインスタンスは1つのプロバイダしか持てません。OpenRouterとZ.aiを両方アプリで使いたい場合は、インスタンスをもう1つ作るか、起動スクリプトで設定を書き換えてから起動する形になります。私は後者にして、引数でプロバイダを選べるようにしています。

```bash
codex-or zai          # Z.ai Coding Plan
codex-or openrouter   # OpenRouter
```

プロバイダは起動時に読まれるので、切り替えるときはウィンドウを一度閉じる必要があります。

## サブスク枠で動いていることの確認

「本当に定額枠を使っているのか、従量課金になっていないか」は気になるところです。対照実験で確認できます。

同じキーを、通常の従量課金エンドポイントに投げてみます。

```bash
curl -s https://api.z.ai/api/paas/v4/chat/completions \
  -H "authorization: Bearer $(cat ~/.codex/zai.key)" \
  -H 'content-type: application/json' \
  -d '{"model":"glm-5.3","messages":[{"role":"user","content":"hi"}],"max_tokens":4}'
```

```json
{"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}
```

従量課金の残高はゼロです。それでも`/api/v1`では正常に応答が返ってきます。つまり`/api/v1`はCoding Planのサブスク枠で動いている、ということになります。

## 落とし穴

### Claude Code用のbase_urlではCodexは動かない

私は最初、この設定で「Z.aiはCodexから使えない」と結論しました。Coding Planのドキュメントに出てくる`/api/coding/paas/v4`を起点に、Responses APIの経路を総当たりしたからです。

```text
/api/coding/paas/v4/responses        → 404 {"path":"/v4/responses"}
/api/coding/paas/v1/responses        → 404
/api/coding/paas/responses           → 404
/api/paas/v4/responses               → 404
/api/coding/paas/v4/openai/v1/responses → 404
```

どこにもありません。一方、同じキーで`/api/coding/paas/v4/chat/completions`は200を返します。**キーは有効なのにResponses APIだけが無い**、という状態です。

Codexは`wire_api = "chat"`を廃止しているので、chat形式しかないなら変換プロキシを書くしかない——というのが当時の結論でした。

実際には`/api/v1`という別系統があり、そこにResponses APIがありました。Z.aiは接続先のツールごとにエンドポイントを分けていて、Coding Planのドキュメントで目立つのはClaude CodeとOpenCode向けのものです。Codex向けは別ページに載っています。

**「Responses APIが無いから無理」と判断する前に、そのサービスのCodex向けドキュメントを探してください。**

### Coding Planのキーは従量エンドポイントでは使えない

前述のとおり、Coding Planのキーを`/api/paas/v4`に投げると残高不足で弾かれます。サブスク枠が使えるのはCoding Plan用のエンドポイントだけです。

これは、別のゲートウェイ（OpenRouterのBYOKなど）を経由してサブスク枠を使う、という構成が成立しないことも意味します。

### Effortスライダーが2段しか出ない

Z.aiのカタログをそのまま使うと、アプリのEffort選択が「低 / 高」の2段になります。`glm-5-turbo`は申告が空なので、そもそも選択肢が出ません。

原因は、**カタログの申告値とアプリ側の許可リストの積集合**が取られるためです。

```text
カタログの申告          low / high / max
アプリの既定の許可リスト  low / medium / high / xhigh / ultra / persistent
                        ↓ 積集合
UIに出る段               low / high        ← 2段
```

アプリには`enabled-reasoning-efforts`という内部設定があり、既定値が`["low","medium","high","xhigh","ultra","persistent"]`です。**ここに`max`が入っていません。**そのためZ.aiが申告する3段のうち`max`が落ちて、2段になります。

この設定はローカルには保存されておらず、内蔵の既定値がそのまま効いています。つまりアプリ側から直す手段はありません。

一方、**Z.ai側は8段すべてを受け付けます**。実際に`/api/v1/responses`へ各値を投げると、いずれも200が返ります。

```text
none / minimal / low / medium / high / xhigh / max / ultra  → すべて 200
```

つまりカタログの申告が実際の対応より狭いだけです。カタログを書き換えれば直ります。

```json
"supported_reasoning_levels": [
  {"effort": "low",    "description": "Light reasoning"},
  {"effort": "medium", "description": "Balanced reasoning"},
  {"effort": "high",   "description": "Enhanced reasoning"},
  {"effort": "xhigh",  "description": "Extended reasoning"},
  {"effort": "max",    "description": "Deep reasoning"}
],
"default_reasoning_level": "high"
```

これでスライダーは`低 / 中 / 高 / 最高`の4段になります。`max`は許可リストに無いのでUIには出ませんが、CLIからは指定できます。

```bash
codex -p zai-glm -c model_reasoning_effort="max"
```

`default_reasoning_level`を`high`にしているのは、UIで選べない`max`を既定にしておくと表示と実際がずれるためです。

:::message
カタログを取り直すとこの修正は消えます。`GET /api/v1/models`で更新したら、書き換えも再適用してください。
:::

### アプリ側はプロバイダを起動時にしか読まない

`model_provider`は起動時に解決されます。設定を書き換えても、開いているウィンドウには反映されません。切り替えるときは一度終了してから起動し直してください。

## Q&A

### Claude Codeで使っているbase_urlをそのまま流用できますか

できません。Claude Code用は`/api/anthropic`（Anthropic Messages形式）で、Codexが要求するResponses APIとは別物です。Codexには`/api/v1`を指定してください。

### 従量課金が発生しませんか

`/api/v1`はCoding Planの枠で動きます。同じキーを従量エンドポイントに投げると残高不足で弾かれることから確認できます（前述）。

### model_catalog_jsonは自分で書く必要がありますか

不要です。`GET /api/v1/models`がCodex形式のカタログをそのまま返すので、保存して指定するだけです。モデルが増えたら取り直せば追従できます。

### OpenCodeやClaude Codeと併用できますか

できます。エンドポイントが違うだけで、キーは共通です。OpenCodeは`/api/coding/paas/v4`、Claude Codeは`/api/anthropic`、Codexは`/api/v1`を見ます。同じCoding Planの枠を共有します。

### 使えるモデルは何ですか

執筆時点で`glm-5.3`・`glm-5.3-flash`・`glm-5-turbo`の3つです。最新の一覧は`GET /api/v1/models`で取れます。

### Effortを「中」にしたいのに選択肢に出てきません

Z.aiのカタログが`low` / `high` / `max`しか申告しておらず、さらにアプリ側の許可リストが`max`を含まないため、2段だけになります。Z.ai自体は`medium`も`xhigh`も受け付けるので、カタログを書き換えれば4段になります。詳しくは落とし穴の「Effortスライダーが2段しか出ない」を参照してください。

### 同じ方法でClaude Proのサブスクも使えますか

使えません。理由は2つあります。

1つ目は技術的な理由です。Anthropicの公式APIにResponses APIがありません。

```text
https://api.anthropic.com/v1/responses         → 404 not_found_error
https://api.anthropic.com/v1/chat/completions  → 401（経路は存在する）
```

OpenAI互換の`/v1/chat/completions`はありますが、Codexが`chat`を拒否するため使えません。Z.aiのようなCodex専用エンドポイントも見当たりませんでした。

2つ目は規約上の理由です。Claude ProやMaxの枠を使うには、Claude Codeが持つOAuthトークンをCodexへ流すことになります。Anthropicのサブスクは自社クライアントでの利用を前提としているため、第三者クライアントへ転用するのはおすすめできません。ローカルプロキシを立てれば技術的には可能ですが、アカウント側の措置を招くリスクがあります。

AnthropicのAPIキー（従量課金）を使う場合も、Responses APIが無い以上、変換プロキシが別途必要になります。そしてそれは「サブスクを使う」ことにはなりません。

Claudeを使いたい場合は、Claude Code CLIをそのまま使うのが素直です。Codexのハーネスに統一したいという要求だけが満たせない、という整理になります。

## まとめ

- Z.ai Coding Planは、`base_url = "https://api.z.ai/api/v1"`・`wire_api = "responses"`でCodexから使える
- Claude Code用・OpenCode用とはエンドポイントが違う。ここを間違えると「使えない」と誤判断する
- モデルカタログはZ.aiがCodex形式で配信しているので自作不要。ただしEffortの申告が実際より狭く、そのままだとスライダーが2段になるので書き換える
- 定額枠で動く。従量エンドポイントでは同じキーが残高不足で弾かれることから確認できる
- Claude Proのサブスクは同じ方法では使えない

## 参考資料

- [Z.AI Developer Document — Codex](https://docs.z.ai/devpack/tool/codex)
- [Z.AI Developer Document — GLM Coding Plan](https://docs.z.ai/devpack/overview)
- [CodexにOpenRouterを足して、ChatGPT枠を保ったまま別モデルを使う](https://zenn.dev/ttokunaga-ja/articles/2026-09-22-codex-openrouter-custom-provider)
