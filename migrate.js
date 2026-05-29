const sequelize = require('./src/config/database');
const initialSchema = require('./migrations/00000000-initial-schema');

const runMigrations = async () => {
  try {
    console.log('🔄 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    console.log('🔄 Ejecutando migración maestra...');
    await initialSchema.up(sequelize.queryInterface, sequelize.Sequelize);
    console.log('✅ Migración completada exitosamente');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error al ejecutar migración:', error.message);
    process.exit(1);
  }
};

runMigrations();
