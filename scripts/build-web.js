// Kopiert die Web-App nach www/ – von dort übernimmt Capacitor sie in die Android-App.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const files = ['index.html', 'styles.css', 'app.js', 'scheduler.js', 'templates.js', 'shared.js', 'native.js', 'manifest.webmanifest', 'sw.js'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'icons'))) {
  fs.copyFileSync(path.join(root, 'icons', f), path.join(out, 'icons', f));
}
console.log(`Web-App nach ${path.relative(root, out)}/ kopiert.`);
