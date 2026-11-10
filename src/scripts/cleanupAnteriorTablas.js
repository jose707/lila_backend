// backend/src/scripts/cleanupAnteriorTablas.js
const sequelize = require("../config/baseDatos");

async function limpiarAnteriorTablas() {
  try {
    console.log('🧹 Limpiando tablas antiguas...\n');

    // Eliminar tablas antiguas si existen
    const tablas = ['DriverRequests', 'RequestFiles'];

    for (const tabla of tablas) {
      try {
        await sequelize.query(`DROP TABLE IF EXISTS "${tabla}" CASCADE;`);
        console.log(`✅ Eliminada tabla: ${tabla}`);
      } catch (error) {
        console.log(`⚠️  ${tabla} no encontrada (ok)`);
      }
    }

    console.log('\n✅ Limpieza completada');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

limpiarAnteriorTablas();
