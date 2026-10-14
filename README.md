# opencode-better-sidebar

Small, focused OpenCode sidebar plugins that make daily coding sessions faster.

If this helps your workflow, please star the repo.

<p align="center">
  <img src="assets/screenshot.png" alt="opencode-better-sidebar screenshot" width="980" />
</p>

## Install

Requires OpenCode V2.

```sh
opencode plugin add 'github:mwdavisii/opencode-better-sidebar#main::path:plugins/context-progress'
opencode plugin add 'github:mwdavisii/opencode-better-sidebar#main::path:plugins/session-tokens'
opencode plugin add 'github:mwdavisii/opencode-better-sidebar#main::path:plugins/open-in'
opencode plugin add 'github:mwdavisii/opencode-better-sidebar#main::path:plugins/recap'
```

### Sidebar order

V2 removed the per-plugin slot `order` field, so sidebar sections now appear in the order the
plugins are enabled. List them explicitly in `plugins` in that order to pin a layout:

```jsonc
{
  "plugins": [
    "github:mwdavisii/opencode-better-sidebar#main::path:plugins/context-progress",
    "github:mwdavisii/opencode-better-sidebar#main::path:plugins/session-tokens",
    "github:mwdavisii/opencode-better-sidebar#main::path:plugins/open-in",
    "github:mwdavisii/opencode-better-sidebar#main::path:plugins/recap"
  ]
}
```

## Local development (no publishing required)

The plugins load straight from a checkout, and there is **no build step**: `exports["./tui"]`
points at the `index.tsx` source, which OpenCode transpiles at load time.

Point OpenCode at the plugin directories in `opencode.json(c)` — absolute paths are safest
(relative paths resolve from the config file that contains them):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/opencode-better-sidebar/plugins/context-progress",
    "/absolute/path/to/opencode-better-sidebar/plugins/session-tokens",
    "/absolute/path/to/opencode-better-sidebar/plugins/open-in",
    "/absolute/path/to/opencode-better-sidebar/plugins/recap"
  ]
}
```

Then restart OpenCode (`opencode service restart`) and open a session.

## Plugin Pack

- [`@mwdavisii/opencode-open-in`](./plugins/open-in) - quick buttons to open the current session folder in Zed, VS Code, or Cursor.
- [`@mwdavisii/opencode-context-progress`](./plugins/context-progress)` - context usage progress bar with token usage, window limit, and spend.
- [`@mwdavisii/opencode-recap`](./plugins/recap) - one-click AI recap for the current session.
- [`@mwdavisii/opencode-session-tokens`](./plugins/session-tokens) - collapsible session token totals with per-model breakdown.
