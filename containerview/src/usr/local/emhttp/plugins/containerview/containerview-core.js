// Container View core: everything that doesn't touch the DOM, jQuery or the
// native page - row/header HTML, grouping, collapse rules, drag rules, global
// re-ordering and load sums. Loaded by the page as window.ContainerViewCore
// and require()d by the tests (tests/core.test.js, tests/parity.js).
//
// Native-parity rule: containerRow()'s output is byte-for-byte what
// dynamix.docker.manager's DockerContainers.php emits, because other plugins
// read those rows. The only additions allowed are data-cv-* attributes, the
// cv-clamp class (plus its cv-more toggle link) and the cv-tags span at the
// end of the name cell. tests/parity-live.sh checks this against the server.
//
// Every container renders exactly once: in its home group (first category
// label value), or - while category chips are selected - under the first of
// its categories that is selected. Its other categories show as tags.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContainerViewCore = factory();
})(this, function () {
  const UNSORTED = '';
  const ORPHANS = '#orphans';
  const CLAMP_LINES = 2; // native readmore maxHeight:32px ~ two lines

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  // PHP addslashes(), for values the native markup puts inside '...' JS strings.
  const slashes = (s) => String(s ?? '').replace(/[\\'"]/g, '\\$&');
  const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const identity = (s) => s;
  // obj[key] for keys that came from data (category, stack names): only own
  // properties, so a stack called "constructor" isn't Object.prototype's.
  const own = (obj, key) => (obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

  // --- native row markup ---------------------------------------------------

  // Native: <td style><span class='docker_readmore'>lines</span></td>.
  function readmoreCell(opts, style, lines, lead = '', suffix = '') {
    const body = lead + lines.join('<br>') + suffix;
    if (!opts.readmore || lines.length <= CLAMP_LINES) {
      return `<td style='${style}'><span class='docker_readmore'>${body}</span></td>`;
    }
    return `<td style='${style}'><span class='docker_readmore cv-clamp'>${body}</span>` +
      `<a href='#' class='cv-more'><i class='fa fa-chevron-down'></i></a></td>`;
  }

  function iconHtml(icon) {
    if (icon.includes('.png')) return `<img src='${esc(icon)}' class='img' onerror=this.src='/plugins/dynamix.docker.manager/images/question.png';>`;
    if (icon.startsWith('icon-')) return `<i class='${esc(icon)} img'></i>`;
    return `<i class='fa fa-${esc(icon)} img'></i>`;
  }

  // Native: sprintf("onclick=\"addDockerContainerContext('%s',...)\"", addslashes(...))
  // - addslashes only, no HTML escaping, and its stray space before the
  // donate argument - reproduced exactly.
  function menuOnclick(ct) {
    const a = (s) => `'${slashes(s)}'`;
    return `onclick="addDockerContainerContext(${a(ct.name)},${a(ct.imageId)},${a(ct.template)},${ct.running},${ct.paused},${ct.update},${ct.autostart},` +
      `${a(ct.webui)},${a(ct.tswebui)},'${ct.shell}','${ct.id}',${a(ct.support)},${a(ct.project)},${a(ct.registry)}, ${a(ct.donate)},${a(ct.readme)})"`;
  }

  function updateCell(ct, tr) {
    const n = esc(slashes(esc(ct.name)));
    const dm = ct.manager === 'dockerman';
    const upd = (label) => `<a class='exec' onclick="updateContainer('${n}');"><span style='white-space:nowrap;'><i class='fa fa-cloud-download fa-fw'></i> ${tr(label)}</span></a>`;
    const other = ct.compose ? `<div><span><i class='fa fa-docker fa-fw'/></i> ${tr('Compose')}</span></div>`
                             : `<div><span><i class='fa fa-docker fa-fw'/></i> ${tr('3rd Party')}</span></div>`;
    switch (ct.update) {
      case 0:
        return dm ? `<span class='green-text' style='white-space:nowrap;'><i class='fa fa-check fa-fw'></i> ${tr('up-to-date')}</span><div class='advanced'>${upd('force update')}</div>` : other;
      case 1:
        return `<div class='advanced'><span class='orange-text' style='white-space:nowrap;'><i class='fa fa-flash fa-fw'></i> ${tr('update ready')}</span></div>` + (dm ? upd('apply update') : other);
      case 2:
        return `<div class='advanced'><span class='orange-text' style='white-space:nowrap;'><i class='fa fa-flash fa-fw'></i> ${tr('rebuild ready')}</span></div>` +
          `<a class='exec'><span style='white-space:nowrap;'><i class='fa fa-recycle fa-fw'></i> ${tr('rebuilding')}</span></a>`;
      default:
        return dm ? `<span class='orange-text' style='white-space:nowrap;'><i class='fa fa-unlink'></i> ${tr('not available')}</span><div class='advanced'>${upd('force update')}</div>` : other;
    }
  }

  // tags: titles of the container's other categories, shown at the end of
  // the name cell.
  function containerRow(ct, opts, attrs = '', tags = []) {
    const tr = opts.tr || identity;
    const name = esc(ct.name);
    const shape = ct.running ? (ct.paused ? 'pause' : 'play') : 'square';
    const status = ct.running ? (ct.paused ? 'paused' : 'started') : 'stopped';
    const color = status === 'started' ? 'green-text' : (status === 'paused' ? 'orange-text' : 'red-text');
    const appname = ct.template && !ct.compose
      ? `<a class='exec' onclick="editContainer('${esc(slashes(name))}','${esc(slashes(esc(ct.template)))}')">${name}</a>` : name;
    const by = ct.registry ? `<a href='${esc(ct.registry)}' target='_blank'>${esc(ct.author)}</a>` : esc(ct.author);
    const paths = ct.volumes.map((v) => `${esc(v.container)}<i class="fa fa-${v.ro ? 'long-arrow-left' : 'arrows-h'}" style="margin:0 6px"></i>${esc(v.host)}`);

    let auto;
    if (ct.compose) auto = `<td><i class='fa fa-docker'/></i> Compose`;
    else if (ct.manager === 'dockerman') auto = `<td><input type='checkbox' id='${ct.id}-auto' class='autostart' container='${name}'${ct.autostart ? ' checked' : ''}>`;
    else auto = `<td><i class='fa fa-docker fa-fw'/></i> 3rd Party`;

    return `<tr class='sortable' data-cv-ct='${esc(ct.id)}'${attrs}><td class='ct-name' style='width:220px;padding:8px'><i class='fa fa-arrows-v mover orange-text'></i>` +
      `<span class='outer'><span id='${ct.id}' ${menuOnclick(ct)} class='hand'>${iconHtml(ct.icon)}</span><span class='inner'><span class='appname '>${appname}</span><br>` +
      `<i id='load-${ct.id}' class='fa fa-${shape} ${status} ${color}'></i><span class='state'>${tr(status)}${ct.compose ? '<br/>Compose Stack: ' + esc(ct.compose) : ''}</span></span></span>` +
      `<div class='advanced' style='margin-top:8px'>${tr('Container ID')}: ${esc(ct.id)}<br>` +
      (ct.baseImage ? `<i class='fa fa-cubes' style='margin-right:5px'></i>${esc(ct.baseImage)}<br>` : '') +
      `${tr('By')}: ${by}</div>${tagsHtml(tags)}</td><td class='updatecolumn'>${updateCell(ct, tr)}` +
      `<div class='advanced'><i class='fa fa-info-circle fa-fw'></i> ${esc(ct.version)}</div></td>` +
      readmoreCell(opts, 'white-space:nowrap', ct.networks.map(esc), ' ', ct.tsStatus || '') +
      readmoreCell(opts, 'white-space:nowrap', ct.ips.map((ip) => esc(ip ?? '')), ' ') +
      readmoreCell(opts, 'white-space:nowrap', ct.portsInternal.map(esc)) +
      readmoreCell(opts, 'white-space:nowrap', ct.portsExternal.map(esc)) +
      readmoreCell(opts, 'word-break:break-all', paths) +
      `<td class='advanced'><span class='cpu-${ct.id}'>0%</span><div class='usage-disk mm'><span id='cpu-${ct.id}' style='width:0'></span><span></span></div>` +
      `<br><span class='mem-${ct.id}'>0 / 0</span></td>` +
      `${auto}<span id='${ct.id}-wait' style='float:right;display:none'>${tr('wait')}<input class='wait' container='${name}' type='number' value='${esc(ct.wait)}' placeholder='0' title="${esc(tr('seconds'))}"></span></td>` +
      `<td><div style='white-space:nowrap'>${esc(ct.status)}<div style='margin-top:4px'>${tr('Created')}: ${esc(ct.created)}</div></div></td></tr>`;
  }

  const tagsHtml = (tags) => (tags.length
    ? `<span class='cv-tags'>${tags.map((t) => `<span class='cv-tag'>${esc(t)}</span>`).join('')}</span>` : '');

  function orphanRow(img, opts) {
    const tr = opts.tr || identity;
    return `<tr class='advanced' data-cv-ct='${img.id}' data-cv-group='${ORPHANS}'><td style='width:220px;padding:8px'>` +
      `<span class='outer apps'><span id='${img.id}' onclick="addDockerImageContext('${img.id}','${esc(img.tags.join(','))}')" class='hand'><img src='/webGui/images/disk.png' class='img'></span>` +
      `<span class='inner'>(${tr('orphan image')})<br><i class='fa fa-square stopped grey-text'></i><span class='state'>${tr('stopped')}</span></span></span>` +
      `</td><td colspan='6'>${tr('Image ID')}: ${img.id}<br>${esc(img.tags.join(', '))}</td>` +
      `<td>${tr('Created')} ${esc(img.created)}</td></tr>`;
  }

  // --- category rules ------------------------------------------------------
  // For containers without the category label (rules.json on the flash, edited
  // from the page): [{stack?, name?, image?, categories: [...]}, ...]. Each
  // pattern matches the whole value, case-insensitively, with * and ? as the
  // only wildcards; a rule needs every pattern it has to match. A container in
  // a compose stack goes with its stack: only rules with a stack pattern apply.

  function globMatch(pattern, value) {
    const re = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return value !== '' && new RegExp(`^${re}$`, 'i').test(String(value));
  }

  const RULE_FIELDS = ['stack', 'name', 'image'];
  function ruleMatches(rule, ct) {
    const fields = RULE_FIELDS.filter((f) => rule[f]);
    if (ct.stack && !rule.stack) return false;
    return fields.length > 0 && fields.every((f) => globMatch(rule[f], ct[f] || ''));
  }

  const ruleText = (rule) => RULE_FIELDS.filter((f) => rule[f]).map((f) => `${f} ${rule[f]}`).join(', ');

  // Markup for a ruleBadge(): data-cv-rule='on|off' for a native element
  // (drawn by CSS), or a badge element with the rule as its tooltip.
  const ruleBadgeAttr = (b) => (b ? ` data-cv-rule='${b.on ? 'on' : 'off'}'` : '');
  const ruleBadgeEl = (b, rules = [], tr = identity) => (b
    ? `<i class='fa fa-tag cv-rule-badge${b.on ? '' : ' cv-off'}' title="${esc(`${tr('Category rule')}: ${ruleText(rules[b.index] || {})}` +
      (b.on ? '' : ` (${tr('a label wins')})`))}"></i>` : '');

  // A rule badge for containers (applyRules output) sharing a rule: null
  // without one, else {index, on} - on: their categories come from it (off:
  // a label wins).
  function ruleBadge(cts) {
    const hit = cts.find((c) => c.ruleIndex >= 0);
    return hit ? {index: hit.ruleIndex, on: cts.some((c) => c.catSource === 'rule')} : null;
  }

  // Containers with their effective categories and where they came from
  // (catSource: 'label', 'rule' or '') and the first rule matching it (ruleIndex,
  // -1 for none - set even when its label wins). precedence 'labels' (default): a label
  // wins and rules only fill unlabelled containers; 'rules': any matching rule
  // replaces the label. Matching rules add their categories in rule order, so
  // the first rule's first category is the container's home group.
  function applyRules(containers, rules = [], precedence = 'labels') {
    return containers.map((ct) => {
      const fromRules = [];
      let ruleIndex = -1;
      rules.forEach((rule, i) => {
        if (!ruleMatches(rule, ct)) return;
        if (ruleIndex < 0) ruleIndex = i;
        for (const c of rule.categories || []) if (!fromRules.some((x) => x.toLowerCase() === c.toLowerCase())) fromRules.push(c);
      });
      const label = ct.categories;
      const useRules = fromRules.length && (precedence === 'rules' || !label.length);
      return {...ct, categories: useRules ? fromRules : label, catSource: useRules ? 'rule' : label.length ? 'label' : '', ruleIndex};
    });
  }

  // --- grouping ------------------------------------------------------------

  // A container's categories as keys (lower-cased, de-duplicated, label
  // order), UNSORTED when it has none.
  const catKeys = (ct) => {
    const keys = [...new Set(ct.categories.map((c) => c.toLowerCase()))];
    return keys.length ? keys : [UNSORTED];
  };

  // Display title per category key: the first spelling seen, title-cased.
  function catTitles(containers, tr = identity) {
    const titles = new Map([[UNSORTED, tr('Unsorted')]]);
    for (const ct of containers) for (const c of ct.categories) if (!titles.has(c.toLowerCase())) titles.set(c.toLowerCase(), titleCase(c));
    return titles;
  }

  // Where a container renders: the first of its categories that is selected
  // (place: the selected chip keys), else its first category.
  const homeOf = (ct, place = []) => {
    const keys = catKeys(ct);
    return keys.find((k) => place.includes(k)) ?? keys[0];
  };

  // Groups A->Z, Unsorted last; each container in exactly one (homeOf).
  // Within a group, containers keep the native (UserPrefs) order.
  function buildGroups(containers, tr = identity, place = []) {
    const titles = catTitles(containers, tr);
    const groups = new Map();
    for (const ct of containers) {
      const key = homeOf(ct, place);
      if (!groups.has(key)) groups.set(key, {key, title: titles.get(key), cts: []});
      groups.get(key).cts.push(ct);
    }
    return [...groups.values()].sort((a, b) => (a.key === UNSORTED) - (b.key === UNSORTED) || a.title.localeCompare(b.title));
  }

  // A group's display order: standalone containers, plus each compose stack
  // with 2+ members in this group as one block where its first member sits.
  function segments(group) {
    const counts = new Map();
    for (const ct of group.cts) if (ct.stack) counts.set(ct.stack, (counts.get(ct.stack) || 0) + 1);
    const out = [], stacks = new Map();
    for (const ct of group.cts) {
      if (ct.stack && counts.get(ct.stack) > 1) {
        if (!stacks.has(ct.stack)) { stacks.set(ct.stack, {stack: ct.stack, cts: []}); out.push(stacks.get(ct.stack)); }
        stacks.get(ct.stack).cts.push(ct);
      } else {
        out.push({ct});
      }
    }
    return out;
  }

  // "10/12 running"; with a filter, "2/3 running (3 of 12)" - running among
  // the matches, then how many of the group match.
  function countText(cts, matchIds, tr = identity) {
    const shown = matchIds ? cts.filter((c) => matchIds.has(c.id)) : cts;
    const running = shown.filter((c) => c.running).length;
    return `${running}/${shown.length} ${tr('running')}` + (matchIds ? ` (${shown.length} ${tr('of')} ${cts.length})` : '');
  }

  // A stack row's icon: the member whose service was chosen with "Use icon
  // for stack" (chosen), else its main container's (the service named like
  // the stack, e.g. forgejo-forgejo-1), else the first member with a real
  // icon, else a generic stack icon.
  function stackIcon(stack, cts, chosen = '') {
    const picked = chosen && cts.find((c) => c.service === chosen);
    if (picked) return iconHtml(picked.icon);
    const real = (c) => c.icon && !c.icon.includes('/question.png');
    const prefix = `${stack}-${stack}-`; // compose's <project>-<service>-<n>
    const named = (c) => c.name === stack || (c.name.startsWith(prefix) && /^\d+$/.test(c.name.slice(prefix.length)));
    const main = cts.find((c) => real(c) && named(c)) || cts.find(real);
    return main ? iconHtml(main.icon) : `<i class='fa fa-cubes img'></i>`;
  }

  // --- group icons and header menus ---------------------------------------------

  // Built-in Font Awesome (4.x, shipped with Unraid) icon per category;
  // "Change icon..." in a group's menu overrides it (data.groupIcons).
  const GROUP_ICONS = {
    media: 'fa-film', downloads: 'fa-download', networking: 'fa-sitemap', monitoring: 'fa-heartbeat',
    mail: 'fa-envelope', productivity: 'fa-briefcase', dev: 'fa-code', infrastructure: 'fa-server',
    security: 'fa-shield', [UNSORTED]: 'fa-inbox',
  };
  const groupIcon = (key, chosen = {}) => own(chosen, key) || own(GROUP_ICONS, key) || 'fa-folder';

  // The picker's choices.
  const ICON_CHOICES = [
    'fa-film', 'fa-music', 'fa-play-circle', 'fa-television', 'fa-camera', 'fa-picture-o', 'fa-book', 'fa-headphones',
    'fa-download', 'fa-cloud-download', 'fa-magnet', 'fa-exchange', 'fa-sitemap', 'fa-globe', 'fa-wifi', 'fa-random',
    'fa-heartbeat', 'fa-line-chart', 'fa-bar-chart', 'fa-tachometer', 'fa-bell', 'fa-eye', 'fa-envelope', 'fa-inbox',
    'fa-paper-plane', 'fa-comments', 'fa-briefcase', 'fa-calendar', 'fa-tasks', 'fa-sticky-note', 'fa-file-text', 'fa-code',
    'fa-terminal', 'fa-git', 'fa-bug', 'fa-flask', 'fa-cogs', 'fa-wrench', 'fa-server', 'fa-database',
    'fa-hdd-o', 'fa-cubes', 'fa-cube', 'fa-archive', 'fa-shield', 'fa-lock', 'fa-key', 'fa-user-secret',
    'fa-home', 'fa-lightbulb-o', 'fa-plug', 'fa-gamepad', 'fa-shopping-cart', 'fa-money', 'fa-users', 'fa-rss',
    'fa-folder', 'fa-star', 'fa-heart', 'fa-bolt', 'fa-rocket', 'fa-leaf',
  ];

  // Which containers an action from a group/stack menu applies to, split the
  // way include/actions.php runs them: compose stacks by project ->
  // services (docker compose, depends_on order), the rest by name.
  const ACTION_APPLIES = {
    start: (c) => !c.running,
    stop: (c) => c.running,
    restart: (c) => c.running && !c.paused,
    pause: (c) => c.running && !c.paused,
    unpause: (c) => c.paused,
  };
  function actionPlan(cts, action) {
    const pick = cts.filter(ACTION_APPLIES[action]);
    const stacks = Object.create(null), containers = [];
    for (const c of pick) {
      if (c.stack && c.service) (stacks[c.stack] = stacks[c.stack] || []).includes(c.service) || stacks[c.stack].push(c.service);
      else containers.push(c.name);
    }
    return {stacks: {...stacks}, containers, names: pick.map((c) => c.name)};
  }

  // A header's icon + name: one element that opens its actions menu, like a
  // container's icon. The inline onclick runs before the click reaches
  // document, where Unraid's context menu listens - the order the native
  // container icons rely on.
  const menuButton = (id, title, inner) =>
    `<span class='cv-menu-icon' id='${id}' role='button' tabindex='0' title="${esc(title)}" onclick="cvHeaderMenu(this)">${inner}</span>`;

  // Group headers: chevron + title, stats on the right. Stack headers look
  // like a container row: icon, name + chevron, a running line, stats right.
  // hasStacks: a group header gets the expand/collapse-its-stacks toggle.
  // icon: a group's fa-icon, or a stack's chosen service (stackIcon).
  function headerRow(kind, index, group, stack, title, cts, tr, hasStacks = false, icon = '', badge = '') {
    const attrs = ` data-cv-group='${esc(group)}'` + (stack ? ` data-cv-stack='${esc(stack)}'` : '');
    // Stacks already say "N of M running" under their name; no second count.
    const count = kind === 'stack' ? '' : `<span class='cv-count'>${countText(cts, null, tr)}</span>`;
    const stats = `<span class='cv-stats'>${count}<span class='advanced cv-load'></span>` +
      (hasStacks ? `<i class='fa fa-angle-double-down cv-stacks' role='button' tabindex='0' title="${esc(tr('Expand/collapse stacks'))}"></i>` : '') + `</span>`;
    const open = `<tr class='cv-${kind}'${attrs} data-cv-h='${index}'><td colspan='10'><div class='cv-hd'>`;
    // The chevron is the header's button (role/tabindex: keyboard focus, and
    // the one place link-hint extensions like Vimium put the hint); a click
    // anywhere on the row still toggles it.
    const chev = `<i class='fa fa-chevron-down cv-chev' role='button' tabindex='0' aria-expanded='true' title="${esc(tr('Expand/collapse'))}"></i>`;
    if (kind !== 'stack') {
      const menu = menuButton(`cv-hi-${index}`, tr('Group actions'),
        `<span class='cv-group-icon'><i class='fa ${esc(icon || groupIcon(group))}'></i></span><span class='cv-title'>${esc(title)}</span>`);
      return `${open}${chev}${menu}${stats}</div></td></tr>`;
    }
    const running = cts.filter((c) => c.running).length;
    const state = running === cts.length ? 'fa-play green-text' : running ? 'fa-play orange-text' : 'fa-square red-text';
    const menu = menuButton(`cv-hi-${index}`, tr('Stack actions'), `<span class='cv-stack-icon'>${stackIcon(stack, cts, icon)}${badge}</span>` +
      `<span class='cv-stack-name'><span class='cv-title'>${esc(title)}</span><br>` +
      `<i class='fa ${state}'></i><span class='cv-state'>${running} ${tr('of')} ${cts.length} ${tr('running')}</span></span>`);
    return `${open}${menu}${chev}${stats}</div></td></tr>`;
  }

  // opts: {tr, readmore, place: selected category chip keys}
  // -> {html, headers: [{cts}] by data-cv-h index}
  function render(data, opts = {}) {
    const tr = opts.tr || identity;
    const headers = [];
    if (!data.containers.length && !data.orphans.length) {
      return {html: `<tr><td colspan='7' style='text-align:center;padding-top:12px'>${tr('No Docker containers installed')}</td></tr>`, headers};
    }
    const titles = catTitles(data.containers, tr);
    // Rule badges: a real element (with the rule as its tooltip) on stack
    // icons; on container rows only a data-cv-rule attribute, drawn by CSS,
    // since the row markup itself must stay native.
    const rules = data.rules || [];
    const badgeAttr = ruleBadgeAttr;
    const badgeEl = (b) => ruleBadgeEl(b, rules, tr);
    const row = (ct, group, attrs) =>
      containerRow(ct, opts, attrs, catKeys(ct).filter((k) => k !== group && k !== UNSORTED).map((k) => titles.get(k)));
    const header = (kind, group, stack, title, cts, hasStacks) => {
      headers.push({cts, kind, group, stack});
      const icon = kind === 'stack' ? own(data.stackIcons, stack) : groupIcon(group, data.groupIcons || {});
      return headerRow(kind, headers.length - 1, group, stack, title, cts, tr, hasStacks, icon, kind === 'stack' ? badgeEl(ruleBadge(cts)) : '');
    };
    let html = '';
    for (const g of buildGroups(data.containers, tr, opts.place)) {
      const gAttr = ` data-cv-group='${esc(g.key)}'`;
      const segs = segments(g);
      html += header('group', g.key, '', g.title, g.cts, segs.some((seg) => seg.stack));
      for (const seg of segs) {
        if (seg.ct) { html += row(seg.ct, g.key, gAttr + badgeAttr(ruleBadge([seg.ct]))); continue; }
        html += header('stack', g.key, seg.stack, seg.stack, seg.cts);
        for (const ct of seg.cts) html += row(ct, g.key, `${gAttr} data-cv-stack='${esc(seg.stack)}'`);
      }
    }
    if (data.orphans.length) {
      html += `<tr class='advanced cv-group' data-cv-group='${ORPHANS}'><td colspan='10'>` +
        `<i class='fa fa-chevron-down cv-chev' role='button' tabindex='0' aria-expanded='true' title="${esc(tr('Expand/collapse'))}"></i>` +
        `<span class='cv-title'>${tr('Orphan images')}</span><span class='cv-count'>${data.orphans.length}</span></td></tr>`;
      html += data.orphans.map((img) => orphanRow(img, opts)).join('');
    }
    return {html, headers};
  }

  // --- updates ------------------------------------------------------------------
  // Of some containers (e.g. the filtered ones): those with an update ready
  // that Unraid's updater (update_container, template recreate) can update,
  // and those it can't - compose-managed, updated with their stack.
  function updatePlan(cts) {
    const ready = cts.filter((c) => c.update === 1);
    return {
      names: ready.filter((c) => c.manager === 'dockerman').map((c) => c.name),
      skipped: ready.filter((c) => c.manager !== 'dockerman').map((c) => c.name),
    };
  }

  // --- dashboard tile --------------------------------------------------------
  // The Dashboard's Docker tile, grouped like the tab: ids (the tile's icons,
  // native order) -> [{key, title, items}], groups A->Z with Unsorted last;
  // items are {id} or, for 2+ members of a compose stack in the group, one
  // {stack, ids} where its first member sits. containers: applyRules output;
  // ids it doesn't know (added since it was fetched) go to Unsorted. place:
  // selected category chips, as for buildGroups.
  function dashPlan(containers, ids, tr = identity, place = []) {
    const byId = new Map(containers.map((ct) => [ct.id, ct]));
    const known = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
    const groups = buildGroups(known, tr, place).map((g) => ({key: g.key, title: g.title,
      items: segments(g).map((seg) => (seg.ct ? {id: seg.ct.id} : {stack: seg.stack, ids: seg.cts.map((ct) => ct.id)}))}));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) {
      let un = groups.find((g) => g.key === UNSORTED);
      if (!un) groups.push(un = {key: UNSORTED, title: tr('Unsorted'), items: []});
      un.items.push(...unknown.map((id) => ({id})));
    }
    return groups;
  }

  // --- collapsing: groups default open, stacks default closed ---------------
  // state: {'g:<group>': bool, 's:<group>/<stack>': bool}; stack undefined
  // means "the group itself".

  const collapseKey = (group, stack) => (stack === undefined ? 'g:' + group : `s:${group}/${stack}`);

  function isCollapsed(state, group, stack) {
    return state[collapseKey(group, stack)] ?? (stack !== undefined);
  }

  // row: {kind: 'group'|'stack'|'row', group, stack}
  function rowHidden(state, row) {
    if (row.kind === 'group') return false;
    if (row.kind === 'stack') return isCollapsed(state, row.group);
    return isCollapsed(state, row.group) || (row.stack !== undefined && isCollapsed(state, row.group, row.stack));
  }

  // --- search & filters ----------------------------------------------------
  // filter: {text, cats: [group keys, UNSORTED included], mode: 'any'|'all',
  //          states: ['running'|'paused'|'stopped'], update: bool}
  // Kinds of filter AND together; category chips combine by mode; state
  // chips OR among themselves; search words must all appear (case-insensitive)
  // in name, image, stack, categories, ports, IPs or networks.

  // Exclusive states for the state chips: a paused container is not "running".
  const stateOf = (ct) => (ct.paused ? 'paused' : ct.running ? 'running' : 'stopped');

  // Counts for the state chips, within the rest of the filter (categories,
  // text, and Update ready / the selected state): each state's count is what
  // picking that state would list (states are pick-one), Update ready's what
  // turning it on would. No filter: plain totals.
  function stateCounts(containers, f = null) {
    const g = f || emptyFilter();
    const count = (h) => containers.filter((ct) => matches(ct, h)).length;
    const n = {};
    for (const st of ['running', 'paused', 'stopped']) n[st] = count({...g, states: [st]});
    n.update = count({...g, update: true});
    return n;
  }

  const emptyFilter = () => ({text: '', cats: [], mode: 'any', states: [], update: false});
  const filterActive = (f) => !!(f.text.trim() || f.cats.length || f.states.length || f.update);
  const words = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);

  function haystack(ct) {
    return [ct.name, ct.image, ct.stack, ...ct.categories, ...ct.portsInternal, ...ct.portsExternal, ...ct.ips, ...ct.networks]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function matches(ct, f) {
    const hay = haystack(ct);
    if (!words(f.text).every((w) => hay.includes(w))) return false;
    if (f.cats.length) {
      const mine = ct.categories.length ? ct.categories.map((c) => c.toLowerCase()) : [UNSORTED];
      const has = (k) => mine.includes(k);
      if (f.mode === 'all' ? !f.cats.every(has) : !f.cats.some(has)) return false;
    }
    if (f.states.length && !f.states.includes(stateOf(ct))) return false;
    if (f.update && ct.update !== 1) return false;
    return true;
  }

  // Orphan images only answer to search text (by id or tag), never to chips.
  function orphanMatches(img, f) {
    if (f.cats.length || f.states.length || f.update) return false;
    const hay = [img.id, ...img.tags].join(' ').toLowerCase();
    return words(f.text).every((w) => hay.includes(w));
  }

  // -> Set of matching container/image ids, or null when no filter is active.
  function matchSet(data, f) {
    if (!filterActive(f)) return null;
    const ids = new Set();
    for (const ct of data.containers) if (matches(ct, f)) ids.add(ct.id);
    for (const img of data.orphans) if (orphanMatches(img, f)) ids.add(img.id);
    return ids;
  }

  // rows: tbody rows as {kind, group, stack, id} in DOM order -> per row
  // {hidden, closed} (closed = a header's chevron state).
  // No filter: the saved collapse state. With a filter: only matching rows
  // and the headers above them show, opened regardless of the saved state -
  // unless closed in temp, which holds header clicks made during this filter
  // (the page clears it whenever the filter changes). A group or stack that
  // stops matching hides again on the next pass; clearing the filter brings
  // the saved state back. groups (a Set of group keys, or null) limits which
  // groups may show at all: with category chips selected, a match only shows
  // under the selected categories, not in its other groups.
  function layout(rows, state, matchIds, temp = {}, groups = null) {
    if (!matchIds) {
      return rows.map((r) => ({
        hidden: rowHidden(state, r),
        closed: r.kind !== 'row' && isCollapsed(state, r.group, r.kind === 'stack' ? r.stack : undefined),
      }));
    }
    const shows = (r) => matchIds.has(r.id) && (!groups || groups.has(r.group));
    const hit = new Set();
    for (const r of rows) {
      if (r.kind !== 'row' || !shows(r)) continue;
      hit.add(collapseKey(r.group));
      if (r.stack !== undefined) hit.add(collapseKey(r.group, r.stack));
    }
    const closed = (g, st) => temp[collapseKey(g, st)] ?? false;
    return rows.map((r) => {
      if (r.kind === 'group') return {hidden: !hit.has(collapseKey(r.group)), closed: closed(r.group)};
      if (r.kind === 'stack') return {hidden: !hit.has(collapseKey(r.group, r.stack)) || closed(r.group), closed: closed(r.group, r.stack)};
      return {hidden: !shows(r) || closed(r.group) || (r.stack !== undefined && closed(r.group, r.stack)), closed: false};
    });
  }

  // Chip list: every category A->Z, Unsorted last (if any). count is every
  // container carrying it - or, given a filter in All mode, how many would be
  // listed with that category added to the selection (text and state chips
  // included; a selected chip shows the current result).
  function categoryChips(containers, tr = identity, f = null) {
    const titles = catTitles(containers, tr);
    const counts = new Map();
    for (const ct of containers) for (const k of catKeys(ct)) counts.set(k, (counts.get(k) || 0) + 1);
    if (f && f.mode === 'all') {
      for (const key of counts.keys()) {
        const withKey = {...f, cats: f.cats.includes(key) ? f.cats : [...f.cats, key]};
        counts.set(key, containers.filter((ct) => matches(ct, withKey)).length);
      }
    }
    return [...counts].map(([key, count]) => ({key, title: titles.get(key), count}))
      .sort((a, b) => (a.key === UNSORTED) - (b.key === UNSORTED) || a.title.localeCompare(b.title));
  }

  // Collapsible headers among rows ({kind, group, stack}): every group and
  // stack, or with group given, just that group's stacks. stack is
  // undefined for a group, matching collapseKey/isCollapsed.
  function headerKeys(rows, group) {
    return rows
      .filter((r) => (group === undefined ? r.kind !== 'row' : r.kind === 'stack' && r.group === group))
      .map((r) => {
        const stack = r.kind === 'stack' ? r.stack : undefined;
        return {key: collapseKey(r.group, stack), group: r.group, stack};
      });
  }

  // --- drag rules ----------------------------------------------------------
  // rows: every tbody row as {kind, group, stack}, in DOM order after the
  // drop; i: the dropped row. A row may only land inside its own group, and
  // a stack member only inside its own stack block; a standalone row must
  // not split a stack block.

  function dropAllowed(rows, i) {
    const {group, stack} = rows[i];
    let ok = false;
    for (let j = i - 1; j >= 0; j--) {
      const prev = rows[j];
      if (prev.group !== group) break;
      if (stack !== undefined) {
        if (prev.kind === 'stack') { ok = prev.stack === stack; break; }
        if (prev.stack !== stack) break;
      } else if (prev.kind === 'group') {
        ok = true;
        break;
      }
    }
    const next = rows[i + 1];
    if (ok && stack === undefined && next && next.group === group && next.kind === 'row' && next.stack !== undefined) ok = false;
    return ok;
  }

  // UserPrefs.php keeps ONE global order (which also sets autostart order).
  // A group's new order is written back into the global positions its members
  // already held; everyone else stays put.
  function reorder(order, groupIdsInNewOrder) {
    const byId = Object.fromEntries(order.map((ct) => [ct.id, ct]));
    const slots = order.map((ct, i) => (groupIdsInNewOrder.includes(ct.id) ? i : -1)).filter((i) => i >= 0);
    const next = order.slice();
    slots.forEach((slot, k) => { next[slot] = byId[groupIdsInNewOrder[k]]; });
    return next;
  }

  // Same body UserPrefs.php expects from the native drag handler.
  const prefsBody = (order) => ({
    names: order.map((ct) => ct.name).join(';') + ';',
    index: order.map((ct, i) => i).join(';') + ';',
  });

  // --- load sums, fed by the native dockerload channel ----------------------

  function bytes(s) {
    const m = /([\d.]+)\s*([KMGT]?)(i?)B/i.exec(s || '');
    if (!m) return 0;
    return parseFloat(m[1]) * Math.pow(m[3] ? 1024 : 1000, {'': 0, K: 1, M: 2, G: 3, T: 4}[m[2].toUpperCase()]);
  }

  const fmtBytes = (b, decimal = '.') =>
    (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GiB' : Math.round(b / 1048576) + ' MiB').replace('.', decimal);

  // One dockerload line: "id;cpu%;used / limit" -> {id, cpu (% of all CPUs), mem (bytes)}.
  function parseLoad(line, cpuCount) {
    const [id, cpu, mem] = line.split(';');
    return {id, cpu: Math.min(cpu.slice(0, -1) / cpuCount, 100), mem: bytes((mem || '').split('/')[0])};
  }

  // -> {cpu, mem} summed over ids, or null when none have reported yet.
  function sumLoad(ids, stats) {
    let cpu = 0, mem = 0, any = false;
    for (const id of ids) {
      const st = stats[id];
      if (st) { cpu += st.cpu; mem += st.mem; any = true; }
    }
    return any ? {cpu, mem} : null;
  }

  return {
    UNSORTED, ORPHANS, esc, slashes, titleCase, iconHtml, own,
    containerRow, orphanRow, stackIcon, groupIcon, ICON_CHOICES, actionPlan, catKeys, homeOf, buildGroups, segments, render, countText,
    emptyFilter, filterActive, stateOf, stateCounts, matches, orphanMatches, matchSet, layout, categoryChips,
    collapseKey, isCollapsed, rowHidden, headerKeys, dropAllowed, reorder, prefsBody,
    bytes, fmtBytes, parseLoad, sumLoad,
    globMatch, ruleMatches, ruleText, applyRules, ruleBadge, ruleBadgeAttr, ruleBadgeEl, dashPlan, updatePlan,
  };
});
