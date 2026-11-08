<?php
// Start / stop / restart / pause / unpause a group's or a stack's containers
// (the group and stack icon menus). Compose stacks go through
// `docker compose -p <project> <action> <services>`, which works from the
// project name alone (compose finds its containers by label - so repo,
// Compose Manager and Portainer stacks alike) and keeps depends_on order
// without recreating anything; everything else through plain
// `docker <action> <names>`, as Unraid's own buttons do.
//
// POST only - Unraid's local_prepend.php checks csrf_token on every POST.
//   action=start|stop|restart|pause|unpause
//   stacks=<JSON {project: [service, ...]}>  containers=<JSON [name, ...]>

header('Content-Type: application/json');
set_time_limit(0);
ignore_user_abort(true);

function cv_fail(int $code, string $message): void {
  http_response_code($code);
  echo json_encode(['ok' => false, 'error' => $message]);
  exit;
}

$action = (string)($_POST['action'] ?? '');
if (!in_array($action, ['start', 'stop', 'restart', 'pause', 'unpause'], true)) cv_fail(400, 'bad action');
$stacks = json_decode((string)($_POST['stacks'] ?? '{}'), true);
$containers = json_decode((string)($_POST['containers'] ?? '[]'), true);
if (!is_array($stacks) || !is_array($containers)) cv_fail(400, 'bad targets');

$name = '/^[A-Za-z0-9][A-Za-z0-9_.-]*\z/';
$valid = fn($n) => is_string($n) && preg_match($name, $n);
foreach ($stacks as $project => $services) {
  if (!$valid((string)$project) || !is_array($services) || !$services || array_filter($services, fn($s) => !$valid($s))) cv_fail(400, 'bad stack target');
}
if (array_filter($containers, fn($c) => !$valid($c))) cv_fail(400, 'bad container target');
if (!$stacks && !$containers) cv_fail(400, 'nothing to do');

$steps = [];
foreach ($stacks as $project => $services) {
  $steps[] = 'docker compose -p ' . escapeshellarg((string)$project) . " $action " . implode(' ', array_map('escapeshellarg', $services));
}
if ($containers) $steps[] = "docker $action " . implode(' ', array_map('escapeshellarg', $containers));
// Stopping: standalone containers before stacks; starting: stacks first.
if (in_array($action, ['stop', 'pause'], true)) $steps = array_reverse($steps);

$ok = true;
$log = [];
foreach ($steps as $cmd) {
  exec("$cmd 2>&1", $out, $rc);
  $log[] = ['cmd' => $cmd, 'rc' => $rc, 'output' => array_slice($out, -10)];
  $out = [];
  if ($rc !== 0) $ok = false;
}
echo json_encode(['ok' => $ok, 'steps' => $log, 'error' => $ok ? '' : 'some commands failed; see steps']);
