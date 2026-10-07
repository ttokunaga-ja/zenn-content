---
title: "Claude DesktopのCode履歴を別アカウントへ引き継ぐCLI「claudeHistory」を作った"
emoji: "📚"
type: "tech"
topics: ["claude", "rust", "cli", "windows", "macos"]
published: false
---

Claude Desktopでアカウントを切り替えたところ、Codeの会話が新しいアカウントの一覧に表示されなくなりました。

同じPCに残っているCodeのローカル履歴を、切り替え後のアカウントへ追加できるようにしたのが、Rust製CLI **claudeHistory** です。macOSとWindows向けの実行ファイルを配布しているので、使う側にRustやPython、APIキーは必要ありません。

https://github.com/ttokunaga-ja/claudeHistory

## 何ができるか

同じPCで、自分が所有するClaude Desktopアカウント間のCode履歴を引き継ぎます。既存の履歴は上書きせず、足りない分だけを追加します。

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

最新版へ更新するときも、同じインストールコマンドを使えます。手動でファイルを取得したい場合は[GitHub Releases](https://github.com/ttokunaga-ja/claudeHistory/releases/latest)を利用してください。

## 引き継ぎの手順

まずDesktopで移行先のアカウントへログインします。引き継ぎ対象の会話で作業している場合は、作業を終えておきます。

以下のコマンドはmacOS・Windows共通です。

```sh
claudeHistory accounts
claudeHistory status
claudeHistory transfer --dry-run
```

`accounts`で保存済みアカウントと履歴件数、`status`でClaudeの起動状態、`--dry-run`で追加予定の件数を確認できます。この段階では履歴を変更しません。

対象を確認できたら、次のコマンドで引き継ぎます。

```sh
claudeHistory
```

移行元が複数ある場合は番号で選びます。移行先の組織が複数ある場合も選択が必要です。表示されたアカウントIDと件数を確認して進めてください。

作業中と判定された場合は「作業中です。作業を終了してから進めてください。」と表示して中止します。Desktopだけが起動している場合は、終了してよいかYes/Noで確認します。判断できない場合は、作業を終えてDesktop・CLIを手動終了してから再実行してください。

完了するとバックアップの場所が表示されます。Desktopを起動し直して、追加された会話の一覧と本文を確認してください。

## 追加した履歴を取り消す

引き継ぎ時に表示されたバックアップのパスを指定します。

```sh
claudeHistory undo "バックアップの絶対パス"
```

取り消すのは、その実行で追加した登録だけです。元の履歴や会話本文は削除しません。追加した登録が後から変更されている場合は中止するので、新しい作業を勝手に消すことはありません。

claudeHistoryは非公式ツールです。Desktopの更新によって動作が変わる可能性があるため、まず`--dry-run`で確認してください。詳しい仕様や実装、検証結果は[GitHubのREADMEとコード](https://github.com/ttokunaga-ja/claudeHistory)を参照してください。
