// Unit tests for containerview-core.js. Run: node --test tests/
// Synthetic containers only - real captures stay off the repo (see
// parity-live.sh for the check against the live server).
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/usr/local/emhttp/plugins/containerview/containerview-core.js');

let seq = 0;
function ct(name, extra = {}) {
  const id = (++seq).toString(16).padStart(12, '0');
  return {
    name, id, imageId: 'img' + id, image: name + ':latest', baseImage: '', author: name, version: 'latest',
    template: '', running: 1, paused: 0, autostart: false, wait: '', update: 3, manager: 'composeman',
    compose: '', stack: '', shell: '', webui: '', tswebui: '', tsStatus: '', support: '', project: '',
    registry: '', donate: '', readme: '', icon: '/x.png?1', networks: ['bridge'], ips: ['172.17.0.2'],
    portsInternal: [], portsExternal: [], volumes: [], status: 'Uptime: 1 hour', created: '1 hour ago',
    categories: [], ...extra,
  };
}
const feed = (containers, orphans = []) => ({containers, orphans, busy: false});
const rowsOf = (html) => html.split(/(?=<tr[ >])/).filter(Boolean);

test('buildGroups: A->Z by title, Unsorted last, case-insensitive, title-cased', () => {
  const a = ct('a', {categories: ['media']});
  const b = ct('b', {categories: ['Media', 'home-automation']});
  const h = ct('h', {categories: ['home-automation']});
  const c = ct('c');
  const groups = core.buildGroups([c, a, h, b]);
  assert.deepEqual(groups.map((g) => g.title), ['Home Automation', 'Media', 'Unsorted']);
  assert.deepEqual(groups[1].cts.map((x) => x.name), ['a', 'b'], 'keeps feed order within a group');
  assert.equal(groups[2].key, core.UNSORTED);
});

test('buildGroups: each container in exactly one group - its first category, or the first selected one', () => {
  const netmon = ct('netmon', {categories: ['monitoring', 'networking']});
  const npm = ct('npm', {categories: ['networking']});
  const names = (groups) => groups.map((g) => `${g.key}:${g.cts.map((c) => c.name)}`);
  assert.deepEqual(names(core.buildGroups([netmon, npm])), ['monitoring:netmon', 'networking:npm']);
  assert.deepEqual(names(core.buildGroups([netmon, npm], undefined, ['networking'])), ['networking:netmon,npm']);
  // several selected: the container's own label order decides
  assert.deepEqual(names(core.buildGroups([netmon], undefined, ['networking', 'monitoring'])), ['monitoring:netmon']);
  // selection it doesn't carry: stays home
  assert.deepEqual(names(core.buildGroups([netmon], undefined, ['media'])), ['monitoring:netmon']);
});

test('buildGroups: a container labelled "media,Media" is listed once in that group', () => {
  const a = ct('a', {categories: ['media', 'Media']});
  assert.equal(core.buildGroups([a])[0].cts.length, 1);
});

test('segments: 2+ members of a stack form one block at the first member', () => {
  const x = ct('x'), s1 = ct('s1', {stack: 'app'}), y = ct('y'), s2 = ct('s2', {stack: 'app'}), lone = ct('lone', {stack: 'solo'});
  const segs = core.segments({cts: [x, s1, y, s2, lone]});
  assert.deepEqual(segs.map((s) => s.ct ? s.ct.name : `[${s.stack}:${s.cts.map((c) => c.name)}]`), ['x', '[app:s1,s2]', 'y', 'lone']);
});

test('render: groups, stack headers, and native rows only under tr.sortable', () => {
  const a = ct('a', {categories: ['media'], stack: 'app'});
  const b = ct('b', {categories: ['media'], stack: 'app'});
  const c = ct('c');
  const out = core.render(feed([a, b, c]));
  const rows = rowsOf(out.html);
  assert.deepEqual(rows.map((r) => r.match(/^<tr class='([^']*)'/)[1]), ['cv-group', 'cv-stack', 'sortable', 'sortable', 'cv-group', 'sortable']);
  assert.deepEqual(out.headers.map((h) => h.cts.length), [2, 2, 1]);
  assert.match(rows[1], /data-cv-stack='app'/);
  assert.match(rows[0], /2\/2 running/);
});

test('render: a multi-category container renders once, its other categories as tags', () => {
  const a = ct('a', {categories: ['dev', 'Media', 'home-lab']});
  const tagsOf = (html) => [...html.matchAll(/<span class='cv-tag'>([^<]*)<\/span>/g)].map((m) => m[1]);
  let out = core.render(feed([a]));
  let rows = rowsOf(out.html).filter((r) => r.startsWith("<tr class='sortable'"));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /data-cv-group='dev'/);
  assert.deepEqual(tagsOf(rows[0]), ['Media', 'Home Lab']);
  assert.match(rows[0], /<\/div><span class='cv-tags'>.*<\/span><\/td><td class='updatecolumn'>/, 'tags end the name cell');
  // placed under a selected category, the home category becomes a tag
  out = core.render(feed([a]), {place: ['media']});
  rows = rowsOf(out.html).filter((r) => r.startsWith("<tr class='sortable'"));
  assert.match(rows[0], /data-cv-group='media'/);
  assert.deepEqual(tagsOf(rows[0]), ['Dev', 'Home Lab']);
  // single-category and unlabelled containers have no tags span at all
  assert.doesNotMatch(core.render(feed([ct('b', {categories: ['dev']}), ct('c')])).html, /cv-tags/);
});

test('render: orphan images get an Advanced-only header and rows', () => {
  const out = core.render(feed([], [{id: 'abc123abc123', tags: ['old:1'], created: '1 year ago'}]));
  const rows = rowsOf(out.html);
  assert.match(rows[0], /^<tr class='advanced cv-group' data-cv-group='#orphans'>/);
  assert.match(rows[1], /^<tr class='advanced' data-cv-ct='abc123abc123' data-cv-group='#orphans'>/);
});

test('render: no containers shows the native empty message', () => {
  assert.match(core.render(feed([])).html, /No Docker containers installed/);
});

test('containerRow: native onclick uses addslashes only, with the native stray space', () => {
  const a = ct("o'neil", {donate: 'https://d/?a=1&b=2', manager: 'dockerman'});
  const html = core.containerRow(a, {});
  assert.ok(html.includes(`addDockerContainerContext('o\\'neil',`));
  assert.ok(html.includes(`'', 'https://d/?a=1&b=2','')"`), 'raw &, space before donate');
});

test('containerRow: long cells clamp only past two lines and only with readmore on', () => {
  const a = ct('a', {portsExternal: ['h:1', 'h:2', 'h:3']});
  assert.match(core.containerRow(a, {readmore: true}), /docker_readmore cv-clamp'>h:1<br>h:2<br>h:3<\/span><a href='#' class='cv-more'>/);
  assert.doesNotMatch(core.containerRow(a, {readmore: false}), /cv-clamp/);
  const b = ct('b', {portsExternal: ['h:1', 'h:2']});
  assert.doesNotMatch(core.containerRow(b, {readmore: true}), /cv-clamp/);
});

test('collapse: groups default open, stacks default closed, state overrides', () => {
  assert.equal(core.isCollapsed({}, 'media'), false);
  assert.equal(core.isCollapsed({}, 'media', 'app'), true);
  const state = {[core.collapseKey('media')]: true, [core.collapseKey('media', 'app')]: false};
  assert.equal(core.isCollapsed(state, 'media'), true);
  assert.equal(core.isCollapsed(state, 'media', 'app'), false);
});

test('rowHidden: group headers always shown; rows hidden by group or own stack', () => {
  const open = {[core.collapseKey('g', 's')]: false};
  assert.equal(core.rowHidden({}, {kind: 'group', group: 'g'}), false);
  assert.equal(core.rowHidden({}, {kind: 'stack', group: 'g', stack: 's'}), false);
  assert.equal(core.rowHidden({}, {kind: 'row', group: 'g', stack: 's'}), true, 'stack closed by default');
  assert.equal(core.rowHidden(open, {kind: 'row', group: 'g', stack: 's'}), false);
  assert.equal(core.rowHidden({}, {kind: 'row', group: 'g'}), false);
  const closedGroup = {...open, [core.collapseKey('g')]: true};
  assert.equal(core.rowHidden(closedGroup, {kind: 'stack', group: 'g', stack: 's'}), true);
  assert.equal(core.rowHidden(closedGroup, {kind: 'row', group: 'g', stack: 's'}), true);
});

test('dropAllowed: rows stay in their own group and stack block', () => {
  const G = (group) => ({kind: 'group', group});
  const S = (group, stack) => ({kind: 'stack', group, stack});
  const R = (group, stack) => ({kind: 'row', group, stack});
  // [0]G:a [1]R:a [2]S:a/x [3]R:a/x [4]R:a/x [5]R:a [6]G:b [7]R:b
  const base = [G('a'), R('a'), S('a', 'x'), R('a', 'x'), R('a', 'x'), R('a'), G('b'), R('b')];
  assert.equal(core.dropAllowed(base, 1), true, 'standalone right under its group header');
  assert.equal(core.dropAllowed(base, 5), true, 'standalone after a stack block');
  assert.equal(core.dropAllowed(base, 3), true, 'stack member inside its block');
  assert.equal(core.dropAllowed(base, 7), true);
  // standalone dropped between two stack members
  assert.equal(core.dropAllowed([G('a'), S('a', 'x'), R('a', 'x'), R('a'), R('a', 'x')], 3), false);
  // standalone dropped between the stack header and its first member
  assert.equal(core.dropAllowed([G('a'), S('a', 'x'), R('a'), R('a', 'x')], 2), false);
  // stack member dragged out of its block
  assert.equal(core.dropAllowed([G('a'), R('a', 'x'), S('a', 'x'), R('a', 'x')], 1), false);
  // row dragged into another group
  assert.equal(core.dropAllowed([G('a'), R('a'), G('b'), R('a'), R('b')], 3), false);
  // row dragged above every header
  assert.equal(core.dropAllowed([R('a'), G('a'), R('a')], 0), false);
});

test('reorder: group order written into its members\' existing global slots', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((n) => ct(n));
  // group = {b, d, e}, new order e, b, d; a and c must not move
  const next = core.reorder([a, b, c, d, e], [e.id, b.id, d.id]);
  assert.deepEqual(next.map((x) => x.name), ['a', 'e', 'c', 'b', 'd']);
  assert.deepEqual(core.prefsBody(next), {names: 'a;e;c;b;d;', index: '0;1;2;3;4;'});
});

test('bytes / fmtBytes / parseLoad / sumLoad', () => {
  assert.equal(core.bytes('512MiB'), 512 * 1048576);
  assert.equal(core.bytes('1.5GiB'), 1.5 * 1073741824);
  assert.equal(core.bytes('2kB'), 2000);
  assert.equal(core.bytes('0B'), 0);
  assert.equal(core.bytes('garbage'), 0);
  assert.equal(core.fmtBytes(1.5 * 1073741824, ','), '1,50 GiB');
  assert.equal(core.fmtBytes(300 * 1048576), '300 MiB');
  assert.deepEqual(core.parseLoad('abc;200.00%;1GiB / 62GiB', 8), {id: 'abc', cpu: 25, mem: 1073741824});
  assert.equal(core.parseLoad('abc;900%;0B / 1GiB', 8).cpu, 100, 'capped at 100%');
  assert.deepEqual(core.sumLoad(['a', 'b', 'z'], {a: {cpu: 1, mem: 10}, b: {cpu: 2, mem: 5}}), {cpu: 3, mem: 15});
  assert.equal(core.sumLoad(['z'], {}), null);
});

// --- search & filters ---------------------------------------------------

const F = (over = {}) => ({...core.emptyFilter(), ...over});

test('filterActive: blank search alone is not a filter', () => {
  assert.equal(core.filterActive(F({text: '   '})), false);
  assert.equal(core.filterActive(F({text: 'x'})), true);
  assert.equal(core.filterActive(F({update: true})), true);
});

test('matches: every search word must hit name/image/stack/category/port/IP/network', () => {
  const a = ct('reportportal-api-1', {image: 'reportportal/service-api:5.15', stack: 'reportportal', categories: ['dev'],
    portsExternal: ['192.0.2.10:8091'], ips: ['172.18.0.4', null], networks: ['rp_net']});
  for (const q of ['API', 'service-api', 'reportportal', 'dev', '8091', '172.18', 'rp_net', 'report 8091']) {
    assert.equal(core.matches(a, F({text: q})), true, q);
  }
  assert.equal(core.matches(a, F({text: 'report plex'})), false);
});

test('matches: category chips Any vs All, Unsorted as a category', () => {
  const both = ct('both', {categories: ['Media', 'monitoring']});
  const media = ct('media', {categories: ['media']});
  const none = ct('none');
  const any = F({cats: ['media', 'monitoring']});
  const all = F({cats: ['media', 'monitoring'], mode: 'all'});
  assert.deepEqual([both, media, none].map((c) => core.matches(c, any)), [true, true, false]);
  assert.deepEqual([both, media, none].map((c) => core.matches(c, all)), [true, false, false]);
  assert.deepEqual([both, media, none].map((c) => core.matches(c, F({cats: [core.UNSORTED]}))), [false, false, true]);
});

test('matches: state chips are exclusive and OR together, update narrows, kinds AND', () => {
  const up = ct('up', {running: 1, update: 1, categories: ['media']});
  const down = ct('down', {running: 0, update: 0, categories: ['media']});
  const paused = ct('paused', {running: 1, paused: 1, update: 3});
  assert.deepEqual([up, down, paused].map((c) => core.matches(c, F({states: ['running']}))), [true, false, false], 'paused is not running');
  assert.deepEqual([up, down, paused].map((c) => core.matches(c, F({states: ['paused']}))), [false, false, true]);
  assert.deepEqual([up, down, paused].map((c) => core.matches(c, F({states: ['running', 'stopped']}))), [true, true, false]);
  assert.deepEqual([up, down, paused].map((c) => core.matches(c, F({update: true}))), [true, false, false]);
  assert.equal(core.matches(down, F({cats: ['media'], states: ['running']})), false);
});

test('matchSet: null without a filter; orphans match search text only', () => {
  const a = ct('a');
  const img = {id: 'abcabcabcabc', tags: ['old/thing:1'], created: ''};
  const data = feed([a], [img]);
  assert.equal(core.matchSet(data, F()), null);
  assert.deepEqual([...core.matchSet(data, F({text: 'old/thing'}))], [img.id]);
  assert.deepEqual([...core.matchSet(data, F({states: ['stopped']}))], [], 'chips never match orphans');
});

test('layout: no filter follows the saved collapse state', () => {
  const rows = [{kind: 'group', group: 'g'}, {kind: 'stack', group: 'g', stack: 's'}, {kind: 'row', group: 'g', stack: 's', id: 'x'}, {kind: 'row', group: 'g', id: 'y'}];
  assert.deepEqual(core.layout(rows, {}, null), [
    {hidden: false, closed: false}, {hidden: false, closed: true}, {hidden: true, closed: false}, {hidden: false, closed: false},
  ]);
});

test('layout: filter opens matching groups/stacks, hides the rest, ignores saved state', () => {
  const rows = [
    {kind: 'group', group: 'a'}, {kind: 'stack', group: 'a', stack: 's'}, {kind: 'row', group: 'a', stack: 's', id: 'x'}, {kind: 'row', group: 'a', id: 'y'},
    {kind: 'group', group: 'b'}, {kind: 'row', group: 'b', id: 'z'},
  ];
  const saved = {[core.collapseKey('a')]: true}; // a collapsed, stack s collapsed by default
  const hidden = (l) => l.map((x) => x.hidden);
  assert.deepEqual(hidden(core.layout(rows, saved, new Set(['x']))), [false, false, false, true, true, true]);
  assert.deepEqual(hidden(core.layout(rows, saved, new Set(['y']))), [false, true, true, false, true, true], 'stack with no match hides');
  assert.deepEqual(hidden(core.layout(rows, saved, new Set())), [true, true, true, true, true, true]);
  // a header clicked closed during the filter (temp) closes just that block
  const temp = {[core.collapseKey('a', 's')]: true};
  const l = core.layout(rows, saved, new Set(['x', 'y']), temp);
  assert.deepEqual(hidden(l), [false, false, true, false, true, true]);
  assert.equal(l[1].closed, true);
});

test('countText: plain and filtered', () => {
  const a = ct('a', {running: 1}), b = ct('b', {running: 0}), c = ct('c', {running: 1});
  assert.equal(core.countText([a, b, c], null), '2/3 running');
  assert.equal(core.countText([a, b, c], new Set([b.id, c.id])), '1/2 running (2 of 3)');
  assert.equal(core.countText([a], null), '1/1 running');
});

test('categoryChips: A->Z, Unsorted last, counting every container carrying the category', () => {
  const chips = core.categoryChips([ct('a', {categories: ['media']}), ct('b', {categories: ['dev', 'media']}), ct('c')]);
  assert.deepEqual(chips.map((c) => [c.title, c.count]), [['Dev', 1], ['Media', 2], ['Unsorted', 1]]);
});

test('layout: with category chips, matches show only under the selected groups', () => {
  // netmon is in monitoring and networking; the filter selects networking only.
  const rows = [
    {kind: 'group', group: 'monitoring'}, {kind: 'row', group: 'monitoring', id: 'netmon'}, {kind: 'row', group: 'monitoring', id: 'loki'},
    {kind: 'group', group: 'networking'}, {kind: 'row', group: 'networking', id: 'netmon'}, {kind: 'row', group: 'networking', id: 'npm'},
  ];
  const hidden = (l) => l.map((x) => x.hidden);
  const ids = new Set(['netmon', 'npm']);
  assert.deepEqual(hidden(core.layout(rows, {}, ids, {}, new Set(['networking']))), [true, true, true, false, false, false]);
  // no group restriction (e.g. a text filter): every group with a match shows
  assert.deepEqual(hidden(core.layout(rows, {}, ids)), [false, false, true, false, false, false]);
  // All mode with both selected: a container in both shows under both
  assert.deepEqual(hidden(core.layout(rows, {}, new Set(['netmon']), {}, new Set(['monitoring', 'networking']))), [false, false, true, false, false, true]);
});

test('headerKeys: all groups and stacks, or one group\'s stacks', () => {
  const rows = [
    {kind: 'group', group: 'a'}, {kind: 'stack', group: 'a', stack: 's'}, {kind: 'row', group: 'a', stack: 's', id: 'x'},
    {kind: 'stack', group: 'a', stack: 't'}, {kind: 'row', group: 'a', stack: 't', id: 'y'},
    {kind: 'group', group: 'b'}, {kind: 'row', group: 'b', id: 'z'},
  ];
  assert.deepEqual(core.headerKeys(rows).map((h) => h.key), ['g:a', 's:a/s', 's:a/t', 'g:b']);
  assert.deepEqual(core.headerKeys(rows, 'a').map((h) => h.key), ['s:a/s', 's:a/t']);
  assert.deepEqual(core.headerKeys(rows, 'b'), []);
  assert.equal(core.headerKeys(rows)[0].stack, undefined, 'group entries have no stack');
});

test('render: only group headers that contain stacks get the stacks toggle', () => {
  const out = core.render(feed([ct('a', {categories: ['dev'], stack: 'app'}), ct('b', {categories: ['dev'], stack: 'app'}), ct('c', {categories: ['media']})]));
  const groups = rowsOf(out.html).filter((r) => r.startsWith("<tr class='cv-group'"));
  assert.match(groups[0], /cv-stacks/);
  assert.doesNotMatch(groups[1], /cv-stacks/);
});

test('stackIcon: the service named like the stack, else first real icon, else generic', () => {
  const q = '/plugins/dynamix.docker.manager/images/question.png?1';
  const db = ct('forgejo-forgejo-db-1', {icon: '/db.png?1'});
  const app = ct('forgejo-forgejo-1', {icon: '/forgejo.png?1'});
  assert.match(core.stackIcon('forgejo', [db, app]), /src='\/forgejo.png\?1'/);
  assert.match(core.stackIcon('forgejo', [ct('x', {icon: q}), db]), /src='\/db.png\?1'/);
  assert.match(core.stackIcon('forgejo', [ct('x', {icon: q})]), /fa-cubes/);
});

test('render: stack header shows its running state, stats on the right', () => {
  const a = ct('a', {categories: ['dev'], stack: 'app', running: 1});
  const b = ct('b', {categories: ['dev'], stack: 'app', running: 0});
  const stack = rowsOf(core.render(feed([a, b])).html).find((r) => r.startsWith("<tr class='cv-stack'"));
  assert.match(stack, /fa-play orange-text'><\/i><span class='cv-state'>1 of 2 running/);
  assert.match(stack, /<span class='cv-stats'><span class='advanced cv-load'>/, 'no second count on stacks');
});

test('headers and toggles are keyboard / link-hint reachable', () => {
  const out = core.render(feed([ct('a', {categories: ['dev'], stack: 'app'}), ct('b', {categories: ['dev'], stack: 'app'})]));
  const headers = rowsOf(out.html).filter((r) => /^<tr class='cv-(group|stack)'/.test(r));
  for (const h of headers) {
    assert.match(h, /<i class='fa fa-chevron-down cv-chev' role='button' tabindex='0' aria-expanded='true'/);
    // chevron + icon menu (+ the group's stacks toggle): one button per control
    assert.equal((h.match(/role='button'/g) || []).length, h.includes('cv-stacks') ? 3 : 2, 'one button per control');
  }
  assert.match(headers[0], /class='fa fa-angle-double-down cv-stacks' role='button' tabindex='0'/);
});

test('stackIcon: a chosen service wins, even over the main one; unknown choice falls back', () => {
  const db = ct('forgejo-forgejo-db-1', {icon: '/db.png?1', service: 'forgejo-db'});
  const app = ct('forgejo-forgejo-1', {icon: '/forgejo.png?1', service: 'forgejo'});
  assert.match(core.stackIcon('forgejo', [db, app], 'forgejo-db'), /src='\/db.png\?1'/);
  assert.match(core.stackIcon('forgejo', [db, app], 'gone'), /src='\/forgejo.png\?1'/);
  const out = core.render({...feed([db, app].map((c) => ({...c, stack: 'forgejo'}))), stackIcons: {forgejo: 'forgejo-db'}});
  assert.match(rowsOf(out.html).find((r) => r.startsWith("<tr class='cv-stack'")), /<span class='cv-stack-icon'><img src='\/db.png\?1'/);
});

// --- group icons and header menus --------------------------------------------

test('groupIcon: built-in per category, chosen override, folder otherwise', () => {
  assert.equal(core.groupIcon('media'), 'fa-film');
  assert.equal(core.groupIcon(core.UNSORTED), 'fa-inbox');
  assert.equal(core.groupIcon('home lab'), 'fa-folder');
  assert.equal(core.groupIcon('media', {media: 'fa-music'}), 'fa-music');
  assert.ok(core.ICON_CHOICES.every((i) => /^fa-[a-z0-9-]+$/.test(i)));
});

test('render: group and stack icons are menu buttons with the right icon', () => {
  const data = {...feed([ct('a', {categories: ['media'], stack: 'app', service: 'web', icon: '/web.png?1'}),
    ct('b', {categories: ['media'], stack: 'app', service: 'db'})]), groupIcons: {media: 'fa-music'}};
  const out = core.render(data);
  const [group, stack] = rowsOf(out.html);
  // icon + name are one menu element
  assert.match(group, /<span class='cv-menu-icon' id='cv-hi-0' role='button' tabindex='0' title="Group actions" onclick="cvHeaderMenu\(this\)"><span class='cv-group-icon'><i class='fa fa-music'><\/i><\/span><span class='cv-title'>Media<\/span><\/span>/);
  assert.match(stack, /<span class='cv-menu-icon' id='cv-hi-1'[^>]*onclick="cvHeaderMenu\(this\)"><span class='cv-stack-icon'><img src='\/web.png\?1'[^>]*><\/span><span class='cv-stack-name'><span class='cv-title'>app<\/span><br>.*?running<\/span><\/span><\/span><i class='fa fa-chevron-down cv-chev'/);
  assert.deepEqual(out.headers.map((h) => [h.kind, h.group, h.stack]), [['group', 'media', ''], ['stack', 'media', 'app']]);
});

test('actionPlan: picks the containers an action applies to, stacks by service', () => {
  const up = ct('up', {running: 1, stack: 's', service: 'web'});
  const db = ct('db', {running: 1, stack: 's', service: 'db'});
  const down = ct('down', {running: 0});
  const paused = ct('zz', {running: 1, paused: 1});
  const all = [up, db, down, paused];
  assert.deepEqual(core.actionPlan(all, 'start'), {stacks: {}, containers: ['down'], names: ['down']});
  assert.deepEqual(core.actionPlan(all, 'stop'), {stacks: {s: ['web', 'db']}, containers: ['zz'], names: ['up', 'db', 'zz']});
  assert.deepEqual(core.actionPlan(all, 'restart').names, ['up', 'db'], 'paused ones are not restarted');
  assert.deepEqual(core.actionPlan(all, 'pause').names, ['up', 'db']);
  assert.deepEqual(core.actionPlan(all, 'unpause'), {stacks: {}, containers: ['zz'], names: ['zz']});
});

test('stateCounts: exclusive state totals plus update-ready', () => {
  assert.deepEqual(core.stateCounts([
    ct('a', {running: 1, update: 1}), ct('b', {running: 1, paused: 1}), ct('c', {running: 0}), ct('d', {running: 1, update: 0}),
  ]), {running: 2, paused: 1, stopped: 1, update: 1});
});

test('categoryChips: in All mode, counts are what adding that category would list', () => {
  const cts = [
    ct('a', {categories: ['media', 'monitoring'], running: 1}), ct('b', {categories: ['media']}),
    ct('c', {categories: ['monitoring', 'networking'], running: 0}), ct('d'),
  ];
  const counts = (f) => Object.fromEntries(core.categoryChips(cts, undefined, f).map((c) => [c.key, c.count]));
  assert.deepEqual(counts(null), {media: 2, monitoring: 2, networking: 1, '': 1}, 'no filter: totals');
  assert.deepEqual(counts(F({cats: ['media']})), {media: 2, monitoring: 2, networking: 1, '': 1}, 'Any mode: totals');
  assert.deepEqual(counts(F({mode: 'all', cats: ['media']})), {media: 2, monitoring: 1, networking: 0, '': 0});
  assert.deepEqual(counts(F({mode: 'all', cats: ['monitoring'], states: ['stopped']})), {media: 0, monitoring: 1, networking: 1, '': 0},
    'other filters count too');
});

test('stateCounts: counts within the category/text filter, whatever the mode', () => {
  const cts = [
    ct('a', {categories: ['media'], running: 1, update: 1}), ct('b', {categories: ['media'], running: 1, paused: 1}),
    ct('c', {categories: ['media'], running: 0}), ct('d', {categories: ['dev'], running: 1, update: 1}),
  ];
  assert.deepEqual(core.stateCounts(cts, F({cats: ['media']})), {running: 1, paused: 1, stopped: 1, update: 1}, 'Any');
  assert.deepEqual(core.stateCounts(cts, F({mode: 'all', cats: ['media']})), {running: 1, paused: 1, stopped: 1, update: 1}, 'All');
  assert.deepEqual(core.stateCounts(cts, F({cats: ['media'], states: ['running']})), {running: 1, paused: 1, stopped: 1, update: 1},
    'pick-one: each state counts on its own, not added to the selected one');
  assert.deepEqual(core.stateCounts(cts, F({update: true})), {running: 2, paused: 0, stopped: 0, update: 2}, 'within Update ready');
  assert.deepEqual(core.stateCounts(cts, F({states: ['running']})).update, 2, 'Update ready within the selected state');
});

test('globMatch: whole-value, case-insensitive, * and ? only', () => {
  assert.ok(core.globMatch('*/linuxserver/sonarr*', 'lscr.io/linuxserver/sonarr:latest'));
  assert.ok(core.globMatch('PLEX', 'plex'));
  assert.ok(core.globMatch('plex?', 'plex2'));
  assert.ok(!core.globMatch('plex', 'plex2'));
  assert.ok(!core.globMatch('plex?', 'plex'));
  assert.ok(core.globMatch('a.b', 'a.b'));
  assert.ok(!core.globMatch('a.b', 'axb'));
  assert.ok(!core.globMatch('*', ''));
});

test('ruleMatches: every field given must match; a rule with no field matches nothing', () => {
  const ct = {name: 'sonarr', image: 'lscr.io/linuxserver/sonarr:latest', stack: ''};
  assert.ok(core.ruleMatches({name: 'son*'}, ct));
  assert.ok(core.ruleMatches({name: 'sonarr', image: '*sonarr*'}, ct));
  assert.ok(!core.ruleMatches({name: 'sonarr', image: '*radarr*'}, ct));
  assert.ok(!core.ruleMatches({stack: '*'}, ct));
  assert.ok(!core.ruleMatches({categories: ['media']}, ct));
});

test('applyRules: labels win by default; rules fill unlabelled containers in rule order', () => {
  const cts = [
    {name: 'plex', image: 'plexinc/pms', stack: '', categories: ['media']},
    {name: 'sonarr', image: 'lscr.io/linuxserver/sonarr', stack: '', categories: []},
    {name: 'immich-server', image: 'immich', stack: 'immich', categories: []},
    {name: 'adminer', image: 'adminer', stack: '', categories: []},
  ];
  const rules = [
    {name: 'plex', categories: ['networking']},
    {image: '*sonarr*', categories: ['downloads', 'media']},
    {name: 's*', categories: ['Media', 'dev']},
    {stack: 'immich', categories: ['photos']},
  ];
  const out = core.applyRules(cts, rules);
  assert.deepEqual(out.map((c) => c.categories), [['media'], ['downloads', 'media', 'dev'], ['photos'], []]);
  assert.deepEqual(out.map((c) => c.catSource), ['label', 'rule', 'rule', '']);
  assert.deepEqual(cts[1].categories, [], 'inputs are not modified');
});

test('applyRules: with precedence "rules", a matching rule replaces the label', () => {
  const cts = [
    {name: 'plex', image: 'plexinc/pms', stack: '', categories: ['media']},
    {name: 'jellyfin', image: 'jellyfin', stack: '', categories: ['media']},
  ];
  const out = core.applyRules(cts, [{name: 'plex', categories: ['streaming']}], 'rules');
  assert.deepEqual(out.map((c) => c.categories), [['streaming'], ['media']]);
  assert.deepEqual(out.map((c) => c.catSource), ['rule', 'label']);
});

test('ruleText: describes what a rule matches', () => {
  assert.equal(core.ruleText({stack: 'immich'}), 'stack immich');
  assert.equal(core.ruleText({name: 'plex', image: 'plexinc/*'}), 'name plex, image plexinc/*');
});

test('ruleMatches: a container in a compose stack only takes stack rules', () => {
  const ct = {name: 'immich-server', image: 'ghcr.io/immich-app/immich-server', stack: 'immich'};
  assert.ok(!core.ruleMatches({name: 'immich*'}, ct));
  assert.ok(!core.ruleMatches({image: '*immich*'}, ct));
  assert.ok(core.ruleMatches({stack: 'imm*'}, ct));
});

test('applyRules: ruleIndex is the first matching rule, even when a label wins', () => {
  const out = core.applyRules([
    {name: 'plex', image: 'pms', stack: '', categories: ['media']},
    {name: 'sonarr', image: 'sonarr', stack: '', categories: []},
    {name: 'x', image: 'x', stack: '', categories: []},
  ], [{name: 'sonarr', categories: ['a']}, {name: 'plex', categories: ['b']}, {image: 'sonarr', categories: ['c']}]);
  assert.deepEqual(out.map((c) => c.ruleIndex), [1, 0, -1]);
});

test('render: rule badges - stack icon element, data-cv-rule on standalone rows only', () => {
  const rules = [{stack: 'immich', categories: ['photos']}, {name: 'plex', categories: ['tv']}];
  const cts = core.applyRules([
    ct('immich-server', {stack: 'immich'}), ct('immich-db', {stack: 'immich'}),
    ct('plex', {categories: ['media']}), ct('sonarr'),
  ], rules);
  const {html} = core.render({...feed(cts), rules}, {});
  const rows = rowsOf(html);
  const stack = rows.find((r) => r.includes("class='cv-stack'"));
  assert.match(stack, /<i class='fa fa-tag cv-rule-badge' title="Category rule: stack immich">/);
  assert.ok(rows.filter((r) => r.includes('immich-')).every((r) => !r.includes('data-cv-rule')));
  assert.match(rows.find((r) => r.includes("id='plex'") || r.includes('>plex<')), /data-cv-rule='off'/);
  assert.ok(!rows.find((r) => r.includes('>sonarr<')).includes('data-cv-rule'));
});

test('ruleBadge: none, on, or off when every match has a label that wins', () => {
  assert.equal(core.ruleBadge([{ruleIndex: -1}]), null);
  assert.deepEqual(core.ruleBadge([{ruleIndex: -1}, {ruleIndex: 2, catSource: 'rule'}]), {index: 2, on: true});
  assert.deepEqual(core.ruleBadge([{ruleIndex: 0, catSource: 'label'}]), {index: 0, on: false});
});

test('dashPlan: tile icons grouped A->Z, Unsorted last, stacks as one item, unknown ids Unsorted', () => {
  const cts = [
    ct('db', {stack: 'app', categories: ['dev']}), ct('plex', {categories: ['media']}),
    ct('web', {categories: ['dev']}), ct('app', {stack: 'app', categories: ['dev']}), ct('misc'),
    ct('solo', {stack: 'one', categories: ['dev']}),
  ];
  const [db, plex, web, app, misc, solo] = cts.map((c) => c.id);
  const plan = core.dashPlan(cts, [db, plex, web, 'zzz', app, misc, solo]);
  assert.deepEqual(plan.map((g) => [g.key, g.title, g.items]), [
    ['dev', 'Dev', [{stack: 'app', ids: [db, app]}, {id: web}, {id: solo}]],
    ['media', 'Media', [{id: plex}]],
    ['', 'Unsorted', [{id: misc}, {id: 'zzz'}]],
  ]);
  assert.deepEqual(core.dashPlan(cts.slice(0, 1), [db, 'new']).map((g) => g.key), ['dev', '']);
  assert.deepEqual(core.dashPlan(cts, [plex]).map((g) => g.items), [[{id: plex}]], 'only icons in the tile');
});

test('dashPlan: selected categories decide a container\'s section', () => {
  const cts = [ct('sonarr', {categories: ['downloads', 'media']})];
  assert.deepEqual(core.dashPlan(cts, [cts[0].id]).map((g) => g.key), ['downloads']);
  assert.deepEqual(core.dashPlan(cts, [cts[0].id], undefined, ['media']).map((g) => g.key), ['media']);
});

test('updatePlan: template containers with an update; compose ones listed as skipped', () => {
  const plan = core.updatePlan([
    ct('plex', {update: 1, manager: 'dockerman'}), ct('sonarr', {update: 0, manager: 'dockerman'}),
    ct('immich', {update: 1, manager: 'composeman'}), ct('x', {update: 3, manager: 'dockerman'}),
    ct('radarr', {update: 1, manager: 'dockerman'}),
  ]);
  assert.deepEqual(plan, {names: ['plex', 'radarr'], skipped: ['immich']});
});

test('keys named like Object.prototype members are ordinary keys', () => {
  const cts = [ct('a', {stack: 'constructor', service: 's1', categories: ['constructor']}), ct('b', {stack: 'constructor', service: 's2', categories: ['constructor']})];
  const [g] = core.buildGroups(cts);
  assert.deepEqual(core.segments(g).map((s) => s.stack), ['constructor'], 'two members form one stack');
  assert.deepEqual(core.actionPlan(cts, 'stop').stacks, {constructor: ['s1', 's2']});
  assert.equal(core.groupIcon('constructor', {}), 'fa-folder');
  assert.equal(core.groupIcon('toString'), 'fa-folder');
  assert.equal(core.own({}, 'constructor'), undefined);
  assert.equal(core.own({constructor: 'x'}, 'constructor'), 'x');
});
