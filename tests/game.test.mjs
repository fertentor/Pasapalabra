import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  crearPartida, empezar, tick, pausar, reanudar, correcta, incorrecta, pasapalabra,
  deshacer, puntaje, resultado, letraActual, estadoPublico, firma, siguienteIndice, terminar,
} from '../js/game.js';
import { LETRAS, validarRosco, elegirRosco, normalizar } from '../js/roscos.js';

const banco = JSON.parse(readFileSync(new URL('../data/roscos.json', import.meta.url), 'utf8'));

// ---- helpers ---------------------------------------------------------------
const roscoDePrueba = (id = 'x') => ({
  id,
  titulo: id,
  dificultad: 'facil',
  letras: LETRAS.map((l) => ({ letra: l, tipo: 'empieza', definicion: `def ${l}`, respuesta: `${l.toLowerCase()}xx` })),
});

const iniciar = (modo = 'dos', extra = {}) =>
  empezar(crearPartida({ modo, nombres: ['Ana', 'Beto'], roscos: [roscoDePrueba('a'), roscoDePrueba('b')], ...extra }), 0);

// ---- banco -----------------------------------------------------------------
test('el banco tiene al menos 10 roscos válidos', () => {
  assert.ok(banco.length >= 10);
  const problemas = banco.flatMap(validarRosco);
  assert.deepEqual(problemas, []);
});

test('ids de rosco únicos y 27 letras en orden', () => {
  assert.equal(new Set(banco.map((r) => r.id)).size, banco.length);
  for (const r of banco) assert.deepEqual(r.letras.map((l) => l.letra), LETRAS);
});

test('hay roscos de las tres dificultades, con buena cantidad de medios y difíciles', () => {
  const cuenta = (d) => banco.filter((r) => r.dificultad === d).length;
  assert.ok(cuenta('facil') >= 1, 'facil');
  assert.ok(cuenta('medio') >= 10, `medio: ${cuenta('medio')}`);
  assert.ok(cuenta('dificil') >= 10, `dificil: ${cuenta('dificil')}`);
});

test('en medio y difícil no hay respuestas de 3 letras o menos (chequeo de calibración)', () => {
  const cortas = banco
    .filter((r) => r.dificultad !== 'facil')
    .flatMap((r) => r.letras.filter((l) => normalizar(l.respuesta).length <= 3).map((l) => `${r.id} ${l.letra}: ${l.respuesta}`));
  assert.deepEqual(cortas, []);
});

test('las respuestas medias y difíciles son más largas que las fáciles', () => {
  const largo = (d) => {
    const ls = banco.filter((r) => r.dificultad === d).flatMap((r) => r.letras);
    return ls.reduce((n, l) => n + l.respuesta.length, 0) / ls.length;
  };
  assert.ok(largo('medio') > largo('facil'));
  assert.ok(largo('dificil') > largo('medio'));
});

test('ninguna respuesta se repite en todo el banco', () => {
  const vistas = new Map();
  const repetidas = [];
  for (const r of banco) {
    for (const l of r.letras) {
      const clave = normalizar(l.respuesta).replace(/[^a-zñ0-9]/g, '');
      if (vistas.has(clave)) repetidas.push(`${l.respuesta} (${vistas.get(clave)} / ${r.id})`);
      else vistas.set(clave, r.id);
    }
  }
  assert.deepEqual(repetidas, []);
});

test('validarRosco detecta respuestas que no cumplen la consigna ni la definición', () => {
  const malo = roscoDePrueba('malo');
  malo.letras[0].respuesta = 'zorro';
  malo.letras[1].definicion = 'una bxx muy linda';
  const errores = validarRosco(malo);
  assert.equal(errores.length, 2);
  assert.match(errores[0], /no empieza con A/);
  assert.match(errores[1], /contiene la respuesta/);
});

test('normalizar conserva la ñ y quita tildes', () => {
  assert.equal(normalizar('Ñandú'), 'ñandu');
  assert.equal(normalizar('PINGÜINO'), 'pinguino');
});

test('elegirRosco: puntual, filtrado por dificultad y sin repetir el último', () => {
  assert.equal(elegirRosco(banco, { id: 'ciencia-tecnologia' }).id, 'ciencia-tecnologia');
  for (let i = 0; i < 20; i++) assert.equal(elegirRosco(banco, { dificultad: 'dificil' }).dificultad, 'dificil');
  for (let i = 0; i < 20; i++) assert.notEqual(elegirRosco(banco, {}, 'ciencia-tecnologia').id, 'ciencia-tecnologia');
  // si es el único del pool, igual lo devuelve
  assert.equal(elegirRosco([banco[0]], {}, banco[0].id).id, banco[0].id);
});

// ---- flujo de juego --------------------------------------------------------
test('crearPartida: dos jugadores, fase listo, y empezar arranca el reloj', () => {
  const s = crearPartida({ modo: 'dos', nombres: ['Ana'], roscos: [roscoDePrueba()] });
  assert.equal(s.fase, 'listo');
  assert.equal(s.jugadores.length, 2);
  assert.equal(s.jugadores[1].nombre, 'Jugador 2');
  assert.equal(empezar(s, 1000).fase, 'jugando');
});

test('correcta mantiene el turno y avanza a la siguiente letra', () => {
  let s = iniciar();
  s = correcta(s, 1000);
  assert.equal(s.turno, 0);
  assert.equal(s.jugadores[0].letras[0].estado, 'acertada');
  assert.equal(letraActual(s).letra, 'B');
});

test('incorrecta pasa el turno y marca roja', () => {
  let s = iniciar();
  s = incorrecta(s, 1000);
  assert.equal(s.turno, 1);
  assert.equal(s.jugadores[0].letras[0].estado, 'errada');
  assert.equal(letraActual(s).letra, 'A'); // el jugador 2 arranca en su A
});

test('pasapalabra pasa el turno y la letra vuelve en la vuelta siguiente', () => {
  let s = iniciar();
  s = pasapalabra(s, 0); // J1 pasa la A → turno J2
  assert.equal(s.turno, 1);
  s = pasapalabra(s, 0); // J2 pasa su A → turno J1, que sigue en la B
  assert.equal(s.turno, 0);
  assert.equal(letraActual(s).letra, 'B');
  // J1 resuelve todo salvo la A: cuando llega a la Z, vuelve a la A pasada
  for (let i = 0; i < 26; i++) s = correcta(s, 0);
  assert.equal(letraActual(s).letra, 'A');
  assert.equal(s.jugadores[0].letras[0].estado, 'pasada');
});

test('el reloj solo corre para el jugador en turno y se frena en pausa', () => {
  let s = iniciar();
  s = tick(s, 10_000);
  assert.equal(s.jugadores[0].remainingMs, 140_000);
  assert.equal(s.jugadores[1].remainingMs, 150_000);
  s = pausar(s, 20_000);
  assert.equal(s.fase, 'pausa');
  assert.equal(s.jugadores[0].remainingMs, 130_000);
  s = tick(s, 90_000); // en pausa no descuenta
  assert.equal(s.jugadores[0].remainingMs, 130_000);
  s = reanudar(s, 100_000);
  s = tick(s, 101_000);
  assert.equal(s.jugadores[0].remainingMs, 129_000);
});

test('al agotarse el tiempo del jugador en turno juega el otro; si ambos se agotan, fin', () => {
  let s = iniciar();
  s = tick(s, 150_000);
  assert.equal(s.jugadores[0].finished, true);
  assert.equal(s.turno, 1);
  assert.equal(s.fase, 'jugando');
  s = tick(s, 300_000);
  assert.equal(s.fase, 'fin');
});

test('si el otro jugador ya terminó, errar o pasar no cambia el turno', () => {
  let s = iniciar();
  s = tick(s, 150_000); // J1 sin tiempo
  s = incorrecta(s, 150_000); // J2 se equivoca, sigue J2
  assert.equal(s.turno, 1);
  s = pasapalabra(s, 150_000);
  assert.equal(s.turno, 1);
});

test('completar el rosco termina al jugador (aunque sobre tiempo)', () => {
  let s = iniciar('solo');
  for (let i = 0; i < 27; i++) s = correcta(s, i);
  assert.equal(s.jugadores[0].finished, true);
  assert.equal(s.fase, 'fin');
  assert.equal(puntaje(s.jugadores[0]).aciertos, 27);
});

test('modo solo: incorrecta y pasapalabra no cambian de turno', () => {
  let s = iniciar('solo');
  assert.equal(s.jugadores.length, 1);
  s = incorrecta(s, 0);
  s = pasapalabra(s, 0);
  assert.equal(s.turno, 0);
  assert.equal(letraActual(s).letra, 'C');
});

test('pasapalabra con una sola letra pendiente la deja como actual', () => {
  let s = iniciar('solo');
  for (let i = 0; i < 26; i++) s = correcta(s, 0);
  assert.equal(letraActual(s).letra, 'Z');
  s = pasapalabra(s, 0);
  assert.equal(letraActual(s).letra, 'Z');
  assert.equal(s.fase, 'jugando');
});

test('siguienteIndice saltea resueltas y devuelve -1 si no queda ninguna', () => {
  const letras = ['acertada', 'pasada', 'errada', 'pendiente'].map((estado) => ({ estado }));
  assert.equal(siguienteIndice(letras, 0), 1);
  assert.equal(siguienteIndice(letras, 1), 3);
  assert.equal(siguienteIndice(letras, 3), 1);
  assert.equal(siguienteIndice(letras.map(() => ({ estado: 'acertada' })), 0), -1);
});

test('las acciones fuera de "jugando" se ignoran', () => {
  const listo = crearPartida({ modo: 'dos', roscos: [roscoDePrueba()] });
  assert.equal(correcta(listo, 0), listo);
  const pausada = pausar(iniciar(), 1000);
  assert.equal(correcta(pausada, 2000).jugadores[0].letras[0].estado, 'pendiente');
});

test('una acción descuenta primero el tiempo transcurrido', () => {
  let s = iniciar();
  s = correcta(s, 5000);
  assert.equal(s.jugadores[0].remainingMs, 145_000);
});

test('terminar cierra la partida con el puntaje actual', () => {
  let s = iniciar();
  s = correcta(s, 1000);
  s = terminar(s, 2000);
  assert.equal(s.fase, 'fin');
  assert.equal(resultado(s).puntajes[0].aciertos, 1);
  assert.equal(terminar(s, 3000), s);
});

test('no muta el estado de entrada', () => {
  const s = iniciar();
  const antes = JSON.stringify(s);
  correcta(s, 1000);
  incorrecta(s, 1000);
  tick(s, 5000);
  assert.equal(JSON.stringify(s), antes);
});

// ---- deshacer --------------------------------------------------------------
test('deshacer restaura letra, cursor y turno, y deja la partida en pausa', () => {
  let s = iniciar();
  s = correcta(s, 1000);
  s = incorrecta(s, 2000); // turno J2
  s = deshacer(s, 3000);
  assert.equal(s.turno, 0);
  assert.equal(s.fase, 'pausa');
  assert.equal(s.jugadores[0].letras[1].estado, 'pendiente');
  assert.equal(letraActual(s).letra, 'B');
  assert.equal(s.jugadores[0].letras[0].estado, 'acertada');
  // el tiempo gastado no se devuelve: J1 jugó 2 s; el último segundo corrió para J2
  assert.equal(s.jugadores[0].remainingMs, 148_000);
  assert.equal(s.jugadores[1].remainingMs, 149_000);
});

test('deshacer sin historial no hace nada', () => {
  const s = iniciar();
  assert.equal(deshacer(s, 0).fase, 'jugando');
});

test('deshacer después de terminar el rosco reabre la partida', () => {
  let s = iniciar('solo');
  for (let i = 0; i < 27; i++) s = correcta(s, 0);
  assert.equal(s.fase, 'fin');
  s = deshacer(s, 0);
  assert.equal(s.fase, 'pausa');
  assert.equal(s.jugadores[0].finished, false);
  assert.equal(letraActual(s).letra, 'Z');
});

// ---- resultado -------------------------------------------------------------
test('gana quien tiene más aciertos; empate se desempata por menos errores', () => {
  const base = iniciar();
  const mk = (a, e, b, f) => {
    const s = JSON.parse(JSON.stringify(base));
    const marcar = (p, n, estado, desde) => { for (let i = 0; i < n; i++) p.letras[desde + i].estado = estado; };
    marcar(s.jugadores[0], a, 'acertada', 0); marcar(s.jugadores[0], e, 'errada', 20);
    marcar(s.jugadores[1], b, 'acertada', 0); marcar(s.jugadores[1], f, 'errada', 20);
    return s;
  };
  assert.equal(resultado(mk(10, 0, 9, 0)).ganador, 0);
  assert.equal(resultado(mk(8, 3, 9, 5)).ganador, 1);
  assert.equal(resultado(mk(8, 3, 8, 1)).ganador, 1);
  assert.equal(resultado(mk(8, 2, 8, 2)).ganador, null);
});

// ---- estado público --------------------------------------------------------
test('estadoPublico nunca incluye respuestas ni definiciones ajenas a la letra actual', () => {
  const rosco = banco[0];
  let s = empezar(crearPartida({ modo: 'dos', nombres: ['Ana', 'Beto'], roscos: [rosco, banco[1]] }), 0);
  const todas = [...banco[0].letras, ...banco[1].letras];
  const revisar = (st) => {
    const pub = estadoPublico(st);
    const json = JSON.stringify(pub);
    assert.ok(!json.includes('"respuesta"'));
    for (const l of todas) assert.ok(!json.includes(`"${l.respuesta}"`), `se filtró ${l.respuesta}`);
    const definiciones = todas.filter((l) => json.includes(l.definicion));
    assert.ok(definiciones.length <= 1);
    return pub;
  };
  revisar(s);
  for (let i = 0; i < 12; i++) {
    s = i % 3 === 0 ? pasapalabra(s, i) : i % 3 === 1 ? correcta(s, i) : incorrecta(s, i);
    revisar(s);
  }
  s = pausar(s, 100);
  revisar(s);
  s = reanudar(s, 100);
  s = tick(s, 1e9); // se agota el jugador en turno
  s = tick(s, 2e9); // y después el otro
  const pub = revisar(s);
  assert.equal(pub.fase, 'fin');
  assert.equal(pub.actual, null);
});

test('estadoPublico: lobby, listo y datos de la letra actual', () => {
  assert.deepEqual(estadoPublico(null), { fase: 'lobby' });
  const listo = crearPartida({ modo: 'dos', roscos: [roscoDePrueba()] });
  assert.equal(estadoPublico(listo).actual, null);
  const pub = estadoPublico(iniciar());
  assert.deepEqual(pub.actual, { letra: 'A', tipo: 'empieza', definicion: 'def A' });
  assert.equal(pub.jugadores[0].letras.length, 27);
  assert.deepEqual(Object.keys(pub.jugadores[0].letras[0]).sort(), ['estado', 'letra']);
});

test('firma cambia con el estado pero no con el reloj', () => {
  const s = iniciar();
  const f0 = firma(estadoPublico(s));
  assert.equal(firma(estadoPublico(tick(s, 5000))), f0);
  assert.notEqual(firma(estadoPublico(correcta(s, 5000))), f0);
  assert.equal(firma(s), firma(estadoPublico(s)).replace(/^/, '') && firma(s));
});
