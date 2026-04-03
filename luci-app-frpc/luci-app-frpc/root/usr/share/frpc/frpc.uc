#!/usr/bin/ucode

const uci = require("uci");
const fs = require("fs");

function replace_key(key) {
	if (type(key) != "string") return key;
	let res = replace(key, /__/g, '-');
	res = replace(res, /_/g, '.');
	return res;
}

function _write_to_toml() {
	const cursor = uci.cursor();
	const pkg = "frpc";
	
	if (!cursor.load(pkg)) return;

	// 获取路径，若为空则默认 /etc/frpc
	let config_path = cursor.get(pkg, "common", "config_path") || "/etc/frpc";
	fs.mkdir(config_path, 755);
	fs.mkdir(config_path + "/confd", 755);

	cursor.foreach(pkg, null, function(s) {
		const stype = s[".type"];
		const sid = s[".name"];

		// --- A. 处理 common 块 ---
		if (stype == "frpc" && sid == "common") {
			if (s.enabled != "1") return;
			let common_toml = "";
			for (let key in s) {
				if (match(key, /^\./) || key == "enabled" || key == "config_path") continue;
				let val = s[key];
				if (val == null || val == "") continue; // 过滤空值

				let toml_key = replace_key(key);
				if (type(val) == "array") {
					common_toml += toml_key + ' = ["' + join('", "', val) + '"]\n';
				} else if (val == "true" || val == "false" || match(val, /^[0-9]+$/)) {
					common_toml += toml_key + " = " + val + "\n";
				} else {
					common_toml += toml_key + ' = "' + val + '"\n';
				}
			}
			let f = fs.open(config_path + "/frpc.toml", "w");
			if (f) { f.write(common_toml); f.close(); }
			return;
		}

		// --- B. 处理 proxy 块 ---
		if (stype == "proxy") {
			if (s.enabled != "1") return;
			const remark = s.remark;
			if (!remark) return;

			let toml = "[[proxies]]\nname = \"" + remark + "\"\n";
			let plugin_lines = [];

			for (let key in s) {
				if (match(key, /^\./) || key == "remark" || key == "enabled") continue;
				let val = s[key];
				if (val == null || val == "") continue; // 过滤空值

				// 1. 处理插件字段
				if (match(key, /^plugin_/)) {
					let p_raw = replace(key, /^plugin_/, "");
					// 核心：剥离前缀后，同样执行 __->- 和 _->.
					let p_key = replace_key(p_raw);
					let p_val = (val == "true" || val == "false" || match(val, /^[0-9]+$/)) ? val : '"' + val + '"';
					push(plugin_lines, p_key + " = " + p_val);
					continue;
                }

				// 2. 处理常规字段
				let toml_key = replace_key(key);
				if (type(val) == "array") {
					toml += toml_key + ' = ["' + join('", "', val) + '"]\n';
				} else if (val == "true" || val == "false" || match(val, /^[0-9]+$/)) {
					toml += toml_key + " = " + val + "\n";
				} else {
					toml += toml_key + ' = "' + val + '"\n';
				}
			}

			if (length(plugin_lines) > 0) {
				toml += "[proxies.plugin]\n" + join("\n", plugin_lines) + "\n";
			}

			let f_proxy = fs.open(config_path + "/confd/" + remark + ".toml", "w");
			if (f_proxy) { f_proxy.write(toml); f_proxy.close(); }
		}
	});
}

_write_to_toml();
