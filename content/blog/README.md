# Published blog snapshots

The private writing desk creates one Markdown file per published story here.
Files use stable database IDs (`123.md`) so title and URL changes stay in the
same Git history. JSON front matter (valid YAML) contains the title, slug,
excerpt, original publication date, and latest published update date.

Write and publish through the writing desk. These files are the Git history of
published snapshots; the running site reads its database, so editing a file
directly here does not publish it to the site. Conflicting GitHub edits are
rejected by the writing desk rather than silently overwritten.

Drafts are not committed. Unpublishing or deleting removes the current file in
a new commit; earlier versions remain in repository history. Blog-only commits
do not rebuild or restart the website.
