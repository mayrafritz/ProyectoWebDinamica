// Busca en el código grabado (HTML, JS, CSS, RSC) rutas a archivos que el recorrido no llegó a cargar
// (sonidos, modelos, imágenes que aparecen al interactuar) y las baja. Escribe sitio/_manifiesto-extra.json.
// Uso: node completar-sitio.js https://sweet-tape.com <carpeta sitio>
const fs = require('node:fs');
const path = require('node:path');

const [BASE, SITIO] = process.argv.slice(2);
const manifiesto = JSON.parse(fs.readFileSync(path.join(SITIO, '_manifiesto.json'), 'utf8'));
const extraRuta = path.join(SITIO, '_manifiesto-extra.json');
const extra = fs.existsSync(extraRuta) ? JSON.parse(fs.readFileSync(extraRuta, 'utf8')) : {};
const RUTA_RE = /["'`(\s,](\/(?:assets|api\/media\/file|fonts|models|sounds|audio|videos?|images?|textures|draco|basis)\/[^"'`)\s\\]+?\.(?:webp|png|jpe?g|svg|gif|avif|glb|gltf|bin|ktx2|mp3|wav|ogg|m4a|mp4|webm|woff2?|ttf|otf|json|hdr|exr|wasm|js))(?:\?[^"'`)\s\\]*)?(?=["'`)\s\\,])/g;

const encontradas = new Set();
for (const v of Object.values({ ...manifiesto, ...extra })) {
  if (!/text|javascript|json|x-component|css|svg/.test(v.tipo)) continue;
  const texto = fs.readFileSync(path.join(SITIO, v.archivo), 'utf8');
  for (const m of texto.matchAll(RUTA_RE)) encontradas.add(m[1]);
}
const faltan = [...encontradas].filter((r) => !manifiesto[r] && !extra[r] && !Object.keys(manifiesto).some((k) => k.split('?')[0] === r));
console.log('rutas en el código:', encontradas.size, '· faltan:', faltan.length);

(async () => {
  let ok = 0;
  for (const r of faltan) {
    // "./assets/x" relativo también aparece; se pide tal cual desde la raíz
    try {
      const resp = await fetch(BASE + encodeURI(r), { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130.0', Referer: BASE + '/' } });
      if (!resp.ok) {
        console.log('  ', resp.status, r);
        continue;
      }
      const tipo = resp.headers.get('content-type') || 'application/octet-stream';
      const archivo = decodeURIComponent(r).replace(/^\/+/, '');
      const destino = path.join(SITIO, archivo);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, Buffer.from(await resp.arrayBuffer()));
      extra[r] = { archivo, tipo, url: BASE + r };
      ok++;
    } catch (e) {
      console.log('   error', r, e.message);
    }
  }
  fs.writeFileSync(extraRuta, JSON.stringify(extra, null, 1));
  console.log('bajadas:', ok);
})();
