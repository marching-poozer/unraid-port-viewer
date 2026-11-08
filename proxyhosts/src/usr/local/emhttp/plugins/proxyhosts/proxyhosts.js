// Runs on Unraid's native Docker page via the ProxyHostsDocker.page hook
// (Menu="Docker" merges this script into the real /Docker page). This is a
// port of the "NPM Proxy Helper" browser extension's content.js: the
// table-scraping and popover logic is unchanged, but every NPM/Pi-hole call
// is now same-origin PHP (include/proxyhosts.php) instead of a background
// service worker, so there's no CORS/mixed-content workaround needed and no
// per-browser settings - everyone hitting this WebGUI shares one config.

// Works around a long-standing Unraid core bug, not anything of ours: the
// shared dynamix.js bundles an ancient readmore.js whose window resize
// handler does, for every .readmore-js-section on the page (and the Docker
// Containers table can have hundreds with enough containers): clone the
// element, insert the clone into the live DOM, force a synchronous layout
// read via outerHeight(), then remove it - with no debouncing at all. A
// window-resize drag fires dozens of native 'resize' events per second,
// each one re-running that clone/insert/measure/remove pass over every
// truncated cell, which is exactly what freezes the tab for several
// seconds (reproducible with this plugin, and Folder View, both fully
// disabled - confirmed not our bug, but worth fixing from here since
// nothing else on this page will).
//
// We can't touch dynamix.js itself (Unraid would overwrite it on the next
// update), and racing it with a capture-phase listener doesn't reliably
// work either: resize is dispatched directly at window with no ancestor
// chain, so same-target listeners run in plain registration order
// regardless of capture - and dynamix.js's handler is bound long before
// ours loads.
//
// A per-drag pause/resume (rename the class away during the drag, rename it
// back and let one real resize through once it settles) was tried first,
// but confirmed via Chrome's own Task Manager to still peg the tab's CPU
// near 120% indefinitely - the "let one real resize through" step is itself
// a full clone/insert/measure/remove pass over every truncated cell, and if
// the user adjusts the window again before that pass finishes, further
// native resize events queue up behind it, each demanding another full
// pass once the previous one completes. That can snowball indefinitely
// rather than settle.
//
// Far simpler and verifiably bounded: let dynamix.js's handler run exactly
// ONCE (the very first resize event after page load - same cost as what
// already happens once on initial load, so nothing new there), then
// permanently rename every .readmore-js-section away so that handler's
// selector matches nothing ever again, on this page load. The one
// permanent cost: readmore's truncation height stops adjusting to further
// resizes - a minor cosmetic trade next to a tab that can peg a CPU core
// indefinitely.
(function () {
  const REAL = 'readmore-js-section';
  const PAUSED = 'ph-readmore-paused';
  let neutralized = false;

  window.addEventListener('resize', () => {
    if (neutralized) return;
    neutralized = true;
    // dynamix.js's own listener is registered before ours (it loads
    // earlier in the page) and therefore already ran its one acceptable
    // pass for this very event by the time we get here - nothing left to
    // let through, just disable it for every tick after this one.
    document.querySelectorAll('.' + REAL).forEach((el) => {
      el.classList.replace(REAL, PAUSED);
    });
  });
})();

(function () {
  const API = '/plugins/proxyhosts/include/proxyhosts.php';
  const CSRF = window.PH_CSRF_TOKEN || '';

  // POST as a real form field, not JSON: Unraid's own auto_prepend_file
  // rejects any POST whose csrf_token isn't in $_POST before our PHP even
  // runs, so the token (and the rest of the payload, JSON-encoded inside
  // the 'data' field) has to travel that way instead.
  async function api(action, body) {
    const opts = body
      ? { method: 'POST', body: new URLSearchParams({ csrf_token: CSRF, data: JSON.stringify(body) }) }
      : { method: 'GET' };
    const res = await fetch(API + '?action=' + encodeURIComponent(action), opts);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error((data && data.error) || 'HTTP ' + res.status);
    return data;
  }

  // --- helpers (unchanged from the extension) -----------------------------

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  }

  function bestCertFor(domain, certs) {
    let exact = null;
    let wildcard = null;
    const d = domain.toLowerCase();
    for (const c of certs) {
      for (const name of c.domain_names || []) {
        const n = name.toLowerCase();
        if (n === d) {
          exact = c;
        } else if (n.startsWith('*.')) {
          const suffix = n.slice(1);
          if (d.endsWith(suffix)) {
            const remainder = d.slice(0, d.length - suffix.length);
            if (remainder && !remainder.includes('.')) wildcard = c;
          }
        }
      }
    }
    return exact || wildcard || null;
  }

  // --- scraping the Docker Containers table ---------------------------
  //
  // Same selectors/approach as the browser-extension version: this is
  // Unraid's own DOM structure, not something this plugin controls, so the
  // already-proven scraping logic carries over as-is. Column indices come
  // from dynamix.docker.manager's own DockerContainers.php: 0 ct-name,
  // 2 Networks, 3 Network IPs, 4 Port(s) (container-internal, always
  // populated even for EXPOSE-only ports), 5 LAN IP:Port (host-published
  // only, empty when nothing is published).

  const rawLineCache = new WeakMap();

  function rawLinesOf(td) {
    if (rawLineCache.has(td)) return rawLineCache.get(td);
    const span = td.querySelector('span.docker_readmore') || td.querySelector('span');
    const lines = span
      ? span.innerHTML
          .split(/<br\s*\/?>/i)
          .map((s) => s.replace(/<[^>]+>/g, '').trim())
          .filter(Boolean)
      : [];
    rawLineCache.set(td, lines);
    return lines;
  }

  function containerName(row) {
    const autoInput = row.querySelector('input.autostart[container]');
    if (autoInput) return autoInput.getAttribute('container');
    const idSpan = row.querySelector('td.ct-name .outer > span[id]');
    const onclick = idSpan ? idSpan.getAttribute('onclick') || '' : '';
    const m = onclick.match(/^addDockerContainerContext\('([^']*)'/);
    if (m) return m[1];
    return row.querySelector('.appname')?.textContent?.trim() || null;
  }

  // One row -> at most one container descriptor, anchored on the name cell
  // (see renderContainerControl) - one proxy host per container, matching
  // how every proxy host in NPM's own database is actually used today (no
  // container currently has two). A descriptor lists every possible target
  // the create dialog can offer:
  //   lanTargets     - host-published ports (deduped by port number - a
  //                    dual-stack IPv4+IPv6 publish shows as two identical
  //                    LAN IP:Port lines for the same port, not two targets).
  //   networkEligible - whether the container sits on the configured shared
  //                    network (e.g. npm_net), making container-name
  //                    forwarding possible regardless of lanTargets.
  function scanRows() {
    const table = document.getElementById('docker_containers');
    const byNameCell = new Map();
    if (!table) return byNameCell;

    // tr.sortable covers a plain, ungrouped Docker page; the Folder View
    // plugin instead renders each actual container as tr.folder-element
    // (folder *header* rows carry neither class combo with real port data,
    // so they're naturally skipped below) - same column layout either way,
    // just two different row wrappers depending on what else is installed.
    // Descendant selector, not direct-child: Folder View reparents each
    // container's real <tr> into a nested div.folder-storage inside its own
    // synthetic tr.folder summary row (confirmed live - roughly half of all
    // containers live there, not as direct children of #docker_list at
    // all), so '>' silently missed every grouped container.
    table.querySelectorAll('#docker_list tr.sortable, #docker_list tr.folder-element').forEach((row) => {
      const cells = row.querySelectorAll(':scope > td');
      if (cells.length < 6) return;
      const name = containerName(row);
      if (!name) return;
      const nameCell = cells[0];

      const lanLines = rawLinesOf(cells[5]);
      const portLines = rawLinesOf(cells[4]);
      const seenPorts = new Set();
      const lanTargets = [];
      lanLines.forEach((lan, i) => {
        const m = lan.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
        if (!m) return;
        const lanPort = parseInt(m[2], 10);
        if (seenPorts.has(lanPort)) return;
        seenPorts.add(lanPort);
        const containerPort = portLines[i] || '';
        lanTargets.push({
          lanIp: m[1],
          lanPort,
          containerPort,
          // Bare port number, for matching an NPM host whose forward_host
          // is the container's own Docker-network name rather than the LAN
          // IP - e.g. forward_host "immich-server-1" when NPM shares a
          // custom network with the target container.
          containerPortNum: (containerPort.match(/^(\d+)/) || [])[1] || '',
        });
      });

      let networkEligible = false;
      if (state.sharedNetwork) {
        const networkLines = rawLinesOf(cells[2]);
        networkEligible = networkLines.includes(state.sharedNetwork);
      }

      // Default for the network-mode (container-name) port field, when
      // unambiguous: a container with exactly one LAN-published port (e.g.
      // immich-server-1 on 2283) almost certainly has that same port as its
      // real app port regardless of which mode is picked, so reuse it
      // rather than making the user retype a number already known. Failing
      // that, fall back to the single distinct port in Unraid's own Port(s)
      // column (cells[4], populated even for EXPOSE-only ports) when
      // there's exactly one candidate there too - a container exposing
      // several ports (e.g. solidtime-app-1's Caddy defaults) stays
      // genuinely ambiguous and is left blank for the user to pick.
      let suggestedPort = '';
      if (lanTargets.length === 1 && lanTargets[0].containerPortNum) {
        suggestedPort = lanTargets[0].containerPortNum;
      } else if (lanTargets.length === 0) {
        const distinctPorts = new Set();
        portLines.forEach((p) => {
          const m = p.match(/^(\d+):/);
          if (m) distinctPorts.add(m[1]);
        });
        if (distinctPorts.size === 1) suggestedPort = [...distinctPorts][0];
      }

      if (lanTargets.length || networkEligible) {
        byNameCell.set(nameCell, { name, lanTargets, networkEligible, network: state.sharedNetwork, suggestedPort });
      }
    });
    return byNameCell;
  }

  // --- state -----------------------------------------------------------
  //
  // One GET returns everything the extension previously had to assemble
  // from chrome.storage + two separate NPM requests.

  let state = { npmConfigured: false, piholeEnabled: false, baseDomain: '', sharedNetwork: '', hosts: [], certificates: [] };
  let proxyHostsByTarget = new Map();
  // Keyed by forward_host alone (any port) - how findHostFor() matches a
  // network-mode target, since it has no fixed port of its own until a host
  // actually exists (the port is typed in at create time, not derived).
  let proxyHostsByName = new Map();

  // Shared by refreshState() and the create/toggle/remove handlers: those
  // already get a confirmed host list back from their own server call (NPM
  // fetched fresh, before any Pi-hole write that could transiently disrupt
  // DNS), so they can update the map directly instead of making their own
  // separate, redundant - and possibly DNS-flaky - action=state round trip.
  function applyHosts(hosts) {
    const byTarget = new Map();
    const byName = new Map();
    for (const h of hosts || []) {
      const host = (h.forward_host || '').toLowerCase();
      byTarget.set(host + ':' + h.forward_port, h);
      byName.set(host, h);
    }
    proxyHostsByTarget = byTarget;
    proxyHostsByName = byName;
  }

  async function refreshState() {
    try {
      state = await api('state');
      applyHosts(state.hosts);
      console.log('[Proxy Hosts] state loaded:', proxyHostsByTarget.size, 'host(s), npmConfigured =', state.npmConfigured);
    } catch (e) {
      console.error('[Proxy Hosts] failed to load state:', e);
    }
  }

  // The one existing proxy host for a container, if any, regardless of
  // which mode created it: checks every LAN target (by LAN IP:port, falling
  // back to name:containerPort for a host that already forwards by name),
  // then falls back to a bare name match for network-mode targets.
  function findHostFor(info) {
    for (const t of info.lanTargets) {
      const key = t.lanIp.toLowerCase() + ':' + t.lanPort;
      const nameKey = t.containerPortNum && info.name.toLowerCase() + ':' + t.containerPortNum;
      const host = proxyHostsByTarget.get(key) || (nameKey && proxyHostsByTarget.get(nameKey));
      if (host) return host;
    }
    if (info.networkEligible) {
      const host = proxyHostsByName.get(info.name.toLowerCase());
      if (host) return host;
    }
    return null;
  }

  // --- rendering -----------------------------------------------------------
  //
  // One single-line row per container, living in one consistent spot: a
  // label (either plain "No Proxy Host" text, or the host's primary domain
  // as a real link) plus one small icon button (+ to add, pencil to edit),
  // appended under the container's name/status inside td.ct-name's own
  // '.outer .inner' span. A plain div we fully own (not Folder View's
  // readmore-managed span), so there's no mutation-feedback-loop risk - but
  // still rendered at most once per name cell, since the MutationObserver
  // re-fires renderAllFromCache() on any row churn; applyProxyStates() does
  // the actual per-refresh label/button updates in place.
  const renderedCells = new WeakSet();

  // Font Awesome is already loaded globally by Unraid's own
  // DefaultPageLayout.php (the native Docker page's own icons - update
  // arrows, check marks, warning triangles - all use it), so reusing it
  // here costs nothing extra and matches the rest of the page's look
  // instead of introducing a separate icon system.
  function faIcon(name) {
    const i = document.createElement('i');
    i.className = 'fa fa-' + name;
    return i;
  }

  function iconButton(name, title, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ph-icon-btn' + (extraClass ? ' ' + extraClass : '');
    btn.title = title;
    btn.appendChild(faIcon(name));
    return btn;
  }

  function hostUrl(host, domain) {
    const scheme = host.ssl_forced || host.certificate_id ? 'https' : 'http';
    return scheme + '://' + domain;
  }

  // The domain shown as the row's label when a host exists: the first
  // active (live-routed) domain, or the first paused one if every domain on
  // the host is paused - never nothing, as long as the host has domains at
  // all. `extra` counts every other domain (active or paused) not shown, so
  // multi-domain hosts (e.g. mailarchive+open-archiver on one host) still
  // fit on one line.
  function primaryDomainFor(host) {
    const active = host.domain_names || [];
    const paused = (host.meta && host.meta.ph_paused_domains) || [];
    const total = active.length + paused.length;
    if (active.length) return { domain: active[0], paused: false, extra: total - 1 };
    if (paused.length) return { domain: paused[0], paused: true, extra: total - 1 };
    return null;
  }

  function renderContainerControl(nameCell, info) {
    if (renderedCells.has(nameCell)) return;
    renderedCells.add(nameCell);
    // Appended as a sibling of .outer, directly in td.ct-name - NOT inside
    // .outer, and NOT inside .inner. Inside .inner was wrong first (Folder
    // View's folder-common.css clips it: ".folder-element .ct-name .inner
    // { overflow: hidden; ... }"). Inside .outer (the first fix) was ALSO
    // wrong, for a different reason confirmed live via an uncaught
    // exception: Folder View's docker.js builds each collapsed folder's own
    // preview strip by literally $(...).clone()-ing the real row's
    // '.outer'/'.inner'/'.appname' spans (e.g. "let clone = $(`...td.ct-name
    // > span.outer:last`).clone()"). cloneNode() copies DOM structure/
    // classes but NOT custom JS properties set directly on an element
    // (row._info etc.), so every such clone becomes a lookalike
    // .ph-proxy-row with no _info - applyProxyStates() crashed trying to
    // read .lanTargets off undefined the instant one of these existed.
    // td.ct-name itself (outside .outer entirely) is never a clone target
    // in Folder View's own code, and carries no overflow/clip rule of its
    // own either (only '.ct-name .inner' does) - clean of both problems.
    const row = document.createElement('div');
    row.className = 'ph-proxy-row';
    row._info = info;
    const label = document.createElement('a');
    label.className = 'ph-proxy-label';
    label.target = '_blank';
    label.rel = 'noopener noreferrer';
    label.addEventListener('click', (e) => {
      if (!label.getAttribute('href')) e.preventDefault();
      e.stopPropagation();
    });
    row._label = label;
    row.appendChild(label);
    const btn = iconButton('plus', 'Add proxy host');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onControlClick(row, info);
    });
    row._btn = btn;
    row.appendChild(btn);
    nameCell.appendChild(row);
    console.log('[Proxy Hosts] inserted control for', info.name);
  }

  // One signature string per row's intended rendered state. applyProxyStates()
  // skips every DOM write (even class toggles) when the signature hasn't
  // changed since its last pass - not an optimization, a correctness
  // requirement: with the MutationObserver watching the full subtree (see
  // watchList()), an unconditional write here - e.g. the old
  // btn.replaceChildren(faIcon(...)) that ran on literally every pass,
  // whether the icon needed to change or not - is itself a childList
  // mutation that re-triggers the observer, which re-runs this function,
  // which writes again... a tight infinite loop (confirmed live: hundreds
  // of fires/sec, no gaps). Folder View's own 'folderobserver' (attached to
  // '.folder-storage span.outer' - exactly the ancestor our control lives
  // under) made this worse by potentially reacting to our writes too.
  function proxySig(state_, info) {
    if (!state_.npmConfigured) return 'unknown';
    const host = findHostFor(info);
    const primary = host && primaryDomainFor(host);
    if (!host || !primary) return 'off';
    return ['host', host.id, host.enabled ? 1 : 0, primary.domain, primary.paused ? 1 : 0, primary.extra].join(':');
  }

  function applyProxyStates() {
    const rows = document.querySelectorAll('.ph-proxy-row');
    let changed = 0;
    rows.forEach((row) => {
      const info = row._info;
      // A row without _info is a clone, not one of our own controls - our
      // custom JS properties (set directly on the element, not as DOM
      // attributes) don't survive cloneNode()/jQuery.clone(), which Folder
      // View's own preview-building code does over '.outer'/'.inner' in
      // some of its own internal flows. Appending outside '.outer' (see
      // renderContainerControl()) should prevent this from happening at
      // all now, but this guard stays as cheap insurance against any other
      // present or future cloning path producing the same shape of bug.
      if (!info) return;
      const sig = proxySig(state, info);
      if (row.dataset.sig === sig) return;
      row.dataset.sig = sig;
      changed++;

      const label = row._label;
      const btn = row._btn;
      row.classList.remove('ph-on', 'ph-off', 'ph-disabled', 'ph-unknown');
      if (!state.npmConfigured) {
        row.classList.add('ph-unknown');
        label.removeAttribute('href');
        label.textContent = 'Proxy Host';
        label.title = 'Configure NPM under Settings -> Network Services -> Proxy Hosts first';
        btn.replaceChildren(faIcon('plus'));
        btn.title = 'Configure NPM under Settings -> Network Services -> Proxy Hosts first';
        row._host = null;
        return;
      }
      const host = findHostFor(info);
      const primary = host && primaryDomainFor(host);
      if (host && primary) {
        row.classList.add(host.enabled ? 'ph-on' : 'ph-disabled');
        label.href = hostUrl(host, primary.domain);
        label.textContent = primary.domain + (primary.extra ? ' +' + primary.extra : '');
        label.classList.toggle('ph-proxy-paused', primary.paused);
        label.title =
          (primary.paused ? 'Paused - not currently routed. ' : '') +
          'Proxying to ' +
          host.forward_host +
          ':' +
          host.forward_port +
          (host.enabled ? '' : ' (host disabled)');
        btn.replaceChildren(faIcon('pencil'));
        btn.title = 'Edit proxy host';
        row._host = host;
      } else {
        row.classList.add('ph-off');
        label.removeAttribute('href');
        label.textContent = 'No Proxy Host';
        label.title = '';
        btn.replaceChildren(faIcon('plus'));
        btn.title = 'Add proxy host';
        row._host = null;
      }
    });
    console.log('[Proxy Hosts] applied state to', rows.length, 'row(s),', changed, 'changed');
  }

  // See renderAllFromCache()'s own comment on fv3InstallDockerTableWidthFix:
  // a plain boolean, not keyed off any DOM reference, since Unraid's native
  // Docker page replaces every row wholesale on every ~3-5s poll - any
  // WeakSet/dataset-based "have I seen this node" check is permanently
  // fooled into thinking every poll is the first one.
  let hasFixedDockerTableWidth = false;

  function renderAllFromCache() {
    const byNameCell = scanRows();
    let newCells = 0;
    for (const [nameCell, info] of byNameCell) {
      if (!renderedCells.has(nameCell)) newCells++;
      renderContainerControl(nameCell, info);
    }
    console.log('[Proxy Hosts] renderAllFromCache:', byNameCell.size, 'candidate cell(s),', newCells, 'newly rendered');
    applyProxyStates();

    // Folder View (if installed) owns the Application column's width
    // entirely via its own internal cache (_fv3WidthSnapshots/_fv3ViewCache,
    // not exposed for us to write to) - it replays THAT cached number onto
    // every <th> on its own periodic rebuild, on resize, and on every
    // folder toggle. A CSS rule on td.ct-name (tried first) can't touch
    // this: Folder View writes to the <th>, not that <td>, so no cascade
    // trick reaches it; forcing a floor directly on the <th> via our own
    // observer (tried second) fought Folder View's cache instead of fixing
    // it, producing a visible tug-of-war every time Folder View's own
    // periodic replay reverted our correction. The only way to make Folder
    // View's own replay consistent is to get its cache corrected once, by
    // calling its real measurement function ourselves after our content is
    // in the DOM.
    //
    // ONCE is the operative word, and `newCells > 0` does NOT mean that,
    // confirmed from Unraid's own DockerContainers.page source: its native
    // polling does `$('#docker_list').html(data[0])` every 3-5s - a
    // wholesale innerHTML replacement, not a patch - so every td.ct-name is
    // a brand-new DOM element on every single poll. renderedCells (a
    // WeakSet keyed by node identity) can never "remember" a node that no
    // longer exists, so newCells was actually > 0 on EVERY ~3-5s poll,
    // forever, not just at initial page load - meaning this genuinely
    // expensive, synchronous, whole-page measurement function (unhides
    // every folder's content, forces a layout read, re-hides it) was firing
    // continuously in the background the entire time the page stayed open,
    // not once as the gate's name implied. Confirmed as the live cause of a
    // reported page freeze on resize, worse with more containers visible
    // (scales the cost of each pass) and only after "interacting with the
    // page a bit" (several of these background calls need to accumulate/
    // overlap with Folder View's own resize-triggered calls to the same
    // function before it's visibly bad) - both match exactly.
    //
    // Fixed with a real one-time latch instead: hasFixedDockerTableWidth
    // is a plain boolean, immune to the node-replacement problem since it
    // doesn't key off any DOM reference at all.
    if (!hasFixedDockerTableWidth && newCells > 0 && typeof window.fv3InstallDockerTableWidthFix === 'function') {
      hasFixedDockerTableWidth = true;
      try {
        window.fv3InstallDockerTableWidthFix();
      } catch (e) {
        console.warn('[Proxy Hosts] fv3InstallDockerTableWidthFix failed:', e);
      }
    }
  }

  async function fullRefresh() {
    console.log('[Proxy Hosts] fullRefresh start');
    await refreshState();
    renderAllFromCache();
  }

  // --- popovers (same UI; calls api() instead of chrome.runtime) ---------

  let activePopoverKeyHandler = null;

  function closePopover() {
    document.querySelectorAll('.ph-popover').forEach((el) => el.remove());
    if (activePopoverKeyHandler) {
      document.removeEventListener('keydown', activePopoverKeyHandler);
      activePopoverKeyHandler = null;
    }
  }

  function openPopover(anchorEl, build) {
    closePopover();
    const pop = document.createElement('div');
    pop.className = 'ph-popover';
    build(pop);
    document.body.appendChild(pop);
    const r = anchorEl.getBoundingClientRect();
    pop.style.top = window.scrollY + r.bottom + 6 + 'px';
    pop.style.left = window.scrollX + r.left + 'px';
    setTimeout(() => document.addEventListener('click', outsideClick, { once: true }), 0);
    function outsideClick(e) {
      if (!pop.contains(e.target)) closePopover();
    }
    // Escape or Enter closes the popover by default. A nested control that
    // needs its own Enter/Escape behaviour (the rename and add-domain
    // inputs below) calls stopPropagation() in its own keydown handler
    // first - that handler runs before this one regardless, since it's
    // attached directly to the focused element (the actual event target),
    // which always fires before the event bubbles up to document.
    activePopoverKeyHandler = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') closePopover();
    };
    document.addEventListener('keydown', activePopoverKeyHandler);
  }

  function onControlClick(row, info) {
    const anchor = row._btn;
    if (!state.npmConfigured) {
      openPopover(anchor, (pop) => {
        const title = document.createElement('div');
        title.className = 'ph-pop-title';
        title.textContent = 'NPM not configured';
        pop.appendChild(title);
        const hint = document.createElement('div');
        hint.className = 'ph-pop-hint';
        hint.textContent = 'Set the NPM URL/login under Settings -> Network Services -> Proxy Hosts.';
        pop.appendChild(hint);
      });
      return;
    }
    if (row._host) {
      openManagePopover(anchor, row._host);
    } else {
      openCreatePopover(anchor, info);
    }
  }

  function openCreatePopover(anchor, info) {
    const suggestedDomain = state.baseDomain ? slugify(info.name) + '.' + state.baseDomain : '';
    const hasLan = info.lanTargets.length > 0;
    const hasNetwork = info.networkEligible;

    openPopover(anchor, (pop) => {
      const title = document.createElement('div');
      title.className = 'ph-pop-title';
      title.textContent = 'Create proxy host';
      pop.appendChild(title);

      // --- mode choice: container name (via the shared network) vs. a LAN
      // port. Only shown as an actual choice when both are available for
      // this container; otherwise the one available mode is used silently,
      // same as before. Defaults to 'network' when both qualify - matches
      // what the server used to do automatically (prefer_container_forwarding),
      // just now an explicit, overridable starting point instead of a
      // silent override.
      let mode = hasNetwork ? 'network' : 'lan';
      let lanRadio = null;
      let networkRadio = null;
      if (hasLan && hasNetwork) {
        const modeHint = document.createElement('div');
        modeHint.className = 'ph-pop-hint';
        modeHint.textContent = 'Proxy to:';
        pop.appendChild(modeHint);

        networkRadio = document.createElement('input');
        networkRadio.type = 'radio';
        networkRadio.name = 'ph-mode';
        networkRadio.checked = true;
        const networkRow = document.createElement('label');
        networkRow.className = 'ph-checkrow';
        networkRow.appendChild(networkRadio);
        networkRow.appendChild(document.createTextNode('Container name (via ' + info.network + ')'));
        pop.appendChild(networkRow);

        lanRadio = document.createElement('input');
        lanRadio.type = 'radio';
        lanRadio.name = 'ph-mode';
        const lanRow = document.createElement('label');
        lanRow.className = 'ph-checkrow';
        lanRow.appendChild(lanRadio);
        lanRow.appendChild(document.createTextNode('LAN port'));
        pop.appendChild(lanRow);
      }

      // --- network-mode target: no LAN port to read a number from in
      // general, so it's typed in - but pre-filled with info.suggestedPort
      // when unambiguous (see scanRows()). Hidden/unused when this
      // container has no LAN alternative to switch away from (mode is
      // permanently 'network' in that case).
      const networkSection = document.createElement('div');
      const networkHint = document.createElement('div');
      networkHint.className = 'ph-pop-hint';
      networkHint.textContent = hasNetwork ? info.name + ' on ' + info.network : '';
      networkSection.appendChild(networkHint);
      const portInput = document.createElement('input');
      portInput.type = 'text';
      portInput.inputMode = 'numeric';
      portInput.className = 'ph-input';
      portInput.placeholder = 'Container port, e.g. 8000';
      portInput.value = info.suggestedPort || '';
      networkSection.appendChild(portInput);
      pop.appendChild(networkSection);

      // --- LAN-mode target: a dropdown only when there's a real choice
      // (more than one distinct published port); otherwise just the single
      // target shown as a hint, nothing to pick.
      const lanSection = document.createElement('div');
      let lanSelect = null;
      if (hasLan) {
        if (info.lanTargets.length > 1) {
          lanSelect = document.createElement('select');
          lanSelect.className = 'ph-input';
          info.lanTargets.forEach((t, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = t.lanIp + ':' + t.lanPort + (t.containerPort ? ' (container ' + t.containerPort + ')' : '');
            lanSelect.appendChild(opt);
          });
          lanSection.appendChild(lanSelect);
        } else {
          const t = info.lanTargets[0];
          const lanHint = document.createElement('div');
          lanHint.className = 'ph-pop-hint';
          lanHint.textContent = t.lanIp + ':' + t.lanPort + (t.containerPort ? ' (container ' + t.containerPort + ')' : '');
          lanSection.appendChild(lanHint);
        }
      }
      pop.appendChild(lanSection);

      function updateModeVisibility() {
        networkSection.style.display = mode === 'network' ? '' : 'none';
        lanSection.style.display = mode === 'lan' ? '' : 'none';
      }
      updateModeVisibility();
      if (lanRadio) {
        lanRadio.addEventListener('change', () => {
          mode = 'lan';
          updateModeVisibility();
        });
      }
      if (networkRadio) {
        networkRadio.addEventListener('change', () => {
          mode = 'network';
          updateModeVisibility();
        });
      }

      const domainInput = document.createElement('input');
      domainInput.type = 'text';
      domainInput.className = 'ph-input';
      domainInput.placeholder = 'sub.example.com';
      domainInput.value = suggestedDomain;
      pop.appendChild(domainInput);

      const certSelect = document.createElement('select');
      certSelect.className = 'ph-input';
      const noneOpt = document.createElement('option');
      noneOpt.value = '0';
      noneOpt.textContent = 'No certificate';
      certSelect.appendChild(noneOpt);
      for (const c of state.certificates) {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = c.nice_name || (c.domain_names || []).join(', ');
        certSelect.appendChild(opt);
      }
      pop.appendChild(certSelect);

      const sslRow = document.createElement('label');
      sslRow.className = 'ph-checkrow';
      const sslCheck = document.createElement('input');
      sslCheck.type = 'checkbox';
      sslRow.appendChild(sslCheck);
      sslRow.appendChild(document.createTextNode('Force SSL'));
      pop.appendChild(sslRow);

      const wsRow = document.createElement('label');
      wsRow.className = 'ph-checkrow';
      const wsCheck = document.createElement('input');
      wsCheck.type = 'checkbox';
      wsRow.appendChild(wsCheck);
      wsRow.appendChild(document.createTextNode('Allow websocket upgrade'));
      pop.appendChild(wsRow);

      if (state.piholeEnabled) {
        const piHint = document.createElement('div');
        piHint.className = 'ph-pop-hint';
        piHint.textContent = 'A Pi-hole CNAME to NPM will be added for this domain too.';
        pop.appendChild(piHint);
      }

      const updateCertSelection = () => {
        const best = bestCertFor(domainInput.value.trim(), state.certificates);
        if (best) {
          certSelect.value = String(best.id);
          sslCheck.checked = true;
        }
      };
      updateCertSelection();
      domainInput.addEventListener('input', updateCertSelection);
      certSelect.addEventListener('change', () => {
        if (certSelect.value === '0') sslCheck.checked = false;
      });

      const errorMsg = document.createElement('div');
      errorMsg.className = 'ph-pop-error';
      pop.appendChild(errorMsg);

      const submitBtn = document.createElement('button');
      submitBtn.textContent = 'Create';
      pop.appendChild(submitBtn);

      submitBtn.addEventListener('click', async () => {
        const domain = domainInput.value.trim();
        if (!domain) {
          errorMsg.textContent = 'Enter a domain name.';
          return;
        }
        const networkPort = portInput.value.trim();
        if (mode === 'network' && !/^\d+$/.test(networkPort)) {
          errorMsg.textContent = 'Enter a valid container port.';
          return;
        }
        const lanTarget = mode === 'lan' ? info.lanTargets[lanSelect ? parseInt(lanSelect.value, 10) : 0] : null;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating…';
        errorMsg.textContent = '';
        try {
          const result = await api('create', {
            domain,
            target_mode: mode,
            lan_ip: mode === 'lan' ? lanTarget.lanIp : '',
            lan_port: mode === 'lan' ? lanTarget.lanPort : 0,
            container_name: info.name,
            container_port: mode === 'lan' ? lanTarget.containerPortNum : networkPort,
            certificate_id: parseInt(certSelect.value, 10) || 0,
            ssl_forced: sslCheck.checked,
            websocket: wsCheck.checked,
          });
          // result.hosts is NPM's confirmed list, fetched server-side
          // before the Pi-hole write - no extra round trip needed, and
          // nothing here is assumed rather than verified.
          applyHosts(result.hosts);
          closePopover();
          renderAllFromCache();
          if (result.piholeWarning) {
            console.error('[Proxy Hosts] Pi-hole add-CNAME failed:', result.piholeWarning);
            alert('Proxy host created, but the Pi-hole update failed:\n' + result.piholeWarning);
          }
        } catch (e) {
          errorMsg.textContent = 'Failed: ' + e.message;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create';
        }
      });
    });
  }

  function openManagePopover(anchor, host) {
    openPopover(anchor, (pop) => {
      const active = host.domain_names || [];
      const paused = (host.meta && host.meta.ph_paused_domains) || [];

      const errorMsg = document.createElement('div');
      errorMsg.className = 'ph-pop-error';

      // --- header: host-wide status, enable/disable, full delete ---------
      const header = document.createElement('div');
      header.className = 'ph-pop-header';

      const statusWrap = document.createElement('div');
      statusWrap.className = 'ph-pop-status';
      const dot = document.createElement('span');
      dot.className = 'ph-pop-dot ' + (host.enabled ? 'ph-pop-dot-on' : 'ph-pop-dot-off');
      statusWrap.appendChild(dot);
      const target = document.createElement('span');
      target.className = 'ph-pop-target';
      target.textContent = host.forward_host + ':' + host.forward_port;
      statusWrap.appendChild(target);
      header.appendChild(statusWrap);

      const headerBtns = document.createElement('div');
      headerBtns.className = 'ph-pop-header-btns';

      const hostToggleBtn = iconButton(
        host.enabled ? 'pause' : 'play',
        host.enabled ? 'Disable this proxy host' : 'Enable this proxy host'
      );
      hostToggleBtn.addEventListener('click', async () => {
        const wantEnabled = !host.enabled;
        hostToggleBtn.disabled = true;
        errorMsg.textContent = '';
        try {
          await api('toggle', { host_id: host.id, enabled: wantEnabled });
          host.enabled = wantEnabled;
          closePopover();
          renderAllFromCache();
        } catch (e) {
          hostToggleBtn.disabled = false;
          errorMsg.textContent = 'Failed: ' + e.message;
        }
      });
      headerBtns.appendChild(hostToggleBtn);

      const deleteBtn = iconButton('trash-o', 'Remove this proxy host entirely', 'ph-danger');
      deleteBtn.addEventListener('click', async () => {
        const allDomains = [...active, ...paused];
        if (!confirm('Remove the NPM proxy host for ' + allDomains.join(', ') + '?')) return;
        deleteBtn.disabled = true;
        try {
          const result = await api('remove', { host_id: host.id, domains: allDomains });
          applyHosts(result.hosts);
          closePopover();
          renderAllFromCache();
          if (result.piholeWarning) {
            console.error('[Proxy Hosts] Pi-hole remove-CNAME failed:', result.piholeWarning);
            alert('Proxy host removed, but the Pi-hole cleanup failed:\n' + result.piholeWarning);
          }
        } catch (e) {
          deleteBtn.disabled = false;
          errorMsg.textContent = 'Failed: ' + e.message;
        }
      });
      headerBtns.appendChild(deleteBtn);
      header.appendChild(headerBtns);
      pop.appendChild(header);

      // --- per-domain rows: edit (rename), pause/resume, remove ----------
      const domainList = document.createElement('div');
      domainList.className = 'ph-domain-list';
      pop.appendChild(domainList);

      async function submitState(newActive, newPaused) {
        if (!newActive.length && !newPaused.length) {
          errorMsg.textContent = 'A proxy host needs at least one domain - use the trash icon above to delete it entirely.';
          return;
        }
        errorMsg.textContent = '';
        try {
          const result = await api('update', {
            host_id: host.id,
            domain_names: newActive,
            paused_domains: newPaused,
          });
          applyHosts(result.hosts);
          closePopover();
          renderAllFromCache();
          if (result.piholeWarning) {
            console.error('[Proxy Hosts] Pi-hole update failed:', result.piholeWarning);
            alert('Domains updated, but the Pi-hole update failed:\n' + result.piholeWarning);
          }
        } catch (e) {
          errorMsg.textContent = 'Failed: ' + e.message;
        }
      }

      function renderDomainRow(domain, isPaused) {
        const row = document.createElement('div');
        row.className = 'ph-domain-row' + (isPaused ? ' ph-domain-paused' : '');

        const label = document.createElement('span');
        label.className = 'ph-domain-name';
        label.textContent = domain;
        row.appendChild(label);

        const btns = document.createElement('div');
        btns.className = 'ph-domain-btns';

        const editBtn = iconButton('pencil', 'Rename this domain');
        editBtn.addEventListener('click', () => {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'ph-input';
          input.value = domain;
          row.replaceChild(input, label);
          input.focus();
          input.select();
          const commit = () => {
            const renamed = input.value.trim();
            if (!renamed || renamed === domain) {
              renderDomainRows();
              return;
            }
            const activeNext = isPaused ? active : active.map((d) => (d === domain ? renamed : d));
            const pausedNext = isPaused ? paused.map((d) => (d === domain ? renamed : d)) : paused;
            submitState(activeNext, pausedNext);
          };
          input.addEventListener('keydown', (e) => {
            // Stop both keys from also reaching the popover's own
            // Escape/Enter-closes-it handler: Escape here should only
            // cancel this one rename (handled below), and Enter should
            // only close the popover once submitState() actually succeeds
            // (it calls closePopover() itself) - not instantly regardless
            // of whether the rename failed.
            if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') renderDomainRows();
          });
          input.addEventListener('blur', commit);
        });
        btns.appendChild(editBtn);

        const pauseBtn = iconButton(
          isPaused ? 'play' : 'pause',
          isPaused ? 'Resume this domain' : 'Pause this domain (keeps it, stops routing it)'
        );
        pauseBtn.addEventListener('click', () => {
          if (isPaused) {
            submitState([...active, domain], paused.filter((d) => d !== domain));
          } else {
            submitState(active.filter((d) => d !== domain), [...paused, domain]);
          }
        });
        btns.appendChild(pauseBtn);

        const rmBtn = iconButton('trash-o', 'Remove this domain entirely', 'ph-danger');
        rmBtn.addEventListener('click', () => {
          submitState(active.filter((d) => d !== domain), paused.filter((d) => d !== domain));
        });
        btns.appendChild(rmBtn);

        row.appendChild(btns);
        domainList.appendChild(row);
      }

      function renderDomainRows() {
        domainList.innerHTML = '';
        active.forEach((d) => renderDomainRow(d, false));
        paused.forEach((d) => renderDomainRow(d, true));
      }
      renderDomainRows();

      // --- add a new domain -----------------------------------------------
      const addRow = document.createElement('div');
      addRow.className = 'ph-domain-add';
      const addInput = document.createElement('input');
      addInput.type = 'text';
      addInput.className = 'ph-input';
      addInput.placeholder = 'another.domain.com';
      const addBtn = iconButton('plus', 'Add domain');
      addRow.appendChild(addInput);
      addRow.appendChild(addBtn);
      pop.appendChild(addRow);

      addBtn.addEventListener('click', () => {
        const domain = addInput.value.trim();
        if (!domain) return;
        if (active.includes(domain) || paused.includes(domain)) {
          errorMsg.textContent = 'That domain is already on this host.';
          return;
        }
        submitState([...active, domain], paused);
      });
      addInput.addEventListener('keydown', (e) => {
        // Same reasoning as the rename input: let submitState() decide
        // whether to close (on success), rather than closing instantly.
        if (e.key === 'Enter') {
          e.stopPropagation();
          addBtn.click();
        }
      });

      pop.appendChild(errorMsg);
    });
  }

  // --- wiring ------------------------------------------------------------

  function watchList() {
    const list = document.getElementById('docker_list');
    if (!list) {
      setTimeout(watchList, 500);
      return;
    }
    let timer;
    let fireCount = 0;
    new MutationObserver((mutations) => {
      fireCount++;
      // If this climbs continuously with no gaps, something external is
      // reacting to our own writes - exactly the feedback-loop shape that
      // caused the earlier permanent freeze. A healthy page fires this
      // occasionally (folder expand/collapse, Unraid's own list refresh).
      console.log('[Proxy Hosts] #docker_list mutated (fire #' + fireCount + '), added/removed rows:',
        mutations.reduce((n, m) => n + m.addedNodes.length + m.removedNodes.length, 0));
      clearTimeout(timer);
      timer = setTimeout(renderAllFromCache, 150);
      // Deliberately NOT subtree:true (tried it, reverted it - confirmed
      // live as a real contributor to a runaway mutation loop, hundreds of
      // fires/sec with no gaps). Folder View's own folderobserver is
      // attached to '.folder-storage span.outer' - the exact ancestor our
      // control lives under - so with subtree:true, OUR OWN writes inside
      // that span could re-trigger Folder View's reactions, whose own
      // DOM changes land back in our observed subtree too: two plugins'
      // observers feeding each other. childList-only on #docker_list
      // itself means a container newly revealed by expanding a folder (now
      // living in a nested div.folder-storage, not a direct child - see
      // scanRows()) won't get its control inserted until the next 30s
      // fullRefresh() poll - a real but acceptable latency trade for not
      // risking a loop that can peg a browser tab indefinitely.
    }).observe(list, { childList: true });
  }

  function init() {
    fullRefresh();
    watchList();
    setInterval(fullRefresh, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
