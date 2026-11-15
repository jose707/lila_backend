'use strict';
const {
  sequelize,
  ServicioZona,
  AuditoriaRegistro
} = require('../models');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const camposTarifa = {
  tarifa_base: 'base_fare',
  tarifa_km: 'fare_per_km',
  tarifa_minuto: 'fare_per_minute'
};
const presentar = z => ({
  id: z.id,
  nombre: z.name,
  activa: z.is_active,
  tasa_comision: Number(z.commission_rate),
  tarifa_base: z.base_fare ?? null,
  tarifa_km: z.fare_per_km ?? null,
  tarifa_minuto: z.fare_per_minute ?? null,
  moneda: z.currency
});
exports.listar = async (req, res) => {
  try {
    const zonas = await ServicioZona.findAll({
      attributes: ['id', 'name', 'is_active', 'commission_rate', ...Object.values(camposTarifa), 'currency'],
      order: [
        ['name', 'ASC']
      ]
    });
    return res.json({
      zonas: zonas.map(presentar)
    });
  } catch {
    return res.status(500).json({
      error: 'No se pudieron consultar las zonas de operación.'
    });
  }
};
exports.actualizar = async (req, res) => {
  if (!uuid.test(req.params.zoneId)) return res.status(400).json({ error: 'Identificador de zona inválido.' });
  const datos = req.body ?? {};
  const cambios = {};
  if (Object.hasOwn(datos, 'tasa_comision')) {
    const valor = typeof datos.tasa_comision === 'number' ? String(datos.tasa_comision) : datos.tasa_comision;
    if (typeof valor !== 'string' || !/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(valor)) {
      return res.status(400).json({ error: 'La comisión debe estar entre 0 % y 100 %, con hasta cuatro decimales en el porcentaje.' });
    }
    cambios.commission_rate = valor;
  }
  for (const [campo, atributo] of Object.entries(camposTarifa)) {
    if (!Object.hasOwn(datos, campo)) continue;
    const valor = datos[campo];
    if (valor !== null && (!Number.isFinite(valor) || valor <= 0)) {
      return res.status(400).json({ error: 'Cada tarifa debe ser mayor que cero o quedar vacía para usar la tarifa global.' });
    }
    cambios[atributo] = valor;
  }
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'Indica al menos una tarifa o la comisión.' });
  try {
    const result = await sequelize.transaction(async transaction => {
      const zona = await ServicioZona.findByPk(req.params.zoneId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!zona) return null;
      const anterior = presentar(zona);
      await zona.update(cambios, { transaction });
      const actual = presentar(zona);
      const camposModificados = ['tasa_comision', ...Object.keys(camposTarifa)]
        .filter(campo => anterior[campo] !== actual[campo]);
      if (camposModificados.length) await AuditoriaRegistro.create({
        table_name: 'zona_servicio',
        record_id: zona.id,
        action: 'ACTUALIZACION',
        changed_by: req.user.id,
        old_values: Object.fromEntries(camposModificados.map(campo => [campo, anterior[campo]])),
        new_values: Object.fromEntries(camposModificados.map(campo => [campo, actual[campo]]))
      }, {
        transaction
      });
      return actual;
    });
    if (!result) return res.status(404).json({
      error: 'Zona no encontrada.'
    });
    return res.json({
      zona: result
    });
  } catch (e) {
    console.error('Error al actualizar zona de operación:', e.message);
    return res.status(500).json({
      error: 'No se pudieron guardar las tarifas y la comisión.'
    });
  }
};
