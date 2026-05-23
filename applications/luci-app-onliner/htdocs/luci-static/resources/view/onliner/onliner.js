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
        const onlineTable = E('table', { 'class': 'table', 'id': 'onliner_table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, [_('Hostname')]),
                E('th', { 'class': 'th' }, [_('IP Address')]),
                E('th', { 'class': 'th' }, [_('MAC Address')]),
                E('th', { 'class': 'th' }, [_('Interface')])
            ])
        ]);

        poll.add(() => {
            return callOnliner().then((res) => {
                const list = res.data || [];

                const tableData = list.map(dev => [
                    dev.hostname || '?',
                    dev.ipaddr || '-',
                    dev.macaddr || '-',
                    dev.device || '-'
                ]);

                cbi_update_table(onlineTable, tableData, E('em', {}, [_('No devices online')]));
            });
        }, 5);

        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, [_('Status')]),
            E('div', { 'class': 'cbi-section cbi-tblsection' }, [
                onlineTable
            ])
        ]);
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
