// ── Inspect/invoke UI via Chrome DevTools Protocol ────────────────────────

const action = process.argv[2] || 'state';

(async () => {
    try {
        const res = await fetch('http://127.0.0.1:9222/json');
        if (!res.ok) throw new Error(`HTTP ${res.status} from DevTools`);

        const pages = await res.json();
        const page = pages.find(candidate => candidate.type === 'page');
        if (!page) throw new Error('No DevTools page target found');

        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
            socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
            socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket connection failed')); }, { once: true });
        });

        const evaluate = (id, expression) => new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Evaluate timeout')), 10000);
            const listener = (event) => {
                const message = JSON.parse(event.data);
                if (message.id !== id) return;
                clearTimeout(timeout);
                socket.removeEventListener('message', listener);
                resolve(message.result?.result?.value);
            };
            socket.addEventListener('message', listener);
            socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
                expression, returnByValue: true, awaitPromise: true
            } }));
        });

        const expressions = {
            start: "document.querySelector('#start-service').click(); 'clicked'",
            logs: "document.querySelector('#setup-show-logs').click(); 'logs-opened'",
            state: `JSON.stringify({
                version: [...document.querySelectorAll('[data-role="client-version"]')].map(e => e.textContent),
                endpoint: [...document.querySelectorAll('[data-role="endpoint"]')].map(e => e.textContent),
                progress: document.querySelector('#progress-percent')?.textContent,
                progressHidden: document.querySelector('#startup-progress')?.hidden,
                logDrawerHidden: document.querySelector('#log-drawer')?.hidden,
                logCount: document.querySelector('#log-count')?.textContent,
                service: document.querySelector('#service-message')?.textContent,
                setupHidden: document.querySelector('#setup-view')?.hidden,
                workspaceHidden: document.querySelector('#workspace-view')?.hidden
            })`
        };

        const result = await evaluate(1, expressions[action] || expressions.state);
        console.log(result);
        socket.close();
    } catch (error) {
        console.error('inspect_cdp failed:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
})();