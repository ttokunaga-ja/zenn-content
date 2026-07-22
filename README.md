# Zenn content

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
