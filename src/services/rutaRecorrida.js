const sequelize = require('../config/baseDatos');

// La actualización atómica evita perder puntos cuando llegan solicitudes simultáneas.
async function registrarPunto(viajeId, conductorId, latitud, longitud) {
  await sequelize.query(`
    UPDATE viaje
    SET ruta_recorrida = CASE
      WHEN ruta_recorrida IS NULL THEN ST_MakeLine(
        ST_SetSRID(ST_MakePoint(:longitud, :latitud), 4326),
        ST_SetSRID(ST_MakePoint(:longitud, :latitud), 4326)
      )
      ELSE ST_AddPoint(ruta_recorrida, ST_SetSRID(ST_MakePoint(:longitud, :latitud), 4326))
    END
    WHERE id = :viajeId AND driver_id = :conductorId
      AND status = 'en_curso' AND deleted_at IS NULL
  `, {
    replacements: {
      viajeId, conductorId, latitud, longitud
    }
  });
  // Solo la próxima parada pendiente: la proximidad a una parada posterior
  // no debe saltarse el orden del viaje. Se comparte entre socket y Android.
  await sequelize.query(`
    UPDATE parada_viaje SET arrived_at = NOW()
    WHERE id = (
      SELECT p.id FROM parada_viaje p JOIN viaje v ON v.id = p.ride_id
      WHERE p.ride_id = :viajeId AND v.driver_id = :conductorId
        AND v.status = 'en_curso' AND v.deleted_at IS NULL
        AND p.arrived_at IS NULL AND p.departed_at IS NULL
      ORDER BY p.sequence LIMIT 1
    ) AND arrived_at IS NULL
      AND ST_DWithin(location::geography,
        ST_SetSRID(ST_MakePoint(:longitud, :latitud), 4326)::geography, 40)
  `, { replacements: { viajeId, conductorId, latitud, longitud } });
}

module.exports = { registrarPunto };
