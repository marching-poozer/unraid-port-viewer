<?php
/*
 * listening-ports — JSON endpoint
 *
 * Combines `ss -Hlntup` (host listeners with PID) with `docker ps` to label
 * each listener with its owning container when applicable.
 *
 * Detection strategy, in order of preference for each listener:
 *   1. PID -> /proc/<pid>/cgroup -> docker container ID  (catches host-network containers)
 *   2. process == docker-proxy   -> match host port to a `docker ps` port mapping  (bridge networks)
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');

function run(string $cmd): string {
    $out = @shell_exec($cmd . ' 2>/dev/null');
    return $out === null ? '' : $out;
}

function parse_ss(string $raw): array {
    $rows = [];
    foreach (explode("\n", trim($raw)) as $line) {
        if ($line === '') continue;

        // ss -Hlntup columns: Netid State Recv-Q Send-Q LocalAddr:Port PeerAddr:Port [Process]
        // UDP rows have State=UNCONN.
        $cols = preg_split('/\s+/', $line);
        if (count($cols) < 5) continue;

        $proto = strtolower($cols[0]);
        if ($proto !== 'tcp' && $proto !== 'udp') continue;

        $local = $cols[4];
        $procField = '';
        for ($i = 6; $i < count($cols); $i++) {
            if (str_starts_with($cols[$i], 'users:')) { $procField = $cols[$i]; break; }
        }

        // ss formats:
        //   "127.0.0.1:80"            unbracketed IPv4
        //   "*:80" / "0.0.0.0:80"     wildcard IPv4
        //   "0.0.0.0%br0:5355"        IPv4 bound to interface (SO_BINDTODEVICE)
        //   "[::]:80"                 wildcard IPv6
        //   "[::]%br0:3702"           IPv6 bound to interface
        $iface = '';
        if (isset($local[0]) && $local[0] === '[') {
            $rb = strpos($local, ']');
            if ($rb === false) continue;
            $addr = substr($local, 1, $rb - 1);
            $rest = substr($local, $rb + 1);
            if (isset($rest[0]) && $rest[0] === '%') {
                $cl = strpos($rest, ':');
                if ($cl === false) continue;
                $iface = substr($rest, 1, $cl - 1);
                $port  = (int) substr($rest, $cl + 1);
            } elseif (isset($rest[0]) && $rest[0] === ':') {
                $port = (int) substr($rest, 1);
            } else {
                continue;
            }
            $family = 'ipv6';
        } else {
            $cl = strrpos($local, ':');
            if ($cl === false) continue;
            $addr = substr($local, 0, $cl);
            $port = (int) substr($local, $cl + 1);
            if (($pct = strpos($addr, '%')) !== false) {
                $iface = substr($addr, $pct + 1);
                $addr  = substr($addr, 0, $pct);
            }
            if ($addr === '*' || $addr === '') $addr = '0.0.0.0';
            $family = 'ipv4';
        }
        if ($iface !== '') $addr .= '%' . $iface;

        // users:(("nginx",pid=1234,fd=6),("nginx",pid=1235,fd=6))
        $process = null; $pid = null;
        if ($procField && preg_match('/"([^"]+)",pid=(\d+)/', $procField, $m)) {
            $process = $m[1];
            $pid = (int) $m[2];
        }

        $rows[] = [
            'proto'     => $proto,
            'family'    => $family,
            'address'   => $addr,
            'port'      => $port,
            'process'   => $process,
            'pid'       => $pid,
        ];
    }
    return $rows;
}

function pid_to_container(int $pid): ?string {
    $cgroup = @file_get_contents("/proc/$pid/cgroup");
    if ($cgroup === false) return null;
    // cgroup v1: 1:name=systemd:/docker/<id>
    // cgroup v2: 0::/system.slice/docker-<id>.scope
    if (preg_match('#docker[/-]([0-9a-f]{12,64})#', $cgroup, $m)) {
        return substr($m[1], 0, 12);
    }
    return null;
}

function docker_inventory(): array {
    // Returns: ['by_id' => [shortId => ['name','image','ports'=>raw]], 'proxy' => [proto:hostPort => [...]]]
    $by_id = [];
    $proxy = [];

    $raw = run("docker ps --no-trunc --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Ports}}'");
    if ($raw === '') return ['by_id' => $by_id, 'proxy' => $proxy];

    foreach (explode("\n", trim($raw)) as $line) {
        if ($line === '') continue;
        $parts = explode('|', $line, 4);
        if (count($parts) < 3) continue;
        [$fullId, $name, $image] = $parts;
        $portsRaw = $parts[3] ?? '';
        $shortId = substr($fullId, 0, 12);
        $by_id[$shortId] = ['name' => $name, 'image' => $image];

        // Port mappings. Docker collapses consecutive ports into ranges, e.g.
        //   "0.0.0.0:80-81->80-81/tcp, :::80-81->80-81/tcp, 0.0.0.0:443->443/tcp, ..."
        // Host IP may be IPv4, bracketed IPv6 ([::]) or bare IPv6 (:::).
        foreach (explode(',', $portsRaw) as $mapping) {
            $mapping = trim($mapping);
            if ($mapping === '') continue;
            if (!preg_match('#(?:.+:)?(\d+)(?:-(\d+))?->(\d+)(?:-(\d+))?/(tcp|udp)#', $mapping, $m)) continue;
            $hstart = (int) $m[1];
            $hend   = ($m[2] ?? '') !== '' ? (int) $m[2] : $hstart;
            $cstart = (int) $m[3];
            $proto  = $m[5];
            for ($h = $hstart, $c = $cstart; $h <= $hend; $h++, $c++) {
                $key = $proto . ':' . $h;
                if (isset($proxy[$key])) continue; // first binding wins
                $proxy[$key] = [
                    'container_id'   => $shortId,
                    'container_name' => $name,
                    'image'          => $image,
                    'container_port' => $c,
                ];
            }
        }
    }
    return ['by_id' => $by_id, 'proxy' => $proxy];
}

$ports = parse_ss(run('ss -Hlntup'));
$docker = docker_inventory();

foreach ($ports as &$p) {
    $p['container_id']   = null;
    $p['container_name'] = null;
    $p['image']          = null;
    $p['container_port'] = null;

    if ($p['pid']) {
        $cid = pid_to_container($p['pid']);
        if ($cid && isset($docker['by_id'][$cid])) {
            $p['container_id']   = $cid;
            $p['container_name'] = $docker['by_id'][$cid]['name'];
            $p['image']          = $docker['by_id'][$cid]['image'];
            continue;
        }
    }
    if ($p['process'] === 'docker-proxy') {
        $key = $p['proto'] . ':' . $p['port'];
        if (isset($docker['proxy'][$key])) {
            $hit = $docker['proxy'][$key];
            $p['container_id']   = $hit['container_id'];
            $p['container_name'] = $hit['container_name'];
            $p['image']          = $hit['image'];
            $p['container_port'] = $hit['container_port'];
        }
    }
}
unset($p);

// Sort by port asc, then proto, then family
usort($ports, function($a, $b) {
    return [$a['port'], $a['proto'], $a['family']] <=> [$b['port'], $b['proto'], $b['family']];
});

echo json_encode([
    'generated_at' => time(),
    'count'        => count($ports),
    'ports'        => $ports,
], JSON_UNESCAPED_SLASHES);
