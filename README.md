# ProyectoWebDinamica

Reproducción local de SweetTape, servida desde los archivos guardados en `sitio/`.

## Desarrollo local

Requiere Node.js 22.12 o más reciente. Desde esta carpeta:

```sh
npm start
```

Después abrí <http://127.0.0.1:8092>.

## Preparar el proyecto en Vercel

Importá este repositorio desde GitHub en Vercel y elegí esta carpeta como raíz del proyecto. No hay dependencias que instalar ni un paso de compilación: Vercel ejecuta `api/site.mjs` como función Node y empaqueta los archivos de `sitio/` junto con ella.

La configuración reescribe las rutas del sitio a esa función para conservar el enrutamiento, las respuestas RSC de Next.js y el formulario simulado. El formulario solo responde OK y muestra el contenido en los logs; no guarda mensajes.

## Uso de la copia

El proyecto de origen indica que textos, imágenes, modelos, sonidos, logo y código pertenecen a SB Tape Group, y que las tipografías de Adobe Fonts tienen licencia para su dominio. La copia fue creada para estudio y el README original pide no publicarla. Verificá que tengas autorización para hacerla pública antes de desplegarla en un dominio accesible por Internet.
