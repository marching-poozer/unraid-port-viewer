<?php
// Shared helpers: enumerate installed plugins and their .page files, parse
// each file's header block the same way Unraid's own PageBuilder.php does
// (Key="Value" lines above the '---' separator - find_pages()/the xmenu tab
// loop in DefaultPageLayout.php), and the rename-based enable/disable
// primitive itself. There's no persistent config of our own - which .page
// files exist vs. which are suffixed .disabled IS the state, and it already
// resets itself on reboot since /usr/local is rebuilt from the boot flash's
// plugin archives every time.

define('PD_PLUGINS_DIR', '/usr/local/emhttp/plugins');
define('PD_FLASH_PLUGINS_DIR', '/boot/config/plugins');
define('PD_OWN_PLUGIN', 'plugindisabler');
// dynamix.plugin.manager provides the native "Plugins" page this tool's own
// "Manage" tab lives inside - disabling any of its pages would strand the
// user without the one page that could re-enable things short of a reboot.
define('PD_GUARDED_PLUGINS', ['dynamix.plugin.manager', PD_OWN_PLUGIN]);

// Hardcoded path, not $docroot: common.php is required both from a
// bootstrapped .page render (where $docroot exists) and from our own
// standalone AJAX scripts (where it doesn't).
require_once '/usr/local/emhttp/webGui/include/MarkdownExtra.inc.php';

function pd_list_plugin_dirs(): array {
    $dirs = glob(PD_PLUGINS_DIR . '/*', GLOB_ONLYDIR) ?: [];
    $names = array_map('basename', $dirs);
    sort($names, SORT_NATURAL | SORT_FLAG_CASE);
    return array_values(array_diff($names, PD_GUARDED_PLUGINS));
}

// Parses the header block of a .page (or .page.disabled) file: lines of
// Key="Value" or Key='Value' above the '---' separator.
function pd_parse_page_header(string $path): array {
    $fh = fopen($path, 'r');
    if (!$fh) return [];
    $header = [];
    while (($line = fgets($fh)) !== false) {
        $line = rtrim($line, "\r\n");
        if ($line === '---') break;
        if (preg_match('/^([A-Za-z]+)=(["\'])(.*)\2$/', $line, $m)) {
            $header[$m[1]] = $m[3];
        }
    }
    fclose($fh);
    return $header;
}

function pd_describe_page(string $path, string $file, bool $disabled): array {
    $header = pd_parse_page_header($path);
    return [
        'file' => $file,
        'title' => $header['Title'] ?? preg_replace('/\.page$/', '', $file),
        'menu' => isset($header['Menu']) ? strtok($header['Menu'], ':') : null,
        'disabled' => $disabled,
    ];
}

function pd_plugin_pages(string $plugin): array {
    $dir = PD_PLUGINS_DIR . '/' . $plugin;
    $pages = [];
    foreach (glob("$dir/*.page") ?: [] as $path) {
        $pages[] = pd_describe_page($path, basename($path), false);
    }
    foreach (glob("$dir/*.page.disabled") ?: [] as $path) {
        $pages[] = pd_describe_page($path, basename($path, '.disabled'), true);
    }
    usort($pages, fn($a, $b) => strnatcasecmp($a['file'], $b['file']));
    return $pages;
}

// Validates a plugin/file name against our own enumeration (not
// client-supplied path traversal) and resolves to whichever of
// Foo.page / Foo.page.disabled currently exists on disk.
function pd_resolve_page_path(string $plugin, string $file): string {
    if (in_array($plugin, PD_GUARDED_PLUGINS, true)) {
        throw new Exception("$plugin is not manageable here.");
    }
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $plugin) || !preg_match('/^[A-Za-z0-9._-]+\.page$/', $file)) {
        throw new Exception('Invalid plugin or page name.');
    }
    $base = realpath(PD_PLUGINS_DIR);
    $pluginDir = realpath("$base/$plugin");
    if (!$pluginDir || strncmp($pluginDir, $base, strlen($base)) !== 0) {
        throw new Exception('Unknown plugin.');
    }
    $enabled = "$pluginDir/$file";
    $disabled = "$enabled.disabled";
    if (is_file($enabled)) return $enabled;
    if (is_file($disabled)) return $disabled;
    throw new Exception('Unknown page file.');
}

function pd_set_page_disabled(string $plugin, string $file, bool $disabled): void {
    $path = pd_resolve_page_path($plugin, $file);
    $isCurrentlyDisabled = str_ends_with($path, '.disabled');
    if ($disabled === $isCurrentlyDisabled) return; // already in the requested state
    $target = $disabled ? "$path.disabled" : substr($path, 0, -strlen('.disabled'));
    if (!rename($path, $target)) {
        throw new Exception("Could not rename $file.");
    }
}

// Whether a plugin was separately installed (has its own flash-backed .plg
// manifest) vs. bundled with the base OS (most dynamix.* directories -
// though not all: dynamix.unraid.net, for one, is a real separately-updated
// plugin despite the name). This is the exact same distinction
// dynamix.plugin.manager's own Installed Plugins tab draws - its
// ShowPlugins.php enumerates /var/log/plugins/*.plg, itself populated from
// these same flash files - so "installed" here always matches what that
// tab already shows, with no hand-maintained list to keep in sync.
function pd_plugin_meta(string $name): array {
    $path = PD_FLASH_PLUGINS_DIR . "/$name.plg";
    if (!is_file($path)) return ['installed' => false];
    libxml_use_internal_errors(true);
    $xml = @simplexml_load_file($path, 'SimpleXMLElement', LIBXML_NOENT);
    if (!$xml) return ['installed' => false];
    $a = $xml->attributes();
    return [
        'installed' => true,
        'author' => (string) ($a['author'] ?? ''),
        'icon' => (string) ($a['icon'] ?? ''),
        'launch' => (string) ($a['launch'] ?? ''),
    ];
}

// Mirrors ShowPlugins.php's own icon resolution, so an installed plugin's
// row here uses the same icon as its row on the native Installed Plugins
// tab - except the final fallback, which is a Font Awesome glyph instead of
// dynamix.plugin.manager's own stock PNG: that file doesn't actually exist
// on every Unraid version (confirmed missing on 7.1.2), so depending on it
// would just trade one broken image for another.
function pd_plugin_icon_html(string $name, string $icon, string $launch): string {
    $fallback = "<i class='fa fa-plug list'></i>";
    if ($icon !== '') {
        if (substr($icon, -4) === '.png') {
            if (is_file(PD_PLUGINS_DIR . "/$name/images/$icon")) {
                $html = "<img src='/plugins/$name/images/$icon' class='list'>";
            } elseif (is_file(PD_PLUGINS_DIR . "/$name/$icon")) {
                $html = "<img src='/plugins/$name/$icon' class='list'>";
            } else {
                $html = $fallback;
            }
        } elseif (substr($icon, 0, 5) === 'icon-') {
            $html = "<i class='$icon list'></i>";
        } else {
            $cls = substr($icon, 0, 3) === 'fa-' ? $icon : "fa-$icon";
            $html = "<i class='fa $cls list'></i>";
        }
    } else {
        $html = $fallback;
    }
    return $launch ? "<a href='/$launch' class='list'>$html</a>" : $html;
}

// Markdown passes raw inline HTML straight through, and a plugin's own
// README can contain real executable content - folder.view3's literally
// embeds <script> tags for a live-translated i18n widget. Harmless on its
// own install page rendered once, but this tab reloads its whole list
// after every toggle, and jQuery's .html() re-executes embedded <script>
// tags on every single reload - the second run throws "already declared"
// on folder.view3's own top-level const. Strip script/style blocks and
// anything else outside a safe inline subset before this ever reaches the
// browser, rather than trusting arbitrary README content to behave.
function pd_sanitize_description_html(string $html): string {
    $html = preg_replace('#<(script|style)\b[^>]*>.*?</\1>#is', '', $html);
    $allowed = '<p><br><strong><em><b><i><a><ul><ol><li><code><pre><blockquote><h1><h2><h3><h4><h5><h6>';
    $html = strip_tags($html, $allowed);
    $html = preg_replace('/\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
    $html = preg_replace('/(href\s*=\s*["\'])\s*javascript:/i', '$1#', $html);
    return $html;
}

// Fallback display name synthesized from the plugin's own directory name
// ("open.files" -> "Open Files"), used only when pd_extract_heading() below
// finds no heading to pull the real one from - e.g. "ca.cleanup.appdata"
// would naively title-case to "Ca Cleanup Appdata" rather than "CA Cleanup
// Appdata", so the README's own heading (when there is one) is preferred.
function pd_friendly_name(string $name): string {
    $words = preg_split('/[._-]+/', $name, -1, PREG_SPLIT_NO_EMPTY);
    return implode(' ', array_map('ucfirst', $words));
}

// Pulls a leading heading (H1-H6) off the front of already-sanitized
// description HTML, so it can be shown once, combined with the plugin's
// id, instead of appearing a second time as the first line of the
// description below it. Only matches when the heading is the very first
// thing in the HTML - README structure varies too much to go hunting for
// one elsewhere - so a README that doesn't open with a heading just falls
// through to pd_friendly_name()'s synthesized name instead. Checks two
// shapes: a real <h1>-<h6> (e.g. appdata.backup's "#### Appdata Backup"),
// and a lone bolded first paragraph (e.g. dynamix.s3.sleep's own README
// opens with "**Dynamix S3 Sleep**", which Markdown renders as
// <p><strong>...</strong></p>, not a heading tag at all) - both are the
// same "title line" convention as far as a README author is concerned.
function pd_extract_heading(string $html): array {
    if (preg_match('#^\s*<(h[1-6])>(.*?)</\1>\s*#is', $html, $m)) {
        return [trim(strip_tags($m[2])), substr($html, strlen($m[0]))];
    }
    if (preg_match('#^\s*<p>\s*<strong>(.*?)</strong>\s*</p>\s*#is', $html, $m)) {
        return [trim(strip_tags($m[1])), substr($html, strlen($m[0]))];
    }
    return [null, $html];
}

// The plugin's own README.md rendered as markdown, or empty when it has
// none - the friendly name above already covers the no-README case, so
// there's no need for a redundant "**name**" fallback here any more.
function pd_description_html(string $name): string {
    $readme = PD_PLUGINS_DIR . "/$name/README.md";
    if (!is_file($readme)) return '';
    return pd_sanitize_description_html(Markdown(file_get_contents($readme)));
}
