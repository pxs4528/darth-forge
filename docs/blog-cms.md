# Blog writing desk

After GitHub deploys this change:
- Readers: https://pipboi.dev/blog
- Editor: https://budget.pipboi.dev/cms (Tailscale required), existing ADMIN_SECRET.

Create a story, enter a unique lowercase hyphenated slug, and save a draft.
Preview displays the current edits. Commit & publish first commits a Markdown
snapshot to GitHub, then makes that version public without a redeployment.
Readers see Published and Last updated dates (UTC), plus a link to the commit.
The original publish date survives updates and unpublishing/republishing.
An unchanged Publish reuses the existing commit and its dates.
Save as draft unpublishes an existing post and removes its current GitHub file
in a commit. Deleting removes the database post and the current GitHub file;
earlier published versions remain in GitHub history. Slug changes change the URL.

## GitHub setup

Create a fine-grained GitHub token scoped to `pxs4528/darth-forge` with
**Contents: read and write**, then add it as the repository Actions secret
`BLOG_GITHUB_TOKEN`. CI passes it to the backend during deployment. The token
must be allowed to commit to `main` under the repository's branch rules.
The backend defaults to `BLOG_GITHUB_REPOSITORY=pxs4528/darth-forge` and
`BLOG_GITHUB_BRANCH=main`; local overrides are shown in `.env.example`.
Never expose this token as a `VITE_*` variable or put it into Markdown files.

Without the token, reading and saving private drafts still work, but publishing
returns an actionable error. Existing posts and their original dates are
preserved by the database migration; their next Publish creates the first
GitHub snapshot. Earlier revisions cannot be reconstructed retroactively.

Each published file is `content/blog/<database-id>.md`, with JSON front matter
(valid YAML) and a Markdown body. Publish and Update commit messages include
the story title. GitHub commits are snapshots of writing-desk publications;
the live site still reads Turso. Direct repository edits do not update the site
and conflicting edits block publishing until reconciled. Blog-only commits
are excluded from the deployment workflow.

GitHub failures leave the live database version unchanged. A first failed
publish may reserve a private draft; its ID is returned to the editor so Retry
uses the same file. If GitHub succeeds but the response/database save fails,
retry the same content to recover the commit without creating a duplicate.
GitHub and Turso cannot commit atomically; until that retry, GitHub may contain
a newer snapshot than the site. Do not change/delete that draft before retrying.
Stale editor tabs are rejected; reload to get the current version before saving.

Bodies support Markdown. Select text and use the toolbar for headings, bold,
italics, links, lists, quotes, images, and fenced code. Ctrl/Cmd+B and I work
in the body. Preview and published articles use identical sanitized rendering.
Images require hosted HTTPS URLs; file uploads are not supported.
Link to another post with `[Read the story](/blog/post-slug)` or enter
`/blog/post-slug` using the Link button. Hovering over an internal post link
or focusing it with the keyboard opens a scrollable preview of the published
story. Escape closes the preview; clicking the link opens the story normally.
Previews also work in the editor's Preview view and only show published posts.
Emojis are ordinary text: paste them directly or press Windows + . to open
the emoji picker. For example: `## What I built 🚀`.
Unsafe scripts, event handlers, and embedded frames are removed.
The editor holds the login token in memory: reload or backend restart requires
login again. Unsaved edits are not persisted; save drafts regularly.

Posts persist in a separate blog_posts table in the existing Turso database.
The ledger reset does not delete posts. Existing database dumps include this
table. Public APIs return only
published posts; mutations use the existing AdminOnly session middleware.
The public VPS Caddy configuration blocks /cms and all /api/admin routes.
No changes are made directly to production: deploy via GitHub.
