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
    expect: { '': {} }
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

    load: function () {
        return uci.load(serviceName);
    },

    render: function () {
        const logPath = uci.get(serviceName, serviceName, 'log_file');
        const m = new form.Map(serviceName, null);
        const s = m.section(form.NamedSection, serviceName, serviceName);

        const o = s.option(form.DummyValue, '_log_container');

        return m.render().then(L.bind(function (mapNode) {
            const h2 = mapNode.querySelector('h2');
            if (h2) {
                h2.style.display = 'none';
            }

            const sectionNode = mapNode.querySelector('.cbi-section-node');

            const topRow = E('div', { style: 'display:flex; align-items:center; padding:1rem;' });
            sectionNode.prepend(topRow);

            const logBox = E('div', {
                id: 'log_content_box',
                'class': 'cbi-input-textarea',
                style: 'height:30rem; padding:1rem; \
                        overflow-y:auto; \
                        white-space:pre-wrap; \
                        word-break:break-all; \
                        margin:0 1rem; \
                        font-size:0.875rem; \
                        display:block;'
            });

            const dummy = mapNode.querySelector('[id$="_log_container"]');
            if (dummy) {
                dummy.parentNode.replaceChild(logBox, dummy);
            }

            function createCheckbox(labelText, id) {
                const wrapper = E('div', { style: 'display:inline-flex; align-items:center; margin-right:1rem; cursor:pointer;' });
                const checkbox = E('input', { type: 'checkbox', id: id, style: 'margin:0 0.5rem 0 0; cursor:pointer; width:1rem; height:1rem;' });
                const label = E('label', { for: id, style: 'margin:0; cursor:pointer;' }, labelText);
                wrapper.appendChild(checkbox);
                wrapper.appendChild(label);
                topRow.appendChild(wrapper);
                return checkbox;
            }

            const revCheckbox = createCheckbox(_('Reverse'), 'reverseCheck');
            const localCheckbox = createCheckbox(_('Local time'), 'localCheckbox');

            const updateLogDisplay = () => {
                L.resolveDefault(callReadLog(logPath, '200'), {}).then((res) => {
                    const content = (res && res.data) ? res.data.trim() : "";

                    if (content === this.lastLogContent) {
                        return;
                    }

                    const isAtBottom = logBox.scrollHeight - logBox.scrollTop <= logBox.clientHeight + 20;
                    const lines = content.split('\n');

                    if (revCheckbox.checked || logBox.childNodes.length === 0) {
                        logBox.innerHTML = '';
                        const displayLines = revCheckbox.checked ? [...lines].reverse() : lines;
                        displayLines.forEach(line => {
                            const text = localCheckbox.checked ? formatLocalTime(line) : line;
                            logBox.appendChild(E('div', { style: 'line-height:1.4rem;' }, text));
                        });
                    } else {
                        const oldLines = this.lastLogContent.split('\n');
                        const lastLineOfOld = oldLines[oldLines.length - 1];
                        const lastIndexInNew = lines.lastIndexOf(lastLineOfOld);

                        const newLines = (lastIndexInNew !== -1) ? lines.slice(lastIndexInNew + 1) : lines;

                        newLines.forEach(line => {
                            const text = localCheckbox.checked ? formatLocalTime(line) : line;
                            logBox.appendChild(E('div', { style: 'line-height:1.4rem;' }, text));
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
                    logBox.innerHTML = '<div style="color:red;">Failed to load log.</div>';
                });
            };

            const botRow = E('div', { style: 'padding:1rem; display:flex; gap:1rem;' });
            sectionNode.appendChild(botRow);

            botRow.appendChild(E('button', {
                'class': 'cbi-button cbi-button-remove',
                'click': () => {
                    L.resolveDefault(callClearLog(logPath), {}).then(() => {
                        logBox.innerHTML = '';
                        this.lastLogContent = "";
                        updateLogDisplay();
                    });
                }
            }, _('Delete')));

            botRow.appendChild(E('button', {
                'class': 'cbi-button cbi-button-apply',
                'click': () => {
                    window.open(L.url('admin/system/log/download') + '?path=' + encodeURIComponent(logPath));
                }
            }, _('Download')));

            revCheckbox.addEventListener('change', () => { this.lastLogContent = ""; updateLogDisplay(); });
            localCheckbox.addEventListener('change', () => { this.lastLogContent = ""; updateLogDisplay(); });

            poll.add(updateLogDisplay, 3);
            updateLogDisplay();

            return mapNode;
        }, this));
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
