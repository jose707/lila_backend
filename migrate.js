'use strict';

const sequelize = require('./src/config/database');
const initialSchema = require('./migrations/00000000-initial-schema');

const APP_TABLES = new Set([
  'users',
  'user_identities',
  'drivers',
  'vehicles',
  'rides',
  'ride_offers',
  'ride_waypoints',
  'driver_locations',
  'driver_requests',
  'driver_domiciles',
  'documents',
  'service_areas',
  'cancellation_reasons',
  'payments',
  'ratings',
  'notifications',
  'commission_settlements',
  'driver_earnings',
  'pricing_rules',
  'audit_logs',
  'emergency_contacts',
  'emergency_alerts',
  'emergency_sms_logs',
  'emergency_recordings',
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
