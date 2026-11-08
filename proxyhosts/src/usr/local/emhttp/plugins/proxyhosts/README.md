# Proxy Hosts

Adds a control under each container's name on the **Docker** tab for managing
its Nginx Proxy Manager (NPM) proxy host: create one (reusing an existing
certificate, such as a wildcard, rather than requesting a new one), edit its
domains, pause or disable it, or remove it. Optionally keeps a matching
Pi-hole CNAME record for each domain in sync.

Configure NPM and Pi-hole once under **Settings -> Network Services -> Proxy
Hosts**. The settings are shared by everyone who uses this web UI, and every
NPM and Pi-hole request is made by the Unraid server itself, not by a
browser.

Full documentation: [Proxy Hosts README](https://github.com/marching-poozer/unraid-port-viewer/blob/main/proxyhosts/README.md).
