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

The pre-push hook runs read-only Markdown validation and offline tests on `main`.
It never generates content, commits, or pushes to Portfolio. GitHub Actions mirrors
published Zenn articles and their referenced images into Portfolio after a source
push, so publication does not depend on a local sibling checkout.
Local previews stop if Portfolio's generated blog folders contain uncommitted
changes, so hand-edited content is not overwritten silently.

Every article must explicitly set `published: true` or `published: false`.
Invalid frontmatter or missing referenced images stop synchronization before
existing Portfolio content is removed. Staged Portfolio changes also stop the
sync so unrelated work cannot enter the generated commit.

For local generation and validation without committing or pushing:

```bash
node scripts/sync-portfolio.mjs --no-commit
node --test tests/*.test.mjs
```

CI or a separate checkout can pass explicit absolute paths while preserving the
same generated Markdown and image bytes:

```bash
node scripts/sync-portfolio.mjs --source-root=/absolute/path/to/zenn-content --portfolio-root=/absolute/path/to/portfolio --no-commit
```

### GitHub Actions publication

The cutover was completed on 2026-10-03: App synchronization created the Portfolio
commit, its deployment succeeded, and the live Japanese article and all five added
images were verified. A repeated no-diff sync skipped publication.
App `zenn-portfolio-sync-ttokunaga-ja` (ID `5171935`) is installed only on Portfolio;
the source repository variable `ZENN_PORTFOLIO_SYNC_ENABLED` is `true`.

`.github/workflows/sync-portfolio.yml` runs on relevant `main` changes, manual
dispatch, and a daily reconciliation schedule. Pushes always run local tests;
cross-repository publishing stays inactive until the Zenn repository variable
`ZENN_PORTFOLIO_SYNC_ENABLED` is set to `true`. The workflow
validates a clean Portfolio checkout without credentials, repeats generation
against the current Portfolio `main`, and creates a GitHub App token only when
there is a content diff. It commits only `content/ja/blog` and
`public/images/blog`. If either repository advances during the run, the push
stops; a later run or manual dispatch reconciles it. An empty diff causes no
commit or deployment.

For a new installation, the repository owner should:

1. Open [GitHub App settings](https://github.com/settings/apps/new), register a
   new App under `ttokunaga-ja`, give it the Zenn repository URL as Homepage,
   disable Webhook delivery, and grant only repository `Contents: Read and write`
   permission (GitHub adds Metadata read permission automatically). Restrict
   installation to this account.
2. Install the App with **Only select repositories** and select **portfolio**.
   Do not install it on Zenn or grant organization-wide access.
3. Generate the App's private key. In **zenn-content → Settings → Secrets and
   variables → Actions**, create variable `ZENN_PORTFOLIO_APP_ID` with the App ID
   and secret `ZENN_PORTFOLIO_APP_PRIVATE_KEY` with the entire PEM. Do not paste
   the private key into issues, commits, chat, or Portfolio settings.
4. After reviewing the Zenn `main` publication scope, set the Zenn Actions
   variable `ZENN_PORTFOLIO_SYNC_ENABLED=true` and run **Sync published Zenn
   articles to Portfolio** with `workflow_dispatch`. If the current articles
   were already synchronized by the local pre-push hook, this run will correctly
   show no diff. An approved later article or image change is needed to verify
   the App's actual write path. After the App is configured, preview that update
   locally with `--no-commit`, arrange one source push without the local
   publishing hook, then check its generated diff, Portfolio deployment, and
   live Japanese article and image
   before changing the hook permanently.

The App token is scoped to the `portfolio` repository, not to file paths. The
workflow checks that the generated diff stays inside the two managed folders
before committing. The App push to `main` starts Portfolio's existing push
deployment and translation workflows.
Gemini credentials, translation state, and Cloudflare credentials stay in
Portfolio. Translation calls remain controlled by Portfolio's separate
`BLOG_TRANSLATION_ENABLED` setting.

The local publishing hook has been retired. Keep `--no-commit` previews for local
validation. Do not reintroduce automatic local cross-repository pushes.
