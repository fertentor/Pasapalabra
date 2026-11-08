// Celular (anfitrión): arma la partida, corre la lógica y el reloj, y le
// manda al TV solo el estado público (sin respuestas).

import {
  crearPartida, empezar, tick, pausar, reanudar, correcta, incorrecta, pasapalabra,
  deshacer, terminar, puedeDeshacer, resultado, letraActual, estadoPublico, firma,
} from './game.js';
import { cargarBanco, elegirRosco, consigna } from './roscos.js';
import { abrirSala, esLocal } from './net.js';
import { roscoSVG, formatoTiempo, esc } from './rosco-view.js';

const $ = (id) => document.getElementById(id);
const CLAVE = 'pasapalabra.host.v1';

let banco = [];
let sala = null;
let estado = null; // null = en el menú
let ajustes = { modo: 'dos', n1: '', n2: '', rosco: 'azar', distinto: false, tiempo: 150 };
let ultimoRoscoId = null;
let tvs = 0;
let ultimaFirma = '';
let ultimoEnvio = 0;
let ultimoGuardado = 0;
let wakeLock = null;

// ------------------------------------------------------------ persistencia --

function guardar() {
  ultimoGuardado = Date.now();
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ codigo: sala?.codigo, ajustes, estado, ultimoRoscoId }));
  } catch { /* sin almacenamiento: no pasa nada */ }
}

function restaurar() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
    if (!guardado) return null;
    ajustes = { ...ajustes, ...guardado.ajustes };
    ultimoRoscoId = guardado.ultimoRoscoId ?? null;
    if (guardado.estado) {
      estado = guardado.estado;
      if (estado.fase === 'jugando') estado = { ...estado, fase: 'pausa', lastTickAt: null };
    }
    return guardado.codigo ?? null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- envío ----

function enviarEstado() {
  ultimoEnvio = Date.now();
  sala?.enviar({ tipo: 'estado', estado: estadoPublico(estado) });
}

function setEstado(nuevo) {
  estado = nuevo;
  guardar();
  render();
  enviarEstado();
}

// -------------------------------------------------------------------- lobby --

function urlTV() {
  const u = new URL('tv.html', location.href);
  u.search = '';
  if (sala) u.searchParams.set('sala', sala.codigo);
  if (esLocal()) u.searchParams.set('local', '1');
  return u.toString();
}

function llenarRoscos() {
  const sel = $('selRosco');
  const dif = { facil: 'Fácil', medio: 'Medio', dificil: 'Difícil' };
  const opciones = [
    '<option value="azar">🎲 Al azar</option>',
    ...Object.entries(dif).map(([k, v]) => `<option value="azar:${k}">🎲 Al azar · ${v}</option>`),
    ...Object.entries(dif).map(
      ([k, v]) =>
        `<optgroup label="${v}">${banco
          .filter((r) => r.dificultad === k)
          .map((r) => `<option value="${esc(r.id)}">${esc(r.titulo)}</option>`)
          .join('')}</optgroup>`,
    ),
  ];
  sel.innerHTML = opciones.join('');
}

function aplicarAjustesAlForm() {
  const f = $('formAjustes');
  f.elements.modo.value = ajustes.modo;
  f.elements.n1.value = ajustes.n1;
  f.elements.n2.value = ajustes.n2;
  if ([...f.elements.rosco.options].some((o) => o.value === ajustes.rosco)) f.elements.rosco.value = ajustes.rosco;
  f.elements.distinto.checked = ajustes.distinto;
  f.elements.tiempo.value = String(ajustes.tiempo);
  actualizarForm();
}

function leerForm() {
  const f = $('formAjustes').elements;
  ajustes = {
    modo: f.modo.value,
    n1: f.n1.value.trim(),
    n2: f.n2.value.trim(),
    rosco: f.rosco.value,
    distinto: f.distinto.checked,
    tiempo: Number(f.tiempo.value),
  };
}

function actualizarForm() {
  const dos = $('formAjustes').elements.modo.value === 'dos';
  $('lblJ2').hidden = !dos;
  $('lblDistinto').hidden = !dos;
}

function nuevaPartida() {
  const sel = ajustes.rosco;
  const opciones = sel.startsWith('azar') ? { id: 'azar', dificultad: sel.split(':')[1] ?? 'todas' } : { id: sel };
  const r1 = elegirRosco(banco, opciones, ultimoRoscoId);
  let r2 = r1;
  if (ajustes.modo === 'dos' && ajustes.distinto) {
    const otros = banco.filter((r) => r.id !== r1.id);
    r2 = elegirRosco(otros.length ? otros : banco, opciones.id === 'azar' ? opciones : { id: 'azar' });
  }
  ultimoRoscoId = r1.id;
  setEstado(
    crearPartida({
      modo: ajustes.modo,
      nombres: [ajustes.n1, ajustes.n2],
      roscos: [r1, r2],
      tiempoMs: ajustes.tiempo * 1000,
    }),
  );
}

// -------------------------------------------------------------------- render --

function pintarSala() {
  $('codigo').textContent = sala?.codigo ?? '····';
  $('codigoGrande').textContent = sala?.codigo ?? '····';
  $('urlTV').textContent = urlTV().replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  const chip = $('chipSala');
  chip.classList.toggle('ok', tvs > 0);
  $('tvTxt').textContent = tvs > 0 ? '📺 conectado' : 'sin TV';
  $('estadoTV').textContent = tvs > 0 ? '✔ TV conectado' : 'Esperando al TV…';
  $('estadoTV').classList.toggle('ok', tvs > 0);
}

function pintarTiempos() {
  if (!estado) return;
  document.querySelectorAll('[data-tiempo]').forEach((el) => {
    el.textContent = formatoTiempo(estado.jugadores[Number(el.dataset.tiempo)].remainingMs);
  });
}

function render() {
  ultimaFirma = estado ? firma(estado) : '';
  const lobby = !estado;
  $('vistaLobby').hidden = !lobby;
  $('vistaJuego').hidden = lobby;
  $('controles').hidden = lobby;
  if (lobby) {
    $('overlay').hidden = true;
    liberarPantalla();
    return;
  }
  const fase = estado.fase;
  const turno = estado.turno;
  const p = estado.jugadores[turno];
  const l = letraActual(estado);

  $('marcador').innerHTML = estado.jugadores
    .map((j, i) => {
      const { aciertos, errores } = resultado(estado).puntajes[i];
      const activo = i === turno && fase !== 'fin' && !j.finished;
      return `<div class="jug${activo ? ' activo' : ''}${j.finished ? ' terminado' : ''}">
        <span class="nom">${esc(j.nombre)}</span>
        <span class="tiempo" data-tiempo="${i}">${formatoTiempo(j.remainingMs)}</span>
        <span class="pts"><i class="ok">✔ ${aciertos}</i><i class="mal">✘ ${errores}</i></span>
      </div>`;
    })
    .join('');

  $('roscoHost').innerHTML = `${roscoSVG(p.letras, p.cursor, { activo: fase !== 'fin', etiqueta: `Rosco de ${p.nombre}` })}
    <div class="centro"><div class="letra-grande">${fase === 'fin' || fase === 'traspaso' ? '' : esc(l.letra)}</div>
    <div class="turno-de">${fase === 'fin' ? '' : esc(p.nombre)}</div></div>`;

  const sinPregunta = {
    listo: 'Cuando estén listos, tocá <b>Empezar</b>.',
    traspaso: 'Esperando a que el otro jugador esté listo…',
    fin: 'Partida terminada.',
  };
  if (sinPregunta[fase]) {
    $('carta').innerHTML = `<p class="definicion suave">${sinPregunta[fase]}</p>`;
  } else {
    $('carta').innerHTML = `
      <div class="consigna">${esc(consigna(l.tipo, l.letra))}</div>
      <p class="definicion">${esc(l.definicion)}</p>
      <div class="respuesta"><span>Respuesta · solo la ves vos</span><b>${esc(l.respuesta.toUpperCase())}</b></div>`;
  }

  const jugando = fase === 'jugando';
  for (const id of ['btnIncorrecta', 'btnPasa', 'btnCorrecta']) $(id).disabled = !jugando;
  $('btnPausa').disabled = !jugando;
  $('btnDeshacer').disabled = !puedeDeshacer(estado) || fase === 'listo';
  $('btnTerminar').disabled = fase === 'fin' || fase === 'listo';
  $('controles').hidden = fase === 'fin';

  pintarOverlay();
  if (fase === 'jugando' || fase === 'pausa' || fase === 'traspaso') pedirPantalla();
  else liberarPantalla();
}

const TITULOS_TRASPASO = { pasada: '¡Pasapalabra!', errada: 'Incorrecta', completo: '¡Rosco completo!' };

function pintarOverlay() {
  const ov = $('overlay');
  const fase = estado.fase;
  if (fase === 'listo') {
    const quien = estado.jugadores[0].nombre;
    ov.innerHTML = `<div class="overlay-card">
      <h2>¡Todo listo!</h2>
      <p>${estado.modo === 'dos' ? `Empieza <b>${esc(quien)}</b>.` : `Juega <b>${esc(quien)}</b>.`}
         ${tvs > 0 ? '' : '<br><small class="aviso-txt">El TV todavía no está conectado.</small>'}</p>
      <p class="suave">Rosco: ${esc(estado.jugadores[0].roscoTitulo)}${
        estado.jugadores[1] && estado.jugadores[1].roscoId !== estado.jugadores[0].roscoId
          ? ` / ${esc(estado.jugadores[1].roscoTitulo)}` : ''}</p>
      <button class="btn grande bien" data-acc="empezar">▶ Empezar</button>
      <button class="link" data-acc="menu">Cambiar ajustes</button>
    </div>`;
    ov.hidden = false;
  } else if (fase === 'traspaso') {
    const { de, a, motivo } = estado.traspaso;
    const quien = esc(estado.jugadores[a].nombre);
    ov.innerHTML = `<div class="overlay-card traspaso ${motivo}">
      <h2>${TITULOS_TRASPASO[motivo]}</h2>
      <p>Termina el turno de <b>${esc(estado.jugadores[de].nombre)}</b>.<br>Sigue <b>${quien}</b>: el reloj está frenado.</p>
      <button class="btn grande bien" data-acc="seguir">▶ Seguir con ${quien}</button>
      <button class="link" data-acc="deshacer">↶ Me equivoqué, deshacer</button>
    </div>`;
    ov.hidden = false;
  } else if (fase === 'pausa') {
    ov.innerHTML = `<div class="overlay-card"><h2>Pausa</h2>
      <button class="btn grande bien" data-acc="seguir">▶ Seguir</button></div>`;
    ov.hidden = false;
  } else if (fase === 'fin') {
    const { puntajes, ganador } = resultado(estado);
    const titulo =
      estado.modo === 'solo' ? '¡Rosco terminado!' : ganador === null ? '¡Empate!' : `¡Ganó ${esc(estado.jugadores[ganador].nombre)}!`;
    ov.innerHTML = `<div class="overlay-card"><h2>${titulo}</h2>
      <table class="tabla"><thead><tr><th></th><th>✔</th><th>✘</th></tr></thead><tbody>${estado.jugadores
        .map((j, i) => `<tr class="${ganador === i ? 'gana' : ''}"><td>${esc(j.nombre)}</td><td>${puntajes[i].aciertos}</td><td>${puntajes[i].errores}</td></tr>`)
        .join('')}</tbody></table>
      <button class="btn grande bien" data-acc="revancha">Revancha</button>
      <button class="btn sec" data-acc="deshacer">↶ Deshacer última</button>
      <button class="link" data-acc="menu">Volver al menú</button></div>`;
    ov.hidden = false;
  } else {
    ov.hidden = true;
  }
}

// ----------------------------------------------------------------- acciones --

const vibrar = (ms = 25) => navigator.vibrate?.(ms);

function jugar(fn) {
  if (!estado) return;
  vibrar();
  setEstado(fn(estado, Date.now()));
}

async function pedirPantalla() {
  try {
    if (!wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch { /* no disponible */ }
}

function liberarPantalla() {
  wakeLock?.release?.().catch?.(() => {});
  wakeLock = null;
}

function acciones(acc) {
  switch (acc) {
    case 'empezar': return jugar(empezar);
    case 'seguir': return jugar(reanudar);
    case 'menu': return setEstado(null);
    case 'revancha': return nuevaPartida();
    case 'deshacer': return jugar(deshacer);
    default:
  }
}

function conectarEventos() {
  $('formAjustes').addEventListener('input', () => {
    actualizarForm();
  });
  $('formAjustes').addEventListener('submit', (e) => {
    e.preventDefault();
    leerForm();
    guardar();
    nuevaPartida();
  });

  $('btnCorrecta').addEventListener('click', () => jugar(correcta));
  $('btnIncorrecta').addEventListener('click', () => jugar(incorrecta));
  $('btnPasa').addEventListener('click', () => jugar(pasapalabra));
  $('btnPausa').addEventListener('click', () => jugar(pausar));
  $('btnDeshacer').addEventListener('click', () => jugar(deshacer));
  $('btnTerminar').addEventListener('click', () => {
    if (confirm('¿Terminar la partida ahora?')) jugar(terminar);
  });
  $('overlay').addEventListener('click', (e) => {
    const acc = e.target.closest('[data-acc]')?.dataset.acc;
    if (acc) acciones(acc);
  });

  $('btnCopiar').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(urlTV());
      $('btnCopiar').textContent = '¡Copiado!';
    } catch {
      prompt('Copiá este link:', urlTV());
    }
    setTimeout(() => ($('btnCopiar').textContent = 'Copiar link del TV'), 1800);
  });
  if (navigator.share) {
    $('btnCompartir').hidden = false;
    $('btnCompartir').addEventListener('click', () =>
      navigator.share({ title: 'Pasapalabra', text: `Pantalla de TV · código ${sala.codigo}`, url: urlTV() }).catch(() => {}),
    );
  }

  // Atajos de teclado (útiles si se prueba desde una compu).
  document.addEventListener('keydown', (e) => {
    if (!estado || estado.fase !== 'jugando' || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'c') jugar(correcta);
    else if (k === 'i' || k === 'x') jugar(incorrecta);
    else if (k === 'p' || k === ' ') { e.preventDefault(); jugar(pasapalabra); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && estado && ['jugando', 'pausa', 'traspaso'].includes(estado.fase)) pedirPantalla();
  });
}

// ---------------------------------------------------------------- arranque ---

function avisar(texto) {
  $('aviso').textContent = texto;
  $('aviso').hidden = !texto;
}

function bucle() {
  setInterval(() => {
    const ahora = Date.now();
    if (estado?.fase === 'jugando') {
      const nuevo = tick(estado, ahora);
      const cambio = firma(nuevo) !== ultimaFirma;
      estado = nuevo;
      if (cambio) {
        vibrar(120); // se acabó el tiempo de alguien
        guardar();
        render();
        enviarEstado();
      } else {
        pintarTiempos();
      }
    }
    if (estado?.fase === 'jugando' && ahora - ultimoEnvio >= 1000) enviarEstado();
    if (estado?.fase === 'jugando' && ahora - ultimoGuardado >= 5000) guardar();
  }, 250);
}

async function iniciar() {
  const codigoGuardado = restaurar();
  conectarEventos();
  render();

  try {
    banco = await cargarBanco();
    llenarRoscos();
    aplicarAjustesAlForm();
    $('btnArmar').disabled = false;
  } catch (e) {
    avisar(`No se pudieron cargar los roscos: ${e.message}. Abrí la página desde un servidor (no desde un archivo).`);
  }

  try {
    sala = await abrirSala({
      codigo: codigoGuardado,
      onMensaje: (m) => m?.tipo === 'hola' && enviarEstado(),
      onConexiones: (n) => {
        tvs = n;
        pintarSala();
        if (n > 0) enviarEstado();
        if (estado?.fase === 'listo') pintarOverlay();
      },
      onError: (err) => avisar(`Problema de conexión: ${err.type ?? err.message}`),
    });
    pintarSala();
    guardar();
    enviarEstado();
  } catch (e) {
    avisar(`No se pudo abrir la sala: ${e.message ?? e.type}`);
  }

  bucle();
}

iniciar();
