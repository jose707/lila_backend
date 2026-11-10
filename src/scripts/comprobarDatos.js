// backend/src/scripts/comprobarDatos.js
const sequelize = require("../config/baseDatos");

async function comprobarDatos() {
  try {
    console.log('🔍 Verificando datos en la base de datos...\n');

    // Contar drivers
    const conductoresResultado = await sequelize.query(
      "SELECT COUNT(*) as count FROM conductor;"
    );
    const conductoresCantidad = conductoresResultado[0][0]?.count || 0;

    // Contar driver_requests
    const solicitudesResultado = await sequelize.query(
      "SELECT COUNT(*) as count FROM solicitud_conductor;"
    );
    const solicitudesCantidad = solicitudesResultado[0][0]?.count || 0;

    // Contar documentos (reemplaza a request_files)
    const archivosResultado = await sequelize.query(
      "SELECT COUNT(*) as count FROM documento;"
    );
    const archivosCantidad = archivosResultado[0][0]?.count || 0;

    console.log('📊 ESTADO DE LOS DATOS:');
    console.log('=====================');
    console.log(`drivers: ${conductoresCantidad}`);
    console.log(`driver_requests: ${solicitudesCantidad}`);
    console.log(`documents: ${archivosCantidad}`);

    if (conductoresCantidad === 0 && solicitudesCantidad === 0) {
      console.log('\n⚠️  SIN DATOS');
      console.log(
        'Necesitas que un conductor se registre usando /api/solicitudes/registrar'
      );
      console.log('O migrar datos desde una BD anterior');
    } else if (conductoresCantidad > 0 && solicitudesCantidad === 0) {
      console.log('\n🔄 Hay drivers pero sin requests');
      console.log('Ejecuta: node src/scripts/migrateARequests.js');
    } else {
      console.log('\n✅ Sistema listo para usar');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

comprobarDatos();
