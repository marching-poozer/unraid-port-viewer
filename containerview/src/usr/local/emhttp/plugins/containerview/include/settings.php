<?php
// Container View settings (the cog beside Basic/Advanced View), stored on the
// flash as settings.json; ContainerViewDocker.page reads them into
// CV_CONFIG.settings so the page renders in place without a jump.
//   buttons=top|bottom          where Unraid's Add Container / Start All / ... row sits
//   align=left|center|right     alignment of the bar's rows and Unraid's buttons
//   precedence=labels|rules     whether a category label or a matching rule wins
//   enabled=yes|no              no: Unraid's own Docker list and Dashboard tile (only the cog stays)
//
// POST only - Unraid's local_prepend.php checks csrf_token on every POST.

header('Content-Type: application/json');
require_once __DIR__ . '/store.php';

const CV_ALLOWED = ['buttons' => ['top', 'bottom'], 'align' => ['left', 'center', 'right'], 'precedence' => ['labels', 'rules'], 'enabled' => ['yes', 'no']];

$change = [];
foreach (CV_ALLOWED as $key => $values) {
  if (!isset($_POST[$key])) continue;
  if (!in_array($_POST[$key], $values, true)) cv_fail(400, "bad $key");
  $change[$key] = $_POST[$key];
}
$settings = cv_update('settings.json', fn($settings) => (object)array_merge($settings, $change));
echo json_encode(['ok' => true, 'settings' => $settings]);
