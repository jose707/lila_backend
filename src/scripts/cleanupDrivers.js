// backend/src/scripts/cleanupDrivers.js
const sequelize = require("../config/baseDatos");

async function limpiarConductores() {
  try {
    console.log('🧹 Limpiando tabla drivers...\n');

    // Truncar tabla drivers pero mantener las relaciones
    await sequelize.query("TRUNCATE TABLE conductor RESTART IDENTITY CASCADE;");
    console.log('✅ Tabla drivers vaciada\n');

    console.log('📋 Tabla drivers ahora contendrá solo conductores APROBADOS');
    console.log(
      '📋 driver_requests contiene el historial completo de solicitudes\n'
    );

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

limpiarConductores();
