import { execFileSync } from "node:child_process";

execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
console.log("Git hooks を有効化しました。以後 main の git push 時に Portfolio へ同期されます。");
