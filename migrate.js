'use strict';

const sequelize = require("./src/config/baseDatos");
const initialSchema = require('./migrations/00000000-initial-schema');

const APP_TABLES = new Set([
  "usuario",
  "documento_ci",
  "conductor",
  "vehiculo",
  "viaje",
  "oferta_viaje",
  "parada_viaje",
  "ubicacion_conductor",
  "solicitud_conductor",
  "documento_domicilio",
  "documento", "usuario_documento", "conductor_documento", "vehiculo_documento", "solicitud_documento",
  "documento_licencia", "documento_ruat", "documento_soat", "documento_tic", "documento_antecedentes",
  "documento_informe_psicologico", "evaluacion_psicologica", "pago_comision", "registro_auditoria_detalle",
  "zona_servicio",
  "motivo_cancelacion",
  "pago",
  "calificacion",
  "notificacion",
  "comision",
  "cobros_conductor",
  "regla_tarifa",
  "registro_auditoria",
  "contacto_emergencia",
  "alerta_emergencia",
  "registro_sms_emergencia",
]);

async function runMigration() {
  try {
    console.log('🔄 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    const tables = await sequelize.getQueryInterface().showAllTables();
    const existingAppTables = tables
      .map(table => typeof table === 'string' ? table : table.tableName)
      .filter(table => APP_TABLES.has(table));

    if (existingAppTables.length) {
      throw new Error(
        `La base ya contiene tablas de Línea Lila (${existingAppTables.join(', ')}). ` +
        'La migración maestra solo se ejecuta una vez sobre una base nueva. No se hicieron cambios.',
      );
    }

    console.log('🔄 Inicializando esquema con 00000000-initial-schema...');
    await initialSchema.up(sequelize.getQueryInterface(), sequelize.Sequelize);
    console.log('✅ Esquema inicial creado correctamente.');
  } catch (error) {
    console.error('❌ No se pudo inicializar la base de datos:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

runMigration();
