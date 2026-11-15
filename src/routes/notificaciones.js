// backend/src/routes/notificaciones.js
const express = require('express');
const { Op, literal } = require('sequelize');
const enrutador = express.Router();
const { Notificacion: Notificacion, Usuario: Usuario } = require('../models');
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");

async function condicionesBandeja(usuarioId) {
  const usuario = await Usuario.findByPk(usuarioId, { attributes: ['modoActual', 'role'] });
  const esModoConductor = usuario?.role !== 'administrador' && usuario?.modoActual === 'conductor';

  // Los envíos manuales usan el alcance original.
  const enviosDeLaOtraBandeja = literal(`(
    SELECT n.id_notificacion FROM public.notificacion n
    JOIN public.envio_notificacion e USING (id_envio_notificacion)
    WHERE n.id_usuario = ${Notificacion.sequelize.escape(usuarioId)}
      AND e.alcance ${esModoConductor ? '<>' : '='} 'conductores'
  )`);
  return { user_id: usuarioId, id: { [Op.notIn]: enviosDeLaOtraBandeja } };
}

/**
 * GET /notificaciones
 * Devuelve las notificaciones del usuario autenticado.
 * Query params:
 *   ?unread=true  → solo no leídas
 *   ?limit=20     → max registros (default 20)
 */
enrutador.get('/', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user.id;
    const limite = Math.min(Math.max(Number.parseInt(solicitud.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(solicitud.query.offset, 10) || 0, 0);
    const unread = solicitud.query.unread === 'true';

    const condiciones = await condicionesBandeja(usuarioId);

    const notificaciones = await Notificacion.findAll({
      where: unread ? { ...condiciones, read_at: null } : condiciones,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: limite + 1,
      offset
    });

    const unreadCantidad = await Notificacion.count({
      where: { ...condiciones, read_at: null }
    });

    return respuesta.json({ success: true, data: notificaciones.slice(0, limite), unread_count: unreadCantidad, hayMas: notificaciones.length > limite });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /notificaciones/:id/leer
 * Marca una notificación como leída.
 */
enrutador.patch('/:id/leer', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const condiciones = await condicionesBandeja(solicitud.user.id);
    const where = { ...condiciones, [Op.and]: [{ id: solicitud.params.id }] };
    const notif = await Notificacion.findOne({ where });
    if (!notif) return respuesta.status(404).json({ success: false, error: 'Notificación no encontrada.' });

    await Notificacion.update({ read_at: new Date() }, { where: { ...where, read_at: null } });
    const sinLeer = await Notificacion.count({ where: { ...condiciones, read_at: null } });
    return respuesta.json({ success: true, message: 'Marcada como leída.', unread_count: sinLeer });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /notificaciones/leer-todas
 * Marca todas las notificaciones del usuario como leídas.
 */
enrutador.patch('/leer-todas', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const condiciones = { ...await condicionesBandeja(solicitud.user.id), read_at: null };
    const [cantidad] = await Notificacion.update(
      { read_at: new Date() },
      { where: condiciones }
    );
    const sinLeer = await Notificacion.count({ where: condiciones });
    return respuesta.json({ success: true, marked: cantidad, unread_count: sinLeer });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /notificaciones/registrar-token
 * El app móvil llama este endpoint al iniciar sesión o cuando FCM renueva el token.
 * Body: { token: "fcm-device-token" }
 */
enrutador.post('/registrar-token', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const { token } = solicitud.body;
    if (!token) return respuesta.status(400).json({ success: false, error: 'token requerido.' });

    await Usuario.update({ fcmToken: token }, { where: { id: solicitud.user.id } });
    return respuesta.json({ success: true, message: 'Token FCM registrado.' });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /notificaciones/registrar-token
 * Elimina el token FCM del usuario (llamar al cerrar sesión).
 */
enrutador.delete('/registrar-token', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    await Usuario.update({ fcmToken: null }, { where: { id: solicitud.user.id } });
    return respuesta.json({ success: true, message: 'Token FCM eliminado.' });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

module.exports = enrutador;
