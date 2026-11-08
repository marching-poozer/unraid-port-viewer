// Container View: replaces the rendering of the native Docker Containers list.
//
// The native page fetches finished HTML rows from DockerContainers.php inside
// a global loadlist(), and every native action (start/stop/update/remove,
// Start All, Check for Updates...) refreshes by calling loadlist() by name.
// We redefine loadlist(), listview() and LockButton() before the native
// $(ready) handler first calls them, so the native rows are never fetched or
// drawn: our loadlist() pulls JSON from include/containers.php and renders
// rows (containerview-core.js) into the same <tbody id="docker_list">,
// inside the native table.
//
// Compatibility rule: each container row is byte-for-byte the native markup,
// because other plugins read the rows (see the core). Rows are grouped by the
// net.unraid.docker.category label (comma-separated, case-insensitive;
// unlabelled -> Unsorted), with compose stacks as blocks; each container
// shows once, its other categories as tags. Group and stack header rows are
// extra <tr>s without .sortable, so anything scanning tr.sortable sees
// exactly the native rows; native rows only gain data-cv-* attributes, the
// tags span and, after render, a cv-collapsed class.
//
// A sticky bar above the table (filter text, category/state chips, Any/All) filters
// the rows in place; core.layout() decides what shows.
//
// Two native behaviours are intentionally not reproduced, because they are
// what freezes the tab on window resize: calling readmore() on the
// span.docker_readmore cells (its resize handler clones/measures every
// truncated cell per resize tick, see proxyhosts.js) and the optional
// fixed-height resize() that re-measures every cell. The spans keep their
// class; long ones collapse with our own toggle, decided by line count, with
// no layout reads at all.
(function () {
  const core = window.ContainerViewCore;
  if (!core || !document.getElementById('docker_list') || typeof window.loadlist !== 'function') return;

  const CFG = window.CV_CONFIG || {};
  const tr = (s) => (typeof window._ === 'function' ? window._(s) : s);

  // Turned off in the cog (settings.enabled 'no'): leave Unraid's own list
  // alone and only add the cog, whose one item turns Container View back on.
  if ((CFG.settings || {}).enabled === 'no') {
    window.cvSettingsMenu = (el) => window.ContainerViewMenus.openMenu(el, [enabledItem(false)]);
    addCog();
    return;
  }
  const FEED = '/plugins/containerview/include/containers.php';
  const STORE = 'containerview.collapse';
  const FILTER_STORE = 'containerview.filter'; // chips + mode; search text is not kept
  const opts = {tr, readmore: CFG.readmore};

  let headers = [];      // rendered group/stack headers ({cts, ids, el, count})
  let rawData = null;    // last feed as served (label categories only)
  let lastData = null;   // rawData with category rules applied; re-rendered locally after a drag
  const stats = {};      // container id -> {cpu, mem}, from dockerload
  let collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { /* private window etc. */ }
  let filter = core.emptyFilter();
  try { filter = {...filter, ...JSON.parse(localStorage.getItem(FILTER_STORE)), text: ''}; } catch (e) { /* defaults */ }
  filter.states = filter.states.slice(0, 1); // stored before states became pick-one
  let temp = {};         // header clicks made while a filter is active; reset when it changes

  // tbody rows as the core's {kind, group, stack, id} descriptors.
  const describe = (row) => ({
    kind: row.classList.contains('cv-group') ? 'group' : row.classList.contains('cv-stack') ? 'stack' : 'row',
    group: row.dataset.cvGroup,
    stack: row.dataset.cvStack,
    id: row.dataset.cvCt,
  });

  // Collapse state and filter -> row visibility, chevrons, header counts and
  // the bar's "showing X of Y".
  function applyView() {
    if (!lastData) return;
    const matchIds = core.matchSet(lastData, filter);
    const rows = [...document.querySelectorAll('#docker_list tr[data-cv-group]')];
    const groups = filter.cats.length ? new Set(filter.cats) : null;
    core.layout(rows.map(describe), collapsed, matchIds, temp, groups).forEach((v, i) => {
      rows[i].classList.toggle('cv-collapsed', v.hidden);
      const chev = rows[i].querySelector('.cv-chev');
      if (chev) {
        chev.classList.toggle('cv-closed', v.closed);
        chev.setAttribute('aria-expanded', String(!v.closed));
      }
      // A closed group's stacks toggle would act on rows you can't see.
      const stacks = rows[i].querySelector('.cv-stacks');
      if (stacks) stacks.classList.toggle('cv-off', v.closed);
    });
    headers.forEach((h) => { if (h.count) h.count.innerHTML = core.countText(h.cts, matchIds, tr); });
    $('#cv-count').html(core.countText(lastData.containers, matchIds, tr));
    $('#cv-clear').toggle(core.filterActive(filter));
    // Each toggle offers "expand" while anything it covers is closed.
    const all = rows.map(describe);
    const allOpen = !core.headerKeys(all).some(isClosed);
    $('#cv-bar .cv-all').toggleClass('fa-angle-double-down', !allOpen).toggleClass('fa-angle-double-up', allOpen);
    $('#docker_list tr.cv-group .cv-stacks').each(function () {
      const open = !core.headerKeys(all, $(this).closest('tr')[0].dataset.cvGroup).some(isClosed);
      $(this).toggleClass('fa-angle-double-down', !open).toggleClass('fa-angle-double-up', open);
    });
    // Rows shown/hidden and chips redrawn: the bar's height and which header
    // is pinned may have changed without any scroll.
    queueLayout();
  }

  // --- expand / collapse all --------------------------------------------------
  // While filtering these act on the filter's temporary state, like header
  // clicks; otherwise on the saved state.
  const isClosed = (h) => (core.filterActive(filter) ? (temp[h.key] ?? false) : core.isCollapsed(collapsed, h.group, h.stack));
  const headerRows = () => [...document.querySelectorAll('#docker_list tr.cv-group, #docker_list tr.cv-stack')].map(describe);

  function setClosed(hs, value) {
    const filtering = core.filterActive(filter);
    for (const h of hs) (filtering ? temp : collapsed)[h.key] = value;
    if (!filtering) {
      try { localStorage.setItem(STORE, JSON.stringify(collapsed)); } catch (e) { /* not persisted */ }
    }
    applyView();
  }

  // --- the filter bar --------------------------------------------------------
  // The update button (right end of the state row): update the shown containers that have
  // an update ready, picked in a dialog (menus.updatePicker).
  const menusUpdateButton = () => `<span class='cv-upd' role='button' tabindex='0' title="${core.esc(tr('Update the listed containers…'))}">` +
    `<i class='fa fa-cloud-download'></i><span class='cv-upd-n'></span></span>`;
  const shown = () => (lastData ? lastData.containers.filter((ct) => core.matches(ct, filter)) : []);
  // Chips are spans with role/tabindex: keyboard-focusable and visible to
  // link-hint extensions (Vimium), without Unraid's heavy <button> styling.
  const chip = (attrs, label) => `<span class='cv-chip' role='button' tabindex='0' aria-pressed='false' ${attrs}>${label}</span>`;

  // Two rows: chips (Any/All | state | categories), then filter text + count.
  // Rows: Any/All | categories; filter text + Clear; then, under a divider,
  // the container-state chips with count + expand-all on the right. The
  // alignment setting moves every row's content and Unraid's buttons; the
  // count stays right.
  const $bar = $(`<div id='cv-bar'><div class='cv-row'>` +
    `<span class='cv-mode' title="${core.esc(tr('How selected categories combine'))}">${chip("data-mode='any'", tr('Any'))}${chip("data-mode='all'", tr('All'))}</span>` +
    `<span id='cv-cats' class='cv-chips cv-sep'></span></div>` +
    `<div class='cv-row'><label for='cv-filter' title="${core.esc(tr('Press / to filter'))}">${tr('Filter')}:</label>` +
    `<input type='text' id='cv-filter' placeholder="${core.esc(tr('name, image, stack, port, IP'))}" autocomplete='off'>` +
    `<span class='cv-chip' id='cv-clear' role='button' tabindex='0'>${tr('Clear')}</span></div>` +
    `<div class='cv-row cv-states-row'><span id='cv-states' class='cv-chips'></span>` +
    `<span id='cv-shown'><span id='cv-count'></span><span class='advanced cv-load' id='cv-total-load'></span>` +
    `<i class='fa fa-angle-double-down cv-all' role='button' tabindex='0' title="${core.esc(tr('Expand/collapse all'))}"></i>${menusUpdateButton()}</span></div></div>`);
  $('#docker_containers').before($bar);

  // --- settings (cog right of Basic/Advanced View) ----------------------------
  // buttons: where Unraid's own row (Add Container, Start All, ...) sits -
  // 'bottom' (native, under the table) or 'top' (above the filter bar, with a
  // divider; it scrolls away, the bar stays pinned). The inputs keep their
  // inline handlers and native code finds them by selector, so moving them
  // into a wrapper is safe.
  const SETTINGS_API = '/plugins/containerview/include/settings.php';
  const settings = {buttons: 'bottom', align: 'left', precedence: 'labels', ...(CFG.settings || {})};
  const $actions = $("<div id='cv-actions'></div>").append($('#docker_containers').nextAll('input[type=button]'));
  function applySettings() {
    if (settings.buttons === 'top') $actions.addClass('cv-top').insertBefore($bar);
    else $actions.removeClass('cv-top').insertAfter('#docker_containers');
    const align = ['left', 'center', 'right'].map((a) => `cv-align-${a}`).join(' ');
    $bar.add($actions).removeClass(align).addClass(`cv-align-${settings.align}`);
  }
  applySettings();

  window.cvSettingsMenu = function (el) {
    const choose = (key, value) => (e) => {
      e.preventDefault();
      $.post(SETTINGS_API, {[key]: value, csrf_token: CFG.csrf}, null, 'json')
        .done((res) => {
          Object.assign(settings, res.settings);
          applySettings();
          if (key === 'precedence' && lastData) { reclassify(); draw(lastData); }
        })
        .fail((xhr) => swal({title: tr('Settings'), text: (xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText, type: 'error'}));
    };
    const tick = (on) => (on ? 'fa-check' : 'fa-fw');
    // One submenu per setting, so more can sit alongside.
    window.ContainerViewMenus.openMenu(el, [
      enabledItem(true),
      {divider: true},
      {text: tr('Unraid buttons'), icon: 'fa-th-large', subMenu: [
        {text: tr('At top'), icon: tick(settings.buttons === 'top'), action: choose('buttons', 'top')},
        {text: tr('At bottom'), icon: tick(settings.buttons === 'bottom'), action: choose('buttons', 'bottom')},
      ]},
      {text: tr('Alignment'), icon: 'fa-align-left', subMenu: [
        {text: tr('Left'), icon: tick(settings.align === 'left'), action: choose('align', 'left')},
        {text: tr('Centered'), icon: tick(settings.align === 'center'), action: choose('align', 'center')},
        {text: tr('Right'), icon: tick(settings.align === 'right'), action: choose('align', 'right')},
      ]},
      {divider: true},
      {text: tr('Category precedence'), icon: 'fa-sort-amount-desc', subMenu: [
        {text: tr('Labels win'), icon: tick(settings.precedence === 'labels'), action: choose('precedence', 'labels')},
        {text: tr('Rules win'), icon: tick(settings.precedence === 'rules'), action: choose('precedence', 'rules')},
      ]},
      {text: `${tr('Category rules')}…`, icon: 'fa-list-ol', action: (e) => { e.preventDefault(); listRules(); }},
    ]);
  };
  // "Enabled": off puts back Unraid's own Docker list and Dashboard tile.
  // Taking over the list only works as the page loads, so it saves and reloads.
  function enabledItem(on) {
    return {text: tr('Enabled'), icon: on ? 'fa-toggle-on' : 'fa-toggle-off', action: (e) => {
      e.preventDefault();
      $.post('/plugins/containerview/include/settings.php', {enabled: on ? 'no' : 'yes', csrf_token: CFG.csrf}, null, 'json')
        .done(() => location.reload())
        .fail((xhr) => swal({title: tr('Settings'), text: (xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText, type: 'error'}));
    }};
  }
  // After the native ready handler has added the Basic/Advanced switch. The
  // switch plugin floats its label/slider and closes them with an empty
  // clearing <div>; the cog goes just before that div, floated with them, so
  // it sits on their line.
  function addCog() { $(() => {
    const cog = `<span class='cv-cog' id='cv-cog' role='button' tabindex='0' ` +
      `title="${core.esc(tr('Container View settings'))}" onclick="cvSettingsMenu(this)"><i class='fa fa-cog'></i></span>`;
    const $parts = $('.advancedview').siblings('.switch-button-label, .switch-button-background');
    const $clear = $parts.last().nextAll('div:not([class])').first();
    if ($clear.length) $clear.before(cog);
    else if ($parts.length) $parts.last().after(cog);
    else $('.tabs .status').first().append(cog);
  }); }
  addCog();

  // Stick below Unraid's top menu: in the black/white themes div#menu turns
  // position:fixed at top:0 once the page scrolls past the header (see
  // DefaultPageLayout.php), so the bar has to sit its height lower. In the
  // azure/gray themes the menu is a narrow sidebar and the bar sits at 0.
  //
  // Also publish the visible content width (the bar's - it never grows with
  // the table) as --cv-vw: when rows make the table wider than the window,
  // header rows size to it instead of the table, so their right-aligned
  // stats stay on screen. Measured after each render too: while the page is
  // still loading the tab isn't shown yet and the bar measures 0, which is
  // ignored (headers then fall back to the table width).
  let layoutQueued = false;
  function fitToWindow() {
    layoutQueued = false;
    const menu = document.getElementById('menu');
    const wide = menu && menu.getBoundingClientRect().width > window.innerWidth / 2;
    const top = wide ? menu.offsetHeight : 0;
    $bar.css('top', top);
    const table = document.getElementById('docker_containers');
    const width = $bar[0].clientWidth;
    if (width > 0) table.style.setProperty('--cv-vw', `${width}px`);
    // Sticky headers pin just under the bar - tucked 2px under it (the bar is
    // on top), as offsetHeight rounds and a gap would show the list behind.
    const barH = $bar[0].getBoundingClientRect().height;
    if (barH > 0) table.style.setProperty('--cv-sticky-top', `${top + barH - 2}px`);
    pinHeaders();
  }

  // Sticky headers, worked out on scroll: the current group's row pins just
  // under the bar, and an open stack's row under it, only while their own
  // rows are passing - then the last row pushes them up and out. (Plain CSS
  // sticky can't do this in a table: a sticky row stays stuck to the end of
  // the table, so every earlier header piles up under the current one.)
  let pinQueued = false;
  const rowsOf = (sel) => [...document.querySelectorAll(sel)].filter((r) => !r.classList.contains('cv-collapsed') && r.offsetParent !== null);
  // Pins header at the line, pushed up so it never goes past its last row's
  // bottom - except at the very end of the page, where scrolling can't finish
  // the push: a header part-way out is left unpinned (its own place is then
  // under the bar) rather than stuck half visible. Returns its pinned top,
  // or null.
  function pin(header, line, last) {
    const top = Math.min(line, last.getBoundingClientRect().bottom - header.offsetHeight);
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2; // fractional under zoom
    if (top < line && atEnd) return null;
    header.style.setProperty('--cv-pin-top', `${top}px`);
    header.classList.add('cv-pinned');
    return top;
  }
  function pinHeaders() {
    pinQueued = false;
    const css = getComputedStyle(document.getElementById('docker_containers'));
    const barLine = parseFloat(css.getPropertyValue('--cv-sticky-top'));
    let group = null, stack = null;
    if (!Number.isNaN(barLine)) {
      // The current group: its header's own place is above the line and its
      // last row still below it.
      for (const row of rowsOf('#docker_list tr.cv-group')) {
        const g = CSS.escape(row.dataset.cvGroup);
        const rows = rowsOf(`#docker_list tr[data-cv-group="${g}"]:not(.cv-group)`);
        if (!rows.length) continue;
        const h = row.offsetHeight;
        if (rows[0].getBoundingClientRect().top - h < barLine && rows[rows.length - 1].getBoundingClientRect().bottom > barLine) {
          const top = pin(row, barLine, rows[rows.length - 1]);
          if (top === null) break;
          group = row;
          // Its open stack whose members are passing under the group header,
          // tucked 2px under it: offsetHeight rounds and leaves out the
          // table's row spacing, which showed as a hairline of the list.
          const line = top + row.getBoundingClientRect().height - 2;
          for (const st of rowsOf(`#docker_list tr.cv-stack[data-cv-group="${g}"]`)) {
            const members = rowsOf(`#docker_list tr.sortable[data-cv-group="${g}"][data-cv-stack="${CSS.escape(st.dataset.cvStack)}"]`);
            if (!members.length) continue;
            const sh = st.offsetHeight;
            if (members[0].getBoundingClientRect().top - sh < line && members[members.length - 1].getBoundingClientRect().bottom > line) {
              if (pin(st, line, members[members.length - 1]) !== null) stack = st;
              break;
            }
          }
          break;
        }
      }
    }
    document.querySelectorAll('#docker_list tr.cv-pinned').forEach((r) => { if (r !== group && r !== stack) r.classList.remove('cv-pinned'); });
  }
  window.addEventListener('scroll', () => { if (!pinQueued) { pinQueued = true; requestAnimationFrame(pinHeaders); } }, {passive: true});
  fitToWindow();
  function queueLayout() { if (!layoutQueued) { layoutQueued = true; requestAnimationFrame(fitToWindow); } }
  window.addEventListener('resize', queueLayout);
  function drawChips() {
    const chips = core.categoryChips(lastData ? lastData.containers : [], tr, filter);
    // Keep a selected category visible even if no container carries it any more.
    for (const key of filter.cats) if (!chips.some((c) => c.key === key)) chips.push({key, title: key === core.UNSORTED ? tr('Unsorted') : core.titleCase(key), count: 0});
    $('#cv-cats').html(chips.map((c) => chip(`data-cat='${core.esc(c.key)}'`, `${core.esc(c.title)} <small>${c.count}</small>`)).join(''));
    // State chips with counts, like the categories' (states are exclusive:
    // a paused container is not counted as running).
    const n = core.stateCounts(lastData ? lastData.containers : [], filter);
    $('#cv-states').html(
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
    const upd = core.updatePlan(shown()).names.length;
    $bar.find('.cv-upd').toggle(upd > 0).find('.cv-upd-n').text(upd);
  }

  function setFilter(change) {
    filter = {...filter, ...change};
    temp = {};
    try {
      const {text, ...kept} = filter;
      localStorage.setItem(FILTER_STORE, JSON.stringify(kept));
    } catch (e) { /* not persisted */ }
    // Selected categories decide where containers render, so a chip change
    // needs a fresh render; everything else only changes visibility.
    if ('cats' in change && lastData) { draw(lastData); return; }
    drawChips();
    applyView();
  }

  // Bar handlers hang off document for the same reason as the list's (below).
  const toggled = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  $(document).on('input', '#cv-bar #cv-filter', function () { setFilter({text: this.value}); });
  $(document).on('keydown', '#cv-bar #cv-filter', function (e) { if (e.key === 'Escape') { this.value = ''; setFilter({text: ''}); } });
  $(document).on('click', '#cv-bar [data-cat]', function () { setFilter({cats: toggled(filter.cats, this.dataset.cat)}); });
  $(document).on('click', '#cv-bar [data-mode]', function () { setFilter({mode: this.dataset.mode}); });
  $(document).on('click', '#cv-bar [data-state]', function () { setFilter({states: filter.states[0] === this.dataset.state ? [] : [this.dataset.state]}); });
  $(document).on('click', '#cv-bar [data-update]', function () { setFilter({update: !filter.update}); });
  $(document).on('click', '#cv-bar .cv-all', function () {
    const hs = core.headerKeys(headerRows());
    setClosed(hs, !hs.some(isClosed));
  });
  // Enter / Space on our role=button controls act like a click.
  $(document).on('keydown', '#cv-bar [role=button], #docker_list [role=button], #cv-cog', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    // A real click at the control's centre: the inline onclick of the header
    // icons runs, and Unraid's context menu (positioned from the click) opens
    // in the right place.
    const r = this.getBoundingClientRect();
    this.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2}));
  });
  // "/" jumps to the filter box, unless already typing somewhere.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !$bar.is(':visible')) return;
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    $('#cv-filter').trigger('focus').trigger('select');
  });
  $(document).on('click', '#cv-bar .cv-upd', () => menus.updatePicker(shown(), core.filterActive(filter) ? tr('the filter') : ''));
  $(document).on('click', '#cv-bar #cv-clear', function () { $('#cv-filter').val(''); setFilter(core.emptyFilter()); });

  const loadText = (sum) => (sum
    ? `${tr('CPU')} ${(Math.round(sum.cpu * 100) / 100 + '%').replace('.', CFG.decimal || '.')} · ${tr('Memory')} ${core.fmtBytes(sum.mem, CFG.decimal)}`
    : '');

  function updateHeaderLoad() {
    for (const h of headers) {
      if (!h.el) continue;
      h.el.textContent = loadText(core.sumLoad(h.ids, stats));
    }
    if (lastData) $('#cv-total-load').text(loadText(core.sumLoad(lastData.containers.map((ct) => ct.id), stats)));
  }

  function draw(data) {
    const out = core.render(data, {...opts, place: filter.cats});
    headers = out.headers;
    $('.TS_tooltip').tooltipster('destroy');
    $('#docker_list').html(out.html);
    $('.TS_tooltip').tooltipster({
      animation: 'fade', delay: 200, trigger: 'custom',
      triggerOpen: {click: true, touchstart: true, mouseenter: true},
      triggerClose: {click: true, scroll: false, mouseleave: true},
      interactive: true, viewportAware: true, contentAsHTML: true,
      functionBefore: (instance, helper) => instance.content($(helper.origin).attr('data-tstitle')),
    });
    $('#docker_list .autostart').switchButton({labels_placement: 'right', on_label: tr('On'), off_label: tr('Off')});
    if ($.cookie('docker_listview_mode') === 'advanced') { $('.advanced').show(); $('.basic').hide(); }
    if ($.cookie('lockbutton') != null) { $('i.mover').show(); $('#docker_list .sortable').css({cursor: 'move'}); }
    window.listview();
    headers.forEach((h, i) => {
      const row = document.querySelector(`#docker_list tr[data-cv-h="${i}"]`);
      h.el = row && row.querySelector('.cv-load');
      h.count = row && row.querySelector('.cv-count');
      h.ids = h.cts.map((c) => c.id);
    });
    drawChips();
    applyView();
    updateHeaderLoad();
    fitToWindow();
  }

  // --- drag reorder: native LockButton(), but rows only move within their own
  // group/stack (core.dropAllowed), and the save covers the whole list.
  function dropped(e, ui) {
    const rows = [...document.getElementById('docker_list').children];
    const i = rows.indexOf(ui.item[0]);
    if (!lastData || !core.dropAllowed(rows.map(describe), i)) { $(this).sortable('cancel'); return; }
    const g = rows[i].dataset.cvGroup;
    const ids = [];
    for (const r of rows) if (r.classList.contains('sortable') && r.dataset.cvGroup === g && !ids.includes(r.dataset.cvCt)) ids.push(r.dataset.cvCt);
    lastData.containers = core.reorder(lastData.containers, ids);
    rawData.containers = core.reorder(rawData.containers, ids);
    $.post('/plugins/dynamix.docker.manager/include/UserPrefs.php', core.prefsBody(lastData.containers));
    draw(lastData);
  }

  window.LockButton = function () {
    const nav = $('div.nav-item.LockButton');
    if ($.cookie('lockbutton') == null) {
      $.cookie('lockbutton', 'lockbutton');
      $('#resetsort').removeClass('nohand').addClass('hand');
      $('i.mover').show();
      $('#docker_list .sortable').css({cursor: 'move'});
      nav.find('a').prop('title', tr('Lock sortable items'));
      nav.find('b').removeClass('icon-u-lock green-text').addClass('icon-u-lock-open red-text');
      nav.find('span').text(tr('Lock sortable items'));
      $('#docker_list').sortable({helper: 'clone', items: 'tr.sortable', cursor: 'grab', axis: 'y', containment: 'parent',
        cancel: 'span.docker_readmore,input', delay: 100, opacity: 0.5, zIndex: 9999, forcePlaceholderSize: true, stop: dropped});
    } else {
      $.removeCookie('lockbutton');
      $('#resetsort').removeClass('hand').addClass('nohand');
      $('i.mover').hide();
      $('#docker_list .sortable').css({cursor: 'default'});
      nav.find('a').prop('title', tr('Unlock sortable items'));
      nav.find('b').removeClass('icon-u-lock-open red-text').addClass('icon-u-lock green-text');
      nav.find('span').text(tr('Unlock sortable items'));
      $('#docker_list').sortable('destroy');
    }
  };

  // Native listview(), minus readmore: show each autostart row's wait box
  // only in Advanced view.
  window.listview = function () {
    queueLayout(); // Basic/Advanced changes row heights
    const more = $.cookie('docker_listview_mode') === 'advanced';
    $('#docker_list input.autostart').each(function () {
      $(this).closest('td').find('input.wait').parent().toggle(more && $(this).prop('checked'));
    });
  };

  // Refreshes can overlap (actions, Unraid's banner callbacks, the busy
  // poll): only the newest response is drawn, and there is one follow-up
  // poll at a time.
  let loadSeq = 0;
  let pollTimer = null;
  window.loadlist = function () {
    const seq = ++loadSeq;
    clearTimeout(timers.docker);
    clearTimeout(pollTimer);
    timers.docker = setTimeout(() => $('div.spinner.fixed').show('slow'), 500);
    const poll = (ms) => { clearTimeout(pollTimer); pollTimer = setTimeout(window.loadlist, ms); };
    $.getJSON(FEED, (data) => {
      if (seq !== loadSeq) return;
      clearTimeout(timers.docker);
      docker = data.containers.map((ct) => ({name: ct.name, id: ct.id, state: ct.running, pause: ct.paused, update: ct.update}));
      // docker stats stops reporting stopped containers; drop their last
      // reading so group/total sums don't keep it.
      for (const ct of data.containers) if (!ct.running) delete stats[ct.id];
      rawData = data;
      reclassify();
      draw(lastData);
      $('input[type=button]').prop('disabled', false).show('slow');
      $('div.spinner.fixed').hide('slow');

      if (data.busy) { $('#busy').show(); poll(5000); }
      else if ($('#busy').is(':visible')) { $('#busy').hide(); poll(3000); }
      if (!docker.some((ct) => ct.update == 1)) $('input#updateAll').prop('disabled', true);
      if (docker.some((ct) => ct.update == 2)) rebuildAll();
    }).fail(() => {
      if (seq !== loadSeq) return;
      clearTimeout(timers.docker);
      $('div.spinner.fixed').hide('slow');
      $('#docker_list').html(`<tr><td colspan='10' style='text-align:center;padding-top:12px' class='red-text'>Container View: could not load the container list.</td></tr>`);
    });
  };

  // --- group / stack icon menus ------------------------------------------------
  // Clicking a group's or stack's icon opens Unraid's own context menu
  // (context.js, as for a container icon) with Start/Stop/Restart/Pause/
  // Resume for its containers; a group's also has Update all and Change icon.
  // Items only appear when they'd affect something. include/actions.php runs
  // stacks through docker compose (depends_on order), the rest per container.

  // lastData = rawData with the rules applied. Saved icons/rules go into
  // rawData too, and a drag's new order is kept, so this can rerun any time.
  function reclassify() {
    lastData = {...rawData, containers: core.applyRules(rawData.containers, rawData.rules || [], settings.precedence)};
  }

  const menus = window.ContainerViewMenus({
    csrf: CFG.csrf, settings,
    raw: () => rawData,
    data: () => lastData,
    rulesSaved: (saved) => { rawData.rules = saved; reclassify(); draw(lastData); },
    iconsSaved: (icons) => { Object.assign(rawData, icons); reclassify(); draw(lastData); },
  });
  const {listRules} = menus;
  menus.wrapContainerMenu();

  window.cvHeaderMenu = function (el) {
    const tr_ = el.closest('tr');
    const h = headers[Number(tr_.dataset.cvH)];
    if (!h) return;
    const scope = h.kind === 'stack' ? h.stack : (lastData && core.categoryChips(lastData.containers, tr).find((c) => c.key === h.group) || {title: h.group}).title;
    const opts = h.kind === 'group' ? menus.groupMenuItems(h.cts, h.group, scope) : menus.actionItems(h.cts, scope);
    if (h.kind === 'stack') opts.push(...menus.stackRuleItems(h.cts, h.stack, opts.length > 0));
    menus.openMenu(el, opts);
  };

  // Delegated from document (scoped by selector), so they survive every
  // re-render - and, unlike listeners on the bar or tbody, don't make
  // link-hint extensions (Vimium C hints any element with a click listener)
  // put a second hint on those big containers.
  $(document).on('click', '#docker_list .cv-stacks', function (e) {
    e.stopPropagation(); // not the group's own open/close
    const hs = core.headerKeys(headerRows(), $(this).closest('tr')[0].dataset.cvGroup);
    setClosed(hs, !hs.some(isClosed));
  });
  $(document).on('click', '#docker_list tr.cv-group, #docker_list tr.cv-stack', function (e) {
    if ($(e.target).closest('.cv-menu-icon').length) return; // icon + name open its menu instead
    const d = describe(this);
    const key = core.collapseKey(d.group, d.kind === 'stack' ? d.stack : undefined);
    if (core.filterActive(filter)) {
      // Only for this filter; the saved state is untouched.
      temp[key] = !(temp[key] ?? false);
    } else {
      collapsed[key] = !core.isCollapsed(collapsed, d.group, d.kind === 'stack' ? d.stack : undefined);
      try { localStorage.setItem(STORE, JSON.stringify(collapsed)); } catch (e) { /* not persisted */ }
    }
    applyView();
  });
  $(document).on('click', '#docker_list .cv-more', function (e) {
    e.preventDefault();
    const open = $(this).prev('.cv-clamp').toggleClass('cv-open').hasClass('cv-open');
    $(this).find('i').toggleClass('fa-chevron-down', !open).toggleClass('fa-chevron-up', open);
  });
  $(document).on('change', '#docker_list input.autostart', function () {
    const more = $.cookie('docker_listview_mode') === 'advanced';
    const wait = $(this).closest('td').find('input.wait');
    const auto = $(this).prop('checked');
    wait.parent().toggle(auto && more);
    $.post('/plugins/dynamix.docker.manager/include/UpdateConfig.php', {action: 'autostart', container: $(this).attr('container'), auto: auto, wait: wait.val()});
  });
  $(document).on('change', '#docker_list input.wait', function () {
    $.post('/plugins/dynamix.docker.manager/include/UpdateConfig.php', {action: 'wait', container: $(this).attr('container'), wait: $(this).val()});
  });

  // The native load handler updates each row; keep per-container numbers for
  // the group/stack header sums.
  if (typeof dockerload !== 'undefined' && CFG.cpuCount) {
    dockerload.on('message', (msg) => {
      for (const line of msg.split('\n')) {
        if (!line) continue;
        const load = core.parseLoad(line, CFG.cpuCount);
        stats[load.id] = load;
      }
      updateHeaderLoad();
    });
  }
})();
