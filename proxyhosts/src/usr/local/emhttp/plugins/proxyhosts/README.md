# Proxy Hosts

Adds a small on/off badge next to every published port on the **Docker**
page. Turning it on creates a matching Nginx Proxy Manager (NPM) proxy
host — reusing an existing certificate (e.g. a wildcard) instead of
requesting a new one; turning it off removes it. Optionally keeps a
matching Pi-hole CNAME record (pointing at the NPM host) in sync too.

Configure NPM/Pi-hole once under **Settings -> Network Services -> Proxy
Hosts** — unlike a browser extension, this is shared by every user of this
WebGUI, and every NPM/Pi-hole request runs from the Unraid box itself via
curl, not from inside anyone's browser tab.

See the project README for how the Docker-page badge, popovers, and
certificate matching work.
