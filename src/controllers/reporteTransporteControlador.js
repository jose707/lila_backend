const sequelize = require('../config/baseDatos');
const { QueryTypes } = require('sequelize');

const consulta = `
WITH reloj AS (
  SELECT now() AT TIME ZONE 'America/La_Paz' AS hoy
), periodos AS (
  SELECT hoy,
    CASE :rango
      WHEN 'week' THEN date_trunc('day', hoy) - interval '6 days'
      WHEN 'year' THEN date_trunc('year', hoy)
      ELSE date_trunc('month', hoy)
    END AS inicio,
    CASE :rango
      WHEN 'week' THEN interval '7 days'
      WHEN 'year' THEN interval '1 year'
      ELSE interval '1 month'
    END AS duracion
  FROM reloj
), limites AS (
  SELECT *, inicio - duracion AS anterior,
    LEAST(inicio, inicio - duracion + (hoy - inicio)) AS fin_anterior
  FROM periodos
), viajes AS (
  SELECT v.*, v.created_at AT TIME ZONE 'America/La_Paz' AS solicitado,
    CASE WHEN v.arrived_at >= v.created_at
      THEN EXTRACT(EPOCH FROM (v.arrived_at - v.created_at)) / 60 END AS espera,
    (v.status = 'vencido' AND v.driver_id IS NULL AND v.accepted_at IS NULL) AS sin_asignar
  FROM viaje v CROSS JOIN limites l
  WHERE v.deleted_at IS NULL
    AND v.created_at >= (l.anterior AT TIME ZONE 'America/La_Paz')
    AND v.created_at <= (l.hoy AT TIME ZONE 'America/La_Paz')
), actual AS (
  SELECT v.* FROM viajes v CROSS JOIN limites l WHERE v.solicitado >= l.inicio
), grupos AS (
  SELECT 'actual' AS periodo, v.* FROM actual v
  UNION ALL
  SELECT 'anterior', v.* FROM viajes v CROSS JOIN limites l WHERE v.solicitado < l.fin_anterior
), resumen AS (
  SELECT periodo, count(*)::int AS solicitudes,
    count(*) FILTER (WHERE accepted_at IS NOT NULL OR status IN ('aceptado','llegado','en_curso','completado'))::int AS aceptados,
    count(*) FILTER (WHERE status = 'completado')::int AS completados,
    count(*) FILTER (WHERE status = 'cancelado')::int AS cancelados,
    count(*) FILTER (WHERE sin_asignar)::int AS sin_asignar,
    coalesce(sum(final_fare) FILTER (WHERE status = 'completado'), 0)::float AS ingresos,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY espera) AS espera
  FROM grupos GROUP BY periodo
), serie AS (
  SELECT date_trunc(:unidad, solicitado) AS fecha, count(*)::int AS count,
    coalesce(sum(final_fare) FILTER (WHERE status = 'completado'), 0)::float AS revenue
  FROM actual GROUP BY 1
), zonas AS (
  SELECT coalesce(z.name, 'Sin zona registrada') AS nombre, count(*)::int AS solicitudes,
    count(*) FILTER (WHERE v.sin_asignar)::int AS sin_asignar
  FROM actual v LEFT JOIN zona_servicio z ON z.id = v.service_area_id
  GROUP BY 1 ORDER BY sin_asignar DESC, solicitudes DESC, nombre LIMIT 8
), horas AS (
  SELECT extract(hour FROM solicitado)::int AS hora, count(*)::int AS solicitudes
  FROM actual GROUP BY 1
), cancelaciones AS (
  SELECT coalesce(v.cancelled_by::text, 'sin_registro') AS actor,
    CASE
      WHEN v.started_at <= v.cancelled_at THEN 'Durante el viaje'
      WHEN v.arrived_at <= v.cancelled_at THEN 'Después de la llegada'
      WHEN v.accepted_at <= v.cancelled_at THEN 'Después de la aceptación'
      WHEN v.cancelled_at IS NOT NULL AND v.accepted_at IS NULL AND v.driver_id IS NULL THEN 'Antes de la asignación'
      ELSE 'Sin etapa registrada'
    END AS etapa,
    m.description AS motivo
  FROM actual v LEFT JOIN motivo_cancelacion m ON m.id = v.cancellation_reason_id
  WHERE v.status = 'cancelado'
)
SELECT
  to_char(l.inicio, 'YYYY-MM-DD') AS inicio, to_char(l.hoy, 'YYYY-MM-DD') AS fin,
  (SELECT row_to_json(r) FROM resumen r WHERE periodo = 'actual') AS actual,
  (SELECT row_to_json(r) FROM resumen r WHERE periodo = 'anterior') AS anterior,
  ARRAY(SELECT json_build_object('day', to_char(d.fecha, 'YYYY-MM-DD'),
    'count', coalesce(s.count, 0), 'revenue', coalesce(s.revenue, 0))
    FROM generate_series(date_trunc(:unidad, l.inicio), date_trunc(:unidad, l.hoy),
      CAST(:paso AS interval)) AS d(fecha)
    LEFT JOIN serie s ON s.fecha = d.fecha ORDER BY d.fecha) AS tendencia,
  ARRAY(SELECT row_to_json(z) FROM zonas z ORDER BY z.sin_asignar DESC, z.solicitudes DESC, z.nombre) AS zonas,
  ARRAY(SELECT json_build_object('hora', h.hora, 'solicitudes', coalesce(a.solicitudes, 0))
    FROM generate_series(0, 23) AS h(hora) LEFT JOIN horas a ON a.hora = h.hora ORDER BY h.hora) AS horas,
  (SELECT count(DISTINCT driver_id)::int FROM actual WHERE status = 'completado') AS conductoras,
  (SELECT json_build_object('generada', coalesce(sum(g.commission_amount), 0)::float,
    'pendiente', coalesce(sum(g.commission_amount) FILTER (WHERE g.commission_status = 'pendiente'), 0)::float,
    'registrados', count(*)::int)
    FROM actual v JOIN cobros_conductor g ON g.ride_id = v.id WHERE v.status = 'completado') AS comisiones,
  (SELECT json_build_object('promedio', avg(c.rating)::float, 'cantidad', count(*)::int)
    FROM actual v JOIN calificacion c ON c.ride_id = v.id
    WHERE v.status = 'completado' AND c.rater_type = 'pasajero') AS calidad,
  ARRAY(SELECT json_build_object('actor', actor, 'etapa', etapa, 'cantidad', count(*)::int)
    FROM cancelaciones GROUP BY actor, etapa ORDER BY count(*) DESC, actor, etapa) AS cancelaciones,
  ARRAY(SELECT json_build_object('motivo', motivo, 'cantidad', count(*)::int)
    FROM cancelaciones WHERE motivo IS NOT NULL GROUP BY motivo ORDER BY count(*) DESC, motivo LIMIT 5) AS motivos
FROM limites l
`;

async function obtenerReporteTransporte(solicitud, respuesta) {
  const { range: rango = 'month' } = solicitud.query;
  if (!['week', 'month', 'year'].includes(rango)) {
    return respuesta.status(400).json({ error: 'Período inválido' });
  }
  try {
    const [reporte] = await sequelize.query(consulta, {
      type: QueryTypes.SELECT,
      replacements: { rango, unidad: rango === 'year' ? 'month' : 'day', paso: rango === 'year' ? '1 month' : '1 day' }
    });
    return respuesta.json(reporte);
  } catch (error) {
    console.error('Error al obtener el reporte de transporte:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo cargar el reporte de transporte' });
  }
}

module.exports = obtenerReporteTransporte;
