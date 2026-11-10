const { Op } = require('sequelize');
const db = require('../config/baseDatos');
const { Conductor, Usuario, UsuarioIdentidad, Vehiculo, Viaje, AuditoriaRegistro } = require('../models');
const ComisionLiquidacion = require('../models/ComisionLiquidacion');
const { notificar } = require('../services/notificacionServicio');
const { ultimosComprobantes } = require('./comprobantesComisionControlador');
const { estadoLiquidacion } = require('./comisionesAdminControlador');
const { fechaBolivia } = require('../jobs/liquidacionJobs');

const estadosOperativos = ['aprobado', 'suspendido'];
const usuarioIncluido = {
  model: Usuario, as: 'user', required: true, attributes: ['id', 'email', 'phone', 'profilePhoto', 'isActive'],
  include: [{ model: UsuarioIdentidad, as: 'identity', attributes: ['firstNames', 'paternalSurname', 'maternalSurname'] }]
};
const vehiculosIncluidos = {
  model: Vehiculo, as: 'vehicles', separate: true, order: [['createdAt', 'DESC']],
  attributes: ['id', 'plate', 'brand', 'model', 'year', 'color', 'vehicle_type', 'status', 'ruatVerified', 'soatExpiryDate']
};

function nombreUsuario(usuario) {
  const identidad = usuario?.identity;
  return [identidad?.firstNames, identidad?.paternalSurname, identidad?.maternalSurname].filter(Boolean).join(' ');
}

function ficha(conductor) {
  return {
    id: conductor.id, usuarioId: conductor.userId, nombre: nombreUsuario(conductor.user) || 'Sin nombre',
    foto: conductor.user.profilePhoto, correo: conductor.user.email, telefono: conductor.user.phone,
    cuentaActiva: conductor.user.isActive, estado: conductor.status, disponible: conductor.isAvailable,
    licencia: conductor.licenseNumber, vencimientoLicencia: conductor.licenseExpiry,
    estadoLicencia: conductor.licenseVerificationStatus, vehiculos: conductor.vehicles
  };
}

async function listar(solicitud, respuesta) {
  try {
    const limite = Math.min(50, Math.max(1, parseInt(solicitud.query.limit, 10) || 25));
    const desplazamiento = Math.max(0, parseInt(solicitud.query.offset, 10) || 0);
    const consulta = typeof solicitud.query.search === 'string' ? solicitud.query.search.trim().slice(0, 100) : '';
    const estado = solicitud.query.status;
    const where = { status: estadosOperativos.includes(estado) ? estado : { [Op.in]: estadosOperativos } };

    if (consulta) {
      const patron = { [Op.iLike]: `%${consulta}%` };
      const palabras = consulta.split(/\s+/).map(palabra => ({
        [Op.or]: ['firstNames', 'paternalSurname', 'maternalSurname'].map(campo => ({ [campo]: { [Op.iLike]: `%${palabra}%` } }))
      }));
      const [identidades, contactos, vehiculos] = await Promise.all([
        UsuarioIdentidad.findAll({ attributes: ['userId'], where: { [Op.and]: palabras } }),
        Usuario.findAll({ attributes: ['id'], where: { [Op.or]: [{ email: patron }, { phone: patron }] } }),
        Vehiculo.findAll({ attributes: ['driver_id'], where: { plate: patron } })
      ]);
      where[Op.or] = [
        { userId: { [Op.in]: [...new Set([...identidades.map(i => i.userId), ...contactos.map(u => u.id)])] } },
        { id: { [Op.in]: vehiculos.map(v => v.driver_id) } }
      ];
    }

    const resultado = await Conductor.findAndCountAll({
      where, include: [usuarioIncluido, vehiculosIncluidos], distinct: true,
      order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limite, offset: desplazamiento
    });
    return respuesta.json({ conductores: resultado.rows.map(ficha), total: resultado.count });
  } catch (error) {
    console.error('Error al listar conductores operativos:', error.message);
    return respuesta.status(500).json({ error: 'No se pudieron cargar los conductores.' });
  }
}

async function detalle(solicitud, respuesta) {
  try {
    const id = solicitud.params.driverId;
    const conductor = await Conductor.findOne({ where: { id, status: { [Op.in]: estadosOperativos } }, include: [usuarioIncluido, vehiculosIncluidos] });
    if (!conductor) return respuesta.status(404).json({ error: 'Conductor no encontrado.' });
    const [liquidaciones, registros] = await Promise.all([
      ComisionLiquidacion.findAll({
        where: { driver_id: id }, order: [['period_start', 'DESC']],
        attributes: ['id', 'period_start', 'due_date', 'total_commission', 'amount_paid', 'status']
      }),
      AuditoriaRegistro.findAll({
        where: { table_name: 'conductor', record_id: id },
        include: [AuditoriaRegistro.eventFilter('cambio_conduccion'), { model: Usuario, as: 'changedBy', attributes: ['email'], include: usuarioIncluido.include }],
        order: [['changed_at', 'DESC'], ['id', 'DESC']]
      })
    ]);
    const comprobantes = await ultimosComprobantes(liquidaciones.map(liquidacion => liquidacion.id));
    const hoy = fechaBolivia();
    const comisiones = liquidaciones.map(liquidacion => {
      const total = Number(liquidacion.total_commission);
      const pagado = Number(liquidacion.amount_paid ?? 0);
      return {
        id: liquidacion.id, periodo: liquidacion.period_start, vence: liquidacion.due_date,
        total, pagado, saldo: liquidacion.status === 'pagado' ? 0 : Math.max(0, total - pagado), estado: estadoLiquidacion(liquidacion, comprobantes.get(liquidacion.id), hoy)
      };
    });
    return respuesta.json({
      ...ficha(conductor), saldoPendiente: comisiones.reduce((saldo, comision) => saldo + comision.saldo, 0),
      comisiones: comisiones.slice(0, 12),
      historial: registros.map(registro => ({
        id: registro.id, estado: registro.new_values.status, motivo: registro.new_values.motivo,
        fecha: registro.changed_at, administrador: nombreUsuario(registro.changedBy) || registro.changedBy?.email || null
      }))
    });
  } catch (error) {
    console.error('Error al cargar la ficha del conductor:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo cargar la ficha del conductor.' });
  }
}

async function cambiarEstado(solicitud, respuesta) {
  const { suspend } = solicitud.body ?? {};
  const motivo = typeof solicitud.body?.motivo === 'string' ? solicitud.body.motivo.trim() : '';
  if (typeof suspend !== 'boolean' || !motivo || motivo.length > 500) {
    return respuesta.status(400).json({ error: 'Ingresa un motivo de hasta 500 caracteres.' });
  }

  try {
    const nuevoEstado = suspend ? 'suspendido' : 'aprobado';
    const resultado = await db.transaction(async transaction => {
      const conductor = await Conductor.findByPk(solicitud.params.driverId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conductor) return { codigo: 404, error: 'Conductor no encontrado.' };
      if (conductor.status === nuevoEstado) return { conductor, actualizado: false };
      if (!estadosOperativos.includes(conductor.status)) return { codigo: 409, error: 'La solicitud aún no está habilitada para conducir.' };

      if (suspend) {
        const viaje = await Viaje.findOne({ attributes: ['id'], transaction, where: {
          driverId: conductor.id, status: { [Op.in]: ['aceptado', 'llegado', 'en_curso'] }
        } });
        if (viaje) return { codigo: 409, error: 'El conductor tiene un viaje activo. Espera a que termine.' };
      }

      const estadoAnterior = conductor.status;
      await conductor.update({ status: nuevoEstado, isAvailable: false }, { transaction });
      await AuditoriaRegistro.create({
        table_name: 'conductor', record_id: conductor.id, action: 'ACTUALIZACION',
        old_values: { status: estadoAnterior }, new_values: { tipo: 'cambio_conduccion', status: nuevoEstado, motivo },
        changed_by: solicitud.user.id
      }, { transaction });
      return { conductor, actualizado: true };
    });

    if (resultado.error) return respuesta.status(resultado.codigo).json({ error: resultado.error });
    if (resultado.actualizado) {
      void notificar({
        userId: resultado.conductor.userId, type: 'sistema',
        title: suspend ? 'Conducción suspendida' : 'Conducción reactivada',
        body: `Motivo: ${motivo}`, data: { suspended: suspend }
      }).catch(error => console.warn('No se pudo notificar el cambio de conducción:', error.message));
    }
    return respuesta.json({ driver: { id: resultado.conductor.id, status: nuevoEstado, isAvailable: false } });
  } catch (error) {
    console.error('Error al cambiar el permiso de conducción:', error.message);
    return respuesta.status(500).json({ error: 'No se pudo cambiar el permiso de conducción.' });
  }
}

module.exports = { listar, detalle, cambiarEstado };
