'use strict';
const enrutador = require('express').Router();
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");
const lugares = require("../services/placesServicio");
enrutador.use(autenticacionIntermediario);
enrutador.use((_Solicitud, respuesta, siguiente) => {
  respuesta.set('Cache-Control', 'no-store');
  siguiente();
});
for (const [accion, clave] of [['autocompletar', 'suggestions'], ['detalles', 'place']]) {
  enrutador.post(`/${accion}`, async (solicitud, respuesta) => {
    try {
      respuesta.json({
        [clave]: await lugares[
        accion](
          solicitud.body || {})
      });
    } catch (error) {
      respuesta.
      status(error.status || 500).
      json({
        error: error.status ?
        error.message :
        'No se pudo procesar la búsqueda.'
      });
    }
  });
}
module.exports = enrutador;
