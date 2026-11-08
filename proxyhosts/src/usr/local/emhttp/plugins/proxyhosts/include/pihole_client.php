<?php
// Server-side port of background.js's Pi-hole v6 client.

require_once __DIR__ . '/common.php';
require_once __DIR__ . '/npm_client.php'; // reuses ph_curl_json()

function ph_pihole_auth(string $base, string $password): string {
    $res = ph_curl_json('POST', $base . '/api/auth', ['password' => $password]);
    if (!$res['ok']) throw new Exception('Pi-hole login failed: HTTP ' . $res['status']);
    $sid = $res['body']['session']['sid'] ?? null;
    if (!$sid) throw new Exception('Pi-hole login did not return a session');
    return $sid;
}

// domain -> the NPM origin's own hostname, same reasoning as the extension:
// LAN clients resolve straight to NPM instead of round-tripping through the
// router, and it keeps working if NPM's IP ever changes since there's only
// one place (NPM's own host entry) that has to stay correct.
function ph_pihole_set_cname(string $domain, string $target, bool $add): array {
    $s = ph_settings();
    if (!$s['pihole_enabled'] || !$s['pihole_origin'] || !$s['pihole_password']) {
        return ['skipped' => true];
    }
    $base = rtrim($s['pihole_origin'], '/');
    $sid = ph_pihole_auth($base, $s['pihole_password']);
    $value = rawurlencode($domain . ',' . $target);
    $method = $add ? 'PUT' : 'DELETE';
    $res = ph_curl_json($method, $base . '/api/config/dns/cnameRecords/' . $value, null, ['X-FTL-SID: ' . $sid]);

    if ($res['ok'] || (!$add && $res['status'] === 404)) return ['ok' => true];
    if ($add && $res['status'] === 400 && stripos($res['body']['error']['message'] ?? '', 'already') !== false) {
        return ['ok' => true, 'already' => true];
    }
    $verb = $add ? 'add' : 'remove';
    throw new Exception("Pi-hole $verb record failed: HTTP " . $res['status']);
}
