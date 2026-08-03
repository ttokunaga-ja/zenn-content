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
この記事で扱う保存先と移行結果は、2026年8月時点の筆者環境で実ファイルを調査し、MacからWindowsへの移行後の動作まで検証したものです。Windows版は`OpenAI.Codex 26.721.11231.0`で確認しました。この記事では検証済みの事実として扱います。ただし、将来のCodexではファイル名やSQLiteのスキーマが変わる可能性があります。

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

COPYFILE_DISABLE=1 tar -czf "$MigrationArchive" -C "$MigrationStage" .
tar -tzf "$MigrationArchive" | sed -n '1,40p'
ls -lh "$MigrationArchive"
```

`COPYFILE_DISABLE=1`は必須です。macOSの`tar`は拡張属性とリソースフォークを`._`で始まる別エントリとして埋め込むため、これを付けないとWindows側にファイル数と同じだけのゴミが展開されます。筆者の環境では、指定を忘れた結果4,384個・17.7MBの`._*`ファイルが`.codex`へ紛れ込みました。

混入していないことを確認します。

```bash
tar -tzf "$MigrationArchive" | grep -c '/\._' || true
```

`0`であること、そしてアーカイブ内に少なくとも`state_5.sqlite`、`session_index.jsonl`、`sessions/`があることを確認します。

作成した`tar.gz`を、外付けストレージや安全なファイル転送手段でWindowsへ移します。

:::message alert
移行用アーカイブには会話本文や添付ファイルが含まれます。機密情報として扱い、不要になったコピーは適切に削除してください。
:::

## Windows側へ会話履歴を配置する

### 1. Windows版Codexを準備する

Windows版Codexを一度起動してログインします。これにより、Windows側の認証情報と基本的なローカル状態が作られます。

ログイン後、Codexを完全終了します。ここが最初の落とし穴でした。**Windows版の本体は`ChatGPT.exe`で、`codex.exe`はその子プロセス**です。`codex.exe`だけを終了しても、親が数秒で再生成します。

まず親子関係を確認します。

```powershell
Get-CimInstance Win32_Process -Filter "Name like 'ChatGPT%' or Name like 'codex%'" |
    Select-Object ProcessId, ParentProcessId, Name
```

親が`explorer.exe`になっている`ChatGPT.exe`が起点です。そのPIDを指定して、ツリーごと終了します。

```powershell
taskkill /PID <root-chatgpt-pid> /T /F
```

ウィンドウを閉じただけではプロセスは常駐したままです。この状態では`MainWindowHandle`が`0`になるため、「アプリは閉じたつもりなのに終了していない」という取り違えが起きます。終了後、残っていないことを確認します。

```powershell
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^(ChatGPT|codex)' }
```

何も表示されなければ完全終了です。作業後の再起動はストアアプリとして起動します。AppIDは`Get-StartApps`で確認できます。

```powershell
Get-StartApps | Where-Object { $_.Name -match "ChatGPT|Codex" }
Start-Process "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
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

`._`で始まるファイルや`.DS_Store`が混ざっていたら、`.codex`へ配置する前に取り除きます。

```powershell
Get-ChildItem -LiteralPath $ImportDir -Recurse -File -Force |
    Where-Object { $_.Name.StartsWith("._") -or $_.Name -eq ".DS_Store" } |
    Remove-Item -Force
```

ワイルドカードではなく`StartsWith("._")`で判定します。Codexは`..codex-global-state.json.tmp-*`のようにドット2つで始まる実データのファイルを作るため、`.*`のような広い条件で消すと必要なファイルまで巻き込みます。

なお`._rollout-*.jsonl`は会話一覧を壊しません。Codexはファイル名が`rollout-`で始まるものだけを読むため、`._`付きは最初から対象外です。実害はありませんが、ファイル数が倍近くに膨らむので取り除いておきます。

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
| UI状態 | `.codex-global-state.json` | 端末固有の設定は維持し、プロジェクト関連のキーだけ後から移す |
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

ただし、Mac側の`.codex-global-state.json`をWindowsへそのままコピーすると、Mac固有のパスやウィンドウ状態まで持ち込むことになります。丸ごと上書きするのではなく、プロジェクト関連のキーだけを取り出してマージします。手順は後述の「`.codex-global-state.json`からプロジェクト分類を復元する」で扱います。

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

### 日本語を含むパスはUnicode正規化形式が違う

パスに日本語が含まれる場合、区切り文字を直しただけでは一致しません。**macOSはファイル名をNFD、WindowsはNFCで保存する**ためです。

濁点・半濁点のある文字で差が出ます。`ジ`を例にすると次のようになります。

```text
macOS (NFD) : シ + 濁点   U+30B7 U+3099   … 2文字
Windows(NFC): ジ          U+30B8          … 1文字
```

見た目は同じですが別の文字列なので、NFDのまま持ち込んだパスはWindows上で存在しないフォルダを指します。筆者の環境では`Webインテリジェンス特論`というフォルダがこれに該当し、実体があるのに`Test-Path`が`False`を返しました。

Mac由来の文字列はNFCへ正規化してから使います。

```powershell
$Normalized = $MacPath.Normalize([Text.NormalizationForm]::FormC)
```

判定だけなら次で確認できます。

```powershell
"C:\Users\<windows-user>\Documents\Webインテリジェンス特論".IsNormalized([Text.NormalizationForm]::FormC)
```

`False`が返る文字列は、`cwd`でも`rollout_path`でも`.codex-global-state.json`でも同じ問題を起こします。ASCIIだけのパスなら影響しません。

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

## `.codex-global-state.json`からプロジェクト分類を復元する

`cwd`を直しても分類が戻らない場合、残る原因はプロジェクト登録そのものです。ここはMac側の`.codex-global-state.json`から**プロジェクト関連のキーだけ**を取り出し、パスを書き換えてWindows側へマージすれば復元できました。

丸ごと上書きしないことが前提です。このファイルには、認証済みアカウント、ウィンドウ位置、承認モードといった端末固有の設定も同居しています。

移すキーは次のとおりです。

| キー | 内容 |
|---|---|
| `local-projects` | プロジェクト定義（`id`、`name`、`rootPaths`） |
| `project-order` / `pinned-project-ids` | サイドバーの並び順とピン留め |
| `thread-project-assignments` | スレッドとプロジェクトの対応（`projectId`、`cwd`） |
| `thread-writable-roots` | スレッドごとの書き込み許可ルート |
| `electron-saved-workspace-roots` | 登録済みワークスペース |

一方、`agent-mode-by-host-id`、`skip-full-access-confirm`、ウィンドウ位置、インストールID、オンボーディング状態はWindows側の値を残します。文字列としてパスを含むのは上表のキーだけなので、置換対象もここに限定できます。

### プロジェクトIDは書き換えない

`local-`で始まるプロジェクトIDは、ルートパスのSHA-256の先頭32桁から生成されています。

```text
local- + sha256("/Users/<mac-user>/Develop/EduAnima") の先頭32桁
```

パスを変えるならIDも再計算すべきに見えますが、**再計算してはいけません**。このハッシュ生成は初回セットアップ時の一度きりのマイグレーションでしか実行されず、完了フラグが`electron-completed-local-data-migration-ids`へ記録されるため、セットアップ済みのWindows環境では二度と走りません。

通常動作時は、ワークスペースを開くたびに`rootPaths`の一致でプロジェクトを探し、見つからないときだけ新しいランダムUUIDを採番します。つまり照合に使われるのはIDではなくパスです。

したがって、**IDはMac側のまま維持し、`rootPaths`だけWindowsのパスへ書き換える**のが正解です。IDを保てば、`thread-project-assignments`やサイドバーの並び順など既存の参照がすべて整合したまま残ります。

### 権限設定を持ち込む場合の注意

`heartbeat-thread-permissions-by-id`には、スレッドごとの承認ポリシーとサンドボックス設定が入っています。Mac側をフルアクセスで使っていた場合、`dangerFullAccess`や`approvalPolicy: never`がそのまま移ります。筆者の環境では382件中341件が`dangerFullAccess`でした。

該当スレッドを再開すると承認なしで実行されるため、移すかどうかは意識して決めます。移さなければ、Windows側の既定の承認モードが適用されます。

### 反映後に重複を確認する

編集はCodexを完全終了した状態で行い、書き込み前に元ファイルを控えます。ChatGPT.exeが常駐していると、終了時に古い内容で上書きされます。

再起動後、同じ`rootPaths`が複数のIDにぶら下がっていないかを確認します。ここが増えていなければ、IDの扱いは正しく機能しています。

```powershell
$State = Get-Content -LiteralPath (Join-Path $env:USERPROFILE ".codex\.codex-global-state.json") -Encoding UTF8 -Raw |
    ConvertFrom-Json

$State.'local-projects'.PSObject.Properties |
    ForEach-Object { [PSCustomObject]@{ Id = $_.Name; Root = $_.Value.rootPaths -join ";" } } |
    Group-Object Root |
    Where-Object Count -gt 1
```

:::message alert
`Get-Content -Raw`は必ず`-Encoding UTF8`を付けます。PowerShell 5.1は指定がないとANSIコードページで読むため、日本語を含むJSONが壊れて見えます。筆者はこれで「ファイルが破損している」と誤判定しました。
:::

何も表示されなければ重複はありません。分類が戻らない場合は、移行前のバックアップへ戻せる状態を保ったまま、「最近」や検索から会話を利用する運用に切り替えます。

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

会話本文はこれで移りますが、プロジェクト分類は別管理でした。踏んだ落とし穴は4つです。

1. **プロセスが終わっていない** ―― Windows版の本体は`ChatGPT.exe`で、`codex.exe`を止めても再生成される。`taskkill /T /F`でツリーごと終了する
2. **`._*`ファイルの混入** ―― macOSの`tar`は`COPYFILE_DISABLE=1`を付けないと拡張属性を別ファイルとして埋め込む
3. **日本語パスの正規化形式** ―― macOSはNFD、WindowsはNFC。見た目が同じでも文字列は一致しない
4. **プロジェクト登録が別ファイル** ―― `state_5.sqlite`の`cwd`と`.codex-global-state.json`の両方を直す必要がある

プロジェクト配下に表示されない場合は、まずWindowsでプロジェクトを開き直します。それでも戻らなければ、`cwd`をWindows側の表記へ修正し、`.codex-global-state.json`のプロジェクト関連キーをパスだけ書き換えてマージします。このときプロジェクトIDは再計算せず、Mac側の値をそのまま維持するのが要点です。

## 参考資料

- [ChatGPT Work and Codex | OpenAI Help Center](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex)
- [SQLite Download Page](https://www.sqlite.org/download.html)
- [Codex Desktop local thread can be hidden/stale when state_5.sqlite and session_index.jsonl drift on Windows | openai/codex #22452](https://github.com/openai/codex/issues/22452)
- [Codex Desktop 26.519.22136: local project conversation history missing after update, threads still exist in state_5.sqlite | openai/codex #23979](https://github.com/openai/codex/issues/23979)
- [Codex Desktop macOS project sidebar hides unarchived local threads even though SQLite/session files are intact | openai/codex #20608](https://github.com/openai/codex/issues/20608)
- [Mac app stops showing local threads even though local thread data still exists | openai/codex #16095](https://github.com/openai/codex/issues/16095)

GitHub Issuesは公式ドキュメントではなく、利用者による不具合報告です。内部ファイルの挙動を確認する参考資料として扱い、将来のバージョンでも同じ構造が続くとは限らない点に注意してください。
