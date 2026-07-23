(function () {
  'use strict';

  // ----- well-known ports + address classification ---------------------------

  var WELL_KNOWN = {
    22: 'SSH', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 69: 'TFTP',
    80: 'HTTP', 88: 'Kerberos', 110: 'POP3', 111: 'RPC', 119: 'NNTP',
    123: 'NTP', 135: 'RPC', 137: 'NetBIOS', 138: 'NetBIOS', 139: 'SMB',
    143: 'IMAP', 161: 'SNMP', 162: 'SNMP', 179: 'BGP', 389: 'LDAP',
    443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 514: 'Syslog', 587: 'SMTP',
    631: 'IPP', 636: 'LDAPS', 873: 'rsync', 993: 'IMAPS', 995: 'POP3S',
    1080: 'SOCKS', 1194: 'OpenVPN', 1433: 'MSSQL', 1521: 'Oracle',
    1701: 'L2TP', 1812: 'RADIUS', 1883: 'MQTT', 2049: 'NFS',
    2375: 'Docker', 2376: 'Docker', 3128: 'Proxy', 3260: 'iSCSI',
    3306: 'MySQL', 3389: 'RDP', 3702: 'WSD', 4500: 'IPsec',
    5060: 'SIP', 5061: 'SIPS', 5222: 'XMPP', 5353: 'mDNS', 5355: 'LLMNR',
    5432: 'Postgres', 5900: 'VNC', 6379: 'Redis', 8006: 'Proxmox',
    8080: 'HTTP-alt', 8443: 'HTTPS-alt', 8883: 'MQTTS', 9090: 'Cockpit',
    9100: 'Prometheus', 11211: 'Memcached', 27017: 'MongoDB',
    51820: 'WireGuard',
  };

  // Return 'wildcard' | 'localhost' | 'lan' | 'linklocal' | 'public'
  function classifyAddress(addr) {
    if (!addr) return 'public';
    if (addr === '0.0.0.0' || addr === '*' || addr === '::') return 'wildcard';
    if (addr === '127.0.0.1' || addr === '::1' || /^127\./.test(addr)) return 'localhost';
    if (/^169\.254\./.test(addr) || /^fe[89ab][0-9a-f]:/i.test(addr)) return 'linklocal';
    if (/^10\./.test(addr) || /^192\.168\./.test(addr) ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(addr) ||
        /^f[cd][0-9a-f]{2}:/i.test(addr)) return 'lan';
    return 'public';
  }

  // Pick the "most exposed" classification across a group's addresses.
  var EXPOSURE_RANK = { wildcard: 5, public: 4, lan: 3, linklocal: 2, localhost: 1 };
  function groupExposure(addrs) {
    var top = 'localhost', topRank = 0;
    for (var i = 0; i < addrs.length; i++) {
      var c = classifyAddress(addrs[i].address);
      if (EXPOSURE_RANK[c] > topRank) { top = c; topRank = EXPOSURE_RANK[c]; }
    }
    return top;
  }

  // ----- column definitions ---------------------------------------------------

  var COLUMN_DEFS = {
    proto: {
      label: 'Proto', width: 100, cls: 'pts-proto',
      render: function (g) {
        return g.protos.map(function (p) {
          return '<span class="pts-proto-chip pts-proto-' + p + '">' + esc(p.toUpperCase()) + '</span>';
        }).join('');
      },
    },
    port: {
      label: 'Port', width: 130, cls: 'pts-port',
      render: function (g) {
        var label = WELL_KNOWN[g.port];
        var labelHtml = label ? ' <span class="pts-port-label">' + esc(label) + '</span>' : '';
        var arrow = g.container_port ? ' <span class="pts-mute">&rarr;' + esc(g.container_port) + '</span>' : '';
        return esc(g.port) + labelHtml + arrow;
      },
    },
    address: {
      label: 'Address', width: 220,
      render: function (g) {
        var addrs = g.addresses;
        var isExpanded = state.expanded.has(groupKey(g));
        if (addrs.length === 1) {
          return renderAddressLine(addrs[0]);
        }
        if (isExpanded) {
          var head = renderAddressLine(addrs[0])
            + '<button type="button" class="pts-addr-toggle" data-action="collapse" title="Collapse">&#x25B4;</button>';
          var tail = addrs.slice(1).map(renderAddressLine).join('<br>');
          return '<span class="pts-addr-list">' + head + '<br>' + tail + '</span>';
        }
        return renderAddressLine(addrs[0])
          + '<button type="button" class="pts-addr-toggle" data-action="expand" title="Show all addresses">+'
          + (addrs.length - 1) + ' &#x25BE;</button>';
      },
    },
    process: {
      label: 'Process', width: 180,
      render: function (g) { return esc(g.process || ''); },
    },
    pid: {
      label: 'PID', width: 90,
      render: function (g) { return esc(g.pid || ''); },
    },
    container_name: {
      label: 'Container', width: 180,
      render: function (g) { return esc(g.container_name || ''); },
    },
    image: {
      label: 'Image', width: 280, cls: 'pts-mute',
      render: function (g) { return esc(g.image || ''); },
    },
  };

  var DEFAULT_ORDER = ['proto', 'port', 'address', 'process', 'pid', 'container_name', 'image'];
  var DEFAULT_FILTERS = { tcp: true, udp: true, v4: true, v6: true, dockerOnly: false };
  var STORAGE_KEY = 'pts.state.v2';

  // ----- state ----------------------------------------------------------------

  var state = {
    rows: [],         // raw listeners from server
    groups: [],       // grouped listeners
    expanded: new Set(),
    order: DEFAULT_ORDER.slice(),
    cols: {},
    sort: { key: 'port', dir: 1 },
    filters: Object.assign({}, DEFAULT_FILTERS),
  };

  DEFAULT_ORDER.forEach(function (id) {
    state.cols[id] = { visible: true, width: COLUMN_DEFS[id].width };
  });

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.order) {
        state.order = saved.order.filter(function (id) { return COLUMN_DEFS[id]; });
        DEFAULT_ORDER.forEach(function (id) {
          if (state.order.indexOf(id) === -1) state.order.push(id);
        });
      }
      if (saved.cols) {
        Object.keys(saved.cols).forEach(function (id) {
          if (COLUMN_DEFS[id]) {
            state.cols[id] = {
              visible: saved.cols[id].visible !== false,
              width:   saved.cols[id].width   || COLUMN_DEFS[id].width,
            };
          }
        });
      }
      if (saved.sort && COLUMN_DEFS[saved.sort.key]) state.sort = saved.sort;
      if (saved.filters) {
        Object.keys(DEFAULT_FILTERS).forEach(function (k) {
          if (typeof saved.filters[k] === 'boolean') state.filters[k] = saved.filters[k];
        });
      }
    } catch (e) { /* ignore */ }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        order: state.order, cols: state.cols, sort: state.sort, filters: state.filters,
      }));
    } catch (e) { /* ignore */ }
  }

  function resetState() {
    state.order = DEFAULT_ORDER.slice();
    DEFAULT_ORDER.forEach(function (id) {
      state.cols[id] = { visible: true, width: COLUMN_DEFS[id].width };
    });
    state.sort = { key: 'port', dir: 1 };
    state.filters = Object.assign({}, DEFAULT_FILTERS);
    saveState();
  }

  // ----- helpers --------------------------------------------------------------

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function visibleColumns() {
    return state.order.filter(function (id) { return state.cols[id].visible; });
  }

  // Listeners share a row when they agree on everything except protocol, so a
  // service bound to both TCP and UDP (e.g. DNS) collapses into one line with
  // a combined protos[] list.
  function groupKey(g) {
    return [g.port, g.process || '', g.container_id || '', g.container_port || ''].join('');
  }

  function renderAddressLine(a) {
    var cls = classifyAddress(a.address);
    return '<span class="pts-addr pts-addr-' + cls + '" title="' + cls + '">' + esc(a.address) + '</span>';
  }

  // ----- grouping -------------------------------------------------------------

  // Collapse identical listeners that differ only by protocol (TCP+UDP)
  // and/or address (IPv4+IPv6, or multiple interface-bound bindings) into a
  // single row with protos[] and addresses[] arrays.
  function groupListeners(rows) {
    var byKey = Object.create(null);
    var order = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var key = groupKey(r);
      var g = byKey[key];
      if (!g) {
        g = {
          protos: [],
          port: r.port,
          process: r.process,
          pid: r.pid,
          container_id: r.container_id,
          container_name: r.container_name,
          container_port: r.container_port,
          image: r.image,
          addresses: [],
          _addrSeen: Object.create(null),
        };
        byKey[key] = g;
        order.push(g);
      }
      if (g.protos.indexOf(r.proto) === -1) g.protos.push(r.proto);
      var addrKey = r.address + '/' + r.family;
      if (!g._addrSeen[addrKey]) {
        g._addrSeen[addrKey] = true;
        g.addresses.push({ address: r.address, family: r.family });
      }
    }
    order.forEach(function (g) {
      g.protos.sort();
      delete g._addrSeen;
    });
    return order;
  }

  // ----- filtering & sorting --------------------------------------------------

  function applyFilters(groups) {
    var q = $('pts-filter').value.trim().toLowerCase();
    var f = state.filters;

    var out = [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var protos = g.protos.filter(function (p) {
        if (p === 'tcp' && !f.tcp) return false;
        if (p === 'udp' && !f.udp) return false;
        return true;
      });
      if (protos.length === 0) continue;
      if (f.dockerOnly && !g.container_id) continue;

      var addrs = g.addresses.filter(function (a) {
        if (a.family === 'ipv4' && !f.v4) return false;
        if (a.family === 'ipv6' && !f.v6) return false;
        return true;
      });
      if (addrs.length === 0) continue;

      if (q) {
        var hay = [g.port, g.process, g.pid, g.container_name, g.image]
          .concat(addrs.map(function (a) { return a.address; }))
          .filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) continue;
      }

      out.push(Object.assign({}, g, { protos: protos, addresses: addrs }));
    }
    return out;
  }

  function sortRows(rows) {
    var k = state.sort.key, d = state.sort.dir;
    return rows.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'address')      { av = a.addresses[0].address; bv = b.addresses[0].address; }
      else if (k === 'proto')   { av = a.protos.join(','); bv = b.protos.join(','); }
      else                      { av = a[k]; bv = b[k]; }
      if (av === null || av === undefined) av = '';
      if (bv === null || bv === undefined) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * d;
      return String(av).localeCompare(String(bv)) * d;
    });
  }

  // ----- table rendering ------------------------------------------------------

  function renderHeader() {
    var table = $('pts-table');
    var cols = visibleColumns();

    var colgroupHTML = cols.map(function (id) {
      return '<col data-col="' + id + '" style="width:' + state.cols[id].width + 'px">';
    }).join('');
    var theadHTML = '<tr>' + cols.map(function (id) {
      var def = COLUMN_DEFS[id];
      var sortCls = '';
      if (state.sort.key === id) sortCls = state.sort.dir === 1 ? ' pts-asc' : ' pts-desc';
      return '<th data-col="' + id + '" class="pts-th' + sortCls + '">'
        + '<span class="pts-th-label">' + esc(def.label) + '</span>'
        + '<span class="pts-resize" data-col="' + id + '"></span>'
        + '</th>';
    }).join('') + '</tr>';

    var oldCg = table.querySelector('colgroup');
    if (oldCg) oldCg.remove();
    var cg = document.createElement('colgroup');
    cg.innerHTML = colgroupHTML;
    table.insertBefore(cg, table.firstChild);

    table.querySelector('thead').innerHTML = theadHTML;
  }

  function renderRows() {
    var rows = sortRows(applyFilters(state.groups));
    var tbody = document.querySelector('#pts-table tbody');
    var cols = visibleColumns();

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + cols.length + '" class="pts-empty">No matching listeners.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var g = rows[i];
      var rowCls = '';
      if (g.container_id) rowCls += ' pts-docker';
      var exposure = groupExposure(g.addresses);
      rowCls += ' pts-exposure-' + exposure;

      html += '<tr class="' + rowCls.trim() + '" data-key="' + esc(groupKey(g)) + '">';
      for (var j = 0; j < cols.length; j++) {
        var def = COLUMN_DEFS[cols[j]];
        var cls = def.cls ? ' class="' + def.cls + '"' : '';
        html += '<td' + cls + '>' + def.render(g) + '</td>';
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  function renderAll() {
    renderHeader();
    renderRows();
  }

  // ----- table-level events: sort header, expand address ---------------------

  function bindTableEvents() {
    var table = $('pts-table');

    table.querySelector('thead').addEventListener('click', function (e) {
      if (e.target.classList.contains('pts-resize')) return;
      var th = e.target.closest('th[data-col]');
      if (!th) return;
      var id = th.getAttribute('data-col');
      if (state.sort.key === id) state.sort.dir *= -1;
      else { state.sort.key = id; state.sort.dir = 1; }
      saveState();
      renderAll();
    });

    table.querySelector('tbody').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (action !== 'expand' && action !== 'collapse') return;
      var tr = btn.closest('tr');
      if (!tr) return;
      var key = tr.getAttribute('data-key');
      if (state.expanded.has(key)) state.expanded.delete(key);
      else state.expanded.add(key);
      renderRows();
    });
  }

  // ----- column resize --------------------------------------------------------

  function bindResize() {
    var table = $('pts-table');
    var active = null;

    table.addEventListener('mousedown', function (e) {
      if (!e.target.classList.contains('pts-resize')) return;
      var id = e.target.getAttribute('data-col');
      var col = table.querySelector('col[data-col="' + id + '"]');
      if (!col) return;
      active = {
        id: id, col: col,
        startX: e.clientX,
        startW: col.offsetWidth || state.cols[id].width,
      };
      document.body.classList.add('pts-resizing');
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', function (e) {
      if (!active) return;
      var w = Math.max(40, active.startW + (e.clientX - active.startX));
      active.col.style.width = w + 'px';
      state.cols[active.id].width = w;
    });

    document.addEventListener('mouseup', function () {
      if (!active) return;
      active = null;
      document.body.classList.remove('pts-resizing');
      saveState();
    });
  }

  // ----- columns popover (show/hide + drag-to-reorder) -----------------------

  function renderColumnsPopover() {
    var pop = $('pts-cols-popover');
    var rows = state.order.map(function (id) {
      var c = state.cols[id];
      var label = COLUMN_DEFS[id].label;
      return ''
        + '<div class="pts-col-row" data-col="' + id + '">'
        +   '<span class="pts-grip" data-action="grip" data-col="' + id + '" title="Drag to reorder" aria-hidden="true">'
        +     '<svg viewBox="0 0 10 16" width="10" height="16"><g fill="currentColor">'
        +       '<circle cx="2" cy="3"  r="1"/><circle cx="8" cy="3"  r="1"/>'
        +       '<circle cx="2" cy="8"  r="1"/><circle cx="8" cy="8"  r="1"/>'
        +       '<circle cx="2" cy="13" r="1"/><circle cx="8" cy="13" r="1"/>'
        +     '</g></svg>'
        +   '</span>'
        +   '<label class="pts-col-vis">'
        +     '<input type="checkbox" data-action="vis" data-col="' + id + '"' + (c.visible ? ' checked' : '') + '>'
        +     ' ' + esc(label)
        +   '</label>'
        + '</div>';
    }).join('');
    pop.innerHTML = ''
      + '<div class="pts-col-list">' + rows + '</div>'
      + '<div class="pts-col-footer"><button type="button" data-action="reset">Reset</button></div>';
  }

  function bindColumnsPopover() {
    var btn = $('pts-cols-btn');
    var pop = $('pts-cols-popover');

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var hidden = pop.classList.toggle('pts-hidden');
      if (!hidden) renderColumnsPopover();
    });

    document.addEventListener('click', function (e) {
      if (pop.classList.contains('pts-hidden')) return;
      if (pop.contains(e.target) || btn.contains(e.target)) return;
      pop.classList.add('pts-hidden');
    });

    pop.addEventListener('click', function (e) {
      if (e.target.getAttribute('data-action') === 'reset') {
        resetState();
        renderColumnsPopover();
        syncPillsFromState();
        renderAll();
      }
    });

    pop.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-action') !== 'vis') return;
      var id = e.target.getAttribute('data-col');
      state.cols[id].visible = e.target.checked;
      saveState();
      renderAll();
    });

    bindDragReorder(pop);
  }

  function bindDragReorder(pop) {
    var drag = null;

    pop.addEventListener('pointerdown', function (e) {
      var grip = e.target.closest('[data-action="grip"]');
      if (!grip) return;
      var row = grip.closest('.pts-col-row');
      if (!row) return;

      var list = pop.querySelector('.pts-col-list');
      var listRect = list.getBoundingClientRect();
      var rowRect  = row.getBoundingClientRect();

      drag = {
        row: row, list: list,
        id: row.getAttribute('data-col'),
        startY: e.clientY,
        rowH: rowRect.height,
        rowTopInList: rowRect.top - listRect.top + list.scrollTop,
        listRect: listRect,
        indicator: document.createElement('div'),
      };
      drag.indicator.className = 'pts-drop-indicator';
      list.appendChild(drag.indicator);

      row.classList.add('pts-dragging');
      document.body.classList.add('pts-dragging-col');
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    pop.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var list = drag.list;
      var listRect = list.getBoundingClientRect();
      var rows = Array.prototype.slice.call(list.querySelectorAll('.pts-col-row'));
      var pointerY = e.clientY;

      var dropIdx = rows.length;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] === drag.row) continue;
        var r = rows[i].getBoundingClientRect();
        if (pointerY < r.top + r.height / 2) { dropIdx = i; break; }
      }

      var indicatorTop;
      if (dropIdx < rows.length) {
        var anchor = rows[dropIdx].getBoundingClientRect();
        indicatorTop = anchor.top - listRect.top + list.scrollTop;
      } else {
        var last = rows[rows.length - 1].getBoundingClientRect();
        indicatorTop = last.bottom - listRect.top + list.scrollTop;
      }
      drag.indicator.style.top = indicatorTop + 'px';
      drag.dropIdx = dropIdx;
    });

    function endDrag() {
      if (!drag) return;
      var rows = Array.prototype.slice.call(drag.list.querySelectorAll('.pts-col-row'));
      var sourceIdx = rows.indexOf(drag.row);
      var targetIdx = drag.dropIdx;
      if (targetIdx > sourceIdx) targetIdx--;

      drag.row.classList.remove('pts-dragging');
      drag.indicator.remove();
      document.body.classList.remove('pts-dragging-col');

      if (typeof targetIdx === 'number' && targetIdx !== sourceIdx) {
        var moved = state.order.splice(sourceIdx, 1)[0];
        state.order.splice(targetIdx, 0, moved);
        saveState();
        renderColumnsPopover();
        renderAll();
      }
      drag = null;
    }

    pop.addEventListener('pointerup',     endDrag);
    pop.addEventListener('pointercancel', endDrag);
  }

  // ----- filter pills ---------------------------------------------------------

  // map data-filter attr -> state.filters key
  var PILL_MAP = {
    'tcp':         'tcp',
    'udp':         'udp',
    'v4':          'v4',
    'v6':          'v6',
    'docker-only': 'dockerOnly',
  };

  function syncPillsFromState() {
    Object.keys(PILL_MAP).forEach(function (attr) {
      var pill = document.querySelector('.pts-pill[data-filter="' + attr + '"]');
      if (!pill) return;
      pill.setAttribute('aria-pressed', String(!!state.filters[PILL_MAP[attr]]));
    });
  }

  function bindPills() {
    document.querySelectorAll('.pts-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var attr = pill.getAttribute('data-filter');
        var key = PILL_MAP[attr];
        if (!key) return;
        state.filters[key] = !state.filters[key];
        syncPillsFromState();
        saveState();
        renderRows();
      });
    });
  }

  // ----- data fetch -----------------------------------------------------------

  function setStatus(text, cls) {
    var el = $('pts-status');
    el.textContent = text || '';
    el.className = 'pts-status ' + (cls || '');
  }

  function fetchData() {
    setStatus('Loading…');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/plugins/ports/include/ports.php?_=' + Date.now(), true);
    xhr.onload = function () {
      if (xhr.status !== 200) { setStatus('HTTP ' + xhr.status, 'pts-err'); return; }
      try {
        var data = JSON.parse(xhr.responseText);
        state.rows = data.ports || [];
        state.groups = groupListeners(state.rows);
        renderRows();
        var d = new Date(data.generated_at * 1000);
        setStatus(state.groups.length + ' listeners · ' + state.rows.length + ' bindings · ' + d.toLocaleTimeString());
      } catch (e) {
        setStatus('Parse error', 'pts-err');
      }
    };
    xhr.onerror = function () { setStatus('Network error', 'pts-err'); };
    xhr.send();
  }

  // ----- bootstrap ------------------------------------------------------------

  function init() {
    loadState();
    syncPillsFromState();
    renderAll();
    $('pts-filter').addEventListener('input', renderRows);
    $('pts-refresh').addEventListener('click', fetchData);
    bindPills();
    bindResize();
    bindColumnsPopover();
    bindTableEvents();
    fetchData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
