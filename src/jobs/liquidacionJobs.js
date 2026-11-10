'use strict';
/**
 * jobs/settlementJobs.js
 *
 * Cron jobs para el sistema de cobro mensual de comisiones.
 *
 * ─── POLÍTICA DE ACTIVACIÓN ────────────────────────────────────────────────
 *  🔴 AUTO-SCHEDULE DESACTIVADO
 *  Por decisión del equipo, los cron jobs automáticos NO se activan
 *  hasta que la plataforma supere los 50 conductores activos.
 *
 *  Mientras tanto, ambas funciones se exponen como endpoints manuales
 *  en el panel de admin y pueden ejecutarse desde allí.
 *
 *  Para activar el schedule automático en el futuro, cambiar:
 *    ENABLE_CRON_JOBS=true  en el archivo .env
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Dependencia: npm install node-cron
 */

const cron = require('node-cron');
const { sequelize, ComisionLiquidacion } = require('../models');
const zonaLiquidaciones = 'America/La_Paz';
const calendarioBolivia = new Intl.DateTimeFormat('en-CA', {
  timeZone: zonaLiquidaciones, year: 'numeric', month: '2-digit', day: '2-digit'
});

function fechaBolivia(ahora = new Date()) {
  const partes = Object.fromEntries(calendarioBolivia.formatToParts(ahora).map(({ type, value }) => [type, value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function plazoLiquidacion(anio, mes) {
  const inicioPago = new Date(Date.UTC(anio, mes, 1)).toISOString().slice(0, 10);
  return { inicioPago, vence: `${inicioPago.slice(0, 7)}-07` };
}

// ─── FUNCIONES DE NEGOCIO ─────────────────────────────────────────────────

/**
 * Consulta las comisiones atrasadas según la fecha actual de Bolivia.
 *
 * Caso de uso manual: Admin detecta conductores morosos y quiere
 * actualizar sus estados antes de una revisión.
 *
 * @returns {number} Cantidad de comisiones atrasadas
 */
// El atraso se calcula al consultar; esta operación conserva el conteo para las rutas existentes.
const marcarLiquidacionesVencidas = async () => ComisionLiquidacion.count({where:{status:'atrasado'}});

/**
 * Genera el cobro mensual para TODOS los conductores con viajes pendientes.
 * Llama a generate_monthly_settlement(driver_id, year, month) por cada conductor.
 *
 * ⚠️  COMMISSIONS_START_DATE en .env define la fecha de activación del cobro.
 *     Los earnings anteriores a esa fecha se ignoran automáticamente.
 *     Si no se define COMMISSIONS_START_DATE, no hay restricción de fecha.
 *
 * Caso de uso manual: A partir del día 1 del mes siguiente el admin genera
 * todos los cobros desde el panel de admin.
 *
 * @param {number} year  - Año del periodo, ej: 2024
 * @param {number} month - Mes del periodo, ej: 3 (marzo)
 * @returns {{ driverId: string, settlementId: string|null }[]}
 */
const generarLiquidacionesMensuales = async (anio, mes) => {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 9999 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw Object.assign(new Error('Indica un año y mes válidos.'), { status: 400 });
  }
  const { inicioPago, vence } = plazoLiquidacion(anio, mes);
  if (fechaBolivia() < inicioPago) {
    throw Object.assign(new Error('La liquidación se puede generar desde el día 1 del mes siguiente.'), { status: 409 });
  }
  const periodo = new Date(Date.UTC(anio, mes - 1, 1)).toISOString().slice(0, 10);
  // ── Verificar fecha de activación ─────────────────────────────────────────
  // COMMISSIONS_START_DATE = 'YYYY-MM-DD'
  // Ejemplo: Si se activa el 2026-05-01, no generar settlements para periodos anteriores.
  const inicioFechaEnv = process.env.COMMISSIONS_START_DATE;
  if (inicioFechaEnv) {
    const activationFecha = new Date(inicioFechaEnv);
    const periodoInicio = new Date(anio, mes - 1, 1); // primer día del periodo

    if (periodoInicio < activationFecha) {
      console.warn(
        `[Jobs] ⚠️  Período ${anio}/${mes} es anterior a COMMISSIONS_START_DATE (${inicioFechaEnv}). Omitiendo.`
      );
      return [];
    }
  }

  // Obtener todos los conductores con comisiones pendientes en el periodo
  // Solo incluir earnings creados a partir de COMMISSIONS_START_DATE
  const inicioFiltro = inicioFechaEnv ? 'AND de.created_at >= :inicioFechaEnv' : '';

  const [conductores] = await sequelize.query(`
    SELECT DISTINCT driver_id
    FROM cobros_conductor de
    WHERE commission_status = 'pendiente'
      AND settlement_id IS NULL
      AND created_at >= (CAST(:periodo AS timestamp) AT TIME ZONE 'America/La_Paz')
      AND created_at < (CAST(:inicioPago AS timestamp) AT TIME ZONE 'America/La_Paz')
      ${inicioFiltro}
  `, { replacements: { periodo, inicioPago, inicioFechaEnv } });

  if (conductores.length === 0) {
    console.log(`[Jobs] generate_monthly_settlements ${anio}/${mes}: sin conductores con comisiones pendientes.`);
    return [];
  }

  console.log(`[Jobs] generate_monthly_settlements ${anio}/${mes}: procesando ${conductores.length} conductor(es)...`);
  const resultados = [];

  for (const { driver_id: conductor_Id } of conductores) {
    try {
      const liquidacionId = await sequelize.transaction(async transaction => {
        await sequelize.query("SET LOCAL TIME ZONE 'America/La_Paz'", { transaction });
        const [[{ generate_monthly_settlement: id }]] = await sequelize.query(
          'SELECT generate_monthly_settlement(:driverId, :year, :month)',
          { replacements: { driverId: conductor_Id, year: anio, month: mes }, transaction }
        );
        return id;
      });
      resultados.push({ driverId: conductor_Id, settlementId: liquidacionId });
      console.log(`  ✅ Driver ${conductor_Id} → settlement ${liquidacionId}`);
    } catch (error) {
      console.error(`  ❌ Driver ${conductor_Id}: ${error.message}`);
      resultados.push({ driverId: conductor_Id, settlementId: null, error: error.message });
    }
  }

  return resultados;
};

// ─── SCHEDULE AUTOMÁTICO ──────────────────────────────────────────────────
/**
 * Activa los cron jobs automáticos.
 * Solo llamar cuando ENABLE_CRON_JOBS=true en .env
 * (Recomendado: cuando la plataforma supere los 50 conductores activos)
 */
const inicioCronJobs = () => {
  if (process.env.ENABLE_CRON_JOBS !== 'true') {
    console.log('[Jobs] Cron jobs automáticos DESACTIVADOS. (ENABLE_CRON_JOBS != true)');
    console.log('[Jobs] Actívalos en .env cuando la plataforma supere 50 conductores.');
    return;
  }

  cron.schedule('0 0 * * *', async () => {
    try {
      await marcarLiquidacionesVencidas();
    } catch (error) {
      console.error('[Jobs] Error al marcar vencimientos:', error.message);
    }
  }, { timezone: zonaLiquidaciones });

  // El día 1 se liquida el mes anterior, ya cerrado en Bolivia.
  cron.schedule('5 0 1 * *', async () => {
    const [anio, mes] = fechaBolivia().split('-').map(Number);
    const anterior = new Date(Date.UTC(anio, mes - 2, 1));
    try {
      await generarLiquidacionesMensuales(anterior.getUTCFullYear(), anterior.getUTCMonth() + 1);
    } catch (error) {
      console.error('[Jobs] Error al generar liquidaciones:', error.message);
    }
  }, { timezone: zonaLiquidaciones });

  console.log('[Jobs] ✅ Cron jobs automáticos activados.');
};

module.exports = {
  fechaBolivia,
  plazoLiquidacion,
  iniciarCronJobs: inicioCronJobs,
  marcarLiquidacionesVencidas: marcarLiquidacionesVencidas,
  generarLiquidacionesMensuales: generarLiquidacionesMensuales
};
