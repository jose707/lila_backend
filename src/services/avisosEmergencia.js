'use strict';

const db = require('../config/baseDatos');
const { notificar } = require('./notificacionServicio');
const { obtenerIo } = require('../socket');

async function enviarWhatsApp(telefono, nombre, ubicacion) {
  const { WHATSAPP_PHONE_NUMBER_ID: numeroId, WHATSAPP_ACCESS_TOKEN: token,
    WHATSAPP_API_VERSION: version = 'v25.0', WHATSAPP_TEMPLATE_LANGUAGE: idioma = 'es' } = process.env;
  if (!numeroId || !token) throw new Error('Servicio WhatsApp sin configurar');
  if (!/^\d+$/.test(numeroId) || !/^v\d+\.\d+$/.test(version)) {
    throw new Error('Configuración WhatsApp inválida');
  }
  const respuesta = await fetch(`https://graph.facebook.com/${version}/${numeroId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: telefono.replace(/\D/g, ''),
      type: 'template', template: {
        name: 'alerta_emergencia_viaje', language: { code: idioma },
        components: [{ type: 'body', parameters: [
          { type: 'text', parameter_name: 'nombre_contacto', text: nombre },
          { type: 'text', parameter_name: 'ubicacion', text: ubicacion }
        ] }]
      }
    }),
    signal: AbortSignal.timeout(5000)
  });
  const datos = await respuesta.json().catch(() => ({}));
  const mensaje = datos.messages?.[0];
  if (!respuesta.ok || datos.error || !mensaje?.id ||
    (mensaje.message_status && mensaje.message_status !== 'accepted')) {
    const codigo = Number.isInteger(datos.error?.code) ? `, código ${datos.error.code}` : '';
    throw new Error(`Meta rechazó el aviso WhatsApp (HTTP ${respuesta.status}${codigo})`);
  }
  return mensaje.id;
}

async function enviarWhatsAppPendientes(registros, nombre, ubicacion) {
  await Promise.allSettled(registros.map(async ({ id, telefono }) => {
    let proveedorId = null;
    let motivo = null;
    try {
      proveedorId = await enviarWhatsApp(telefono, nombre, ubicacion);
    } catch (error) {
      motivo = error.name === 'TimeoutError' ? 'El proveedor no confirmó la recepción a tiempo' :
        error.message.startsWith('Meta rechazó') || error.message.startsWith('Servicio WhatsApp') || error.message.startsWith('Configuración WhatsApp')
          ? error.message : 'No se pudo conectar con Meta para enviar WhatsApp';
    }
    // La tabla histórica conserva su nombre; "enviado" significa aceptado por el proveedor.
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

module.exports = { avisarCentral, enviarWhatsAppPendientes };
