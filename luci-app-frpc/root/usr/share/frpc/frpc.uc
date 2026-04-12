#!/usr/bin/ucode

import {open, popen, stat} from "fs";

const uci = require("uci").cursor();

const service_name = "frpc";

const state = {
    arch: "amd64",
    latest_ver: "v0.68.0",
    latest_ver_time: 0
};

const archMap = {
    "aarch64": "arm64",
    "x86_64": "amd64",
    "mips": "mips"
};

const github_api = "https://api.github.com/repos/fatedier/frp/releases/latest";
const bin_path = "/usr/bin/frpc";
const config_path = "/etc/frpc/frpc.yaml";

/* ================= Base Tools ================= */
function _exec_sys(cmd) {
    const p = popen(`sh -c '${cmd}' 2>&1`, "r");
    if (!p) {
        return {code: -1, data: ""};
    }

    const stdout = p.read("all");
    const code = p.close();

    return {
        code: code,
        data: (type(stdout) === "string") ? trim(stdout) : ""
    };
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
    } catch (e) {
    }
}

/* ================= YAML ================= */
function _get_config(file, key_path, defaultVal) {
    const res = _exec_sys(`yq e '.${key_path}' "${file}"`).data;
    return res ? res : defaultVal;
}

function _patch_config(file, key_path, value) {
    const old = _get_config(file, key_path, "");

    if (old === value) {
        return false;
    }
    const cmd = sprintf("yq -i '.%s = \\\"%s\\\"' %s", key_path, value, file);
    return _exec_sys(cmd);
}

/* ================= Core Download ================= */
function update_core(log_file) {
    _arch_version_set();

    const version = replace(state.latest_ver, /^v/, '');
    const download_url = `https://github.com/fatedier/frp/releases/download/${state.latest_ver}/frp_${version}_linux_${state.arch}.tar.gz`;

    _log(`Target architecture is: ${state.arch}, and version is ${state.latest_ver}`, log_file);

    const tmp = "/tmp/frpc_update";

    _exec_sys(`rm -rf ${tmp} && mkdir -p ${tmp}`);

    _log(`Starting download from: ${download_url}`, log_file);

    const file = `${tmp}/frpc.tar.gz`;
    const down_rtn = _exec_sys(`wget --no-check-certificate -O ${file} ${download_url}`);
    if (down_rtn.code !== 0) {
        _log(`Download failed: ${down_rtn.data}, please try again later.`, log_file);
        return false;
    }

    let tarRtn = _exec_sys(`tar -tzf "${file}"`);

    if (tarRtn.code !== 0) {
        _log(`Extract check failed: ${tarRtn.data}`, log_file);
        return false;
    }

    tarRtn = _exec_sys(`tar -xzf "${file}" -C ${tmp}`);
    if (tarRtn.code !== 0) {
        _log(`Extract failed: ${tarRtn.data}`, log_file);
        return false;
    }

    const found = _exec_sys(`find ${tmp} -type f -name frpc`).data;
    if (!found) {
        _log('Frpc not found.', log_file);
        return false;
    }

    const extracted = split(found, "\n")[0];
    if (!stat(extracted)) {
        _log(`Stat failed: file=${extracted}, raw_find=${found}`, log_file);
        return false;
    }

    _exec_sys(`mv "${extracted}" "${bin_path}"`);
    _exec_sys(`chmod +x "${bin_path}"`);
    _exec_sys(`rm -rf ${tmp}`);

    _log("Download Success.", log_file);

    _exec_sys(`rm -rf ${tmp}`);

    return true;
}

/* ================= Main ================= */
function run_args() {
    const enabled = _uci_get("enabled");
    if (enabled === "0") {
        return "false";
    }

    if (!stat(bin_path)) {
        if (!update_core()) {
            return "false";
        }
    }
    return `${bin_path} -c ${config_path}`;
}

/* ================= Entry Point ================= */
const action = ARGV[0];

if (action === "run") {
    print(run_args());
}  else if (action === "update") {
    update_core(ARGV[1]);
}
