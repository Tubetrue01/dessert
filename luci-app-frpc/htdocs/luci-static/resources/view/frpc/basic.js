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
    const bundlePath = '/luci-static/resources/view/frpc/codemirror6/cm6-yaml-editor.js';

    if (window.CM6) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = bundlePath + '?v=' + (new Date().getTime());
        script.onload = () => {
            resolve();
        };
        script.onerror = () => reject(new Error("Failed to load CM6 bundle"));
        document.head.appendChild(script);
    });
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

        o.tab('common', _('Common'));
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

        yaml.cfgvalue = function (sid) {
            return fs.read(configPath).then(c => {
                const content = c || '';
                try {
                    const cfg = jsyaml.load(content);
                    if (cfg?.log?.to) {
                        logPath = cfg.log.to;
                    }
                } catch (e) {
                    console.error("YAML parse error in cfgvalue:", e);
                }
                return content;
            });
        };

        yaml.formvalue = function (section_id) {
            if (editor && editor.state) {
                return editor.state.doc.toString();
            }
            return this.super('formvalue', [section_id]);
        };

        yaml.write = function (sid, val) {
            const content = editor ? editor.state.doc.toString() : val;
            return fs.write(configPath, content.trim() + '\n');
        };

        yaml.validate = function (sid, val) {
            const content = editor ? editor.state.doc.toString() : val;

            this.value = content;

            if (!content || !content.trim()) {
                return ""
            }

            try {
                window.jsyaml.load(content);
            } catch (e) {
                return ""
            }

            return true;
        };

        yaml.render = function (sid) {
            return form.TextValue.prototype.render.apply(this, arguments)
                .then(node => {
                    const textarea = node.querySelector('textarea');
                    const initialValue = textarea.value;
                    textarea.style.display = 'none';

                    const container = document.createElement('div');
                    container.className = 'cm6-container';

                    container.style.width = "30rem";
                    container.style.maxWidth = "30rem";
                    container.style.overflow = "hidden";
                    container.style.display = "block";

                    textarea.parentNode.insertBefore(container, textarea);

                    if (window.CM6) {
                        editor = window.CM6.create(container, initialValue, (content) => {
                            textarea.value = content;
                            textarea.setAttribute('value', content);
                        });

                        const editorEl = container.querySelector('.cm-editor');
                        if (editorEl) {
                            editorEl.style.width = "100%";
                            editorEl.style.maxWidth = "100%";
                        }

                        const scroller = container.querySelector('.cm-scroller');
                        if (scroller) {
                            scroller.style.height = "25rem";
                            scroller.style.overflow = "auto";
                        }

                        const contentEl = container.querySelector('.cm-content');
                        if (contentEl) {
                            contentEl.style.minWidth = "0";
                            contentEl.style.overflowWrap = "break-word";
                        }
                    }

                    return node;
                });
        };

        // Logs
        const logOption = o.taboption('log', form.TextValue, '_contents', null);
        this.lastLogContent = "";

        logOption.render = function (sectionId) {
            const logBox = E('div', {
                'id': 'log_content_box',
                'class': 'cbi-input-textarea',
                'style': 'width:100%; height:30rem; padding:1rem; \
                          overflow-y:auto; white-space:pre-wrap; word-break:break-all; \
                          display:block; resize:none; font-size:0.875rem;'
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

            const btnClear = createButton(_('Delete'), 'cbi-button-remove', () => {
                L.resolveDefault(callClearLog(logPath), {}).then(() => {
                    logBox.innerHTML = "";
                    this.lastLogContent = "";
                    updateLogDisplay();
                });
            });

            const btnDown = createButton(_('Download'), 'cbi-button-apply', function () {
                fs.read_direct(logPath, 'blob').then(function (res) {
                    let blob = (res instanceof Blob) ? res : new Blob([res.data || res], {type: "application/octet-stream"});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = logPath.split('/').pop();
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 200);
                });
            });

            botRow.appendChild(btnClear);
            botRow.appendChild(btnDown);

            const updateLogDisplay = () => {
                fs.exec('/usr/bin/tail', ['-n', '200', logPath]).then((res) => {
                    const content = (res && res.stdout) ? res.stdout.trim() : "";

                    if (content === this.lastLogContent) {
                        return;
                    }

                    const isAtBottom = logBox.scrollHeight - logBox.scrollTop <= logBox.clientHeight + 20;
                    const lines = content.split('\n');

                    if (revCheckbox.checked || this.lastLogContent === "") {
                        logBox.innerHTML = '';
                        const displayLines = revCheckbox.checked ? [...lines].reverse() : lines;
                        displayLines.forEach(line => {
                            const text = localCheckbox.checked ? formatLocalTime(line) : line;
                            logBox.appendChild(E('div', {style: 'line-height:1.4rem;'}, text));
                        });
                    } else {
                        const oldLines = this.lastLogContent.split('\n');
                        const lastLineOfOld = oldLines[oldLines.length - 1];
                        const lastIndexInNew = lines.lastIndexOf(lastLineOfOld);

                        const newLines = (lastIndexInNew !== -1) ? lines.slice(lastIndexInNew + 1) : lines;

                        newLines.forEach(line => {
                            const text = localCheckbox.checked ? formatLocalTime(line) : line;
                            logBox.appendChild(E('div', {style: 'line-height:1.4rem;'}, text));
                        });

                        while (logBox.childNodes.length > 300) {
                            logBox.removeChild(logBox.firstChild);
                        }
                    }

                    this.lastLogContent = content;

                    if (isAtBottom && !revCheckbox.checked) {
                        logBox.scrollTop = logBox.scrollHeight;
                    }
                }).catch(() => {
                    logBox.innerHTML = "";
                });
            }

            revCheckbox.addEventListener('change', () => {
                this.lastLogContent = "";
                updateLogDisplay();
            });
            localCheckbox.addEventListener('change', () => {
                this.lastLogContent = "";
                updateLogDisplay();
            });

            poll.add(updateLogDisplay, 3);
            updateLogDisplay();

            return E('div', {
                'class': 'cbi-section',
                'style': 'padding:1rem;'
            }, [
                topRow,
                logBox,
                botRow
            ]);
        };

        return fs.read(configPath).then(content => {
            let yamlData = {};
            try {
                yamlData = jsyaml.load(content || '') || {};
            } catch (e) {
                console.error("YAML Parse Error", e);
            }

            const renderBool = (val, trueText = _('true'), falseText = _('false')) =>
                val == null ? '-' : (val ? trueText : falseText);

            // Server
            o = m.section(form.TypedSection, null);
            o.render = function () {
                const configRow = yamlData.serverAddr ? E('tr', {'class': 'tr cbi-section-table-row'}, [
                    E('td', {'class': 'td cbi-section-table-cell'}, [yamlData.serverAddr || '-']),
                    E('td', {'class': 'td cbi-section-table-cell'}, [yamlData.serverPort || '-']),
                    E('td', {'class': 'td cbi-section-table-cell'}, [yamlData.auth?.method || '-']),
                    E('td', {'class': 'td cbi-section-table-cell'}, [yamlData.log?.level || '-']),
                    E('td', {'class': 'td cbi-section-table-cell'}, [yamlData.log?.to || '-']),
                    E('td', {'class': 'td cbi-section-table-cell'}, [yamlData.transport?.protocol || '-']),
                    E('td', {'class': 'td cbi-section-table-cell'}, [yamlData.transport?.poolCount || '-']),
                    E('td', {'class': 'td cbi-section-table-cell'}, [renderBool(yamlData.transport?.tcpMux)]),
                    E('td', {'class': 'td cbi-section-table-cell'}, [renderBool(yamlData.transport?.tls?.enable)]),
                    E('td', {'class': 'td cbi-section-table-cell'}, [renderBool(yamlData.loginFailExit)]),
                ]) : E('tr', {'class': 'tr cbi-section-table-row placeholder'}, [
                    E('td', {'class': 'td', 'colspan': '10'}, [E('em', {}, [_('No configurations yet')])])
                ]);

                return E('div', {'class': 'cbi-section cbi-tblsection', 'style': 'margin-top: 1rem;'}, [
                    E('h3', {}, [_('Server')]),
                    E('table', {'class': 'table cbi-section-table'}, [
                        E('thead', {'class': 'thead cbi-section-thead'}, [
                            E('tr', {'class': 'tr cbi-section-table-titles'}, [
                                E('th', {'class': 'th'}, [_('address')]),
                                E('th', {'class': 'th'}, [_('port')]),
                                E('th', {'class': 'th'}, [_('auth')]),
                                E('th', {'class': 'th'}, [_('log level')]),
                                E('th', {'class': 'th'}, [_('log path')]),
                                E('th', {'class': 'th'}, [_('transport protocol')]),
                                E('th', {'class': 'th'}, [_('pool count')]),
                                E('th', {'class': 'th'}, [_('tcpMux')]),
                                E('th', {'class': 'th'}, [_('tls')]),
                                E('th', {'class': 'th'}, [_('login fail exit')]),
                            ])
                        ]),
                        E('tbody', {'class': 'tbody cbi-section-tbody'}, [configRow])
                    ])
                ]);
            };

            // Proxy List
            o = m.section(form.TypedSection, null);
            o.render = function () {
                const proxies = yamlData.proxies || [];
                let rows = proxies.length === 0
                    ? [E('tr', {'class': 'tr cbi-section-table-row placeholder'}, [
                        E('td', {'class': 'td', 'colspan': '9'}, [E('em', {}, [_('No configurations yet')])])
                    ])]
                    : proxies.map(p => E('tr', {'class': 'tr cbi-section-table-row'}, [
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.name || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.type || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.customDomains?.[0] || yamlData.serverAddr || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.subdomain || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.remotePort || yamlData.serverPort || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.localIP || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [p.localPort || '-']),
                        E('td', {'class': 'td cbi-section-table-cell'}, [renderBool(p.transport?.useEncryption)]),
                        E('td', {'class': 'td cbi-section-table-cell'}, [renderBool(p.transport?.useCompression)]),
                    ]));

                return E('div', {'class': 'cbi-section cbi-tblsection', 'style': 'margin-top: 1rem;'}, [
                    E('h3', {}, [_('Server Lists')]),
                    E('table', {'class': 'table cbi-section-table'}, [
                        E('thead', {'class': 'thead cbi-section-thead'}, [
                            E('tr', {'class': 'tr cbi-section-table-titles'}, [
                                E('th', {'class': 'th'}, [_('name')]),
                                E('th', {'class': 'th'}, [_('protocol type')]),
                                E('th', {'class': 'th'}, [_('domain')]),
                                E('th', {'class': 'th'}, [_('subdomain')]),
                                E('th', {'class': 'th'}, [_('remote port')]),
                                E('th', {'class': 'th'}, [_('local ip')]),
                                E('th', {'class': 'th'}, [_('local port')]),
                                E('th', {'class': 'th'}, [_('use encryption')]),
                                E('th', {'class': 'th'}, [_('use compression')])
                            ])
                        ]),
                        E('tbody', {'class': 'tbody cbi-section-tbody'}, rows)
                    ])
                ]);
            };

            return m.render();
        });
    },

    handleSaveApply: function (ev, mode) {
        ui.changes.displayStatus(
            'notice spinning',
            E('p', _('Starting configuration apply…'))
        );

        return this.map.save().then(() => {
            return uci.save();
        }).then(() => uci.changes())
            .then((changes) => {
                if (changes && Object.keys(changes).length > 0) {
                    return uci.apply();
                }
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
                    window.location.reload();
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
