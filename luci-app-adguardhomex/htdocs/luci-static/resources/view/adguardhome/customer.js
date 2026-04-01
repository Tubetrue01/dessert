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
			uci.load('AdGuardHome')
		]);
	},

	render: function (data) {
		const configPath = uci.get(serviceName, serviceName, 'config_path');
		
		const m = new form.Map(serviceName, null);
		const s = m.section(form.NamedSection, serviceName, serviceName);

		let configeditor = null;
		const o = s.option(form.TextValue, 'yaml_config', _('YAML 配置内容')); 
		
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

		o.cfgvalue = function(section_id) {
			return fs.read(configPath).then(content => content || '');
		};

		o.write = function(section_id, formvalue) {
			const editorContent = configeditor ? configeditor.getValue() : formvalue;
			if (!editorContent) return;
			return fs.write(configPath, editorContent.trim().replace(/\r\n/g, '\n') + '\n')
				.then(() => fs.exec('/etc/init.d/adguardhome', ['restart']))
				.catch(e => ui.addNotification(null, E('p', _('保存失败: %s').format(e.message)), 'danger'));
		};

        // Template
		const btn = s.option(form.Button, '_apply_template');
		btn.inputtitle = _('应用默认模版');
		btn.inputstyle = 'apply';
		
		btn.onclick = function(ev) {
			const templatePath = '/etc/AdGuardHome.yaml';
			return fs.read(templatePath).then(content => {
				if (content && configeditor) {
					configeditor.setValue(content);
				}
			}).catch(e => {
				ui.addNotification(null, E('p', _('读取模版失败: %s').format(e.message)), 'danger');
			});
		};

		btn.render = function(section_id, option_id, value) {
			return form.Button.prototype.render.apply(this, [section_id, option_id, value])
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
	}
});
