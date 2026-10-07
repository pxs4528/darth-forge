# Blog writing desk

After GitHub deploys this change:
- Readers: https://pipboi.dev/blog
- Editor: https://budget.pipboi.dev/cms (Tailscale required), existing ADMIN_SECRET.

Create a story, enter a unique lowercase hyphenated slug, and save a draft.
Preview displays the current edits. Publish makes it public immediately, with
no code change or redeployment. Save as draft unpublishes an existing post.
Deleting is permanent and asks for confirmation. Slug changes change the URL.

Bodies are plain text; blank lines create paragraphs. HTML is escaped, not
executed. This first version has no image upload or rich text formatting.
The editor holds the login token in memory: reload or backend restart requires
login again. Unsaved edits are not persisted; save drafts regularly.

Posts persist in a separate blog_posts table in the existing Turso database.
The ledger reset does not delete posts. Existing database dumps include this
table. No new environment variables are needed. Public APIs return only
published posts; mutations use the existing AdminOnly session middleware.
The public VPS Caddy configuration blocks /cms and all /api/admin routes.
No changes are made directly to production: deploy via GitHub.