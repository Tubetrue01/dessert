// noinspection JSAnnotator

'use strict';
'require view';
'require fs';
'require form';
'require ui';
'require rpc';

const serviceName = 'irqbalance'

const callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: ['name'],
    expect: { '': {} },
});

function getServiceStatus() {
    return L.resolveDefault(callServiceList(serviceName), {}).then(function (res) {
        try {
            return res[serviceName]['instances'][serviceName]['running'];
        } catch (e) {
            return false;
        }
    });
}

function interrupts() {
    return fs.read_direct('/proc/interrupts');
}

function renderStatus(isRunning) {
    const spanTemp = '<span style="color:%s"><strong>%s</strong></span>';

    return isRunning
        ? String.format(spanTemp, 'green', _('RUNNING'))
        : String.format(spanTemp, 'red', _('NOT RUNNING'));
}

return view.extend({
    load() {
        return L.resolveDefault(interrupts());
    },

    render(data) {
        const cpuNum = data.match(/\bCPU\d+\b/g).map(i => i.slice(3)), // cpuNum = data.match(/(?<=\bCPU)\d+\b/g), // Safari did not support RegExp lookbehind assertion before version 16.4.
            irqNum = data.match(/\b\d+(?=: )/g);
        let m, s, o;

        m = new form.Map(serviceName, _('irqbalance'), _('The purpose of irqbalance is to distribute hardware interrupts across processors/cores on a multiprocessor/multicore system in order to increase performance.'));

        s = m.section(form.NamedSection);
        s.anonymous = true;
        s.render = function () {
            L.Poll.add(function () {
                return L.resolveDefault(getServiceStatus()).then(function (res) {
                    const view = document.getElementById('status');
                    view.innerHTML = renderStatus(res);
                });
            });

            return E('div', { class: 'cbi-section' }, [
                E('p', { id: 'status' }, _('Loading...'))
            ]);
        }

        s = m.section(form.NamedSection);
        s.anonymous = true;

        s.render = function () {
            const snapshot = new ui.Textarea(data.replace(/\n$/, ''), {
                readonly: true,
                monospace: true,
                rows: data.split('\n').length
            });

            const node = snapshot.render();

            L.Poll.add(() => {
                return interrupts().then(newData => {
                    if (!newData) return;
                    const formattedData = newData.replace(/\s+$/, '');

                    snapshot.setValue(formattedData);

                    const el = node.querySelector('textarea');
                    if (el) {
                        el.rows = formattedData.split('\n').length;
                        el.style.whiteSpace = 'pre';
                        el.style.wordBreak = 'normal';
                        el.style.width = '100%';
                    }
                });
            });

            return node;
        }

        s = m.section(form.TypedSection, serviceName, _('General settings'));
        s.anonymous = true;

        o = s.option(form.Flag, 'enabled', _('Enable'));
        o.default = '0';
        o.rmempty = false;

        o = s.option(form.Value, 'deepestcache', _('Deepest cache'), _('Cache level at which irqbalance partitions cache domains.'));
        o.placeholder = '2';
        o.datatype = 'uinteger';
        o.optional = true;

        o = s.option(form.Value, 'interval', _('Interval'), _('Value in seconds.'));
        o.placeholder = '10';
        o.datatype = 'uinteger';
        o.optional = true;

        o = s.option(form.Value, 'banned_cpulist', _('Exclude CPUs'), _('List of CPUs to ignore, can be an integer or integers separated by commas.') + '<br />' + _('Valid values: %s.').format(cpuNum.join(', ')));
        o.placeholder = '0';
        o.optional = true;
        o.validate = function (section_id, value) {
            for (const i of value.split(',')) {
                if (!cpuNum.includes(i) && i !== '') {
                    return _('Invalid');
                }
            }
            return true;
        }

        o = s.option(form.DynamicList, 'banirq', _('Exclude IRQs'), _('List of IRQs to ignore.') + '<br>' + _('Valid values: %s.').format(irqNum.join(', ')));
        o.placeholder = '36';
        o.datatype = 'uinteger';
        o.optional = true;
        o.validate = function (section_id, value) {
            return !irqNum.includes(value) && value !== ''
                ? _('Invalid')
                : true;
        }

        o = s.option(form.Flag, 'debug', _('Show debug output'), _('Show debug output in system log.'));

        return m.render();
    }
});
