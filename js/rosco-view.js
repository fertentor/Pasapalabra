// Dibujo del rosco (SVG). Compartido entre el celular y el TV.

export const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {{letra:string, estado:string}[]} letras
 * @param {number} cursor  índice de la letra actual
 * @param {{activo?:boolean, etiqueta?:string}} opts  activo=false no resalta la letra actual
 */
export function roscoSVG(letras, cursor, { activo = true, etiqueta = 'Rosco' } = {}) {
  const n = letras.length;
  const R = 43;
  const r = 5;
  const burbuja = (l, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = (50 + R * Math.cos(ang)).toFixed(2);
    const y = (50 + R * Math.sin(ang)).toFixed(2);
    const actual = activo && i === cursor;
    return `<g class="letra ${l.estado}${actual ? ' actual' : ''}" transform="translate(${x} ${y})"><circle r="${actual ? r * 1.3 : r}"/><text dy=".35em">${esc(l.letra)}</text></g>`;
  };
  // La letra actual se dibuja última para que quede por encima de las vecinas.
  const orden = letras.map((_, i) => i).sort((a, b) => (activo && a === cursor) - (activo && b === cursor));
  return `<svg viewBox="0 0 100 100" class="rosco" role="img" aria-label="${esc(etiqueta)}">${orden
    .map((i) => burbuja(letras[i], i))
    .join('')}</svg>`;
}

/** m:ss */
export function formatoTiempo(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
