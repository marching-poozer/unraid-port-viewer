<?php
// Server-side port of the browser extension's background.js NPM client.
// This runs as a plain curl call from the Unraid box itself, so (unlike the
// extension) there's no mixed-content/CORS story to design around at all -
// that whole background-service-worker split only existed because a
// content script's fetch() stayed bound to the hosting tab's security
// policy. A PHP include has no such thing.

require_once __DIR__ . '/common.php';

define('PH_NPM_TOKEN_CACHE', '/tmp/proxyhosts-npm-token.json');

function ph_curl_json(string $method, string $url, ?array $body = null, array $headers = []): array {
    $ch = curl_init($url);
    // Only declare Content-Type when there's actually a JSON body to go
    // with it. The original browser-extension version never sent this
    // header on Pi-hole's bodyless PUT/DELETE config calls, and a PUT that
    // claims JSON content with zero bytes of body is exactly the kind of
    // thing a security layer flags - confirmed as the cause of a 403 there
    // that didn't happen from the browser.
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new Exception("Could not reach $url ($err)");
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $decoded = $raw !== '' ? json_decode($raw, true) : null;
    return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'body' => $decoded];
}

function ph_npm_token(bool $force = false): string {
    $s = ph_settings();
    if (!$s['npm_origin'] || !$s['npm_identity'] || !$s['npm_secret']) {
        throw new Exception('NPM not configured');
    }
    if (!$force && is_file(PH_NPM_TOKEN_CACHE)) {
        $cached = json_decode(file_get_contents(PH_NPM_TOKEN_CACHE), true);
        if ($cached && strtotime($cached['expires'] ?? '') - 60 > time()) {
            return $cached['token'];
        }
    }
    $res = ph_curl_json('POST', rtrim($s['npm_origin'], '/') . '/api/tokens', [
        'identity' => $s['npm_identity'], 'secret' => $s['npm_secret'],
    ]);
    if (!$res['ok']) throw new Exception('NPM login failed: HTTP ' . $res['status']);
    file_put_contents(PH_NPM_TOKEN_CACHE, json_encode($res['body']));
    @chmod(PH_NPM_TOKEN_CACHE, 0600);
    return $res['body']['token'];
}

// Mirrors background.js's npmRequest(): one retry on 401 with a forced
// fresh token before giving up.
function ph_npm_request(string $method, string $path, ?array $body = null): array {
    $s = ph_settings();
    if (!$s['npm_origin']) throw new Exception('NPM not configured');
    $base = rtrim($s['npm_origin'], '/');
    $token = ph_npm_token(false);
    $res = ph_curl_json($method, $base . $path, $body, ['Authorization: Bearer ' . $token]);
    if ($res['status'] === 401) {
        $token = ph_npm_token(true);
        $res = ph_curl_json($method, $base . $path, $body, ['Authorization: Bearer ' . $token]);
    }
    return $res;
}
