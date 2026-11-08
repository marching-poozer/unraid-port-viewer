<?php
// Backs ProxyHostsSettings.page's "Save & Test" buttons - the server-side
// equivalent of the extension's options.js save handlers, including the
// same "test the login before saving sticks" UX.

header('Content-Type: application/json');
// __DIR__, not $docroot: this file is hit directly, not included by a
// bootstrapped .page render, so $docroot is never set here. POST data
// travels as a form field (not raw JSON) because Unraid's own
// auto_prepend_file CSRF gate only looks at $_POST - see proxyhosts.php's
// top-of-file note for the full explanation. Any request that reaches this
// line already passed that gate, so there's nothing left for us to check.
require_once __DIR__ . '/common.php';
require_once __DIR__ . '/npm_client.php';
require_once __DIR__ . '/pihole_client.php';

$input = isset($_POST['data']) ? (json_decode($_POST['data'], true) ?: []) : [];
$section = $input['section'] ?? '';

try {
    if ($section === 'npm') {
        $patch = ['npm_origin' => rtrim($input['origin'] ?? '', '/'), 'npm_identity' => $input['identity'] ?? ''];
        if (($input['secret'] ?? '') !== '') $patch['npm_secret'] = $input['secret'];
        ph_save_settings($patch);
        if (is_file(PH_NPM_TOKEN_CACHE)) unlink(PH_NPM_TOKEN_CACHE);
        ph_npm_token(true); // throws with a clear message on a bad login
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($section === 'base_domain') {
        ph_save_settings(['base_domain' => trim($input['base_domain'] ?? '')]);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($section === 'forwarding') {
        // Nothing to test here (it's local config, not a login) - same
        // fire-and-forget shape as base_domain.
        ph_save_settings([
            'prefer_container_forwarding' => !empty($input['enabled']),
            'shared_network' => trim($input['shared_network'] ?? ''),
        ]);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($section === 'pihole') {
        $patch = [
            'pihole_enabled' => !empty($input['enabled']),
            'pihole_origin' => rtrim($input['origin'] ?? '', '/'),
        ];
        if (($input['password'] ?? '') !== '') $patch['pihole_password'] = $input['password'];
        ph_save_settings($patch);
        if ($patch['pihole_enabled']) {
            $s = ph_settings();
            ph_pihole_auth($patch['pihole_origin'], $s['pihole_password']); // throws on a bad login
        }
        echo json_encode(['ok' => true]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Unknown section']);
} catch (Exception $e) {
    error_log('[Proxy Hosts] save-settings section=' . $section . ' failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
