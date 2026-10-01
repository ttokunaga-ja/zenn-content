import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseZennFrontmatter } from "./zenn-frontmatter.mjs";

const zennRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(zennRoot);
const portfolioRoot = join(workspaceRoot, "portfolio");
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
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function syncArticle(fileName, article) {
  const slug = basename(fileName, ".md");
  if (!article.published) return;

  const imagePaths = imagePathsFrom(article.body);
  let body = article.body;
  for (const imagePath of imagePaths) {
    const sourceRelative = imagePath.replace(/^\/images\//, "");
    const sourcePath = join(sourceImagesRoot, sourceRelative);
    if (!(await exists(sourcePath))) {
      throw new Error(`${fileName} が参照する画像がありません: images/${sourceRelative}`);
    }

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
  if (!(await exists(portfolioRoot))) throw new Error(`Portfolio リポジトリが見つかりません: ${portfolioRoot}`);
  assertCleanPortfolioTargets();

  const articleFiles = (await readdir(articlesRoot)).filter((file) => file.endsWith(".md")).sort();
  // Validate every article and referenced image before changing existing output.
  const articles = new Map();
  for (const file of articleFiles) {
    const article = parseZennArticle(await readFile(join(articlesRoot, file), "utf8"), file);
    articles.set(file, article);
    if (!article.published) continue;
    for (const imagePath of imagePathsFrom(article.body)) {
      const sourceRelative = imagePath.replace(/^\/images\//, "");
      if (!(await exists(join(sourceImagesRoot, sourceRelative)))) {
        throw new Error(`${file} が参照する画像がありません: images/${sourceRelative}`);
      }
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
  run("git", ["add", "content/ja/blog", "public/images/blog"], portfolioRoot);
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
