# Pasapalabra 🎯

El rosco de Pasapalabra para jugar con amigos. **El celular es el control** (ve la definición *y la respuesta*, y tiene los botones Correcta / Incorrecta / Pasapalabra) y **el TV es la pantalla** (muestra el rosco, la definición y los relojes, pero nunca la respuesta).

- 27 letras (A–Z con Ñ), consignas "Empieza con…" y "Contiene la…".
- **2 jugadores por turnos** (cada uno con su rosco y su reloj de 2:30) o **un solo rosco**.
- 10 roscos en español rioplatense, de fácil a difícil; se elige uno puntual o al azar.
- Sin servidor propio: sitio estático + WebRTC (PeerJS) entre el celular y el TV.

## Cómo jugar

1. **Publicá el sitio** (ver abajo) y abrí `index.html` en el **celular**. Te muestra un código de sala de 4 letras.
2. En el **TV**, abrí `tv.html` desde el navegador del Smart TV y escribí el código. También podés tocar **Copiar link del TV** y abrir ese link ya con la sala cargada.
   - Si el TV no tiene navegador: abrí el link del TV en una notebook o en el celular y mandalo al televisor con *Enviar pestaña* (Chromecast) o duplicando pantalla (AirPlay / HDMI). **Ojo:** no transmitas la pestaña del control, solo la del TV.
3. En el celular elegí modo, nombres, rosco y tiempo → **Armar partida** → **Empezar**.
4. Con cada letra, leé la definición en voz alta y tocá:
   - **✔ Correcta**: la letra se pone verde y sigue el mismo jugador.
   - **✘ Incorrecta**: se pone roja y pasa el turno al otro jugador.
   - **⏭ Pasapalabra**: queda amarilla para la vuelta siguiente y pasa el turno.
   - ⏸ **Pausa**, ↶ **Deshacer** (corrige un toque equivocado) y **Terminar**.
5. El reloj de cada jugador corre solo mientras es su turno. Gana quien más aciertos tenga; si empatan, quien tenga menos errores.

En el celular también andan las teclas **C** (correcta), **I** (incorrecta) y **P** o espacio (pasapalabra).

## Publicar en GitHub Pages

*Settings → Pages → Build and deployment → Deploy from a branch →* elegí la rama y la carpeta `/ (root)`. En un minuto queda en `https://<usuario>.github.io/Pasapalabra/` (el nombre del repo, **con las mayúsculas exactas**: las rutas de Pages las distinguen).

**Cómo abrir el TV sin errores de tipeo:** los teclados de los Smart TV suelen capitalizar solos. Lo más fácil es escribir en el TV solo la dirección del sitio (`https://<usuario>.github.io/Pasapalabra/`) y tocar el link **📺 ¿Este es el TV? Abrir pantalla de TV** que aparece arriba. Si igual escribís `Tv.html` o `/TV`, la página `404.html` te corrige a `tv.html` sola.

> El código de sala se arma con el servicio público de PeerJS, así que celular y TV necesitan internet (pueden estar en redes distintas).

## Agregar o editar roscos

Los roscos viven en [`data/roscos.json`](data/roscos.json). Cada uno es:

```json
{
  "id": "mi-rosco",
  "titulo": "Mi rosco",
  "dificultad": "facil",
  "letras": [
    { "letra": "A", "tipo": "empieza", "definicion": "Madre de tu mamá o de tu papá.", "respuesta": "abuela" }
  ]
}
```

- `dificultad`: `facil`, `medio` o `dificil`.
- `letras`: exactamente 27, en orden A…Z con la Ñ después de la N.
- `tipo`: `empieza` (la respuesta empieza con la letra) o `contiene` (la lleva adentro; típico de K, W, X, Ñ).
- La definición no puede incluir la respuesta. `npm test` lo verifica.

El menú del celular lista automáticamente todos los roscos que haya en el archivo.

## Desarrollo

```bash
npm start                       # sirve el sitio en http://localhost:8123
npm test                        # lógica del juego + validación del banco (Node ≥ 20)
npm run e2e                     # celular + TV de punta a punta con Playwright
```

Para probar sin internet, agregá `?local=1` a las dos páginas (`index.html?local=1` y `tv.html?local=1&sala=CODIGO`): usan `BroadcastChannel` en vez de WebRTC y funcionan entre pestañas del mismo navegador.

### Cómo está armado

| Archivo | Qué hace |
| --- | --- |
| `js/game.js` | Lógica pura (turnos, reloj, pasapalabra, deshacer, ganador) y `estadoPublico()`, lo único que viaja al TV. |
| `js/roscos.js` | Carga, validación y elección de roscos. |
| `js/net.js` | Transporte celular→TV: PeerJS o BroadcastChannel, misma interfaz. |
| `js/host.js` / `index.html` | Control del celular. Es la única fuente de verdad. |
| `js/tv.js` / `tv.html` | Pantalla del TV: solo dibuja lo que recibe. |
| `js/rosco-view.js` | Dibujo del rosco en SVG. |
| `404.html` / `js/ruta404.js` | Corrige URLs mal tipeadas (mayúsculas, `/tv`) en GitHub Pages. |
| `tests/pages-server.mjs` | Servidor que imita a GitHub Pages (usado por el e2e). |

La respuesta **nunca** sale del celular: `estadoPublico()` no la incluye y un test lo comprueba.
