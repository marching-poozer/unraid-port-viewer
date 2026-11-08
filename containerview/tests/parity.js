// Native-parity diff: renders a captured containers.php feed with the core
// and compares each container's first-instance row with the captured native
// DockerContainers.php output, after stripping only the additions the core
// is allowed to make. Exit 1 on any difference.
// Usage: node tests/parity.js <feed.json> <native.html>   (see parity-live.sh)
const fs = require('fs');
const core = require('../src/usr/local/emhttp/plugins/containerview/containerview-core.js');

const [feedPath, nativePath] = process.argv.slice(2);
const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
// Rendered as the page renders it: category rules applied (so rule badges and
// rule-derived tags are exercised) and readmore on (so the clamp markup is).
const data = {...feed, containers: core.applyRules(feed.containers, feed.rules || [])};
const {html} = core.render(data, {readmore: true});

// The two captures run seconds apart, so Docker's relative-time phrases
// ("54 seconds", "About a minute", "Exited (0): 3 minutes ago") can differ;
// blank just those phrases. Everything around them is still compared.
const settle = (r) => r.replace(/(Uptime: |Created: |\): )[^<(]*/g, '$1~');
const rows = (h) => h.split('\0')[0].split(/(?=<tr[ >])/).filter(Boolean).map(settle);
const key = (r) => (r.match(/<span class='appname [^']*'>(?:<a[^>]*>)?([^<]*)/) || r.match(/Image ID: ([0-9a-f]+)/) || [, null])[1];
const all = rows(html);
const headers = all.filter((r) => /^<tr class='(advanced )?cv-(group|stack)'/.test(r));
// Ours: container and orphan rows, with only the allowed additions stripped:
// data-cv-* attributes, the trailing tags span in the name cell, and the
// clamp class plus its toggle link.
const ours = all
  .filter((r) => /^<tr class='(sortable|advanced)'/.test(r))
  .map((r) => r.replace(/ data-cv-[a-z]+='[^']*'/g, '')
    .replace(/<span class='cv-tags'>(?:<span class='cv-tag'>[^<]*<\/span>)*<\/span>/g, '')
    .replace(/<span class='docker_readmore cv-clamp'>/g, "<span class='docker_readmore'>")
    .replace(/<a href='#' class='cv-more'><i class='fa fa-chevron-down'><\/i><\/a>/g, ''));
const native = new Map(rows(fs.readFileSync(nativePath, 'utf8')).map((r) => [key(r), r]));

console.log(`headers ${headers.length}, rows: ours ${ours.length}, native ${native.size}`);
let same = 0;
for (const r of ours) {
  const n = native.get(key(r));
  if (r === n) { same++; continue; }
  let j = 0;
  while (n && j < r.length && r[j] === n[j]) j++;
  console.log(`\n${key(r)} differs at ${j}:\n  ours:   …${r.slice(Math.max(0, j - 60), j + 140)}\n  native: …${(n || '(missing)').slice(Math.max(0, j - 60), j + 140)}`);
}
const missing = [...native.keys()].filter((k) => !ours.some((r) => key(r) === k));
for (const k of missing) console.log(`\nmissing from ours: ${k}`);
console.log(`\nidentical: ${same}/${ours.length}`);
// Every container renders exactly once, so the row counts must match too.
if (ours.length !== native.size) console.log(`row count differs: ours ${ours.length}, native ${native.size}`);
process.exit(same === ours.length && !missing.length && ours.length === native.size ? 0 : 1);
