// backend/src/scripts/removeDriverRedundantColumns.js
const sequelize = require('../config/database');
const Driver = require('../models/Driver');

const migrateDatabase = async () => {
  try {
    console.log('🔄 Iniciando migración - Eliminando columnas redundantes...');

    // Sync the database with the updated model
    // This will remove columns that no longer exist in the model definition
    await sequelize.sync({ alter: true });

    console.log('✅ Migración completada exitosamente');
    console.log('✅ Eliminadas columnas redundantes:');
    console.log('   - approvedDocuments');
    console.log('   - documentStatus');
    console.log(
      '\n📝 Nota: La tabla driver_requests maneja el ciclo de aprobación de documentos',
    );

    process.exit(0);
  } catch (error) {
    console.error('❌ Migración fallida:', error);
    process.exit(1);
  }
};

migrateDatabase();
