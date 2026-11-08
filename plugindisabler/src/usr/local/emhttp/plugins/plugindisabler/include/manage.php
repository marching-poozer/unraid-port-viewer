<?php
// Mutating JSON API plugindisabler.js talks to (render.php handles reads -
// it returns HTML rows directly, the same shape dynamix.plugin.manager's
// own ShowPlugins.php does). POST travels as a csrf_token form field +
// JSON-encoded 'data' field, mirroring proxyhosts' include/proxyhosts.php.
// Hit directly by fetch()/$.post(), not included by a .page render, so
// $docroot isn't set here - __DIR__ is the only path reference that works.
//
// CSRF: Unraid's own php.ini auto_prepend_file (local_prepend.php) already
// rejects any POST whose $_POST['csrf_token'] doesn't match the session's
// token before this file even runs - see proxyhosts.php for the fuller
// version of this note. Nothing left for us to check on a POST that reaches
// this line.

header('Content-Type: application/json');
require_once __DIR__ . '/common.php';

$action = $_GET['action'] ?? '';
$input = isset($_POST['data']) ? (json_decode($_POST['data'], true) ?: []) : [];

try {
    if ($action === 'toggle') {
        $plugin = $input['plugin'] ?? '';
        $disabled = !empty($input['disabled']);
        $file = $input['file'] ?? null;

        if ($file !== null) {
            pd_set_page_disabled($plugin, $file, $disabled);
        } else {
            // Whole-plugin shorthand: flip every one of its pages.
            foreach (pd_plugin_pages($plugin) as $page) {
                pd_set_page_disabled($plugin, $page['file'], $disabled);
            }
        }
        echo json_encode(['ok' => true, 'pages' => pd_plugin_pages($plugin)]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Unknown action']);
} catch (Exception $e) {
    error_log('[Plugin Disabler] action=' . $action . ' failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
