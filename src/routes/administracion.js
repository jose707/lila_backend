// backend/src/routes/administracion.js
const express = require('express');
const enrutador = express.Router();
const administradorControlador = require("../controllers/adminControlador");
const conductorRevisionControlador = require("../controllers/conductorRevisionControlador");
const { autenticacionIntermediario: autenticacionIntermediario, adminIntermediario: administradorIntermediario } = require("../middleware/autenticacion");
enrutador.get('/solicitudes/:requestId/documentos/:tipo/datos', autenticacionIntermediario, administradorIntermediario, conductorRevisionControlador.datosDocumento);
enrutador.put('/solicitudes/:requestId/documentos/:tipo/datos', autenticacionIntermediario, administradorIntermediario, conductorRevisionControlador.corregirDocumento);

const conductoresGestion = require('../controllers/conductoresGestionControlador');
const { listarEmergencias, resolverEmergencia, obtenerDireccionEmergencia } = require('../controllers/emergenciaViajeControlador');

enrutador.get('/emergencias', autenticacionIntermediario, administradorIntermediario, listarEmergencias);
enrutador.get('/emergencias/:id/direccion', autenticacionIntermediario, administradorIntermediario, obtenerDireccionEmergencia);
enrutador.put('/emergencias/:id/resolver', autenticacionIntermediario, administradorIntermediario, resolverEmergencia);

enrutador.get('/gestion-conductores', autenticacionIntermediario, administradorIntermediario, conductoresGestion.listar);
enrutador.get('/gestion-conductores/:driverId', autenticacionIntermediario, administradorIntermediario, conductoresGestion.detalle);
enrutador.put('/gestion-conductores/:driverId/suspension', autenticacionIntermediario, administradorIntermediario, conductoresGestion.cambiarEstado);

enrutador.get(
  '/usuarios',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerTodosUsuarios
);
enrutador.get(
  '/usuarios/:userId',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerDetalleUsuario
);
enrutador.delete(
  '/usuarios/:userId',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.eliminarUsuario
);
enrutador.put(
  '/usuarios/:userId/habilitar',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.enableUsuario
);
enrutador.get(
  '/usuarios/:userId/evidencia-identidad/:side',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerIdentidadEvidencia
);
enrutador.get(
  '/conductores',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerTodosConductores
);
enrutador.get(
  '/conductores/pendientes',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerPendienteConductorSolicitudes
);
enrutador.get(
  '/solicitudes/:requestId/vista-previa-ocr/:documentType',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerConductorOcrVistaPrevia
);
enrutador.put(
  '/conductores/:driverId/aprobar',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.aprobarConductor
);
enrutador.put(
  '/solicitudes/:requestId/aprobar',
  autenticacionIntermediario,
  administradorIntermediario,
  conductorRevisionControlador.aprobarConductor
);
enrutador.put(
  '/solicitudes/:requestId/observar',
  autenticacionIntermediario,
  administradorIntermediario,
  conductorRevisionControlador.observeConductor
);
enrutador.put(
  '/conductores/:driverId/rechazar',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.rechazarConductor
);
enrutador.put(
  '/solicitudes/:requestId/rechazar',
  autenticacionIntermediario,
  administradorIntermediario,
  conductorRevisionControlador.rechazarConductor
);
enrutador.delete(
  '/conductores/:driverId',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.eliminarConductor
);
enrutador.get(
  '/viajes',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerTodosViajes
);
enrutador.get(
  '/analitica',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerAnalitica
);
enrutador.get(
  '/pagos',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.obtenerTodosPagos
);

// ─── ADVANCED ANALYTICS ───────────────────────────────────────────────────
enrutador.get('/analitica/ampliada', autenticacionIntermediario, administradorIntermediario, administradorControlador.obtenerAnaliticaExtendido);
enrutador.get('/analitica/transporte', autenticacionIntermediario, administradorIntermediario, require('../controllers/reporteTransporteControlador'));
enrutador.get('/analitica/viajes-por-dia', autenticacionIntermediario, administradorIntermediario, administradorControlador.obtenerViajesPorDia);
enrutador.get('/analitica/ingresos-por-dia', autenticacionIntermediario, administradorIntermediario, administradorControlador.obtenerIngresosPorDia);
enrutador.get('/analitica/segmentacion', autenticacionIntermediario, administradorIntermediario, administradorControlador.obtenerUsuarioSegmentacion);
enrutador.get('/analitica/embudo', autenticacionIntermediario, administradorIntermediario, administradorControlador.obtenerViajeEmbudo);
enrutador.get('/analitica/economia-unitaria', autenticacionIntermediario, administradorIntermediario, administradorControlador.obtenerEconomiaUnitaria);
enrutador.get('/analitica/rutas-principales', autenticacionIntermediario, administradorIntermediario, administradorControlador.obtenerSuperiorRutas);

// ─── SETTLEMENTS (cobro mensual de comisiones) ────────────────────────────
// ⚠️  Activar cron automático (ENABLE_CRON_JOBS=true en .env) cuando la
//     plataforma supere 50 conductores activos. Hasta entonces, usar estos
//     endpoints para disparar los procesos manualmente desde el panel admin.
const {
  marcarLiquidacionesVencidas: marcarLiquidacionesVencidas,
  generarLiquidacionesMensuales: generarLiquidacionesMensuales
} = require("../jobs/liquidacionJobs");
const { sequelize: sequelize } = require('../models');

// POST /administracion/liquidaciones/generar  { year, month }
enrutador.post(
  '/liquidaciones/generar',
  autenticacionIntermediario,
  administradorIntermediario,
  async (solicitud, respuesta) => {
    const { year: anio, month: mes } = solicitud.body;
    if (!anio || !mes || mes < 1 || mes > 12) {
      return respuesta.
      status(400).
      json({ message: 'Se requiere year y month (1–12).' });
    }
    try {
      const resultados = await generarLiquidacionesMensuales(
        Number(anio),
        Number(mes)
      );
      const exitosos = resultados.filter((r) => r.settlementId).length;
      const fallidos = resultados.filter((r) => r.error).length;
      return respuesta.json({
        message: `Cobros generados: ${exitosos} exitosos, ${fallidos} con errores.`,
        period: `${anio}-${String(mes).padStart(2, '0')}`,
        results: resultados
      });
    } catch (error) {
      return respuesta.status(error.status || 500).json({ message: error.message });
    }
  }
);

// POST /administracion/liquidaciones/marcar-vencidas  (sin body)
enrutador.post(
  '/liquidaciones/marcar-vencidas',
  autenticacionIntermediario,
  administradorIntermediario,
  async (solicitud, respuesta) => {
    try {
      const cantidad = await marcarLiquidacionesVencidas();
      return respuesta.json({
        message: `${cantidad} comisión(es) atrasada(s).`,
        count: cantidad
      });
    } catch (error) {
      return respuesta.status(500).json({ message: error.message });
    }
  }
);

// GET /administracion/liquidaciones/vencidas
enrutador.get(
  '/liquidaciones/vencidas',
  autenticacionIntermediario,
  administradorIntermediario,
  async (solicitud, respuesta) => {
    try {
      const [filas] = await sequelize.query(`
      SELECT d.id AS driver_id,
             CONCAT_WS(' ', ui.first_names, ui.paternal_surname, ui.maternal_surname) AS name,
             u.phone, u.email,
             COUNT(cs.id)             AS settlements_vencidos,
             SUM(cs.total_commission) AS deuda_total,
             MIN(cs.due_date)         AS primer_vencimiento
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
  }
);

const comisionesAdmin = require('../controllers/comisionesAdminControlador');
const { generarCierreSimulado } = require('../controllers/cierreComisionesPrueba');
enrutador.post('/liquidaciones/simular-cierre', autenticacionIntermediario, administradorIntermediario, generarCierreSimulado);
const comprobantesComision = require('../controllers/comprobantesComisionControlador');
enrutador.get('/liquidaciones', autenticacionIntermediario, administradorIntermediario, comisionesAdmin.listar);
enrutador.get('/liquidaciones/:id', autenticacionIntermediario, administradorIntermediario, comisionesAdmin.detalle);
enrutador.post('/liquidaciones/:id/pagar', autenticacionIntermediario, administradorIntermediario, comisionesAdmin.registrarPago);
enrutador.get('/liquidaciones/:id/comprobantes/:comprobanteId', autenticacionIntermediario, administradorIntermediario, comprobantesComision.ver);
enrutador.put('/liquidaciones/:id/comprobantes/:comprobanteId/rechazar', autenticacionIntermediario, administradorIntermediario, comprobantesComision.rechazar);


enrutador.put(
  '/conductores/:driverId/suspender',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.alternarSuspenderConductor
);

enrutador.post(
  '/vehiculos/:vehicleId/aprobar-ruat',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.aprobarVehiculoRuat
);

enrutador.post(
  '/vehiculos/:vehicleId/rechazar-ruat',
  autenticacionIntermediario,
  administradorIntermediario,
  administradorControlador.rechazarVehiculoRuat
);

module.exports = enrutador;

const psicologia = require('../controllers/evaluacionPsicologicaControlador');
enrutador.get('/psicologia/pendientes.pdf', autenticacionIntermediario, administradorIntermediario, psicologia.compartirPendientes);
enrutador.put('/solicitudes/:requestId/documentos/aprobar', autenticacionIntermediario, administradorIntermediario, (req,res) => { req.soloRevisionDocumental=true; return conductorRevisionControlador.aprobarConductor(req,res); });
enrutador.get('/solicitudes/:requestId/evaluaciones', autenticacionIntermediario, administradorIntermediario, psicologia.listar);
enrutador.post('/solicitudes/:requestId/informes-psicologicos', autenticacionIntermediario, administradorIntermediario, psicologia.upload, psicologia.registrar);
enrutador.get('/solicitudes/:requestId/evaluaciones/:evaluationId/informe', autenticacionIntermediario, administradorIntermediario, psicologia.verInforme);

enrutador.get('/documentos/pendientes',autenticacionIntermediario,administradorIntermediario,require('../controllers/documentosRenovacionControlador').pendientes);
enrutador.put('/documentos/:documentId/revisar',autenticacionIntermediario,administradorIntermediario,require('../controllers/documentosRenovacionControlador').revisar);

const comisionesZona=require('../controllers/comisionZonaControlador');
enrutador.get('/zonas-servicio',autenticacionIntermediario,administradorIntermediario,comisionesZona.listar);
enrutador.put('/zonas-servicio/:zoneId/tasa-comision',autenticacionIntermediario,administradorIntermediario,comisionesZona.actualizar);
