A GitHub Projects workspace inside bb: several projects, "My tasks", a grouped
list and a board, with GitHub as the source of truth.

## What you get

- An overview of connected projects with real per-status counts.
- Per-project list and board views with search, filters, sorting and
  drag-and-drop status changes on the board.
- A task panel to edit title, description, assignees, single-select and date
  fields, plus a discussion with Markdown, @mentions and image/video uploads.
- Quick creation of draft items or repository issues added to a project.

## How it works

The server uses the machine's shared `gh` session (or `GH_TOKEN` /
`GITHUB_TOKEN`), so every change is authored by that GitHub account. Reads are
cached in the plugin's SQLite store and refreshed in the background. Reading
needs the `read:project` scope; editing needs `project`.

## For agents

The bundled skill points agents at the read-only `bb github-projects` CLI
(`status`, `list`, `refresh`, `projects`). Agents must not change GitHub
without the user's instruction.
