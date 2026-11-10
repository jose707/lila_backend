'use strict';

const { Op } = require('sequelize');
const { sequelize, Conductor, CobrosConductor, ComisionLiquidacion } = require('../models');
const { fechaBolivia, plazoLiquidacion } = require('../jobs/liquidacionJobs');

function permiteCierreSimulado() {
  return process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(sequelize.config.host);
}

async function generarCierreSimulado(solicitud, respuesta) {
  if (!permiteCierreSimulado()) return respuesta.status(403).json({ error: 'El cierre simulado solo está disponible en desarrollo local.' });
  const periodo = typeof solicitud.body?.periodo === 'string' ? solicitud.body.periodo : '';
  if (periodo !== fechaBolivia().slice(0, 7)) return respuesta.status(400).json({ error: 'Selecciona el mes en curso para simular su cierre.' });
  const [anio, mes] = periodo.split('-').map(Number);
  const inicio = `${periodo}-01`;
  const fin = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  const { inicioPago, vence } = plazoLiquidacion(anio, mes);

  try {
    const resultado = await sequelize.transaction(async transaction => {
      const conductores = await Conductor.findAll({
        where: { status: { [Op.in]: ['aprobado', 'suspendido'] } }, attributes: ['id'],
        order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE
      });
      const ids = conductores.map(conductor => conductor.id);
      const previas = await ComisionLiquidacion.findAll({
        where: { driver_id: { [Op.in]: ids }, period_start: inicio }, attributes: ['driver_id'], transaction
      });
      const cubiertos = new Set(previas.map(fila => fila.driver_id));
      const pendientes = ids.filter(id => !cubiertos.has(id));
      const ganancias = await CobrosConductor.findAll({
        where: {
          driver_id: { [Op.in]: pendientes }, settlement_id: null, commission_status: 'pendiente',
          created_at: { [Op.gte]: new Date(`${inicio}T00:00:00-04:00`), [Op.lt]: new Date(`${inicioPago}T00:00:00-04:00`) }
        }, transaction, lock: transaction.LOCK.UPDATE
      });
      const gananciasPorConductor = new Map();
      for (const ganancia of ganancias) {
        if (!gananciasPorConductor.has(ganancia.driver_id)) gananciasPorConductor.set(ganancia.driver_id, []);
        gananciasPorConductor.get(ganancia.driver_id).push(ganancia);
      }

      const conViajes = pendientes.filter(id => (gananciasPorConductor.get(id) || []).length > 0);
      for (const id of conViajes) {
        const viajes = gananciasPorConductor.get(id) || [];
        const liquidacion = await ComisionLiquidacion.create({
          driver_id: id, period_start: inicio,
          notes: 'PRUEBA LOCAL: cierre anticipado con comisiones registradas.'
        }, { transaction });
        if (viajes.length) await CobrosConductor.update({ settlement_id: liquidacion.id }, {
          where: { id: { [Op.in]: viajes.map(viaje => viaje.id) } }, transaction
        });
      }

      return { conductores: ids.length, generadas: conViajes.length, existentes: cubiertos.size };
    });
    return respuesta.json(resultado);
  } catch (error) {
    console.error('Error al simular el cierre de comisiones:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo simular el cierre del mes.' });
  }
}

module.exports = { permiteCierreSimulado, generarCierreSimulado };
