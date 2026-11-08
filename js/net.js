// Transporte celular → TV. Misma interfaz para dos implementaciones:
//  - PeerJS (WebRTC): para jugar de verdad, sin servidor propio.
//  - BroadcastChannel (?local=1): dos pestañas del mismo navegador, para
//    probar sin internet y para los tests automáticos.
//
// Mensajes: { tipo: 'hola' } (TV → celular) y { tipo: 'estado', estado } (celular → TV).

const PREFIJO = 'pasapalabra-';
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // sin I, L, O para no confundir

export const esLocal = () => new URLSearchParams(location.search).has('local');

export function generarCodigo() {
  let c = '';
  for (let i = 0; i < 4; i++) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return c;
}

export function normalizarCodigo(texto) {
  return String(texto ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

const noop = () => {};

// ---------------------------------------------------------------- anfitrión --

/**
 * Abre la sala en el celular.
 * @returns {Promise<{codigo:string, enviar:(msg:object)=>void, cerrar:()=>void}>}
 */
export function abrirSala({ codigo, local = esLocal(), onMensaje = noop, onConexiones = noop, onError = noop }) {
  const inicial = normalizarCodigo(codigo);
  return local
    ? salaLocal(inicial.length === 4 ? inicial : generarCodigo(), onMensaje, onConexiones)
    : salaPeer(inicial.length === 4 ? inicial : generarCodigo(), onMensaje, onConexiones, onError);
}

function salaLocal(codigo, onMensaje, onConexiones) {
  const canal = new BroadcastChannel(PREFIJO + codigo);
  const tvs = new Set();
  canal.onmessage = ({ data }) => {
    if (data?.tipo === 'hola') {
      tvs.add(data.id);
      onConexiones(tvs.size);
    } else if (data?.tipo === 'chau') {
      tvs.delete(data.id);
      onConexiones(tvs.size);
      return;
    }
    onMensaje(data);
  };
  return Promise.resolve({
    codigo,
    enviar: (msg) => canal.postMessage(msg),
    cerrar: () => canal.close(),
  });
}

function salaPeer(codigoInicial, onMensaje, onConexiones, onError) {
  if (!window.Peer) return Promise.reject(new Error('No se pudo cargar PeerJS (¿hay internet?).'));
  return new Promise((resolve, reject) => {
    let intentos = 0;
    let resuelto = false;

    const abrir = (codigo) => {
      const peer = new window.Peer(PREFIJO + codigo, { debug: 0 });
      const conexiones = new Set();

      peer.on('open', () => {
        resuelto = true;
        resolve({
          codigo,
          enviar: (msg) => conexiones.forEach((c) => c.open && c.send(msg)),
          cerrar: () => peer.destroy(),
        });
      });

      peer.on('connection', (conn) => {
        const quitar = () => {
          if (conexiones.delete(conn)) onConexiones(conexiones.size);
        };
        conn.on('open', () => {
          conexiones.add(conn);
          onConexiones(conexiones.size);
        });
        conn.on('data', (d) => onMensaje(d));
        conn.on('close', quitar);
        conn.on('error', quitar);
      });

      peer.on('disconnected', () => {
        if (!peer.destroyed) peer.reconnect();
      });

      peer.on('error', (err) => {
        if (!resuelto && err.type === 'unavailable-id' && intentos++ < 6) {
          // Código ocupado (o la sesión anterior aún no se liberó): probamos otro.
          peer.destroy();
          setTimeout(() => abrir(generarCodigo()), 200);
        } else if (!resuelto) {
          reject(err);
        } else {
          onError(err);
        }
      });
    };

    abrir(codigoInicial);
  });
}

// --------------------------------------------------------------------- TV ----

/**
 * Se conecta a una sala desde el TV y reintenta solo si se corta.
 * onEstado recibe: 'buscando' | 'conectado' | 'perdido'.
 */
export function conectarASala({ codigo, local = esLocal(), onMensaje = noop, onEstado = noop }) {
  return local ? clienteLocal(codigo, onMensaje, onEstado) : clientePeer(codigo, onMensaje, onEstado);
}

function clienteLocal(codigo, onMensaje, onEstado) {
  const canal = new BroadcastChannel(PREFIJO + codigo);
  const id = Math.random().toString(36).slice(2);
  canal.onmessage = ({ data }) => {
    onEstado('conectado');
    onMensaje(data);
  };
  const saludar = () => canal.postMessage({ tipo: 'hola', id });
  onEstado('buscando');
  saludar();
  // Si el celular se abre después que el TV, el saludo inicial se pierde: reintentamos hasta recibir algo.
  let recibido = false;
  const previo = canal.onmessage;
  canal.onmessage = (e) => {
    recibido = true;
    previo(e);
  };
  const timer = setInterval(() => (recibido ? clearInterval(timer) : saludar()), 1000);
  addEventListener('pagehide', () => canal.postMessage({ tipo: 'chau', id }));
  return {
    enviar: (msg) => canal.postMessage({ ...msg, id }),
    cerrar: () => {
      clearInterval(timer);
      canal.close();
    },
  };
}

function clientePeer(codigo, onMensaje, onEstado) {
  if (!window.Peer) {
    onEstado('error');
    return { enviar: noop, cerrar: noop };
  }
  const peer = new window.Peer({ debug: 0 });
  let conn = null;
  let cerrado = false;
  let timer = null;
  let estuvoConectado = false;

  const reintentar = () => {
    if (cerrado || timer) return;
    onEstado(estuvoConectado ? 'perdido' : 'buscando');
    timer = setTimeout(() => {
      timer = null;
      conectar();
    }, 2000);
  };

  const conectar = () => {
    if (cerrado || peer.destroyed) return;
    if (peer.disconnected) peer.reconnect();
    try {
      conn?.close();
    } catch { /* ya cerrada */ }
    conn = peer.connect(PREFIJO + codigo, { reliable: true });
    conn.on('open', () => {
      estuvoConectado = true;
      onEstado('conectado');
      conn.send({ tipo: 'hola' });
    });
    conn.on('data', (d) => onMensaje(d));
    conn.on('close', reintentar);
    conn.on('error', reintentar);
  };

  peer.on('open', conectar);
  peer.on('disconnected', () => !peer.destroyed && peer.reconnect());
  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') reintentar();
    else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      onEstado('sin-internet');
      reintentar();
    }
  });

  return {
    enviar: (msg) => conn?.open && conn.send(msg),
    cerrar: () => {
      cerrado = true;
      clearTimeout(timer);
      peer.destroy();
    },
  };
}
