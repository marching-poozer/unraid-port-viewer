# Plugin Disabler

Adds a **Manage** tab to the native **Plugins** page (next to "Installed
Plugins") for temporarily taking a plugin's GUI pages out of the menu
system - for diagnosing whether a given plugin is causing a webGUI problem,
without actually uninstalling it.

Each row is a plugin; a toggle disables/enables all of its `.page` files at
once. Plugins that ship more than one `.page` file (e.g. one with a Docker
tab and a Settings tab) can be expanded to toggle individual pages instead
of the whole plugin - useful when only one of several pages is the actual
culprit.

Disabling renames `Foo.page` to `Foo.page.disabled` so Unraid's own page
scanner skips it; nothing is deleted, and no mutating write happens anywhere
above the plugin's own page files. Re-enabling (or a reboot - `/usr/local`
is rebuilt from the boot flash's plugin archives every time) restores it.

`dynamix.plugin.manager` (which provides the Plugins page this tool's own
tab lives inside) is excluded from the list, so you can't accidentally
strand yourself without a way to re-enable things short of a reboot.
