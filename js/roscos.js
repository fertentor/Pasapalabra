// Helpers del banco de roscos: carga, validación y selección.

export const LETRAS = [...'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'];

const SIN_TILDE = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' };

/** Minúsculas y sin tildes, pero conservando la ñ. */
export function normalizar(texto) {
  return String(texto)
    .toLowerCase()
    .replace(/[áéíóúü]/g, (c) => SIN_TILDE[c]);
}

/** Palabras de un texto, ya normalizadas. */
function palabras(texto) {
  return normalizar(texto)
    .split(/[^a-zñ0-9]+/)
    .filter(Boolean);
}

/** "Empieza con la A" / "Contiene la A". */
export function consigna(tipo, letra) {
  return tipo === 'contiene' ? `Contiene la ${letra}` : `Empieza con ${letra}`;
}

/** Devuelve la lista de problemas de un rosco (vacía si está todo bien). */
export function validarRosco(rosco) {
  const errores = [];
  const id = rosco?.id ?? '(sin id)';
  const err = (msg) => errores.push(`[${id}] ${msg}`);

  if (!rosco?.id) err('falta "id"');
  if (!rosco?.titulo) err('falta "titulo"');
  if (!['facil', 'medio', 'dificil'].includes(rosco?.dificultad)) {
    err('"dificultad" debe ser facil, medio o dificil');
  }
  if (!Array.isArray(rosco?.letras) || rosco.letras.length !== LETRAS.length) {
    err(`debe tener exactamente ${LETRAS.length} letras`);
    return errores;
  }

  rosco.letras.forEach((l, i) => {
    const esperada = LETRAS[i];
    if (l.letra !== esperada) err(`posición ${i + 1}: se esperaba ${esperada} y hay ${l.letra}`);
    if (!['empieza', 'contiene'].includes(l.tipo)) err(`${l.letra}: "tipo" inválido`);
    if (!l.definicion || !l.respuesta) {
      err(`${l.letra}: falta definición o respuesta`);
      return;
    }
    const letra = normalizar(esperada);
    const resp = normalizar(l.respuesta);
    if (l.tipo === 'empieza' && !resp.startsWith(letra)) {
      err(`${l.letra}: "${l.respuesta}" no empieza con ${l.letra}`);
    }
    if (l.tipo === 'contiene' && !resp.includes(letra)) {
      err(`${l.letra}: "${l.respuesta}" no contiene la ${l.letra}`);
    }
    // La definición no puede incluir la respuesta completa.
    const palabrasResp = palabras(l.respuesta);
    const palabrasDef = palabras(l.definicion);
    const ventana = palabrasResp.length;
    for (let j = 0; j + ventana <= palabrasDef.length; j++) {
      if (palabrasDef.slice(j, j + ventana).join(' ') === palabrasResp.join(' ')) {
        err(`${l.letra}: la definición contiene la respuesta "${l.respuesta}"`);
        break;
      }
    }
  });
  return errores;
}

/**
 * Elige un rosco del banco.
 * - id: id de un rosco puntual, o "azar".
 * - dificultad: "todas" | "facil" | "medio" | "dificil" (solo aplica al azar).
 * - excluirId: evita repetir el último jugado cuando hay alternativas.
 */
export function elegirRosco(banco, { id = 'azar', dificultad = 'todas' } = {}, excluirId = null, rng = Math.random) {
  if (id && id !== 'azar') {
    const puntual = banco.find((r) => r.id === id);
    if (puntual) return puntual;
  }
  let pool = banco.filter((r) => dificultad === 'todas' || r.dificultad === dificultad);
  if (!pool.length) pool = banco;
  const sinRepetir = pool.filter((r) => r.id !== excluirId);
  const fuente = sinRepetir.length ? sinRepetir : pool;
  return fuente[Math.floor(rng() * fuente.length)];
}

export async function cargarBanco(url = 'data/roscos.json') {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`No se pudo cargar ${url} (${resp.status})`);
  const banco = await resp.json();
  const invalidos = banco.flatMap(validarRosco);
  if (invalidos.length) console.warn('Roscos con problemas:\n' + invalidos.join('\n'));
  return banco;
}
