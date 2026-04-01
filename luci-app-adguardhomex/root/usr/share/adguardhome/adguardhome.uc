#!/usr/bin/ucode

import { popen, unlink, stat, readlink } from "fs";
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
uci.load(service_name);
uci.load("dhcp");

/* ================= 基础工具 ================= */

function _exec_sys(cmd) {
    const p = popen(`sh -c "${cmd} 2>&1"`, "r");
    if (!p) return { code: -1, data: "" };

    let stdout = p.read("all");
    const code = p.close();

    return {
        code: code,
        data: (type(stdout) == "string") ? trim(stdout) : ""
    };
}

function _safe_unlink(path) {
    if (stat(path)) unlink(path);
}

function _uci_get(setction_name, defaultVal) {
    return uci.get(service_name, service_name, setction_name) || defaultVal;
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

    return _exec_sys(`yq e -i '.${key_path} = "${value}"' "${file}"`).code === 0;
}

/* ================= Core Download ================= */

function _update_core(binpath, upxflag, links) {
    if (!links || length(links) === 0) {
        return false;
    }

    _arch_version_set();

    const tmp = "/tmp/AGH_update";

    _exec_sys(`rm -rf ${tmp} && mkdir -p ${tmp}`);

    for (let i, tpl in links) {
        const url = replace(tpl, /\$\{([^}]+)\}/g,
            (m, k) => k === "Arch" ? state.arch :
                     k === "latest_ver" ? state.latest_ver : m
        );

        const file = `${tmp}/agh.tar.gz`;
        const down_rtn = _exec_sys(`wget --no-check-certificate -O ${file} ${url}`);
        if (down_rtn.code !== 0) {
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

        if (upxflag) {
            _exec_sys(`/usr/bin/upx ${upxflag} "${extracted}"`);
        }
            
        _exec_sys(`mv "${extracted}" "${binpath}"`);
        _exec_sys(`chmod +x "${binpath}"`);
        _exec_sys(`rm -rf ${tmp}`);

        return true;
    }

    _exec_sys(`rm -rf ${tmp}`);
    return false;
}

/* ================= DNS 模式 ================= */

function _set_dns_mode(mode, port) {
    _exec_sys(`nft delete table inet ${service_name} 2>/dev/null`);

    if (mode === "upstream") {
        _set_upstream_dnsmasq(port);
    } else if (mode === "redirect") {
        _stop_upstream_dnsmasq(port);
        uci.set("dhcp", "@dnsmasq[0]", "port", "0");

        const nft_rules = `
            table inet ${service_name} {
                chain prerouting {
                    type nat hook prerouting priority dstnat + 5;
                    meta nfproto { ipv4, ipv6 } ip protocol { tcp, udp } th dport 53 counter redirect to :${port} comment "DNS HIJACK"
                }
            }
        `;
        _exec_sys(`echo '${nft_rules}' | nft -f -`);
    }
}

/* ================= dnsmasq ================= */

function _set_upstream_dnsmasq(port) {
    const addr = `127.0.0.1#${port}`;
    let servers = uci.get("dhcp", "@dnsmasq[0]", "server");

    if (type(servers) !== "array") {
        servers = servers ? [servers] : [];
    }

    let exists = false;

    for (let i, s in servers) {
        if (s === addr) {
            exists = true;
            break;
        }
    }

    if (!exists) {
        push(servers, addr);
        uci.set("dhcp", "@dnsmasq[0]", "server", servers);
        uci.set("dhcp", "@dnsmasq[0]", "noresolv", "1");
        uci.set("dhcp", "@dnsmasq[0]", "port", "53");
        uci.commit("dhcp");
        _exec_sys("/etc/init.d/dnsmasq restart");
    }
}

function _stop_upstream_dnsmasq(port) {
    const addr = `127.0.0.1#${port}`;
    let servers = uci.get("dhcp", "@dnsmasq[0]", "server");

    if (type(servers) !== "array") {
        servers = servers ? [servers] : [];
    }

    const filtered = [];

    for (let i, s in servers) {
        if (s !== addr) {
            push(filtered, s);
        }
    }

    if (length(filtered) !== length(servers)) {
        if (length(filtered) > 0) {
            uci.set("dhcp", "@dnsmasq[0]", "server", filtered);
        } else {
            uci.delete("dhcp", "@dnsmasq[0]", "server");
            uci.delete("dhcp", "@dnsmasq[0]", "noresolv");
        }
        uci.commit("dhcp");
        _exec_sys("/etc/init.d/dnsmasq reload");
    }
}

/* ================= Clean ================= */

function _clear_space_for_backup(workDir, backupDir) {
    const files = ["querylog.json", "stats.db"];

    for (let i, f in files) {
        _safe_unlink(`${workDir}/data/${f}`);
        _safe_unlink(`${backupDir}/${f}`);
    }

    _exec_sys(`rm -rf ${workDir}/data/filters ${backupDir}/filters`);
}

/* ================= Main ================= */

function apply_config_to_yaml() {
    
    const enabled = _uci_get("enabled","0");
    if (enabled === "0") {
        return "false";
    }

    const config_path = _uci_get("config_path", "/etc/AdGuardHome.yaml");
    const work_dir = _uci_get("work_dir", "/opt/data/AdGuardHome");
    const bin_path = _uci_get("bin_path", "/usr/bin/AdGuardHome");
    const http_port = _uci_get("http_port", "3000");

    _patch_config(config_path, "http.address", `0.0.0.0:${http_port}`);

    if (!stat(`${work_dir}/data`)) {
        _exec_sys(`mkdir -p ${work_dir}/data`);
    }
        
    const mount_info = _exec_sys("mount").data;

    if (index(mount_info, "on /overlay type jffs2") !== -1) {
        const dbFiles = ["stats.db", "sessions.db"];

        for (let i, f in dbFiles) {
            const p = `${work_dir}/data/${f}`;
            const tmp = `/tmp/AGH_${f}`;

            if (stat(p) && !readlink(p)) {
                _exec_sys(`mv "${p}" "${tmp}" && ln -s "${tmp}" "${p}"`);
            }
        }
    }

    if (!stat(bin_path)) {
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

        const upx = _uci_get("upx_flag");

        if (!_update_core(bin_path, upx, links)) {
            return "false";
        }
    }

    const mode = _uci_get("redirect", "none");
    const dns_port = _get_config(config_path, "dns.port", "53");

    _set_dns_mode(mode, dns_port);

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

/* ================= Entry Point ================= */

const action = ARGV[0];

if (action === "apply") {
    print(apply_config_to_yaml());
} else if (action === "stop") {
    const mode = _uci_get("redirect", "none");
    const config_path = _uci_get("config_path");
    const port = _get_config(config_path, "dns.port", "53");

    if (mode === "upstream") {
        _stop_upstream_dnsmasq(port);
    }

    _exec_sys(`nft delete table inet ${service_name} 2>/dev/null`);
}