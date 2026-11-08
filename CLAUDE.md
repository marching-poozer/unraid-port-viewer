# unraid-port-viewer (poozer's Unraid plugins)

All of poozer's Unraid plugins in one public repo
(`github.com/marching-poozer/unraid-port-viewer`). The repo name stays as is:
it is the repository registered with Community Applications, so renaming it
means re-registering.

## Layout

```
ports/ containerview/ proxyhosts/ plugindisabler/
    <name>.plg   build.sh   src/usr/local/emhttp/plugins/<name>/   archive/<name>-<version>-noarch-1.txz
    (containerview also: tests/, docs/, dev-deploy.sh, its own CLAUDE.md - read it first for that plugin)
plugins/*.xml      CA templates (one per CA-listed plugin; must stay in this root folder)
ca_profile.xml     CA repository profile
ports.plg          copy of ports/ports.plg for installs from before the move (build.sh keeps it in sync)
.unraid.env        UNRAID / UNRAID_PORT for dev scripts (uncommitted)
```

Currently CA-listed: Ports, Container View. Proxy Hosts and Plugin Disabler are
here but have no CA template (and no forum support thread) yet.

## Workflow

- Per plugin: edit `src/`, then `cd <name> && ./build.sh [VERSION]` (default
  today's date). It builds `archive/<pkg>.txz` and stamps version + MD5 into
  `<name>.plg`. Commit the `.txz` and the stamped `.plg` together.
- Unraid compares versions as plain strings: a same-day rebuild needs a
  fixed-width suffix (`2026.11.08.01`, not `.1` then `.10`).
- Keep only the current `.txz` in each `archive/`; history has the rest.
- Every URL in a `.plg` and a CA template is an absolute
  `raw.githubusercontent.com/.../main/<name>/...` link, so a file only works
  after it is pushed to `main`. Check each referenced file exists before
  pushing.
- A plugin's `pluginURL` is baked into installs. Moving a `.plg` strands
  existing installs unless the old URL keeps serving a newer version whose
  `pluginURL` points at the new place (see `ports.plg` at the root).

## Rules

- Commits are authored as `poozer <253468855+marching-poozer@users.noreply.github.com>`
  (repo-local jj/git config). Don't put the real name, email, hostnames or
  LAN addresses in anything committed — source, docs, screenshots.
- jj colocated with git. Commit with explicit paths; this working copy
  often holds unrelated uncommitted work.
- Don't push, and don't publish a CA template, without asking.
