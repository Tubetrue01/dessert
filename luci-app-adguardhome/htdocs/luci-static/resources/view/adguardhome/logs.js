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
        }).replace(/\//g, '-');
    });
}

return L.view.extend({
    load: function () {
        return uci.load(serviceName);
    },

    render: function () {
        const logPath = uci.get(serviceName, serviceName, 'log_file');
        const m = new form.Map(serviceName, null);
        const s = m.section(form.NamedSection, serviceName, serviceName);

        const o = s.option(form.TextValue, '_contents', '');
        o.rows = 30;
        o.readonly = true;
        o.monospace = true;
        o.css = 'width:100%; padding:1rem; font-family:monospace; overflow:auto; white-space:pre;';

        return m.render().then(L.bind(function (mapNode) {

            const h2 = mapNode.querySelector('h2');
            if (h2) {
                h2.style.display = 'none';
            }

            const sectionNode = mapNode.querySelector('.cbi-section-node');
            const topWrap = E('div', {style: 'padding:1rem 0 0 0;'});
            const topRow = E('div', {style: 'display:flex; align-items:center; padding-left:1rem; padding-bottom:1rem;'});

            topWrap.appendChild(topRow);
            sectionNode.prepend(topWrap);

            function createCheckbox(labelText, id) {
                const wrapper = E('div', {style: 'display:inline-flex; align-items:center; margin-right:1rem; cursor:pointer;'});

                const checkbox = E('input', {
                    type: 'checkbox',
                    id: id,
                    style: 'margin: 0 0.5rem 0 0; cursor:pointer; width: 1rem; height: 1rem;'
                });

                const label = E('label', {for: id, style: 'margin:0; cursor:pointer;'}, labelText);

                wrapper.appendChild(checkbox);
                wrapper.appendChild(label);
                topRow.appendChild(wrapper);

                return checkbox;
            }

            function updateLogDisplay() {
                const textarea = mapNode.querySelector('textarea');
                if (!textarea) {
                    return;
                }

                const isAtBottom = textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 10;
                const oldScrollTop = textarea.scrollTop;

                fs.exec('/usr/bin/tail', ['-n', '200', logPath]).then(function (res) {
                    if (!textarea || !res.stdout) {
                        return;
                    }

                    let lines = res.stdout.trim().split('\n');

                    if (localCheckbox.checked) {
                        lines = lines.map(line => {
                            return formatLocalTime(line)
                        });
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

                }).catch(() => {
                });
            }

            const revCheckbox = createCheckbox(_('Reverse'), 'reverseCheck');
            const localCheckbox = createCheckbox(_('Local time'), 'localCheckbox');

            const botWrap = E('div', {
                style: 'padding:1rem 0 0 1rem;'
            });

            const botRow = E('div', {
                style: 'display:flex; align-items:center; gap:1rem;'
            });

            botWrap.appendChild(botRow);
            sectionNode.appendChild(botWrap);

            function createButton(text, className, handler) {
                return E('button', {
                    'class': 'cbi-button ' + className,
                    'click': ui.createHandlerFn(this, handler),
                    'style': 'margin-right: 1rem ;margin-bottom: 1rem'
                }, text);
            }

            const btnClear = createButton(_('Delete'), 'cbi-button-remove', function () {
                L.resolveDefault(callClearLog(logPath), {}).then(function (res) {
                    console.log(JSON.stringify(res));
                    updateLogDisplay()
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

                    setTimeout(function () {
                        URL.revokeObjectURL(url);
                    }, 200);

                }).catch(function (err) {
                    ui.addNotification(null, E('p', _('Failed to download, please check if the file exists')));
                });
            });

            botRow.appendChild(btnClear);
            botRow.appendChild(btnDown);

            revCheckbox.addEventListener('change', updateLogDisplay);
            localCheckbox.addEventListener('change', updateLogDisplay);

            poll.add(updateLogDisplay, 3);
            updateLogDisplay();

            return mapNode;

        }, this));
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
