#!/usr/bin/ucode
const ucl = require('ucl');
const fs = require('fs');
const uci = require('uci').cursor();
const system = require('ucode').system;

const service_name = "AdGuardHome";

uci.load(service_name);
uci.load("dhcp");

function _get_conf(section, option, default_val = null) {
    return uci.get(service_name, section, option) ?? default_val;
}

async function apply_config_to_yaml() {
    const enabled = _get_conf(service_name, "enabled", "0");
    if (enabled === "0") return "false";

    const config_path = _get_conf(service_name, "config_path");
    const httpport = _get_conf(service_name, "http_port", "3000");
    const work_dir = _get_conf(service_name, "work_dir", "/etc/AdGuardHome");
    const bin_path = _get_conf(service_name, "bin_path", "/usr/bin/AdGuardHome");

    _patch_config(config_path, "http.address", `0.0.0.0:${httpport}`);

    if (!fs.stat(work_dir)) {
        system(`mkdir -p ${work_dir}`);
    }

    const work_dir_backup = _get_conf(service_name, "work_dir_backup");
    if (work_dir_backup && fs.stat(work_dir_backup)) {
        const files = fs.readdir(work_dir);
        if (!files || files.length === 0) {
            system(`cp -r ${work_dir_backup}/* ${work_dir}/`);
        }
    }

    if (_getFilesystem(work_dir) === "jffs2") {
        const dbFiles = ["stats.db", "sessions.db"];
        dbFiles.forEach(file => {
            const filePath = `${work_dir}/${file}`;
            const tmpPath = `/tmp/AdGuardHome_${file}`;
            
            if (!fs.readlink(filePath)) { 
                if (fs.stat(filePath)) system(`mv ${filePath} ${tmpPath}`);
                system(`ln -s ${tmpPath} ${filePath}`);
            }
        });
    }

    if (!fs.stat(bin_path)) {
        const upx_flag = _get_conf(service_name, "upx_flag");
        let links = [];
       
        uci.foreach(service_name, "UpdateLinks", (s) => {
            if (s.url) {
                if (typeof s.url === 'string') links.push(s.url);
                else if (Array.isArray(s.url)) links = links.concat(s.url);
            }
        });

        const hasBinary = await _update_core(bin_path, upx_flag, links);
        if (!hasBinary) return "false";
    }

    const mode = _get_conf(service_name, "redirect", "none");
    const dnsPort = _get_config(config_path, "dns.port", "53");
    _set_dns_mode(mode, dnsPort);

    let bin_args = `${bin_path} -c ${config_path} -w ${work_dir}`;
    const log_path = _get_conf(service_name, "log_path");
    if (log_path) bin_args += ` -l ${log_path}`;
    if (_get_conf(service_name, "verbose") === "1") bin_args += " -v";

    return bin_args;
}

function stop() {
    const mode = _get_conf(service_name, "redirect", "none");

    if (mode === "none") {

    }else if (mode === "upstream") {
        const config_path = _get_conf(service_name, "config_path");
        const port = _get_config(config_path, "dns.port", "53");
        _stop_upstream_dnsmasq(port);
    }else if (mode ==="redirect") {
        system(`nft delete table inet ${service_name} 2>/dev/null`);
        uci.set("dhcp", "@dnsmasq[0]", "port", "53");
        uci.commit("dhcp");
        system(`/etc/init.d/dnsmasq restart`);
    }

    _backup_data();
}

async function _update_core(binpath, upxflag, links) {
    if (!links || links.length === 0) {
        return false;
    }
    
    const tmpDir = "/tmp/AGH_update";
    system(`rm -rf ${tmpDir} && mkdir -p ${tmpDir}`);

    for (const link of links) {
        const fileName = `${tmpDir}/agh.tar.gz`;
        const code = system(`wget --no-check-certificate -O ${fileName} ${link}`);
        if (code === 0) {
            system(`tar -C ${tmpDir} -xzf ${fileName}`);
            const extracted = `${tmpDir}/AdGuardHome/AdGuardHome`;
            if (fs.stat(extracted)) {
                if (upxflag) {system(`/usr/bin/upx ${upxflag} ${extracted} >/dev/null 2>&1`);}
                system(`mv ${extracted} ${binpath} && chmod +x ${binpath}`);
                system(`rm -rf ${tmpDir}`);
                return true;
            }
        }
    }
    return false;
}

function _getFilesystem(targetPath) {
    const fd = fs.popen("mount");
    if (!fd) {return "unknown";}
    let line;
    while ((line = fd.read("line"))) {
        const parts = line.split(/\s+/);
        if (parts.length >= 5 && targetPath.startsWith(parts[2])) {
            fd.close();
            return parts[4];
        }
    }
    fd.close();
    return "unknown";
}

function _get_config(file, key_path, defaultValue) {
    const f = fs.open(file, "r");
    if (!f) {return defaultValue;}
    const config = ucl.parse(f.read("all"));
    f.close();
    
    const parts = key_path.split('.');
    let curr = config;
    for (const p of parts) {
        if (curr[p] === undefined){ return defaultValue;} 
        curr = curr[p];
    }
    return curr;
}

function _patch_config(file, key_path, value) {
    let config = {};
    const f_read = fs.open(file, "r");
    if (f_read) {
        config = ucl.parse(f_read.read("all")) || {};
        f_read.close();
    }

    const parts = key_path.split('.');
    let curr = config;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!curr[parts[i]]) {curr[parts[i]] = {};}
        curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = value;

    const f_write = fs.open(file, "w");
    if (f_write) {
        f_write.write(ucl.render(config, 'yaml'));
        f_write.close();
        return true;
    }
    return false;
}

function _set_dns_mode(mode, port) {
    system(`nft delete table inet ${service_name} 2>/dev/null`);

    if (mode === "upstream") {
        _set_upstream_dnsmasq(port);
    } else if (mode === "redirect") {
        _stop_upstream_dnsmasq(port);
        uci.set("dhcp", "@dnsmasq[0]", "port", "0");
        system(`
            nft add table inet ${service_name}
            nft add chain inet ${service_name} prerouting { type nat hook prerouting priority dstnat +5; }
            nft add rule inet ${service_name} prerouting meta nfproto { ipv4, ipv6 } ip protocol { tcp, udp } th dport 53 counter redirect to :${port} comment "DNS HIJACK"
        `);
    }
    uci.commit("dhcp");
    system(`/etc/init.d/dnsmasq restart >/dev/null 2>&1`);
}

function _set_upstream_dnsmasq(port) {
    const addr = `127.0.0.1#${port}`;
    uci.load("dhcp");

    let servers = uci.get("dhcp", "@dnsmasq[0]", "server");
    if (typeof servers === 'string') {
        servers = [servers];
    } else if (!Array.isArray(servers)){
        servers = [];
    } 

    if (servers.includes(addr)) {
        return;
    }

    const new_servers = [addr, ...servers.filter(s => s !== addr)];
    uci.set("dhcp", "@dnsmasq[0]", "server", new_servers);
    
    uci.delete("dhcp", "@dnsmasq[0]", "resolvfile");
    uci.set("dhcp", "@dnsmasq[0]", "noresolv", "1");
    uci.set("dhcp", "@dnsmasq[0]","port", "53");
    uci.commit("dhcp");
    system("/etc/init.d/dnsmasq restart >/dev/null 2>&1");
}

function _stop_upstream_dnsmasq(port) {
    const addr = `127.0.0.1#${port}`;

    let servers = uci.get("dhcp", "@dnsmasq[0]", "server");
    if (typeof servers === 'string') {
        servers = [servers];
    } else if (!Array.isArray(servers)) {
        servers = [];
    }

    if (!servers.includes(addr)) {
        return;
    }    

    const remaining = servers.filter(s => s !== addr);
    
    if (remaining.length > 0) {
        uci.set("dhcp", "@dnsmasq[0]", "server", remaining);
    } else {
        uci.delete("dhcp", "@dnsmasq[0]", "server");
        uci.set("dhcp", "@dnsmasq[0]", "resolvfile", "/tmp/resolv.conf.auto");
        uci.delete("dhcp", "@dnsmasq[0]", "noresolv");
    }

    uci.set("dhcp", "@dnsmasq[0]","port", "53");
    uci.commit("dhcp");
    system("/etc/init.d/dnsmasq restart >/dev/null 2>&1");
}

function _backup_data() {
    const work_dir = uci.get(service_name, service_name, "work_dir");
    const backup_path = uci.get(service_name, service_name, "work_dir_backup");
    
    let backup_files = uci.get(service_name, service_name, "backup_files") || [];
    if (typeof backup_files === 'string') {
        backup_files = backup_files.split(/\s+/);
    }

    for (const item of backup_files) {
        if (!item) {continue;}

        let success = false;
        let retry_count = 0;

        while (!success && retry_count < 2) {
            const src = `${work_dir}/data/${item}`;
            const dest = backup_path;

            const cmd = `cp -u -r -f "${src}" "${dest}" 2>&1`;
            const fd = fs.popen(cmd);
            const output = fd ? fd.read("all") : "";
            const exit_code = fd ? fd.close() : -1;

            if (exit_code !== 0 && (output.includes("no space left on device") || output.includes("No space left"))) {
                console.error(`[Backup] Disk is full, attempting to free up space (retry ${retry_count + 1})...`);
                _clear_space_for_backup(work_dir, backup_path);
                
                retry_count++;
                continue;  
            } else if (exit_code !== 0) {
                console.error(`[Backup] Copy failed: ${item}, Error: ${output}`);
                break;
            }

            success = true;
            console.log(`[Backup] Successfully backed up: ${item}`);
        }
    }
}

function _clear_space_for_backup(workDir, backupDataDir) {
    const logFile = "querylog.json";
    const wLog = `${workDir}/data/${logFile}`;
    const bLog = `${backupDataDir}/${logFile}`;

    const wStat = fs.stat(wLog);
    const bStat = fs.stat(bLog);

    if (wStat && bStat) {
        fs.unlink(wLog);
        fs.unlink(bLog);
        console.log("[Backup] Deleted query logs from both work and backup dirs");
    } else if (wStat) {
        fs.unlink(wLog);
        console.log("[Backup] Deleted work dir query log");
    } else if (bStat) {
        fs.unlink(bLog);
        console.log("[Backup] Deleted backup dir query log");
    }

    const filtersDir = `${workDir}/data/filters`;
    const bFiltersDir = `${backupDataDir}/filters`;

    if (fs.stat(filtersDir)) {
        system(`rm -rf ${filtersDir}`);
        console.log("[Backup] Cleared work dir filters cache");
    }
    
    if (fs.stat(bFiltersDir)) {
        system(`rm -rf ${bFiltersDir}`);
        console.log("[Backup] Cleared backup dir filters cache");
    }
}

const action = ARGV[0];
switch (action) {
    case 'apply':
        apply_config_to_yaml().then(args => print(args));
        break;
    case 'stop':
        stop()
        break;
    default:
        print("Usage: adguardhome.uc [apply|stop]\n");
}
