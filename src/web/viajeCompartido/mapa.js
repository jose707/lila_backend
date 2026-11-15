'use strict';

const token = location.hash.slice(1);
const estado = document.getElementById('estado');
const indicador = document.getElementById('indicador');
const contenedor = document.getElementById('mapa');
const tarjetaMapa = document.getElementById('tarjeta-mapa');
const actualizacion = document.getElementById('actualizacion');
const hora = document.getElementById('hora');
const centrar = document.getElementById('centrar');
const datosViaje = document.getElementById('detalles');
const panel = document.querySelector('.resumen');
const seguimiento = document.querySelector('.seguimiento');
const alternarDetalles = document.getElementById('alternar-detalles');
const contenidoViaje = document.getElementById('contenido-viaje');
const pantallaMovil = window.matchMedia('(max-width: 47.999rem)');
const campos = Object.fromEntries(['pasajero', 'conductor', 'vehiculo', 'placa']
  .map(campo => [campo, document.getElementById(campo)]));
const formatoHora = new Intl.DateTimeFormat('es-BO', { timeStyle: 'medium' });
let mapa;
let marcador;

function ajustarPanel() {
  const tieneContenido = !actualizacion.hidden || !datosViaje.hidden;
  const plegable = pantallaMovil.matches && tieneContenido && !tarjetaMapa.hidden;
  alternarDetalles.hidden = !plegable;
  contenidoViaje.hidden = plegable && alternarDetalles.getAttribute('aria-expanded') !== 'true';
}

function centrarVehiculo() {
  if (!mapa || !marcador) return;
  const punto = marcador.getLatLng();
  if (!pantallaMovil.matches) {
    mapa.panTo(punto);
    return;
  }
  const zoom = mapa.getZoom();
  const centro = mapa.project(punto, zoom).add([0, panel.offsetHeight / 2]);
  mapa.panTo(mapa.unproject(centro, zoom));
}

alternarDetalles.addEventListener('click', () => {
  const expandido = alternarDetalles.getAttribute('aria-expanded') !== 'true';
  alternarDetalles.setAttribute('aria-expanded', String(expandido));
  alternarDetalles.setAttribute('aria-label', expandido ? 'Ocultar detalles' : 'Ver detalles');
  ajustarPanel();
  centrarVehiculo();
});

pantallaMovil.addEventListener('change', ajustarPanel);
new ResizeObserver(() => {
  seguimiento.style.setProperty('--espacio-panel', panel.offsetHeight + 'px');
}).observe(panel);

function mostrarEstado(tipo, mensaje) {
  indicador.dataset.estado = tipo;
  if (estado.textContent !== mensaje) estado.textContent = mensaje;
}

function quitarMapa() {
  tarjetaMapa.hidden = true;
  mapa?.remove();
  mapa = null;
  marcador = null;
}

function ocultarUbicacion(tipo, mensaje) {
  mostrarEstado(tipo, mensaje);
  quitarMapa();
  actualizacion.hidden = true;
  centrar.hidden = true;
  mostrarDetalles(null);
  ajustarPanel();
}

function mostrarDetalles(detalles) {
  const vehiculo = detalles?.vehiculo;
  const valores = {
    pasajero: detalles?.pasajero,
    conductor: detalles?.conductor,
    vehiculo: [vehiculo?.marca, vehiculo?.modelo, vehiculo?.color].filter(Boolean).join(' · '),
    placa: vehiculo?.placa
  };
  for (const [campo, nodo] of Object.entries(campos)) {
    nodo.textContent = detalles ? valores[campo] || 'Sin datos' : '';
  }
  datosViaje.hidden = !detalles;
}

function mostrarMapa(ubicacion) {
  if (!window.L || !ubicacion) {
    quitarMapa();
    return;
  }

  const punto = [ubicacion.latitud, ubicacion.longitud];
  tarjetaMapa.hidden = false;
  if (!mapa) {
    mapa = L.map(contenedor, { zoomControl: false }).setView(punto, 16);
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(mapa);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mapa);
    const icono = L.icon({
      iconUrl: '/viaje-compartido/taxi.svg',
      iconSize: [44, 30],
      iconAnchor: [22, 15],
      className: 'marcador-vehiculo'
    });
    marcador = L.marker(punto, { icon: icono, alt: 'Vehículo del viaje' }).addTo(mapa);
  } else {
    marcador.setLatLng(punto);
    const visible = pantallaMovil.matches
      ? mapa.latLngToContainerPoint(punto).y < mapa.getSize().y - panel.offsetHeight - 24
      : true;
    if (!visible || !mapa.getBounds().pad(-0.2).contains(punto)) centrarVehiculo();
  }
}

centrar.addEventListener('click', centrarVehiculo);

async function actualizar() {
  try {
    const respuesta = await fetch('/viaje-compartido/ubicacion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(8000)
    });
    if (respuesta.status === 404 || respuesta.status === 410) {
      ocultarUbicacion('cerrado', respuesta.status === 410
        ? 'El viaje ha terminado o se canceló.'
        : 'Este enlace ya no está disponible.');
      return;
    }
    if (!respuesta.ok) throw new Error('Ubicación no disponible');

    const { ubicacion, detalles } = await respuesta.json();
    const abrirMapa = !mapa;
    mostrarDetalles(detalles);
    mostrarMapa(ubicacion);
    actualizacion.hidden = !ubicacion;
    centrar.hidden = !marcador;
    ajustarPanel();
    if (abrirMapa && pantallaMovil.matches) centrarVehiculo();
    if (!ubicacion) {
      mostrarEstado('espera', 'Esperando una ubicación reciente del vehículo…');
    } else if (!window.L) {
      mostrarEstado('error', 'No se pudo cargar el mapa.');
    } else {
      mostrarEstado('activo', 'Viaje en curso');
    }
    if (ubicacion) {
      const fecha = new Date(ubicacion.registrada);
      hora.dateTime = fecha.toISOString();
      hora.textContent = formatoHora.format(fecha);
    }
  } catch {
    ocultarUbicacion('error', 'Conexión interrumpida. Volviendo a intentar…');
  }
  setTimeout(actualizar, 5000);
}

if (token) actualizar();
else ocultarUbicacion('cerrado', 'Abre el enlace que recibiste para ver el viaje.');
