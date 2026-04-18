// noinspection JSAnnotator

'use strict';
'require ui';
'require form';
'require uci';
'require view';
'require fs';
'require rpc';

const serviceName = "AdGuardHome";

const callReload = rpc.declare({
    object: 'luci.adguardhome',
    method: 'reload',
    expect: { '': {} }
});

async function loadCodeMirrorResources() {
    const bundlePath = '/luci-static/resources/view/AdGuardHome/codemirror6/cm6-yaml-editor.js';
    if (window.CM6) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = bundlePath + '?v=' + (new Date().getTime());
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load CM6 bundle"));
        document.head.appendChild(script);
    });
}

return view.extend({
    load: function () {
        return Promise.all([
            loadCodeMirrorResources(),
            uci.load(serviceName)
        ]);
    },

    render: function (data) {
        const configPath = uci.get(serviceName, serviceName, 'config_path');
        const m = new form.Map(serviceName, null);
        const s = m.section(form.NamedSection, serviceName, serviceName);

        let configEditor = null;

        const o = s.option(form.DummyValue, '_yaml_config', _('YAML configuration content'));

        o.render = function (sectionId) {
            const container = E('div', { 'class': 'cbi-value', 'style': 'display:flex; flex-direction:column; align-items:stretch;' }, [
                E('label', { 'class': 'cbi-value-title', 'style': 'width:100%; text-align:left; font-weight:bold; margin-bottom:0.5rem;' }, _('YAML configuration content')),
                E('div', { 'class': 'cbi-value-field', 'style': 'width:100%; padding:0; margin:0;' }, [
                    E('div', { 'id': 'cm6-editor-holder', 'style': 'width:100%' })
                ])
            ]);

            fs.read(configPath).then(content => {
                const initialValue = content || '';
                const editorHolder = container.querySelector('#cm6-editor-holder');

                if (window.CM6 && editorHolder) {
                    configEditor = window.CM6.create(editorHolder, initialValue);

                    const cmRoot = editorHolder.querySelector('.cm-editor');
                    if (cmRoot) cmRoot.style.width = "100%";

                    const scroller = editorHolder.querySelector('.cm-scroller');
                    if (scroller) {
                        scroller.style.height = "40rem";
                        scroller.style.width = "100%";
                    }
                }
            });

            return container;
        };

        const btn = s.option(form.Button, '_apply_template');
        btn.inputtitle = _('Apply default template');
        btn.inputstyle = 'apply';
        btn.onclick = function (ev) {
            const templatePath = '/etc/AdGuardHome/AdGuardHome_template.yaml';
            return fs.read(templatePath).then(content => {
                if (content && configEditor) {
                    configEditor.dispatch({
                        changes: {from: 0, to: configEditor.state.doc.length, insert: content}
                    });
                }
            }).catch(e => {
                ui.addNotification(null, E('p', _('Failed to read the template: %s').format(e.message)), 'danger');
            });
        };

        btn.render = function (sectionId, optionId, value) {
            return form.Button.prototype.render.apply(this, [sectionId, optionId, value])
                .then(node => {
                    const container = node.closest('.cbi-value');
                    if (container) {
                        const title = container.querySelector('.cbi-value-title');
                        if (title) title.style.display = 'none';
                        const field = container.querySelector('.cbi-value-field');
                        if (field) field.style.paddingLeft = '0';
                        container.style.marginTop = '1rem';
                    }
                    return node;
                });
        };

        const originalParse = m.parse;
        m.parse = function() {
            if (configEditor && configEditor.state) {
                const content = configEditor.state.doc.toString().trim() + '\n';

                try {
                    if (window.jsyaml) window.jsyaml.load(content);
                } catch (e) {
                    return Promise.reject(e);
                }

                return fs.write(configPath, content.replace(/\r\n/g, '\n'))
                    .then(() => originalParse.apply(m, arguments))
                    .catch(e => {
                        return Promise.reject(e);
                    });
            }
            return originalParse.apply(m, arguments);
        };

        this.map = m;
        return m.render();
    },

    handleSaveApply: function (ev, mode) {
        ui.changes.displayStatus(
            'notice spinning',
            E('p', _('Starting configuration apply…'))
        );

        return this.map.save()
            .then(() => uci.changes())
            .then(changes => {
                if (changes && Object.keys(changes).length > 0) {
                    return uci.apply();
                }
            })
            .then(() => callReload())
            .then(() => {
                ui.changes.displayStatus(
                    'notice',
                    E('p', _('Configuration changes applied.'))
                );

                setTimeout(() => {
                    ui.changes.displayStatus(false);
                    window.location.reload();
                }, 2000);
            })
            .catch(e => {
                ui.changes.displayStatus(false);
                ui.addNotification(null, E('p', _('Failed to apply: %s').format(e.message || e)), 'danger');
            });
    },
});
