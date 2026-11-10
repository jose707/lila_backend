// backend/src/routes/usuarios.js
const express = require('express');
const enrutador = express.Router();
const usuarioControlador = require("../controllers/usuarioControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");
const contactos = require('../controllers/contactosEmergenciaControlador');
const ejecutarContactos = accion => (solicitud, respuesta) => accion(solicitud, respuesta).catch(error => {
  console.error('Error al gestionar contactos de emergencia:', error.original?.code ?? error.name);
  respuesta.status(500).json({ error: 'No se pudieron gestionar los contactos de emergencia.' });
});

enrutador.get('/contactos-emergencia', autenticacionIntermediario, ejecutarContactos(contactos.listarContactos));
enrutador.post('/contactos-emergencia', autenticacionIntermediario, ejecutarContactos(contactos.agregarContacto));
enrutador.delete('/contactos-emergencia/:id', autenticacionIntermediario, ejecutarContactos(contactos.quitarContacto));

enrutador.get('/perfil', autenticacionIntermediario, usuarioControlador.obtenerUsuarioPerfil);
enrutador.get('/:id/foto-perfil', autenticacionIntermediario, usuarioControlador.obtenerFotoPerfilVerificada);
enrutador.get('/:id', autenticacionIntermediario, usuarioControlador.obtenerUsuarioPerfil);
enrutador.put('/:id', autenticacionIntermediario, usuarioControlador.actualizarUsuarioPerfil);
enrutador.put('/:id/foto', autenticacionIntermediario, usuarioControlador.actualizarFotoPerfil);
enrutador.post('/:id/verificar-telefono', autenticacionIntermediario, usuarioControlador.verificarTelefono);
enrutador.put(
  '/:id/modo-actual',
  autenticacionIntermediario,
  usuarioControlador.actualizarActualModo
);

module.exports = enrutador;
