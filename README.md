# poozer's Unraid plugins

> These are vibe-coded / AI-assisted projects, built to scratch my own itch on
> my Unraid box. Sharing them in case they're useful to someone else — no
> guarantees beyond "works on my server."

One folder per plugin, each with its own README, source, build script and
packaged `.txz`. Install any of them via **Plugins → Install Plugin** and
paste its URL.

| Plugin | What it does | Install URL |
| --- | --- | --- |
| [Ports](ports/) | A scannable view of every TCP/UDP port the server is listening on, with the owning process and Docker container. | `https://raw.githubusercontent.com/marching-poozer/unraid-port-viewer/main/ports/ports.plg` |
| [Container View](containerview/) | Groups and filters the Docker Containers list and Dashboard tile by category (container label or rules) instead of hand-maintained folders. | `https://raw.githubusercontent.com/marching-poozer/unraid-port-viewer/main/containerview/containerview.plg` |
| [Proxy Hosts](proxyhosts/) | A control under each container on the Docker tab to create, edit and remove its Nginx Proxy Manager proxy host, with optional Pi-hole CNAMEs. Not in Community Applications yet. | `https://raw.githubusercontent.com/marching-poozer/unraid-port-viewer/main/proxyhosts/proxyhosts.plg` |
| [Plugin Disabler](plugindisabler/) | Adds a Manage tab to the Plugins page to temporarily switch off other plugins' GUI pages, for diagnosis. Not in Community Applications yet. | `https://raw.githubusercontent.com/marching-poozer/unraid-port-viewer/main/plugindisabler/plugindisabler.plg` |

Ports and Container View are listed in Community Applications; this
repository is the registered CA repository (`plugins/*.xml` are the CA
templates, `ca_profile.xml` the repository profile).

## Moved from the old locations

Ports used to live at the repository root, and Container View in its own
repository (`marching-poozer/unraid-container-view`). Installs of either keep
updating: the root `ports.plg` is kept as a copy of `ports/ports.plg`, and
the last release in the old Container View repository points at the new
location. Installing from the old URLs for the first time is not supported.

## License

MIT — see [LICENSE](LICENSE).
