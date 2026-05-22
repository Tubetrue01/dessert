// noinspection JSAnnotator

'use strict';

'require ui';
'require rpc';
'require view';
'require poll';

const callOnliner = rpc.declare({
    object: 'luci.onliner',
    method: 'onliner',
    expect: { '': {} }
});

return view.extend({
    render() {
        const table = E('table', { 'class': 'table cbi-section-table', 'id': 'onliner_table' }, [
            E('tr', { 'class': 'tr cbi-section-table-titles' }, [
                E('th', { 'class': 'th' }, _('Hostname')),
                E('th', { 'class': 'th' }, _('IP Address')),
                E('th', { 'class': 'th' }, _('MAC Address')),
                E('th', { 'class': 'th' }, _('Interface'))
            ])
        ]);

        poll.add(() => {
            return callOnliner().then((res) => {
                while (table.rows.length > 1) {
                    table.deleteRow(1);
                }

                const list = res.data || [];

                if (list.length === 0) {
                    const tr = table.insertRow(-1);
                    tr.className = 'tr';
                    const td = tr.insertCell(-1);
                    td.colSpan = 4;
                    td.className = 'td center';
                    td.innerHTML = '<em>' + _('No devices online') + '</em>';
                    return;
                }

                list.forEach((dev, i) => {
                    const tr = table.insertRow(-1);
                    tr.className = 'tr cbi-section-table-row cbi-rowstyle-' + ((i % 2) + 1);

                    tr.insertCell(-1).textContent = dev.hostname || '?';
                    tr.insertCell(-1).textContent = dev.ipaddr;
                    tr.insertCell(-1).textContent = dev.macaddr;
                    tr.insertCell(-1).textContent = dev.device;
                });
            });
        }, 5);

        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('Status')),
            E('div', { 'class': 'cbi-section' }, [
                table
            ])
        ]);
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
