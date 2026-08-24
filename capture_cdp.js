// ── Capture screenshot via Chrome DevTools Protocol ────────────────────────

const { writeFileSync } = require('node:fs');

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

        socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));

        const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Screenshot response timeout')), 10000);
            socket.addEventListener('message', (event) => {
                const message = JSON.parse(event.data);
                if (message.id === 1) {
                    clearTimeout(timeout);
                    resolve(message.result);
                }
            });
            socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket error during capture')); }, { once: true });
        });

        if (!result?.data) throw new Error('No screenshot data in response');
        writeFileSync(process.argv[2], Buffer.from(result.data, 'base64'));
        socket.close();
        console.log(`Screenshot saved to ${process.argv[2]}`);
    } catch (error) {
        console.error('capture_cdp failed:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
})();