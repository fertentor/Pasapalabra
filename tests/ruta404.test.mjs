import test from 'node:test';
import assert from 'node:assert/strict';
import { destino } from '../js/ruta404.js';

test('corrige mayúsculas y extensiones de tv.html y conserva la búsqueda', () => {
  assert.equal(destino('/Pasapalabra/Tv.html'), '/Pasapalabra/tv.html');
  assert.equal(destino('/Pasapalabra/TV.HTML', '?sala=ABCD'), '/Pasapalabra/tv.html?sala=ABCD');
  assert.equal(destino('/Pasapalabra/tv', '?sala=ABCD', '#x'), '/Pasapalabra/tv.html?sala=ABCD#x');
  assert.equal(destino('/Pasapalabra/TV/'), '/Pasapalabra/tv.html');
  assert.equal(destino('/Pasapalabra/tv.htm'), '/Pasapalabra/tv.html');
});

test('corrige index', () => {
  assert.equal(destino('/Pasapalabra/Index.html'), '/Pasapalabra/');
  assert.equal(destino('/Pasapalabra/INDEX', '?local=1'), '/Pasapalabra/?local=1');
});

test('rutas desconocidas devuelven null', () => {
  assert.equal(destino('/Pasapalabra/nada'), null);
  assert.equal(destino('/Pasapalabra/js/otra-cosa.js'), null);
  assert.equal(destino('/pasapalabra'), null);
});

test('no redirige a la misma ruta (sin bucles)', () => {
  assert.equal(destino('/Pasapalabra/tv.html'), null);
  assert.equal(destino('/Pasapalabra/'), null);
  assert.equal(destino('/'), null);
});

test('funciona en la raíz del dominio', () => {
  assert.equal(destino('/Tv.html'), '/tv.html');
});
