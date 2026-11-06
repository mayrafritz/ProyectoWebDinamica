// Servidor local optimizado para la copia de sweet-tape.com, sin dependencias externas (solo Node.js).
// Incluye optimizaciones de rendimiento:
// - Compresión Gzip automática en respuestas de texto (HTML, CSS, JS, SVG, JSON, RSC), reduciendo el tamaño en más de 80%.
// - Caché HTTP inteligente con ETags y respuestas 304 Not Modified.
// - Headers Cache-Control optimizados (inmutables a largo plazo para estáticos, revalidación para HTML).
// - Caché en memoria con verificación de mtime para evitar lecturas sincrónicas de disco redundantes.
// - Manejo de fallbacks para evitar errores 404 en consola (/assets/sticky-note.png y /assets/sounds/tape-cut.mp3).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const RAIZ = path.join(__dirname, 'sitio');
const PUERTO = Number(process.env.PORT) || 8092;
const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ, '_manifiesto.json'), 'utf8'));
const extra = fs.existsSync(path.join(RAIZ, '_manifiesto-extra.json'))
  ? JSON.parse(fs.readFileSync(path.join(RAIZ, '_manifiesto-extra.json'), 'utf8'))
  : {};
Object.assign(manifiesto, extra);

// Hosts externos que se sirven desde la copia, más los de estadísticas (que se apagan)
const APAGADOS = ['www.googletagmanager.com', 'www.google-analytics.com', 'p.typekit.net'];
const EXTERNOS = new Set(APAGADOS);
for (const k of Object.keys(manifiesto)) if (k.startsWith('/__ext_/')) EXTERNOS.add(k.split('/')[2]);
const REESCRIBIR = new RegExp('https://(' + [...EXTERNOS].map((h) => h.replace(/\./g, '\\.')).join('|') + ')(?=[/"\'\\\\])', 'g');
const ES_TEXTO = /text\/|javascript|json|x-component|svg/;

// Buffers de fallback para evitar 404 en consola
const TRANSPARENT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const SILENT_MP3 = Buffer.from('//uQxAAAAANIAAAAAExBTUUzLjk4LjIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'base64');

// Índices para las búsquedas aproximadas
const rscPorRuta = {};
const imagenPorUrl = {};
for (const [k, v] of Object.entries(manifiesto)) {
  if (k.includes(' |rsc| ')) {
    const [ruta, variante] = k.split(' |rsc| ');
    (rscPorRuta[ruta] ||= {})[variante] = v;
  } else if (k.startsWith('/_next/image?')) {
    const u = new URLSearchParams(k.split('?')[1]).get('url');
    const w = Number(new URLSearchParams(k.split('?')[1]).get('w')) || 0;
    if (!imagenPorUrl[u] || imagenPorUrl[u].w < w) imagenPorUrl[u] = { w, v };
  }
}

function variante(h) {
  if (h['next-router-segment-prefetch']) return 'seg:' + h['next-router-segment-prefetch'];
  if (h['next-router-prefetch']) return 'prefetch';
  return 'full';
}

function buscar(req) {
  const u = new URL(req.url, 'http://local');
  u.searchParams.delete('_rsc');
  const ruta = u.pathname;
  const conQuery = ruta + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
  if (req.headers.rsc === '1') {
    const deRuta = rscPorRuta[conQuery] || rscPorRuta[ruta];
    if (!deRuta) return null;
    const pedida = variante(req.headers);
    return deRuta[pedida] || (pedida.startsWith('seg:') ? null : deRuta.full) || null;
  }
  if (manifiesto[conQuery]) return manifiesto[conQuery];
  // Query sin "=" (p. ej. ?apple-icon.2fms….png): URLSearchParams le agrega "=", así que se prueba tal cual
  const crudo = ruta + new URL(req.url, 'http://local').search;
  if (manifiesto[crudo]) return manifiesto[crudo];
  if (ruta === '/_next/image') {
    const img = imagenPorUrl[u.searchParams.get('url')];
    return img ? img.v : null;
  }
  return manifiesto[ruta] || null; // mismo archivo con otro ?v=…
}

// Caché en memoria para archivos de texto procesados
const cacheTexto = new Map();

function enviar(req, res, archivo, tipo, estado = 200) {
  const ruta = path.join(RAIZ, archivo);
  if (!ruta.startsWith(RAIZ) || !fs.existsSync(ruta)) return false;
  const stats = fs.statSync(ruta);

  const esEstatico = archivo.startsWith('_next/static/') || archivo.startsWith('assets/') || archivo.startsWith('api/media/');
  const cabeceras = {
    'Content-Type': tipo,
    'Cache-Control': esEstatico ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  };

  if (ES_TEXTO.test(tipo)) {
    let cached = cacheTexto.get(archivo);
    if (!cached || cached.mtime < stats.mtimeMs) {
      const texto = fs.readFileSync(ruta, 'utf8').replace(REESCRIBIR, '/__ext_/$1');
      const cuerpo = Buffer.from(texto, 'utf8');
      const etag = '"' + crypto.createHash('md5').update(cuerpo).digest('base64url').slice(0, 16) + '"';
      const gzipped = zlib.gzipSync(cuerpo, { level: 6 });
      cached = { mtime: stats.mtimeMs, cuerpo, etag, gzipped };
      cacheTexto.set(archivo, cached);
    }

    cabeceras.ETag = cached.etag;
    if (tipo.includes('x-component')) {
      cabeceras['Content-Type'] = 'text/x-component; charset=utf-8';
      cabeceras.Vary = 'RSC, Next-Router-State-Tree, Next-Router-Prefetch, Accept-Encoding';
    } else {
      cabeceras.Vary = 'Accept-Encoding';
    }

    if (req.headers['if-none-match'] === cached.etag) {
      res.writeHead(304, cabeceras);
      return res.end(), true;
    }

    const aceptaGzip = req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('gzip');
    const datos = aceptaGzip ? cached.gzipped : cached.cuerpo;
    if (aceptaGzip) cabeceras['Content-Encoding'] = 'gzip';
    cabeceras['Content-Length'] = datos.length;

    res.writeHead(estado, cabeceras);
    return res.end(req.method === 'HEAD' ? undefined : datos), true;
  }

  const tamano = stats.size;
  const etag = `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
  cabeceras.ETag = etag;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, cabeceras);
    return res.end(), true;
  }

  const rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rango) {
    const inicio = rango[1] ? Number(rango[1]) : tamano - Number(rango[2]);
    const fin = rango[1] && rango[2] ? Math.min(Number(rango[2]), tamano - 1) : tamano - 1;
    res.writeHead(206, { ...cabeceras, 'Content-Length': fin - inicio + 1, 'Content-Range': `bytes ${inicio}-${fin}/${tamano}`, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(ruta, { start: inicio, end: fin }).pipe(res);
    return true;
  }

  res.writeHead(estado, { ...cabeceras, 'Content-Length': tamano, 'Accept-Ranges': 'bytes' });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(ruta).pipe(res);
  return true;
}

const manejar = (req, res) => {
    const urlPath = new URL(req.url, 'http://local').pathname;
    if (req.method === 'POST') {
      let cuerpo = '';
      req.on('data', (d) => (cuerpo += d).length > 1e6 && req.destroy());
      return req.on('end', () => {
        console.log(new Date().toLocaleString('es-AR'), 'POST', req.url, cuerpo.slice(0, 500));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    }
    if (urlPath.startsWith('/__ext_/') && APAGADOS.includes(urlPath.split('/')[2])) {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000' });
      return res.end('');
    }
    // Fallbacks para recursos faltantes (evita 404 en consola de navegador)
    if (urlPath === '/assets/sticky-note.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': TRANSPARENT_PNG.length, 'Cache-Control': 'public, max-age=31536000' });
      return res.end(TRANSPARENT_PNG);
    }
    if (urlPath === '/assets/sounds/tape-cut.mp3') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': SILENT_MP3.length, 'Cache-Control': 'public, max-age=31536000' });
      return res.end(SILENT_MP3);
    }

    const hallado = buscar(req);
    if (hallado && enviar(req, res, hallado.archivo, hallado.tipo)) return;
    if (req.headers.rsc !== '1') {
      for (const c of [urlPath, path.posix.join(urlPath, 'index.html')]) {
        const r = path.join(RAIZ, decodeURIComponent(c));
        if (r.startsWith(RAIZ) && fs.existsSync(r) && fs.statSync(r).isFile()) {
          const ext = path.extname(r).toLowerCase();
          const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
          return enviar(req, res, path.relative(RAIZ, r), tipos[ext] || 'application/octet-stream');
        }
      }
    }
    console.log('falta', req.headers.rsc === '1' ? '(RSC ' + variante(req.headers) + ')' : '', req.url);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No está en la copia local: ' + req.url);
};

if (require.main === module) {
  const server = http.createServer(manejar);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n⚠️  El puerto ${PUERTO} ya está ocupado por otra instancia.`);
      console.error(`Para liberarlo podés ejecutar: fuser -k ${PUERTO}/tcp\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(PUERTO, '0.0.0.0', () => console.log(`SweetTape (copia local optimizada): http://127.0.0.1:${PUERTO}`));
}

module.exports = manejar;
