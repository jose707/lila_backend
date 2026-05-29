// backend/src/services/notificationService.js
/**
 * Servicio centralizado de notificaciones.
 *
 * Persiste en la tabla `notifications` (in-app) Y envía push via FCM si el
 * usuario tiene un fcm_token registrado.
 *
 * Tipos válidos (según ENUM):
 *   'ride_request' | 'ride_accepted' | 'ride_cancelled' | 'payment' | 'promo' | 'system'
 */
const { Notification, User } = require('../models');
const { getFirebaseApp }     = require('../config/firebase');
const admin                  = require('firebase-admin');

// ─── Envío FCM ─────────────────────────────────────────────────────────────
async function sendPush(fcmToken, title, body, data = {}) {
  try {
    const app = getFirebaseApp();
    if (!app) return; // FCM no configurado, saltar silenciosamente

    const stringData = {};
    Object.keys(data).forEach(k => { stringData[k] = String(data[k] ?? ''); });

    console.log(`📡 [FCM] Intentando enviar a token: ${fcmToken.substring(0,20)}...`);
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: stringData,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } }
    };
    
    // Log the exact payload
    console.log(`📦 [FCM] Payload:`, JSON.stringify(message, null, 2));

    const response = await admin.messaging(app).send(message);
    
    console.log(`✅ [FCM] ÉXITO. Firebase aceptó el mensaje. ID de envío: ${response}`);
  } catch (err) {
    // Token inválido/expirado — no romper el flujo
    if (err.code === 'messaging/registration-token-not-registered') {
      console.warn(`⚠️ [FCM] Token inválido para usuario, ignorando.`);
    } else {
      console.error('⚠️ [FCM] Error grave enviando push:', err);
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
 * @param {string}  opts.type   - ENUM: ride_request|ride_accepted|ride_cancelled|payment|promo|system
 * @param {object} [opts.data]
 */
async function notify({ userId, title, body, type, data = null }) {
  try {
    // 1. Guardar en BD (in-app)
    await Notification.create({
      user_id: userId,
      title,
      body,
      type,
      data,
      is_read: false,
      sent_at: new Date(),
    });

    // 2. Intentar push FCM si el usuario tiene token
    const user = await User.findByPk(userId, { attributes: ['fcmToken'] }).catch(() => null);
    if (user?.fcmToken) {
      await sendPush(user.fcmToken, title, body, data ?? {});
    }
  } catch (err) {
    console.error(`⚠️ [notificationService] Error (${type}) para user ${userId}:`, err.message);
  }
}

// ─── Helpers semánticos ────────────────────────────────────────────────────

async function notifyRideRequest(driverUserIds, ride) {
  const promises = driverUserIds.map(userId =>
    notify({
      userId,
      title: '🚗 Nueva solicitud de viaje',
      body:  `Recogida: ${ride.pickup_address ?? 'Sin dirección'} — Bs ${ride.finalFare ?? '?'}`,
      type:  'ride_request',
      data:  { ride_id: ride.id },
    })
  );
  await Promise.allSettled(promises);
}

async function notifyRideAccepted(passengerUserId, ride, driverName) {
  await notify({
    userId: passengerUserId,
    title:  '✅ Conductor en camino',
    body:   `${driverName} aceptó tu viaje y está en camino.`,
    type:   'ride_accepted',
    data:   { ride_id: ride.id },
  });
}

async function notifyRideCancelled(recipientUserId, ride, cancelledBy) {
  const who = cancelledBy === 'passenger' ? 'el pasajero' :
              cancelledBy === 'driver'    ? 'el conductor' : 'el sistema';
  await notify({
    userId: recipientUserId,
    title:  '❌ Viaje cancelado',
    body:   `El viaje fue cancelado por ${who}.`,
    type:   'ride_cancelled',
    data:   { ride_id: ride.id, cancelled_by: cancelledBy },
  });
}

async function notifyOfferReceived(passengerUserId, ride, offeredPrice, driverName) {
  await notify({
    userId: passengerUserId,
    title:  '💬 Nueva oferta recibida',
    body:   `${driverName} ofrece Bs ${offeredPrice} por tu viaje.`,
    type:   'ride_request',
    data:   { ride_id: ride.id, offered_price: String(offeredPrice) },
  });
}

async function notifyDriverArrived(passengerUserId, ride, driverName) {
  await notify({
    userId: passengerUserId,
    title:  '📍 Conductor en puerta',
    body:   `${driverName} ha llegado al punto de recogida. ¡Sal a su encuentro!`,
    type:   'system',
    data:   { ride_id: ride.id },
  });
}

module.exports = {
  notify,
  notifyRideRequest,
  notifyRideAccepted,
  notifyRideCancelled,
  notifyOfferReceived,
  notifyDriverArrived,
};
