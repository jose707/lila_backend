// backend/src/scripts/migrateARequests.js
const sequelize = require("../config/baseDatos");
const Conductor = require("../models/Conductor");
const ConductorSolicitud = require("../models/ConductorSolicitud");
const SolicitudArchivo = require("../models/SolicitudArchivo");

async function migrateConductoresHastaSolicitudes() {
  try {
    console.log('🔄 Migrando conductores antiguos al nuevo sistema...\n');

    // Obtener todos los conductores
    const conductores = await Conductor.findAll();
    console.log(`📊 Se encontraron ${conductores.length} conductores\n`);

    let migratedCantidad = 0;
    let archivosCreado = 0;

    for (const conductor of conductores) {
      try {
        // Verificar si ya existe un request para este driver
        const existenteSolicitud = await ConductorSolicitud.findOne({
          where: { userId: conductor.userId }
        });

        if (existenteSolicitud) {
          console.log(`⏭️  Driver ${conductor.id} ya tiene request, saltando...`);
          continue;
        }

        // Crear DriverRequest v1
        const solicitud = await ConductorSolicitud.create({
          userId: conductor.userId,
          version: 1,
          status: conductor.status || 'pendiente',
          rejectionReason: conductor.rejectionReason || null,
          metadata: {
            ciNumber: conductor.licenseNumber,
            vehicleType: conductor.vehicleType,
            vehiclePlate: conductor.vehiclePlate,
            vehicleYear: conductor.vehicleYear
          }
        });

        console.log(`✅ Creado request v1 para driver ${conductor.id}`);

        // Migrar documentos si existen
        if (conductor.documents && typeof conductor.documents === 'object') {
          const documentoTipos = [
          'profilePhoto',
          'ciFront',
          'ciBack',
          'antecedentsPhoto',
          'carFront',
          'carBack',
          'carLeft',
          'carRight',
          'soatPhoto',
          'ruatPhoto'];


          for (const documentoTipo of documentoTipos) {
            const nombreArchivo = conductor.documents[documentoTipo];
            if (nombreArchivo) {
              // Extraer solo el nombre del archivo
              const nombreArchivoPart = nombreArchivo.split('/').pop();

              await SolicitudArchivo.create({
                requestId: solicitud.id,
                fileType: documentoTipo,
                filename: nombreArchivoPart,
                status: 'pendiente'
              });

              archivosCreado++;
              console.log(`   📄 Migrado archivo: ${documentoTipo}`);
            }
          }
        }

        migratedCantidad++;
      } catch (error) {
        console.error(`❌ Error migrando driver ${conductor.id}:`, error.message);
      }
    }

    console.log(`\n✅ Migración completada:`);
    console.log(`   - Drivers migrados: ${migratedCantidad}`);
    console.log(`   - Archivos creados: ${archivosCreado}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

migrateConductoresHastaSolicitudes();
