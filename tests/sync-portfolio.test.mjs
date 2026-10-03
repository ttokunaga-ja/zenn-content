import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { parseZennFrontmatter } from "../scripts/zenn-frontmatter.mjs";

const article = (publication, body = "本文") => `---\ntitle: "Test"\ntopics: ["test"]\n${publication}\n---\n${body}\n`;

test("publication must be an explicit unique boolean, without consuming the next line", () => {
  assert.equal(parseZennFrontmatter(article("published: true"), "a.md").published, true);
  assert.equal(parseZennFrontmatter(article("published: false"), "a.md").published, false);
  assert.equal(parseZennFrontmatter(article("published: true").replaceAll("\n", "\r\n"), "a.md").published, true);
  for (const value of ["", "published:", "published: null", 'published: "true"', "published: yes", "published:\ntrue", "published: true\npublished: false"]) {
    assert.throws(() => parseZennFrontmatter(article(value), "a.md"), /true または false/);
  }
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "portfolio-sync-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "zenn-content");
  const target = join(root, "portfolio");
  await mkdir(join(source, "articles"), { recursive: true });
  await mkdir(join(source, "scripts"));
  for (const file of ["sync-portfolio.mjs", "zenn-frontmatter.mjs", "check-zenn-markdown.mjs"]) {
    await cp(new URL(`../scripts/${file}`, import.meta.url), join(source, "scripts", file));
  }
  await mkdir(join(target, "content/ja/blog"), { recursive: true });
  await mkdir(join(target, "public/images/blog"), { recursive: true });
  await writeFile(join(target, "content/ja/blog/old.md"), "existing article");
  await writeFile(join(target, "public/images/blog/old.png"), "existing image");
  execFileSync("git", ["init", "-b", "main", target]);
  execFileSync("git", ["add", "."], { cwd: target });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"], { cwd: target });
  const run = (script = "sync-portfolio.mjs", options = []) =>
    spawnSync(process.execPath, [join(source, "scripts", script), "--no-commit", ...options], { encoding: "utf8" });
  return { source, target, run };
}

test("invalid publication preserves existing articles and images, and checker reports failure", async (t) => {
  const { source, target, run } = await fixture(t);
  await writeFile(join(source, "articles/a.md"), article("published:"));
  assert.equal(run().status, 1);
  assert.equal(run("check-zenn-markdown.mjs").status, 1);
  assert.equal(await readFile(join(target, "content/ja/blog/old.md"), "utf8"), "existing article");
  assert.equal(await readFile(join(target, "public/images/blog/old.png"), "utf8"), "existing image");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: target, encoding: "utf8" }), "");
});

test("missing image stops before removing existing output", async (t) => {
  const { source, target, run } = await fixture(t);
  await writeFile(join(source, "articles/a.md"), article("published: true", "![image](/images/missing.png)"));
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /画像がありません/);
  assert.equal(await readFile(join(target, "content/ja/blog/old.md"), "utf8"), "existing article");
});

test("local sync restores published article and image without staging or committing", async (t) => {
  const { source, target, run } = await fixture(t);
  await mkdir(join(source, "images"));
  await writeFile(join(source, "images/a.png"), "new image");
  await writeFile(join(source, "articles/a.md"), article("published: true", "![image](/images/a.png)"));
  await writeFile(join(source, "articles/draft.md"), article("published: false"));
  const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(join(target, "content/ja/blog/a.md"), "utf8"), /\/images\/blog\/a\/a.png/);
  assert.equal(await readFile(join(target, "public/images/blog/a/a.png"), "utf8"), "new image");
  await assert.rejects(readFile(join(target, "content/ja/blog/draft.md")), { code: "ENOENT" });
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }), before);
  assert.equal(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: target, encoding: "utf8" }), "");
});

test("explicit checkouts produce the established frontmatter, body, and image bytes", async (t) => {
  const { source, target, run } = await fixture(t);
  await mkdir(join(source, "images"));
  await writeFile(join(source, "images/a.png"), Buffer.from([0, 1, 2, 255]));
  await writeFile(join(source, "articles/a.md"), article("published: true", "Alpha\n![image](/images/a.png)\nOmega"));
  const result = run("sync-portfolio.mjs", [`--source-root=${source}`, `--portfolio-root=${target}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(target, "content/ja/blog/a.md"), "utf8"),
    '---\ntitle: "Test"\nabstract: "Alpha Omega"\npublishedAt: ""\ncanonicalUrl: "https://zenn.dev/t_tokunaga/articles/a"\ntags:\n  - "test"\n---\nAlpha\n![image](/images/blog/a/a.png)\nOmega\n');
  assert.deepEqual(await readFile(join(target, "public/images/blog/a/a.png")), Buffer.from([0, 1, 2, 255]));
});

test("unsafe article and image paths stop before removing existing output", async (t) => {
  const { source, target, run } = await fixture(t);
  await mkdir(join(source, "images"));
  await writeFile(join(source, "images/real.png"), "image");
  await symlink("real.png", join(source, "images/link.png"));
  await writeFile(join(source, "articles/a.md"), article("published: true", "![image](/images/link.png)"));
  assert.equal(run().status, 1);
  assert.equal(await readFile(join(target, "content/ja/blog/old.md"), "utf8"), "existing article");
  await writeFile(join(source, "articles/a.md"), article("published: true", "![image](/images/../outside.png)"));
  assert.equal(run().status, 1);
  assert.equal(await readFile(join(target, "content/ja/blog/old.md"), "utf8"), "existing article");
  await writeFile(join(source, "articles/a.md"), article("published: false"));
  await writeFile(join(source, "articles/escape\\name.md"), article("published: true", "![image](/images/real.png)"));
  assert.equal(run().status, 1);
  assert.equal(await readFile(join(target, "content/ja/blog/old.md"), "utf8"), "existing article");
});

test("overlapping or descendant target root cannot remove generated output", async (t) => {
  const { source, target, run } = await fixture(t);
  assert.equal(run("sync-portfolio.mjs", [`--portfolio-root=${source}`]).status, 1);
  await mkdir(join(target, "nested"));
  assert.equal(run("sync-portfolio.mjs", [`--portfolio-root=${join(target, "nested")}`]).status, 1);
  assert.equal(await readFile(join(target, "content/ja/blog/old.md"), "utf8"), "existing article");
});

test("article-directory symlinks stop before removing existing output", async (t) => {
  const { source, target, run } = await fixture(t);
  await rm(join(source, "articles"), { recursive: true });
  await mkdir(join(source, "actual-articles"));
  await symlink("actual-articles", join(source, "articles"));
  assert.equal(run().status, 1);
  assert.equal(await readFile(join(target, "content/ja/blog/old.md"), "utf8"), "existing article");
});

test("updates and unpublishing remove stale Japanese output while preserving English state", async (t) => {
  const { source, target, run } = await fixture(t);
  const commitGenerated = () => {
    for (const path of ["content/ja/blog", "public/images/blog"]) {
      const status = execFileSync("git", ["status", "--porcelain", "--", path], { cwd: target, encoding: "utf8" });
      if (status) execFileSync("git", ["add", "-A", "--", path], { cwd: target });
    }
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "generated"], { cwd: target });
  };
  await mkdir(join(source, "images"));
  await writeFile(join(source, "images/a.png"), "image");
  await writeFile(join(source, "articles/a.md"), article("published: true", "first ![image](/images/a.png)"));
  await mkdir(join(target, "content/en/blog"), { recursive: true });
  await mkdir(join(target, "translations"), { recursive: true });
  await writeFile(join(target, "content/en/blog/a.md"), "English sentinel");
  await writeFile(join(target, "translations/blog-en-state.json"), "state sentinel");
  assert.equal(run().status, 0);
  commitGenerated();
  await writeFile(join(source, "articles/a.md"), article("published: true", "updated body"));
  assert.equal(run().status, 0);
  assert.match(await readFile(join(target, "content/ja/blog/a.md"), "utf8"), /updated body/);
  await assert.rejects(readFile(join(target, "public/images/blog/a/a.png")), { code: "ENOENT" });
  commitGenerated();
  await writeFile(join(source, "articles/a.md"), article("published: false", "updated body"));
  assert.equal(run().status, 0);
  await assert.rejects(readFile(join(target, "content/ja/blog/a.md")), { code: "ENOENT" });
  commitGenerated();
  await rm(join(source, "articles/a.md"));
  const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" });
  const result = spawnSync(process.execPath, [join(source, "scripts/sync-portfolio.mjs"), "--no-push"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /差分はありません/);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }), before);
  assert.equal(await readFile(join(target, "content/en/blog/a.md"), "utf8"), "English sentinel");
  assert.equal(await readFile(join(target, "translations/blog-en-state.json"), "utf8"), "state sentinel");
});

test("unrelated staged work blocks synchronization", async (t) => {
  const { target, run } = await fixture(t);
  await writeFile(join(target, "unrelated.txt"), "user work");
  execFileSync("git", ["add", "unrelated.txt"], { cwd: target });
  assert.equal(run().status, 1);
  assert.equal(await readFile(join(target, "content/ja/blog/old.md"), "utf8"), "existing article");
});
