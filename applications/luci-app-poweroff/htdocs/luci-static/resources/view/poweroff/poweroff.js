// noinspection JSAnnotator

'use strict';

'require ui';
'require rpc';
'require view';
'require uci';

const callPoweroff = rpc.declare({
    object: 'luci.poweroff',
    method: 'poweroff',
    expect: {'': {}}
});

return view.extend({
    load() {
        return uci.changes();
    },

    render(changes) {
        const body = E([
            E('h2', _('PowerOff')),
            E('p', {'style': 'padding-left: 1.5rem'}, _('WARNING: May cause a reboot on a device that does not support power off.'))
        ]);

        if (changes && Object.keys(changes).length > 0) {
            body.appendChild(E('p', {'class': 'alert-message warning', 'style': 'padding-left: 1.5rem'},
                _('Warning: There are unsaved changes that will get lost on poweroff!')));
        }

        body.appendChild(E('hr'));
        body.appendChild(E('div', {
            'class': 'cbi-page-actions'
        }, [
            E('button', {
                'class': 'btn danger',
                'click': ui.createHandlerFn(this, 'handlePowerOff')
            }, _('Proceed'))
        ]));

        return body;

    },

    handlePowerOff(ev) {
        ui.showModal(_('Shutting down…'), [
            E('p', { 'class': 'spinning' }, _('Device is shutting down…'))
        ]);

        return callPoweroff().then(res => {
            if (res && res.code === 0) {
                window.setTimeout(() => {
                    window.location.href = L.url('admin');
                }, 10000);
            } else if (res && res.code === -1) {
                ui.addNotification(
                    null,
                    E('p', _('Warning: This device does not support powering off!')),
                    'danger'
                );
            }
        });
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});