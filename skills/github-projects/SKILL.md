---
name: github-projects
description: Read connected GitHub Projects and assigned tasks in bb, inspect sync state, or discover an owner's projects.
---

# GitHub Projects workspace

Use the installed `github-projects` plugin for connected Projects v2 data:

```sh
bb github-projects status --json
bb github-projects list --json
bb github-projects refresh --json
bb github-projects projects OWNER --json
```

These commands are read-only toward GitHub; refresh updates the local cache. Inspect status first when identity, configuration, freshness or access matters. Treat stale snapshots, API truncation warnings and errors as incomplete evidence, not an empty project. Use full repository references or project item IDs when identifying tasks.

The plugin uses the server's shared `gh` identity, not each bb user's personal account. “My tasks” means tasks assigned to that shared GitHub login. Environment `GH_TOKEN` / `GITHUB_TOKEN` can override stored gh authentication; optional `tokenFile` is server-side. Never print token values. Reading needs `read:project`; editing needs `project` plus relevant repository access. OAuth scope refresh is `gh auth refresh --hostname github.com --scopes project`.

The UI connects up to 25 projects by name; disconnecting takes effect after Save. It supports list/board views, filters, task detail, explicit title/body/assignee/select/date edits, creation, and paginated comments. Desktop board drag changes the source project's status in GitHub, with immediate placement and status-only rollback on failure. Numeric and other text fields are read-only. Without a repository, creation makes a draft with no comments; with a repository, issue creation and project attachment are separate steps. A partial warning may mean an issue already exists: inspect its URL before retrying.

Comments are accessible from both list and board, with counts on task cards. SDK Markdown rendering, formatting tools and preview support composition; mention autocomplete shows names and logins. Reply means an ordinary comment containing a quote, original link and mention, not a native GitHub thread. Comment publication requires the explicit submit action.

Selecting media uploads it immediately, before comment publication: PNG, JPG/JPEG, GIF, WebP, SVG, MP4, MOV or WebM, at most 5 MiB per file. Uploads require repository write access; PDF/ZIP are unsupported. Removing an attachment from the draft does not delete the uploaded asset. The implementation follows [official cli/cli upload code](https://github.com/cli/cli/blob/trunk/internal/attachments/client.go) at `uploads.github.com/user-attachments/assets`, using existing credentials; the installed gh does not need upgrading. Mock upload tests are not evidence of a live upload.

Local browser state restores the last project/page, list/board view, search, filters, sort, date mapping, open task and main/board scroll across reopen/reload. Explicit deep links win. Unsaved comment/task drafts and credentials are excluded; these preferences do not modify GitHub.

Do not perform GitHub writes without a user instruction authorizing the action. Never treat installation, a cached read, or a local test as proof of a live write. Do not invent agent checks, human acceptance, role permissions or required-field policies; use actual GitHub fields and permissions. Local display preferences do not change GitHub.
