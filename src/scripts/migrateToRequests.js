// backend/src/scripts/migrateToRequests.js
const sequelize = require('../config/database');
const Driver = require('../models/Driver');
const DriverRequest = require('../models/DriverRequest');
const RequestFile = require('../models/RequestFile');

async function migrateDriversToRequests() {
  try {
    console.log('🔄 Migrando conductores antiguos al nuevo sistema...\n');

    // Obtener todos los conductores
    const drivers = await Driver.findAll();
    console.log(`📊 Se encontraron ${drivers.length} conductores\n`);

    let migratedCount = 0;
    let filesCreated = 0;

    for (const driver of drivers) {
      try {
        // Verificar si ya existe un request para este driver
        const existingRequest = await DriverRequest.findOne({
          where: { driverId: driver.id },
        });

        if (existingRequest) {
          console.log(`⏭️  Driver ${driver.id} ya tiene request, saltando...`);
          continue;
        }

        // Crear DriverRequest v1
        const request = await DriverRequest.create({
          driverId: driver.id,
          version: 1,
          status: driver.status || 'pending',
          rejectionReason: driver.rejectionReason || null,
          metadata: {
            ciNumber: driver.licenseNumber,
            vehicleType: driver.vehicleType,
            vehiclePlate: driver.vehiclePlate,
            vehicleYear: driver.vehicleYear,
          },
        });

        console.log(`✅ Creado request v1 para driver ${driver.id}`);

        // Migrar documentos si existen
        if (driver.documents && typeof driver.documents === 'object') {
          const docTypes = [
            'profilePhoto',
            'ciFront',
            'ciBack',
            'antecedentsPhoto',
            'carFront',
            'carBack',
            'carLeft',
            'carRight',
            'soatPhoto',
            'ruatPhoto',
          ];

          for (const docType of docTypes) {
            const filename = driver.documents[docType];
            if (filename) {
              // Extraer solo el nombre del archivo
              const filenamePart = filename.split('/').pop();

              await RequestFile.create({
                requestId: request.id,
                fileType: docType,
                filename: filenamePart,
                status: 'pending',
              });

              filesCreated++;
              console.log(`   📄 Migrado archivo: ${docType}`);
            }
          }
        }

        migratedCount++;
      } catch (error) {
        console.error(`❌ Error migrando driver ${driver.id}:`, error.message);
      }
    }

    console.log(`\n✅ Migración completada:`);
    console.log(`   - Drivers migrados: ${migratedCount}`);
    console.log(`   - Archivos creados: ${filesCreated}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

migrateDriversToRequests();
