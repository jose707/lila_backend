// backend/src/services/notificacionServicio.js
/**
 * Servicio centralizado de notificaciones.
 *
 * Persiste en la tabla `notifications` (in-app) Y envía push via FCM si el
 * usuario tiene un fcm_token registrado.
 *
 * Tipos válidos (según ENUM):
 *   'solicitud_viaje' | 'viaje_aceptado' | 'viaje_cancelado' | 'pago' | 'sistema' | 'emergencia' | 'panico'
 */
const { Notificacion: Notificacion, Usuario: Usuario } = require('../models');
const { obtenerAplicacionFirebase: obtenerFirebaseAplicacion } = require('../config/firebase');
const administrador = require('firebase-admin');

// ─── Envío FCM ─────────────────────────────────────────────────────────────
async function enviarAgregar(fcmToken, titulo, cuerpo, datos = {}) {
  try {
    const aplicacion = obtenerFirebaseAplicacion();
    if (!aplicacion) return; // FCM no configurado, saltar silenciosamente

    const cadenaDatos = {};
    Object.keys(datos).forEach((k) => {cadenaDatos[k] = String(datos[k] ?? '');});

    console.log('📡 [FCM] Enviando notificación al dispositivo');
    const mensaje = {
      token: fcmToken,
      notification: { title: titulo, body: cuerpo },
      data: cadenaDatos,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } }
    };

    console.log('📦 [FCM] Resumen de la notificación:', {
      titulo,
      cantidadCamposAdicionales: Object.keys(cadenaDatos).length
    });

    const respuesta = await administrador.messaging(aplicacion).send(mensaje);

    console.log(`✅ [FCM] ÉXITO. Firebase aceptó el mensaje. ID de envío: ${respuesta}`);
  } catch (error) {
    // Token inválido/expirado — no romper el flujo
    if (error.code === 'messaging/registration-token-not-registered') {
      console.warn(`⚠️ [FCM] Token inválido para usuario, ignorando.`);
    } else {
      console.error('⚠️ [FCM] No se pudo enviar la notificación:', error.code ?? error.name);
    }
  }
}

// ─── Función principal ──────────────────────────────────────────────────────
/**
 * Crea una notificación en la BD y envía push FCM si el usuario tiene token.
 * Nunca lanza excepción.
 *
 * @param {object} opts
 * @param {string}  opts.userId
 * @param {string}  opts.title
 * @param {string}  opts.body
 * @param {string}  opts.type   - ENUM: ride_request|ride_accepted|ride_cancelled|payment|system|emergency|panic
 * @param {object} [opts.data]
 */
async function notificar({ userId: usuarioId, title: titulo, body: cuerpo, type: tipo, data: datos = null }) {
  try {
    // 1. Guardar en BD (in-app)
    await Notificacion.create({
      user_id: usuarioId,
      title: titulo,
      body: cuerpo,
      type: tipo,
      data: datos,
      sent_at: new Date()
    });

    // 2. Intentar push FCM si el usuario tiene token
    const usuario = await Usuario.findByPk(usuarioId, { attributes: ['fcmToken'] }).catch(() => null);
    if (usuario?.fcmToken) {
      await enviarAgregar(usuario.fcmToken, titulo, cuerpo, datos ?? {});
    }
  } catch (error) {
    console.error(`⚠️ [notificationService] Error (${tipo}) para user ${usuarioId}:`, error.message);
  }
}

// ─── Helpers semánticos ────────────────────────────────────────────────────

async function notificarViajeSolicitud(conductorUsuarioIds, viaje) {
  const promises = conductorUsuarioIds.map((usuarioId) =>
  notificar({
    userId: usuarioId,
    title: '🚗 Nueva solicitud de viaje',
    body: `Recogida: ${viaje.pickup_address ?? 'Sin dirección'} — Bs ${viaje.finalFare ?? '?'}`,
    type: 'solicitud_viaje',
    data: { ride_id: viaje.id }
  })
  );
  await Promise.allSettled(promises);
}

async function notificarViajeAceptado(pasajeroUsuarioId, viaje, conductorNombre) {
  await notificar({
    userId: pasajeroUsuarioId,
    title: '✅ Conductor en camino',
    body: `${conductorNombre} aceptó tu viaje y está en camino.`,
    type: 'viaje_aceptado',
    data: { ride_id: viaje.id }
  });
}

async function notificarViajeCancelado(recipientUsuarioId, viaje, canceladoPor) {
  const who = canceladoPor === 'pasajero' ? 'el pasajero' :
  canceladoPor === 'conductor' ? 'el conductor' : 'el sistema';
  await notificar({
    userId: recipientUsuarioId,
    title: '❌ Viaje cancelado',
    body: `El viaje fue cancelado por ${who}.`,
    type: 'viaje_cancelado',
    data: { ride_id: viaje.id, cancelled_by: canceladoPor }
  });
}

async function notificarOfertaRecibido(pasajeroUsuarioId, viaje, ofertadoPrecio, conductorNombre) {
  await notificar({
    userId: pasajeroUsuarioId,
    title: '💬 Nueva oferta recibida',
    body: `${conductorNombre} ofrece Bs ${ofertadoPrecio} por tu viaje.`,
    type: 'solicitud_viaje',
    data: { ride_id: viaje.id, offered_price: String(ofertadoPrecio) }
  });
}

async function notificarConductorLlegado(pasajeroUsuarioId, viaje, conductorNombre) {
  await notificar({
    userId: pasajeroUsuarioId,
    title: '📍 Conductor en puerta',
    body: `${conductorNombre} ha llegado al punto de recogida. ¡Sal a su encuentro!`,
    type: 'sistema',
    data: { ride_id: viaje.id }
  });
}

module.exports = {
  notificar: notificar,
  notificarViajeSolicitud: notificarViajeSolicitud,
  notificarViajeAceptado: notificarViajeAceptado,
  notificarViajeCancelado: notificarViajeCancelado,
  notificarOfertaRecibido: notificarOfertaRecibido,
  notificarConductorLlegado: notificarConductorLlegado
};
