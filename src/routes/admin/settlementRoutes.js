'use strict';
/**
 * routes/admin/settlementRoutes.js
 *
 * Endpoints para gestión manual de settlements.
 *
 * ─── NOTA DE ACTIVACIÓN ───────────────────────────────────────────────────
 *  Estas rutas son el mecanismo principal de control mientras la plataforma
 *  tenga menos de 50 conductores activos. El admin ejecuta los procesos
 *  manualmente desde aquí en lugar de depender de cron automáticos.
 *
 *  Cuando se superen 50 conductores, activar en .env:
 *    ENABLE_CRON_JOBS=true
 *  y mantener estas rutas como trigger de emergencia/reproceso.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Rutas disponibles:
 *
 *  POST /admin/settlements/generate
 *       Body: { year: 2024, month: 3 }
 *       Genera el cobro mensual para todos los conductores con
 *       comisiones pendientes en el periodo indicado.
 *
 *  POST /admin/settlements/mark-overdue
 *       Sin body. Marca como 'overdue' todos los settlements
 *       cuyo due_date ya pasó.
 *
 *  GET  /admin/settlements/overdue
 *       Lista todos los conductores con deuda vencida.
 *
 *  POST /admin/settlements/:id/pay
 *       Body: { amount, payment_method }
 *       Registra el pago de un settlement.
 */

const router  = require('express').Router();
const { sequelize } = require('../../models');
const {
  runMarkOverdueSettlements,
  runGenerateMonthlySettlements,
} = require('../../jobs/settlementJobs');

// ─── Middleware: solo admin ───────────────────────────────────────────────
const isAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Acceso restringido a administradores.' });
  }
  next();
};

router.use(isAdmin);

// ─── POST /admin/settlements/generate ────────────────────────────────────
/**
 * Genera cobros mensuales manualmente.
 * Usar al cierre de cada mes hasta que existan más de 50 conductores
 * y se active el cron automático.
 */
router.post('/generate', async (req, res) => {
  const { year, month } = req.body;

  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({
      message: 'Parámetros inválidos. Se requiere year (número) y month (1–12).',
    });
  }

  try {
    const results = await runGenerateMonthlySettlements(Number(year), Number(month));
    const exitosos  = results.filter(r => r.settlementId).length;
    const fallidos  = results.filter(r => r.error).length;

    return res.json({
      message: `Cobros generados: ${exitosos} exitosos, ${fallidos} con errores.`,
      period:  `${year}-${String(month).padStart(2, '0')}`,
      results,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─── POST /admin/settlements/mark-overdue ────────────────────────────────
/**
 * Marca settlements vencidos manualmente.
 * Ejecutar antes de revisar la lista de morosos.
 */
router.post('/mark-overdue', async (req, res) => {
  try {
    const count = await runMarkOverdueSettlements();
    return res.json({
      message: `${count} settlement(s) marcados como overdue.`,
      count,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─── GET /admin/settlements/overdue ──────────────────────────────────────
/**
 * Lista conductores con deuda vencida, ordenados por deuda total descendente.
 */
router.get('/overdue', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        d.id                           AS driver_id,
        u.name,
        u.phone,
        u.email,
        COUNT(cs.id)                   AS settlements_vencidos,
        SUM(cs.total_commission)       AS deuda_total,
        MIN(cs.due_date)               AS primer_vencimiento
      FROM commission_settlements cs
      JOIN drivers d ON d.id = cs.driver_id
      JOIN users   u ON u.id = d."userId"
      WHERE cs.status = 'overdue'
      GROUP BY d.id, u.name, u.phone, u.email
      ORDER BY deuda_total DESC;
    `);

    return res.json({ total: rows.length, conductores: rows });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─── POST /admin/settlements/:id/pay ─────────────────────────────────────
/**
 * Registra el pago de un settlement específico.
 * Body: { amount: number, payment_method: 'cash'|'qr'|'transfer' }
 */
router.post('/:id/pay', async (req, res) => {
  const { id }             = req.params;
  const { amount, payment_method } = req.body;

  if (!amount || !payment_method) {
    return res.status(400).json({
      message: 'Se requieren amount y payment_method (cash | qr | transfer).',
    });
  }

  const validMethods = ['cash', 'qr', 'transfer'];
  if (!validMethods.includes(payment_method)) {
    return res.status(400).json({
      message: `payment_method inválido. Valores permitidos: ${validMethods.join(', ')}.`,
    });
  }

  try {
    const [[{ mark_settlement_paid: ok }]] = await sequelize.query(
      `SELECT mark_settlement_paid(:id, :amount, :method)`,
      { replacements: { id, amount: Number(amount), method: payment_method } }
    );

    if (!ok) {
      return res.status(400).json({ message: 'No se pudo registrar el pago.' });
    }

    return res.json({ message: 'Pago registrado correctamente.', settlementId: id });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
