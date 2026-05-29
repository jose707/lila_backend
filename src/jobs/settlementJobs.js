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

const cron    = require('node-cron');
const { sequelize } = require('../models');

// ─── FUNCIONES DE NEGOCIO ─────────────────────────────────────────────────

/**
 * Marca como OVERDUE todos los settlements cuyo due_date ya pasó.
 * Llama a la función PostgreSQL mark_overdue_settlements().
 *
 * Caso de uso manual: Admin detecta conductores morosos y quiere
 * actualizar sus estados antes de una revisión.
 *
 * @returns {number} Cantidad de settlements marcados como overdue
 */
const runMarkOverdueSettlements = async () => {
  console.log('[Jobs] Ejecutando mark_overdue_settlements...');
  const [[{ mark_overdue_settlements: count }]] = await sequelize.query(
    `SELECT mark_overdue_settlements()`
  );
  console.log(`[Jobs] mark_overdue_settlements: ${count} settlement(s) marcados como overdue.`);
  return count;
};

/**
 * Genera el cobro mensual para TODOS los conductores con viajes pendientes.
 * Llama a generate_monthly_settlement(driver_id, year, month) por cada conductor.
 *
 * ⚠️  COMMISSIONS_START_DATE en .env define la fecha de activación del cobro.
 *     Los earnings anteriores a esa fecha se ignoran automáticamente.
 *     Si no se define COMMISSIONS_START_DATE, no hay restricción de fecha.
 *
 * Caso de uso manual: A fin de mes el admin cierra el periodo y genera
 * todos los cobros desde el panel de admin.
 *
 * @param {number} year  - Año del periodo, ej: 2024
 * @param {number} month - Mes del periodo, ej: 3 (marzo)
 * @returns {{ driverId: string, settlementId: string|null }[]}
 */
const runGenerateMonthlySettlements = async (year, month) => {
  // ── Verificar fecha de activación ─────────────────────────────────────────
  // COMMISSIONS_START_DATE = 'YYYY-MM-DD'
  // Ejemplo: Si se activa el 2026-05-01, no generar settlements para periodos anteriores.
  const startDateEnv = process.env.COMMISSIONS_START_DATE;
  if (startDateEnv) {
    const activationDate = new Date(startDateEnv);
    const periodStart    = new Date(year, month - 1, 1); // primer día del periodo

    if (periodStart < activationDate) {
      console.warn(
        `[Jobs] ⚠️  Período ${year}/${month} es anterior a COMMISSIONS_START_DATE (${startDateEnv}). Omitiendo.`
      );
      return [];
    }
  }

  // Obtener todos los conductores con comisiones pendientes en el periodo
  // Solo incluir earnings creados a partir de COMMISSIONS_START_DATE
  const startFilter = startDateEnv ? `AND de.created_at >= '${startDateEnv}'` : '';

  const [drivers] = await sequelize.query(`
    SELECT DISTINCT driver_id
    FROM driver_earnings de
    WHERE commission_status = 'pending'
      AND settlement_id IS NULL
      AND EXTRACT(YEAR  FROM created_at) = :year
      AND EXTRACT(MONTH FROM created_at) = :month
      ${startFilter}
  `, { replacements: { year, month } });

  if (drivers.length === 0) {
    console.log(`[Jobs] generate_monthly_settlements ${year}/${month}: sin conductores con comisiones pendientes.`);
    return [];
  }

  console.log(`[Jobs] generate_monthly_settlements ${year}/${month}: procesando ${drivers.length} conductor(es)...`);
  const results = [];

  for (const { driver_id } of drivers) {
    try {
      const [[{ generate_monthly_settlement: settlementId }]] = await sequelize.query(
        `SELECT generate_monthly_settlement(:driverId, :year, :month)`,
        { replacements: { driverId: driver_id, year, month } }
      );
      results.push({ driverId: driver_id, settlementId });
      console.log(`  ✅ Driver ${driver_id} → settlement ${settlementId}`);
    } catch (err) {
      console.error(`  ❌ Driver ${driver_id}: ${err.message}`);
      results.push({ driverId: driver_id, settlementId: null, error: err.message });
    }
  }

  return results;
};

// ─── SCHEDULE AUTOMÁTICO ──────────────────────────────────────────────────
/**
 * Activa los cron jobs automáticos.
 * Solo llamar cuando ENABLE_CRON_JOBS=true en .env
 * (Recomendado: cuando la plataforma supere los 50 conductores activos)
 */
const startCronJobs = () => {
  if (process.env.ENABLE_CRON_JOBS !== 'true') {
    console.log('[Jobs] Cron jobs automáticos DESACTIVADOS. (ENABLE_CRON_JOBS != true)');
    console.log('[Jobs] Actívalos en .env cuando la plataforma supere 50 conductores.');
    return;
  }

  // ── Diario a las 02:00 AM: marcar vencidos ──────────────────────────────
  // "0 2 * * *" = todos los días a las 02:00
  cron.schedule('0 2 * * *', async () => {
    try {
      await runMarkOverdueSettlements();
    } catch (err) {
      console.error('[Jobs] Error en mark_overdue_settlements:', err.message);
    }
  });

  // ── Último día del mes a las 23:00: generar cobros mensuales ───────────
  // "0 23 28-31 * *" = días 28-31, se verifica con getDate() si es el último
  cron.schedule('0 23 28-31 * *', async () => {
    const now      = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Solo ejecutar si mañana es el primer día del próximo mes (= hoy es el último día del mes)
    if (tomorrow.getDate() !== 1) return;

    try {
      await runGenerateMonthlySettlements(now.getFullYear(), now.getMonth() + 1);
    } catch (err) {
      console.error('[Jobs] Error en generate_monthly_settlements:', err.message);
    }
  });

  console.log('[Jobs] ✅ Cron jobs automáticos activados.');
};

module.exports = {
  startCronJobs,
  runMarkOverdueSettlements,
  runGenerateMonthlySettlements,
};
