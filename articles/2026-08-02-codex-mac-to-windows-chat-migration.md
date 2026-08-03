---
title: "Codexの会話履歴をMacからWindowsへ移行する方法"
emoji: "📦"
type: "tech"
topics: ["codex", "macos", "windows", "sqlite", "migration"]
published: false
---

## 結論――`.codex`全体ではなく、会話に必要なデータだけを移す

Macで使っていたCodexの会話履歴は、次のデータをWindows側へ移すことで引き継げます。

```text
sessions/              # 通常の会話本文
archived_sessions/     # アーカイブ済みの会話本文
attachments/           # 会話へ添付したファイル
session_index.jsonl    # 会話一覧に使われる索引
state_5.sqlite         # スレッド情報を持つSQLiteデータベース
```

ポイントは、**`.codex`フォルダ全体をそのまま上書きしないこと**です。`.codex`には会話履歴だけでなく、認証情報、端末固有の状態、キャッシュ、Mac上のプロセスやパスに依存するデータも含まれます。

安全に移行する流れは次のとおりです。

```text
Mac
├── Codexを完全終了
├── 会話本文・添付ファイル・索引をコピー
├── SQLiteの.backupで移行用DBを作成
└── tar.gzへまとめる
        │
        ▼
Windows
├── Codexを一度起動してログイン
├── Windows側の.codexを丸ごとバックアップ
├── 会話関連データだけを配置
└── 一覧表示・本文・アーカイブを確認
```

この記事では、この手順を順番に説明します。

:::message alert
この記事で扱う保存先と移行結果は、2026年8月2日時点の筆者環境で実ファイルを調査し、MacからWindowsへの移行後の動作まで検証したものです。この記事では検証済みの事実として扱います。ただし、将来のCodexではファイル名やSQLiteのスキーマが変わる可能性があります。

作業前にCodexを完全終了し、Mac側とWindows側の両方でバックアップを作成してください。
:::

## 検証して分かった保存先と移行方針

実際のファイルを調べた結果、会話本文、一覧用の索引、スレッド情報、プロジェクトのUI状態は別々に保存されていました。

| データ | 確認できた役割 | 今回の移行 |
|---|---|---|
| `sessions/` | 通常の会話本文を保存する | 移す |
| `archived_sessions/` | アーカイブ済みの会話本文を保存する | 移す |
| `attachments/` | 会話に追加した添付ファイルを保存する | 移す |
| `session_index.jsonl` | 会話一覧の索引を保持する | 移す |
| `state_5.sqlite` | タイトル、`cwd`、`rollout_path`などのスレッド情報を保持する | 移す |
| `.codex-global-state.json` | 登録済みプロジェクト、ワークスペース、スレッド割り当てなどのUI状態を保持する | 上書きせずWindows側で再構築する |

今回の検証では、会話本文のJSONLだけでは一覧を再現できず、索引やSQLiteだけでは本文を再現できませんでした。そのため、会話に関係する5項目を一組として移します。

一方、Windows側にはWindows側の認証情報と端末状態を残します。このため、`.codex-global-state.json`や`auth.json`などは移行対象に含めません。

なお、OpenAI Help Centerでは、Codexの履歴は通常のChatGPT履歴とは別に扱われると説明されています。ChatGPTの会話が同期されていても、Codexのローカル履歴まで自動的に同じ状態になるとは限りません。

## 前提

この記事の手順は、次の条件を前提にしています。

- Mac版とWindows版のCodexを、できるだけ同じ時期のバージョンへ更新している
- Windows版Codexを一度起動し、ログインを完了できる
- MacとWindowsの両方で`sqlite3`コマンドを利用できる
- Windows側に残したいCodexのローカル会話がない、または別途バックアップできる

Windowsでは`sqlite3`が標準で使えない環境もあります。利用できない場合は、[SQLite公式ダウンロードページ](https://www.sqlite.org/download.html)からコマンドラインツールを準備します。

:::message alert
以下は、Windows側の会話履歴をMac側の履歴へ置き換える手順です。Mac側とWindows側に別々に存在する履歴をマージする手順ではありません。
:::

## Mac側で移行用アーカイブを作る

### 1. Codexを完全終了する

Codex Desktop、Codex CLI、エディターのCodex拡張など、`.codex`を更新する可能性があるものを終了します。

残っているプロセスを確認します。

```bash
pgrep -af 'Codex|codex'
```

`pkill -f codex`のような広い条件で終了すると、名前に`codex`を含む別のプロセスまで巻き込む可能性があります。表示されたPIDとコマンドを確認し、必要なプロセスだけを終了します。

### 2. SQLiteの整合性を確認する

```bash
sqlite3 "$HOME/.codex/state_5.sqlite" "PRAGMA integrity_check;"
```

次のように表示されれば、SQLiteの整合性チェックは通っています。

```text
ok
```

`ok`以外が表示された場合は、そのDBをWindowsへ移さず、先にMac側のバックアップと復旧を検討します。

### 3. 移行用フォルダを作る

同名フォルダを削除して再利用せず、日時付きの新しいフォルダを作ります。

```bash
CodexSource="$HOME/.codex"
MigrationStage="$HOME/Desktop/codex-chat-migration-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$MigrationStage"
```

会話本文、添付ファイル、索引をコピーします。存在しない項目は読み飛ばします。

```bash
for Item in sessions archived_sessions attachments session_index.jsonl; do
  if [ -e "$CodexSource/$Item" ]; then
    cp -R "$CodexSource/$Item" "$MigrationStage/$Item"
  fi
done
```

### 4. SQLiteの移行用バックアップを作る

`state_5.sqlite`を単純にコピーする代わりに、SQLiteの`.backup`を使います。

```bash
sqlite3 "$CodexSource/state_5.sqlite" \
  ".backup '$MigrationStage/state_5.sqlite'"
```

SQLiteがWALモードで動作している場合、最新の変更が`state_5.sqlite-wal`に残っていることがあります。`.backup`を使えば、その内容を反映した自己完結したバックアップDBを作れます。本体、WAL、SHMを別々のタイミングでコピーするより安全です。

作成したDBも確認します。

```bash
sqlite3 "$MigrationStage/state_5.sqlite" "PRAGMA integrity_check;"
```

### 5. アーカイブへまとめる

```bash
MigrationArchive="$MigrationStage.tar.gz"

tar -czf "$MigrationArchive" -C "$MigrationStage" .
tar -tzf "$MigrationArchive" | sed -n '1,40p'
ls -lh "$MigrationArchive"
```

アーカイブ内に、少なくとも`state_5.sqlite`、`session_index.jsonl`、`sessions/`があることを確認します。

作成した`tar.gz`を、外付けストレージや安全なファイル転送手段でWindowsへ移します。

:::message alert
移行用アーカイブには会話本文や添付ファイルが含まれます。機密情報として扱い、不要になったコピーは適切に削除してください。
:::

## Windows側へ会話履歴を配置する

### 1. Windows版Codexを準備する

Windows版Codexを一度起動してログインします。これにより、Windows側の認証情報と基本的なローカル状態が作られます。

ログイン後、Codexを完全終了します。PowerShellでプロセスを確認します。

```powershell
Get-Process -Name "Codex", "codex" -ErrorAction SilentlyContinue
```

表示されたものが終了すべきCodexプロセスだと確認できた場合だけ、次を実行します。

```powershell
Stop-Process -Name "Codex" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "codex" -Force -ErrorAction SilentlyContinue
```

### 2. Windows側の`.codex`を丸ごとバックアップする

```powershell
$CodexHome = Join-Path $env:USERPROFILE ".codex"
$BackupRoot = Join-Path $env:USERPROFILE (".codex-before-mac-import-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

Copy-Item -LiteralPath $CodexHome -Destination $BackupRoot -Recurse
Get-ChildItem -LiteralPath $BackupRoot
```

このバックアップには、Windows側の認証状態や設定も含まれます。移行に失敗した場合は、このフォルダから移行前の状態へ戻せます。

### 3. 移行用アーカイブを展開する

アーカイブをダウンロードフォルダへ置いた例です。ファイル名は実際のものへ変更してください。

```powershell
$Archive = Join-Path $env:USERPROFILE "Downloads\codex-chat-migration-20260802-120000.tar.gz"
$ImportDir = Join-Path $env:TEMP ("codex-mac-import-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

New-Item -ItemType Directory -Path $ImportDir | Out-Null
tar -xzf $Archive -C $ImportDir
Get-ChildItem -LiteralPath $ImportDir
```

次の項目を確認します。

```text
sessions
archived_sessions
attachments
session_index.jsonl
state_5.sqlite
```

Mac側にアーカイブ済み会話や添付ファイルがなければ、対応するフォルダは存在しない場合があります。

展開したDBの整合性も確認します。

```powershell
$ImportDb = Join-Path $ImportDir "state_5.sqlite"

sqlite3 $ImportDb "PRAGMA integrity_check;"
```

### 4. Windows側の会話関連データを置き換える

:::message alert
ここから先は、Windows側の既存会話データをMac側のデータへ置き換えます。`$BackupRoot`にバックアップが作成されていることと、Codexが終了していることを再確認してください。
:::

まず、置き換える項目を削除します。インポートするDBとは無関係な古いWALとSHMも残さないようにします。

```powershell
$ReplaceItems = @(
    "sessions",
    "archived_sessions",
    "attachments",
    "session_index.jsonl",
    "state_5.sqlite",
    "state_5.sqlite-wal",
    "state_5.sqlite-shm"
)

foreach ($Item in $ReplaceItems) {
    $Target = Join-Path $CodexHome $Item

    if (Test-Path -LiteralPath $Target) {
        Remove-Item -LiteralPath $Target -Recurse -Force
    }
}
```

続いて、移行用フォルダに存在する項目だけを配置します。

```powershell
$ImportItems = @(
    "sessions",
    "archived_sessions",
    "attachments",
    "session_index.jsonl",
    "state_5.sqlite"
)

foreach ($Item in $ImportItems) {
    $Source = Join-Path $ImportDir $Item
    $Target = Join-Path $CodexHome $Item

    if (Test-Path -LiteralPath $Source) {
        Copy-Item -LiteralPath $Source -Destination $Target -Recurse
    }
}
```

配置後のDBを確認します。

```powershell
$CodexDb = Join-Path $CodexHome "state_5.sqlite"

sqlite3 $CodexDb "PRAGMA integrity_check;"
```

`ok`ならCodexを起動します。

## 移行できたか確認する

Codexの起動後、次の順番で確認します。

1. 過去の会話が「最近」や検索結果に表示される
2. 会話を開いて本文を読める
3. 添付ファイルを含む会話を開ける
4. アーカイブ済みの会話が残っている
5. 新しい会話を作成できる

OpenAIのCodexリポジトリには、JSONL、`session_index.jsonl`、`state_5.sqlite`が残っているのに、サイドバーへ正しく表示されないという不具合報告があります。

一覧に表示されない場合も、すぐに「会話が消えた」と判断せず、移行したファイルとDBを確認します。

```powershell
sqlite3 $CodexDb ".tables"
sqlite3 $CodexDb "PRAGMA table_info(threads);"
sqlite3 $CodexDb "SELECT COUNT(*) FROM threads;"
```

`threads`テーブルが存在し、想定した件数が入り、対応するJSONLも残っているのにUIへ出ない場合は、会話本文の消失ではなく、索引またはUI側の読み込みの問題として切り分けます。

## 移行しないデータ

次のデータは、最初の移行には含めません。

| 分類 | 例 | 方針 |
|---|---|---|
| 認証・端末識別 | `auth.json`、`installation_id`、`ipc/` | Windows側でログインし直す |
| キャッシュ・一時ファイル | `cache/`、`.tmp/`、`models_cache.json` | 移行しない |
| 実行状態 | `shell_snapshots/`、`worktrees/`、`process_manager/` | Windows側で作り直す |
| UI状態 | `.codex-global-state.json` | Windows側の状態を維持する |
| 設定・拡張 | `config.toml`、`plugins/`、`skills/`、`rules/` | 履歴移行後に個別設定する |
| その他の機能データ | `goals_1.sqlite`、`memories_1.sqlite`、`automations/` | 必要性を確認して別途扱う |

特に`auth.json`は認証情報を含むため、別の端末へコピーしません。

また、`shell_snapshots/`や`worktrees/`にはMac固有のシェル、プロセス、絶対パスが含まれる可能性があります。Windowsへ持ち込まず、新しい環境で作り直す方が安全です。

## 失敗した場合の戻し方

Windows側で作ったバックアップへ戻します。Codexを完全終了してから実行してください。

```powershell
$CodexHome = Join-Path $env:USERPROFILE ".codex"
$FailedImport = Join-Path $env:USERPROFILE (".codex-after-failed-import-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$BackupRoot = "C:\Users\<windows-user>\.codex-before-mac-import-20260802-120000"

Move-Item -LiteralPath $CodexHome -Destination $FailedImport
Copy-Item -LiteralPath $BackupRoot -Destination $CodexHome -Recurse
```

`$BackupRoot`は、実際に作成されたバックアップフォルダへ置き換えます。失敗した移行結果も別名で残すため、復元後に原因を調べられます。

## 移行時の落とし穴――プロジェクト分類はそのまま引き継がれなかった

会話履歴を移行したあと、過去の会話は「最近」に表示されましたが、Macで使っていたプロジェクト配下には表示されませんでした。

例えば、移行前は次のように分類されていたとします。

```text
EduAnima
├── API設計
├── テスト修正
└── UIの調整
```

移行後のWindowsでは、会話が次のように「最近」へまとめて表示されました。

```text
最近
├── API設計
├── テスト修正
└── UIの調整
```

会話は「最近」から正常に開けたため、本文の移行には成功していました。引き継がれていなかったのは、Windows側のプロジェクトと過去のスレッドの対応付けです。

検証の結果、原因は次の2点だと確認できました。

1. `.codex-global-state.json`を移していないため、Mac側のプロジェクト登録・UI状態がWindowsへ引き継がれていない
2. `state_5.sqlite`へ保存された過去のスレッドの`cwd`が、Macの絶対パスのまま残っている

### 原因1：MacとWindowsで`cwd`が異なる

`state_5.sqlite`の`threads`テーブルを確認すると、会話を作成したときの作業ディレクトリが`cwd`として保存されていました。移行した過去のスレッドには、Mac側の絶対パスが残っていました。

Mac側の値は、例えば次のようになります。

```text
/Users/<mac-user>/Develop/EduAnima
```

Windows側の実際のプロジェクトは、例えば次です。

```text
C:\Users\<windows-user>\Develop\EduAnima
```

同じリポジトリでも、絶対パスの文字列は一致しません。この不一致により、移行したスレッドはWindows側のプロジェクトへ結び付けられていませんでした。

### 原因2：UI側のプロジェクト状態はWindowsへ移していない

`.codex-global-state.json`の内容を確認すると、保存済みワークスペース、プロジェクト順序、スレッドの割り当てなど、UIに関係する情報が保存されていました。

今回、このファイルは移行対象から意図的に外しています。そのため、Mac側のプロジェクト登録状態はWindowsへ引き継がれません。

ただし、Mac側の`.codex-global-state.json`をWindowsへそのままコピーすると、Mac固有のパスやウィンドウ状態まで持ち込むことになります。プロジェクト分類を戻すためだけに上書きすることは推奨しません。

### まずWindowsでプロジェクトを開き直す

最初に、Windows版Codexで実際のリポジトリを開き直します。

```text
C:\Users\<windows-user>\Develop\EduAnima
```

これにより、Windows側のUI状態へプロジェクトが登録されます。この時点で分類が戻れば、SQLiteを編集する必要はありません。

### Mac側の`cwd`が残っているか確認する

分類が戻らない場合は、Codexを終了してからDBを確認します。

```powershell
$CodexDb = Join-Path $env:USERPROFILE ".codex\state_5.sqlite"

sqlite3 $CodexDb "PRAGMA table_info(threads);"
sqlite3 $CodexDb `
  "SELECT cwd, COUNT(*) FROM threads GROUP BY cwd ORDER BY COUNT(*) DESC;"
```

Macのパスが表示されれば、移行したスレッドにMac側の`cwd`が残っています。

### Windows側の正しいパス表現を確認する

Windowsパスを推測して一括更新する前に、対象プロジェクトでテスト用の新規会話を一つ作成します。その後Codexを終了し、直近の行を確認します。

```powershell
sqlite3 $CodexDb `
  "SELECT id, cwd, title FROM threads ORDER BY created_at DESC LIMIT 10;"
```

Windows側では、バージョンやパスの正規化方法によって、同じ場所でも次のような表記が考えられます。

```text
C:/Users/<windows-user>/Develop/EduAnima
C:\Users\<windows-user>\Develop\EduAnima
\\?\C:\Users\<windows-user>\Develop\EduAnima
```

プロジェクト分類には保存されたパス表記が影響します。そのため、推測で決めず、新規会話に実際に保存された値をWindows側の正しい表記として使います。

### 必要な場合だけ`cwd`を置換する

Codexを完全終了し、編集前のDBをバックアップします。

```powershell
$PathFixBackup = Join-Path $env:USERPROFILE ("state_5.sqlite.before-path-fix-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

sqlite3 $CodexDb ".backup '$PathFixBackup'"
sqlite3 $PathFixBackup "PRAGMA integrity_check;"
```

次に、更新対象を`SELECT`で確認します。

```powershell
sqlite3 $CodexDb `
  "SELECT id, cwd, title
   FROM threads
   WHERE cwd LIKE '/Users/<mac-user>/Develop/%'
   LIMIT 20;"
```

想定したスレッドだけが表示されたことを確認してから置換します。次は、新規会話の`cwd`が`C:/Users/<windows-user>/Develop/`だった場合の例です。

```powershell
sqlite3 $CodexDb `
  "BEGIN IMMEDIATE;
   UPDATE threads
   SET cwd = replace(
       cwd,
       '/Users/<mac-user>/Develop/',
       'C:/Users/<windows-user>/Develop/'
   )
   WHERE cwd LIKE '/Users/<mac-user>/Develop/%';
   SELECT changes();
   COMMIT;"
```

更新後の値とDBの整合性を確認します。

```powershell
sqlite3 $CodexDb `
  "SELECT cwd, COUNT(*) FROM threads GROUP BY cwd ORDER BY COUNT(*) DESC;"

sqlite3 $CodexDb "PRAGMA integrity_check;"
```

`ok`ならCodexを起動し、プロジェクト分類を確認します。

:::message
複数のMac側ルートを異なるWindows側ルートへ移した場合は、一括置換せず、対応関係ごとに`SELECT`と`UPDATE`を分ける方が安全です。
:::

### 会話を開けない場合だけ`rollout_path`を確認する

会話が「最近」から正常に開けるなら、`rollout_path`は変更しません。

一覧には出るものの会話を開けない場合は、次の値を確認します。

```powershell
sqlite3 $CodexDb `
  "SELECT id, rollout_path FROM threads ORDER BY updated_at DESC LIMIT 20;"
```

Macの絶対パスが残っている場合は、対応するJSONLがWindows側に存在することと、Windowsで作成した新規会話のパス表記を確認してから置換します。

```powershell
sqlite3 $CodexDb `
  "BEGIN IMMEDIATE;
   UPDATE threads
   SET rollout_path = replace(
       rollout_path,
       '/Users/<mac-user>/.codex/',
       'C:/Users/<windows-user>/.codex/'
   )
   WHERE rollout_path LIKE '/Users/<mac-user>/.codex/%';
   SELECT changes();
   COMMIT;"
```

### `cwd`を直しても分類が戻らない場合

今回の検証では、`cwd`とは別に、プロジェクト登録やスレッド割り当てに関係するUI状態が`.codex-global-state.json`へ保存されていることも確認しました。つまり、プロジェクト分類に関係する状態は`cwd`だけではありません。また、SQLiteと会話ファイルが残っていても、プロジェクトのサイドバーへ過去の会話が表示されないという不具合報告もあります。

`cwd`を直しても分類が戻らない場合は、`.codex-global-state.json`を推測で一括編集しません。「最近」や検索から会話を利用しつつ、移行前のバックアップを維持し、Codexの更新や公式の修復手段を待つ方が安全です。

## まとめ

MacからWindowsへCodexの会話履歴を移すときは、`.codex`全体をコピーするのではなく、次のデータだけを一組として移します。

```text
sessions/
archived_sessions/
attachments/
session_index.jsonl
state_5.sqlite
```

SQLiteはファイルを直接コピーせず、`.backup`を使って移行用DBを作ると、WALを含む状態を一つのDBへまとめられます。Windows側では、既存の`.codex`を丸ごとバックアップしてから、会話関連データだけを置き換えます。

最後の落とし穴は、会話履歴とプロジェクト分類が別のファイルと値で管理されていたことです。今回、会話本文は正常に移行できましたが、`.codex-global-state.json`を移さなかったためプロジェクト登録・UI状態は引き継がれず、さらに`state_5.sqlite`の`cwd`にはMacのパスが残っていました。プロジェクト配下に表示されない場合は、Windowsでプロジェクトを開き直し、必要な場合だけ`cwd`をWindows側の表記へ修正します。

## 参考資料

- [ChatGPT Work and Codex | OpenAI Help Center](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex)
- [SQLite Download Page](https://www.sqlite.org/download.html)
- [Codex Desktop local thread can be hidden/stale when state_5.sqlite and session_index.jsonl drift on Windows | openai/codex #22452](https://github.com/openai/codex/issues/22452)
- [Codex Desktop 26.519.22136: local project conversation history missing after update, threads still exist in state_5.sqlite | openai/codex #23979](https://github.com/openai/codex/issues/23979)
- [Codex Desktop macOS project sidebar hides unarchived local threads even though SQLite/session files are intact | openai/codex #20608](https://github.com/openai/codex/issues/20608)
- [Mac app stops showing local threads even though local thread data still exists | openai/codex #16095](https://github.com/openai/codex/issues/16095)

GitHub Issuesは公式ドキュメントではなく、利用者による不具合報告です。内部ファイルの挙動を確認する参考資料として扱い、将来のバージョンでも同じ構造が続くとは限らない点に注意してください。
