// noinspection JSAnnotator

'use strict';

'require ui';
'require fs';
'require rpc';
'require request';
'require view';

const callInstall = rpc.declare({
    object: 'luci.filemanager',
    method: 'install',
    params: ['filename'],
});

const callRename = rpc.declare({
    object: 'luci.filemanager',
    method: 'rename',
    params: ["oldName", 'newName'],
    expect: { '': {} }
});

const callMkdir = rpc.declare({
    object: 'luci.filemanager',
    method: 'mkdirUpload',
    params: ["uploadPath"],

});

const formatMode = function(mode) {
        const res = [];
        const types = {
            0o140000: 's', // socket
            0o120000: 'l', // symbolic link
            0o100000: '-', // regular file
            0o060000: 'b', // block device
            0o040000: 'd', // directory
            0o020000: 'c', // character device
            0o010000: 'p'  // FIFO
        };

        const type = types[mode & 0o170000] || '?';
        res.push(type);

        const chars = ['r', 'w', 'x'];
        for (let i = 6; i >= 0; i -= 3) {
            let bits = (mode >> i) & 7;
            res.push(bits & 4 ? 'r' : '-');
            res.push(bits & 2 ? 'w' : '-');
            res.push(bits & 1 ? 'x' : '-');
        }

        return res.join('');
    }

const timeFormater = function(mtime) {
        const date = new Date(mtime * 1000);
        const timeStr = String.format('%04d-%02d-%02d %02d:%02d:%02d',
            date.getFullYear(), date.getMonth() + 1, date.getDate(),
            date.getHours(), date.getMinutes(), date.getSeconds()
        );
        return timeStr;
    }

const upload_path="/tmp/upload"
const tmp_file="upload_tmp.tmp"

return L.view.extend({
    load() {
        return Promise.all([
            L.resolveDefault(callMkdir(upload_path), {}),
        ]);
    },

    render(data) {
        const _this = this;

        _this.handleSaveApply = null;
        _this.handleSave = null;
        _this.handleReset = null;

        const body = E('div', { 'class': 'cbi-map' }, []);

        const updateTitle = E("h2", _('Upload'));

        let fileInput = null; 

        const uploadSection = E('div', { 'class': 'cbi-section' }, [
            E('div', { 'class': 'cbi-section-descr' }, _('Support uploading and installation of files in the /tmp directory')),

            E('div', 
                { 'class': 'cbi-section-node',
                  'style': 'flex-direction: row'
                }, 
             [
                E('label', {
                 'class': 'cbi-value',
                 'style': 'display:inline-block; width: 8rem; padding-bottom: 1rem',
                 }, _('Select a file:')),
               
                E('input', {
                        'type': 'file',
                        'class': 'cbi-input-file',
                        'style': 'width: 25rem',
                        'change': function(ev) {
                            fileInput = ev.target.files[0] 
                        }
                }),

               E('button', {
                    class: 'cbi-button cbi-input-apply',
                    click: function() {
                        if (!fileInput) {
                            return;
                        }

                        const data = new FormData();
                        const targetPath = `${upload_path}/${tmp_file}`;  
                        data.append('sessionid', rpc.getSessionID());
                        data.append('filename', targetPath);
                        data.append('filedata', fileInput);

                        request.post(`${L.env.cgi_base}/cgi-upload`, data, {
                            timeout: 0
                        }).then(function(res) {
                            return L.resolveDefault(callRename(
                                `${upload_path}/${tmp_file}`, `${upload_path}/${fileInput.name}`)
    , {}).then(function(ret) {
                                if (ret.code === 0) {
                                    ui.addNotification(null, E('p', _('Upload Success')));
                                    fetchTableFiles();
                                } else {
                                    ui.addNotification(null, E('p', _('Failed to upload file')));
                                }
                            });
                        }).catch(function(err) {
                            ui.addNotification(null, E('p', err.message));
                        });
                    }
                }, _('Upload'))
            ]),
        ]);

        const downloadTitle = E('h2', _('Download'));

        const downloadSection = E('div', {'class': 'cbi-section'}, [
            E('div', { 'class': 'cbi-section-descr' }, _('Download File')),

            E('div',{
                  'class': 'cbi-section-node',
                  'style': 'flex-direction: row'
            },[

                E('label', {
                 'class': 'cbi-value',
                 'style': 'display:inline-block; width: 8rem; padding-bottom: 1rem',
                 }, _('Root directory:')),


                E('input',{
                    'type': 'text',
                    'class': 'cbi-input-file',
                    'style': 'width: 25rem',
                    'change': function(ev) {
                        fileInput = ev.target.value;
                    }
                }),

                E('input', {
                        'type': 'submit',
                        'class': 'cbi-button cbi-input-apply',
                        'value': _('Download'),
                        'click': function (ev) {
                            if (!fileInput){
                                return;
                            }

                            fs.read_direct(fileInput, 'blob').then(function(res) {
                                let blob;
                                if (res instanceof Blob) {
                                    blob = res;
                                } else if (res && res.data) {
                                    blob = new Blob([res.data], { type: "application/octet-stream" });
                                } else {
                                    blob = new Blob([res], { type: "application/octet-stream" });
                                }

                                const url = URL.createObjectURL(blob);
                                const fileName = fileInput.split('/').pop();
                                
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = fileName;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);

                                setTimeout(function() {
                                    URL.revokeObjectURL(url);
                                }, 200);

                            }).catch(function(err) {
                                ui.addNotification(null, E('p', _('Failed to download, please check if the file exists')));
                            });
                        }
                })
            ]),
        ]);

        let tableBody;
        const table = E('table', { 'class': 'table cbi-section-table' }, [
            E('tr', { 'class': 'tr cbi-section-table-titles' }, [
                E('th', { 'class': 'th' }, _('FileName')),
                E('th', { 'class': 'th' }, _('FileSize')),
                E('th', { 'class': 'th' }, _('ModifyTime')),
                E('th', { 'class': 'th' }, _('FileAttrs')),
                E('th', { 'class': 'th' }, _('Remove')),
                E('th', { 'class': 'th' }, _('Install'))
            ]),
            tableBody = E('tbody')
        ]);

        const tableSection = E('div', {'class': 'cbi-section'}, [
            E('h3', _('FileList')),
            table
        ]);

        const fetchTableFiles = () => fs.list(upload_path).then(function(files){
            tableBody.innerHTML = ''; 

            files.forEach(function(file){
                if (file.type !== 'file') {
                    return;
                } 

                tableBody.appendChild(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, file.name),
                    E('td', { 'class': 'td' }, (file.size / 1024).toFixed(2) + ' KB'),
                    E('td', { 'class': 'td' }, timeFormater(file.mtime)),
                    E('td', { 'class': 'td' }, formatMode(file.mode)), 
                    E('td', { 'class': 'td' }, [
                        E('button', {
                            'class': 'btn cbi-button-remove',
                            'style': 'margin-left: 0.3rem',
                            'click': function() {
                                return fs.remove(`${upload_path}/${file.name}`).then(() => fetchTableFiles());
                            }
                        }, _('Remove'))
                    ]), 

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
                       
                    ])
                ]));
            });
        });

        fetchTableFiles();

        body.appendChild(updateTitle);
        body.appendChild(uploadSection);
        body.appendChild(downloadTitle);
        body.appendChild(downloadSection);
        body.appendChild(tableSection);

        return body;
    }
});