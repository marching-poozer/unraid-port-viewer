# containerview

Unraid plugin that replaces the Docker tab's container list (and groups the
Dashboard's Docker tile) with category groups, compose stack rows, a filter
bar, group/stack actions and an update picker - an automatic alternative to
hand-maintained Docker folders (e.g. the folder.view plugins).

Server-specific notes (your box's address, local backups) go in an
uncommitted `CLAUDE.local.md`; the repo root's `.unraid.env` (shared by every
plugin in the repo) holds `UNRAID` / `UNRAID_PORT` for the dev scripts.

## Layout

```
src/usr/local/emhttp/plugins/containerview/
  ContainerViewDocker.page      Menu="Docker", untitled: takes over the native list
  ContainerViewDashboard.page   Menu="Dashboard": groups the Docker tile
  containerview-core.js         pure logic (UMD: browser + node tests) - rows, grouping,
                                filters, rules, plans. Put anything testable here.
  containerview.js              Docker tab glue (bar, cog, render, drag, menus wiring)
  containerview-menus.js        shared by both pages: group/stack actions, rule dialogs,
                                update picker
  containerview-dashboard.js    Dashboard tile glue
  containerview.css
  include/containers.php        JSON feed (mirrors native DockerContainers.php data)
  include/actions.php           start/stop/... via docker compose -p / docker
  include/icons.php rules.php settings.php   POST endpoints, write /boot/config/plugins/containerview/*.json
  include/store.php             their shared locked, atomic (temp+rename) JSON save;
                                refuses to overwrite a file that doesn't parse
tests/core.test.js              node --test tests/   (synthetic data only)
tests/parity-live.sh            our rows vs native rows, live on the server
build.sh / containerview.plg    packaging (archive/*.txz is committed, like proxyhosts)
dev-deploy.sh                   copy src into RAM on the box for quick iteration
```

User data on the flash (kept on plugin removal): `settings.json`,
`rules.json`, `stack-icons.json`, `group-icons.json`.

## Workflow

- Edit, `node --test tests/`, `./dev-deploy.sh`, `./tests/parity-live.sh`
  (must say `identical: N/N`; a one-off miss is usually a container changing
  state between the two fetches - re-run).
- dev-deploy writes to RAM only and doesn't delete removed files. To ship:
  `./build.sh [VERSION]` (default today's date; bump for same-day rebuilds,
  e.g. 2026.11.05.1 - Unraid compares versions as plain strings, so `.10`
  counts as older than `.9`: keep suffixes the same width, e.g. `.91`
  after `.9`), copy `archive/<pkg>.txz` to
  `/boot/config/plugins/containerview/`, then
  `plugin install /path/to/containerview.plg` on the box. The .plg's URL
  points at GitHub, but a local txz with the right MD5 is used without
  downloading, so boot doesn't need the network.

## Rules that matter

- **Native parity.** Each container row must be byte-identical to
  DockerContainers.php output (other plugins, e.g. Proxy Hosts, read the
  rows). Only additions: `data-cv-*` attributes, the `cv-clamp` class + more
  link, the `cv-tags` span, and (at runtime, for collapsing) the
  `cv-collapsed` class. tests/parity.js strips exactly these and renders with
  rules applied and readmore on, so the badges/clamps are covered. Quirks kept on purpose: addslashes-only
  onclick with the stray space, `span.docker_readmore` wrappers, icon mtime
  from `$info['icon']`, the Tailscale block verbatim. Anything visual on a
  row (e.g. the rule badge) is CSS on a `data-cv-*` attribute.
- **Never call `.readmore()`** on the cells - its resize handler is what froze
  the native tab. Long cells clamp with our own toggle.
- The Dashboard tile's native `span.outer.apps` icons are moved, never
  rebuilt or re-classed (native counts and the "started only" switch read
  them). Our stack icons deliberately lack the `apps` class.
- Takeover works by redefining global `loadlist()`, `listview()`,
  `LockButton()` before the native `$(ready)` runs - hence Enabled on/off
  needs a page reload.

## Gotchas (each cost a debugging round)

- Category names: keys are the lower-cased label values; anything a label
  can carry (1-40 chars, no comma/control chars) is valid - `cv_valid_category`
  in store.php and `CAT_RE` in containerview-menus.js must agree. The rule
  dialog's chips insert the key, not the title-cased title (titleCase turns
  `-`/`_` into spaces, which would be a different key).
- PHP validation regexes end in `\z`, not `$` (`$` accepts a trailing newline).
- Keys that come from data (stack/category names) go through `core.own()` or
  a Map, never a bare `obj[key]` - a stack called `constructor` is real data.

- Unraid CSS: `[data-icon]:before { font-family: docker-icon !important }` -
  never use a `data-icon` attribute (we use `data-cv-icon`).
- context.js (in dynamix.js) places menus at `min(click-13, innerWidth-168)`,
  assuming <=160px width: wide menus near the right edge need
  `keepOnScreen()`. Flipped submenus get `left:-100%`, leaving a gap that
  drops :hover - our cog menu anchors them flush.
- context.js attaches via `$(document).on('click', '#id')`; an inline onclick
  that calls `context.attach` opens the menu in the same click.
- Vimium C hints any element with a click listener: delegate handlers from
  `document`, one `role=button` per control.
- jQuery switchButton adds an unclassed clearing `<div>`; the cog goes before it.
- Dashboard CSS floats `span.outer`: sections need `clear: both` +
  `display: flow-root`, and icons a right margin.
- Background updates: StartCommand.php starts commands after `sleep .3`;
  calling `bannerAlert()` straight away sees nothing running and ends at once.
- Compose project for grouping comes from the `com.docker.compose.project`
  label (native `ComposeProject` is only set for Compose Manager stacks).
- Compose actions: `docker compose -p P <action> svc...` works without the
  files and respects depends_on. Recreating a stack must use the exact
  `com.docker.compose.project.config_files` (incl. the Compose Manager
  override), and check images match local tags first or it silently upgrades.
- Unraid's `update_container` (template recreate) only handles `dockerman`
  containers; compose ones are listed as skipped in the picker.
