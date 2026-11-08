<?php
// Remember a stack's or a group's icon. Stored on the flash; containers.php
// passes both maps to the page. Nothing about the containers changes.
//   kind=stack  stack=<compose project>  service=<compose service in it>
//               ("Use icon for stack" in a member's menu)
//   kind=group  group=<category key>     icon=<fa-name, or '' for the default>
//               ("Change icon..." in the group menu)
//
// POST only - Unraid's local_prepend.php checks csrf_token on every POST
// before this runs, so the token must arrive as a form field.

header('Content-Type: application/json');
require_once __DIR__ . '/store.php';

$name = '/^[A-Za-z0-9][A-Za-z0-9_.-]*\z/';

switch ($_POST['kind'] ?? '') {
  case 'stack':
    $stack = (string)($_POST['stack'] ?? '');
    $service = (string)($_POST['service'] ?? '');
    if (!preg_match($name, $stack) || !preg_match($name, $service)) cv_fail(400, 'bad stack or service');
    // Only a service that really is in that stack.
    exec('docker ps -a -q --filter ' . escapeshellarg("label=com.docker.compose.project=$stack") .
      ' --filter ' . escapeshellarg("label=com.docker.compose.service=$service") . ' 2>/dev/null', $ids);
    if (!$ids) cv_fail(404, "no service $service in stack $stack");
    $map = cv_update('stack-icons.json', function ($map) use ($stack, $service) {
      $map[$stack] = $service;
      ksort($map);
      return (object)$map;
    });
    echo json_encode(['ok' => true, 'stackIcons' => $map]);
    break;
  case 'group':
    $group = (string)($_POST['group'] ?? '');
    $icon = (string)($_POST['icon'] ?? '');
    // Category keys as the page uses them (lower-cased label values; '' is Unsorted).
    if ($group !== '' && !cv_valid_category($group)) cv_fail(400, 'bad group');
    if ($icon !== '' && !preg_match('/^fa-[a-z0-9-]{1,40}\z/', $icon)) cv_fail(400, 'bad icon');
    $map = cv_update('group-icons.json', function ($map) use ($group, $icon) {
      if ($icon === '') unset($map[$group]); else $map[$group] = $icon;
      ksort($map);
      return (object)$map;
    });
    echo json_encode(['ok' => true, 'groupIcons' => $map]);
    break;
  default:
    cv_fail(400, 'bad kind');
}
