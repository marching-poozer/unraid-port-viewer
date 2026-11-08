# Proxy Hosts

> This is a vibe-coded / AI-assisted project, built to scratch my own itch on
> my Unraid box. Sharing it in case it's useful to someone else — no
> guarantees beyond "works on my server."

An Unraid plugin that manages [Nginx Proxy Manager](https://nginxproxymanager.com/)
(NPM) proxy hosts from the **Docker** tab. Each container gets a small control
under its name: click it to create a proxy host for that container, or to
edit or remove the one it already has. It can also keep a matching
[Pi-hole](https://pi-hole.net/) CNAME record in sync for every domain.

Requires Unraid 7.0 or later and an NPM instance you can log in to. Pi-hole
is optional (v6 or later, because it uses the v6 API).

## Install

1. In the Unraid web UI, open **Plugins → Install Plugin**.
2. Paste this URL and click **Install**:
   ```
   https://raw.githubusercontent.com/marching-poozer/unraid-port-viewer/main/proxyhosts/proxyhosts.plg
   ```
3. Open **Settings → Network Services → Proxy Hosts** and fill in the
   settings below.

## Settings

Everything is configured once, on the server, and shared by everyone who uses
this web UI. All requests to NPM and Pi-hole are made by the Unraid server
itself, not by your browser.

- **Nginx Proxy Manager:** the URL the Unraid server can reach NPM at (for
  example `http://npm.local:81`), plus an email and password. *Save & Test*
  logs in and tells you if it failed. Use a dedicated NPM user that only has
  access to proxy hosts and certificates, rather than your main admin
  account.
- **Suggested domain names:** a base domain such as `example.com`. New hosts
  then default to `<container>.example.com`; you can edit it before creating.
- **Container networking:** off by default. When on, and a container is
  attached to the *Shared Docker network* you name (the network NPM itself
  uses to reach containers), a new host forwards to the container's own name
  and port instead of the LAN-published port. That is one hop fewer, and it
  keeps working if the LAN port mapping changes. It never changes hosts that
  already exist.
- **Pi-hole:** tick the box, enter the Pi-hole URL and an
  [application password](https://docs.pi-hole.net/api/) (not your admin
  password), then *Save & Test*. Records always point at the hostname of the
  NPM URL above, so there is no separate target to enter.

## On the Docker tab

Every container that publishes a LAN port gets a control under its name, as
does every container on the shared network when container networking is on.

- **No proxy host yet:** it reads *No Proxy Host* in grey, with a **+**
  button.
- **Has a proxy host:** it shows the host's first domain as a link (with
  *+N* if there are more) and a pencil button. The link is green when the host
  is enabled and amber when it is disabled in NPM; a paused domain is struck
  through.
- **NPM not set up yet:** the control is there but greyed, and points you to
  the settings page.
- **Existing hosts are recognised** by where they forward to (the LAN
  `IP:port`, or the container's name), including ones you made in NPM
  yourself.
- The list refreshes from NPM every 30 seconds.

### Create

The **+** button opens a small form:

- **Proxy to:** *Container name* or *LAN port*, when the container qualifies
  for both. With a LAN port, pick which one if the container publishes
  several. With the container name, type the container's port; it is
  pre-filled when there is only one obvious choice.
- **Domain:** pre-filled from the base domain when one is set.
- **Certificate:** *No certificate* or any certificate already in NPM. As you
  type the domain, the plugin selects a certificate that matches it exactly,
  or a wildcard one level up (`*.example.com` for `app.example.com`), and
  ticks *Force SSL*.
- **Force SSL** and **Allow websocket upgrade.**

NPM forwards to the container over plain HTTP, with *Block common exploits*
on and caching off. The plugin only reuses certificates that already exist; it
never asks for a new one.

### Edit

The pencil button opens the host:

- the host's target, with a dot showing whether it is enabled, and a
  **pause / play** button to disable or enable the host in NPM;
- a **trash** button that removes the whole host after a confirmation;
- each domain with **pause / resume** and **remove**, and a field to **add
  another domain**.

Pausing a domain takes it out of NPM's live domain list, so NPM stops routing
it, and remembers it so that *resume* puts it straight back. NPM has no
per-domain switch of its own. A host must keep at least one domain; use the
trash button to delete it entirely.

### Pi-hole

With Pi-hole turned on, creating a host adds a CNAME for its domain, removing
a domain or host removes it, and adding or renaming domains keeps it in step.
Pausing a domain leaves its record alone. If NPM succeeds but Pi-hole fails,
you get a warning saying so.

## Where things are stored

- Settings, including the NPM password and the Pi-hole application password,
  are in `/boot/config/plugins/proxyhosts/settings.cfg` on the flash, readable
  by root only. They are stored as plain text. The settings page never shows
  a saved password back (it says *unchanged*).
- NPM's login token is cached in `/tmp`, so it goes away on reboot.
- Removing the plugin deletes its settings.
- Failures are logged to `/var/log/phplog`, tagged `[Proxy Hosts]`.

## Notes

- The control is added to Unraid's own container rows and reads the Docker
  tab's port and network columns, so a future Unraid release that rearranges
  those columns could break it.
- It is meant to coexist with other plugins that change the Docker tab,
  including [Container View](../containerview/) and the Folder View family.

## License

MIT — see [LICENSE](../LICENSE).
