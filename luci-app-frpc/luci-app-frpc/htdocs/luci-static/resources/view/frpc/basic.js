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

/* RPC */
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

/* 加载 CodeMirror */
async function loadCodeMirrorResources() {
    const styles = [
        '/luci-static/resources/view/adguardhome/codemirror5/codemirror.min.css',
        '/luci-static/resources/view/adguardhome/codemirror5/theme/dracula.min.css',
        '/luci-static/resources/view/adguardhome/codemirror5/addon/lint/lint.min.css',
    ];

    const scripts = [
        '/luci-static/resources/view/adguardhome/codemirror5/libs/js-yaml.min.js',
        '/luci-static/resources/view/adguardhome/codemirror5/codemirror.min.js',
        '/luci-static/resources/view/adguardhome/codemirror5/addon/display/autorefresh.min.js',
        '/luci-static/resources/view/adguardhome/codemirror5/mode/yaml/yaml.min.js',
        '/luci-static/resources/view/adguardhome/codemirror5/addon/lint/lint.min.js',
        '/luci-static/resources/view/adguardhome/codemirror5/addon/lint/yaml-lint.min.js',
    ];

    for (const href of styles) {
        if (!document.querySelector(`link[href="${href}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            document.head.appendChild(link);
        }
    }

    for (const src of scripts) {
        if (!document.querySelector(`script[src="${src}"]`)) {
            await new Promise(resolve => {
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
    }
}

/* 服务状态 */
function getServiceStatus() {
    return L.resolveDefault(callServiceList(serviceName), {}).then(res => {
        try {
            return res[serviceName].instances[serviceName].running;
        } catch (e) {
            return false;
        }
    });
}


function renderStatus(running) {
    const color = running ? 'green' : 'red';
    const text = running ? _('Running') : _('Stopped');

    return `<span style="color:${color}"><strong>Frpc ${text}</strong></span>`;
}

return view.extend({

    load: function () {
        return Promise.all([
            loadCodeMirrorResources(),
            uci.load(serviceName)
            // L.resolveDefault(callCurrentVersion(), {})
        ]);
    },

    render: function (data) {
        const currentVersion = data[1]?.data || "unknown";
        const configPath = uci.get(serviceName, serviceName, 'config_path');

        let m, s, o, yaml;

        m = new form.Map(serviceName, _('Frpc'),
            _('Frpc is a high-performance reverse proxy client.'));

        // Status bar
        s = m.section(form.TypedSection, "status", _('Service Status'));
        s.anonymous = true;

        s.render = function () {
            const el = E('p', {id: 'serviceStatus'}, _('Loading...'));

            poll.add(() => {
                return getServiceStatus().then(running => {
                    el.innerHTML = renderStatus(running);
                });
            }, 2);

            return E('div', {class: 'cbi-section'}, [el]);
        };

        // Config
        o = m.section(form.NamedSection, serviceName, serviceName);
        o.addremove = false;

        o.tab('common', _('Basic Settings'));
        o.tab('log', _('Logs'));

        o.taboption('common', form.Flag, 'enabled', _('Enable')).default = 1;

        const configPathOption = o.taboption('common', form.Value, 'config_path', _('Config Path'));
        configPathOption.render = function (sectionId, optionId, value) {
            return form.Value.prototype.render.apply(this, [sectionId, optionId, value])
                .then(node => {
                    const input = node.querySelector('input');
                    if (input) {
                        input.addEventListener('change', () => {
                            const newPath = input.value.trim();
                            if (!newPath) {
                                return;
                            }

                            yaml.cfgvalue = () => fs.read(newPath).then(c => c || '');

                            if (editor) {
                                fs.read(newPath).then(content => {
                                    editor.setValue(content || '');
                                });
                            }
                        });
                    }
                    return node;
                });
        }

        // Update binary
        let logData = [];
        const updateBtn = o.taboption('common', form.DummyValue, '_update_panel', _('更新'));
        updateBtn.render = function () {
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
                                            document.getElementById("bin_version_val").innerText = res.data;
                                        });
                                    }
                                }
                            });
                        };
                        L.Poll.add(pollLogFn, 1);
                    });
                }
            }, [_('Update Binary')]);

            reverseCheck.onclick = () => renderLog(logBox, reverseCheck);

            return E('div', {'class': 'cbi-value'}, [
                E('label', {'class': 'cbi-value-title'}, _('Update version')),
                E('div', {'class': 'cbi-value-field'}, [
                    E('div', {'style': 'margin-bottom: 8px;'}, [btnUpdate]),
                    E('div', {'class': 'cbi-value-description'}, [
                        E('img', {
                            'src': L.resource('cbi/help.gif'),
                            'style': 'vertical-align: middle; margin-right: 4px;'
                        }),
                        _('The current binary version is:'),
                        E('span', {'id': 'bin_version_val', 'style': 'font-weight: bold; color: green;'}, `${currentVersion}`)
                    ]),
                    checkLabel,
                    logBox
                ])
            ]);
        };

        // Yaml
        let editor = null;

        yaml = o.taboption('common', form.TextValue, 'config', "配置编辑器");
        yaml.rows = 10;

        yaml.cfgvalue = () => fs.read(configPath).then(c => c || '');

        yaml.write = function (sid, val) {
            const content = editor ? editor.getValue() : val;

            return fs.write(configPath, content.trim() + '\n')
                .then(() => {
                    ui.addNotification(null, E('p', _('Saved successfully')), 'info');
                });
        };

        yaml.validate = function (sid, val) {
            const content = editor ? editor.getValue() : val;

            if (!content.trim()) return true;

            try {
                jsyaml.load(content);
                return true;
            } catch (e) {
                return _('YAML error: %s').format(e.message);
            }
        };

        yaml.render = function (sid) {
            return form.TextValue.prototype.render.apply(this, arguments)
                .then(node => {

                    const textarea = node.querySelector('textarea');

                    setTimeout(() => {
                        if (window.CodeMirror) {
                            editor = CodeMirror.fromTextArea(textarea, {
                                mode: "yaml",
                                theme: "dracula",
                                lineNumbers: true,
                                lineWrapping: true,
                                lint: true,
                                gutters: ['CodeMirror-lint-markers']
                            });

                            editor.on('change', cm => {
                                textarea.value = cm.getValue();
                                textarea.dispatchEvent(new Event('change', {bubbles: true}));
                            });

                            const wrapper = editor.getWrapperElement();

                            wrapper.style.width = "30rem";
                            wrapper.style.minWidth = "30rem";
                            wrapper.style.maxWidth = "30rem";

                            const scroller = editor.getScrollerElement();
                            scroller.style.overflowX = "hidden";
                            scroller.style.overflowY = "scroll";

                            editor.setSize("30rem", "25rem");

                            setTimeout(() => editor.refresh(), 0);
                        }
                    }, 100);

                    return node;
                });
        };

        // Logs
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
        let ps = m.section(form.TypedSection, null);

        ps.render = function () {
            return fs.read(configPath).then(content => {
                let proxies = [];
                let yamlData;
                try {
                    yamlData = jsyaml.load(content || '') || {};
                    proxies = yamlData.proxies || [];
                } catch (e) {
                    console.error("YAML Parse Error", e);
                }

                let rows = proxies.length === 0
                    ? [E('tr', {'class': 'tr cbi-section-table-row placeholder'}, [
                        E('td', {'class': 'td', 'colspan': '8'}, [E('em', {}, [_('尚无任何配置')])])
                    ])]
                    : proxies.map(p => E('tr', {'class': 'tr cbi-section-table-row'}, [
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.name || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.type || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.customDomains || yamlData.serverAddr]),
                        E('td', {'class': 'td cbi-section-table-cell'}, [yamlData.serverPort || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.localIP || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.localPort || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.transport.useEncryption || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.transport.useEncryption || '-']),
                    ]));

                return E('div', {
                    'id': 'cbi-frpc-proxies',
                    'class': 'cbi-section cbi-tblsection',
                    'style': 'margin-top: 1rem;'
                }, [
                    E('h3', {}, [_('服务列表')]),
                    E('table', {'class': 'table cbi-section-table'}, [
                        E('thead', {'class': 'thead cbi-section-thead'}, [
                            E('tr', {'class': 'tr cbi-section-table-titles anonymous'}, [
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('名称')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('Frp 协议类型')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('域名/子域名')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('远程端口')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('内网主机地址')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('本地端口')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('开启数据加密')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('使用压缩')]),
                            ])
                        ]),
                        E('tbody', {'class': 'tbody cbi-section-tbody'}, rows)
                    ])
                ]);
            });
        };


        return m.render();
    },


    handleSaveApply: function (ev, mode) {
        return this.super('handleSaveApply', [ev, mode]).then(function () {
            return fs.exec('/etc/init.d/frpc', ['reload']);
        });
    }
});
