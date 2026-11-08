<?php
// Shared by the endpoints that keep JSON on the flash (icons.php, rules.php,
// settings.php). Every save is a read-modify-write under an exclusive lock,
// written to a temp file and renamed into place, so two quick saves can't
// lose one and a crash mid-write can't leave a truncated file. A file that
// exists but doesn't parse is reported, never overwritten - a save must not
// silently replace the user's rules with an empty list.

const CV_DIR = '/boot/config/plugins/containerview';

function cv_fail(int $code, string $message): void {
  http_response_code($code);
  echo json_encode(['ok' => false, 'error' => $message]);
  exit;
}

// A category name as a label value can carry one: 1-40 characters, no comma
// (the label's separator) or control characters, no outer spaces.
function cv_valid_category($c): bool {
  return is_string($c) && preg_match('/^[^,\x00-\x1f\x7f]{1,40}\z/u', $c) && trim($c) === $c;
}

// $change(array $current) returns what to store (a list, or an object for
// maps); cv_update saves it and returns it.
function cv_update(string $file, callable $change) {
  @mkdir(CV_DIR, 0755, true);
  $lock = @fopen(CV_DIR . "/.$file.lock", 'c');
  if (!$lock || !flock($lock, LOCK_EX)) cv_fail(500, 'cannot lock');
  $path = CV_DIR . "/$file";
  $raw = @file_get_contents($path);
  $data = [];
  if ($raw !== false && trim($raw) !== '') {
    $data = json_decode($raw, true);
    if (!is_array($data)) cv_fail(500, "$path does not parse - fix or remove it first");
  }
  $data = $change($data);
  $tmp = "$path.tmp";
  if (file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n") === false
      || !rename($tmp, $path)) {
    @unlink($tmp);
    cv_fail(500, 'cannot save');
  }
  flock($lock, LOCK_UN);
  fclose($lock);
  return $data;
}
