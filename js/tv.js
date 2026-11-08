// TV: solo renderiza lo que le llega del celular. Nunca recibe respuestas.

import { conectarASala, normalizarCodigo, esLocal } from './net.js';
import { consigna } from './roscos.js';
import { firma } from './game.js';
import { roscoSVG, formatoTiempo, esc } from './rosco-view.js';

const $ = (id) => document.getElementById(id);
const CLAVE = 'pasapalabra.tv.codigo';

let codigo = '';
let enlace = null;
let ultimo = null; // { estado, recibidoEn }
let ultimaFirma = '';
let conexion = 'buscando';

// ---------------------------------------------------------------- pantallas --

function mostrar(cual) {
  $('pantallaCodigo').hidden = cual !== 'codigo';
  $('pantallaEspera').hidden = cual !== 'espera';
  $('pantallaJuego').hidden = cual !== 'juego';
}

function espera(texto, { otraSala = false } = {}) {
  mostrar('espera');
  $('textoEspera').textContent = texto;
  $('btnOtraSala').hidden = !otraSala;
}

function pintarConexion() {
  const el = $('estadoConexion');
  const textos = {
    perdido: 'Reconectando con el celular…',
    'sin-internet': 'Sin conexión a internet',
    error: 'No se pudo cargar PeerJS (¿hay internet?)',
  };
  el.hidden = !textos[conexion];
  el.textContent = textos[conexion] ?? '';
}

function tiempoDe(i) {
  const { estado, recibidoEn } = ultimo;
  const base = estado.jugadores[i].remainingMs;
  const corre = estado.fase === 'jugando' && estado.turno === i && !estado.jugadores[i].finished;
  return corre ? base - (performance.now() - recibidoEn) : base;
}

function pintarTiempos() {
  if (!ultimo?.estado.jugadores) return;
  document.querySelectorAll('[data-tiempo]').forEach((el) => {
    const ms = tiempoDe(Number(el.dataset.tiempo));
    el.textContent = formatoTiempo(ms);
    el.classList.toggle('urgente', ms <= 10_000);
  });
}

function render(estado) {
  if (!estado || estado.fase === 'lobby') {
    return espera(`Sala ${codigo} conectada. Esperando que se arme la partida…`);
  }
  mostrar('juego');
  const { fase, turno, modo } = estado;
  const p = estado.jugadores[turno];
  const a = estado.actual;
  const grande = fase === 'fin' ? '' : a ? esc(a.letra) : '';

  const tarjetas = estado.jugadores
    .map((j, i) => {
      const activo = i === turno && ['jugando', 'pausa', 'traspaso'].includes(fase) && !j.finished;
      return `<div class="tv-jug${activo ? ' activo' : ''}${j.finished ? ' terminado' : ''}">
        <div class="nom">${esc(j.nombre)}</div>
        <div class="tiempo" data-tiempo="${i}">${formatoTiempo(j.remainingMs)}</div>
        <div class="pts"><span class="ok">✔ ${j.aciertos}</span><span class="mal">✘ ${j.errores}</span></div>
      </div>`;
    })
    .join('');

  let panel;
  if (a) {
    panel = `<div class="tv-consigna">${esc(consigna(a.tipo, a.letra))}</div>
      <p class="tv-definicion">${esc(a.definicion)}</p>`;
  } else if (fase === 'listo') {
    panel = `<div class="tv-consigna">¡Preparados!</div>
      <p class="tv-definicion">${modo === 'dos' ? `Empieza ${esc(estado.jugadores[0].nombre)}` : 'Ya casi arrancamos'}</p>`;
  } else {
    panel = '';
  }

  $('pantallaJuego').innerHTML = `
    <div class="tv-juego">
      <div class="tv-rosco">
        <div class="tv-turno">${fase === 'jugando' || fase === 'pausa' ? `Turno de <b>${esc(p.nombre)}</b>` : '&nbsp;'}</div>
        <div class="rosco-wrap">
          ${roscoSVG(p.letras, p.cursor, { activo: fase === 'jugando' || fase === 'pausa', etiqueta: `Rosco de ${p.nombre}` })}
          <div class="centro"><div class="letra-grande">${grande}</div></div>
        </div>
      </div>
      <aside class="tv-panel">
        ${panel}
        <div class="tv-jugadores">${tarjetas}</div>
      </aside>
    </div>
    ${fase === 'pausa' ? '<div class="tv-overlay"><h2>PAUSA</h2></div>' : ''}
    ${fase === 'traspaso' ? overlayTraspaso(estado) : ''}
    ${fase === 'fin' ? overlayFin(estado) : ''}`;
  pintarTiempos();
}

const TITULOS_TRASPASO = { pasada: '¡PASAPALABRA!', errada: '¡INCORRECTA!', completo: '¡ROSCO COMPLETO!' };

// Pausa entre turnos: todavía no se muestra la definición del jugador que sigue.
function overlayTraspaso({ traspaso, jugadores }) {
  const { a, motivo } = traspaso;
  return `<div class="tv-overlay traspaso ${esc(motivo)}">
    <h2>${TITULOS_TRASPASO[motivo] ?? ''}</h2>
    <p>Turno de <b>${esc(jugadores[a].nombre)}</b></p>
  </div>`;
}

function overlayFin(estado) {
  const { ganador, jugadores, modo } = estado;
  const titulo =
    modo === 'solo' ? '¡Rosco terminado!' : ganador === null ? '¡Empate!' : `¡Ganó ${esc(jugadores[ganador].nombre)}!`;
  const filas = jugadores
    .map(
      (j, i) => `<div class="fila-fin${ganador === i ? ' gana' : ''}">
        <span>${esc(j.nombre)}</span><span class="ok">✔ ${j.aciertos}</span><span class="mal">✘ ${j.errores}</span></div>`,
    )
    .join('');
  return `<div class="tv-overlay fin"><h2>${titulo}</h2>${filas}</div>`;
}

// ---------------------------------------------------------------- conexión ---

function recibir(msg) {
  if (msg?.tipo !== 'estado') return;
  ultimo = { estado: msg.estado, recibidoEn: performance.now() };
  const f = firma(msg.estado);
  if (f !== ultimaFirma) {
    ultimaFirma = f;
    render(msg.estado);
  } else {
    pintarTiempos(); // solo cambiaron los relojes
  }
}

function conectar(nuevoCodigo) {
  codigo = normalizarCodigo(nuevoCodigo);
  if (codigo.length !== 4) return pedirCodigo();
  try {
    localStorage.setItem(CLAVE, codigo);
  } catch { /* sin almacenamiento */ }
  const u = new URL(location.href);
  u.searchParams.set('sala', codigo);
  history.replaceState(null, '', u);

  enlace?.cerrar();
  ultimo = null;
  ultimaFirma = '';
  espera(`Conectando con la sala ${codigo}…`, { otraSala: true });
  enlace = conectarASala({
    codigo,
    onMensaje: recibir,
    onEstado: (e) => {
      conexion = e;
      pintarConexion();
      if (e === 'buscando' && !ultimo) espera(`Buscando la sala ${codigo}… Revisá que el celular tenga la app abierta.`, { otraSala: true });
    },
  });
}

function pedirCodigo() {
  enlace?.cerrar();
  enlace = null;
  ultimo = null;
  mostrar('codigo');
  $('inputCodigo').value = '';
  $('inputCodigo').focus();
}

// --------------------------------------------------------------- arranque ----

function iniciar() {
  $('formCodigo').addEventListener('submit', (e) => {
    e.preventDefault();
    conectar($('inputCodigo').value);
  });
  $('inputCodigo').addEventListener('input', (e) => {
    e.target.value = normalizarCodigo(e.target.value);
  });
  $('btnOtraSala').addEventListener('click', pedirCodigo);

  const pantallaCompleta = () =>
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
  $('btnPantallaCompleta').addEventListener('click', pantallaCompleta);
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f' && e.target.tagName !== 'INPUT') pantallaCompleta();
  });
  document.addEventListener('fullscreenchange', () => ($('btnPantallaCompleta').hidden = !!document.fullscreenElement));

  setInterval(pintarTiempos, 200);
  navigator.wakeLock?.request('screen').catch(() => {});

  const params = new URLSearchParams(location.search);
  let guardado = '';
  try {
    guardado = localStorage.getItem(CLAVE) ?? '';
  } catch { /* nada */ }
  const inicial = normalizarCodigo(params.get('sala'));
  // Con ?local=1 usamos solo el código de la URL; en modo normal también el último usado.
  if (inicial.length === 4) conectar(inicial);
  else if (!esLocal() && normalizarCodigo(guardado).length === 4) conectar(guardado);
  else pedirCodigo();
}

iniciar();
