#!/usr/bin/ucode

import { popen, open, unlink, stat, readlink } from "fs";
const uci = require("uci").cursor();

const service_name = "AdGuardHome";

const state = {
    arch: "amd64",
    latest_ver: "v0.107.73",
    latest_ver_time: 0
};

const archMap = {
    "aarch64": "arm64",
    "x86_64": "amd64",
    "i386": "386",
    "armv7l": "armv7",
    "armv6l": "armv6",
    "armv5": "armv5",
    "mips": "mips_softfloat",
    "mipsel": "mipsle_softfloat",
    "mips64": "mips64_softfloat",
    "mips64el": "mips64le_softfloat",
    "powerpc64": "ppc64le"
};

const github_api = "https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/latest";

/* ================= Base Tools ================= */
function _exec_sys(cmd) {
    const p = popen(`sh -c '${cmd}' 2>&1`, "r");
    if (!p) return { code: -1, data: "" };

    const stdout = p.read("all");
    const code = p.close();

    return {
        code: code,
        data: (type(stdout) == "string") ? trim(stdout) : ""
    };
}

function _safe_unlink(path) {
    if (stat(path)) {
        unlink(path);
    }
}

function _uci_get(setction_name, defaultVal) {
    return uci.get(service_name, service_name, setction_name) || defaultVal;
}

function _log(msg, log_file) {
    const p = popen("date '+%Y-%m-%d %H:%M:%S'");
    const date = p ? trim(p.read("all")) : "0000-00-00 00:00:00";
    if (p) {
        p.close();
    }
    const log_msg = `[${date}] ${msg}\n`;
    if (log_file) {
        const f = open(log_file, "a");
        if (f) {
            f.write(log_msg);
            f.close();
            return;
        }
    }
    print(log_msg);
}

/* ================= Version ================= */
function _arch_version_set() {
    const now = time();

    let arch = _uci_get("arch", "auto");

    if (arch === "auto") {
        const uname = _exec_sys("uname -m").data;
        state.arch = archMap[uname] || "amd64";
    } else {
        state.arch = arch;
    }

    if (state.latest_ver && (now - state.latest_ver_time < 3600)) {
       return;
    }

    const res = _exec_sys(`curl -sL --connect-timeout 5 "${github_api}"`).data;

    try {
        const data = json(res);
        if (data?.tag_name) {
            state.latest_ver = data.tag_name;
            state.latest_ver_time = now;
        }
    } catch(e) {}
}

/* ================= YAML ================= */
function _get_config(file, key_path, defaultVal) {
    const res = _exec_sys(`yq e '.${key_path}' "${file}"`).data;
    return res ? res : defaultVal;
}

function _patch_config(file, key_path, value) {
    const old = _get_config(file, key_path, "");

    if (old === value){
        return false;
    }
    const cmd = sprintf("yq -i '.%s = \\\"%s\\\"' %s", key_path, value, file);
    return _exec_sys(cmd);
}

/* ================= Core Download ================= */
function update_core(log_file) {
    let links = [];
    uci.foreach(service_name, service_name, (s) => {
            if (s[".name"] === "UpdateLinks" && s.url) {
                if (type(s.url) === "array") {
                        for (let u in s.url) {
                            if (u && index(u, "#") !== 0) {
                                push(links, u);
                            }
                        }
                    }
                } else if (type(s.url) === "string" && !s.url.match(/^#/)) {
                    push(links, s.url);
                }
    });

    if (!links || length(links) === 0) {
        return false;
    }

    _arch_version_set();

    _log(`Target architecture is: ${state.arch}, and version is ${state.latest_ver}`, log_file);

    const upx_flag = _uci_get("upx_flag");
    const bin_path = _uci_get("bin_path");
    const tmp = "/tmp/AGH_update";

    _exec_sys(`rm -rf ${tmp} && mkdir -p ${tmp}`);

    for (let tpl in links) {
        const url = replace(tpl, /\$\{([^}]+)\}/g,
            (m, k) => k === "Arch" ? state.arch :
                     k === "latest_ver" ? state.latest_ver : m
        );

        _log(`Starting download from: ${url}`, log_file);

        const file = `${tmp}/agh.tar.gz`;
        const down_rtn = _exec_sys(`wget --no-check-certificate -O ${file} ${url}`);
        if (down_rtn.code !== 0) {
            _log(`Download failed: ${down_rtn.data}, and try again by other links.`, log_file);
            continue;
        }

        if (_exec_sys(`tar -tzf "${file}"`).code !== 0) {
            continue;
        }

        _exec_sys(`tar -xzf "${file}" -C ${tmp}`);

        const found = _exec_sys(`find ${tmp} -type f -name AdGuardHome`).data;
        if (!found) {
            continue;
        }

        const extracted = split(found, "\n")[0];
        if (!stat(extracted)) {
            continue;
        }

        if (upx_flag && upx_flag !== "0") {
            _log("Ready to upx it.", log_file);
            const rtn = _exec_sys(`/usr/bin/upx ${upx_flag} "${extracted}"`);
            if (rtn.code != 0) {
                _log(rtn.data, log_file);
            }
        }

        _exec_sys(`mv "${extracted}" "${bin_path}"`);
        _exec_sys(`chmod +x "${bin_path}"`);
        _exec_sys(`rm -rf ${tmp}`);

        _log("Download Success.", log_file);

        return true;
    }

    _exec_sys(`rm -rf ${tmp}`);
    _log("Failed, please try it agin for a later.", log_file);

    return false;
}

/* ================= DNS ================= */
function _reset_dns_config() {
    _exec_sys(`nft delete table inet ${service_name} 2>/dev/null`);

    uci.set("dhcp", "@dnsmasq[0]", "port", "53");
    uci.set("dhcp", "@dnsmasq[0]", "dns_redirect", "1");

    let servers = uci.get("dhcp", "@dnsmasq[0]", "server");

    if (type(servers) === "string") {
        servers = [servers];
    } else if (type(servers) !== "array") {
        servers = [];
    }

    const filtered = [];
    for (let s in servers) {
        if (s && !wildcard(s, "127.0.0.1#*")) {
            push(filtered, s);
        }
    }

    if (length(filtered) > 0) {
        uci.set("dhcp", "@dnsmasq[0]", "server", filtered);
    } else {
        uci.delete("dhcp", "@dnsmasq[0]", "server");
    }

    uci.delete("dhcp", "@dnsmasq[0]", "noresolv");
    uci.commit("dhcp");
}

/*
 * Since dnsmasq under nftables enables redirection of port 53 to itself,
 * when the AdGuard Home (ADH) redirect mode is selected,
 * port listening of dnsmasq will be disabled, and port 53 will be redirected to ADH.
 */
function _set_dns_mode(mode) {
    _reset_dns_config();

    if (mode === "none") {
        _exec_sys("/etc/init.d/dnsmasq restart");
    } else if (mode === "upstream") {
        const config_path = _uci_get("config_path", "/etc/AdGuardHome.yaml");
        const port = _get_config(config_path, "dns.port");
        const addr = `127.0.0.1#${port}`;

        let servers = uci.get("dhcp", "@dnsmasq[0]", "server") || [];

        if (type(servers) !== "array") {
            servers = [servers];
        }

        push(servers, addr);
        uci.set("dhcp", "@dnsmasq[0]", "server", servers);
        uci.set("dhcp", "@dnsmasq[0]", "noresolv", "1");
        uci.commit("dhcp");
        _exec_sys("/etc/init.d/dnsmasq restart");

    } else if (mode === "redirect") {
        uci.set("dhcp", "@dnsmasq[0]", "port", "0");
        uci.set("dhcp", "@dnsmasq[0]", "dns_redirect", "0");

        uci.commit("dhcp");
        _exec_sys("/etc/init.d/dnsmasq restart");

        const config_path = _uci_get("config_path");
        const dns_port = _get_config(config_path, "dns.port");

        const nft_conf = `table inet ${service_name} {
            chain prerouting {
                type nat hook prerouting priority dstnat + 5;
                meta nfproto { ipv4, ipv6 } meta l4proto { tcp, udp } th dport 53 counter redirect to ${dns_port} comment "DNS HIJACK"
            }
        }`;

        const f = open("/tmp/agh_nft.conf", "w");
        if (f) {
            f.write(nft_conf);
            f.close();
            _exec_sys("nft -f /tmp/agh_nft.conf");
            unlink("/tmp/agh_nft.conf");
        }
    }
}

/* ================= Clean ================= */
function _clear_space_for_backup(workDir, backupDir) {
    const files = ["querylog.json", "stats.db"];

    for (let f in files) {
        _safe_unlink(`${workDir}/data/${f}`);
        _safe_unlink(`${backupDir}/${f}`);
    }

    _exec_sys(`rm -rf ${workDir}/data/filters ${backupDir}/filters`);
}

/* ================= Main ================= */

function apply_config_to_yaml() {
    const enabled = _uci_get("enabled");
    if (enabled === "0") {
        return "false";
    }

    const config_path = _uci_get("config_path", "/etc/AdGuardHome.yaml");
    const work_dir = _uci_get("work_dir", "/opt/data/AdGuardHome");
    const bin_path = _uci_get("bin_path", "/usr/bin/AdGuardHome");
    const http_port = _uci_get("http_port", "3000");

    const address = _get_config(config_path, "http.address");
    const parts = split(address || "", ":");
    const ip = (length(parts) > 1) ? parts[0] : "0.0.0.0";
    _patch_config(config_path, "http.address", `${ip}:${http_port}`);

    if (!stat(`${work_dir}/data`)) {
        _exec_sys(`mkdir -p ${work_dir}/data`);

        const work_dir_backup = _uci_get("work_dir_backup");
        if (stat(work_dir_backup)) {
           _exec_sys(`cp -a ${work_dir_backup}/. ${work_dir}/data/`);
        }
    }

    const mount_info = _exec_sys("mount").data;

    if (index(mount_info, "on /overlay type jffs2") !== -1) {
        const dbFiles = ["stats.db", "sessions.db"];

        for (let f in dbFiles) {
            const p = `${work_dir}/data/${f}`;
            const tmp = `/tmp/AGH_${f}`;

            if (stat(p) && !readlink(p)) {
                _exec_sys(`mv "${p}" "${tmp}" && ln -s "${tmp}" "${p}"`);
            }
        }
    }

    if (!stat(bin_path)) {
        if (!update_core()) {
            return "false";
        }
    }

    const mode = _uci_get("redirect", "none");
    _set_dns_mode(mode);

    let args = `${bin_path} -c ${config_path} -w ${work_dir}`;

    if (_uci_get("verbose") === "1") {
        args += " -v";
    }

    const log_file = _uci_get("log_file");
    if (log_file) {
        args += ` -l ${log_file}`;
    }

    return args;
}

function stop() {

    const mode = _uci_get("redirect", "none");
    const config_path = _uci_get("config_path");
    const backup_files = _uci_get("backup_files");

    if (backup_files && type(backup_files) == "array" && length(backup_files) > 0) {
        const work_dir = _uci_get("work_dir");
        const work_dir_backup = _uci_get("work_dir_backup");

        if (work_dir && work_dir_backup) {
            if (!stat(work_dir_backup)) {
                _exec_sys(`mkdir -p "${work_dir_backup}"`);
            }

            for (let file in backup_files) {
                print(`file : ${file}`);
                const src_path = `${work_dir}/data/${file}`;

                if (stat(src_path)) {
                    _exec_sys(`cp -af "${src_path}" "${work_dir_backup}/"`);
                }
            }
        }
    }

    _reset_dns_config();
    _exec_sys("/etc/init.d/dnsmasq restart");
}

function apply_from_yaml() {
    const config_path = _uci_get("config_path", "/etc/AdGuardHome.yaml");
    const address = _get_config(config_path, "http.address");

    const parts = split(address || "", ":");
    const port = (length(parts) > 1) ? parts[1] : null;

    uci.set(service_name, service_name, "http_port", port);
    uci.commit(service_name);
}

/* ================= Entry Point ================= */
const action = ARGV[0];

if (action === "apply") {
    print(apply_config_to_yaml());
} else if (action === "stop") {
   stop();
} else if (action === "update") {
    update_core(ARGV[1]);
} else if (action === "applyFromYaml") {
    apply_from_yaml();
}
