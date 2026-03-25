'use strict';

'require ui';
'require fs';
'require rpc';


var callInstall = rpc.declare({
    object: 'luci.filemanager',
    method: 'install',
    params: ['filename'],
});

var callRename = rpc.declare({
    object: 'luci.filemanager',
    method: 'rename',
    params: ["oldName", 'newName'],
    expect: { '': {} }
});

var callMkdir = rpc.declare({
    object: 'luci.filemanager',
    method: 'mkdirUpload',
    params: ["uploadPath"],

});

var upload_path="/tmp/upload"
var tmp_file="upload_tmp.tmp"

return L.view.extend({
    load: function() {
        return Promise.all([
            L.resolveDefault(callMkdir(upload_path), {}),
        ]);
    },

    refresh: function() {
        location.reload();
    },

    render: function(modules) {
        var _this = this;

        return fs.list(upload_path).then(function(files) {
            var body = E('div', { 'class': 'cbi-map' }, [
                E('h2', _('Upload'))
            ]);

            var uploadSection = E('div', { 'class': 'cbi-section' }, [
                E('div', { 'class': 'cbi-section-descr' }, _('Support uploading and installation of files in the /tmp directory')),

                E('div', 
                    { 'class': 'cbi-section-node',
                        'style': 'flex-direction: row'
                    }, 
                 [
                    E('label', {
                     'class': 'cbi-value',
                     'style': 'display:inline-block; width: 130px',
                     }, '请选择文件：'),
                   
                   E('input', {
                            'type': 'file',
                            'class': 'cbi-input-file',
                            'style': 'width: 400px',
                            'change': function (ev) {
                                var file = ev.target.files[0];
                                if (file) {
                                    console.log('选中的文件:', file.name);
                                }
                            }
                    }),

                   E('input', {
                            'type': 'submit',
                            'class': 'cbi-button cbi-input-apply',
                            'click': function (ev) {
                                    console.log('选中的文件:', JSON.stringify(ev));
                            }
                    }),


                    // E('button', {
                    //     'class': 'btn cbi-button-confirm',
                    //     'click': function(ev) {
                    //         return ui.uploadFile(`${upload_path}/${tmp_file}`, ev.target).then(function(res) {
                    //             return L.resolveDefault(callRename(`${upload_path}/${tmp_file}`, `${upload_path}/${res.name}`), {}).then(function(ret) {
                    //                 if (ret.code === 0)
                    //                     return _this.refresh();
                    //                 else {
                    //                     ui.addNotification(null, E('p', _('Failed to upload file: %s.').format(res.name)));
                    //                     return L.resolveDefault(fs.remove(file), {});
                    //                 }
                    //             });
                    //         }).catch(function(e) {
                    //             if (e.message !== 'Canceled'){
                    //                ui.addNotification(null, E('p', e.message)); 
                    //             }
                    //         });
                    //     }
                    // }, _('Upload'))
                ])
            ]);


            var table = E('table', { 'class': 'table cbi-section-table' }, [
                E('tr', { 'class': 'tr cbi-section-table-titles' }, [
                    E('th', { 'class': 'th' }, _('FileName')),
                    E('th', { 'class': 'th' }, _('FileSize')),
                    E('th', { 'class': 'th' }, _('ModifyTime')),
                    E('th', { 'class': 'th' }, _('FileAttrs')),
                    E('th', { 'class': 'th' }, _('Operate'))
                ])
            ]);

            (files || []).forEach(function(file) {
                console.log(JSON.stringify(file))
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
                    E('td', { 'class': 'td' }, fs.stptomode(file.mode) || '----------'), 
                    E('td', { 'class': 'td' }, [
                        file.name.endsWith('.ipk') ? E('button', {
                            'class': 'btn cbi-button-action',
                            'click': function() {
                                ui.showModal(_('Installing...'), [ E('p', { 'class': 'spinning' }, _('Please wait a moment...')) ]);
                                L.resolveDefault(callInstall(`${upload_path}/${file.name}`), {}).then(function(res) {
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
                                return fs.remove(file).then(function() {
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