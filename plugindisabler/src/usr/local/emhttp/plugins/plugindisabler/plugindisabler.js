(function ($) {
  const CSRF = window.PD_CSRF_TOKEN || '';
  const TOGGLE_URL = '/plugins/plugindisabler/include/manage.php?action=toggle';
  const RENDER_URL = '/plugins/plugindisabler/include/render.php';
  const COOKIE = 'plugindisabler_view_mode';

  function currentMode() {
    return $.cookie(COOKIE) === 'advanced' ? 'advanced' : 'basic';
  }

  // POST as real form fields, not JSON: Unraid's own auto_prepend_file
  // rejects any POST whose csrf_token isn't in $_POST before our PHP even
  // runs, so the token (and the rest of the payload, JSON-encoded inside
  // the 'data' field) has to travel that way instead.
  function toggle(plugin, file, disabled) {
    return $.post(TOGGLE_URL, {
      csrf_token: CSRF,
      data: JSON.stringify({ plugin: plugin, file: file, disabled: disabled }),
    });
  }

  function wireRows() {
    $('#pd_list .pd-components-toggle').on('click', function () {
      const $btn = $(this);
      $('tr[data-group="' + $btn.data('target') + '"]').slideToggle('fast');
      $btn.find('i').toggleClass('fa-chevron-right fa-chevron-down');
      $btn.attr('aria-expanded', $btn.attr('aria-expanded') === 'true' ? 'false' : 'true');
    });

    $('#pd_list .pd-toggle').on('change', function () {
      const $input = $(this);
      const plugin = $input.data('plugin');
      const file = $input.data('file') || null;
      const disabled = !$input.is(':checked');
      $input.prop('disabled', true);
      toggle(plugin, file, disabled)
        .fail(function (xhr) {
          const data = xhr.responseJSON;
          alert('Could not update ' + plugin + ': ' + ((data && data.error) || 'request failed'));
        })
        .always(loadList);
    });
  }

  function loadList() {
    $.get(RENDER_URL, { mode: currentMode() }, function (html) {
      $('#pd_list').html(html);
      // Guarded, not assumed: Unraid pages that use .readmore() elsewhere
      // never load it themselves either, so it's presumably bundled in
      // dynamix.js - but .switchButton() looked the same way and turned
      // out not to be, so don't trust that pattern a second time.
      if (typeof $.fn.readmore === 'function') {
        $('.desc_readmore').readmore({
          maxHeight: 60,
          moreLink: "<a href='#'><i class='fa fa-chevron-down'></i></a>",
          lessLink: "<a href='#'><i class='fa fa-chevron-up'></i></a>",
        });
      }
      // Same native pill-switch look as the advanced-view toggle, applied
      // per row. jquery.switchbutton.js has no concept of a disabled
      // state at all (confirmed by reading its source - the word
      // "disabled" doesn't appear in it): it binds clicks directly to the
      // slider elements it generates, which happily fire regardless of
      // the underlying checkbox's disabled attribute. So read-only rows
      // (system plugins) need that enforced by hand - pointer-events:none
      // plus a dimmed look on whatever wraps the generated switch.
      if (typeof $.fn.switchButton === 'function') {
        $('#pd_list .pd-toggle').each(function () {
          const $input = $(this);
          $input.switchButton();
          if ($input.is(':disabled')) $input.parent().addClass('pd-readonly');
        });
      }
      wireRows();
    });
  }

  $(function () {
    // jquery.switchbutton.js is loaded explicitly by Manage.page itself
    // (it isn't actually part of Unraid's always-loaded bundle, despite
    // other native Settings pages calling .switchButton() with no script
    // tag of their own) - still guarded here so a missing/renamed asset in
    // some future Unraid version degrades to a plain checkbox instead of
    // throwing and aborting the rest of this init block, which is exactly
    // what silently broke loadList() before this was added.
    if (typeof $.fn.switchButton === 'function') {
      $('.pd-advancedview').switchButton({
        labels_placement: 'left',
        on_label: 'Advanced View',
        off_label: 'Basic View',
        checked: currentMode() === 'advanced',
      });
    }
    $('.pd-advancedview').on('change', function () {
      $.cookie(COOKIE, $(this).is(':checked') ? 'advanced' : 'basic', { expires: 3650 });
      loadList();
    });
    loadList();
  });
})(jQuery);
