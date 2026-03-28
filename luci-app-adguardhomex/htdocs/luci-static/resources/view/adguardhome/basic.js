'use strict'
'require poll';
'require rpc';
'require uci';
'require form';
'require view';

const callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: ['name'],
    expect: { '': {} }
});

const getServiceStatus = () => {
    // TODO need to process redirecting status
    return L.resolveDefault(callServiceList('adguardhome'), {}).then(function (res) {
        let isRunning = false;
        try {
            isRunning = res['adguardhome']['instances']['adguardhome']['running'];
        } catch (e) { }
        return isRunning;
    });
}

const renderStatus = (isRunning, isRedirecting) => {
    const runColor = isRunning ? 'green' : 'red';
    const runText = isRunning ? _('Running') : _('Stopped');

    const redirColor = isRedirecting ? 'green' : 'red';
    const redirText = isRedirecting ? _('Redirecting') : _('NotRedirect');

    return `
        <em>
            <span style="color:${runColor}"><strong>${_("AdGuard Home")} ${runText}</strong></span>
            <span style="color:${redirColor}"><strong> | ${redirText}</strong></span>
        </em>`;
}

const loadStaticResource = async () => {

}


return view.extend({
    load: function () {
        return Promise.all([
            L.resolveDefault(),
        ]);
    },

    render: function (data) {
        let m, s, o, v;

        m = new form.Map('AdGuardHome', _('AdGuard Home'),
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
                                view.innerHTML = renderStatus(running, false);
                            } else {
                                console.error('Element #serviceStatus not found.');
                            }
                        });
                });
            }, 100);

            // Now we can load static resources after the initial render to avoid blocking the UI
            loadStaticResource();

            return E('div', { class: 'cbi-section', id: 'status_bar' }, [
                E('p', { id: 'serviceStatus' }, _('Collecting data...'))
            ]);
        }

        s = m.section(form.NamedSection, 'AdGuardHome', 'AdGuardHome');

        // Enable button
        o = s.option(form.Flag, 'enabled', _('开启'));
        o.rmempty = false;
        o.default = '0';

        // WebPort
        o = s.option(form.Value, 'httpport', _('网页管理端口'));
        o.datatype = 'port';
        o.default = '3000';

        // Web Interface Link
        o = s.option(form.DummyValue, '_link', _('Control Panel'));
        o.render = function(section_id) {
            const host = window.location.hostname;
            const port = uci.get('AdGuardHome', section_id, 'httpport') || '3000';
            const url = `http://${host}:${port}`;

            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('打开网页管理界面')),
                E('div', { 'class': 'cbi-value-field' }, [
                    E('input', {
                        'type': 'text',
                        'class': 'cbi-input-text', // 继承主题的输入框样式
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
                if (!checkbox.checked) textarea.scrollTop = textarea.scrollHeight;
            };

            const logBox = E('textarea', {
                'class': 'cbi-input-textarea',
                'style': 'width:100%; height:200px; font-family:monospace; margin-top:10px; display:none;',
                'readonly': true
            });

            const reverseCheck = E('input', { 'type': 'checkbox', 'style': 'margin-right:5px' });
            const checkLabel = E('label', { 'style': 'display:none; margin-top:10px' }, [
                reverseCheck, _('逆序排列日志')
            ]);

            const btnForce = E('button', {
                'class': 'cbi-button cbi-button-reset',
                'style': 'display:none; margin-left:10px',
                'click': () => {
                    logData.push(`[${new Date().toLocaleTimeString()}] 触发强制更新...`);
                    renderLog(logBox, reverseCheck);
                }
            }, [ _('强制更新') ]);

            const btnUpdate = E('button', {
                'class': 'cbi-button cbi-button-apply',
                'click': (ev) => {
                    btnForce.style.display = 'inline-block';
                    logBox.style.display = 'block';
                    checkLabel.style.display = 'block';
                    
                    logData.push(`[${new Date().toLocaleTimeString()}] 开始检查更新...`);
                    renderLog(logBox, reverseCheck);
                }
            }, [ _('更新核心版本') ]);

            reverseCheck.onclick = () => renderLog(logBox, reverseCheck);

            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('更新')),
                E('div', {}, [ btnUpdate, btnForce ]),
                checkLabel,
                logBox
            ]);
        };

        return m.render();

    }

});