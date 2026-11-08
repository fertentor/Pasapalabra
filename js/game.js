// Lógica pura del juego. Sin DOM, sin red: el celular corre esto y es la
// única fuente de verdad. Todas las funciones devuelven un estado nuevo
// (no mutan el que reciben) y reciben el reloj (`ahora`, en ms) por parámetro.

export const TIEMPO_DEFAULT_MS = 150_000;
const MAX_HISTORIAL = 300;

/**
 * Fases: 'listo' (armada, sin empezar) → 'jugando' ⇄ 'pausa' → 'fin'.
 * Estados de letra: 'pendiente' | 'acertada' | 'errada' | 'pasada'.
 */

function nuevoJugador(nombre, rosco, tiempoMs) {
  return {
    nombre,
    roscoId: rosco.id,
    roscoTitulo: rosco.titulo,
    remainingMs: tiempoMs,
    finished: false,
    cursor: 0,
    letras: rosco.letras.map((l) => ({
      letra: l.letra,
      tipo: l.tipo,
      definicion: l.definicion,
      respuesta: l.respuesta,
      estado: 'pendiente',
    })),
  };
}

/**
 * @param {object} opts
 * @param {'dos'|'solo'} opts.modo
 * @param {string[]} opts.nombres
 * @param {object[]} opts.roscos  uno por jugador (si falta el 2º se repite el 1º)
 * @param {number} [opts.tiempoMs]
 */
export function crearPartida({ modo = 'dos', nombres = [], roscos, tiempoMs = TIEMPO_DEFAULT_MS }) {
  const cantidad = modo === 'solo' ? 1 : 2;
  const jugadores = Array.from({ length: cantidad }, (_, i) =>
    nuevoJugador(nombres[i]?.trim() || `Jugador ${i + 1}`, roscos[i] ?? roscos[0], tiempoMs),
  );
  return {
    modo,
    fase: 'listo',
    turno: 0,
    tiempoMs,
    lastTickAt: null,
    jugadores,
    historial: [],
  };
}

/** Próxima letra sin resolver (pendiente o pasada) después de `desde`, circular. -1 si no queda ninguna. */
export function siguienteIndice(letras, desde) {
  const n = letras.length;
  for (let paso = 1; paso <= n; paso++) {
    const i = (desde + paso) % n;
    if (letras[i].estado === 'pendiente' || letras[i].estado === 'pasada') return i;
  }
  return -1;
}

/** Deja el turno en un jugador que siga en carrera o cierra la partida. */
function asentar(s) {
  if (s.jugadores.every((p) => p.finished)) {
    s.fase = 'fin';
    s.lastTickAt = null;
  } else if (s.jugadores[s.turno].finished) {
    s.turno = s.jugadores.findIndex((p) => !p.finished);
  }
  return s;
}

function copiar(state) {
  return { ...state, jugadores: state.jugadores.map((p) => ({ ...p })) };
}

export function empezar(state, ahora) {
  if (state.fase !== 'listo') return state;
  return { ...state, fase: 'jugando', lastTickAt: ahora };
}

export function pausar(state, ahora) {
  const s = tick(state, ahora);
  if (s.fase !== 'jugando') return s;
  return { ...s, fase: 'pausa', lastTickAt: null };
}

/** Cierra la partida antes de tiempo, con el puntaje que haya. */
export function terminar(state, ahora) {
  const s = tick(state, ahora);
  if (s.fase === 'fin') return s;
  return { ...s, fase: 'fin', lastTickAt: null };
}

export function reanudar(state, ahora) {
  if (state.fase !== 'pausa') return state;
  return { ...state, fase: 'jugando', lastTickAt: ahora };
}

/** Descuenta el tiempo transcurrido al jugador en turno. */
export function tick(state, ahora) {
  if (state.fase !== 'jugando') return state;
  const dt = Math.max(0, ahora - state.lastTickAt);
  const s = copiar(state);
  s.lastTickAt = ahora;
  const p = s.jugadores[s.turno];
  p.remainingMs = Math.max(0, p.remainingMs - dt);
  if (p.remainingMs === 0) p.finished = true;
  return asentar(s);
}

function instantanea(s) {
  return {
    turno: s.turno,
    jugadores: s.jugadores.map((p) => ({
      cursor: p.cursor,
      finished: p.finished,
      estados: p.letras.map((l) => l.estado),
    })),
  };
}

function accion(state, estadoNuevo, ahora) {
  let s = tick(state, ahora);
  if (s.fase !== 'jugando') return s;
  const historial = [...s.historial, instantanea(s)].slice(-MAX_HISTORIAL);
  s = { ...copiar(s), historial };
  const idx = s.turno;
  const p = s.jugadores[idx];
  p.letras = p.letras.map((l, i) => (i === p.cursor ? { ...l, estado: estadoNuevo } : l));

  const proxima = siguienteIndice(p.letras, p.cursor);
  if (proxima === -1) p.finished = true;
  else p.cursor = proxima;

  // En 2 jugadores, errar o pasar entrega el turno; acertar lo conserva.
  if (s.modo === 'dos' && estadoNuevo !== 'acertada') {
    const otro = 1 - idx;
    if (!s.jugadores[otro].finished) s.turno = otro;
  }
  return asentar(s);
}

export const correcta = (state, ahora) => accion(state, 'acertada', ahora);
export const incorrecta = (state, ahora) => accion(state, 'errada', ahora);
export const pasapalabra = (state, ahora) => accion(state, 'pasada', ahora);

export function puedeDeshacer(state) {
  return state.historial.length > 0;
}

/**
 * Deshace la última acción (letras, cursores y turno). El tiempo ya gastado
 * no se devuelve. La partida queda en pausa para que el anfitrión retome.
 */
export function deshacer(state, ahora) {
  const s0 = tick(state, ahora);
  if (!s0.historial.length) return s0;
  const snap = s0.historial.at(-1);
  const s = copiar(s0);
  s.historial = s0.historial.slice(0, -1);
  s.turno = snap.turno;
  s.fase = 'pausa';
  s.lastTickAt = null;
  s.jugadores.forEach((p, i) => {
    const previo = snap.jugadores[i];
    p.cursor = previo.cursor;
    p.finished = previo.finished || p.remainingMs <= 0;
    p.letras = p.letras.map((l, j) => ({ ...l, estado: previo.estados[j] }));
  });
  return asentar(s);
}

export function puntaje(jugador) {
  const cuenta = (e) => jugador.letras.filter((l) => l.estado === e).length;
  return {
    aciertos: cuenta('acertada'),
    errores: cuenta('errada'),
    pasadas: cuenta('pasada'),
    pendientes: cuenta('pendiente'),
  };
}

/** Ganador: más aciertos; si empatan, menos errores; si no, empate (null). */
export function resultado(state) {
  const puntajes = state.jugadores.map(puntaje);
  let ganador = null;
  if (state.jugadores.length === 2) {
    const [a, b] = puntajes;
    if (a.aciertos !== b.aciertos) ganador = a.aciertos > b.aciertos ? 0 : 1;
    else if (a.errores !== b.errores) ganador = a.errores < b.errores ? 0 : 1;
  }
  return { puntajes, ganador };
}

/** Letra actual del jugador en turno (con respuesta; solo para el anfitrión). */
export function letraActual(state) {
  const p = state.jugadores[state.turno];
  return p ? p.letras[p.cursor] : null;
}

/**
 * Lo único que viaja al TV. NO incluye respuestas, ni definiciones de letras
 * que no sean la actual.
 */
export function estadoPublico(state) {
  if (!state) return { fase: 'lobby' };
  const mostrarActual = state.fase === 'jugando' || state.fase === 'pausa';
  const l = mostrarActual ? letraActual(state) : null;
  const { puntajes, ganador } = resultado(state);
  return {
    fase: state.fase,
    modo: state.modo,
    turno: state.turno,
    tiempoMs: state.tiempoMs,
    ganador: state.fase === 'fin' ? ganador : null,
    actual: l ? { letra: l.letra, tipo: l.tipo, definicion: l.definicion } : null,
    jugadores: state.jugadores.map((p, i) => ({
      nombre: p.nombre,
      remainingMs: p.remainingMs,
      finished: p.finished,
      cursor: p.cursor,
      aciertos: puntajes[i].aciertos,
      errores: puntajes[i].errores,
      letras: p.letras.map(({ letra, estado }) => ({ letra, estado })),
    })),
  };
}

const MARCA = { pendiente: '.', acertada: 'a', errada: 'e', pasada: 'p' };

/** Firma de lo que obliga a redibujar (todo salvo los relojes). Sirve para estado completo y público. */
export function firma(s) {
  const jugadores = s.jugadores ?? [];
  return [
    s.fase,
    s.turno,
    s.actual?.letra ?? '',
    ...jugadores.map(
      (p) => `${p.nombre}:${p.cursor}${p.finished ? 'f' : ''}:${p.letras.map((l) => MARCA[l.estado]).join('')}`,
    ),
  ].join('|');
}
