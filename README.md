# Zenn content

## Markdown validation

Before pushing articles, check for currency symbols that Zenn would interpret as
inline math and bold markers that do not satisfy CommonMark boundary rules:

```bash
node scripts/check-zenn-markdown.mjs
```

To apply the safe mechanical fixes to published articles, run:

```bash
node scripts/check-zenn-markdown.mjs --fix
```

## Portfolio synchronization

Run this once on each development machine after cloning the repository:

```bash
node scripts/install-git-hooks.mjs
```

After that, pushing the `main` branch automatically mirrors published Zenn articles
and their referenced images into the sibling `../portfolio` repository, commits the
generated changes, and pushes Portfolio's `main` branch. The sync stops if Portfolio's
generated blog folders contain uncommitted changes, so hand-edited content is never
overwritten silently.
