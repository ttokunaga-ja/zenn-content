---
title: "Claude DesktopのCode履歴をアカウント間で同期するCLI「claudeHistory」を作った"
emoji: "📚"
type: "tech"
topics: ["claude", "rust", "cli", "windows", "macos"]
published: false
---

Claude Desktopでアカウントを切り替えたところ、Codeの会話が新しいアカウントの一覧に表示されなくなりました。

同じPCに残っているCodeのローカル履歴を、複数のアカウントから使えるようにしたのが、Rust製CLI **claudeHistory** です。macOSとWindows向けの実行ファイルを配布しているので、使う側にRustやPython、APIキーは必要ありません。

https://github.com/ttokunaga-ja/claudeHistory

## 何ができるか

Claude Desktopのアカウント間でCode履歴を同期します。3つ以上のアカウントでも、1つの操作でそれぞれに足りない履歴を追加できます。既存の履歴は上書きしません。

対象はCodeのローカル履歴です。通常チャット・Cowork・クラウド会話の移行や、自動ログアウト・ログインには対応していません。削除済みの会話本文を復旧するものでもありません。

## インストール

OSに合うコマンドを1回実行します。ダウンロードとインストールを自動で行うので、ターミナルを開いたフォルダーのままで実行できます。管理者権限は必要ありません。

### macOS（Apple Silicon）

ターミナルで次のコマンドを実行します。

```sh
curl -fsSL https://raw.githubusercontent.com/ttokunaga-ja/claudeHistory/main/install.sh | sh
```

`~/.local/bin`にインストールされ、PATHも設定されます。**新しいターミナルを開いてから**使ってください。

### Windows（x64）

PowerShellで次のコマンドを実行します。

```powershell
irm https://raw.githubusercontent.com/ttokunaga-ja/claudeHistory/main/install.ps1 | iex
```

`%USERPROFILE%\.local\bin`にインストールされ、PATHも設定されます。そのまま同じPowerShellで使えます。

### インストールの確認

どちらのOSでも、次のコマンドで版が表示されればインストール完了です。

```sh
claudeHistory --version
```

v0.3.0以前から更新する場合は、最初の1回だけ同じインストールコマンドを再実行してください。手動でファイルを取得したい場合は[GitHub Releases](https://github.com/ttokunaga-ja/claudeHistory/releases/latest)を利用してください。

## 更新・アンインストール

最新版への更新は、次のコマンドで行えます。

```sh
claudeHistory update
```

このCLIが不要になったら、次のコマンドを実行します。

```sh
claudeHistory uninstall
```

削除対象のパスが表示されるので、確認して`y`を入力します。Enterだけなら中止します。claudeHistory本体と専用フォルダー`~/.claude-history`を削除します。専用フォルダーに残っているファイルと復旧用バックアップも削除されます。Claude本体の履歴・設定・認証情報には触れません。

Windowsでは終了後に削除されます。表示された結果の記録で`deleted`になれば完了です。

## 全アカウントに同期する

作業を終えてから、次のコマンドでメニューを開きます。

```sh
claudeHistory
```

**「1：すべてのアカウントに不足履歴を同期」** を選びます。初回の登録や設定は不要です。検出したすべてのアカウント・組織へ不足履歴を追加します。同じアカウントの複数組織や履歴0件の組織、3つ以上のアカウントも同じ手順です。

先に追加予定だけを確認したい場合は、次のコマンドを使えます。

```sh
claudeHistory sync --dry-run
```

作業中と判定された場合は「作業中です。作業を終了してから進めてください。」と表示して中止します。Desktopだけが起動している場合は、終了してよいかYes/Noで確認します。判断できない場合は、作業を終えてDesktop・CLIを手動終了してから再実行してください。

完了するとバックアップの場所が表示されます。Desktopを起動し直して、追加された会話の一覧と本文を確認してください。別のアカウントで新しい会話が増えたら、再び1番を選んで同期できます。

特定のアカウントから現在のアカウントへだけ引き継ぐ場合は、メニューの2番を選びます。

## 追加した履歴を取り消す

引き継ぎ時に表示されたバックアップのパスを指定します。

```sh
claudeHistory undo "バックアップの絶対パス"
```

取り消すのは、その実行で追加した登録だけです。元の履歴や会話本文は削除しません。追加した登録が後から変更されている場合は中止するので、新しい作業を勝手に消すことはありません。

claudeHistoryは非公式ツールです。Desktopの更新によって動作が変わる可能性があるため、まず`--dry-run`で確認してください。詳しい仕様や実装、検証結果は[GitHubのREADMEとコード](https://github.com/ttokunaga-ja/claudeHistory)を参照してください。
