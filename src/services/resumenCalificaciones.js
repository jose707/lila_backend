const sequelize = require('../config/baseDatos');

async function obtenerResumenCalificaciones(id, rol) {
  const columna = rol === 'conductor' ? 'driver_id' : 'passenger_id';
  const calificador = rol === 'conductor' ? 'pasajero' : 'conductor';
  const [resumen] = await sequelize.query(
    `SELECT COUNT(DISTINCT v.id) FILTER (WHERE v.status = 'completado') AS total,
            COALESCE(SUM(c.rating), 0) AS suma,
            COUNT(c.rating) AS calificaciones
       FROM viaje v
       LEFT JOIN calificacion c ON c.ride_id = v.id AND c.rater_type = :calificador
       WHERE v.${columna} = :id`,
    { replacements: { id, calificador }, type: sequelize.QueryTypes.SELECT }
  );
  return {
    trips: Number(resumen.total),
    rating: Math.round((5 + Number(resumen.suma)) / (1 + Number(resumen.calificaciones)) * 10) / 10
  };
}

module.exports = { obtenerResumenCalificaciones };
