// noinspection JSAnnotator

'use strict';
'require ui';
'require fs';
'require form';
'require poll';
'require uci';
'require rpc';

const serviceName = "AdGuardHome";

const callClearLog = rpc.declare({
    object: 'luci.adguardhome',
    method: 'clearLog',
    params: ['filename'],
});

const callReadLog = rpc.declare({
    object: 'luci.adguardhome',
    method: 'readLog',
    params: ['filename', "count"],
    expect: {'': {}}
});

const formatLocalTime = (text) => {
    return text.replace(/(\d{4})\/(\d{2})\/(\d{2})\s(\d{2}:\d{2}:\d{2})/g, function (match, y, m, d, time) {
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
        });
    });
}

return L.view.extend({
    lastLogContent: "",

    load() {
        return uci.load(serviceName);
    },
    render() {
        const logPath = uci.get(serviceName, serviceName, 'log_file');
        const m = new form.Map(serviceName, null);
        const s = m.section(form.NamedSection, serviceName, serviceName);

        const o = s.option(form.DummyValue, '_log_container');

        o.render = L.bind(function (sectionId) {
            const logBox = E('div', {
                id: 'log_content_box',
                class: 'cbi-input-textarea',
                style: 'width:100%; height:30rem; padding:1rem; \
                          overflow-y:auto; overflow-x:hidden; \
                          white-space:pre-wrap; word-break:break-all; \
                          display:block; font-size:0.875rem;'
            });

            const topRow = E('div', {
                style: 'display:flex; align-items:center; padding-bottom:1rem;'
            });

            const createCheckbox = (labelText, id) => {
                const wrapper = E('div', {
                    style: 'display:inline-flex; align-items:center; margin-right:1.5rem; cursor:pointer;'
                });
                const checkbox = E('input', {
                    type: 'checkbox', id: id,
                    style: 'margin:0 0.5rem 0 0; cursor:pointer; width:1rem; height:1rem;'
                });
                const label = E('label', {for: id, style: 'margin:0; cursor:pointer;'}, labelText);
                wrapper.appendChild(checkbox);
                wrapper.appendChild(label);
                topRow.appendChild(wrapper);
                return checkbox;
            };

            const revCheckbox = createCheckbox(_('Reverse'), 'reverseCheck');
            const localCheckbox = createCheckbox(_('Local time'), 'localCheckbox');

            const botRow = E('div', {
                style: 'display:flex; align-items:center; gap:1rem; padding-top:1rem;'
            });

            const btnClear = E('button', {
                class: 'cbi-button cbi-button-remove',
                click: () => {
                    if (logPath === "syslog") {
                        ui.addNotification(null, E('p', _('The syslog log file is not supported for delete.')), 'danger');
                        return;
                    }
                    L.resolveDefault(callClearLog(logPath), {}).then(() => {
                        logBox.innerHTML = '';
                        this.lastLogContent = "";
                        updateLogDisplay();
                    });
                }
            }, _('Clear Logs'));

            const btnDown = E('button', {
                class: 'cbi-button cbi-button-apply',
                click: () => {
                    if (logPath === "syslog") {
                        ui.addNotification(null, E('p', _('The syslog log file is not supported for download.')), 'danger');
                        return;
                    }
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
                }
            }, _('Download'));

            botRow.appendChild(btnClear);
            botRow.appendChild(btnDown);

            const updateLogDisplay = () => {
                L.resolveDefault(callReadLog(logPath, '200'), {}).then((res) => {
                    const content = (res && res.data) ? res.data.trim() : "";
                    if (content === this.lastLogContent) return;

                    const isAtBottom = logBox.scrollHeight - logBox.scrollTop <= logBox.clientHeight + 20;
                    const lines = content.split('\n');

                    if (revCheckbox.checked || logBox.childNodes.length === 0) {
                        logBox.innerHTML = '';
                        const displayLines = revCheckbox.checked ? [...lines].reverse() : lines;
                        displayLines.forEach(line => {
                            const text = localCheckbox.checked ? formatLocalTime(line) : line;
                            logBox.appendChild(E('div', {style: 'line-height:1.4rem; word-break:break-all;'}, text));
                        });
                    } else {
                        const oldLines = this.lastLogContent.split('\n');
                        const lastLineOfOld = oldLines[oldLines.length - 1];
                        const lastIndexInNew = lines.lastIndexOf(lastLineOfOld);
                        const newLines = (lastIndexInNew !== -1) ? lines.slice(lastIndexInNew + 1) : lines;

                        newLines.forEach(line => {
                            const text = localCheckbox.checked ? formatLocalTime(line) : line;
                            logBox.appendChild(E('div', {style: 'line-height:1.4rem; word-break:break-all;'}, text));
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
                    logBox.innerHTML = '';
                });
            };

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
                class: 'cbi-section',
                style: 'padding:1rem;'
            }, [
                topRow,
                logBox,
                botRow
            ]);
        }, this);

        return m.render();
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
