// backend/src/scripts/migrateUsuarioIdAColumna.js
const sequelize = require("../config/baseDatos");

const migrateUsuarioIdHastaColumna = async () => {
  try {
    // Actualizar userId desde metadata donde sea null
    await sequelize.query(
      `UPDATE solicitud_conductor 
       SET "userId" = (metadata->>'userId')::UUID 
       WHERE "userId" IS NULL 
       AND metadata->>'userId' IS NOT NULL;`
    );

    console.log('✅ Datos migramos: userId actualizado desde metadata');
    process.exit(0);
  } catch (error) {
    console.error('Error al migrar datos:', error.message);
    process.exit(1);
  }
};

migrateUsuarioIdHastaColumna();
