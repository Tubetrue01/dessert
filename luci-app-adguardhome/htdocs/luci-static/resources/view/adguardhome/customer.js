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
    const bundlePath = '/luci-static/resources/view/adguardhome/codemirror6/cm6-yaml-editor.js';

    if (window.CM6) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = bundlePath + '?v=' + (new Date().getTime());
        script.onload = () => {
            resolve();
        };
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
        const o = s.option(form.TextValue, 'yaml_config', _('YAML configuration content'));

        o.render = function (sectionId, optionId, value) {
            return form.TextValue.prototype.render.apply(this, [sectionId, optionId, value])
                .then(node => {
                    const container = node.closest('.cbi-value');
                    if (container) {
                        container.style.flexDirection = 'column';
                        container.style.alignItems = 'stretch';
                        container.style.display = 'flex';
                        const title = container.querySelector('.cbi-value-title');
                        if (title) {
                            title.style.width = '100%';
                            title.style.textAlign = 'left';
                            title.style.fontWeight = 'bold';
                        }
                        const field = container.querySelector('.cbi-value-field');
                        if (field) {
                            field.style.width = '100%';
                            field.style.paddingLeft = '0';
                        }
                    }

                    const textarea = node.querySelector('textarea');
                    if (textarea) {
                        textarea.style.display = 'none';

                        const editorHolder = document.createElement('div');
                        editorHolder.className = 'cm6-editor-holder';
                        textarea.parentNode.insertBefore(editorHolder, textarea);

                        if (window.CM6) {
                            configEditor = window.CM6.create(editorHolder, textarea.value, (content) => {
                                textarea.value = content;
                            });

                            const scroller = editorHolder.querySelector('.cm-scroller');
                            if (scroller) {
                                scroller.style.height = "40rem";
                            }
                        }
                    }
                    return node;
                });
        };

        o.formvalue = function (sectionId) {
            if (configEditor && configEditor.state) {
                return configEditor.state.doc.toString();
            }
            return this.super('formvalue', [sectionId]);
        };

        o.cfgvalue = function (sectionId) {
            return fs.read(configPath).then(content => {
                return content || '';
            });
        };

        o.write = function (sectionId, formvalue) {
            const editorContent = (configEditor && configEditor.state) ? configEditor.state.doc.toString() : formvalue;
            if (!editorContent && editorContent !== "") {
                return;
            }

            return fs.write(configPath, editorContent.trim().replace(/\r\n/g, '\n') + '\n')
                .catch(e => {
                    ui.addNotification(null, E('p', _('Failed to save').format(e.message)), 'danger');
                    throw e;
                });
        };

        o.validate = function (sid, val) {
            const content = configEditor ? configEditor.state.doc.toString() : val;

            this.value = content;

            if (!content || !content.trim()) {
                return ""
            }

            try {
                window.jsyaml.load(content);
            } catch (e) {
                return ""
            }

            return true;
        };

        const btn = s.option(form.Button, '_apply_template');
        btn.inputtitle = _('Apply default template');
        btn.inputstyle = 'apply';

        btn.onclick = function (ev) {
            const templatePath = '/usr/share/adguardhome/AdGuardHome_template.yaml';
            return fs.read(templatePath).then(content => {
                if (content && configEditor) {
                    configEditor.dispatch({
                        changes: {from: 0, to: configEditor.state.doc.length, insert: content}
                    });
                }
            }).catch(e => {
                ui.addNotification(null, E('p', _('Failed to read the template').format(e.message)), 'danger');
                throw e;
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

        return m.render();
    },

    handleSaveApply: function (ev, mode) {
        ui.changes.displayStatus(
            'notice spinning',
            E('p', _('Starting configuration apply…'))
        );

        return this.handleSave(ev)
            .then(() => {
                return callReload();
            })
            .then(() => {
                ui.changes.displayStatus(
                    'notice',
                    E('p', _('Configuration changes applied.'))
                );
                setTimeout(() => {
                    ui.changes.displayStatus(false);
                }, 1500);
            })
            .catch(e => {
                ui.changes.displayStatus(false);
                ui.addNotification(
                    null,
                    E('p', _('Failed to apply: %s').format(e.message || e)),
                    'danger'
                );
            });
    },
});
