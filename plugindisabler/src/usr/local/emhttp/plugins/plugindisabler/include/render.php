<?
// Renders the <tr> rows for #pd_list, hit via $.get() from
// plugindisabler.js - the same way dynamix.plugin.manager's own
// ShowPlugins.php renders #plugin_list for the Installed Plugins tab.
// Reusing that same row shape (icon / name+description / author) under the
// 'unraid tablesorter plugins' classes is what makes this tab look native
// instead of bolted on, rather than hand-rolling our own styling.
$docroot ??= ($_SERVER['DOCUMENT_ROOT'] ?: '/usr/local/emhttp');
require_once "$docroot/webGui/include/Helpers.php";
require_once __DIR__ . '/common.php';

$mode = _var($_GET, 'mode') === 'advanced' ? 'advanced' : 'basic';
$empty = true;

foreach (pd_list_plugin_dirs() as $name) {
    $pages = pd_plugin_pages($name);
    if (!$pages) continue;
    $meta = pd_plugin_meta($name);
    // Basic view (the default) only shows plugins someone actually
    // installed - bundled base-OS pieces (most dynamix.* directories) stay
    // out of the way unless Advanced View is switched on.
    if ($mode === 'basic' && !$meta['installed']) continue;

    $empty = false;
    $multi = count($pages) > 1;
    $disabledCount = count(array_filter($pages, fn($p) => $p['disabled']));
    $rowId = 'pd-' . preg_replace('/[^a-zA-Z0-9]/', '-', $name);
    $nameEsc = htmlspecialchars($name);

    $icon = pd_plugin_icon_html($name, $meta['icon'] ?? '', $meta['launch'] ?? '');
    // The README's own heading (when it has one) is the real display name
    // ("CA Cleanup Appdata") - pd_friendly_name()'s slug-derived guess
    // ("Ca Cleanup Appdata") is only a fallback for READMEs that don't
    // open with one. Either way it's shown once, paired with the id, not
    // also repeated as the description's own first line.
    [$heading, $desc] = pd_extract_heading(pd_description_html($name));
    $friendlyEsc = htmlspecialchars($heading ?: pd_friendly_name($name));
    $author = $meta['installed']
        ? htmlspecialchars($meta['author'] ?: 'anonymous')
        : "<span class='pd-system-tag'>System plugin</span>";

    $toggleAttrs = $meta['installed'] ? '' : " disabled title='Part of the base OS - cannot be disabled here'";
    $checked = $disabledCount === 0 ? 'checked' : '';

    // The expand control lives below the description as its own
    // "> Components" label, not a chevron sitting next to the plugin name
    // up top - that read as controlling the description right next to it
    // (which has its own, separate readmore expand/collapse chevron when
    // long enough to truncate), when what it actually reveals is the
    // per-page toggle list further down.
    $componentsToggle = $multi
        ? "<div class='pd-components-toggle' data-target='$rowId' role='button' tabindex='0' aria-expanded='false' title='Show {$friendlyEsc}&#39;s individual pages' aria-label='Show {$friendlyEsc}&#39;s individual pages'><i class='fa fa-chevron-right'></i> Components</div>"
        : '';

    echo "<tr>";
    echo "<td>$icon</td>";
    echo "<td><strong>$friendlyEsc</strong> <span class='pd-plugin-id'>($nameEsc)</span><span class='desc_readmore' style='display:block'>$desc</span>$componentsToggle</td>";
    echo "<td>$author</td>";
    echo "<td><input type='checkbox' class='pd-toggle' data-plugin='$nameEsc' $checked$toggleAttrs></td>";
    echo "</tr>";

    if ($multi) {
        // Real sibling <tr>s of the SAME outer table (not a nested <table>
        // per group - that computed independent column widths per group,
        // which is what made different groups' toggles land at different x
        // positions). The label+toggle pair lives in a fixed-width grid
        // (plugindisabler.css) rather than spreading across the parent's
        // own Author/Enabled columns or sizing to each row's own content -
        // a fixed label column is what makes every toggle land at the same
        // x regardless of label length, without the wrapping a flexible
        // width forced on longer labels. The label's title attribute
        // carries the untruncated text for anything the fixed width clips.
        foreach ($pages as $pg) {
            $fileEsc = htmlspecialchars($pg['file']);
            $titleText = $pg['title'] . ($pg['menu'] ? " ({$pg['menu']})" : '');
            $label = htmlspecialchars($pg['title']) . ($pg['menu'] ? " <span class='pd-page-menu'>(" . htmlspecialchars($pg['menu']) . ')</span>' : '');
            $pgAttrs = $meta['installed'] ? '' : ' disabled';
            $pgChecked = $pg['disabled'] ? '' : 'checked';
            // The toggle sits inside its own wrapper span, not as a direct
            // grid child: switchButton() inserts extra sibling elements
            // around the checkbox (OFF/slider/ON) rather than just
            // restyling it in place, and with only 2 explicit grid columns
            // those extra siblings were overflowing onto an implicit
            // second row. Wrapping keeps the grid to exactly 2 real items
            // regardless of what switchButton() does inside that wrapper.
            echo "<tr class='pd-subrow' data-group='$rowId' style='display:none'><td></td><td colspan='3'><div class='pd-page-row'><span class='pd-page-label' title='" . htmlspecialchars($titleText) . "'>$label</span><span class='pd-toggle-wrap'><input type='checkbox' class='pd-toggle' data-plugin='$nameEsc' data-file='$fileEsc' $pgChecked$pgAttrs></span></div></td></tr>";
        }
    }
}

if ($empty) {
    echo "<tr><td colspan='4' style='text-align:center;padding-top:12px'><i class='fa fa-check-square-o icon'></i> No plugins to show</td></tr>";
}
