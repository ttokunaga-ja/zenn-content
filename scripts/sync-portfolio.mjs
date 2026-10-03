import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseZennFrontmatter } from "./zenn-frontmatter.mjs";

function option(name, fallback) {
  const prefix = `${name}=`;
  const values = process.argv.slice(2).filter((arg) => arg.startsWith(prefix));
  if (values.length > 1) throw new Error(`${name} は一度だけ指定してください。`);
  const value = values[0]?.slice(prefix.length);
  if (value !== undefined && (!value || !isAbsolute(value))) throw new Error(`${name} には絶対パスを指定してください。`);
  return value ? resolve(value) : fallback;
}

const defaultZennRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const zennRoot = option("--source-root", defaultZennRoot);
const portfolioRoot = option("--portfolio-root", join(dirname(zennRoot), "portfolio"));
const articlesRoot = join(zennRoot, "articles");
const sourceImagesRoot = join(zennRoot, "images");
const targetArticlesRoot = join(portfolioRoot, "content", "ja", "blog");
const targetImagesRoot = join(portfolioRoot, "public", "images", "blog");
const zennProfile = "t_tokunaga";
const skipPush = process.argv.includes("--no-push");
const skipCommit = process.argv.includes("--no-commit");

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function hasStagedChanges() {
  try {
    run("git", ["diff", "--cached", "--quiet"], portfolioRoot);
    return false;
  } catch (error) {
    if (error.status === 1) return true;
    throw error;
  }
}

function assertCleanPortfolioTargets() {
  if (hasStagedChanges()) {
    throw new Error("Portfolio にステージ済みの変更があります。同期コミットへの混入を防ぐため停止します。");
  }
  const status = run("git", ["status", "--porcelain", "--", "content/ja/blog", "public/images/blog"], portfolioRoot);
  if (status) {
    throw new Error(
      "Portfolio のブログ同期先に未コミット変更があります。内容を確認して commit または退避してから再度 push してください。"
    );
  }
}

function stageChangedTargets() {
  for (const path of ["content/ja/blog", "public/images/blog"]) {
    if (run("git", ["status", "--porcelain", "--untracked-files=all", "--", path], portfolioRoot)) {
      run("git", ["add", "-A", "--", path], portfolioRoot);
    }
  }
}

function parseZennArticle(raw, file) {
  return parseZennFrontmatter(raw, file);
}

function imagePathsFrom(body) {
  return new Set([...body.matchAll(/!\[[^\]]*\]\((\/images\/[^)\s]+)(?:\s+[^)]*)?\)/g)].map((match) => match[1]));
}

function abstractFrom(body) {
  const text = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\(([^)]*)\)/g, "")
    .replace(/^\s*(?:#{1,6}|>|[-*+] |\d+\. )\s*/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 180) || "Zennで公開した記事です。";
}

function yamlString(value) {
  return JSON.stringify(value);
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function assertRegularFileInside(root, sourceRelative, label) {
  if (!sourceRelative || sourceRelative.includes("\\") || sourceRelative.includes("\0") ||
      sourceRelative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} のパスが不正です: ${sourceRelative}`);
  }
  if (!(await exists(root))) throw new Error(`${label}がありません: ${sourceRelative}`);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error(`${label} の画像ディレクトリが不正です: ${root}`);
  const rootReal = await realpath(root);
  const path = resolve(rootReal, sourceRelative);
  const inside = relative(rootReal, path);
  if (!inside || inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) {
    throw new Error(`${label} が ${root} の外を参照しています: ${sourceRelative}`);
  }
  let current = root;
  for (const component of sourceRelative.split("/")) {
    current = join(current, component);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`${label}がありません: ${sourceRelative}`);
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`${label} にシンボリックリンクは使えません: ${sourceRelative}`);
  }
  if (!(await lstat(path)).isFile()) throw new Error(`${label} は通常ファイルではありません: ${sourceRelative}`);
  return path;
}

async function assertSafeTargetRoots() {
  for (const targetRoot of [targetArticlesRoot, targetImagesRoot]) {
    let current = portfolioRoot;
    for (const component of relative(portfolioRoot, targetRoot).split(sep)) {
      current = join(current, component);
      if (await exists(current)) {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error(`同期先にシンボリックリンクがあります: ${current}`);
        if (!info.isDirectory()) throw new Error(`同期先がディレクトリではありません: ${current}`);
      }
    }
  }
}

function isInsideOrSame(parent, child) {
  const rel = relative(parent, child);
  return !rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function syncArticle(fileName, article) {
  const slug = basename(fileName, ".md");
  if (!article.published) return;

  const imagePaths = imagePathsFrom(article.body);
  let body = article.body;
  for (const imagePath of imagePaths) {
    const sourceRelative = imagePath.replace(/^\/images\//, "");
    const sourcePath = await assertRegularFileInside(sourceImagesRoot, sourceRelative, `${fileName} が参照する画像`);

    const targetRelative = join(slug, sourceRelative).replaceAll("\\", "/");
    const targetPath = join(targetImagesRoot, targetRelative);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath);
    body = body.replaceAll(imagePath, `/images/blog/${targetRelative}`);
  }

  const publishedAt = slug.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  const frontmatter = [
    "---",
    `title: ${yamlString(article.title)}`,
    `abstract: ${yamlString(abstractFrom(body))}`,
    `publishedAt: ${yamlString(publishedAt)}`,
    `canonicalUrl: ${yamlString(`https://zenn.dev/${zennProfile}/articles/${slug}`)}`,
    "tags:",
    ...article.topics.map((topic) => `  - ${yamlString(topic)}`),
    "---",
    ""
  ].join("\n");
  await writeFile(join(targetArticlesRoot, fileName), `${frontmatter}${body}`, "utf8");
}

async function main() {
  const known = ["--no-push", "--no-commit"];
  for (const arg of process.argv.slice(2)) {
    if (!known.includes(arg) && !arg.startsWith("--source-root=") && !arg.startsWith("--portfolio-root=")) {
      throw new Error(`不明なオプション: ${arg}`);
    }
  }
  if (!(await exists(portfolioRoot))) throw new Error(`Portfolio リポジトリが見つかりません: ${portfolioRoot}`);
  const sourceReal = await realpath(zennRoot);
  const targetReal = await realpath(portfolioRoot);
  if (isInsideOrSame(sourceReal, targetReal) || isInsideOrSame(targetReal, sourceReal)) {
    throw new Error("Zenn と Portfolio のルートが重複しています。");
  }
  const gitRoot = await realpath(run("git", ["rev-parse", "--show-toplevel"], portfolioRoot));
  if (gitRoot !== targetReal) throw new Error(`Portfolio のルートを指定してください: ${portfolioRoot}`);
  const articlesInfo = await lstat(articlesRoot);
  if (articlesInfo.isSymbolicLink() || !articlesInfo.isDirectory()) {
    throw new Error(`記事ディレクトリが不正です: ${articlesRoot}`);
  }
  assertCleanPortfolioTargets();
  await assertSafeTargetRoots();

  const articleEntries = await readdir(articlesRoot, { withFileTypes: true });
  for (const entry of articleEntries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile()) throw new Error(`記事は通常ファイルである必要があります: ${entry.name}`);
    const slug = basename(entry.name, ".md");
    if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error(`記事の slug が不正です: ${entry.name}`);
  }
  const articleFiles = articleEntries.filter((entry) => entry.name.endsWith(".md")).map((entry) => entry.name).sort();
  // Validate every article and referenced image before changing existing output.
  const articles = new Map();
  for (const file of articleFiles) {
    const article = parseZennArticle(await readFile(join(articlesRoot, file), "utf8"), file);
    articles.set(file, article);
    if (!article.published) continue;
    for (const imagePath of imagePathsFrom(article.body)) {
      const sourceRelative = imagePath.replace(/^\/images\//, "");
      await assertRegularFileInside(sourceImagesRoot, sourceRelative, `${file} が参照する画像`);
    }
  }
  await rm(targetArticlesRoot, { recursive: true, force: true });
  await rm(targetImagesRoot, { recursive: true, force: true });
  await mkdir(targetArticlesRoot, { recursive: true });

  for (const file of articleFiles) {
    await syncArticle(file, articles.get(file));
  }

  if (skipCommit) {
    console.log("Portfolio: ローカル同期を完了しました（--no-commit、commit/pushなし）。");
    return;
  }
  stageChangedTargets();
  if (!hasStagedChanges()) {
    console.log("Portfolio: Zenn記事の差分はありません。");
    return;
  }

  run("git", ["commit", "-m", "sync: import published Zenn articles"], portfolioRoot);
  if (skipPush) {
    console.log("Portfolio: 同期コミットを作成しました（--no-push）。");
    return;
  }
  run("git", ["push", "origin", "main"], portfolioRoot);
  console.log("Portfolio: Zenn記事を同期して main へ push しました。");
}

main().catch((error) => {
  console.error(`Zenn → Portfolio 同期に失敗しました: ${error.message}`);
  process.exitCode = 1;
});
