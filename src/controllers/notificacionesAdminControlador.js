'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/baseDatos');
const notificaciones = require('../services/notificacionServicio');

const claveVistaPrevia = randomBytes(32);
const alcances = ['individual', 'pasajeros', 'conductores'];
const esUuid = valor => typeof valor === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(valor);
const fallo = (status, message) => Object.assign(new Error(message), { status });
const consultar = async (sql, replacements = {}, transaction) => (
  await db.query(sql, { esquemaFisico: true, replacements, transaction })
)[0];

const nombreUsuario = alias => `COALESCE((
  SELECT NULLIF(TRIM(CONCAT_WS(' ', ci.nombres, ci.apellido_paterno, ci.apellido_materno)), '')
  FROM public.usuario_documento ud JOIN public.documento_ci ci ON ci.id_documento_ci = ud.id_documento
  WHERE ud.id_usuario = ${alias}.id_usuario ORDER BY ci.id_documento_ci LIMIT 1
), ${alias}.correo, ${alias}.telefono, 'Usuario')`;

const usuariosActivos = `FROM public.usuario u
  LEFT JOIN public.conductor c ON c.id_usuario = u.id_usuario AND c.estado = 'aprobado' AND c.eliminado_en IS NULL
  WHERE u.activo AND u.eliminado_en IS NULL`;

const ruta = accion => async (solicitud, respuesta) => {
  try {
    const [administrador] = await consultar(`SELECT 1 FROM public.usuario
      WHERE id_usuario = :id AND rol = 'administrador' AND activo AND eliminado_en IS NULL`, { id: solicitud.user.id });
    if (!administrador) throw fallo(403, 'Se requiere una cuenta de administrador activa.');
    return await accion(solicitud, respuesta);
  } catch (error) {
    if (error.status) return respuesta.status(error.status).json({ error: error.message });
    console.error('Error en notificaciones administrativas:', error.original?.code ?? error.name);
    return respuesta.status(500).json({ error: 'No se pudo procesar la notificación.' });
  }
};

const buscarDestinatarios = ruta(async (solicitud, respuesta) => {
  const busqueda = typeof solicitud.query.q === 'string' ? solicitud.query.q.trim().slice(0, 100) : '';
  if (busqueda.length < 2) return respuesta.json({ destinatarios: [] });
  const telefono = busqueda.replace(/\D/g, '');
  const destinatarios = await consultar(`SELECT * FROM (
    SELECT u.id_usuario AS id, ${nombreUsuario('u')} AS nombre, u.telefono,
      CASE WHEN u.rol = 'administrador' THEN 'Administrador'
        WHEN c.id_conductor IS NOT NULL THEN 'Conductor' ELSE 'Pasajero' END AS perfil
    ${usuariosActivos}
  ) activos WHERE STRPOS(LOWER(nombre), LOWER(:busqueda)) > 0
    OR (:telefono <> '' AND STRPOS(REGEXP_REPLACE(COALESCE(telefono, ''), '[^0-9]', '', 'g'), :telefono) > 0)
  ORDER BY nombre, id LIMIT 20`, { busqueda, telefono });
  return respuesta.json({ destinatarios });
});

function validarMensaje(body) {
  const { alcance, destinatarioId = null } = body ?? {};
  const titulo = typeof body?.titulo === 'string' ? body.titulo.trim() : '';
  const mensaje = typeof body?.mensaje === 'string' ? body.mensaje.trim() : '';
  if (!alcances.includes(alcance) ||
      (alcance === 'individual' ? !esUuid(destinatarioId) : destinatarioId !== null)) {
    throw fallo(400, 'Selecciona un destinatario válido.');
  }
  if (!titulo || titulo.length > 100 || !mensaje || mensaje.length > 1000) {
    throw fallo(400, 'Escribe un título de hasta 100 caracteres y un mensaje de hasta 1000.');
  }
  if (/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u20e3]/u.test(titulo + mensaje)) {
    throw fallo(400, 'Escribe la notificación sin emojis.');
  }
  return { alcance, destinatarioId, titulo, mensaje };
}

const seleccionarDestinatarios = ({ alcance, destinatarioId }, transaction) =>
  consultar(`SELECT u.id_usuario AS id ${usuariosActivos}
    AND ((:alcance = 'individual' AND u.id_usuario = :destinatarioId)
      OR (:alcance = 'conductores' AND c.id_conductor IS NOT NULL)
      OR (:alcance = 'pasajeros' AND u.rol <> 'administrador'))
    ORDER BY u.id_usuario`, { alcance, destinatarioId }, transaction);

const firmaDestinatarios = destinatarios => createHash('sha256')
  .update(destinatarios.map(({ id }) => id).join(',')).digest('hex');

const vistaPrevia = ruta(async (solicitud, respuesta) => {
  const mensaje = validarMensaje(solicitud.body);
  const destinatarios = await seleccionarDestinatarios(mensaje);
  if (!destinatarios.length) throw fallo(422, 'No hay usuarios activos en esa selección.');
  const token = jwt.sign({
    ...mensaje, envioId: randomUUID(), firma: firmaDestinatarios(destinatarios)
  }, claveVistaPrevia, { subject: solicitud.user.id, expiresIn: '10m' });
  return respuesta.json({ token, total: destinatarios.length });
});

const enviar = ruta(async (solicitud, respuesta) => {
  let datos;
  try {
    datos = jwt.verify(solicitud.body?.token, claveVistaPrevia, {
      subject: solicitud.user.id, algorithms: ['HS256'], ignoreExpiration: true
    });
  } catch {
    throw fallo(409, 'La vista previa ya no es válida. Vuelve a prepararla.');
  }
  const { envioId, alcance, destinatarioId, titulo, mensaje, firma, exp } = datos;
  if (!alcances.includes(alcance)) throw fallo(409, 'Selecciona un destinatario y vuelve a preparar la vista previa.');
  const resultado = await db.transaction(async transaction => {
    // Serializa confirmaciones repetidas de la misma vista previa.
    await consultar('SELECT pg_advisory_xact_lock(hashtextextended(:envioId, 0))', { envioId }, transaction);
    const [existente] = await consultar(`SELECT COUNT(*)::int AS total FROM public.notificacion
      WHERE id_envio_notificacion = :envioId`, { envioId }, transaction);
    if (existente.total) return { envioId, total: existente.total, repetido: true };
    if (Date.now() >= exp * 1000) throw fallo(409, 'La vista previa venció. Vuelve a prepararla.');
    const destinatarios = await seleccionarDestinatarios(datos, transaction);
    if (firmaDestinatarios(destinatarios) !== firma) {
      throw fallo(409, 'Los destinatarios cambiaron. Revisa una nueva vista previa.');
    }
    await consultar(`INSERT INTO public.envio_notificacion
      (id_envio_notificacion, id_administrador, alcance, id_destinatario, titulo, cuerpo)
      VALUES (:envioId, :administrador, :alcance, :destinatarioId, :titulo, :mensaje)`,
    { envioId, administrador: solicitud.user.id, alcance, destinatarioId, titulo, mensaje }, transaction);
    await db.query(`INSERT INTO public.notificacion (id_usuario, titulo, cuerpo, tipo, id_envio_notificacion, estado_push)
      SELECT u.id_usuario, $titulo, $mensaje, 'sistema', $envioId::uuid,
        CASE WHEN NULLIF(u.fcm_token, '') IS NULL THEN 'omitido' ELSE 'pendiente' END
      FROM public.usuario u WHERE u.id_usuario = ANY($destinatarios::uuid[])`, {
      esquemaFisico: true, supportsSearchPath: false, transaction,
      bind: { envioId, titulo, mensaje, destinatarios: destinatarios.map(({ id }) => id) }
    });
    return { envioId, total: destinatarios.length, repetido: false };
  });
  iniciarEnviosPush();
  return respuesta.status(resultado.repetido ? 200 : 201).json(resultado);
});

const historial = ruta(async (solicitud, respuesta) => {
  const offset = Math.max(0, Number.parseInt(solicitud.query.offset, 10) || 0);
  const envios = await consultar(`SELECT e.id_envio_notificacion AS id, e.alcance, e.titulo, e.cuerpo AS mensaje,
    e.creado_en AS "creadoEn", ${nombreUsuario('a')} AS administrador,
    CASE WHEN d.id_usuario IS NOT NULL THEN ${nombreUsuario('d')} END AS destinatario,
    resumen.*
    FROM (
      SELECT * FROM public.envio_notificacion ORDER BY creado_en DESC, id_envio_notificacion DESC LIMIT 21 OFFSET :offset
    ) e
    JOIN public.usuario a ON a.id_usuario = e.id_administrador
    LEFT JOIN public.usuario d ON d.id_usuario = e.id_destinatario
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE estado_push = 'aceptado')::int AS aceptados,
        COUNT(*) FILTER (WHERE estado_push = 'fallido')::int AS fallidos,
        COUNT(*) FILTER (WHERE estado_push = 'pendiente')::int AS pendientes,
        COUNT(*) FILTER (WHERE estado_push = 'omitido')::int AS omitidos,
        COUNT(*) FILTER (WHERE estado_push = 'sin_confirmar')::int AS "sinConfirmar"
      FROM public.notificacion n WHERE n.id_envio_notificacion = e.id_envio_notificacion
    ) resumen
    ORDER BY e.creado_en DESC, e.id_envio_notificacion DESC`, { offset });
  return respuesta.json({ envios: envios.slice(0, 20), hayMas: envios.length > 20 });
});

async function procesarLotePush() {
  // Una vez reclamado el aviso, una interrupción no debe provocar un segundo push.
  const lote = await consultar(`WITH lote AS (
    SELECT id_notificacion FROM public.notificacion
    WHERE estado_push = 'pendiente' ORDER BY creado_en, id_notificacion LIMIT 10 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notificacion n SET estado_push = 'sin_confirmar'
  FROM lote, public.usuario u WHERE n.id_notificacion = lote.id_notificacion AND u.id_usuario = n.id_usuario
  RETURNING n.id_notificacion AS id, n.titulo, n.cuerpo,
    CASE WHEN u.activo AND u.eliminado_en IS NULL THEN NULLIF(u.fcm_token, '') END AS token`);
  await Promise.all(lote.map(async aviso => {
    let estado = 'omitido';
    if (aviso.token) {
      const aceptado = await notificaciones.enviarPush(aviso.token, aviso.titulo, aviso.cuerpo, {
        notificacion_id: aviso.id, action: 'notificacion_administrativa'
      });
      estado = aceptado ? 'aceptado' : 'fallido';
    }
    await consultar('UPDATE public.notificacion SET estado_push = :estado WHERE id_notificacion = :id',
    { id: aviso.id, estado });
  }));
  return lote.length > 0;
}

let procesando = false;
let solicitado = false;
function iniciarEnviosPush() {
  solicitado = true;
  if (procesando) return;
  procesando = true;
  void (async () => {
    do {
      solicitado = false;
      while (await procesarLotePush()) { /* Continúa con el siguiente lote. */ }
    } while (solicitado);
  })().catch(error => console.error('No se pudieron procesar los avisos push:', error.original?.code ?? error.name))
    .finally(() => {
      procesando = false;
      if (solicitado) iniciarEnviosPush();
    });
}

module.exports = { buscarDestinatarios, vistaPrevia, enviar, historial, iniciarEnviosPush };
