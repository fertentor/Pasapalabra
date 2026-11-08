// Servidor estático mínimo que imita a GitHub Pages para un sitio de proyecto:
//  - el sitio vive bajo /<prefijo>/ (por defecto /Pasapalabra/)
//  - las rutas distinguen mayúsculas
//  - lo que no existe devuelve 404.html con status 404
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function iniciarServidorPages({ prefijo = '/Pasapalabra', puerto = 0 } = {}) {
  const raiz = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');

  const enviar = async (res, archivo, status) => {
    const cuerpo = await readFile(archivo);
    res.writeHead(status, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    res.end(cuerpo);
  };

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === prefijo) {
      res.writeHead(301, { Location: `${prefijo}/` });
      return res.end();
    }
    try {
      if (!pathname.startsWith(`${prefijo}/`)) throw new Error('fuera del sitio');
      let rel = decodeURIComponent(pathname.slice(prefijo.length + 1));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const archivo = join(raiz, rel);
      if (!archivo.startsWith(raiz + sep) && archivo !== raiz) throw new Error('ruta inválida');
      await enviar(res, archivo, 200);
    } catch {
      try {
        await enviar(res, join(raiz, '404.html'), 404);
      } catch {
        res.writeHead(404).end('404');
      }
    }
  });

  return new Promise((resolve) =>
    server.listen(puerto, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}${prefijo}`,
        cerrar: () => new Promise((ok) => server.close(ok)),
      }),
    ),
  );
}

// Uso directo: `node tests/pages-server.mjs 8123`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await iniciarServidorPages({ puerto: Number(process.argv[2] ?? 8123) });
  console.log(`Imitando GitHub Pages en ${url}/`);
}
