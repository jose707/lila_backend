// backend/src/scripts/fixConductorIdNull.js
const sequelize = require("../config/baseDatos");

const fixConductorIdNulo = async () => {
  try {
    // Alterar la columna driverId para que sea nullable
    await sequelize.query(
      `ALTER TABLE solicitud_conductor ALTER COLUMN "driverId" DROP NOT NULL;`
    );

    console.log('✅ Columna driverId ahora es nullable en driver_requests');
    process.exit(0);
  } catch (error) {
    console.error('Error al alterar la tabla:', error.message);
    process.exit(1);
  }
};

fixConductorIdNulo();
