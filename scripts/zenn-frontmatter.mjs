export function parseZennFrontmatter(raw, file) {
  const matched = raw.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!matched) throw new Error(`${file} の frontmatter を読み取れません。`);
  const [, frontmatter, body] = matched;
  const get = (key) => frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1]?.trim() ?? "";
  const publicationFields = frontmatter.match(/^published:.*$/gm) ?? [];
  const publishedValue = get("published");
  if (publicationFields.length !== 1 || !["true", "false"].includes(publishedValue)) {
    throw new Error(`${file} の published は true または false を明示してください。`);
  }
  const title = get("title").replace(/^"|"$/g, "").replace(/\\"/g, '"');
  const topics = [...get("topics").matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|([^,\[\]\s][^,\]]*)/g)]
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter(Boolean);
  return { body, published: publishedValue === "true", title, topics };
}
