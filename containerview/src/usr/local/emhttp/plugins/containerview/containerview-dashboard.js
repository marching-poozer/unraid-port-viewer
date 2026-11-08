// Container View on the Dashboard: groups the Docker Containers tile by
// category (labels + rules, as on the Docker tab), A->Z with Unsorted last.
//
// The native dashboard posts to DashboardApps.php and appends a
// <tr class='updated'> holding one span.outer.apps per container - on load
// and after every action (its own loadlist()). Those spans are left exactly as
// they are (their inline onclick opens Unraid's container menu, the
// "started only" switch toggles span.apps.stopped, the counts are read from
// them); we only move them into a section per category, each under a
// collapsible heading. Collapse state is shared with the Docker tab.
//
// A compose stack with 2+ members in a group shows as one icon instead: the
// stack's icon and name and "N of M running", opening the same stack menu as
// on the Docker tab. Its members' spans move into a hidden holder (so the
// native counts and toggles still find them); the stack icon has no 'apps'
// class, so nothing native counts it, and with "started only" it hides only
// when every member is stopped.
//
// A filter row under the tile's header (text, Any/All + category chips,
// state chips) works like the Docker tab's bar but remembers its own chips.
// Selected categories decide which section a container sits in (as on the
// tab); non-matches get .cv-dash-out. While a filter is on, sections show
// open, and heading clicks only last until the filter changes.
(function () {
  const core = window.ContainerViewCore;
  if (!core || !window.ContainerViewMenus) return;

  const CFG = window.CV_CONFIG || {};
  const FEED = '/plugins/containerview/include/containers.php';
  const STORE = 'containerview.collapse';
  const FILTER_STORE = 'containerview.dashfilter'; // chips + mode; text is not kept
  const tr = (s) => (typeof window._ === 'function' ? window._(s) : s);
  const settings = {precedence: 'labels', ...(CFG.settings || {})};

  let raw = null;        // containers.php as served
  let feed = null;       // raw with the rules applied
  let stacks = [];       // rendered stack icons: {stack, cts}, by cv-ds-N index
  let groups = [];       // rendered sections: {key, title, cts}, by cv-dg-N index
  let scrollTop = 0;     // the sections' scroll position, kept across regroups
  // scroll doesn't bubble: listen in the capture phase.
  document.addEventListener('scroll', (e) => {
    if (e.target.classList && e.target.classList.contains('cv-dash-scroll')) scrollTop = e.target.scrollTop;
  }, true);
  const native = new WeakMap(); // tile <td> -> its native spans, in native order
  let filter = core.emptyFilter();
  try { filter = {...filter, ...JSON.parse(localStorage.getItem(FILTER_STORE)), text: ''}; } catch (e) { /* defaults */ }
  filter.states = filter.states.slice(0, 1); // stored before states became pick-one
  let temp = {};         // heading clicks made while a filter is on

  const menus = window.ContainerViewMenus({
    csrf: CFG.csrf, settings,
    raw: () => raw,
    data: () => feed,
    // Native reload -> our observer refetches and regroups.
    rulesSaved: () => window.loadlist(),
    iconsSaved: () => window.loadlist(),
  });

  const loadCollapsed = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } };
  function saveCollapsed(key, value) {
    const state = loadCollapsed();
    state[key] = value;
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private window etc. */ }
  }

  function useFeed(data) {
    raw = data;
    feed = {...data, containers: core.applyRules(data.containers, data.rules || [], settings.precedence)};
  }

  const startedOnly = () => $('#apps').is(':checked');

  // "Started only": stack icons hide when all their members are stopped;
  // sections hide when nothing in them is left showing.
  // The filter: .cv-dash-out on non-matching icons (a stack's when no member
  // matches), and each heading's count over the matches.
  function updateVisibility() {
    const on = core.filterActive(filter);
    const byId = feed ? new Map(feed.containers.map((c) => [c.id, c])) : new Map();
    const hit = (id) => !on || (byId.has(id) && core.matches(byId.get(id), filter));
    $('#docker_view .cv-dash-body > span.outer.apps').each(function () { this.classList.toggle('cv-dash-out', !hit(this.querySelector('span.hand').id)); });
    $('#docker_view .cv-dash-stack').each(function () {
      const st = stacks[Number(this.querySelector('span.hand').id.slice('cv-ds-'.length))];
      this.classList.toggle('cv-dash-out', !!st && !st.cts.some((c) => c && hit(c.id)));
      this.style.display = startedOnly() && this.classList.contains('stopped') ? 'none' : '';
    });
    const saved = loadCollapsed();
    $('#docker_view .cv-dash-group').each(function () {
      // Open/closed: while filtering, open unless clicked shut since the last
      // filter change; otherwise the saved (tab-shared) state.
      const key = this.dataset.cvKey;
      setClosed(this, on ? (temp[key] ?? false) : core.isCollapsed(saved, key.slice(2)));
      const icons = [...this.querySelectorAll('.cv-dash-body > span.outer')];
      const shown = (el) => el.style.display !== 'none' && !el.classList.contains('cv-dash-out');
      this.classList.toggle('cv-dash-empty', icons.length > 0 && !icons.some(shown));
      const cts = JSON.parse(this.dataset.cvIds).map((id) => byId.get(id)).filter(Boolean);
      const matchIds = on ? new Set(cts.filter((c) => hit(c.id)).map((c) => c.id)) : null;
      $(this).find('.cv-dash-count').text(core.countText(cts, matchIds, tr));
    });
    updateAllIcon();
  }

  function stackIcon(st, cts, spans) {
    const running = spans.filter((s) => !s.classList.contains('stopped')).length;
    const status = running ? 'started' : 'stopped';
    const state = running === spans.length ? 'fa-play green-text' : running ? 'fa-play orange-text' : 'fa-square red-text';
    stacks.push({stack: st, cts});
    const el = document.createElement('span');
    el.className = `outer solid cv-dash-stack ${status}`;
    el.innerHTML = `<span id='cv-ds-${stacks.length - 1}' class='hand' role='button' tabindex='0' title="${core.esc(tr('Stack actions'))}" ` +
      `onclick='cvDashStackMenu(this)'>${core.stackIcon(st, cts, core.own(feed.stackIcons, st))}` +
      `${core.ruleBadgeEl(core.ruleBadge(cts.filter(Boolean)), feed.rules || [], tr)}</span>` +
      `<span class='inner'><span title="${core.esc(st)}">${core.esc(st)}</span><br><i class='fa ${state}'></i>` +
      `<span class='state'>${running} ${tr('of')} ${spans.length} ${tr('running')}</span></span>`;
    return el;
  }

  // (Re)build td's sections from its native spans - on each native reload,
  // and when the selected categories change (they decide the sections).
  function group(td) {
    // Unraid may have replaced the tile while the feed was loading.
    if (!td.isConnected) return;
    if (!native.has(td)) native.set(td, [...td.querySelectorAll(':scope > span.outer.apps')]);
    const spans = native.get(td);
    if (!spans.length || !feed) return;
    const old = [...td.querySelectorAll(':scope > .cv-dash-scroll')];
    // Sections scroll inside the tile (max 50% of the window), headings
    // pinned at the top of that area while their section is in view.
    const scroller = document.createElement('div');
    scroller.className = 'cv-dash-scroll';

    const ids = spans.map((s) => s.querySelector('span.hand').id);
    const byId = new Map(spans.map((s, i) => [ids[i], s]));
    const ctById = new Map(feed.containers.map((c) => [c.id, c]));
    const collapsed = loadCollapsed();
    const frag = document.createDocumentFragment();
    stacks = [];
    groups = [];
    for (const g of core.dashPlan(feed.containers, ids, tr, filter.cats)) {
      const key = core.collapseKey(g.key);
      const closed = core.filterActive(filter) ? (temp[key] ?? false) : core.isCollapsed(collapsed, g.key);
      const all = g.items.flatMap((it) => (it.stack ? it.ids : [it.id])).map((id) => byId.get(id));
      const running = all.filter((s) => !s.classList.contains('stopped')).length;
      const sec = document.createElement('div');
      sec.className = 'cv-dash-group' + (closed ? ' cv-dash-closed' : '');
      sec.dataset.cvKey = key;
      sec.dataset.cvIds = JSON.stringify(g.items.flatMap((it) => (it.stack ? it.ids : [it.id])));
      const cts = all.map((s) => ctById.get(s.querySelector('span.hand').id)).filter(Boolean);
      groups.push({key: g.key, title: g.title, cts});
      // As on the tab: the chevron is the heading's button (a click anywhere
      // else on it toggles too); icon + name open the group's menu.
      sec.innerHTML = `<div class='cv-dash-hd'>` +
        `<i class='fa fa-chevron-down cv-chev${closed ? ' cv-closed' : ''}' role='button' tabindex='0' aria-expanded='${!closed}' title="${core.esc(tr('Expand/collapse'))}"></i>` +
        `<span class='cv-menu-icon' id='cv-dg-${groups.length - 1}' role='button' tabindex='0' title="${core.esc(tr('Group actions'))}" onclick='cvDashGroupMenu(this)'>` +
        `<i class='fa ${core.esc(core.groupIcon(g.key, feed.groupIcons || {}))} cv-dash-icon'></i>` +
        `<span class='cv-dash-title'>${core.esc(g.title)}</span></span>` +
        `<span class='cv-dash-count'>${running}/${all.length} ${tr('running')}</span></div>` +
        `<div class='cv-dash-body'></div><div class='cv-dash-members' hidden></div>`;
      const [body, members] = [sec.children[1], sec.children[2]];
      for (const it of g.items) {
        if (!it.stack) {
          // Rule badge: an attribute on the native icon, drawn by CSS.
          const span = byId.get(it.id), ct = ctById.get(it.id), b = ct && core.ruleBadge([ct]);
          if (b) span.dataset.cvRule = b.on ? 'on' : 'off'; else delete span.dataset.cvRule;
          // Full name on hover, as the CSS may cut it short.
          const name = span.querySelector('span.inner > span');
          if (name && !name.title) name.title = name.textContent;
          body.appendChild(span);
          continue;
        }
        const ms = it.ids.map((id) => byId.get(id));
        body.appendChild(stackIcon(it.stack, it.ids.map((id) => ctById.get(id)), ms));
        for (const s of ms) members.appendChild(s);
      }
      frag.appendChild(sec);
    }
    scroller.appendChild(frag);
    td.insertBefore(scroller, td.firstChild);
    old.forEach((el) => el.remove());
    // Sticky headings need an opaque background: the tile's own, whatever the
    // theme - the first ancestor that isn't transparent.
    for (let el = td; el && el !== document.documentElement; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) { scroller.style.setProperty('--cv-dash-bg', bg); break; }
    }
    drawChips();
    updateVisibility();
    // Keep the scroll position across regroups (filter changes, and Unraid's
    // reloads, which replace the whole tile row) - after hiding empty
    // sections, which would otherwise clamp it.
    scroller.scrollTop = scrollTop;
  }

  // --- filter row ---------------------------------------------------------------
  const chip = (attrs, label) => `<span class='cv-chip' role='button' tabindex='0' aria-pressed='false' ${attrs}>${label}</span>`;
  // Laid out like the tab's bar: Any/All | categories; Filter: text + Clear;
  // then, under a divider, the state chips. Follows the tab's Alignment setting.
  const align = ['left', 'center', 'right'].includes(settings.align) ? settings.align : 'left';
  const $bar = $(`<tr class='cv-dash-filter-row'><td><div class='cv-dash-bar cv-align-${align}'>` +
    `<div class='cv-row'><span class='cv-mode' title="${core.esc(tr('How selected categories combine'))}">${chip("data-mode='any'", tr('Any'))}${chip("data-mode='all'", tr('All'))}</span>` +
    `<span class='cv-chips cv-sep cv-dash-cats'></span></div>` +
    `<div class='cv-row'><label>${tr('Filter')}:</label>` +
    `<input type='text' class='cv-dash-text' placeholder="${core.esc(tr('name, image, stack, port, IP'))}" autocomplete='off'>` +
    `<span class='cv-chip cv-dash-clear' role='button' tabindex='0'>${tr('Clear')}</span></div>` +
    `<div class='cv-row cv-dash-states-row'><span class='cv-chips cv-dash-states'></span>` +
    `<span class='cv-dash-right'><i class='fa fa-angle-double-down cv-all' role='button' tabindex='0' title="${core.esc(tr('Expand/collapse all'))}"></i>` +
    `<span class='cv-upd' role='button' tabindex='0' title="${core.esc(tr('Update the listed containers…'))}"><i class='fa fa-cloud-download'></i><span class='cv-upd-n'></span></span></span></div></div></td></tr>`);

  function drawChips() {
    const cts = feed ? feed.containers : [];
    const chips = core.categoryChips(cts, tr, filter);
    for (const key of filter.cats) if (!chips.some((c) => c.key === key)) chips.push({key, title: key === core.UNSORTED ? tr('Unsorted') : core.titleCase(key), count: 0});
    $bar.find('.cv-dash-cats').html(chips.map((c) => chip(`data-cat='${core.esc(c.key)}'`, `${core.esc(c.title)} <small>${c.count}</small>`)).join(''));
    const n = core.stateCounts(cts, filter);
    $bar.find('.cv-dash-states').html(
      // One state at a time, as a segmented control (click the selected one again to clear).
      `<span class='cv-mode' title="${core.esc(tr('Container state'))}">` +
      chip("data-state='running'", `${tr('Running')} <small>${n.running}</small>`) +
      chip("data-state='paused'", `${tr('Paused')} <small>${n.paused}</small>`) +
      chip("data-state='stopped'", `${tr('Stopped')} <small>${n.stopped}</small>`) + `</span>` +
      chip("data-update='1'", `${tr('Update ready')} <small>${n.update}</small>`));
    const on = ($el, yes) => $el.toggleClass('cv-on', yes).attr('aria-pressed', String(yes));
    $bar.find('[data-cat]').each(function () { on($(this), filter.cats.includes(this.dataset.cat)); });
    $bar.find('[data-mode]').each(function () { on($(this), this.dataset.mode === filter.mode); });
    $bar.find('[data-state]').each(function () { on($(this), filter.states.includes(this.dataset.state)); });
    on($bar.find('[data-update]'), filter.update);
    $bar.find('.cv-dash-clear').toggle(core.filterActive(filter));
    const upd = core.updatePlan(shown()).names.length;
    $bar.find('.cv-upd').toggle(upd > 0).find('.cv-upd-n').text(upd);
  }
  const shown = () => (feed ? feed.containers.filter((ct) => core.matches(ct, filter)) : []);

  function setFilter(change) {
    filter = {...filter, ...change};
    temp = {};
    try {
      const {text, ...kept} = filter;
      localStorage.setItem(FILTER_STORE, JSON.stringify(kept));
    } catch (e) { /* not persisted */ }
    // Sections open/close by the filter, and categories move containers: rebuild.
    document.querySelectorAll('#docker_view tr.updated > td').forEach(group);
    drawChips();
    updateVisibility();
  }
  const toggled = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  window.cvDashStackMenu = function (el) {
    const st = stacks[Number(el.id.slice('cv-ds-'.length))];
    if (!st) return;
    const opts = menus.actionItems(st.cts, st.stack);
    opts.push(...menus.stackRuleItems(st.cts, st.stack, opts.length > 0));
    menus.openMenu(el, opts);
  };

  window.cvDashGroupMenu = function (el) {
    const g = groups[Number(el.id.slice('cv-dg-'.length))];
    if (g) menus.openMenu(el, menus.groupMenuItems(g.cts, g.key, g.title));
  };

  function setClosed(sec, closed) {
    const hd = sec.querySelector('.cv-dash-hd');
    sec.classList.toggle('cv-dash-closed', closed);
    const chev = hd.querySelector('.cv-chev');
    chev.classList.toggle('cv-closed', closed);
    chev.setAttribute('aria-expanded', String(!closed));
  }

  // A section opened/closed by the user: remembered (tab-shared), or while
  // filtering only until the filter changes.
  function setUserClosed(sec, closed) {
    setClosed(sec, closed);
    if (core.filterActive(filter)) temp[sec.dataset.cvKey] = closed;
    else saveCollapsed(sec.dataset.cvKey, closed);
  }
  function toggle(hd) {
    const sec = hd.parentNode;
    setUserClosed(sec, !sec.classList.contains('cv-dash-closed'));
    updateAllIcon();
  }

  // Expand/collapse all (as on the tab): opens every shown section if any is
  // closed, else closes them all. Its icon says what a click will do.
  const shownSections = () => [...document.querySelectorAll('#docker_view .cv-dash-group:not(.cv-dash-empty)')];
  function updateAllIcon() {
    const allOpen = !shownSections().some((sec) => sec.classList.contains('cv-dash-closed'));
    $bar.find('.cv-all').toggleClass('fa-angle-double-down', !allOpen).toggleClass('fa-angle-double-up', allOpen);
  }
  function toggleAll() {
    const secs = shownSections();
    const close = !secs.some((sec) => sec.classList.contains('cv-dash-closed'));
    for (const sec of secs) setUserClosed(sec, close);
    updateAllIcon();
  }

  $(() => {
    const view = document.getElementById('docker_view');
    if (!view) return;
    $(view).children('tr').first().after($bar);
    drawChips();
    const setText = (text) => { filter.text = text; temp = {}; drawChips(); updateVisibility(); };
    $bar.on('input', '.cv-dash-text', function () { setText(this.value); });
    $bar.on('keydown', '.cv-dash-text', function (e) { if (e.key === 'Escape') { this.value = ''; setText(''); } });
    $bar.on('click', '[data-cat]', function () { setFilter({cats: toggled(filter.cats, this.dataset.cat)}); });
    $bar.on('click', '[data-mode]', function () { setFilter({mode: this.dataset.mode}); });
    $bar.on('click', '[data-state]', function () { setFilter({states: filter.states[0] === this.dataset.state ? [] : [this.dataset.state]}); });
    $bar.on('click', '[data-update]', function () { setFilter({update: !filter.update}); });
    $bar.on('click', '.cv-all', toggleAll);
    $bar.on('click', '.cv-upd', () => menus.updatePicker(shown(), core.filterActive(filter) ? tr('the filter') : ''));
    $bar.on('click', '.cv-dash-clear', function () { $bar.find('.cv-dash-text').val(''); setFilter(core.emptyFilter()); });
    $bar.on('keydown', '.cv-chip, .cv-upd, .cv-all', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); } });
    // Each native (re)load: fetch the categories and states again, then group.
    // Only the newest fetch groups (an older one finishing late would group
    // with stale states).
    let seq = 0;
    const regroup = () => {
      const tds = [...view.querySelectorAll('tr.updated > td')].filter((td) => !td.querySelector(':scope > .cv-dash-scroll'));
      if (!tds.length) return;
      const mine = ++seq;
      $.getJSON(FEED).then((data) => {
        if (mine !== seq) return;
        useFeed(data);
        tds.forEach(group);
      });
    };
    new MutationObserver(regroup).observe(view, {childList: true});
    regroup();
    // Native toggles stopped icons with a 'fast' (200ms) animation.
    $(document).on('change', '#apps', () => setTimeout(updateVisibility, 300));
    // docker.js (Unraid's container menu) loads with the dashboard, after us.
    menus.wrapContainerMenu();
    $(document).on('click', '#docker_view .cv-dash-hd', function (e) {
      if (!$(e.target).closest('.cv-menu-icon').length) toggle(this);
    });
    $(document).on('keydown', '#docker_view .cv-dash-hd .cv-chev, #docker_view .cv-dash-hd .cv-menu-icon, #docker_view .cv-dash-stack .hand', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (this.classList.contains('cv-chev')) { toggle(this.parentNode); return; }
      // Unraid's context menu opens on a real click at the pointer position.
      const r = this.getBoundingClientRect();
      this.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2}));
    });
  });
})();
