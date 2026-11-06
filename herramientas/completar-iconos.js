// Baja los archivos del <head> (íconos, manifest, imagen para compartir) que el navegador pide solo a veces.
// Uso: node completar-iconos.js https://sweet-tape.com <carpeta sitio>
const fs = require('node:fs');
const path = require('node:path');
const [BASE, SITIO] = process.argv.slice(2);
const manifiesto = JSON.parse(fs.readFileSync(path.join(SITIO, '_manifiesto.json'), 'utf8'));
const extraRuta = path.join(SITIO, '_manifiesto-extra.json');
const extra = JSON.parse(fs.readFileSync(extraRuta, 'utf8'));
const html = fs.readFileSync(path.join(SITIO, 'index.html'), 'utf8');
const rutas = new Set(['/favicon.ico', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml']);
for (const m of html.matchAll(/<(?:link|meta)[^>]+(?:href|content)="([^"]+)"/g)) {
  const u = m[1].replace(/&amp;/g, '&');
  if (u.startsWith('/') && !u.startsWith('/_next/')) rutas.add(u);
  else if (u.startsWith(BASE + '/')) rutas.add(u.slice(BASE.length));
}
(async () => {
  for (const r of rutas) {
    if (manifiesto[r] || extra[r]) continue;
    const resp = await fetch(BASE + r, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130.0' } });
    if (!resp.ok) { console.log(resp.status, r); continue; }
    const tipo = resp.headers.get('content-type') || 'application/octet-stream';
    let archivo = r.replace(/^\/+/, '');
    if (archivo.includes('?')) archivo = archivo.split('?')[0].replace(/(\.\w+)$/, '__q$1');
    fs.mkdirSync(path.dirname(path.join(SITIO, archivo)), { recursive: true });
    fs.writeFileSync(path.join(SITIO, archivo), Buffer.from(await resp.arrayBuffer()));
    extra[r] = { archivo, tipo, url: BASE + r };
    console.log('bajado', r, tipo);
  }
  fs.writeFileSync(extraRuta, JSON.stringify(extra, null, 1));
})();
