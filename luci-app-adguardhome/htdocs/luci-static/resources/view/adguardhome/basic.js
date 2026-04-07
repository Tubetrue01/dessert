'use strict';
'require poll';
'require rpc';
'require uci';
'require form';
'require view';
'require ui';
'require fs';


const serviceName = "AdGuardHome";

const callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: ['name'],
    expect: { '': {} }
});

const callUpdateCore = rpc.declare({
    object: 'luci.adguardhome',
    method: "updateCore",
});

const callCurrentVersion = rpc.declare({
    object: 'luci.adguardhome',
    method: "currentVersion",
    expect: { '': {} }
});

const getServiceStatus = () => {
    return L.resolveDefault(callServiceList(serviceName), {}).then((res) =>  {
        let isRunning = false;
        try {
            isRunning = res[serviceName]['instances'][serviceName]['running'];
        } catch (e) { }
        return isRunning;
    });
}

const runningStatus = (isRunning) => {
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
            L.resolveDefault(callCurrentVersion(), {})
        ]);
    },

    render: function (data) {
        const currentVersion = data[0].data;
        let m, s, o, v;

        m = new form.Map(serviceName, _('AdGuard Home'),
            _('A free, open-source, and powerful DNS server that blocks network-wide ads and tracking.'));

        // status bar 
        s = m.section(form.TypedSection, "status", _('Service Status'));

        s.anonymous = true;
        s.render = function () {
            setTimeout(function () {
                poll.add(function () {
                    return L.resolveDefault(getServiceStatus())
                        .then( (running) => {
                            const view = document.getElementById('serviceStatus');
                            if (view) {
                                view.innerHTML = runningStatus(running);
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
        o = s.option(form.Flag, 'enabled', _('Enable'));
        o.rmempty = false;
        o.default = '0';

        // WebPort
        o = s.option(form.Value, 'http_port', _('Web management port'));
        o.datatype = 'port';
        o.default = '3000';

        // Web Interface Link
        o = s.option(form.DummyValue, '_link', _('Control Panel'));
        o.render = function(sectionId) {
            const host = window.location.hostname;
            const port = uci.get(serviceName, serviceName, 'http_port') || '3000';
            const url = `http://${host}:${port}`;

            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('Open the web management interface')),
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
        o = s.option(form.DummyValue, '_update_panel', _('Version update'));
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
                E('span', { 'style': 'line-height: 1;' }, _('Reverse'))
            ]);

            const btnUpdate = E('button', {
                'class': 'cbi-button cbi-button-apply',
                'click': (ev) => {
                    ev.preventDefault();
                    logBox.style.display = 'block';
                    checkLabel.style.display = 'flex';
                    const logPath = "/tmp/AdGuardHome_update.log";

                    L.resolveDefault(callUpdateCore(), {}).then((res) => {
                        const pollLogFn = () => {
                            return L.resolveDefault(fs.read(logPath), '').then((logContent) => {
                                if (logContent) {
                                    const lines = logContent.trim().split('\n');
                                    logData.splice(0, logData.length, ...lines);
                                    renderLog(logBox, reverseCheck);

                                    const lastLine = lines[lines.length - 1] || "";
                                    
                                    if (lastLine.includes("Success") || lastLine.includes("Failed")) {
                                        L.Poll.remove(pollLogFn); 
                                        L.resolveDefault(callCurrentVersion()).then((res) => {
                                            document.getElementById("core_version_val").innerText =  res.data; 
                                        });
                                    }
                                }
                            });
                        };
                    L.Poll.add(pollLogFn, 1);
                });
                }
            }, [ _('Update core')]);

            reverseCheck.onclick = () => renderLog(logBox, reverseCheck);

            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('Update version')),
                E('div', { 'class': 'cbi-value-field' }, [
                    E('div', { 'style': 'margin-bottom: 8px;' }, [ btnUpdate ]),
                    E('div', { 'class': 'cbi-value-description' }, [
                        E('img', { 
                            'src': L.resource('cbi/help.gif'), 
                            'style': 'vertical-align: middle; margin-right: 4px;' 
                        }),
                        _('The current core version is:'),
                        E('span', { 'id': 'core_version_val', 'style': 'font-weight: bold; color: green;' }, `${currentVersion}`)
                    ]),
                    checkLabel,
                    logBox
                ])
            ]);
        };

        // Redirect Mode
        o = s.option(form.ListValue, 'redirect', _('Redirect'));
        o.description = _('In Redirect mode, dnsmasq’s port 53 is disabled, so it is best to have AdGuardHome run on port 53');

        o.value('none', _('None'));
        o.value('upstream', _('Upstream server for Dnsmasq'));
        o.value('redirect', _('Redirect port 53 to AdGuard Home'));

        o.default = 'none';

        // Binary path
        o = s.option(form.Value, 'bin_path', _('Binary path'));
        o.description =_('The path to the AdGuard Home executable file. If the executable is not found, it will be downloaded automatically');
        o.datatype = 'string';
        o.default = '/usr/bin/AdGuardHome';
        o.placeholder = '/usr/bin/AdGuardHome';

        // Architecture
        o = s.option(form.ListValue, 'arch', _('The program architecture to download'));
        o.description = _('If this option has been changed, you must first save and apply the changes before clicking download');

        o.value('auto', _('Auto'));
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
        o = s.option(form.ListValue, 'upx_flag',_('Compress the executable file with UPX after downloading')); 
        o.description=_('Reduces the executable file size, but compression may cause compatibility issues');

        o.value('0', _('None'));
        o.value('-1', _('Quick compression'));
        o.value('-9', _('Better compression'));
        o.value('--best', _('Maximum compression (may be slow for large files)'));
        o.value('--brute', _('Try all methods and filters (slow)'));
        o.value('--ultra-brute', _('Try more variant compression methods (very slow)'));

        o.default = '0';

        // Config path
        o = s.option(form.Value, 'config_path', _('Configuration path'));
        o.description =_('AdGuard Home configuration file path');
        o.datatype = 'string';
        o.default = '/etc/AdGuardHome.yaml';
        o.placeholder = '/etc/AdGuardHome.yaml';
        
        // Work dir
        o = s.option(form.Value, 'work_dir', _('Working directory'));
        o.description =_('AdGuard Home working directory, containing rules, audit logs, and database');
        o.datatype = 'string';
        o.default = '/opt/data/AdGuardHome';
        o.placeholder = '/opt/data/AdGuardHome';

        // Logs path
        o = s.option(form.Value, 'log_file', _('Running log'));
        o.description =_('AdGuard Home running log. If set to syslog, logs will be written to the system log; if left empty, no logs will be recorded');
        o.datatype = 'string';
        o.default = '/opt/data/AdGuardHome/log.log';
        o.placeholder = '/opt/data/AdGuardHome/log.log';

        // Detail log
        o = s.option(form.Flag, 'verbose', _('Verbose'));
        o.default = "0";
        o.rmempty = false;

        // Auto restart after boot
        o = s.option(form.ListValue, 'backup_files', _('Backup the working directory files on shutdown.'));
        o.description = _('Restore when the working directory /data is empty');
        o.rmempty = true;

        o.renderWidget = function(sectionId, option_index, cfgvalue) {
            const choices = this.transformChoices();
            const widget = new ui.Select(cfgvalue, choices, {
                id: this.cbid(sectionId),
                multiple: true,         
                widget: 'checkbox',     
                orientation: 'horizontal'
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

        o.formvalue = function(sectionId) {
            const fieldName = this.cbid(sectionId);
            const nodes = document.querySelectorAll(`input[name="${fieldName}"]:checked`);
            
            const values = [];
            nodes.forEach(n => {
                if (n.value) values.push(n.value);
            });
            return values;
        };

        o.value('filters', 'filters');
        o.value('stats.db', 'stats.db');
        o.value('querylog.json', 'querylog.json');
        o.value('sessions.db', 'sessions.db');
        o.value('querylog.json.1', 'querylog.json.1');

        // Work dir backup path
        o = s.option(form.Value, 'work_dir_backup', _('Backup path for the working directory'));
        o.datatype = 'string';
        o.default = '/opt/data/AdGuardHome/backup';
        o.placeholder = '/opt/data/AdGuardHome/backup';

        // Version type to update
        s = m.section(form.NamedSection, 'UpdateLinks', 'AdGuardHome', null);
        s.addremove = false;  
        s.anonymous = false;

        o = s.option(form.DynamicList, 'url', _('Download link for the upgrade'));
        o.rmempty = true;
        o.datatype = 'string';
        
        return m.render();
    }

});