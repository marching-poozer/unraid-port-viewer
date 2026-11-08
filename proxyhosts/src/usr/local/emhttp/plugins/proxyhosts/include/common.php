<?php
// Shared plugin config: read/write /boot/config/plugins/proxyhosts/settings.cfg
// (Unraid's usual spot for a plugin's persistent, flash-backed config - the
// same place the NPM-login/Pi-hole-password fields the browser extension
// kept in chrome.storage.local now live).
//
// No CSRF helper here: Unraid's own php.ini auto_prepend_file
// (local_prepend.php) already rejects any POST whose $_POST['csrf_token']
// doesn't match the session's token, for every script, before ours even
// starts running - see include/proxyhosts.php's top-of-file note.

define('PH_CFG_DIR', '/boot/config/plugins/proxyhosts');
define('PH_CFG_FILE', PH_CFG_DIR . '/settings.cfg');

function ph_settings(): array {
    $defaults = [
        'npm_origin' => '', 'npm_identity' => '', 'npm_secret' => '',
        'base_domain' => '',
        'prefer_container_forwarding' => false, 'shared_network' => '',
        'pihole_enabled' => false, 'pihole_origin' => '', 'pihole_password' => '',
    ];
    $parsed = is_file(PH_CFG_FILE) ? (@parse_ini_file(PH_CFG_FILE) ?: []) : [];
    $merged = array_merge($defaults, $parsed);
    $merged['prefer_container_forwarding'] = filter_var($merged['prefer_container_forwarding'], FILTER_VALIDATE_BOOLEAN);
    $merged['pihole_enabled'] = filter_var($merged['pihole_enabled'], FILTER_VALIDATE_BOOLEAN);
    // Flags for the settings page to render "(unchanged)" instead of ever
    // echoing a saved secret back into the page source.
    $merged['npm_secret_set'] = $merged['npm_secret'] !== '';
    $merged['pihole_password_set'] = $merged['pihole_password'] !== '';
    return $merged;
}

function ph_save_settings(array $patch): void {
    $current = ph_settings();
    $next = array_merge($current, $patch);
    unset($next['npm_secret_set'], $next['pihole_password_set']);
    if (!is_dir(PH_CFG_DIR)) mkdir(PH_CFG_DIR, 0700, true);
    $lines = [];
    foreach ($next as $k => $v) {
        if (is_bool($v)) $v = $v ? 'true' : 'false';
        $lines[] = $k . '="' . addcslashes((string) $v, '"\\') . '"';
    }
    file_put_contents(PH_CFG_FILE, implode("\n", $lines) . "\n");
    @chmod(PH_CFG_FILE, 0600); // contains the NPM/Pi-hole passwords
}
