// SPDX-License-Identifier: Apache-2.0
// noinspection JSAnnotator

/*
 * Copyright (C) 2022-2026 sirpdboy <herboy2008@gmail.com>
 */
'use strict';
'require dom';
'require fs';
'require poll';
'require uci';
'require view';
'require form';

return view.extend({
	render: function () {
		const css = `
			.log-container {
                max-height: 30rem;
                overflow-y: auto;
                padding: 1rem;
                font-size: 0.875rem;
                border: 0.0625rem solid #dee2e6;
                border-radius: 0.25rem;
                margin: 1rem;
            }
            
            .log-line {
                padding: 0.1875rem 0.3125rem; 
                font-size: 0.75rem;           
                line-height: 1.4;
                white-space: pre-wrap;
                word-break: break-all;
            }
            
            .log-line:last-child {
                border-bottom: none;
            }
            
            .control-buttons {
                margin-bottom: 0.625rem;
                display: flex;
                gap: 0.3125rem;        
            }

		`;

		const log_container = E('div', {
			'class': 'log-container', 
			'id': 'log_container',
			'style': 'min-height: 30rem;'
		}, E('div', { 'class': 'log-line' }, _('Loading logs...')));


		let lastLogContent = '';
        let lastScrollTop = 0;
        let isScrolledToTop = true;

		function extractDDNSGoMessage(line) {
			if (!line || !line.includes('ddns-go')) return null;

            const regex = /^(.*?ddns-go.*?):\s*(.*)$/;
            const match = line.match(regex);
			
			if (match) {
                const timestampMatch = line.match(/^([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})/);
				if (timestampMatch) {
					return {
						timestamp: timestampMatch[1],
						message: match[2]
					};
				}
			}

            const selfTimestampMatch = line.match(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/);
			if (selfTimestampMatch) {
				return {
					timestamp: selfTimestampMatch[1],
					message: selfTimestampMatch[2]
				};
			}
			
			return {
				timestamp: null,
				message: line
			};
		}

		function formatLogLine(line) {
			if (!line || line.trim() === '') return null;

            const extracted = extractDDNSGoMessage(line);
			if (!extracted) return null;

            const lineClass = ['log-line'];
			
			if (line.includes('err') || line.includes('ERROR') || line.includes('failed')) {
				lineClass.push('log-error');
			} else if (line.includes('warn') || line.includes('WARNING')) {
				lineClass.push('log-warning');
			}
			
			if (extracted.timestamp) {
				return E('div', { 'class': lineClass.join(' ') }, [
					E('span', { 'class': 'log-timestamp' }, extracted.timestamp + ' '),
					E('span', { 'class': 'log-message' }, extracted.message)
				]);
			} else {
				return E('div', { 'class': lineClass.join(' ') }, extracted.message);
			}
		}
		function formatLogContent(logContent) {
			if (!logContent || logContent.trim() === '') {
				return E('div', { 'class': 'log-line' }, _('No ddns-go logs found.'));
			}
			
			const lines = logContent.split('\n');
            const formattedLines = [];
			
			for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
				if (line === '' || line.includes('No ddns-go logs found')) continue;

                const formattedLine = formatLogLine(line);
				if (formattedLine) {
					formattedLines.push(formattedLine);
				}
			}
			
			if (formattedLines.length === 0) {
				return E('div', { 'class': 'log-line' }, _('No ddns-go logs found.'));
			}
			
			formattedLines.reverse();
			
			return E('div', {}, formattedLines);
		}

		function clearLogs(button) {
			button.disabled = true;
			button.textContent = _('Clearing...');
			
			return fs.exec('/usr/libexec/ddns-go-call', ['clear_logs'])
				.then(function(res) {
					button.textContent = _('Logs cleared!');
					lastLogContent = '';
					return fetchLogs();
				})
				.catch(function(err) {
					console.error('Clear logs error:', err);
					button.textContent = _('Failed to clear');
				})
				.finally(function() {
					setTimeout(function() {
						button.disabled = false;
						button.textContent = _('Clear Logs');
					}, 2000);
				});
		}
		function fetchLogs() {
			
			return fs.exec('/usr/libexec/ddns-go-call', ['get_logs'])
				.then(function(res) {
					let logContent = '';
					if (res === null || res === undefined) {
						logContent = '';
					} else if (typeof res === 'string') {
						logContent = res;
					} else if (res.stdout !== undefined) {
						logContent = res.stdout;
					} else if (res.data !== undefined) {
						logContent = res.data;
					} else if (typeof res === 'object') {
						logContent = JSON.stringify(res);
					}
					
					logContent = logContent.trim();
                    const lineCount = logContent.split('\n').filter(l =>
						l.trim() !== '' && !l.includes('No ddns-go logs found')
					).length;
					
					if (logContent !== lastLogContent) {
						
						const formattedLog = formatLogContent(logContent);

                        const prevScrollHeight = log_container.scrollHeight;
                        const prevScrollTop = log_container.scrollTop;
						
						dom.content(log_container, formattedLog);
						lastLogContent = logContent;
						
						if (!isScrolledToTop) {
                            const newScrollHeight = log_container.scrollHeight;
                            const heightDiff = newScrollHeight - prevScrollHeight;
							log_container.scrollTop = prevScrollTop + heightDiff;
						}
					}
					
					return Promise.resolve();
				})
				.catch(function(err) {
					console.error('Log fetch error:', err);
					const errorMsg = _('Failed to read logs: %s').format(err.message || 'Resource not found');
					dom.content(log_container, E('div', { 'class': 'log-line log-error' }, errorMsg));
					return Promise.reject(err);
				});
		}

		const clear_button = E('button', {
			'class': 'cbi-button cbi-button-remove',
            'style': 'margin-left: 1rem;',
			'click': function(ev) {
				ev.preventDefault();
				clearLogs(ev.target);
			}
		}, _('Clear Logs'));


		log_container.addEventListener('scroll', function() {
			lastScrollTop = this.scrollTop;
			isScrolledToTop = this.scrollTop <= 1;
		});

		setTimeout(fetchLogs, 200);

		poll.add(L.bind(function() {
			return fetchLogs().catch(function(err) {
				console.error('Poll error:', err);
			});
		}));

		poll.start();

		return E('div', { 'class': 'cbi-map' }, [
			E('style', [css]),
			E('div', { 'class': 'cbi-section' }, [
				log_container,
				E('div', { 'class': 'control-buttons' }, [ clear_button])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});