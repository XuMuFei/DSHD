const { writeFileSync } = require('node:fs');

(async () => {
    const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
    const page = pages.find(candidate => candidate.type === 'page');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    const result = await new Promise((resolve) => {
        socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.id === 1) resolve(message.result);
        });
    });
    writeFileSync(process.argv[2], Buffer.from(result.data, 'base64'));
    socket.close();
})();
