// backend/src/scripts/checkData.js
const sequelize = require('../config/database');

async function checkData() {
  try {
    console.log('🔍 Verificando datos en la base de datos...\n');

    // Contar drivers
    const driversResult = await sequelize.query(
      'SELECT COUNT(*) as count FROM drivers;',
    );
    const driversCount = driversResult[0][0]?.count || 0;

    // Contar driver_requests
    const requestsResult = await sequelize.query(
      'SELECT COUNT(*) as count FROM driver_requests;',
    );
    const requestsCount = requestsResult[0][0]?.count || 0;

    // Contar request_files
    const filesResult = await sequelize.query(
      'SELECT COUNT(*) as count FROM request_files;',
    );
    const filesCount = filesResult[0][0]?.count || 0;

    console.log('📊 ESTADO DE LOS DATOS:');
    console.log('=====================');
    console.log(`drivers: ${driversCount}`);
    console.log(`driver_requests: ${requestsCount}`);
    console.log(`request_files: ${filesCount}`);

    if (driversCount === 0 && requestsCount === 0) {
      console.log('\n⚠️  SIN DATOS');
      console.log(
        'Necesitas que un conductor se registre usando /api/requests/register',
      );
      console.log('O migrar datos desde una BD anterior');
    } else if (driversCount > 0 && requestsCount === 0) {
      console.log('\n🔄 Hay drivers pero sin requests');
      console.log('Ejecuta: node src/scripts/migrateToRequests.js');
    } else {
      console.log('\n✅ Sistema listo para usar');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkData();
