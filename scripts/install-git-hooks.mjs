import { execFileSync } from "node:child_process";

execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
console.log("Git hooks を有効化しました。main の push 前に記事を検査します。Portfolio への公開同期は GitHub Actions が担当します。");
