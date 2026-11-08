<?PHP
// JSON feed behind containerview.js. Carries the same per-container data that
// dynamix.docker.manager/include/DockerContainers.php renders as HTML rows,
// plus each container's category label, so the browser can build (and later
// group/filter) its own rows instead of receiving finished HTML.
//
// Row markup must stay identical to the native list (other plugins read it),
// so the Tailscale status tooltip is built by the native code itself, copied
// verbatim below, and passed through as ready-made HTML.

$docroot ??= ($_SERVER['DOCUMENT_ROOT'] ?: '/usr/local/emhttp');
require_once "$docroot/webGui/include/Helpers.php";
require_once "$docroot/plugins/dynamix.docker.manager/include/DockerClient.php";

// Same translation context the native list uses, so status/uptime strings
// come out in the WebGUI's language.
$_SERVER['REQUEST_URI'] = 'docker';
require_once "$docroot/webGui/include/Translations.php";

const CV_CATEGORY_LABEL = 'net.unraid.docker.category';

header('Content-Type: application/json');

$DockerClient    = new DockerClient();
$DockerTemplates = new DockerTemplates();
$containers      = $DockerClient->getDockerContainers();
$images          = $DockerClient->getDockerImages();
$user_prefs      = $dockerManPaths['user-prefs'];
$autostart_file  = $dockerManPaths['autostart-file'];

// getDockerContainers() keeps only the labels Unraid itself uses; one list
// call (no per-container inspect) gives us everyone's full label set.
$labels = [];
foreach ($DockerClient->getDockerJSON('/containers/json?all=1') as $ct) {
  // Same 12-char short id getDockerContainers() uses (its extractID() is private).
  $labels[substr($ct['Id'], 0, 12)] = $ct['Labels'] ?? [];
}

if (file_exists($user_prefs)) {
  $prefs = (array)@parse_ini_file($user_prefs);
  $sort = [];
  foreach ($containers as $ct) $sort[] = array_search($ct['Name'],$prefs);
  array_multisort($sort,SORT_NUMERIC,$containers);
  unset($sort);
}

$host      = DockerUtil::host();
$allInfo   = $DockerTemplates->getAllInfo();
$autostart = (array)@file($autostart_file,FILE_IGNORE_NEW_LINES);
$names     = array_map('var_split',$autostart);

// --- copied verbatim from DockerContainers.php (Tailscale status) ---
// Grab Tailscale json from container
function tailscale_stats($name) {
  exec("docker exec -i ".$name." /bin/sh -c \"tailscale status --json | jq '{Self: .Self, ExitNodeStatus: .ExitNodeStatus, Version: .Version}'\" 2>/dev/null", $TS_stats);
  if (!empty($TS_stats)) {
    $TS_stats = implode("\n", $TS_stats);
    return json_decode($TS_stats, true);
  }
  return '';
}

// Download Tailscal JSON and return Array, refresh file if older than 24 hours
function tailscale_json_dl($file, $url) {
  $dl_status = 0;
  if (!is_dir('/tmp/tailscale')) {
    mkdir('/tmp/tailscale', 0777, true);
  }
  if (!file_exists($file)) {
    exec("wget -T 3 -q -O ".$file." ".$url, $output, $dl_status);
  } else {
    $fileage =  time() - filemtime($file);
    if ($fileage > 86400) {
      unlink($file);
      exec("wget -T 3 -q -O ".$file." ".$url, $output, $dl_status);
    }
  }
  if ($dl_status === 0) {
    return json_decode(@file_get_contents($file), true);
  } elseif ($dl_status === 0 && is_file($file)) {
    return json_decode(@file_get_contents($file), true);
  } else {
    unlink($file);
    return '';
  }
}

// Grab Tailscale DERP map JSON
$TS_derp_url = 'https://login.tailscale.com/derpmap/default';
$TS_derp_file = '/tmp/tailscale/tailscale-derpmap.json';
$TS_derp_list = tailscale_json_dl($TS_derp_file, $TS_derp_url);

// Grab Tailscale version JSON
$TS_version_url = 'https://pkgs.tailscale.com/stable/?mode=json';
$TS_version_file = '/tmp/tailscale/tailscale-latest-version.json';
// Extract tarbal version string
$TS_latest_version = tailscale_json_dl($TS_version_file, $TS_version_url);
if (!empty($TS_latest_version)) {
  $TS_latest_version = $TS_latest_version["TarballsVersion"];
}
// --- end copy ---

// Copied from DockerContainers.php so uptime/created read identically.
function cv_lang_time($text) {
  [$number, $text] = my_explode(' ',$text,2);
  return sprintf(_("%s $text"),$number);
}
function cv_lang_log($text) {
  global $language;
  if (isset($language['healthy'])) $text = str_replace('healthy',$language['healthy'],$text);
  if (isset($language['Exited'])) $text = str_replace('Exited',$language['Exited'],$text);
  if (strpos($text,'ago')!==false) {
    [$t1,$t2] = my_explode(') ',$text);
    return $t1.'): '.cv_lang_time($t2);
  }
  return _(_($text),2);
}

function cv_categories(array $labels): array {
  $raw = $labels[CV_CATEGORY_LABEL] ?? '';
  $out = [];
  foreach (explode(',', (string)$raw) as $c) {
    $c = trim($c);
    if ($c !== '' && !in_array($c, $out, true)) $out[] = $c;
  }
  return $out;
}

$out = [];
foreach ($containers as $ct) {
  $name = $ct['Name'];
  $id = $ct['Id'];
  $info = $allInfo[$name] ?? [];
  $running = !empty($info['running']);
  $composestack = $ct['ComposeProject'] ?? '';

  // Native stamps the mtime of $info['icon'] (empty for the question-mark
  // fallback, i.e. the docroot itself) - kept identical on purpose.
  $icon = ($info['icon'] ?? '') ?: '/plugins/dynamix.docker.manager/images/question.png';
  if (substr($icon,-4)=='.png') $icon .= '?'.@filemtime("$docroot".($info['icon'] ?? ''));

  // Networks / IPs / ports, exactly as the native list derives them.
  $networks = []; $network_ips = []; $ports_internal = []; $ports_external = [];
  if (isset($ct['Ports']['vlan'])) {
    foreach ($ct['Ports']['vlan'] as $i) $ports_external[] = sprintf('%s', $i);
    $ports_internal[0] = 'all';
  }
  foreach ($ct['Networks'] as $netName => $netVals) {
    $networks[] = $netName;
    $network_ips[] = $running ? $netVals['IPAddress'] : null;
    if (isset($ct['Networks']['host'])) {
      $ports_external[] = sprintf('%s', $netVals['IPAddress']);
      $ports_internal[0] = 'all';
    } elseif (!isset($ct['Ports']['vlan']) || strpos($ct['NetworkMode'],'container:')!==false) {
      foreach ($ct['Ports'] as $port) {
        if (_var($port,'PublicPort') && _var($port,'Driver') == 'bridge') {
          $ports_external[] = sprintf('%s:%s', $host, strtoupper(_var($port,'PublicPort')));
        }
        if ((!isset($ct['Networks']['host'])) || (!isset($ct['Networks']['vlan']))) {
          $ports_internal[] = sprintf('%s:%s', _var($port,'PrivatePort'), strtoupper(_var($port,'Type')));
        }
      }
    }
  }

  $volumes = [];
  foreach ((is_array($ct['Volumes']) ? $ct['Volumes'] : []) as $mount) {
    [$host_path,$container_path,$access_mode] = my_explode(':',$mount,3);
    $volumes[] = ['host' => $host_path, 'container' => $container_path, 'ro' => $access_mode=='ro'];
  }

  // Variables the copied block below reads.
  $TShostname = $ct['TSHostname'] ?: '';
  $TSwebGui = html_entity_decode($info['TSurl'] ?? '');
  // --- copied verbatim from DockerContainers.php (Tailscale status) ---
  // Check if Tailscale for container is enabled by checking if TShostname is set
  $TS_status = '';
  if (!empty($TShostname)) {
    if ($running) {
      // Get stats from container and check if they are not empty
      $TSstats = tailscale_stats($name);
      if (!empty($TSstats)) {
        // Construct TSinfo from TSstats
        $TSinfo = '';
        if (!$TSstats["Self"]["Online"]) {
          $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Online").":</span><span class='ui-tailscale-value'>&#10060;<br/>"._("Please check the logs")."!</span></div>";
        } else {
          $TS_version = explode('-', $TSstats["Version"])[0];
          if (!empty($TS_version)) {
            if (!empty($TS_latest_version)) {
              if (version_compare($TS_version, $TS_latest_version, '<')) {
                $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Tailscale:")."</span><span class='ui-tailscale-value'>v".$TS_version." &#10132; v".$TS_latest_version." "._("available!")."</span></div>";
              } else {
                $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Tailscale").":</span><span class='ui-tailscale-value'>v".$TS_version."</span></div>";
              }
            } else {
              $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>".("Tailscale").":</span><span class='ui-tailscale-value'>v".$TS_version."</span></div>";
            }
          }
          $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Online").":</span><span class='ui-tailscale-value'>&#9989;</span></div>";
          $TS_DNSName = $TSstats["Self"]["DNSName"];
          $TS_HostNameActual = substr($TS_DNSName, 0, strpos($TS_DNSName, '.'));
          if (strcasecmp($TS_HostNameActual, $TShostname) !== 0 && !empty($TS_DNSName)) {
            $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Hostname").":</span><span class='ui-tailscale-value'>"._("Real Hostname")." &#10132; ".$TS_HostNameActual."</span></div>";
          } else {
            $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Hostname").":</span><span class='ui-tailscale-value'>".$TShostname."</span></div>";
          }
          // Map region relay code to cleartext region if TS_derp_list is available
          if (!empty($TS_derp_list)) {
            foreach ($TS_derp_list['Regions'] as $region) {
              if ($region['RegionCode'] === $TSstats["Self"]["Relay"]) {
                $TSregion = $region['RegionName'];
                break;
              }
            }
            if (!empty($TSregion)) {
              $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("DERP Relay").":</span><span class='ui-tailscale-value'>".$TSregion."</span></div>";
            } else {
              $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("DERP Relay").":</span><span class='ui-tailscale-value'>".$TSstats["Self"]["Relay"]."</span></div>";
            }
          } else {
            $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("DERP Relay").":</span><span class='ui-tailscale-value'>".$TSstats["Self"]["Relay"]."</span></div>";
          }
          if (!empty($TSstats["Self"]["TailscaleIPs"])) {
            $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Addresses").":</span><span class='ui-tailscale-value'>".implode("<br/>", $TSstats["Self"]["TailscaleIPs"])."</span></div>";
          }
          if (!empty($TSstats["Self"]["PrimaryRoutes"])) {
            $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Routes").":</span><span class='ui-tailscale-value'>".implode("<br/>", $TSstats["Self"]["PrimaryRoutes"])."</span></div>";
          }
          if ($TSstats["Self"]["ExitNodeOption"]) {
            $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Is Exit Node").":</span><span class='ui-tailscale-value'>&#9989;</span></div>";
          } else {
            if (!empty($TSstats["ExitNodeStatus"])) {
              $TS_exit_node_status = ($TSstats["ExitNodeStatus"]["Online"]) ? "&#9989;" : "&#10060;";
              $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Exit Node").":</span><span class='ui-tailscale-value'>".strstr($TSstats["ExitNodeStatus"]["TailscaleIPs"][0], '/', true)." | Status: ".$TS_exit_node_status ."</span></div>";
            } else {
              $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Is Exit Node").":</span><span class='ui-tailscale-value'>&#10060;</span></div>";
            }
          }
          if (!empty($TSwebGui)) {
            $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("URL").":</span><span class='ui-tailscale-value'>".$TSwebGui."</span></div>";
          }
          if (!empty($TSstats["Self"]["KeyExpiry"])) {
            $TS_expiry = new DateTime($TSstats["Self"]["KeyExpiry"]);
            $current_Date = new DateTime();
            $TS_expiry_formatted = $TS_expiry->format('Y-m-d');
            $TS_expiry_diff = $current_Date->diff($TS_expiry);
            if ($TS_expiry_diff->invert) {
              $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Key Expiry").":</span><span class='ui-tailscale-value'>&#10060; "._("Expired! Renew/Disable key expiry!")."</span></div>";
            } else {
              $TSinfo .= "<div class='ui-tailscale-row'><span class='ui-tailscale-label'>"._("Key Expiry").":</span><span class='ui-tailscale-value'>".$TS_expiry_formatted." (".$TS_expiry_diff->days." days)</span></div>";
            }
          }
        }
        // Display TSinfo if data was fetched correctly
        $TS_status = "<br/><div class='TS_tooltip' style='cursor:pointer; display: inline-block;' data-tstitle='".htmlspecialchars($TSinfo)."'><img src='/plugins/dynamix.docker.manager/images/tailscale.png' style='height: 1.23em;'> Tailscale</div>";
      } else {
        // Display message to refresh page if Tailscale in the container wasn't maybe ready to get the data
        $TS_status = "<br/><div class='TS_tooltip' style='display: inline-block;' data-tstitle='"._("Error gathering Tailscale information from container").".<br/>"._("Please check the logs and refresh the page")."'><img src='/plugins/dynamix.docker.manager/images/tailscale.png' style='height: 1.23em;'> Tailscale</div>";
      }
    } else {
      // Display message that container isn't running
      $TS_status = "<br/><div class='TS_tooltip' style='cursor:pointer;display: inline-block;' data-tstitle='"._("Container not running")."'><img src='/plugins/dynamix.docker.manager/images/tailscale.png' style='height: 1.23em;'> Tailscale</div>";
    }
  }
  // --- end copy ---

  ['strRepo' => $author, 'strTag' => $version] = DockerUtil::parseImageTag($ct['Image']);

  $out[] = [
    'name'         => $name,
    'id'           => $id,
    'imageId'      => $ct['ImageId'],
    'image'        => $ct['Image'],
    'baseImage'    => $ct['BaseImage'] ?: '',
    'author'       => compress($author,24),
    'version'      => compress(_($version),12,0),
    'template'     => (string)($info['template'] ?? ''),
    'running'      => $running ? 1 : 0,
    'paused'       => !empty($info['paused']) ? 1 : 0,
    'autostart'    => !empty($info['autostart']),
    'wait'         => var_split($autostart[array_search($name,$names)] ?? '',1),
    'update'       => substr($ct['NetworkMode'], -4) == ':???' ? 2 : (($info['updated'] ?? '') == 'true' ? 0 : (($info['updated'] ?? '') == 'false' ? 1 : 3)),
    'manager'      => $ct['Manager'] ?: '',
    'compose'      => $composestack,
    'shell'        => (string)($info['shell'] ?? ''),
    'webui'        => html_entity_decode($info['url'] ?? ''),
    'tswebui'      => html_entity_decode($info['TSurl'] ?? ''),
    'tsStatus'     => $TS_status,
    'support'      => html_entity_decode($info['Support'] ?? ''),
    'project'      => html_entity_decode($info['Project'] ?? ''),
    'registry'     => html_entity_decode($info['registry'] ?? ''),
    'donate'       => html_entity_decode($info['DonateLink'] ?? ''),
    'readme'       => html_entity_decode($info['ReadMe'] ?? ''),
    'icon'         => $icon,
    'networks'     => $networks,
    'ips'          => $network_ips,
    'portsInternal'=> $ports_internal,
    'portsExternal'=> $ports_external,
    'volumes'      => $volumes,
    'status'       => str_replace('Up',_('Uptime').':',cv_lang_log($ct['Status'])),
    'created'      => cv_lang_time($ct['Created']),
    'categories'   => cv_categories($labels[$id] ?? []),
    // For grouping only: any compose project, not just Compose Manager ones
    // ('compose' above stays native - it drives the row's own markup).
    'stack'        => (string)($labels[$id]['com.docker.compose.project'] ?? ''),
    'service'      => (string)($labels[$id]['com.docker.compose.service'] ?? ''),
  ];
}

$orphans = [];
foreach ($images as $image) {
  if (count($image['usedBy'])) continue;
  $orphans[] = ['id' => $image['Id'], 'tags' => $image['Tags'], 'created' => _($image['Created'],0)];
}

// One string that isn't valid UTF-8 (a label, a log-derived status) would
// otherwise make json_encode fail and the whole list come back empty.
echo json_encode([
  'containers' => $out,
  'orphans'    => $orphans,
  'busy'       => pgrep('rc.docker') !== false,
  // {stack: service} chosen with "Use icon for stack" (include/icons.php).
  'stackIcons' => (object)(json_decode((string)@file_get_contents('/boot/config/plugins/containerview/stack-icons.json'), true) ?: []),
  // {category key: fa-icon} chosen with "Change icon..." in a group's menu.
  'groupIcons' => (object)(json_decode((string)@file_get_contents('/boot/config/plugins/containerview/group-icons.json'), true) ?: []),
  // Category rules for unlabelled containers (include/rules.php), applied by the page.
  'rules'      => json_decode((string)@file_get_contents('/boot/config/plugins/containerview/rules.json'), true) ?: [],
], JSON_INVALID_UTF8_SUBSTITUTE);
