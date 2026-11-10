'use strict';
/**
 * routes/administracion/liquidacionRutas.js
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
 *  POST /administracion/liquidaciones/generar
 *       Body: { year: 2024, month: 3 }
 *       Genera el cobro mensual para todos los conductores con
 *       comisiones pendientes en el periodo indicado.
 *
 *  POST /administracion/liquidaciones/marcar-vencidas
 *       Sin body. Marca como 'atrasado' todos los settlements
 *       cuyo due_date ya pasó.
 *
 *  GET  /administracion/liquidaciones/vencidas
 *       Lista todos los conductores con deuda vencida.
 *
 *  POST /administracion/liquidaciones/:id/pagar
 *       Body: { amount, payment_method }
 *       Registra el pago de un settlement.
 */

const enrutador = require('express').Router();
const { sequelize: sequelize } = require('../../models');
const {
  marcarLiquidacionesVencidas: marcarLiquidacionesVencidas,
  generarLiquidacionesMensuales: generarLiquidacionesMensuales
} = require("../../jobs/liquidacionJobs");

// ─── Middleware: solo admin ───────────────────────────────────────────────
const esAdministrador = (solicitud, respuesta, siguiente) => {
  if (solicitud.user?.role !== 'administrador') {
    return respuesta.status(403).json({ message: 'Acceso restringido a administradores.' });
  }
  siguiente();
};

enrutador.use(esAdministrador);

// ─── POST /administracion/liquidaciones/generar ────────────────────────────────────
/**
 * Genera cobros mensuales manualmente.
 * Usar al cierre de cada mes hasta que existan más de 50 conductores
 * y se active el cron automático.
 */
enrutador.post('/generar', async (solicitud, respuesta) => {
  const { year: anio, month: mes } = solicitud.body;

  if (!anio || !mes || mes < 1 || mes > 12) {
    return respuesta.status(400).json({
      message: 'Parámetros inválidos. Se requiere year (número) y month (1–12).'
    });
  }

  try {
    const resultados = await generarLiquidacionesMensuales(Number(anio), Number(mes));
    const exitosos = resultados.filter((r) => r.settlementId).length;
    const fallidos = resultados.filter((r) => r.error).length;

    return respuesta.json({
      message: `Cobros generados: ${exitosos} exitosos, ${fallidos} con errores.`,
      period: `${anio}-${String(mes).padStart(2, '0')}`,
      results: resultados
    });
  } catch (error) {
    return respuesta.status(500).json({ message: error.message });
  }
});

// ─── POST /administracion/liquidaciones/marcar-vencidas ────────────────────────────────
/**
 * Marca settlements vencidos manualmente.
 * Ejecutar antes de revisar la lista de morosos.
 */
enrutador.post('/marcar-vencidas', async (solicitud, respuesta) => {
  try {
    const cantidad = await marcarLiquidacionesVencidas();
    return respuesta.json({
      message: `${cantidad} comisión(es) atrasada(s).`,
      count: cantidad
    });
  } catch (error) {
    return respuesta.status(500).json({ message: error.message });
  }
});

// ─── GET /administracion/liquidaciones/vencidas ──────────────────────────────────────
/**
 * Lista conductores con deuda vencida, ordenados por deuda total descendente.
 */
enrutador.get('/vencidas', async (solicitud, respuesta) => {
  try {
    const [filas] = await sequelize.query(`
      SELECT
        d.id                           AS driver_id,
        CONCAT_WS(' ', ui.first_names, ui.paternal_surname, ui.maternal_surname) AS name,
        u.phone,
        u.email,
        COUNT(cs.id)                   AS settlements_vencidos,
        SUM(cs.total_commission)       AS deuda_total,
        MIN(cs.due_date)               AS primer_vencimiento
      FROM comision cs
      JOIN conductor d ON d.id = cs.driver_id
      JOIN usuario   u ON u.id = d."userId"
      LEFT JOIN documento_ci ui ON ui.user_id = u.id
      WHERE cs.status = 'atrasado'
      GROUP BY d.id, ui.first_names, ui.paternal_surname, ui.maternal_surname, u.phone, u.email
      ORDER BY deuda_total DESC;
    `);

    return respuesta.json({ total: filas.length, conductores: filas });
  } catch (error) {
    return respuesta.status(500).json({ message: error.message });
  }
});

// ─── POST /administracion/liquidaciones/:id/pagar ─────────────────────────────────────
/**
 * Registra el pago de un settlement específico.
 * Body: { amount: number, payment_method: 'efectivo'|'qr'|'transferencia' }
 */
enrutador.post('/:id/pagar', require('../../controllers/comisionesAdminControlador').registrarPago);

module.exports = enrutador;
