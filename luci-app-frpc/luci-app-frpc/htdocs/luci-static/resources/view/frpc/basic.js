// noinspection JSAnnotator

'use strict';

'require rpc';
'require uci';
'require form';
'require view';
'require ui';
'require poll';
'require fs';


const serviceName = "frpc";

const callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: ['name'],
    expect: {'': {}}
});


const callUpdateCore = rpc.declare({
    object: 'luci.frpc',
    method: "updateCore",
});

const callCurrentVersion = rpc.declare({
    object: 'luci.frpc',
    method: "currentVersion",
    expect: {'': {}}
});

const callClearLog = rpc.declare({
    object: 'luci.frpc',
    method: 'clearLog',
    params: ['filename'],
});

const getServiceStatus = () => {
    return L.resolveDefault(callServiceList(serviceName), {}).then((res) => {
        let isRunning = false;
        try {
            isRunning = res[serviceName]['instances'][serviceName]['running'];
        } catch (e) {
        }
        return isRunning;
    });
}

const runningStatus = (isRunning) => {
    const runColor = isRunning ? 'green' : 'red';
    const runText = isRunning ? _('Running') : _('Stopped');

    return `
        <em>
            <span style="color:${runColor}"><strong>${_("Frpc")} ${runText}</strong></span>
        </em>`;
}

return view.extend({
    load: function () {
        return Promise.all([
            L.resolveDefault(callCurrentVersion(), {})
        ]);
    },

    render: function (data) {
        const currentVersion = data[0].data;
        let m, s, o;

        m = new form.Map(serviceName, _('Frpc'),
            _('Frpc is a high-performance reverse proxy client that can be used for intranet penetration.'));


        // status bar
        s = m.section(form.TypedSection, "status", _('Service Status'));

        s.anonymous = true;
        s.render = function () {
            setTimeout(function () {
                poll.add(function () {
                    return L.resolveDefault(getServiceStatus())
                        .then((running) => {
                            const view = document.getElementById('serviceStatus');
                            if (view) {
                                view.innerHTML = runningStatus(running);
                            } else {
                                console.error('Element #serviceStatus not found.');
                            }
                        });
                });
            }, 100);

            return E('div', {class: 'cbi-section', id: 'status_bar'}, [
                E('p', {id: 'serviceStatus'}, _('Collecting data...'))
            ]);
        }

        o = m.section(form.NamedSection, "common", serviceName, null);
        o.addremove = false;

        //  Common
        o.tab('common', _('基本设置'));
        o.taboption('common', form.Flag, 'enabled', _('启用')).default = 1;

        // Update button
        let logData = [];
        const updateOption = o.taboption('common', form.DummyValue, '_update_panel', null);

        updateOption.render = function () {
            const renderLog = (textarea, checkbox) => {
                const displayData = checkbox.checked ? [...logData].reverse() : logData;
                textarea.value = displayData.join('\n');
                if (!checkbox.checked) {
                    textarea.scrollTop = textarea.scrollHeight;
                }
            };

            const logBox = E('textarea', {
                'class': 'cbi-input-textarea',
                'style': 'width:100%; height:200px; font-family:monospace; margin-top:10px; display:none;',
                'readonly': true
            });

            const reverseCheck = E('input', {
                'type': 'checkbox',
                'style': 'margin: 0; cursor: pointer; width: 14px; height: 14px; top: 0'
            });

            const checkLabel = E('label', {
                'style': 'display:none; margin-top:10px; align-items: center; cursor: pointer; gap: 6px; line-height: 1;'
            }, [
                reverseCheck,
                E('span', {'style': 'line-height: 1;'}, _('Reverse'))
            ]);

            const btnUpdate = E('button', {
                'class': 'cbi-button cbi-button-apply',
                'click': (ev) => {
                    ev.preventDefault();
                    logBox.style.display = 'block';
                    checkLabel.style.display = 'flex';
                    const logPath = "/tmp/frpc_update.log";

                    L.resolveDefault(callUpdateCore(), {}).then((res) => {
                        const pollLogFn = () => {
                            return L.resolveDefault(fs.read(logPath), '').then((logContent) => {
                                if (logContent) {
                                    const lines = logContent.trim().split('\n');
                                    logData.splice(0, logData.length, ...lines);
                                    renderLog(logBox, reverseCheck);

                                    const lastLine = lines[lines.length - 1] || "";

                                    if (lastLine.includes("Success") || lastLine.includes("Failed")) {
                                        L.Poll.remove(pollLogFn);
                                        L.resolveDefault(callCurrentVersion()).then((res) => {
                                            document.getElementById("core_version_val").innerText = res.data;
                                        });
                                    }
                                }
                            });
                        };
                        L.Poll.add(pollLogFn, 1);
                    });
                }
            }, [_('更新二进制')]);

            reverseCheck.onclick = () => renderLog(logBox, reverseCheck);

            return E('div', {'class': 'cbi-value'}, [
                E('label', {'class': 'cbi-value-title'}, _('更新')),
                E('div', {'class': 'cbi-value-field'}, [
                    E('div', {'style': 'margin-bottom: 8px;'}, [btnUpdate]),
                    E('div', {'class': 'cbi-value-description'}, [
                        E('img', {
                            'src': L.resource('cbi/help.gif'),
                            'style': 'vertical-align: middle; margin-right: 4px;'
                        }),
                        _('The current binary version is:'),
                        E('span', {'id': 'core_version_val', 'style': 'font-weight: bold; color: green;'}, `${currentVersion}`)
                    ]),
                    checkLabel,
                    logBox
                ])
            ]);
        };

        o.taboption('common', form.Value, 'config_path', _('配置路径')).description = _('用于存放生成的 toml 配置文件');
        o.taboption('common', form.Value, 'serverAddr', _('服务器'));
        o.taboption('common', form.Value, 'serverPort', _('端口'));

        const authMethod = o.taboption('common', form.ListValue, 'auth_method', _('认证方法'));

        authMethod.value('', _('None'));
        authMethod.value('token', _('Token'));

        o.taboption('common', form.Value, 'auth_token', _('令牌'));


        const additionalScopes = o.taboption('common', form.DynamicList, 'auth_additionalScopes', _('附加权限'));

        additionalScopes.value('HeartBeats', _('HeartBeats'));
        additionalScopes.value('NewWorkConns', _('NewWorkConns'));

        additionalScopes.default = ['HeartBeats', 'NewWorkConns'];

        o.taboption('common', form.Value, 'user', _('用户')).description = _('用于连接 FRP 服务端的用户名');

        // Advanced
        o.tab('advanced', _('高级设置'));
        const protocol = o.taboption('advanced', form.ListValue, 'transport_protocol', _('传输协议'));

        protocol.value('tcp', _('TCP'));

        protocol.default = 'tcp';
        protocol.description = _('选择与 FRP 服务端通信使用的传输协议');

        o.taboption('advanced', form.Value, 'transport_tls_certFile', _('证书文件'));
        o.taboption('advanced', form.Value, 'transport_tls_keyFile', _('证书私钥'));
        o.taboption('advanced', form.Value, 'transport_tls_trustedCaFile', _('CA 文件'));
        o.taboption('advanced', form.Value, 'transport_tls_serverName', _('证书 SANS 域名'));
        o.taboption('advanced', form.Value, 'transport_tls_certFile', _('证书文件'));

        o.taboption('advanced', form.Value, 'transport_poolCount', _('连接池大小'));
        o.taboption('advanced', form.Flag, 'transport_tcpMux', _('开启 tcpMux'));
        o.taboption('advanced', form.Flag, 'transport_tls_enable', _('开启 TLS 安全'));

        const logLevel = o.taboption('advanced', form.ListValue, 'log_level', _('日志级别'));
        logLevel.value('trace', _('trace'));
        logLevel.value('debug', _('debug'));
        logLevel.value('info', _('info'));
        logLevel.default = 'info';

        o.taboption('advanced', form.Value, 'log_maxDays', _('日志最大天数'));
        o.taboption('advanced', form.Value, 'log_to', _('日志路径'));
        o.taboption('advanced', form.Flag, 'loginFailExit', _('登录失败时退出'));


        // Logs
        o.tab('log', _('Logs'));
        const logPath = '/tmp/frpc.log';

        const logOption = o.taboption('log', form.TextValue, '_contents', '');
        logOption.rows = 30;
        logOption.readonly = true;
        logOption.monospace = true;
        logOption.css = 'width:100%; padding:1rem; font-family:monospace; overflow:auto; white-space:pre;';


        logOption.render = function (section_id) {
            const textarea = E('textarea', {
                'class': 'cbi-input-textarea',
                'style': this.css + '; width:100%; resize:none;',
                'readonly': true,
                'rows': this.rows
            });

            function updateLogDisplay() {
                fs.read(logPath).then(function (res) {
                    let lines = (res || '').trim().split('\n');
                    textarea.value = lines.join('\n');

                }).catch(function () {
                });
            }


            poll.add(updateLogDisplay, 3);
            updateLogDisplay();

            return E('div', {
                'class': 'cbi-section',
                'style': 'padding: 1rem;'
            }, [
                textarea
            ]);
        };

        // Proxy list
        const proxyList = m.section(form.GridSection, 'proxy', _('服务列表'));
        proxyList.addremove = true;
        proxyList.anonymous = true;
        proxyList.sortable = true;

        proxyList.tab('basic', _('基本配置'));
        proxyList.tab('advanced', _('高级配置'));

        o = proxyList.taboption('basic', form.Value, 'remark', _('服务备注名'));

        o = proxyList.taboption('basic', form.ListValue, 'type', _('Frp 协议类型'));
        o.value('http', 'HTTP');
        o.value('https', 'HTTPS');
        o.value('tcp', 'TCP');

        o = proxyList.taboption('basic', form.Value, 'custom_domains', _('自定义域名'));
        o.depends('type', 'https');
        o.depends('type', 'http');

        o.cfgvalue = function(section_id) {
            const type = uci.get('frpc', section_id, 'type');
            if (type === 'tcp') {
                return null;
            }

            const d = uci.get('frpc', section_id, 'custom_domains');
            if (!d) return {
                null;
            }
            return Array.isArray(d) ? d : [d];
        };

        o.write = function(section_id, value) {
            let type = uci.get('frpc', section_id, 'type');

            if (type === 'https' || type === 'http') {
                if (!value || value.length === 0) {
                    uci.unset('frpc', section_id, 'custom_domains');
                } else {
                    uci.set('frpc', section_id, 'custom_domains', value);
                }
            }
        };

        o = proxyList.taboption('basic', form.ListValue, '_domain_type', _('域名类型'));

        o.value('subdomain', '子域名');
        o.value('custom', '自定义域名');
        o.value('both', '同时使用两种域名');

        o.cfgvalue = function(section_id) {
            let type = uci.get('frpc', section_id, 'some_field'); // 可自定义逻辑
            if (type === 'something')
                return 'subdomain';
            return 'toplevel';
        };

        o.write = function(section_id, value) {
        };

        o = proxyList.taboption('basic', form.Value, '_rport', _('远程端口'));
        o.readonly = true;
        o.cfgvalue = function(section_id) {
            let type = uci.get('frpc', section_id, 'type');
            return (type === 'https') ? uci.get('frpc', 'common', 'serverPort') : (uci.get('frpc', section_id, 'remotePort') || '-');
        };

        proxyList.taboption('basic', form.Value, 'localIP', _('本地 IP'));
        proxyList.taboption('basic', form.Value, 'localPort', _('本地端口'));

        o = proxyList.taboption('basic', form.Value, 'remotePort', _('远程端口设置'));
        o.modalonly = true;
        o.depends('type', 'tcp');


        o = proxyList.taboption('advanced', form.Flag, 'transport_useEncryption', _('加密'));
        o.enabled = 'true';
        o.disabled = 'false';

        o = proxyList.taboption('advanced', form.Flag, 'transport_useCompression', _('压缩'));
        o.enabled = 'true';
        o.disabled = 'false';

        o = proxyList.taboption('basic', form.Flag, 'enabled', _('启用'));
        o.enabled = '1';
        o.disabled = '0';
        o.editable = true;

        return m.render();
    }
});
