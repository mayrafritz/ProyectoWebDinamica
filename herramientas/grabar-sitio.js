// Graba un sitio (pensado para Next.js) recorriéndolo con un navegador de verdad:
// guarda cada respuesta GET y arma un manifiesto URL -> archivo para servirlo igual en local.
// Uso: node grabar-sitio.js https://sweet-tape.com <carpeta sitio>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');

const [BASE, SALIDA] = process.argv.slice(2);
const ORIGEN = new URL(BASE).origin;
const BLOQUEADOS = /googletagmanager|google-analytics|doubleclick|p\.typekit\.net|_vercel\/insights|vitals\.vercel|facebook\.net|hotjar|clarity\.ms/;
const PROHIBIDO = /^\/(admin|lab)(\/|$)/; // robots.txt: no entrar
const manifiesto = {}; // clave -> { archivo, tipo, estado }
const pendientesCompletos = new Set(); // respuestas 206 (audio/video): bajarlas enteras después
let guardados = 0;

const corto = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

function variante(headers) {
  if (headers['next-router-segment-prefetch']) return 'seg:' + headers['next-router-segment-prefetch'];
  if (headers['next-router-prefetch']) return 'prefetch';
  return 'full';
}

// Clave del manifiesto: ruta + query (sin _rsc, que cambia) y, si es un pedido RSC, su variante.
function clave(url, headers) {
  const u = new URL(url);
  const externo = u.origin !== ORIGEN;
  u.searchParams.delete('_rsc');
  const base = (externo ? '/__ext_/' + u.host : '') + u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
  return headers.rsc === '1' ? base + ' |rsc| ' + variante(headers) : base;
}

function archivoPara(k, tipo) {
  const [ruta] = k.split(' |rsc| ');
  const [p, q] = ruta.split('?');
  let rel = decodeURIComponent(p).replace(/^\/+/, '');
  if (k.includes(' |rsc| ')) return path.join('_rsc', (rel || 'inicio') + '__' + corto(k) + '.txt');
  if (tipo.includes('text/html')) return path.join(rel, 'index.html');
  if (!rel || rel.endsWith('/')) rel += 'index';
  if (q) {
    const ext = path.extname(rel);
    rel = rel.slice(0, rel.length - ext.length) + '__' + corto(q) + ext;
  }
  return rel;
}

async function guardar(resp) {
  const req = resp.request();
  if (req.method() !== 'GET') return;
  const url = resp.url();
  if (!/^https?:/.test(url) || BLOQUEADOS.test(url)) return;
  const estado = resp.status();
  if (estado === 206) return pendientesCompletos.add(url);
  if (estado < 200 || estado >= 300) return;
  const headers = req.headers();
  const k = clave(url, headers);
  if (manifiesto[k]) return;
  let cuerpo;
  try {
    cuerpo = await resp.buffer();
  } catch {
    return; // redirecciones o cuerpos que el navegador ya descartó
  }
  const tipo = resp.headers()['content-type'] || 'application/octet-stream';
  const archivo = archivoPara(k, tipo);
  const destino = path.join(SALIDA, archivo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, cuerpo);
  manifiesto[k] = { archivo: archivo.split(path.sep).join('/'), tipo, url };
  guardados++;
}

async function bajarEntero(url) {
  const u = new URL(url);
  const k = clave(url, {});
  if (manifiesto[k]) return;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130.0', Referer: BASE + '/' } });
    if (!r.ok) return console.log('  falló', r.status, url);
    const tipo = r.headers.get('content-type') || 'application/octet-stream';
    const archivo = archivoPara(k, tipo);
    const destino = path.join(SALIDA, archivo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
    manifiesto[k] = { archivo: archivo.split(path.sep).join('/'), tipo, url };
    guardados++;
  } catch (e) {
    console.log('  falló', url, e.message);
  }
}

async function recorrer(nav, ruta, ancho, alto) {
  const p = await nav.newPage();
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    const u = r.url();
    if (BLOQUEADOS.test(u) || (u.startsWith(ORIGEN) && PROHIBIDO.test(new URL(u).pathname))) return r.abort();
    r.continue();
  });
  p.on('response', (r) => guardar(r).catch(() => {}));
  await p.setViewport({ width: ancho, height: alto });
  try {
    await p.goto(BASE + ruta, { waitUntil: 'networkidle2', timeout: 120000 });
    await new Promise((r) => setTimeout(r, 4000));
    await p.mouse.move(ancho / 2, alto / 2);
    for (let i = 0; i < 400; i++) {
      const fin = await p.evaluate(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 5);
      if (fin) break;
      await p.mouse.wheel({ deltaY: 350 });
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 3000));
    // Pasar el mouse por links y botones (sonidos, imágenes que se cargan al hover)
    const objetivos = await p.$$('a, button');
    for (const el of objetivos.slice(0, 60)) {
      try {
        await el.hover();
        await new Promise((r) => setTimeout(r, 60));
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 2000));
  } catch (e) {
    console.log('  problema en', ruta, e.message);
  }
  return p;
}

(async () => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const sitemap = await (await fetch(BASE + '/sitemap.xml')).text();
  const rutas = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const nav = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
    for (const ruta of rutas) {
      console.log('recorriendo', ancho, ruta);
      const p = await recorrer(nav, ruta, ancho, alto);
      // Datos de navegación (RSC) completos de cada ruta, como cuando se hace clic en un link
      if (ruta === '/') {
        await p.evaluate(async (rutas) => {
          for (const r of rutas) await fetch(r, { headers: { RSC: '1' } }).then((x) => x.text()).catch(() => {});
        }, rutas);
        await new Promise((r) => setTimeout(r, 2000));
      }
      await p.close();
    }
  }
  await nav.close();
  console.log('audio/video para bajar enteros:', pendientesCompletos.size);
  for (const u of pendientesCompletos) await bajarEntero(u);
  fs.writeFileSync(path.join(SALIDA, '_manifiesto.json'), JSON.stringify(manifiesto, null, 1));
  console.log('rutas:', rutas.length, 'archivos guardados:', guardados);
  const hosts = {};
  for (const k of Object.keys(manifiesto)) {
    const h = k.startsWith('/__ext_/') ? k.split('/')[2] : 'propio';
    hosts[h] = (hosts[h] || 0) + 1;
  }
  console.log(hosts);
})();
