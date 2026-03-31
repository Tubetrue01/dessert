#!/usr/bin/ucode

import { popen, unlink, stat } from "fs";
const uci = require("uci").cursor();

const service_name = "AdGuardHome";

const arch_version = {
    "Arch": "amd64",
    "latest_ver": "v0.107.43"
};

uci.load(service_name);
uci.load("dhcp");

function exec_sys(cmd) {
    const p = popen(`${cmd} 2>&1`, "r");
    if (!p) return { code: -1, stdout: "" };
    let stdout = p.read("all");
    const code = p.close();
    if (type(stdout) == "string") {
        stdout = replace(stdout, /^\s+|\s+$/g, "");
    }
    return { code: code, data: stdout || "" };
}

function _get_latest_ver() {
    const api_url = "https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/latest";
    const cmd = `curl -sL -H 'User-Agent: ucode' "${api_url}"`;
    let res = exec_sys(cmd).data;

    if (!res) {
        return "false";
    }

    res = trim(res);
    try {
        const data = json(res);
        if (data && data.tag_name) {
            return data.tag_name;
        }
    } catch(e){
        return "false";
    }
}

function _get_conf(section, option, default_val) {
    const val = uci.get(service_name, section, option);
    return (val != null) ? val : default_val;
}

function _get_config(file, key_path, defaultValue) {
    const parts = split(key_path, ".");
    const key = parts[length(parts) - 1];

    const cmd = `sed -n 's/^\\s*${key}:\\s*//p' \"${file}\"`;
    const fd = popen(cmd);
    const val = fd ? trim(fd.read("all")) : "";

    if (fd){
        fd.close();
    }

    return (val != "") ? val : defaultValue;
    return "";
}

function _patch_config(file, key_path, value) {
    const parts = split(key_path, ".");
    const key = parts[length(parts) - 1];

    const cmd = `sed -i 's/^  ?${key}:.*/  ${key}: ${value}/' ${file}`;
    exec_sys(cmd);
    return true;
}

function _update_core(binpath, upxflag, links) {
    if (!links || length(links) === 0) {
        return false;
    }

    const arch = _get_conf(service_name, "arch", "auto");
    if (arch === "auto") {
        const uname = exec_sys("uname -m");
        if (uname.data === "aarch64") {
            uname.data = "arm64";
        }
        arch_version["Arch"] = uname.data;
    }

    const version = _get_latest_ver();
    arch_version["latest_ver"] = version;

    const tmpDir = "/tmp/AGH_update";
    exec_sys(`rm -rf ${tmpDir} && mkdir -p ${tmpDir}`);

    for (let link in links) {
         const processed_url = replace(link, /\$\{([^}]+)\}/g, (match, key) => {
            return arch_version[key] || match;
        });

        const fileName = `${tmpDir}/agh.tar.gz`;
        const wget_rtn = exec_sys(`wget --no-check-certificate -O ${fileName} ${processed_url}`);

        if (wget_rtn.code == 0) {
            exec_sys(`tar -C ${tmpDir} -xzf ${fileName}`);

            const extracted = `${tmpDir}/AdGuardHome/AdGuardHome`;

            if (stat(extracted)) {
                if (upxflag) {
                    exec_sys(`/usr/bin/upx ${upxflag} ${extracted} >/dev/null 2>&1`);
                }

                exec_sys(`mv ${extracted} ${binpath} && chmod +x ${binpath}`);
                exec_sys(`rm -rf ${tmpDir}`);
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
    exec_sys(`nft delete table inet ${service_name} 2>/dev/null`);

    if (mode === "upstream") {
        _set_upstream_dnsmasq(port);
    } else if (mode === "redirect") {
        _stop_upstream_dnsmasq(port);
        uci.set("dhcp", "@dnsmasq[0]", "port", "0");
        exec_sys(`nft add table inet ${service_name}`);
        exec_sys(`nft add chain inet ${service_name} prerouting { type nat hook prerouting priority dstnat +5; }`);
        exec_sys(`nft add rule inet ${service_name} prerouting meta nfproto { ipv4, ipv6 } ip protocol { tcp, udp } th dport 53 counter redirect to :${port} comment \"DNS HIJACK\"`);
    }
    uci.commit("dhcp");
    exec_sys("/etc/init.d/dnsmasq restart >/dev/null 2>&1");
}

function _set_upstream_dnsmasq(port) {
    const addr = `127.0.0.1#${port}`;
    let servers = uci.get("dhcp", "@dnsmasq[0]", "server") || [];

    if (type(servers) === "string") {
        servers = [servers];
    }

    let already_set = false;

    for (let s in servers) {
        if (s === addr) {
            already_set = true;
        }
    }

    if (already_set) {
        return;
    }

    const new_servers = [addr];

    for (let s in servers) {
        if (s !== addr) {
            push(new_servers, s);
        }
    }

    uci.set("dhcp", "@dnsmasq[0]", "server", new_servers);
    uci.delete("dhcp", "@dnsmasq[0]", "resolvfile");
    uci.set("dhcp", "@dnsmasq[0]", "noresolv", "1");
    uci.set("dhcp", "@dnsmasq[0]", "port", "53");
    uci.commit("dhcp");
    exec_sys("/etc/init.d/dnsmasq restart >/dev/null 2>&1");
}

function _stop_upstream_dnsmasq(port) {
    const addr = `127.0.0.1#${port}`;
    let servers = uci.get("dhcp", "@dnsmasq[0]", "server") || [];

    if (type(servers) === "string") {
        servers = [servers];
    }

    let found = false;

    for (let s in servers) {
        if (s === addr) {
            found = true;
        }
    }

    if (!found) {
        return;
    }

    const remaining = [];

    for (let s in servers) {
        if (s !== addr) {
            push(remaining, s);
        }
    }

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

    if (type(backup_files) === "string"){
        backup_files = split(backup_files, /\s+/);
    }

    for (let item in backup_files) {
        if (!item) {
            continue;
        }

        let success = false;
        let retry_count = 0;

        while (!success && retry_count < 2) {
            const src = `${work_dir}/${item}`;
            const cmd = `cp -u -r -f \"${src}\" \"${backup_path}\" 2>&1`;

            const fd = popen(cmd);
            const output = fd ? fd.read("all") : "";
            const exit_code = fd ? fd.close() : -1;

            if (exit_code !== 0 && (index(output, "no space left") != -1)) {
                _clear_space_for_backup(work_dir, backup_path);
                retry_count++;
                continue;
            } else if (exit_code !== 0) {
                break;
            }
            success = true;
        }
    }
}

function _clear_space_for_backup(workDir, backupDataDir) {
    const logFile = "querylog.json";
    if (stat(`${workDir}/${logFile}`)) {
        unlink(`${workDir}/${logFile}`);
    }
    if (stat(`${backupDataDir}/${logFile}`)) {
        unlink(`${backupDataDir}/${logFile}`);
    }

    if (stat(`${workDir}/${filters}`)){
        exec_sys(`rm -rf ${workDir}/filters`);
    }

    if (stat(`${backupDataDir}/filters`)) {
        exec_sys(`rm -rf ${backupDataDir}/filter`);
    }
}

function apply_config_to_yaml() {
    const enabled = _get_conf(service_name, "enabled", "0");

    if (enabled === "0") {
        return "false";
    }

    const config_path = _get_conf(service_name, "config_path");
    const httpport = _get_conf(service_name, "http_port", "3000");
    const work_dir = _get_conf(service_name, "work_dir", "/etc/AdGuardHome");
    const bin_path = _get_conf(service_name, "bin_path", "/usr/bin/AdGuardHome");

    _patch_config(config_path, "http.address", `0.0.0.0:${httpport}`);

    if (!stat(work_dir)) {
        exec_sys(`mkdir -p ${work_dir}`);

        const work_dir_backup = _get_conf(service_name, "work_dir_backup");
        if (work_dir_backup && stat(work_dir_backup)) {
            const files = fs.readdir(work_dir);
            if (!files || length(files) === 0) {
                exec_sys(`cp -r ${work_dir_backup}/* ${work_dir}/`);
            }
        }
    }

    if (_getFilesystem(work_dir) === "jffs2") {
        const dbFiles = ["stats.db", "sessions.db"];
        for (let file in dbFiles) {
            const filePath = `${work_dir}/${file}`;
            const tmpPath = `/tmp/AdGuardHome_${file}`;

            if (!fs.readlink(filePath)) {
                if (stat(filePath)){
                    exec_sys(`mv ${filePath} ${tmpPath}`);
                }
                exec_sys(`ln -s ${tmpPath} ${filePath}`);
            }
        }
    }

    if (!stat(bin_path)) {
        const upx_flag = _get_conf(service_name, "upx_flag");
        let links = [];
        uci.foreach(service_name, service_name, (s) => {
                if (s[".name"] === "UpdateLinks" && s.url) {
                    if (type(s.url) === "array") {
                            for (let i, u in s.url) {
                               if (u && index(u, "#") !== 0) {
                                    push(links, u);
                                }
                            }
                       }
                    } else if (type(s.url) === "string" && !s.url.match(/^#/)) {
                        push(links, s.url);
                    }
                });

        const hasBinary = _update_core(bin_path, upx_flag, links);
        if (!hasBinary) {
            return "false";
        }
    }

    const mode = _get_conf(service_name, "redirect", "none");
    const dnsPort = _get_config(config_path, "dns.port", "53");
    _set_dns_mode(mode, dnsPort);

    let bin_args = `${bin_path} -c ${config_path} -w ${work_dir}`;
    const log_path = _get_conf(service_name, "log_file");

    if (log_path) {
        bin_args += " -l " + log_path;
    }

    if (_get_conf(service_name, "verbose") === "1") {
        bin_args += " -v";
    }

    return bin_args;
}

function stop() {
    const mode = _get_conf(service_name, "redirect", "none");

    if (mode === "upstream") {
        const config_path = _get_conf(service_name, "config_path");
        const port = _get_config(config_path, "dns.port", "53");
        _stop_upstream_dnsmasq(port);
    } else if (mode === "redirect") {
        exec_sys(`nft delete table inet ${service_name} 2>/dev/null`);
        uci.set("dhcp", "@dnsmasq[0]", "port", "53");
        uci.commit("dhcp");
        exec_sys("/etc/init.d/dnsmasq restart");
    }
    _backup_data();
}

const action = ARGV[0];
if (action === "apply") {
    print(apply_config_to_yaml());
} else if (action === "stop") {
    stop();
}
