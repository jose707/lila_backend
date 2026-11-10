'use strict';

const db = require('../config/baseDatos');
const { avisarCentral, enviarSmsPendientes } = require('../services/avisosEmergencia');
const esUuid = id => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);

async function registrarEmergenciaViaje(solicitud, respuesta) {
  const { rideId: idViaje } = solicitud.params;
  const idUsuario = solicitud.user.id;
  const { latitud = null, longitud = null } = solicitud.body ?? {};
  const sinUbicacion = latitud === null && longitud === null;
  if (!sinUbicacion && (!Number.isFinite(latitud) || !Number.isFinite(longitud) ||
    Math.abs(latitud) > 90 || Math.abs(longitud) > 180)) {
    return respuesta.status(400).json({ error: 'Las coordenadas de la alerta no son válidas.' });
  }
  if (!esUuid(idViaje)) {
    return respuesta.status(400).json({ error: 'El identificador del viaje no es válido.' });
  }

  try {
    const resultado = await db.transaction(async transaction => {
      const consultar = (sql, replacements) => db.query(sql, { transaction, replacements, esquemaFisico: true });
      const [[viaje]] = await consultar(`SELECT v.estado FROM public.viaje v
        WHERE v.id_viaje = :idViaje AND v.eliminado_en IS NULL
        AND (v.id_pasajero = :idUsuario OR EXISTS (
          SELECT 1 FROM public.conductor c WHERE c.id_conductor = v.id_conductor
          AND c.id_usuario = :idUsuario AND c.eliminado_en IS NULL
        )) FOR UPDATE OF v`, { idViaje, idUsuario });
      if (!viaje) return { codigo: 404, datos: { error: 'Viaje no encontrado.' } };
      if (viaje.estado !== 'en_curso') return { codigo: 409, datos: { error: 'La alerta solo se puede activar durante un viaje en curso.' } };

      const [[existente]] = await consultar(`SELECT id_alerta_emergencia AS "idAlerta"
        FROM public.alerta_emergencia WHERE id_viaje = :idViaje AND id_usuario = :idUsuario
        AND estado = 'activo' ORDER BY activada_en DESC LIMIT 1`, { idViaje, idUsuario });
      if (existente) return { codigo: 200, datos: existente };

      const [[alerta]] = await consultar(`INSERT INTO public.alerta_emergencia (id_viaje, id_usuario, ubicacion)
        VALUES (:idViaje, :idUsuario, ST_SetSRID(ST_MakePoint(:longitud, :latitud), 4326))
        RETURNING id_alerta_emergencia AS "idAlerta"`, { idViaje, idUsuario, longitud, latitud });
      const enlace = sinUbicacion ? '' : ` Ubicación: https://maps.google.com/?q=${latitud},${longitud}`;
      const cuerpo = `Línea Lila: tu contacto activó una alerta de emergencia durante un viaje.${enlace}`;
      const [sms] = await consultar(`INSERT INTO public.registro_sms_emergencia (id_alerta, id_contacto, telefono_destino, cuerpo_mensaje)
        SELECT :idAlerta, id_contacto_emergencia, telefono, :cuerpo FROM public.contacto_emergencia
        WHERE id_usuario = :idUsuario AND activo ORDER BY creado_en LIMIT 5
        RETURNING id_registro_sms_emergencia AS id, telefono_destino AS telefono, cuerpo_mensaje AS cuerpo`,
      { idAlerta: alerta.idAlerta, idUsuario, cuerpo });
      return { codigo: 201, datos: alerta, sms };
    });
    if (!resultado.datos.idAlerta) return respuesta.status(resultado.codigo).json(resultado.datos);
    const { idAlerta } = resultado.datos;
    if (resultado.codigo === 201) {
      void avisarCentral(idAlerta, idViaje).catch(error => console.error('Error al avisar a la central:', error.original?.code ?? error.name));
      await enviarSmsPendientes(resultado.sms);
    }
    const [[contactos]] = await db.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE estado = 'enviado')::int AS aceptados,
      COUNT(*) FILTER (WHERE estado = 'fallido')::int AS fallidos
      FROM public.registro_sms_emergencia WHERE id_alerta = :idAlerta`, {
      esquemaFisico: true, replacements: { idAlerta }
    });
    return respuesta.status(resultado.codigo).json({ idAlerta, registradaEnCentral: true, contactos });
  } catch (error) {
    console.error('Error al registrar la alerta de emergencia:', error.original?.code ?? error.name);
    return respuesta.status(500).json({ error: 'No se pudo registrar la alerta. Intenta nuevamente.' });
  }
}

async function listarEmergencias(solicitud, respuesta) {
  try {
    const [alertas] = await db.query(`SELECT a.id_alerta_emergencia AS "idAlerta", a.id_viaje AS "idViaje",
      a.activada_en AS "activadaEn", ST_Y(a.ubicacion) AS latitud, ST_X(a.ubicacion) AS longitud,
      NULLIF(CONCAT_WS(' ', i.nombres, i.apellido_paterno, i.apellido_materno), '') AS nombre, u.telefono,
      CASE WHEN v.id_pasajero = a.id_usuario THEN 'pasajero'
        WHEN c.id_usuario = a.id_usuario THEN 'conductor' END AS participante,
      a.direccion_ubicacion AS "direccionAlerta", a.notas,
      v.estado AS "estadoViaje", v.direccion_recogida AS recogida, v.direccion_destino AS destino,
      v.iniciado_en AS "viajeIniciadoEn",
      NULLIF(TRIM(CONCAT_WS(' ', ip.nombres, ip.apellido_paterno, ip.apellido_materno)), '') AS "nombrePasajero",
      p.telefono AS "telefonoPasajero",
      NULLIF(TRIM(CONCAT_WS(' ', ic.nombres, ic.apellido_paterno, ic.apellido_materno)), '') AS "nombreConductor",
      cu.telefono AS "telefonoConductor",
      vehiculo.datos AS "vehiculoRegistrado",
      contactos.pasajero AS "contactosPasajero", contactos.conductor AS "contactosConductor",
      sms.total AS "smsTotal", sms.enviados AS "smsEnviados", sms.fallidos AS "smsFallidos",
      sms.total - sms.enviados - sms.fallidos AS "smsPendientes"
      FROM public.alerta_emergencia a JOIN public.usuario u ON u.id_usuario = a.id_usuario
      LEFT JOIN (SELECT ci.*, ud.id_usuario FROM public.documento_ci ci JOIN public.usuario_documento ud ON ud.id_documento=ci.id_documento_ci) i ON i.id_usuario = a.id_usuario
      LEFT JOIN public.viaje v ON v.id_viaje = a.id_viaje
      LEFT JOIN public.usuario p ON p.id_usuario = v.id_pasajero
      LEFT JOIN (SELECT ci.*, ud.id_usuario FROM public.documento_ci ci JOIN public.usuario_documento ud ON ud.id_documento=ci.id_documento_ci) ip ON ip.id_usuario = p.id_usuario
      LEFT JOIN public.conductor c ON c.id_conductor = v.id_conductor
      LEFT JOIN public.usuario cu ON cu.id_usuario = c.id_usuario
      LEFT JOIN (SELECT ci.*, ud.id_usuario FROM public.documento_ci ci JOIN public.usuario_documento ud ON ud.id_documento=ci.id_documento_ci) ic ON ic.id_usuario = cu.id_usuario
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(jsonb_agg(datos ORDER BY creado_en, id_contacto_emergencia)
            FILTER (WHERE id_usuario = p.id_usuario), '[]'::jsonb) AS pasajero,
          COALESCE(jsonb_agg(datos ORDER BY creado_en, id_contacto_emergencia)
            FILTER (WHERE id_usuario = cu.id_usuario), '[]'::jsonb) AS conductor
        FROM (
          SELECT id_usuario, id_contacto_emergencia, creado_en,
            jsonb_build_object('id', id_contacto_emergencia, 'nombre', nombre, 'telefono', telefono, 'relacion', relacion) AS datos
          FROM public.contacto_emergencia
          WHERE activo AND id_usuario IN (p.id_usuario, cu.id_usuario)
        ) activos
      ) contactos ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object('placa', placa, 'marca', marca, 'modelo', modelo, 'color', color) AS datos
        FROM (
          SELECT placa, marca, modelo, color, COUNT(*) OVER () AS cantidad
          FROM compatibilidad.vehiculo
          WHERE conductor_id = c.id_conductor AND estado = 'activo' AND eliminado_en IS NULL
        ) registrados WHERE cantidad = 1
      ) vehiculo ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE estado = 'enviado')::int AS enviados,
          COUNT(*) FILTER (WHERE estado = 'fallido')::int AS fallidos
        FROM public.registro_sms_emergencia WHERE id_alerta = a.id_alerta_emergencia
      ) sms ON true
      WHERE a.estado = 'activo' ORDER BY a.activada_en DESC LIMIT 50`, { esquemaFisico: true });
    return respuesta.json({ alertas });
  } catch (error) {
    console.error('Error al consultar alertas:', error.original?.code ?? error.name);
    return respuesta.status(500).json({ error: 'No se pudieron consultar las alertas.' });
  }
}

async function obtenerDireccionEmergencia(solicitud, respuesta) {
  const { id } = solicitud.params;
  if (!esUuid(id)) return respuesta.status(400).json({ error: 'La alerta no es válida.' });
  const clave = process.env.GOOGLE_MAPS_API_KEY;
  if (!clave) return respuesta.json({ direccion: null });

  try {
    const [[ubicacion]] = await db.query(`SELECT ST_Y(ubicacion) AS latitud, ST_X(ubicacion) AS longitud
      FROM public.alerta_emergencia WHERE id_alerta_emergencia = :id AND estado = 'activo' AND ubicacion IS NOT NULL`, {
      esquemaFisico: true, replacements: { id }
    });
    if (!ubicacion) return respuesta.json({ direccion: null });

    const parametros = new URLSearchParams({
      latlng: `${ubicacion.latitud},${ubicacion.longitud}`, language: 'es', key: clave
    });
    const resultado = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${parametros}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!resultado.ok) return respuesta.json({ direccion: null });
    const datos = await resultado.json();
    const direccion = datos.status === 'OK' ? datos.results?.[0]?.formatted_address : null;
    return respuesta.json({ direccion: typeof direccion === 'string' ? direccion : null });
  } catch {
    return respuesta.json({ direccion: null });
  }
}

async function resolverEmergencia(solicitud, respuesta) {
  const { id } = solicitud.params;
  if (!esUuid(id)) return respuesta.status(400).json({ error: 'La alerta no es válida.' });
  try {
    const [[alerta]] = await db.query(`UPDATE public.alerta_emergencia SET estado = 'resuelto',
      resuelta_en = NOW(), actualizado_en = NOW(), id_usuario_resolutor = :usuario
      WHERE id_alerta_emergencia = :id AND estado = 'activo' RETURNING id_alerta_emergencia`, {
      esquemaFisico: true, replacements: { id, usuario: solicitud.user.id }
    });
    return alerta ? respuesta.json({ resuelta: true }) : respuesta.status(404).json({ error: 'La alerta ya no está activa.' });
  } catch (error) {
    console.error('Error al resolver la alerta:', error.original?.code ?? error.name);
    return respuesta.status(500).json({ error: 'No se pudo resolver la alerta.' });
  }
}

module.exports = { registrarEmergenciaViaje, listarEmergencias, resolverEmergencia, obtenerDireccionEmergencia };
