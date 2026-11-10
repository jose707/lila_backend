'use strict';

const db = require('../config/baseDatos');
const { notificar } = require('./notificacionServicio');
const { obtenerIo } = require('../socket');

async function enviarSms(telefono, cuerpo) {
  const { TWILIO_ACCOUNT_SID: cuenta, TWILIO_AUTH_TOKEN: token, TWILIO_SMS_FROM: remitente } = process.env;
  if (!cuenta || !token || !remitente) throw new Error('Servicio SMS sin configurar');
  if (!/^AC[a-f0-9]{32}$/i.test(cuenta)) throw new Error('Cuenta SMS inválida');
  const respuesta = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cuenta}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cuenta}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: remitente, To: telefono, Body: cuerpo }),
    signal: AbortSignal.timeout(5000)
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || !datos.sid || ['failed', 'undelivered'].includes(datos.status)) {
    throw new Error(`Proveedor SMS rechazó el envío (${respuesta.status})`);
  }
  return datos.sid;
}

async function enviarSmsPendientes(registros) {
  await Promise.allSettled(registros.map(async ({ id, telefono, cuerpo }) => {
    let proveedorId = null;
    let motivo = null;
    try {
      proveedorId = await enviarSms(telefono, cuerpo);
    } catch (error) {
      motivo = error.name === 'TimeoutError' ? 'El proveedor no confirmó la recepción a tiempo' :
        error.message.startsWith('Proveedor SMS') || error.message.startsWith('Servicio SMS') || error.message.startsWith('Cuenta SMS')
          ? error.message : 'No se pudo conectar con el proveedor SMS';
    }
    await db.query(`UPDATE public.registro_sms_emergencia
      SET estado = CASE WHEN :exito THEN 'enviado'::sms_estado ELSE 'fallido'::sms_estado END,
          proveedor_id = :proveedorId, enviado_en = CASE WHEN :exito THEN NOW() END,
          fallo_en = CASE WHEN NOT :exito THEN NOW() END, mensaje_error = :motivo
      WHERE id_registro_sms_emergencia = :id`, {
      esquemaFisico: true, replacements: { id, proveedorId, motivo, exito: Boolean(proveedorId) }
    });
  }));
}

async function avisarCentral(idAlerta, idViaje) {
  const [administradores] = await db.query(`SELECT id_usuario AS id FROM public.usuario
    WHERE rol = 'administrador' AND activo AND eliminado_en IS NULL`, { esquemaFisico: true });
  const io = obtenerIo();
  await Promise.allSettled(administradores.map(({ id }) => {
    io.to(`user:${id}`).emit('emergencia:registrada', { idAlerta });
    return notificar({ userId: id, title: 'Alerta de emergencia',
      body: 'Un participante activó el botón de emergencia durante un viaje. Revisa la central.',
      type: 'emergencia', data: { idAlerta, idViaje } });
  }));
}

module.exports = { avisarCentral, enviarSmsPendientes };
