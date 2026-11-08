<?php
// Same-origin JSON API proxyhosts.js talks to. Everything that previously
// lived in the browser extension's background.js (NPM/Pi-hole network
// calls) happens here instead - no CORS, no mixed-content, no
// chrome.storage. Hit directly by fetch() rather than included by a .page
// file, so $docroot (set by whatever bootstraps a normal page render) is
// NOT available here - __DIR__ is the only path reference that actually
// works for a standalone entry-point script like this one.
//
// CSRF: Unraid's own php.ini auto_prepend_file (local_prepend.php) already
// rejects any POST whose $_POST['csrf_token'] doesn't match the session's
// token - for every script, not just this one - before this file even
// starts running, then unsets it. So by the time we get here a POST is
// already CSRF-valid; there is nothing left for us to check, and the token
// must travel as a real form field (not JSON) or that gate 500s first.

header('Content-Type: application/json');
require_once __DIR__ . '/common.php';
require_once __DIR__ . '/npm_client.php';
require_once __DIR__ . '/pihole_client.php';

// Mirrors the Ports plugin's docker_inventory(): ask Docker directly
// instead of scraping the rendered table, so ranges, IPv6, and odd
// bindings all come out right without regexing HTML.
function ph_docker_ports(): array {
    $raw = shell_exec("docker ps --no-trunc --format '{{.ID}}|{{.Names}}|{{.Ports}}' 2>/dev/null") ?: '';
    $out = [];
    foreach (explode("\n", trim($raw)) as $line) {
        if ($line === '') continue;
        [$id, $name, $portsRaw] = array_pad(explode('|', $line, 3), 3, '');
        foreach (explode(',', $portsRaw) as $mapping) {
            $mapping = trim($mapping);
            if (!preg_match('#(\d+\.\d+\.\d+\.\d+):(\d+)->(\d+)/(tcp|udp)#', $mapping, $m)) continue;
            $out[] = [
                'container_id' => substr($id, 0, 12), 'container_name' => $name,
                'lan_ip' => $m[1], 'lan_port' => (int) $m[2], 'container_port' => (int) $m[3],
            ];
        }
    }
    return $out;
}

// Used only when prefer_container_forwarding is on: which Docker networks
// is this container attached to? Compared against the configured
// shared_network to decide whether a new proxy host can forward straight to
// the container's own name instead of the LAN-published port. Matches by
// exact name in PHP rather than a shell --filter regex, so there's no
// escaping/anchoring to get right.
function ph_container_networks(string $containerName): array {
    $raw = shell_exec("docker ps --format '{{.Names}}|{{.Networks}}' 2>/dev/null") ?: '';
    foreach (explode("\n", trim($raw)) as $line) {
        if ($line === '') continue;
        [$name, $networks] = array_pad(explode('|', $line, 2), 2, '');
        if ($name === $containerName) {
            return $networks !== '' ? explode(',', $networks) : [];
        }
    }
    return [];
}

function ph_npm_hostname(): ?string {
    $s = ph_settings();
    $host = $s['npm_origin'] ? parse_url($s['npm_origin'], PHP_URL_HOST) : null;
    return $host ?: null;
}

// POST bodies travel as a normal form field, not raw JSON - see the CSRF
// note above: local_prepend.php only ever looks at $_POST, so a JSON body
// would leave $_POST['csrf_token'] unset and get killed before we run.
$action = $_GET['action'] ?? '';
$input = isset($_POST['data']) ? (json_decode($_POST['data'], true) ?: []) : [];

try {
    if ($action === 'state') {
        $s = ph_settings();
        $configured = $s['npm_origin'] && $s['npm_identity'] && $s['npm_secret'];
        $hosts = []; $certs = [];
        if ($configured) {
            $hostsRes = ph_npm_request('GET', '/api/nginx/proxy-hosts');
            $certsRes = ph_npm_request('GET', '/api/nginx/certificates');
            $hosts = $hostsRes['ok'] ? $hostsRes['body'] : [];
            $certs = $certsRes['ok'] ? $certsRes['body'] : [];
        }
        echo json_encode([
            'npmConfigured' => $configured,
            'piholeEnabled' => $s['pihole_enabled'],
            'baseDomain' => $s['base_domain'],
            // Empty string (not the raw setting) when container forwarding
            // itself is off, so the client's "is this container eligible for
            // a network-only badge" check can just be a truthy/membership
            // test without also re-checking prefer_container_forwarding.
            'sharedNetwork' => $s['prefer_container_forwarding'] ? $s['shared_network'] : '',
            'ports' => ph_docker_ports(),
            'hosts' => $hosts,
            'certificates' => $certs,
        ]);
        exit;
    }

    // Every POST that reaches this line already passed Unraid's own
    // auto_prepend_file CSRF check (see top-of-file note) - nothing left
    // for us to verify here.

    if ($action === 'create') {
        $s = ph_settings();
        // target_mode 'network' is the badge for a container that has no
        // LAN-published port at all (e.g. NPM-only exposure like solidtime/
        // jellystat/tracearr) - there's no LAN fallback for that case, so
        // unlike 'lan' mode below this errors out loudly instead of quietly
        // sending an empty forward_host to NPM.
        $mode = $input['target_mode'] ?? 'lan';
        if ($mode === 'network') {
            if (!$s['prefer_container_forwarding'] || !$s['shared_network']) {
                throw new Exception('Container networking forwarding is off - turn it on under Settings -> Network Services -> Proxy Hosts.');
            }
            if (empty($input['container_name']) || empty($input['container_port'])) {
                throw new Exception('Missing container name or port.');
            }
            $networks = ph_container_networks($input['container_name']);
            if (!in_array($s['shared_network'], $networks, true)) {
                throw new Exception($input['container_name'] . ' is not attached to the configured shared network (' . $s['shared_network'] . ').');
            }
            $forwardHost = $input['container_name'];
            $forwardPort = (int) $input['container_port'];
        } else {
            $forwardHost = $input['lan_ip'];
            $forwardPort = (int) $input['lan_port'];
            if (
                $s['prefer_container_forwarding'] && $s['shared_network']
                && !empty($input['container_name']) && !empty($input['container_port'])
            ) {
                $networks = ph_container_networks($input['container_name']);
                if (in_array($s['shared_network'], $networks, true)) {
                    // Forward straight to the container's own Docker-network
                    // name instead of the LAN-published port - fewer hops, and
                    // keeps working even if the LAN port mapping ever changes.
                    $forwardHost = $input['container_name'];
                    $forwardPort = (int) $input['container_port'];
                }
            }
        }
        $res = ph_npm_request('POST', '/api/nginx/proxy-hosts', [
            'domain_names' => [$input['domain']],
            'forward_scheme' => 'http',
            'forward_host' => $forwardHost,
            'forward_port' => $forwardPort,
            'certificate_id' => (int) ($input['certificate_id'] ?? 0),
            'ssl_forced' => !empty($input['ssl_forced']),
            'http2_support' => !empty($input['ssl_forced']),
            'block_exploits' => true,
            'caching_enabled' => false,
            'allow_websocket_upgrade' => !empty($input['websocket']),
            // NPM's schema requires an object here; PHP's json_encode()
            // serializes an empty [] as a JSON array, not {}, which NPM
            // rejects with "data/meta must be object".
            'meta' => new stdClass(),
        ]);
        if (!$res['ok']) throw new Exception($res['body']['error']['message'] ?? 'HTTP ' . $res['status']);

        // Fetch NPM's confirmed host list BEFORE touching Pi-hole, not
        // after: writing a CNAME can make FTL briefly reload its resolver,
        // which can transiently break DNS for npm's own hostname right when
        // a lookup would need it. Doing the lookup first means the client
        // gets back real, verified state instead of just trusting the
        // create call succeeded - and never needs its own follow-up fetch,
        // which is exactly what was landing in that DNS-flaky window.
        $hostsRes = ph_npm_request('GET', '/api/nginx/proxy-hosts');
        $hosts = $hostsRes['ok'] ? $hostsRes['body'] : [$res['body']];

        $piholeWarning = null;
        if ($s['pihole_enabled'] && ($target = ph_npm_hostname())) {
            try {
                ph_pihole_set_cname($input['domain'], $target, true);
            } catch (Exception $e) {
                $piholeWarning = $e->getMessage();
            }
        }
        echo json_encode(['ok' => true, 'hosts' => $hosts, 'piholeWarning' => $piholeWarning]);
        exit;
    }

    if ($action === 'update') {
        // Adds/removes/renames individual domains on an EXISTING host (e.g.
        // adding "git.example.com" alongside "gitea.example.com" on
        // the same host) and/or pauses one without touching the others.
        // NPM has no per-domain enable flag - only a host-wide one - so a
        // "paused" domain is simply pulled out of the live domain_names
        // (NPM stops routing it) while its name is remembered in the host's
        // own meta field, so "resume" just adds it straight back. NPM's PUT
        // expects the full representation, not a partial patch, so fetch
        // the current host first and resend everything with only
        // domain_names/meta changed.
        $hostId = (int) $input['host_id'];
        $currentRes = ph_npm_request('GET', '/api/nginx/proxy-hosts/' . $hostId);
        if (!$currentRes['ok']) throw new Exception('Could not load current host: HTTP ' . $currentRes['status']);
        $current = $currentRes['body'];
        $oldActive = $current['domain_names'] ?? [];
        $currentMeta = is_array($current['meta'] ?? null) ? $current['meta'] : [];
        $oldPaused = $currentMeta['ph_paused_domains'] ?? [];
        $oldTotal = array_unique(array_merge($oldActive, $oldPaused));

        $newActive = array_values(array_unique($input['domain_names'] ?? []));
        $newPaused = array_values(array_unique($input['paused_domains'] ?? []));
        $newTotal = array_unique(array_merge($newActive, $newPaused));
        if (!$newTotal) throw new Exception('A proxy host needs at least one domain');

        // Preserve any other meta keys (e.g. Let's Encrypt bookkeeping)
        // that already live there.
        $meta = $currentMeta;
        if ($newPaused) {
            $meta['ph_paused_domains'] = $newPaused;
        } else {
            unset($meta['ph_paused_domains']);
        }

        $res = ph_npm_request('PUT', '/api/nginx/proxy-hosts/' . $hostId, [
            'domain_names' => $newActive,
            'forward_scheme' => $current['forward_scheme'],
            'forward_host' => $current['forward_host'],
            'forward_port' => $current['forward_port'],
            'certificate_id' => $current['certificate_id'],
            'ssl_forced' => $current['ssl_forced'],
            'http2_support' => $current['http2_support'],
            'block_exploits' => $current['block_exploits'],
            'caching_enabled' => $current['caching_enabled'],
            'allow_websocket_upgrade' => $current['allow_websocket_upgrade'],
            // Empty PHP array serializes as a JSON array, not {}, which NPM
            // rejects - see the same note on 'create' above.
            'meta' => $meta ?: new stdClass(),
        ]);
        if (!$res['ok']) throw new Exception($res['body']['error']['message'] ?? 'HTTP ' . $res['status']);

        $hostsRes = ph_npm_request('GET', '/api/nginx/proxy-hosts');
        $hosts = $hostsRes['ok'] ? $hostsRes['body'] : [$res['body']];

        $piholeWarning = null;
        $s = ph_settings();
        if ($s['pihole_enabled'] && ($target = ph_npm_hostname())) {
            $failures = [];
            // Pi-hole tracks every domain ever associated with this host,
            // active or paused - pausing alone must not touch DNS; only a
            // domain leaving BOTH sets (removed or renamed away) should.
            foreach (array_diff($newTotal, $oldTotal) as $domain) {
                try {
                    ph_pihole_set_cname($domain, $target, true);
                } catch (Exception $e) {
                    $failures[] = "$domain: " . $e->getMessage();
                }
            }
            foreach (array_diff($oldTotal, $newTotal) as $domain) {
                try {
                    ph_pihole_set_cname($domain, $target, false);
                } catch (Exception $e) {
                    $failures[] = "$domain: " . $e->getMessage();
                }
            }
            if ($failures) $piholeWarning = implode("\n", $failures);
        }
        echo json_encode(['ok' => true, 'hosts' => $hosts, 'piholeWarning' => $piholeWarning]);
        exit;
    }

    if ($action === 'toggle') {
        $verb = !empty($input['enabled']) ? 'enable' : 'disable';
        $res = ph_npm_request('POST', '/api/nginx/proxy-hosts/' . (int) $input['host_id'] . '/' . $verb);
        if (!$res['ok']) throw new Exception($res['body']['error']['message'] ?? 'HTTP ' . $res['status']);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'remove') {
        $res = ph_npm_request('DELETE', '/api/nginx/proxy-hosts/' . (int) $input['host_id']);
        if (!$res['ok']) throw new Exception('HTTP ' . $res['status']);

        // Same ordering reasoning as 'create': fetch confirmed state before
        // the Pi-hole write, not after.
        $hostsRes = ph_npm_request('GET', '/api/nginx/proxy-hosts');
        $hosts = $hostsRes['ok'] ? $hostsRes['body'] : [];

        $piholeWarning = null;
        $s = ph_settings();
        if ($s['pihole_enabled'] && ($target = ph_npm_hostname())) {
            $failures = [];
            foreach ($input['domains'] ?? [] as $domain) {
                try {
                    ph_pihole_set_cname($domain, $target, false);
                } catch (Exception $e) {
                    $failures[] = "$domain: " . $e->getMessage();
                }
            }
            if ($failures) $piholeWarning = implode("\n", $failures);
        }
        echo json_encode(['ok' => true, 'hosts' => $hosts, 'piholeWarning' => $piholeWarning]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Unknown action']);
} catch (Exception $e) {
    // Lands in /var/log/phplog - same [Proxy Hosts] tag the browser console
    // uses, so a failure shows up there even if nobody was watching devtools
    // when it happened.
    error_log('[Proxy Hosts] action=' . $action . ' failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
