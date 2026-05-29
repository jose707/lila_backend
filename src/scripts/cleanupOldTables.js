// backend/src/scripts/cleanupOldTables.js
const sequelize = require('../config/database');

async function cleanupOldTables() {
  try {
    console.log('🧹 Limpiando tablas antiguas...\n');

    // Eliminar tablas antiguas si existen
    const tables = ['DriverRequests', 'RequestFiles'];

    for (const table of tables) {
      try {
        await sequelize.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
        console.log(`✅ Eliminada tabla: ${table}`);
      } catch (error) {
        console.log(`⚠️  ${table} no encontrada (ok)`);
      }
    }

    console.log('\n✅ Limpieza completada');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanupOldTables();
