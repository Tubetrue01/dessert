'use strict';

var fs = L.resolveDefault(import('fs'), null);
var ui = L.resolveDefault(import('ui'), null);

return L.view.extend({
    refresh: function() {
        location.reload();
    },

    render: function() {
        var _this = this;

        return Promise.all([
            L.resolveDefault(fs.list('/tmp'), [])
        ]).then(function(data) {
            var files = data[0];

            var body = E('div', { 'class': 'cbi-map' }, [
                E('h2', _('Filer')),
                E('div', { 'class': 'cbi-map-descr' }, _('Support uploading and installation of files in the /tmp directory'))
            ]);

            var uploadSection = E('div', { 'class': 'cbi-section' }, [
                E('h3', _('Upload')),
                E('div', { 'class': 'cbi-section-node' }, [
                    E('button', {
                        'class': 'btn cbi-button-confirm',
                        'click': function(ev) {
                            return ui.uploadFile('/tmp').then(function(res) {
                                ui.addNotification(null, E('p', _('Upload Success: ') + res.name), 'info');
                                _this.refresh();
                            }).catch(function(e) {
                                if (e.message !== 'Canceled') alert(_('Upload Failed: ') + e.message);
                            });
                        }
                    }, _('Upload'))
                ])
            ]);

            var table = E('table', { 'class': 'table cbi-section-table' }, [
                E('tr', { 'class': 'tr cbi-section-table-titles' }, [
                    E('th', { 'class': 'th' }, _('FileName')),
                    E('th', { 'class': 'th' }, _('FileSize')),
                    E('th', { 'class': 'th' }, _('ModifyTime')),
                    E('th', { 'class': 'th' }, _('Operate'))
                ])
            ]);

            files.forEach(function(file) {
                if (file.type !== 'file') return;

                var date = new Date(file.mtime * 1000);
                var timeStr = String.format('%04d-%02d-%02d %02d:%02d:%02d',
                    date.getFullYear(), date.getMonth() + 1, date.getDate(),
                    date.getHours(), date.getMinutes(), date.getSeconds()
                );

                table.appendChild(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, file.name),
                    E('td', { 'class': 'td' }, (file.size / 1024).toFixed(2) + ' KB'),
                    E('td', { 'class': 'td' }, timeStr),
                    E('td', { 'class': 'td' }, [
                        file.name.endsWith('.ipk') ? E('button', {
                            'class': 'btn cbi-button-action',
                            'click': function() {
                                ui.showModal(_('Installing...'), [ E('p', { 'class': 'spinning' }, _('Please wait a moment...')) ]);
                                return fs.exec('/bin/opkg', ['install', '/tmp/' + file.name]).then(function(res) {
                                    ui.hideModal();
                                    ui.addNotification(null, E('pre', res.stdout || res.stderr || _('Finished')), 'info');
                                });
                            }
                        }, _('Install')) : '',

                        E('button', {
                            'class': 'btn cbi-button-remove',
                            'style': 'margin-left: 5px',
                            'click': function() {
                                if (!confirm(_('Delete this?'))) return;
                                return fs.remove('/tmp/' + file.name).then(function() {
                                    _this.refresh();
                                });
                            }
                        }, _('Remove'))
                    ])
                ]));
            });

            body.appendChild(uploadSection);
            body.appendChild(E('div', { 'class': 'cbi-section' }, [
                E('h3', _('FileList')),
                table
            ]));

            return body;
        });
    }
});
