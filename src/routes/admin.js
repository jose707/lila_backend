// backend/src/routes/admin.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.get(
  '/users',
  authMiddleware,
  adminMiddleware,
  adminController.getAllUsers,
);
router.delete(
  '/users/:userId',
  authMiddleware,
  adminMiddleware,
  adminController.deleteUser,
);
router.put(
  '/users/:userId/enable',
  authMiddleware,
  adminMiddleware,
  adminController.enableUser,
);
router.get(
  '/drivers',
  authMiddleware,
  adminMiddleware,
  adminController.getAllDrivers,
);
router.get(
  '/drivers/pending',
  authMiddleware,
  adminMiddleware,
  adminController.getPendingDriverRequests,
);
router.put(
  '/drivers/:driverId/approve',
  authMiddleware,
  adminMiddleware,
  adminController.approveDriver,
);
router.put(
  '/requests/:requestId/approve',
  authMiddleware,
  adminMiddleware,
  adminController.approveDriver,
);
router.put(
  '/drivers/:driverId/reject',
  authMiddleware,
  adminMiddleware,
  adminController.rejectDriver,
);
router.put(
  '/requests/:requestId/reject',
  authMiddleware,
  adminMiddleware,
  adminController.rejectDriver,
);
router.delete(
  '/drivers/:driverId',
  authMiddleware,
  adminMiddleware,
  adminController.deleteDriver,
);
router.get(
  '/rides',
  authMiddleware,
  adminMiddleware,
  adminController.getAllRides,
);
router.get(
  '/analytics',
  authMiddleware,
  adminMiddleware,
  adminController.getAnalytics,
);
router.post(
  '/promo-codes',
  authMiddleware,
  adminMiddleware,
  adminController.createPromoCode,
);
router.get(
  '/payments',
  authMiddleware,
  adminMiddleware,
  adminController.getAllPayments,
);

// ─── ADVANCED ANALYTICS ───────────────────────────────────────────────────
router.get('/analytics/extended', authMiddleware, adminMiddleware, adminController.getAnalyticsExtended);
router.get('/analytics/rides-by-day', authMiddleware, adminMiddleware, adminController.getRidesByDay);
router.get('/analytics/revenue-by-day', authMiddleware, adminMiddleware, adminController.getRevenueByDay);
router.get('/analytics/segmentation', authMiddleware, adminMiddleware, adminController.getUserSegmentation);
router.get('/analytics/funnel', authMiddleware, adminMiddleware, adminController.getRideFunnel);
router.get('/analytics/unit-economics', authMiddleware, adminMiddleware, adminController.getUnitEconomics);
router.get('/analytics/top-routes', authMiddleware, adminMiddleware, adminController.getTopRoutes);

// ─── SETTLEMENTS (cobro mensual de comisiones) ────────────────────────────
// ⚠️  Activar cron automático (ENABLE_CRON_JOBS=true en .env) cuando la
//     plataforma supere 50 conductores activos. Hasta entonces, usar estos
//     endpoints para disparar los procesos manualmente desde el panel admin.
const {
  runMarkOverdueSettlements,
  runGenerateMonthlySettlements,
} = require('../jobs/settlementJobs');
const { sequelize } = require('../models');

// POST /admin/settlements/generate  { year, month }
router.post(
  '/settlements/generate',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    const { year, month } = req.body;
    if (!year || !month || month < 1 || month > 12) {
      return res
        .status(400)
        .json({ message: 'Se requiere year y month (1–12).' });
    }
    try {
      const results = await runGenerateMonthlySettlements(
        Number(year),
        Number(month),
      );
      const exitosos = results.filter(r => r.settlementId).length;
      const fallidos = results.filter(r => r.error).length;
      return res.json({
        message: `Cobros generados: ${exitosos} exitosos, ${fallidos} con errores.`,
        period: `${year}-${String(month).padStart(2, '0')}`,
        results,
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
);

// POST /admin/settlements/mark-overdue  (sin body)
router.post(
  '/settlements/mark-overdue',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const count = await runMarkOverdueSettlements();
      return res.json({
        message: `${count} settlement(s) marcados como overdue.`,
        count,
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
);

// GET /admin/settlements/overdue
router.get(
  '/settlements/overdue',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const [rows] = await sequelize.query(`
      SELECT d.id AS driver_id, u.name, u.phone, u.email,
             COUNT(cs.id)             AS settlements_vencidos,
             SUM(cs.total_commission) AS deuda_total,
             MIN(cs.due_date)         AS primer_vencimiento
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
  },
);

// POST /admin/settlements/:id/pay  { amount, payment_method }
router.post(
  '/settlements/:id/pay',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    const { id } = req.params;
    const { amount, payment_method } = req.body;
    if (!amount || !payment_method) {
      return res
        .status(400)
        .json({ message: 'Se requieren amount y payment_method.' });
    }
    const validMethods = ['cash', 'qr', 'transfer'];
    if (!validMethods.includes(payment_method)) {
      return res.status(400).json({
        message: `payment_method inválido. Permitidos: ${validMethods.join(
          ', ',
        )}.`,
      });
    }
    try {
      const [[{ mark_settlement_paid: ok }]] = await sequelize.query(
        `SELECT mark_settlement_paid(:id, :amount, :method)`,
        {
          replacements: { id, amount: Number(amount), method: payment_method },
        },
      );
      if (!ok)
        return res
          .status(400)
          .json({ message: 'No se pudo registrar el pago.' });
      return res.json({
        message: 'Pago registrado correctamente.',
        settlementId: id,
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
);

router.post(
  '/drivers/:driverId/require-ruat',
  authMiddleware,
  adminMiddleware,
  adminController.requireRuatVerification,
);

router.put(
  '/drivers/:driverId/suspend',
  authMiddleware,
  adminMiddleware,
  adminController.toggleSuspendDriver,
);

router.post(
  '/vehicles/:vehicleId/approve-ruat',
  authMiddleware,
  adminMiddleware,
  adminController.approveVehicleRuat,
);

router.post(
  '/vehicles/:vehicleId/reject-ruat',
  authMiddleware,
  adminMiddleware,
  adminController.rejectVehicleRuat,
);

module.exports = router;
