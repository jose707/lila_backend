const PagoComision = require('../models/PagoComision');
const { Op } = require('sequelize');
const { fechaBolivia } = require('../jobs/liquidacionJobs');
const { permiteCierreSimulado } = require('./cierreComisionesPrueba');
const { sequelize, ComisionLiquidacion, CobrosConductor, Conductor, Usuario, UsuarioIdentidad, AuditoriaRegistro } = require('../models');

const { ultimosComprobantes, presentarComprobante } = require('./comprobantesComisionControlador');
const estados = ['abierto', 'pendiente_pago', 'atrasado', 'pagado', 'under_review'];
const metodos = ['efectivo', 'qr', 'transferencia'];
const centavos = importe => Math.round(Number(importe || 0) * 100);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const identidadIncluida = { model: UsuarioIdentidad, as: 'identity', attributes: ['firstNames', 'paternalSurname', 'maternalSurname'] };
const conductorIncluido = {
  model: Conductor, as: 'driver', paranoid: false, attributes: ['id'],
  include: [{ model: Usuario, as: 'user', attributes: ['email'], include: [identidadIncluida] }]
};

function nombre(usuario) {
  const identidad = usuario?.identity;
  return [identidad?.firstNames, identidad?.paternalSurname, identidad?.maternalSurname].filter(Boolean).join(' ') || usuario?.email || null;
}

function saldoCentavos(liquidacion) {
  return liquidacion.status === 'pagado' ? 0 : Math.max(0, centavos(liquidacion.total_commission) - centavos(liquidacion.amount_paid));
}

function estadoLiquidacion(liquidacion, comprobante, hoy) {
  if (liquidacion.status === 'pagado') return 'pagado';

  return liquidacion.status;
}

function presentar(liquidacion, comprobante, hoy = fechaBolivia()) {
  const estado = estadoLiquidacion(liquidacion, comprobante, hoy);
  return {
    id: liquidacion.id, conductorId: liquidacion.driver_id, conductor: nombre(liquidacion.driver?.user) || 'Conductor sin nombre',
    periodo: liquidacion.period_start, vence: liquidacion.due_date, viajes: liquidacion.total_rides,
    comision: centavos(liquidacion.total_commission) / 100, pagado: centavos(liquidacion.amount_paid) / 100,
    saldo: saldoCentavos(liquidacion) / 100, estado,
    metodo: liquidacion.payment_method, fechaPago: liquidacion.paid_at,
    esPrueba: liquidacion.notes?.startsWith('PRUEBA LOCAL:') ?? false,
    comprobante: presentarComprobante(comprobante, liquidacion.due_date, fechaBolivia)
  };
}

async function listar(solicitud, respuesta) {
  try {
    const { period, driverId, status } = solicitud.query;
    const consulta = typeof solicitud.query.search === 'string' ? solicitud.query.search.trim().slice(0, 100) : '';
    if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || (driverId && (typeof driverId !== 'string' || !uuid.test(driverId)))) {
      return respuesta.status(400).json({ error: 'Indica un mes y un conductor válidos.' });
    }
    const limite = Math.min(50, Math.max(1, parseInt(solicitud.query.limit, 10) || 20));
    const offset = Math.max(0, parseInt(solicitud.query.offset, 10) || 0);
    const where = { period_start: `${period}-01` };
    if (driverId) where.driver_id = driverId;
    const hoy = fechaBolivia();
    if (consulta) {
      const palabras = consulta.split(/\s+/).map(palabra => ({
        [Op.or]: ['firstNames', 'paternalSurname', 'maternalSurname'].map(campo => ({ [campo]: { [Op.iLike]: `%${palabra}%` } }))
      }));
      const [identidades, contactos] = await Promise.all([
        UsuarioIdentidad.findAll({ attributes: ['userId'], where: { [Op.and]: palabras } }),
        Usuario.findAll({ attributes: ['id'], where: { email: { [Op.iLike]: `%${consulta}%` } } })
      ]);
      const ids = [...new Set([...identidades.map(i => i.userId), ...contactos.map(u => u.id)])];
      const conductores = await Conductor.findAll({ attributes: ['id'], paranoid: false, where: { userId: { [Op.in]: ids } } });
      where[Op.and] = [{ driver_id: { [Op.in]: conductores.map(c => c.id) } }];
    }

    const candidatas = await ComisionLiquidacion.findAll({
      where, attributes: ['id', 'driver_id', 'due_date', 'total_commission', 'amount_paid', 'status'],
      order: [['due_date', 'ASC'], ['id', 'ASC']]
    });
    const comprobantes = await ultimosComprobantes(candidatas.map(fila => fila.id));
    const importes = estados.includes(status)
      ? candidatas.filter(fila => status === 'under_review' ? comprobantes.get(fila.id)?.status === 'pendiente' && fila.status !== 'pagado' : estadoLiquidacion(fila, comprobantes.get(fila.id), hoy) === status)
      : candidatas;
    const idsPagina = importes.slice(offset, offset + limite).map(fila => fila.id);
    const filas = await ComisionLiquidacion.findAll({
      where: { id: { [Op.in]: idsPagina } }, include: [conductorIncluido], order: [['due_date', 'ASC'], ['id', 'ASC']]
    });
    const conductoresPendientes = new Set();
    const resumen = importes.reduce((totales, fila) => {
      const pagado = centavos(fila.amount_paid);
      const saldo = saldoCentavos(fila);
      totales.comision += centavos(fila.total_commission);
      totales.pagado += pagado;
      totales.saldo += saldo;
      if (saldo > 0 && ['pendiente_pago', 'atrasado'].includes(estadoLiquidacion(fila, comprobantes.get(fila.id), hoy))) {
        conductoresPendientes.add(fila.driver_id);
      }
      return totales;
    }, { comision: 0, pagado: 0, saldo: 0 });
    return respuesta.json({ liquidaciones: filas.map(fila => presentar(fila, comprobantes.get(fila.id), hoy)), total: importes.length, cierreSimulado: permiteCierreSimulado(), resumen: {
      comision: resumen.comision / 100, pagado: resumen.pagado / 100, saldo: resumen.saldo / 100,
      conductoresPendientes: conductoresPendientes.size
    } });
  } catch (error) {
    console.error('Error al listar liquidaciones:', error.message);
    return respuesta.status(500).json({ error: 'No se pudieron cargar las liquidaciones.' });
  }
}

async function detalle(solicitud, respuesta) {
  try {
    const id = solicitud.params.id;
    if (!uuid.test(id)) return respuesta.status(400).json({ error: 'Liquidación inválida.' });
    const liquidacion = await ComisionLiquidacion.findByPk(id, { include: [conductorIncluido] });
    if (!liquidacion) return respuesta.status(404).json({ error: 'Liquidación no encontrada.' });
    const registros = await PagoComision.findAll({
      where: { commissionId: id, status: 'confirmado' },
      include: [{ model: Usuario, as: 'reviewer', attributes: ['email'], include: [identidadIncluida] }],
      order: [['reviewedAt', 'DESC'], ['id', 'DESC']]
    });
    const comprobante = (await ultimosComprobantes([id])).get(id);
    return respuesta.json({ ...presentar(liquidacion, comprobante), historial: registros.map(registro => ({
      id: registro.id, importe: registro.amount, metodo: registro.method,
      referencia: registro.reference, fecha: registro.reviewedAt, administrador: nombre(registro.reviewer)
    })) });
  } catch (error) {
    console.error('Error al cargar la liquidación:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo cargar la liquidación.' });
  }
}

async function registrarPago(solicitud, respuesta) {
  const id = solicitud.params.id;
  const { amount, payment_method: metodo, expectedPaid, comprobanteId } = solicitud.body ?? {};
  const referencia = typeof solicitud.body?.reference === 'string' ? solicitud.body.reference.trim() : '';
  const importe = typeof amount === 'number' ? amount : typeof amount === 'string' && /^\d+(\.\d{1,2})?$/.test(amount) ? Number(amount) : NaN;
  const importeCentavos = centavos(importe);
  if (!uuid.test(id) || !Number.isFinite(importe) || !Number.isSafeInteger(importeCentavos) || importeCentavos <= 0 ||
    Math.abs(importe * 100 - importeCentavos) > 0.00001 || !metodos.includes(metodo) || referencia.length > 100 ||
    (expectedPaid !== undefined && (typeof expectedPaid !== 'number' || !Number.isFinite(expectedPaid) || expectedPaid < 0))) {
    return respuesta.status(400).json({ error: 'Ingresa un importe positivo con hasta dos decimales y un método válido.' });
  }
  try {
    const resultado = await sequelize.transaction(async transaction => {
      const fila = await ComisionLiquidacion.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!fila) return { codigo: 404, error: 'Liquidación no encontrada.' };
      // Refrescar cálculos tras obtener el bloqueo: otro pago pudo confirmarse mientras esperábamos.
      await fila.reload({transaction});
      const pagado = centavos(fila.amount_paid);
      if (expectedPaid !== undefined && pagado !== centavos(expectedPaid)) return { codigo: 409, error: 'El saldo cambió. Actualiza la liquidación antes de registrar otro pago.' };
      if (!['pendiente_pago', 'atrasado'].includes(fila.status)) return { codigo: 409, error: 'Esta liquidación no admite pagos en su estado actual.' };
      const comprobante = (await ultimosComprobantes([id], transaction)).get(id);
      const enRevision = comprobante?.status === 'pendiente';
      if ((enRevision && comprobante.id !== comprobanteId) || (comprobanteId && !enRevision)) {
        return { codigo: 409, error: 'El comprobante cambió. Actualiza la liquidación antes de confirmar el pago.' };
      }
      if (enRevision && metodo !== comprobante.method) {
        return { codigo: 400, error: 'Confirma el método indicado en el comprobante o recházalo.' };
      }
      const referenciaPago = enRevision ? comprobante.reference : referencia || null;
      const saldo = saldoCentavos(fila);
      if (importeCentavos !== saldo) return { codigo: 400, error: 'El importe debe cubrir exactamente el saldo pendiente.' };
      const fecha = new Date();
      const estadoAnterior = fila.status;
      const nuevoPagado = (pagado + importeCentavos) / 100;
      const datosPago = { status: 'confirmado', amount: importeCentavos / 100, reviewedAt: fecha, reviewerId: solicitud.user.id };
      if (enRevision) await comprobante.update(datosPago, { transaction });
      else await PagoComision.create({ ...datosPago, commissionId: id, method: metodo, reference: referenciaPago }, { transaction });
      await AuditoriaRegistro.create({
        table_name: 'comision', record_id: id, action: 'ACTUALIZACION', changed_by: solicitud.user.id,
        old_values: { pagado: pagado / 100, estado: estadoAnterior },
        new_values: { tipo: 'pago_comision', importe: importeCentavos / 100, metodo, referencia: referenciaPago, comprobanteId: enRevision ? comprobante.id : null, pagado: nuevoPagado, estado: 'pagado' }
      }, { transaction });
      return { message: 'Pago registrado.', settlementId: id };
    });
    if (resultado.error) return respuesta.status(resultado.codigo).json({ error: resultado.error });
    return respuesta.json(resultado);
  } catch (error) {
    console.error('Error al registrar el pago de comisión:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo registrar el pago.' });
  }
}

async function listarPropias(solicitud, respuesta) {
  try {
    const liquidaciones = await ComisionLiquidacion.findAll({
      where: { driver_id: solicitud.conductorComisionesId }, order: [['period_start', 'DESC']]
    });
    const comprobantes = await ultimosComprobantes(liquidaciones.map(fila => fila.id));
    const hoy = fechaBolivia();
    return respuesta.json({
      instrucciones: process.env.COMMISSION_PAYMENT_INSTRUCTIONS?.trim() || null,
      liquidaciones: liquidaciones.map(fila => presentar(fila, comprobantes.get(fila.id), hoy))
    });
  } catch (error) {
    console.error('Error al listar comisiones del conductor:', error.message);
    return respuesta.status(500).json({ error: 'No se pudieron cargar tus liquidaciones.' });
  }
}

module.exports = { listar, detalle, registrarPago, listarPropias, estadoLiquidacion };
