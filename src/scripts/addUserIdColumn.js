// backend/src/scripts/addUserIdColumn.js
const sequelize = require('../config/database');

const addUserIdColumn = async () => {
  try {
    // Agregar la columna userId a driver_requests
    await sequelize.query(
      `ALTER TABLE driver_requests ADD COLUMN IF NOT EXISTS "userId" UUID;`,
    );

    console.log('✅ Columna userId agregada a driver_requests');
    process.exit(0);
  } catch (error) {
    console.error('Error al agregar columna:', error.message);
    process.exit(1);
  }
};

addUserIdColumn();
