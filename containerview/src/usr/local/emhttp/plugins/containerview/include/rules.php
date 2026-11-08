<?php
// Category rules: categories for containers without the
// net.unraid.docker.category label, matched by compose stack, container name
// or image (whole value, case-insensitive, * and ? wildcards). Stored on the
// flash as rules.json; containers.php passes them to the page, which applies
// them (containerview-core.js applyRules) - nothing about the containers
// changes. Whether a label or a matching rule wins is the "precedence"
// setting (include/settings.php).
//   rules=<JSON [{stack?, name?, image?, categories: [...]}, ...]>  replaces the list
//
// POST only - Unraid's local_prepend.php checks csrf_token on every POST.

header('Content-Type: application/json');
require_once __DIR__ . '/store.php';

$in = json_decode((string)($_POST['rules'] ?? ''), true);
if (!is_array($in) || !array_is_list($in) || count($in) > 500) cv_fail(400, 'bad rules');

$rules = [];
foreach ($in as $i => $rule) {
  $n = $i + 1;
  if (!is_array($rule)) cv_fail(400, "rule $n: not an object");
  $out = [];
  foreach (['stack', 'name', 'image'] as $field) {
    if (!isset($rule[$field]) || $rule[$field] === '') continue;
    $pattern = $rule[$field];
    if (!is_string($pattern) || !preg_match('#^[A-Za-z0-9_.:/@*?-]{1,200}\z#', $pattern)) cv_fail(400, "rule $n: bad $field pattern");
    $out[$field] = $pattern;
  }
  if (!$out) cv_fail(400, "rule $n: needs a stack, name or image");
  $cats = $rule['categories'] ?? null;
  if (!is_array($cats) || !$cats || count($cats) > 10) cv_fail(400, "rule $n: needs 1-10 categories");
  foreach ($cats as $c) if (!cv_valid_category($c)) cv_fail(400, "rule $n: bad category");
  $out['categories'] = array_values(array_unique($cats));
  $rules[] = $out;
}

echo json_encode(['ok' => true, 'rules' => cv_update('rules.json', fn() => $rules)]);
