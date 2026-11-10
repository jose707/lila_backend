'use strict';
const {
  sequelize,
  ServicioZona,
  AuditoriaRegistro
} = require('../models');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const presentar = z => ({
  id: z.id,
  nombre: z.name,
  activa: z.is_active,
  tasa_comision: Number(z.commission_rate)
});
exports.listar = async (req, res) => {
  try {
    const zonas = await ServicioZona.findAll({
      attributes: ['id', 'name', 'is_active', 'commission_rate'],
      order: [
        ['name', 'ASC']
      ]
    });
    return res.json({
      zonas: zonas.map(presentar)
    });
  } catch {
    return res.status(500).json({
      error: 'No se pudieron consultar las tasas por zona.'
    });
  }
};
exports.actualizar = async (req, res) => {
  const raw = req.body?.tasa_comision;
  const value = typeof raw === 'number' ? String(raw) : raw;
  if (!uuid.test(req.params.zoneId) || typeof value !== 'string' || !/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(value)) return res.status(400).json({
    error: 'Indica una tasa entre 0 y 1, con hasta seis decimales. Ejemplo: 0.02 equivale al 2 %.'
  });
  try {
    const result = await sequelize.transaction(async transaction => {
      const zona = await ServicioZona.findByPk(req.params.zoneId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!zona) return null;
      const anterior = Number(zona.commission_rate);
      await zona.update({
        commission_rate: value
      }, {
        transaction
      });
      if (anterior !== Number(value)) await AuditoriaRegistro.create({
        table_name: 'zona_servicio',
        record_id: zona.id,
        action: 'ACTUALIZACION',
        changed_by: req.user.id,
        old_values: {
          tasa_comision: anterior
        },
        new_values: {
          tasa_comision: Number(value)
        }
      }, {
        transaction
      });
      return presentar(zona);
    });
    if (!result) return res.status(404).json({
      error: 'Zona no encontrada.'
    });
    return res.json({
      zona: result
    });
  } catch (e) {
    console.error('Error al configurar tasa de zona:', e.message);
    return res.status(500).json({
      error: 'No se pudo actualizar la tasa de comisión.'
    });
  }
};
