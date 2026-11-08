# Plugin Disabler

> This is a vibe-coded / AI-assisted project, built to scratch my own itch on
> my Unraid box. Sharing it in case it's useful to someone else — no
> guarantees beyond "works on my server."

A diagnostic tool for the Unraid web UI. When a page is blank, slow or
broken and you suspect a plugin, it lets you switch a plugin's GUI pages off
and on again without uninstalling anything, so you can find the culprit by
elimination.

It adds a **Manage** tab next to *Installed Plugins* on the **Plugins** page.

Requires Unraid 7.0 or later.

## Install

1. In the Unraid web UI, open **Plugins → Install Plugin**.
2. Paste this URL and click **Install**:
   ```
   https://raw.githubusercontent.com/marching-poozer/unraid-port-viewer/main/plugindisabler/plugindisabler.plg
   ```
3. Open **Plugins → Manage**.

## Using it

Each row is a plugin: its icon, name, description (taken from the plugin's
own README), author and an **Enabled** switch.

- **Switch a plugin off** to take all of its pages out of Unraid's menus, then
  reload the web UI and see whether the problem is gone. Switch it back on to
  restore them. Nothing is deleted or uninstalled.
- **Components:** a plugin that ships more than one page (say a Docker-tab
  hook and a Settings page) has a *Components* link under its description. It
  opens one switch per page, labelled with the page's title and menu, so you
  can tell which page is the problem. The plugin's own switch shows as off as
  soon as any one of its pages is off, and turning it on restores all of them.
- **Basic View / Advanced View** (top right): Basic, the default, lists the
  plugins you installed. Advanced also lists the pieces that ship with Unraid
  itself, such as most `dynamix.*` entries. Those are marked *System plugin*
  and are read-only, so you can see what is there but can't switch it off.
  Your choice is remembered in a cookie.
- **Plugin Disabler itself, and Unraid's plugin manager, are not listed.**
  Switching either off would remove the page you use to switch things back.

## How it works

Switching a page off renames `Something.page` to `Something.page.disabled`
inside the plugin's folder under `/usr/local/emhttp/plugins`. Unraid's menu
builder only reads `.page` files, so the page disappears; switching it on
renames it back. The files that are renamed *are* the state: Plugin Disabler
keeps no settings and no database.

Because `/usr/local` is rebuilt from the flash on every boot, a reboot also
puts everything back.

## What it can't do

It only hides **web UI pages**. It does not stop a plugin's background
services, cron jobs, containers or scripts, and it does not touch anything
outside the plugin's own page files. If the problem comes from something a
plugin runs in the background, switching its pages off won't change it.

## License

MIT — see [LICENSE](../LICENSE).
