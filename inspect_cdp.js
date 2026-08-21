const action = process.argv[2] || 'state';

(async () => {
    const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
    const page = pages.find(candidate => candidate.type === 'page');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    const evaluate = (id, expression) => new Promise((resolve) => {
        const listener = (event) => {
            const message = JSON.parse(event.data);
            if (message.id !== id) return;
            socket.removeEventListener('message', listener);
            resolve(message.result.result.value);
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
    console.log(await evaluate(1, expressions[action] || expressions.state));
    socket.close();
})();
