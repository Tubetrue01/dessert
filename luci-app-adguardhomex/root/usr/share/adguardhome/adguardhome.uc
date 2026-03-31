#!/usr/bin/ucode
import { popen, mkdir, unlink, writefile, open, stat } from 'fs';
const uci = require('uci').cursor();

const service_name = "AdGuardHome";

uci.load(service_name);
uci.load("dhcp");

function exec_sys(cmd) {
	let p = popen(cmd + " 2>&1", "r");
	if (!p) return { code: -1, stdout: "" };
	let stdout = p.read("all");
	let code = p.close();
	if (type(stdout) == 'string') {
		stdout = replace(stdout, /^\s+|\s+$/g, '');
	}
	return { code: code, stdout: stdout || "" };
}

function _get_conf(section, option, default_val) {
    let val = uci.get(service_name, section, option);
    return (val != null) ? val : default_val;
}

function _get_config(file, key_path, defaultValue) {
    let parts = split(key_path, '.');
    let key = parts[length(parts) - 1];

    let cmd = "grep -E '^  ?" + key + ":' " + file + " | awk '{print $2}' | tr -d ' \"\\''";
    let fd = popen(cmd);
    let val = fd ? trim(fd.read("all")) : "";
    if (fd) fd.close();

    return (val != "") ? val : defaultValue;
}

function _patch_config(file, key_path, value) {
    let parts = split(key_path, '.');
    let key = parts[length(parts) - 1];

    let cmd = "sed -i 's/^  ?" + key + ":.*/  " + key + ": " + value + "/' " + file;
    exec_sys(cmd);
    return true;
}

function _update_core(binpath, upxflag, links) {
    if (!links || length(links) === 0) return false;
    const tmpDir = "/tmp/AGH_update";
    exec_sys("rm -rf " + tmpDir + " && mkdir -p " + tmpDir);
    for (let link in links) {
        const fileName = tmpDir + "/agh.tar.gz";
        if (exec_sys("wget --no-check-certificate -O " + fileName + " " + link) == 0) {
            exec_sys("tar -C " + tmpDir + " -xzf " + fileName);
            const extracted = tmpDir + "/AdGuardHome/AdGuardHome";
            if (stat(extracted)) {
                if (upxflag) exec_sys("/usr/bin/upx " + upxflag + " " + extracted + " >/dev/null 2>&1");
                exec_sys("mv " + extracted + " " + binpath + " && chmod +x " + binpath);
                exec_sys("rm -rf " + tmpDir);
                return true;
            }
        }
    }
    return false;
}

function _getFilesystem(targetPath) {
    const fd = popen("mount");
    if (!fd) return "unknown";
    let line;
    while ((line = fd.read("line"))) {
        const parts = split(line, /\s+/);
        if (length(parts) >= 5) {
            const mnt = parts[2];
            const typ = parts[4];
            if (substr(targetPath, 0, length(mnt)) === mnt) {
                fd.close();
                return typ;
            }
        }
    }
    fd.close();
    return "unknown";
}

function _set_dns_mode(mode, port) {
    exec_sys("nft delete table inet " + service_name + " 2>/dev/null");
    if (mode === "upstream") {
        _set_upstream_dnsmasq(port);
    } else if (mode === "redirect") {
        _stop_upstream_dnsmasq(port);
        uci.set("dhcp", "@dnsmasq[0]", "port", "0");
        exec_sys("nft add table inet " + service_name);
        exec_sys("nft add chain inet " + service_name + " prerouting { type nat hook prerouting priority dstnat +5; }");
        exec_sys("nft add rule inet " + service_name + " prerouting meta nfproto { ipv4, ipv6 } ip protocol { tcp, udp } th dport 53 counter redirect to :" + port + " comment \"DNS HIJACK\"");
    }
    uci.commit("dhcp");
    exec_sys("/etc/init.d/dnsmasq restart >/dev/null 2>&1");
}

function _set_upstream_dnsmasq(port) {
    const addr = "127.0.0.1#" + port;
    let servers = uci.get("dhcp", "@dnsmasq[0]", "server") || [];
    if (type(servers) === 'string') servers = [servers];
    let already_set = false;
    for (let s in servers) { if (s === addr) already_set = true; }
    if (already_set) return;
    let new_servers = [addr];
    for (let s in servers) { if (s !== addr) push(new_servers, s); }
    uci.set("dhcp", "@dnsmasq[0]", "server", new_servers);
    uci.delete("dhcp", "@dnsmasq[0]", "resolvfile");
    uci.set("dhcp", "@dnsmasq[0]", "noresolv", "1");
    uci.set("dhcp", "@dnsmasq[0]", "port", "53");
    uci.commit("dhcp");
    exec_sys("/etc/init.d/dnsmasq restart >/dev/null 2>&1");
}

function _stop_upstream_dnsmasq(port) {
    const addr = "127.0.0.1#" + port;
    let servers = uci.get("dhcp", "@dnsmasq[0]", "server") || [];
    if (type(servers) === 'string') servers = [servers];
    let found = false;
    for (let s in servers) { if (s === addr) found = true; }
    if (!found) return;
    let remaining = [];
    for (let s in servers) { if (s !== addr) push(remaining, s); }
    if (length(remaining) > 0) {
        uci.set("dhcp", "@dnsmasq[0]", "server", remaining);
    } else {
        uci.delete("dhcp", "@dnsmasq[0]", "server");
        uci.set("dhcp", "@dnsmasq[0]", "resolvfile", "/tmp/resolv.conf.auto");
        uci.delete("dhcp", "@dnsmasq[0]", "noresolv");
    }
    uci.set("dhcp", "@dnsmasq[0]", "port", "53");
    uci.commit("dhcp");
    exec_sys("/etc/init.d/dnsmasq restart >/dev/null 2>&1");
}

function _backup_data() {
    const work_dir = uci.get(service_name, service_name, "work_dir");
    const backup_path = uci.get(service_name, service_name, "work_dir_backup");
    let backup_files = uci.get(service_name, service_name, "backup_files") || [];
    if (type(backup_files) === 'string') backup_files = split(backup_files, /\s+/);
    for (let item in backup_files) {
        if (!item) continue;
        let success = false;
        let retry_count = 0;
        while (!success && retry_count < 2) {
            const src = work_dir + "/data/" + item;
            const cmd = "cp -u -r -f \"" + src + "\" \"" + backup_path + "\" 2>&1";
            const fd = popen(cmd);
            const output = fd ? fd.read("all") : "";
            const exit_code = fd ? fd.close() : -1;
            if (exit_code !== 0 && (index(output, "no space left") != -1)) {
                _clear_space_for_backup(work_dir, backup_path);
                retry_count++;
                continue;
            } else if (exit_code !== 0) break;
            success = true;
        }
    }
}

function _clear_space_for_backup(workDir, backupDataDir) {
    const logFile = "querylog.json";
    if (stat(workDir + "/data/" + logFile)) fs.unlink(workDir + "/data/" + logFile);
    if (stat(backupDataDir + "/" + logFile)) fs.unlink(backupDataDir + "/" + logFile);
    if (stat(workDir + "/data/filters")) exec_sys("rm -rf " + workDir + "/data/filters");
    if (stat(backupDataDir + "/filters")) exec_sys("rm -rf " + backupDataDir + "/filters");
}

function apply_config_to_yaml() {
    const enabled = _get_conf(service_name, "enabled", "0");
    if (enabled === "0") return "false";

    const config_path = _get_conf(service_name, "config_path");
    const httpport = _get_conf(service_name, "http_port", "3000");
    const work_dir = _get_conf(service_name, "work_dir", "/etc/AdGuardHome");
    const bin_path = _get_conf(service_name, "bin_path", "/usr/bin/AdGuardHome");

    _patch_config(config_path, "http.address", "0.0.0.0:" + httpport);

    if (!stat(work_dir)) {
        exec_sys("mkdir -p " + work_dir);
    }

    const work_dir_backup = _get_conf(service_name, "work_dir_backup");
    if (work_dir_backup && stat(work_dir_backup)) {
        const files = fs.readdir(work_dir);
        if (!files || length(files) === 0) {
            exec_sys("cp -r " + work_dir_backup + "/* " + work_dir + "/");
        }
    }

    if (_getFilesystem(work_dir) === "jffs2") {
        const dbFiles = ["stats.db", "sessions.db"];
        for (let file in dbFiles) {
            const filePath = work_dir + "/" + file;
            const tmpPath = "/tmp/AdGuardHome_" + file;
            if (!fs.readlink(filePath)) {
                if (stat(filePath)) exec_sys("mv " + filePath + " " + tmpPath);
                exec_sys("ln -s " + tmpPath + " " + filePath);
            }
        }
    }

    if (!stat(bin_path)) {
        const upx_flag = _get_conf(service_name, "upx_flag");
        let links = [];
        uci.foreach(service_name, "UpdateLinks", (s) => {
            if (s.url) {
                if (type(s.url) === 'string') push(links, s.url);
                else if (type(s.url) === 'array') for (let u in s.url) push(links, u);
            }
        });
        const hasBinary = _update_core(bin_path, upx_flag, links);
        if (!hasBinary) return "false";
    }

    const mode = _get_conf(service_name, "redirect", "none");
    const dnsPort = _get_config(config_path, "dns.port", "53");
    _set_dns_mode(mode, dnsPort);

    let bin_args = bin_path + " -c " + config_path + " -w " + work_dir;
    const log_path = _get_conf(service_name, "log_path");
    if (log_path) bin_args += " -l " + log_path;
    if (_get_conf(service_name, "verbose") === "1") bin_args += " -v";

    return bin_args;
}

function stop() {
    const mode = _get_conf(service_name, "redirect", "none");
    if (mode === "upstream") {
        const config_path = _get_conf(service_name, "config_path");
        const port = _get_config(config_path, "dns.port", "53");
        _stop_upstream_dnsmasq(port);
    } else if (mode === "redirect") {
        exec_sys("nft delete table inet " + service_name + " 2>/dev/null");
        uci.set("dhcp", "@dnsmasq[0]", "port", "53");
        uci.commit("dhcp");
        exec_sys("/etc/init.d/dnsmasq restart");
    }
    _backup_data();
}

const action = ARGV[0];
if (action === 'apply') {
    print(apply_config_to_yaml());
} else if (action === 'stop') {
    stop();
}