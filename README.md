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
The normal publication workflow is to edit articles or images, validate them, and
push the source changes to Zenn `main`. Actions generates and publishes the
Portfolio content; no local Portfolio checkout or synchronization command is
needed.

Every article must explicitly set `published: true` or `published: false`.
Invalid frontmatter or missing referenced images stop synchronization before
existing Portfolio content is removed. The generator also rejects staged changes,
dirty managed folders, unsafe paths, and symlinks in a supplied Portfolio checkout.

The generator only writes Markdown and image files. It requires explicit absolute
`--source-root` and `--portfolio-root` paths, has no default sibling targets, and
never stages, commits, or pushes. The workflow owns Git publication. Offline
fixture tests exercise generation in temporary checkouts:

```bash
node --test tests/*.test.mjs
```

### GitHub Actions publication

The cutover was completed on 2026-10-03: App synchronization created the Portfolio
commit, its deployment succeeded, and the live Japanese article and all five added
images were verified. A repeated no-diff sync skipped publication.
App `zenn-portfolio-sync-ttokunaga-ja` (ID `5171935`) is installed only on Portfolio;
the source repository variable `ZENN_PORTFOLIO_SYNC_ENABLED` is `true`.

`.github/workflows/sync-portfolio.yml` runs on relevant `main` changes, manual
dispatch, and a daily reconciliation schedule. Pushes always run offline tests;
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
   articles to Portfolio** with `workflow_dispatch`. A no-diff run skips
   publication. For an approved source change, check the workflow's generated
   diff, Portfolio deployment, and live Japanese article and images.

The App token is scoped to the `portfolio` repository, not to file paths. The
workflow checks that the generated diff stays inside the two managed folders
before committing. The App push to `main` starts Portfolio's existing push
deployment and translation workflows.
Gemini credentials, translation state, and Cloudflare credentials stay in
Portfolio. Translation calls remain controlled by Portfolio's separate
`BLOG_TRANSLATION_ENABLED` setting.

The local hook is validation-only. All Portfolio synchronization and publication
run through GitHub Actions.
