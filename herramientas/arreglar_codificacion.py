"""Arregla textos guardados con doble codificación por grabar-sitio.js.

Las respuestas de texto sin "charset" (p. ej. text/x-component de Next.js) el navegador las leyó como
Windows-1252 y se guardaron re-codificadas en UTF-8 ("Â " en vez de un espacio duro).
Se deshace: UTF-8 -> caracteres -> bytes de Windows-1252 (los 5 bytes que Windows-1252 no define quedan
como U+0081… y vuelven a su byte igual). Solo toca archivos que tengan esa marca y queden UTF-8 válido.
Uso: python -I arreglar_codificacion.py <carpeta sitio>
"""
import json
import os
import sys

SITIO = sys.argv[1]
manifiesto = json.load(open(os.path.join(SITIO, "_manifiesto.json"), encoding="utf-8"))


def a_bytes_1252(texto):
    salida = bytearray()
    for c in texto:
        try:
            salida += c.encode("cp1252")
        except UnicodeEncodeError:
            if ord(c) < 0x100:
                salida.append(ord(c))
            else:
                raise
    return bytes(salida)


arreglados = []
for clave, v in manifiesto.items():
    if not any(t in v["tipo"] for t in ("text", "javascript", "json", "x-component", "svg")):
        continue
    if "charset" in v["tipo"].lower():
        continue  # con charset el navegador lo leyó bien
    ruta = os.path.join(SITIO, v["archivo"])
    texto = open(ruta, encoding="utf-8").read()
    if not any(marca in texto for marca in ("Â", "Ã", "â€")):
        continue
    try:
        original = a_bytes_1252(texto)
        original.decode("utf-8")  # tiene que quedar UTF-8 válido
    except (UnicodeEncodeError, UnicodeDecodeError) as e:
        print("no se pudo:", v["archivo"], e)
        continue
    open(ruta, "wb").write(original)
    arreglados.append(v["archivo"])

print("arreglados:", len(arreglados))
for a in arreglados:
    print("  ", a)
