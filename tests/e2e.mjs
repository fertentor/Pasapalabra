// Prueba de punta a punta: celular (index.html) + TV (tv.html) conectados por
// BroadcastChannel (?local=1). Requiere Playwright y un servidor estático:
//   python3 -m http.server 8123 &
//   BASE=http://localhost:8123 SHOTS=/tmp/capturas node tests/e2e.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { iniciarServidorPages } from './pages-server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
// Sin BASE, levanta un servidor que imita a GitHub Pages (sitio bajo /Pasapalabra/, 404.html, mayúsculas).
const pages = process.env.BASE ? null : await iniciarServidorPages();
const BASE = process.env.BASE ?? pages.url;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const banco = JSON.parse(readFileSync(new URL('../data/roscos.json', import.meta.url), 'utf8'));
const respuestasDe = (id) => banco.find((r) => r.id === id).letras.map((l) => l.respuesta);

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });
const errores = [];
const vigilar = (page, nombre) => {
  page.on('pageerror', (e) => errores.push(`${nombre}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/peerjs|ERR_|Failed to load resource/i.test(m.text()) && errores.push(`${nombre}: ${m.text()}`));
};

const cel = await context.newPage();
await cel.setViewportSize({ width: 390, height: 844 });
vigilar(cel, 'celular');
await cel.goto(`${BASE}/index.html?local=1`);
await cel.waitForFunction(() => document.getElementById('codigo').textContent.length === 4 && !document.getElementById('btnArmar').disabled);
const codigo = (await cel.textContent('#codigo')).trim();

const tv = await context.newPage();
await tv.setViewportSize({ width: 1920, height: 1080 });
vigilar(tv, 'tv');
await tv.goto(`${BASE}/tv.html?local=1&sala=${codigo}`);
await cel.waitForFunction(() => document.getElementById('tvTxt').textContent.includes('conectado'));
console.log(`✔ TV conectado a la sala ${codigo}`);

const shot = async (page, nombre) => SHOTS && page.screenshot({ path: `${SHOTS}/${nombre}.png` });
const letraTV = (l) => tv.locator('.tv-rosco .letra', { hasText: new RegExp(`^${l}$`) });
const claseLetraTV = async (l) => (await letraTV(l).getAttribute('class')).split(' ');

// ---------------------------------------------------------------- 2 jugadores
await shot(cel, '01-celular-menu');
await cel.fill('[name=n1]', 'Ana');
await cel.fill('[name=n2]', 'Beto');
await cel.selectOption('[name=rosco]', 'general-facil');
await cel.click('#btnArmar');
await cel.waitForSelector('#overlay [data-acc=empezar]');
await tv.waitForSelector('.tv-consigna');
assert.match(await tv.textContent('.tv-consigna'), /Preparados/);
await shot(cel, '02-celular-listo');

await cel.click('[data-acc=empezar]');
await tv.waitForFunction(() => document.querySelector('.tv-consigna')?.textContent.includes('Empieza con A'));
assert.match(await tv.textContent('.tv-definicion'), /Madre de tu mamá/);
assert.match(await cel.textContent('#carta .respuesta b'), /ABUELA/);
console.log('✔ Celular ve la respuesta; TV ve la consigna y la definición');

// El TV jamás debe tener las respuestas del rosco en su DOM.
const htmlTV = () => tv.evaluate(() => document.documentElement.outerHTML.toLowerCase());
for (const r of respuestasDe('general-facil')) {
  assert.ok(!(await htmlTV()).includes(`>${r.toLowerCase()}<`), `El TV muestra la respuesta ${r}`);
}
assert.ok(!(await tv.content()).includes('Respuesta'), 'El TV tiene un bloque de respuesta');
console.log('✔ El DOM del TV no contiene respuestas');

// Correcta → A verde y pasa a la B
await cel.click('#btnCorrecta');
await tv.waitForFunction(() => document.querySelector('.tv-consigna')?.textContent.includes('Empieza con B'));
assert.ok((await claseLetraTV('A')).includes('acertada'));
assert.ok((await claseLetraTV('B')).includes('actual'));
console.log('✔ Correcta: A verde y sigue la B');

// Incorrecta → B roja y pasa el turno a Beto (su A)
await cel.click('#btnIncorrecta');
await tv.waitForFunction(() => document.querySelector('.tv-turno')?.textContent.includes('Beto'));
assert.match(await tv.textContent('.tv-consigna'), /Empieza con A/);
console.log('✔ Incorrecta: pasa el turno a Beto');

// Pasapalabra de Beto → vuelve el turno a Ana en la C
await cel.click('#btnPasa');
await tv.waitForFunction(() => document.querySelector('.tv-turno')?.textContent.includes('Ana'));
assert.match(await tv.textContent('.tv-consigna'), /Empieza con C/);
console.log('✔ Pasapalabra: pasa el turno a Ana, que sigue en la C');

// Los relojes bajan solo en el TV mientras juega Ana
const t0 = await tv.textContent('[data-tiempo="0"]');
await tv.waitForTimeout(2200);
const t1 = await tv.textContent('[data-tiempo="0"]');
assert.notEqual(t0, t1, 'el reloj del TV no avanza');
console.log(`✔ Reloj de Ana corre en el TV (${t0} → ${t1})`);
await shot(cel, '03-celular-juego');
await shot(tv, '04-tv-juego');

// Deshacer
await cel.click('#btnDeshacer');
await cel.waitForSelector('[data-acc=seguir]');
await tv.waitForSelector('.tv-overlay h2');
assert.match(await tv.textContent('.tv-overlay h2'), /PAUSA/);
await shot(tv, '05-tv-pausa');
await cel.click('[data-acc=seguir]');
await tv.waitForFunction(() => !document.querySelector('.tv-overlay'));
assert.match(await tv.textContent('.tv-turno'), /Beto/); // se deshizo el pasapalabra de Beto
console.log('✔ Deshacer + pausa/seguir');

// Terminar → ganador
cel.once('dialog', (d) => d.accept());
await cel.click('#btnTerminar');
await cel.waitForSelector('[data-acc=revancha]');
await tv.waitForSelector('.tv-overlay.fin');
assert.match(await tv.textContent('.tv-overlay.fin h2'), /Ganó Ana/);
await shot(tv, '06-tv-fin');
await shot(cel, '07-celular-fin');
console.log('✔ Fin de partida: gana Ana');

// ------------------------------------------------------- revancha y modo solo
await cel.click('[data-acc=menu]');
await cel.waitForSelector('#vistaLobby:not([hidden])');
await tv.waitForFunction(() => document.getElementById('pantallaEspera') && !document.getElementById('pantallaEspera').hidden);
await cel.check('[name=modo][value=solo]');
await cel.selectOption('[name=rosco]', 'azar:dificil');
await cel.click('#btnArmar');
await cel.click('[data-acc=empezar]');
await tv.waitForSelector('.tv-definicion');
assert.equal(await tv.locator('.tv-jug').count(), 1);
for (let i = 0; i < 27; i++) await cel.click('#btnCorrecta');
await tv.waitForSelector('.tv-overlay.fin');
assert.match(await tv.textContent('.tv-overlay.fin h2'), /Rosco terminado/);
assert.match(await tv.textContent('.fila-fin'), /27/);
console.log('✔ Modo un rosco: 27 aciertos y fin');

// ------------------------------------------------ reconexión de un TV nuevo
const tv2 = await context.newPage();
await tv2.setViewportSize({ width: 1280, height: 720 });
await tv2.goto(`${BASE}/tv.html?local=1`);
await tv2.fill('#inputCodigo', codigo.toLowerCase());
await tv2.click('#formCodigo button');
await tv2.waitForSelector('.tv-overlay.fin');
console.log('✔ Un TV que entra tarde con el código recibe el estado actual');

// -------------------------------------------- 404: mayúsculas y rutas raras
// (lo que pasa si el teclado del TV capitaliza: /Tv.html no existe en Pages)
const tv3 = await context.newPage();
await tv3.setViewportSize({ width: 1280, height: 720 });
await tv3.goto(`${BASE}/Tv.html?local=1&sala=${codigo}`);
await tv3.waitForURL(`${BASE}/tv.html?local=1&sala=${codigo}`);
await tv3.waitForSelector('.tv-overlay.fin');
console.log('✔ /Tv.html (mayúscula) redirige a tv.html y conecta con la sala');

await tv3.goto(`${BASE}/TV`);
await tv3.waitForURL(`${BASE}/tv.html`);
assert.equal(await tv3.title(), 'Pasapalabra · TV');
console.log('✔ /TV sin extensión también llega al TV');

await tv3.goto(`${BASE}/nada/raro`);
assert.equal(await tv3.getAttribute('#tv', 'href'), '/Pasapalabra/tv.html');
assert.equal(await tv3.getAttribute('#control', 'href'), '/Pasapalabra/');
await shot(tv3, '08-404-botones');
console.log('✔ Ruta desconocida: 404 con botones a Control y TV');

assert.equal(await cel.getAttribute('#linkTV', 'href'), 'tv.html');
console.log('✔ El menú del celular tiene el link "Abrir pantalla de TV"');

assert.deepEqual(errores, [], `Errores de consola:\n${errores.join('\n')}`);
await browser.close();
await pages?.cerrar();
console.log('\nTodo OK');
