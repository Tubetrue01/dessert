// noinspection JSAnnotator

'use strict';
'require form';
'require uci';
'require view';
'require ui';
'require rpc';
'require poll';

const serviceName = "turboacc";

const callStatus = rpc.declare({
    object: 'luci.turboacc',
    method: 'getStatus',
    expect: {"": {}}
});

return view.extend({
    load: function () {
        return uci.load(serviceName);
    },

    render: function (data) {
        let m, s, o;

        m = new form.Map(serviceName, _('Turbo ACC Acceleration Settings'), _('Opensource Flow Offloading driver (Fast Path or Hardware NAT).'));

        s = m.section(form.TypedSection, "status", null);
        s.anonymous = true;
        s.render = L.bind(function () {
            const statusItems = [
                {key: 'sw_flow', label: _('Flow Offloading')},
                {key: 'fullcone_nat', label: _('FullCone NAT')},
                {key: 'bbr', label: _('BBR CCA')}
            ];

            const statusNodes = {};
            const rows = statusItems.map(item => {
                statusNodes[item.key] = E('em', {style: 'color:red'}, _('NOT RUNNING'));

                return E('div', {class: 'tr'}, [
                    E('div', {class: 'td', style: 'text-align:left; width:33%;'}, item.label),
                    E('div', {class: 'td', style: 'text-align:left;'}, statusNodes[item.key])
                ]);
            });

            poll.add(() => {
                return L.resolveDefault(callStatus(), {}).then(res => {
                    for (let key in statusNodes) {
                        let isRunning = !!res[key];
                        statusNodes[key].style.color = isRunning ? 'green' : 'red';
                        statusNodes[key].textContent = isRunning ? (key === 'sw_flow' ? res[key] : _('RUNNING')) : _('NOT RUNNING');
                    }
                });
            }, 5);

            return E('div', {class: 'cbi-section'}, [
                E('div', {class: 'table cbi-section-table'}, rows)
            ]);
        }, s);

        s = m.section(form.NamedSection, 'config', 'turboacc', null);
        s.addremove = false;

        o = s.option(form.Flag, 'sw_flow', _('Software flow offloading'));
        o.description = _('Software based offloading for routing/NAT.');

        o = s.option(form.Flag, 'fullcone_nat', _('FullCone NAT'));
        o.description = _('Using FullCone NAT can improve gaming performance effectively.');

        o = s.option(form.Flag, 'fullcone6', _('IPv6 Full Cone NAT'));
        o.description = _('Enabling IPv6 Full Cone NAT adds an extra layer of NAT to IPv6. In IPv6, if you obtain an IPv6 prefix through IPv6 Prefix Delegation, each device can be assigned a public IPv6 address, eliminating the need for IPv6 Full Cone NAT.');
        o.depends('fullcone_nat', '1');

        o = s.option(form.Flag, 'bbr_cca', _('BBR CCA'));
        o.description = _('Using BBR CCA can improve TCP network performance effectively.');

        return m.render();
    }
});
