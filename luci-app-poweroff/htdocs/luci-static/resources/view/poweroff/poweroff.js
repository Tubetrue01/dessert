// noinspection JSAnnotator

'use strict';

'require ui';
'require rpc';
'require view';

const callPoweroff = rpc.declare({
    object: 'luci.poweroff',
    method: 'poweroff',
    expect: {'': {}}
});

const getChanges = rpc.declare({
    object: 'uci',
    method: 'changes',
    expect: {'changes': {}}
});

let confirmedOnce = false;

return L.view.extend({

    render() {
        return E('div', {'class': 'cbi-map'}, [
            E('h2', _('PowerOff')),
            E('hr'),

            E('div', {'class': 'cbi-section'}, [
                E('div', {'class': 'cbi-section-descr'}, _('WARNING: May cause a reboot on a device that does not support power off.')),
            ]),

            E('div', {'class': 'cbi-page-actions'}, [
                E('button', {
                    'class': 'cbi-button cbi-button-reset important',
                    'click': ui.createHandlerFn(this, 'handlePowerOff')
                }, [_('Proceed')])
            ])
        ]);
    },

    handlePowerOff(ev) {
        return getChanges().then(changes => {
            if (!confirmedOnce && changes && Object.keys(changes).length > 0) {
                ui.addNotification(null, E('p', _('Warning: There are unsaved changes that will get lost on poweroff!')), 'danger');
                confirmedOnce = true;
                return;
            }

            ui.changes.displayStatus(
                'notice spinning',
                E('p', {'class': 'spinning'}, _('Device is shutting down...'))
            );

            return callPoweroff()
                .then(res => {
                    if (res && res.code === 0) {
                        window.setTimeout(() => {
                            window.location.href = L.url('admin');
                        }, 10000);
                    } else if (res && res.code === -1) {
                        ui.changes.displayStatus(false);
                        ui.addNotification(null, E('p', _('Warning: This device does not support powering off!')), 'danger');
                    }
                });
        });
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});