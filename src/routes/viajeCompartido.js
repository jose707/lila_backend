'use strict';

const express = require('express');
const path = require('node:path');
const { consultarUbicacion } = require('../controllers/viajeCompartidoControlador');

const router = express.Router();
const vistas = path.join(__dirname, '../web/viajeCompartido');

router.get('/', (_solicitud, respuesta) => {
  respuesta.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'strict-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net; img-src 'self' https://tile.openstreetmap.org data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  respuesta.sendFile(path.join(vistas, 'index.html'));
});
router.get('/mapa.js', (_solicitud, respuesta) => respuesta.sendFile(path.join(vistas, 'mapa.js')));
router.get('/estilos.css', (_solicitud, respuesta) => respuesta.sendFile(path.join(vistas, 'estilos.css')));
router.get('/logo-lila.png', (_solicitud, respuesta) => respuesta.sendFile(path.join(vistas, 'logo-lila.png')));
router.get('/taxi.svg', (_solicitud, respuesta) => respuesta.sendFile(path.join(vistas, 'taxi.svg')));
router.post('/ubicacion', consultarUbicacion);

module.exports = router;
