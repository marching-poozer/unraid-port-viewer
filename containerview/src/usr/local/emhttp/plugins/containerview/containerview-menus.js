// Container View: menus and dialogs shared by the Docker tab
// (containerview.js) and the Dashboard tile (containerview-dashboard.js) -
// group/stack actions, group icons, the container menu's extra items,
// category rules and the update picker.
//
// window.ContainerViewMenus(ctx) with ctx:
//   csrf        Unraid's csrf_token
//   settings    {precedence: 'labels'|'rules', ...}
//   raw()       the feed as served (label categories only)
//   data()      the feed with the rules applied (core.applyRules)
//   rulesSaved(rules)              after a save: re-apply the rules and redraw
//   iconsSaved({stackIcons} | {groupIcons})   after an icon save: redraw
// Actions refresh through the page's global loadlist(), which both pages have.
// window.ContainerViewMenus.openMenu(el, items) opens a context menu (no ctx).
(function () {
  const core = window.ContainerViewCore;
  const tr = (s) => (typeof window._ === 'function' ? window._(s) : s);
  const ACTIONS_API = '/plugins/containerview/include/actions.php';
  const ICONS_API = '/plugins/containerview/include/icons.php';
  const nameList = (names) => `<div class='cv-confirm-list'>${names.map((n) => core.esc(n)).join('<br>')}</div>`;
  const failText = (xhr) => (xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText;

  // --- context menus ---------------------------------------------------------
  // Unraid's context.js menu on el (called from el's inline onclick, so it
  // opens on this same click), remembering el so Esc can close it and give
  // focus back.
  let menuOpener = null;
  function openMenu(el, items) {
    menuOpener = el;
    context.settings({right: false, above: 'auto'});
    context.destroy('#' + el.id);
    context.attach('#' + el.id, items);
    keepOnScreen('dropdown-' + el.id);
  }
  // context.js places a menu at min(click - 13, innerWidth - 168), i.e. it
  // assumes menus are at most 160px wide; a wider one opened near the right
  // edge runs off-screen. Once it has been shown (by context.js's own
  // handler for this same click), pull it back in, caret on the right.
  function keepOnScreen(id) {
    setTimeout(() => {
      const dd = document.getElementById(id);
      if (!dd || dd.offsetParent === null) return;
      const max = window.scrollX + document.documentElement.clientWidth - dd.offsetWidth - 8;
      if (dd.getBoundingClientRect().left + window.scrollX > max) $(dd).css('left', Math.max(max, 0)).addClass('right');
    }, 0);
  }
  // Esc closes an open context menu (Unraid's only close on a click) and puts
  // focus back on what opened it - before any filter box's own Esc.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const $open = $('.dropdown-context:visible');
    if (!$open.length) return;
    e.preventDefault();
    e.stopPropagation();
    $open.hide();
    if (menuOpener && document.contains(menuOpener)) menuOpener.focus();
  }, true);

  window.ContainerViewMenus = function (ctx) {
    function runAction(action, cts, scope) {
      const plan = core.actionPlan(cts, action);
      if (!plan.names.length) return;
      const go = () => {
        $('div.spinner.fixed').show('slow');
        $.post(ACTIONS_API, {action, stacks: JSON.stringify(plan.stacks), containers: JSON.stringify(plan.containers), csrf_token: ctx.csrf}, null, 'json')
          .done((res) => {
            if (res.ok) return;
            const failed = res.steps.filter((st) => st.rc !== 0).map((st) => `${core.esc(st.cmd)}<br><small>${core.esc(st.output.join(' '))}</small>`);
            setTimeout(() => swal({title: tr('Execution error'), text: failed.join('<br><br>'), type: 'error', html: true}), 100);
          })
          .fail((xhr) => setTimeout(() => (xhr.status === 504
            // nginx gave up waiting (many sequential stops); actions.php
            // ignores the abort and carries on.
            ? swal({title: tr('Still working'), text: tr('This is taking a while; it carries on in the background. The list refreshes when you reload it.'), type: 'info'})
            : swal({title: tr('Execution error'), text: core.esc((xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText), type: 'error', html: true})), 100))
          .always(() => { $('div.spinner.fixed').hide('slow'); window.loadlist(); });
      };
      if (action === 'start' || action === 'unpause' || action === 'pause') { go(); return; }
      const verb = action === 'stop' ? tr('Stop') : tr('Restart');
      swal({title: `${verb} ${plan.names.length} ${tr(plan.names.length === 1 ? 'container' : 'containers')} ${tr('in')} ${core.esc(scope)}?`,
        text: nameList(plan.names), type: 'warning', html: true, showCancelButton: true,
        confirmButtonText: verb, cancelButtonText: tr('Cancel')}, (yes) => { if (yes !== false) go(); });
    }

    // --- category rules ------------------------------------------------------------
    // Categories for containers without the label, by stack / name / image
    // pattern (core.applyRules; precedence setting decides label vs rule). The
    // list lives on the flash (include/rules.php) and is replaced whole on each
    // change; the page re-applies it locally.
    const RULES_API = '/plugins/containerview/include/rules.php';
    const RULE_FIELDS = [['stack', 'Stack'], ['name', 'Name'], ['image', 'Image']];
    // As include/store.php cv_valid_category: what a label value can carry.
    const CAT_RE = /^[^,\x00-\x1f\x7f]{1,40}$/u;

    function saveRules(rules, $msg, done) {
      $.post(RULES_API, {rules: JSON.stringify(rules), csrf_token: ctx.csrf}, null, 'json')
        .done((res) => { ctx.rulesSaved(res.rules); done(); })
        .fail((xhr) => $msg.text((xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText));
    }

    // "Create / Edit category rule…" for containers (applyRules output) that
    // a rule would cover together - one container, or a stack's.
    function ruleItem(cts, ct) {
      const b = core.ruleBadge(cts);
      return b
        ? {text: `${tr('Edit category rule')}…`, icon: 'fa-tags', action: (e) => { e.preventDefault(); editRule(ctx.data().rules[b.index], b.index, ct); }}
        : {text: `${tr('Create category rule')}…`, icon: 'fa-tags', action: (e) => { e.preventDefault(); editRule(null, -1, ct); }};
    }

    // Containers (as served, i.e. with their labels) a rule would match.
    const ruleHits = (rule) => ctx.raw().containers.filter((c) => core.ruleMatches(rule, c));

    // New rule (index -1; prefilled from ct when given) or edit rules[index].
    function editRule(rule, index, ct, after) {
      const rules = (ctx.data().rules || []).slice();
      // From a stack (or a container in one): a stack rule - its containers go
      // with the stack. From any other container: name or image.
      const offered = RULE_FIELDS.filter(([f]) => !ct || (ct.stack ? f === 'stack' : f !== 'stack'));
      const value = (f) => (rule ? rule[f] || '' : !ct ? '' : f === 'image' ? `${ct.image.replace(/:[^/:]*$/, '')}*` : ct[f]);
      const first = (rule && offered.find(([f]) => rule[f])) || offered.find(([f]) => f === 'image') || offered[0];
      const known = core.categoryChips(ctx.data().containers, tr).filter((c) => c.key !== core.UNSORTED);
      const $dlg = $(`<div class='cv-rule'>` +
        `<p>${tr('Match containers by')}</p>` +
        offered.map(([f, label]) => `<label class='cv-rule-field'><input type='radio' name='cv-rule-field' value='${f}'${first[0] === f ? ' checked' : ''}> ` +
          `<span>${tr(label)}</span><input type='text' data-field='${f}' value="${core.esc(value(f))}" spellcheck='false'></label>`).join('') +
        `<p class='cv-rule-hint'>${tr('Whole value, any case;')} <code>*</code> ${tr('matches anything,')} <code>?</code> ${tr('one character')}</p>` +
        `<p><label>${tr('Categories')}<input type='text' class='cv-rule-cats' value="${core.esc(rule ? rule.categories.join(', ') : '')}" placeholder="${core.esc(tr('e.g. media, downloads'))}" spellcheck='false'></label></p>` +
        `<p class='cv-rule-hint'>${tr('Comma-separated; the first is the group it shows in.')}</p>` +
        (known.length ? `<p class='cv-rule-known'>${known.map((c) => `<span class='cv-tag' role='button' tabindex='0' data-cat="${core.esc(c.key)}">${core.esc(c.title)}</span>`).join('')}</p>` : '') +
        `<p class='cv-rule-preview'></p><p class='cv-rule-msg red-text'></p></div>`);
      const current = () => {
        const f = $dlg.find('input[name=cv-rule-field]:checked').val();
        const out = {[f]: $dlg.find(`input[data-field=${f}]`).val().trim()};
        out.categories = [...new Set($dlg.find('.cv-rule-cats').val().split(',').map((c) => c.trim()).filter(Boolean))];
        return out;
      };
      const preview = () => {
        const f = $dlg.find('input[name=cv-rule-field]:checked').val();
        $dlg.find('input[data-field]').each(function () { this.disabled = this.dataset.field !== f; });
        const r = current();
        const hits = r[f] ? ruleHits(r) : [];
        const labelled = ctx.settings.precedence === 'labels' ? hits.filter((c) => c.categories.length) : [];
        $dlg.find('.cv-rule-preview').html(
          `${tr('Matches')} ${hits.length} ${tr(hits.length === 1 ? 'container' : 'containers')}` +
          (hits.length ? `: ${hits.map((c) => core.esc(c.name)).join(', ')}` : '') +
          (labelled.length ? `<br><small>${labelled.length} ${tr(labelled.length === 1 ? 'has a category label, which wins' : 'have a category label, which wins')} ` +
            `(${tr('Settings')} › ${tr('Category precedence')}): ${labelled.map((c) => core.esc(c.name)).join(', ')}</small>` : ''));
      };
      $dlg.on('input change', 'input', preview);
      $dlg.on('click keydown', '.cv-rule-known [data-cat]', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const $cats = $dlg.find('.cv-rule-cats');
        const have = $cats.val().split(',').map((c) => c.trim()).filter(Boolean);
        if (!have.some((c) => c.toLowerCase() === this.dataset.cat.toLowerCase())) $cats.val([...have, this.dataset.cat].join(', '));
        preview();
      });
      const save = () => {
        const r = current();
        const $msg = $dlg.find('.cv-rule-msg');
        const f = RULE_FIELDS.map(([k]) => k).find((k) => k in r);
        if (!/^[A-Za-z0-9_.:/@*?-]{1,200}$/.test(r[f])) return $msg.text(tr('Pattern: letters, digits and _ . : / @ - * ? only'));
        if (!r.categories.length || r.categories.length > 10 || !r.categories.every((c) => CAT_RE.test(c))) {
          return $msg.text(tr('Categories: 1-10, each up to 40 characters, no commas'));
        }
        if (index < 0) rules.push(r); else rules[index] = r;
        saveRules(rules, $msg, () => { $dlg.dialog('close'); if (after) after(); });
      };
      $dlg.on('keydown', 'input[type=text]', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      $dlg.dialog({
        title: index < 0 ? tr('New category rule') : tr('Edit category rule'), modal: true, width: 520, resizable: false,
        open: () => { $dlg.parent().find('.ui-dialog-titlebar-close').css('display', 'none'); preview(); $dlg.find('.cv-rule-cats').trigger('focus'); },
        close: () => $dlg.dialog('destroy').remove(),
        buttons: [
          {text: tr('Save'), click: save},
          {text: tr('Cancel'), click() { $dlg.dialog('close'); if (after) after(); }},
        ],
      });
    }

    // Review, reorder (order = which rule's category is a container's home),
    // edit and remove rules. Each change is saved straight away.
    function listRules() {
      const $dlg = $(`<div class='cv-rules'><p class='cv-rule-hint'></p><table class='cv-rules-list'></table><p class='cv-rule-msg red-text'></p></div>`);
      const btn = (op, i, icon, title) => `<i class='fa ${icon}' role='button' tabindex='0' data-op='${op}' data-i='${i}' title="${core.esc(tr(title))}"></i>`;
      const paint = () => {
        const rules = ctx.data().rules || [];
        $dlg.find('.cv-rule-hint').text(ctx.settings.precedence === 'labels'
          ? tr('Rules apply to containers without a category label. Earlier rules come first.')
          : tr('Matching rules replace a container\'s category label. Earlier rules come first.'));
        $dlg.find('.cv-rules-list').html(rules.length ? rules.map((r, i) => {
          const hits = ruleHits(r);
          return `<tr><td>${core.esc(core.ruleText(r))}</td><td>→ ${r.categories.map((c) => core.esc(c)).join(', ')}</td>` +
            `<td title="${core.esc(hits.map((c) => c.name).join(', '))}"><small>${hits.length} ${tr(hits.length === 1 ? 'container' : 'containers')}</small></td>` +
            `<td class='cv-rule-ops'>${i > 0 ? btn('up', i, 'fa-arrow-up', 'Move up') : '<i class="fa fa-fw"></i>'}` +
            `${i < rules.length - 1 ? btn('down', i, 'fa-arrow-down', 'Move down') : '<i class="fa fa-fw"></i>'}` +
            `${btn('edit', i, 'fa-pencil', 'Edit')}${btn('del', i, 'fa-trash', 'Remove')}</td></tr>`;
        }).join('') : `<tr><td>${tr('No rules yet. Add one here, or with "Create category rule…" in a container\'s menu.')}</td></tr>`);
      };
      const reopen = () => listRules();
      $dlg.on('click keydown', '[data-op]', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const i = Number(this.dataset.i);
        const rules = (ctx.data().rules || []).slice();
        const $msg = $dlg.find('.cv-rule-msg');
        if (this.dataset.op === 'edit') { $dlg.dialog('close'); editRule(rules[i], i, null, reopen); return; }
        if (this.dataset.op === 'del') rules.splice(i, 1);
        else { const j = this.dataset.op === 'up' ? i - 1 : i + 1; [rules[i], rules[j]] = [rules[j], rules[i]]; }
        saveRules(rules, $msg, paint);
      });
      paint();
      $dlg.dialog({
        title: tr('Category rules'), modal: true, width: 640, resizable: false,
        open: () => $dlg.parent().find('.ui-dialog-titlebar-close').css('display', 'none'),
        close: () => $dlg.dialog('destroy').remove(),
        buttons: [
          {text: `${tr('Add rule')}…`, click() { $dlg.dialog('close'); editRule(null, -1, null, reopen); }},
          {text: tr('Close'), click() { $dlg.dialog('close'); }},
        ],
      });
    }

    // Start/Stop/Restart/Pause/Resume all, each only when it would affect something.
    function actionItems(cts, scope) {
      const count = (action) => core.actionPlan(cts, action).names.length;
      const item = (action, label, icon) => (count(action)
        ? [{text: `${label} (${count(action)})`, icon, action: (e) => { e.preventDefault(); runAction(action, cts, scope); }}] : []);
      return [
        ...item('start', tr('Start all'), 'fa-play'),
        ...item('stop', tr('Stop all'), 'fa-stop'),
        ...item('restart', tr('Restart all'), 'fa-refresh'),
        ...item('pause', tr('Pause all'), 'fa-pause'),
        ...item('unpause', tr('Resume all'), 'fa-play-circle'),
      ];
    }

    // A stack menu's rule item, after a divider when there are items above it.
    const stackRuleItems = (cts, stack, divider) =>
      [...(divider ? [{divider: true}] : []), ruleItem(cts, {stack, name: '', image: ''})];

    // Unraid's updater, started straight into Unraid's own background mode -
    // what its progress window (openDocker) does when you close it: the
    // command runs detached (StartCommand.php), a banner says it continues in
    // the background (with Unraid's abort icon), and bannerAlert() polls until
    // it ends, then calls loadlist(). pid 0: another update is still running.
    function updateInBackground(names) {
      const cmd = 'update_container ' + names.map(encodeURIComponent).join('*');
      $.post('/webGui/include/StartCommand.php', {cmd, start: 0}, (pid) => {
        if (pid == 0) {
          swal({title: tr('Update'), text: tr('Another container update is still running - try again when it has finished.'), type: 'warning'});
          return;
        }
        const n = names.length;
        // StartCommand launches it after `sleep .3`; polling before then would
        // find nothing running and end the banner at once.
        setTimeout(() => bannerAlert(`${tr('Updating')} ${n} ${tr(n === 1 ? 'container' : 'containers')} ${tr('in the background')} [${String(pid).padStart(8, '0')}]` +
          `<i class='fa fa-bomb fa-fw abortOps' title="${core.esc(tr('Abort background process'))}" onclick='abortOperation(${Number(pid)})'></i>`,
          cmd, '', 'loadlist', 0), 1000);
      });
    }

    // Update containers with Unraid's own updater, picked in a dialog: every
    // template container among cts with an update ready, all ticked; compose
    // ones listed greyed as skipped (they update with their stack). scope:
    // what the containers are, for the title ('' for none).
    function updatePicker(cts, scope) {
      const plan = core.updatePlan(cts);
      if (!plan.names.length) return;
      const icon = (name) => { const ct = cts.find((c) => c.name === name); return ct && ct.icon ? core.iconHtml(ct.icon) : ''; };
      const $dlg = $(`<div class='cv-updpick'>` +
        `<p class='cv-up-tools'><span class='cv-mode'><span class='cv-chip' role='button' tabindex='0' data-all='1'>${tr('All')}</span>` +
        `<span class='cv-chip' role='button' tabindex='0' data-all='0'>${tr('None')}</span></span></p><div class='cv-up-list'>` +
        plan.names.map((n) => `<label><input type='checkbox' value="${core.esc(n)}" checked>${icon(n)}${core.esc(n)}</label>`).join('') +
        plan.skipped.map((n) => `<label class='cv-up-skip' title="${core.esc(tr('Compose-managed: update its stack instead'))}">` +
          `<input type='checkbox' disabled>${icon(n)}${core.esc(n)} <small>(${tr('compose - update the stack')})</small></label>`).join('') +
        `</div><p class='cv-up-msg'></p>` +
        `<p class='cv-up-bg'><label><input type='checkbox' class='cv-up-bgbox' checked> ${tr('Update in the background')}</label></p></div>`);
      const picked = () => $dlg.find('.cv-up-list input:checked').map((i, el) => el.value).get();
      const refresh = () => {
        const n = picked().length;
        $dlg.find('.cv-up-msg').text(`${n} ${tr(n === 1 ? 'container' : 'containers')} ${tr('will be updated')}`);
        $dlg.parent().find('.cv-up-go').button(n ? 'enable' : 'disable');
      };
      $dlg.on('change', '.cv-up-list input', refresh);
      $dlg.on('click keydown', '[data-all]', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        $dlg.find('.cv-up-list input:not(:disabled)').prop('checked', this.dataset.all === '1');
        refresh();
      });
      const total = plan.names.length;
      $dlg.dialog({
        title: `${tr('Update')} ${total} ${tr(total === 1 ? 'container' : 'containers')}${scope ? ` ${tr('in')} ${scope}` : ''}`,
        modal: true, width: 440, resizable: false,
        open: () => { $dlg.parent().find('.ui-dialog-titlebar-close').css('display', 'none'); refresh(); },
        close: () => $dlg.dialog('destroy').remove(),
        buttons: [
          {text: tr('Update'), class: 'cv-up-go', click() {
            const names = picked();
            const background = $dlg.find('.cv-up-bgbox').prop('checked');
            $dlg.dialog('close');
            if (!names.length) return;
            // Unchecked: Unraid's own progress window, with the live log.
            if (background) updateInBackground(names);
            else openDocker('update_container ' + names.map(encodeURIComponent).join('*'), tr('Updating all Containers'), '', 'loadlist');
          }},
          {text: tr('Cancel'), click() { $dlg.dialog('close'); }},
        ],
      });
    }

    // --- groups ------------------------------------------------------------------

    // A group's menu: its actions, Update all (the picker) and Change icon.
    function groupMenuItems(cts, group, scope) {
      const items = actionItems(cts, scope);
      const updates = core.updatePlan(cts).names.length;
      if (updates) items.push({divider: true}, {text: `${tr('Update all')} (${updates})`, icon: 'fa-cloud-download', action: (e) => { e.preventDefault(); updatePicker(cts, scope); }});
      items.push({divider: true}, {text: `${tr('Change icon')}…`, icon: 'fa-picture-o', action: (e) => { e.preventDefault(); pickGroupIcon(group, scope); }});
      return items;
    }

    function pickGroupIcon(group, title) {
      const current = core.groupIcon(group, ctx.data().groupIcons || {});
      const def = core.groupIcon(group);
      let saving = false; // a double click would post twice
      const save = (icon) => {
        if (saving) return;
        saving = true;
        $.post(ICONS_API, {kind: 'group', group, icon, csrf_token: ctx.csrf}, null, 'json')
          .done((res) => { $dlg.dialog('close'); ctx.iconsSaved({groupIcons: res.groupIcons}); })
          .fail((xhr) => { saving = false; $dlg.find('.cv-ip-msg').text(failText(xhr)); });
      };
      const $dlg = $(`<div class='cv-iconpick'><div class='cv-ip-grid'>` +
        // data-cv-icon, not data-icon: Unraid styles [data-icon]:before with its
        // docker-icon font (!important), which turns every glyph into a box.
        core.ICON_CHOICES.map((i) => `<i class='fa ${i}${i === current ? ' cv-on' : ''}' data-cv-icon='${i}' role='button' tabindex='0' title='${i.slice(3)}'></i>`).join('') +
        `</div><p class='cv-ip-msg red-text'></p></div>`);
      $dlg.on('click', '[data-cv-icon]', function () { save(this.dataset.cvIcon); });
      $dlg.on('keydown', '[data-cv-icon]', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); save(this.dataset.cvIcon); } });
      $dlg.dialog({
        title: `${tr('Icon for')} ${title}`, modal: true, width: 460, resizable: false,
        // Cancel is enough; hide the title-bar close the way Unraid's own dialogs do.
        open: () => $dlg.parent().find('.ui-dialog-titlebar-close').css('display', 'none'),
        close: () => $dlg.dialog('destroy').remove(),
        buttons: [
          {text: `${tr('Default')} (${def.slice(3)})`, click() { save(''); }},
          {text: tr('Cancel'), click() { $dlg.dialog('close'); }},
        ],
      });
    }

    // --- Unraid's own container menu ------------------------------------------
    // Wraps the native addDockerContainerContext() (docker.js) to slip our
    // items in above Remove as it attaches the menu: "Create / Edit category
    // rule…" for containers outside a 2+ stack (members go with the stack's
    // rule, in its menu), and "Use icon for stack" for members. Call once
    // docker.js has loaded; safe to call again.
    function wrapContainerMenu() {
      const nativeMenu = window.addDockerContainerContext;
      if (typeof nativeMenu !== 'function' || nativeMenu.cvWrapped) return;
      const wrapped = function (container) {
        const data = ctx.data();
        const ct = data && data.containers.find((c) => c.name === container);
        if (!ct) return nativeMenu.apply(this, arguments);
        const inStack = ct.stack && ct.service && data.containers.filter((c) => c.stack === ct.stack).length > 1;
        const realAttach = context.attach;
        // Unraid's own menu: Esc mustn't refocus (and scroll to) the last
        // group/stack icon we opened.
        menuOpener = null;
        context.attach = (sel, opts) => {
          const at = opts.findIndex((o) => o.text === tr('Remove'));
          const ours = inStack ? [] : [ruleItem([ct], ct)];
          if (inStack) ours.push({text: tr('Use icon for stack'), icon: 'fa-picture-o', action: (e) => {
            e.preventDefault();
            $.post(ICONS_API, {kind: 'stack', stack: ct.stack, service: ct.service, csrf_token: ctx.csrf}, null, 'json')
              .done((res) => ctx.iconsSaved({stackIcons: res.stackIcons}))
              .fail((xhr) => swal({title: tr('Use icon for stack'), text: failText(xhr), type: 'error'}));
          }});
          opts.splice(at < 0 ? opts.length : at, 0, ...ours);
          return realAttach(sel, opts);
        };
        try { return nativeMenu.apply(this, arguments); } finally { context.attach = realAttach; }
      };
      wrapped.cvWrapped = true;
      window.addDockerContainerContext = wrapped;
    }

    return {nameList, runAction, updatePicker, actionItems, stackRuleItems, ruleItem, editRule, listRules,
      groupMenuItems, pickGroupIcon, wrapContainerMenu, openMenu};
  };
  window.ContainerViewMenus.openMenu = openMenu;
})();
