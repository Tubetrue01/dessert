'use strict'
'require poll';
'require rpc';
'require uci';
'require form';
'require view';
'require ui';


const serviceName = "AdGuardHome";

const callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: ['name'],
    expect: { '': {} }
});

const callUpateCore = rpc.declare({
    object: 'luci.adguardhome',
    method: "updateCore",
});

const getServiceStatus = () => {
    return L.resolveDefault(callServiceList(serviceName), {}).then(function (res) {
        let isRunning = false;
        try {
            isRunning = res[serviceName]['instances'][serviceName]['running'];
        } catch (e) { }
        return isRunning;
    });
}

const runnintStatus = (isRunning) => {
    const runColor = isRunning ? 'green' : 'red';
    const runText = isRunning ? _('Running') : _('Stopped');

    return `
        <em>
            <span style="color:${runColor}"><strong>${_("AdGuard Home")} ${runText}</strong></span>
        </em>`;
}

return view.extend({
    load: function () {
        return Promise.all([
            L.resolveDefault(),
        ]);
    },

    render: function (data) {
        let m, s, o, v;

        m = new form.Map(serviceName, _('AdGuard Home'),
            _('免费开源，功能强大的全网络广告和跟踪程序拦截 DNS 服务器'));

        // status bar 
        s = m.section(form.TypedSection, "status", _('Service Status'));

        s.anonymous = true;
        s.render = function () {
            setTimeout(function () {
                poll.add(function () {
                    return L.resolveDefault(getServiceStatus())
                        .then(function (running) {
                            const view = document.getElementById('serviceStatus');
                            if (view) {
                                view.innerHTML = runnintStatus(running);
                            } else {
                                console.error('Element #serviceStatus not found.');
                            }
                        });
                });
            }, 100);

            return E('div', { class: 'cbi-section', id: 'status_bar' }, [
                E('p', { id: 'serviceStatus' }, _('Collecting data...'))
            ]);
        }

        s = m.section(form.NamedSection, serviceName, serviceName);

        // Enable button
        o = s.option(form.Flag, 'enabled', _('开启'));
        o.rmempty = false;
        o.default = '0';

        // WebPort
        o = s.option(form.Value, 'http_port', _('网页管理端口'));
        o.datatype = 'port';
        o.default = '3000';

        // Web Interface Link
        o = s.option(form.DummyValue, '_link', _('Control Panel'));
        o.render = function(section_id) {
            const host = window.location.hostname;
            const port = uci.get(serviceName, serviceName, 'http_port') || '3000';
            const url = `http://${host}:${port}`;

            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('打开网页管理界面')),
                E('div', { 'class': 'cbi-value-field' }, [
                    E('input', {
                        'type': 'text',
                        'class': 'cbi-input-text', 
                        'readonly': true,
                        'value': `AdguardHomeWeb:${port}`,
                        'style': 'text-align: center; cursor:pointer; color:green; font-weight:bold; width:100%;',
                        'title': _('Click to open AdGuard Home Web Interface'),
                        'click': (ev) => {
                            window.open(url, '_blank');
                        }
                    })
                ])
            ]);
        };

        // Update button
        let logData = [];
        o = s.option(form.DummyValue, '_update_panel', _('版本更新'));
        o.render = function() {
            const renderLog = (textarea, checkbox) => {
                const displayData = checkbox.checked ? [...logData].reverse() : logData;
                textarea.value = displayData.join('\n');
                if (!checkbox.checked) {
                    textarea.scrollTop = textarea.scrollHeight;
                }
            };

            const logBox = E('textarea', {
                'class': 'cbi-input-textarea',
                'style': 'width:100%; height:200px; font-family:monospace; margin-top:10px; display:none;',
                'readonly': true
            });

            const reverseCheck = E('input', { 
                'type': 'checkbox', 
                'style': 'margin: 0; cursor: pointer; width: 14px; height: 14px; top: 0'  
            });

            const checkLabel = E('label', { 
                'style': 'display:none; margin-top:10px; align-items: center; cursor: pointer; gap: 6px; line-height: 1;' 
            }, [
                reverseCheck,
                E('span', { 'style': 'line-height: 1;' }, _('逆序排列日志'))
            ]);

            const btnUpdate = E('button', {
                'class': 'cbi-button cbi-button-apply',
                'click': (ev) => {
                    ev.preventDefault();
                    logBox.style.display = 'block';
                    checkLabel.style.display = 'flex';
                    
                    logData.push(`[${new Date().toLocaleTimeString()}] 开始检查更新...`);
                    renderLog(logBox, reverseCheck);
                }
            }, [ _('更新核心版本')]);

            reverseCheck.onclick = () => renderLog(logBox, reverseCheck);

            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('版本更新')),
                E('div', { 'class': 'cbi-value-field' }, [
                    E('div', { 'style': 'margin-bottom: 8px;' }, [ btnUpdate ]),
                    E('div', { 'class': 'cbi-value-description' }, [
                        E('img', { 
                            'src': L.resource('cbi/help.gif'), 
                            'style': 'vertical-align: middle; margin-right: 4px;' 
                        }),
                        _('当前的核心版本为：0x162')
                    ]),
                    checkLabel,
                    logBox
                ])
            ]);
        };

        // Redirect Mode
        o = s.option(form.ListValue, 'redirect', _('重定向'));
        o.description = _('选择处理 DNS 流量的方式。');

        o.value('none', _('无'));
        o.value('upstream', _('作为 Dnsmasq 的上游服务器'));
        o.value('redirect', _('重定向 53 端口到 AdGuardHome'));

        o.default = 'none';

        // Binary path
        o = s.option(form.Value, 'bin_path', _('执行文件路径'));
        o.description =_('AdGuardHome 执行文件路径 如果没有执行文件将自动下载');
        o.datatype = 'string';
        o.default = '/usr/bin/AdGuardHome';
        o.placeholder = '/usr/bin/AdGuardHome';

        // Architecture
        o = s.option(form.ListValue, 'arch', _('要下载的程序架构'));
        o.description = _('手动下载前如该选项有变更需先保存并应用后再点下载');

        o.value('auto', _('自动'));
        o.value('386', 'i386');
        o.value('amd64', 'x86_64');
        o.value('armv5','armv5');
        o.value('armv6','armv6');
        o.value('armv7','armv7');
        o.value('arm64','aarch64');
        o.value('mips_softfloat','mips');
        o.value('mips64_softfloat','mips64');
        o.value('mipsle_softfloat','mipsel');
        o.value('mips64le_softfloat','mips64el');
        o.value('ppc64le','powerpc64');

        o.default = 'auto';

        // Upx to compress
        o = s.option(form.ListValue, 'upx_flag',_('下载后使用 upx 压缩执行文件')); 
        o.description=_('减小执行文件空间占用，但是可能压缩后有兼容性问题');

        o.value('0', _('无'));
        o.value('-1', _('快速压缩'));
        o.value('-9', _('更好的压缩'));
        o.value('--best', _('最好的压缩(大文件可能慢)'));
        o.value('--brute', _('尝试所有可能的压缩方法和过滤器[慢]'));
        o.value('--ultra-brute', _('尝试更多变体压缩手段[很慢]'));

        o.default = '0';

        // Config path
        o = s.option(form.Value, 'config_path', _('配置文件路径'));
        o.description =_('AdGuardHome 配置文件路径');
        o.datatype = 'string';
        o.default = '/etc/AdGuardHome.yaml';
        o.placeholder = '/etc/AdGuardHome.yaml';
        
        // Work dir
        o = s.option(form.Value, 'work_dir', _('工作目录'));
        o.description =_('AdGuardHome 工作目录包含规则，审计日志和数据库');
        o.datatype = 'string';
        o.default = '/opt/data/AdGuardHome';
        o.placeholder = '/opt/data/AdGuardHome';

        // Logs path
        o = s.option(form.Value, 'log_file', _('运行日志'));
        o.description =_(' AdGuardHome 运行日志 如果填 syslog 将写入系统日志；如果空则不记录日志');
        o.datatype = 'string';
        o.default = '/opt/data/AdGuardHome/log.log';
        o.placeholder = '/opt/data/AdGuardHome/log.log';

        // Detail log
        o = s.option(form.Flag, 'verbose', _('详细日志'));
        o.default = "0";
        o.rmempty = false;

        // Auto restart after boot
        o = s.option(form.ListValue, 'backup_files', _('在关机时备份工作目录文件'));
        o.description = _('在工作目录 /data 为空的时候恢复');
        o.widget = 'checkbox';

        o.renderWidget = function(section_id, option_index, cfgvalue) {
            const choices = this.transformChoices();
            const widget = new ui.Select(cfgvalue, choices, {
                id: this.cbid(section_id),
                multiple: true,         
                widget: 'checkbox',     
                orientation: 'horizontal',  
                disabled: (this.readonly != null) ? this.readonly : this.map.readonly
            });

            const node = widget.render();

            requestAnimationFrame(() => {
                node.querySelectorAll('.cbi-checkbox').forEach(el => {
                    el.style.marginRight = '1rem';
                    el.style.display = 'inline-flex';
                    el.style.alignItems = 'center';
                    el.style.gap = '0.2rem';
                });
            });
            return node;
        };

        o.value('filters', 'filters');
        o.value('stats.db', 'stats.db');
        o.value('querylog.json', 'querylog.json');
        o.value('sessions.db', 'sessions.db');
        o.value('querylog.json.1', 'querylog.json.1');

        o.rmempty = true;

        // Work dir backup path
        o = s.option(form.Value, 'work_dir_backup', _('工作目录备份路径'));
        o.datatype = 'string';
        o.default = '/opt/data/AdGuardHome/backup';
        o.placeholder = '/opt/data/AdGuardHome/backup';

        // Version type to update
        s = m.section(form.NamedSection, 'UpdateLinks', 'AdGuardHome', null);
        s.addremove = false;  
        s.anonymous = false;

        o = s.option(form.DynamicList, 'url', _('升级用的下载链接'));
        o.rmempty = true;
        o.datatype = 'string';
        
        return m.render();
    }

});