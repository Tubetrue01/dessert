'use strict';
'require ui';
'require form';
'require uci';
'require view';
'require fs';

const serviceName = "AdGuardHome";

async function loadCodeMirrorResources() {
	const styles = [
		'/luci-static/resources/view/adguardhome/codemirror5/theme/dracula.min.css',
		'/luci-static/resources/view/adguardhome/codemirror5/addon/lint/lint.min.css',
		'/luci-static/resources/view/adguardhome/codemirror5/codemirror.min.css',
	];
	const scripts = [
		'/luci-static/resources/view/adguardhome/codemirror5/libs/js-yaml.min.js',
		'/luci-static/resources/view/adguardhome/codemirror5/codemirror.min.js',
		'/luci-static/resources/view/adguardhome/codemirror5/addon/display/autorefresh.min.js',
		'/luci-static/resources/view/adguardhome/codemirror5/mode/yaml/yaml.min.js',
		'/luci-static/resources/view/adguardhome/codemirror5/addon/lint/lint.min.js',
		'/luci-static/resources/view/adguardhome/codemirror5/addon/lint/yaml-lint.min.js',
	];
	const loadStyles = async () => {
		for (const href of styles) {
			if (document.querySelector(`link[href="${href}"]`)) continue;
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = href;
			document.head.appendChild(link);
		}
	};
	const loadScripts = async () => {
		for (const src of scripts) {
			if (document.querySelector(`script[src="${src}"]`)) continue;
			const script = document.createElement('script');
			script.src = src;
			document.head.appendChild(script);
			await new Promise(resolve => script.onload = resolve);
		}
	};
	await loadStyles();
	await loadScripts();
}

return view.extend({
	load: function() {
		return Promise.all([
			loadCodeMirrorResources(),
			uci.load(serviceName)
		]);
	},

	render: function (data) {
		const configPath = uci.get(serviceName, serviceName, 'config_path');
		
		const m = new form.Map(serviceName, null);
		const s = m.section(form.NamedSection, serviceName, serviceName);

		let configeditor = null;
		const o = s.option(form.TextValue, 'yaml_config', _('YAML configuration content')); 
		
		o.render = function(section_id, option_id, value) {
			return form.TextValue.prototype.render.apply(this, [section_id, option_id, value])
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
						setTimeout(() => {
							if (window.CodeMirror) {
								configeditor = CodeMirror.fromTextArea(textarea, {
									autoRefresh: true, lineNumbers: true, lineWrapping: true,
									lint: true, gutters: ['CodeMirror-lint-markers'],
									mode: "text/yaml", theme: "dracula", tabSize: 2, indentUnit: 2
								});
								const editorEl = configeditor.getWrapperElement();
								editorEl.style.height = "40rem";
								editorEl.style.width = "100%";
								configeditor.refresh();
							}
						}, 150);
					}
					return node;
				});
		};

		o.cfgvalue = function(sectionId) {
			return fs.read(configPath).then(content => content || '');
		};

		o.write = function(sectionId, formvalue) {
			const editorContent = configeditor ? configeditor.getValue() : formvalue;
			if (!editorContent) return;
			return fs.write(configPath, editorContent.trim().replace(/\r\n/g, '\n') + '\n')
				.catch(e => {
					ui.addNotification(null, E('p', _('Failed to save').format(e.message)), 'danger');
					throw e;
				});
		};

		o.validate = function(sectionId, value) {
			const content = configeditor ? configeditor.getValue() : value;
			
			if (!content || content.trim() === "") {
				return "";
			}

			try {
				if (window.jsyaml) {
					jsyaml.load(content);
				}
			} catch (e) {
				return "";
			}

			return true;
		};

        // Template
		const btn = s.option(form.Button, '_apply_template');
		btn.inputtitle = _('Apply default template');
		btn.inputstyle = 'apply';
		
		btn.onclick = function(ev) {
			const templatePath = '/usr/share/adguardhome/AdGuardHome_template.yaml';
			return fs.read(templatePath).then(content => {
				if (content && configeditor) {
					configeditor.setValue(content);
				}
			}).catch(e => {
				ui.addNotification(null, E('p', _('Failed to read the template').format(e.message)), 'danger');
				throw e; 
			});
		};

		btn.render = function(sectionId, optionId, value) {
			return form.Button.prototype.render.apply(this, [sectionId, optionId, value])
				.then(node => {
					const container = node.closest('.cbi-value');
					if (container) {
						const title = container.querySelector('.cbi-value-title');
						if (title) title.style.display = 'none';

						const field = container.querySelector('.cbi-value-field');
						if (field) { field.style.paddingLeft = '0'; }
						
						container.style.marginTop = '1rem';
					}
					return node;
				});
		};

		return m.render();
	},

		handleSaveApply: function(ev, mode) {
 			ui.changes.displayStatus('notice spinning', E('p', _('Starting configuration apply…')));
			
			return this.handleSave(ev).then(() => {
				return fs.exec('/usr/share/adguardhome/adguardhome.uc', ['applyFromYaml']);
			}).then(() => {
				return fs.exec('/etc/init.d/AdGuardHome', ['reload']);
			}).then(() => {
				ui.changes.displayStatus(false);
				ui.addNotification(null, E('p', _('Applied successfully.')), 'info');
			}).catch(e => {
				ui.changes.displayStatus(false);
				ui.addNotification(null, E('p', _('Failed to apply: %s').format(e.message || e)), 'danger');
			});
		},
});
