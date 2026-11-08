// Decide a dónde mandar a quien cayó en la página 404 de GitHub Pages.
// Las rutas de Pages distinguen mayúsculas ("Tv.html" no existe) y los
// teclados de los Smart TV suelen capitalizar sin avisar. Esto lo corrige.

/**
 * @param {string} pathname  ej. "/Pasapalabra/Tv.html"
 * @param {string} [search]  ej. "?sala=ABCD" (se conserva)
 * @param {string} [hash]
 * @returns {string|null} ruta corregida, o null si no se entiende
 */
export function destino(pathname, search = '', hash = '') {
  const limpia = pathname.replace(/\/+$/, '');
  const i = limpia.lastIndexOf('/');
  const dir = limpia.slice(0, i + 1) || '/'; // incluye la "/" final
  const ultimo = limpia.slice(i + 1).toLowerCase();

  let ruta = null;
  if (/^tv(\.html?)?$/.test(ultimo)) ruta = `${dir}tv.html`;
  else if (/^(index(\.html?)?)?$/.test(ultimo)) ruta = dir;

  // Si ya estamos en esa ruta, no redirigimos (evita bucles).
  if (ruta === null || ruta === pathname) return null;
  return `${ruta}${search}${hash}`;
}
