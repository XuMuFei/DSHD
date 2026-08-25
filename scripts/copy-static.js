// ── Copy static files to dist ─────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const staticFiles = [
    'shell.html',
    'shell.css'
];

const staticDirs = [
    'build'
];

const distDir = path.join(__dirname, '..', 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Copy static files
for (const file of staticFiles) {
    const src = path.join(__dirname, '..', file);
    const dest = path.join(distDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied: ${file}`);
    } else {
        console.warn(`Missing: ${file}`);
    }
}

// Copy static directories
for (const dir of staticDirs) {
    const src = path.join(__dirname, '..', dir);
    const dest = path.join(distDir, dir);
    if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true });
        console.log(`Copied: ${dir}/`);
    } else {
        console.warn(`Missing: ${dir}/`);
    }
}

console.log('Static files copy complete.');
