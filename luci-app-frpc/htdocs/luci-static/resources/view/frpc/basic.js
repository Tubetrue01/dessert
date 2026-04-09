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
const configPath = "/etc/frpc/frpc.yaml"

const formatLocalTime = (text) => {
    return text.replace(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}:\d{2}:\d{2})(\.\d+)?/g, function (match, y, m, d, time) {
        const utcstr = `${y}-${m}-${d}T${time}Z`;
        const date = new Date(utcstr);

        if (isNaN(date.getTime())) return match;

        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).replace(/\//g, '-');
    });
}

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

const getServiceStatus = () => {
    return L.resolveDefault(callServiceList(serviceName), {}).then(res => {
        try {
            return res[serviceName].instances[serviceName].running;
        } catch (e) {
            return false;
        }
    });
}


const renderStatus = (running) => {
    const color = running ? 'green' : 'red';
    const text = running ? _('Running') : _('Stopped');

    return `
        <em>
            <span style="color:${color}"><strong>${_("Frpc")} ${text}</strong></span>
        </em>`;
}

return view.extend({

    load: function () {
        return Promise.all([
            loadCodeMirrorResources(),
            uci.load(serviceName),
            L.resolveDefault(callCurrentVersion(), {})
        ]);
    },

    render: function (data) {
        const currentVersion = data[2]?.data || "unknown";
        let m, s, o, yaml;

        m = new form.Map(serviceName, _('Frpc'),
            _('Frpc is a high-performance reverse proxy client.'));

        this.map = m;
        // Status bar
        s = m.section(form.TypedSection, "status", null);
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

        o.tab('common', _('通用配置'));
        o.tab('log', _('Logs'));

        o.taboption('common', form.Flag, 'enabled', _('Enable')).default = 1;

        // Update binary
        let logData = [];
        const updateBtn = o.taboption('common', form.DummyValue, '_update_panel', _('Update'));
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
                'style': 'width:100%; height:10rem; font-family:monospace; margin-top:1rem; display:none;',
                'readonly': true
            });

            const reverseCheck = E('input', {
                'type': 'checkbox',
                'style': 'margin: 0; cursor: pointer; top: 0'
            });

            const checkLabel = E('label', {
                'style': 'display:none; margin-top:1rem; align-items: center; cursor: pointer; gap: 0.5rem; line-height: 1;'
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
                E('label', {'class': 'cbi-value-title'}, _('Update')),
                E('div', {'class': 'cbi-value-field'}, [
                    E('div', {'style': 'margin-bottom: 1rem;'}, [btnUpdate]),
                    E('div', {'class': 'cbi-value-description'}, [
                        E('img', {
                            'src': L.resource('cbi/help.gif'),
                            'style': 'vertical-align: middle; margin-right: 0.3rem;'
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
        let logPath;
        let editor = null;

        yaml = o.taboption('common', form.TextValue, 'config', _('Yaml Editor'));
        yaml.rows = 10;

        yaml.cfgvalue = () =>
            fs.read(configPath).then(c => {
                const content = c || '';
                try {
                    const cfg = jsyaml.load(content);
                    if (cfg?.log?.to) logPath = cfg.log.to;
                } catch (e) {
                    console.error("YAML parse error:", e);
                }
                return content;
            });

        yaml.write = function (sid, val) {
            const content = editor ? editor.getValue() : val;
            return fs.write(configPath, content.trim() + '\n');
        };

        yaml.validate = function (sid, val) {
            const content = editor ? editor.getValue() : val;

            if (!content.trim()) return true;

            try {
                jsyaml.load(content);
                return true;
            } catch (e) {
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
        const logOption = o.taboption('log', form.TextValue, '_contents', null);
        logOption.rows = 30;
        logOption.readonly = true;
        logOption.monospace = true;
        logOption.css = 'width:100%; padding:1rem; font-family:monospace; overflow:auto; white-space:pre;';

        logOption.render = function (sectionId) {
            const textarea = E('textarea', {
                'class': 'cbi-input-textarea',
                'style': this.css + '; width:100%; resize:none;',
                'readonly': true,
                'rows': this.rows
            });

            const topRow = E('div', {
                style: 'display:flex; align-items:center; padding-bottom:1rem;'
            });

            function createCheckbox(labelText, id) {
                const wrapper = E('div', {
                    style: 'display:inline-flex; align-items:center; margin-right:1.5rem; cursor:pointer; line-height: 1;'
                });

                const checkbox = E('input', {
                    type: 'checkbox',
                    id: id,
                    style: 'margin: 0 0.5rem 0 0; cursor:pointer; width: 1rem; height: 1rem;'
                });

                const label = E('label', {
                    for: id,
                    style: 'margin:0; cursor:pointer; display: flex; align-items: center;'
                }, labelText);

                wrapper.appendChild(checkbox);
                wrapper.appendChild(label);
                topRow.appendChild(wrapper);

                return checkbox;
            }

            const revCheckbox = createCheckbox(_('Reverse'), 'reverseCheck');
            const localCheckbox = createCheckbox(_('Local time'), 'localCheckbox');

            const botRow = E('div', {
                style: 'display:flex; align-items:center; gap:1rem; padding-top:1rem;'
            });

            function createButton(text, className, handler) {
                return E('button', {
                    'class': 'cbi-button ' + className,
                    'click': ui.createHandlerFn(this, handler),
                    'style': 'margin-bottom:1rem;'
                }, text);
            }

            const btnClear = createButton(_('Delete'), 'cbi-button-remove', function () {
                L.resolveDefault(callClearLog(logPath), {}).then(function () {
                    textarea.value = "";
                    updateLogDisplay();
                });
            });

            const btnDown = createButton(_('Download'), 'cbi-button-apply', function () {
                fs.read_direct(logPath, 'blob').then(function (res) {
                    let blob;

                    if (res instanceof Blob) {
                        blob = res;
                    } else if (res && res.data) {
                        blob = new Blob([res.data], {type: "application/octet-stream"});
                    } else {
                        blob = new Blob([res], {type: "application/octet-stream"});
                    }

                    const url = URL.createObjectURL(blob);
                    const fileName = logPath.split('/').pop();

                    const a = document.createElement("a");
                    a.href = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    setTimeout(() => URL.revokeObjectURL(url), 200);

                }).catch(function () {
                    ui.addNotification(null, E('p', _('Failed to download, please check if the file exists')));
                });
            });

            botRow.appendChild(btnClear);
            botRow.appendChild(btnDown);

            function updateLogDisplay() {
                const isAtBottom = textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 10;
                const oldScrollTop = textarea.scrollTop;

                fs.exec('/usr/bin/tail', ['-n', '200', logPath]).then(function (res) {
                    if (!res.stdout) {
                        textarea.value = "";
                        return;
                    }

                    let lines = res.stdout.trim().split('\n');

                    if (localCheckbox.checked) {
                        lines = lines.map(line => formatLocalTime(line));
                    }

                    if (revCheckbox.checked) {
                        lines.reverse();
                    }

                    const newText = lines.join('\n');

                    if (textarea.value !== newText) {
                        textarea.value = newText;

                        if (revCheckbox.checked) {
                            textarea.scrollTop = oldScrollTop;
                        } else if (isAtBottom) {
                            textarea.scrollTop = textarea.scrollHeight;
                        } else {
                            textarea.scrollTop = oldScrollTop;
                        }
                    }

                }).catch(function () {
                    textarea.value = "";
                });
            }

            revCheckbox.addEventListener('change', updateLogDisplay);
            localCheckbox.addEventListener('change', updateLogDisplay);

            poll.add(updateLogDisplay, 3);
            updateLogDisplay();

            return E('div', {
                'class': 'cbi-section',
                'style': 'padding:1rem;'
            }, [
                topRow,
                textarea,
                botRow
            ]);
        };

        // Proxy list
        const ps = m.section(form.TypedSection, null);

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
                        E('td', {'class': 'td', 'colspan': '8'}, [E('em', {}, [_('No configurations yet')])])
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
                    E('h3', {}, [_('Server Lists')]),
                    E('table', {'class': 'table cbi-section-table'}, [
                        E('thead', {'class': 'thead cbi-section-thead'}, [
                            E('tr', {'class': 'tr cbi-section-table-titles anonymous'}, [
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('name')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('protocol type')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('domain/subdomain')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('remote port')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('local ip')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('local port')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('use encryption')]),
                                E('th', {'class': 'th cbi-section-table-cell'}, [_('use compression')]),
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
        ui.changes.displayStatus(
            'notice spinning',
            E('p', _('Starting configuration apply…'))
        );

        return this.map.save().then(() => {
            return uci.save();
        }).then(() => {
            return uci.apply().catch(e => {
                return Promise.resolve();
            });
        }).then(() => {
            return fs.exec('/etc/init.d/frpc', ['restart']);
        }).then(() => {
            return ui.changes.init();
        }).then(() => {
            ui.changes.displayStatus(
                'notice',
                E('p', _('Configuration changes applied.'))
            );

            setTimeout(() => {
                ui.changes.displayStatus(false);
            }, 1500);
        }).catch(e => {
            ui.changes.displayStatus(false);
            ui.addNotification(
                null,
                E('p', _('Failed to apply: %s').format(e.message || e)),
                'danger'
            );
        });
    }
});
