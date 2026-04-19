#!/usr/bin/ucode

const uci = require("uci").cursor();
const fs = require("fs");

let conf = {};

function get_module_path() {
    const p = fs.popen("uname -r");
    const kernel_v = trim(p.read("all"));
    p.close();

    return `/lib/modules/${kernel_v}`;
}

function initial_conf() {
    uci.load("turboacc");
    conf = uci.get_all("turboacc", "config") || {};
    conf.module_path = get_module_path();

    const keys = ["hw_wed", "hw_flow", "sw_flow", "bbr_cca", "fullcone_nat", "fullcone6"];
    for (let k in keys) {
        conf[k] = conf[k] || "0";
    }

    if (!fs.access(`${conf.module_path}/nft_flow_offload.ko`)) {
        conf.sw_flow = "0";
        conf.hw_flow = "0";
    }

    if (!fs.access(`${conf.module_path}/tcp_bbr.ko`)) {
        conf.bbr_cca = "0";
    }
}

function manage_wed(enable) {
    const module_file = `${conf.module_path}/mt7915e.ko`;

    const release_info = fs.readfile("/etc/openwrt_release") || "";
    if (!match(release_info, /mediatek/)){
        return;
    }

    if (!fs.access(module_file)){
        return;
    }

    const modules_conf = fs.readfile("/etc/modules.conf") || "";

    if (enable) {
        if (!match(modules_conf, /mt7915e/)) {
            fs.writefile(
                "/etc/modules.conf",
                modules_conf + "options mt7915e wed_enable=Y\n"
            );
            system("rmmod mt7915e >/dev/null 2>&1; sleep 1; modprobe mt7915e; wifi up");
        }
    }
    else {
        if (match(modules_conf, /mt7915e/)) {
            const updated = replace(modules_conf, /[^\n]*mt7915e[^\n]*\n?/g, "");

            fs.writefile("/etc/modules.conf", updated);

            system("rmmod mt7915e >/dev/null 2>&1; sleep 1; modprobe mt7915e; wifi up");
        }
    }
}

function update_firewall() {
    uci.load("firewall");

    uci.set("firewall", "@defaults[0]", "flow_offloading", conf.sw_flow);
    uci.set("firewall", "@defaults[0]", "flow_offloading_hw", conf.hw_flow);
    uci.set("firewall", "@defaults[0]", "fullcone", conf.fullcone_nat);

    uci.foreach("firewall", "zone", (s) => {
        if (s["fullcone6"] !== undefined) {
            uci.set("firewall", s[".name"], "fullcone6", conf.fullcone6);
        }
    });

    uci.commit("firewall");
}

function start() {
    initial_conf();
    update_firewall();

    if (conf.hw_flow === "1" && conf.hw_wed === "1") {
        manage_wed(true);
    }

    const cca = (conf.bbr_cca === "1") ? "bbr" : "cubic";
    system(["sysctl", "-w", `net.ipv4.tcp_congestion_control=${cca}`]);

    system("/etc/init.d/firewall restart");
}

function stop() {
    initial_conf();
    update_firewall();

    if (conf.hw_wed === "0") {
        manage_wed(false);
    }

    system("/etc/init.d/firewall restart");
}

switch (ARGV[0]) {
    case "start": start(); break;
    case "stop": stop(); break;
    case "restart": stop(); start(); break;
}
