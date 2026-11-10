'use strict';

const { sequelize, Usuario, Conductor, ComisionLiquidacion } = require('../models');
const { fechaBolivia, plazoLiquidacion } = require('../jobs/liquidacionJobs');
const { Op } = require('sequelize');

async function crearLiquidacionPrueba() {
  const correo = process.argv[2]?.trim();
  if (!correo || !process.argv.includes('--cuenta-de-prueba')) {
    throw new Error('Uso: node src/scripts/crearLiquidacionPrueba.js correo-de-prueba [AAAA-MM] --cuenta-de-prueba');
  }
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(sequelize.config.host)) {
    throw new Error('Este comando solo está disponible en una base de desarrollo local.');
  }

  const mesActual = fechaBolivia().slice(0, 7);
  const mesElegido = process.argv.slice(3).find(argumento => argumento !== '--cuenta-de-prueba') || mesActual;
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(mesElegido) || mesElegido > mesActual) {
    throw new Error('Indica el mes actual o uno anterior en formato AAAA-MM.');
  }
  const [anio, mes] = mesElegido.split('-').map(Number);
  const periodo = `${mesElegido}-01`;
  const fin = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  const { vence } = plazoLiquidacion(anio, mes);

  const liquidacion = await sequelize.transaction(async transaction => {
    const usuario = await Usuario.findOne({ where: { email: correo, isActive: true }, attributes: ['id'], transaction });
    if (!usuario) throw new Error('No se encontró una cuenta activa con ese correo.');
    const conductor = await Conductor.findOne({
      where: { userId: usuario.id, status: { [Op.in]: ['aprobado', 'suspendido'] } }, transaction, lock: transaction.LOCK.UPDATE
    });
    if (!conductor) throw new Error('La cuenta debe tener un registro de conductor aprobado o suspendido.');
    const existente = await ComisionLiquidacion.findOne({ where: { driver_id: conductor.id, period_start: periodo }, transaction });
    if (existente) throw new Error(`La cuenta ya tiene una liquidación de ${periodo.slice(0, 7)}. Usa esa liquidación o una cuenta de prueba distinta.`);

    return ComisionLiquidacion.create({
      driver_id: conductor.id, period_start: periodo, period_end: fin, total_rides: 0,
      gross_amount: 0, total_commission: 25, status: 'pendiente_pago', due_date: vence,
      notes: 'PRUEBA LOCAL: importe simulado sin viajes asociados.'
    }, { transaction });
  });

  console.log(`Liquidación de prueba ${liquidacion.id} · ${periodo.slice(0, 7)} · Bs 25,00.`);
}

crearLiquidacionPrueba()
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
