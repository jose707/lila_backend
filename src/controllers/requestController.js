// backend/src/controllers/requestController.js
const Driver = require('../models/Driver');
const DriverRequest = require('../models/DriverRequest');
const RequestFile = require('../models/RequestFile');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, '../uploads/drivers');

/**
 * Register a new driver - creates first DriverRequest
 * POST /requests/register
 */
const registerDriver = async (req, res) => {
  try {
    console.log('Driver registration request received');
    console.log(
      'Files received:',
      req.files ? Object.keys(req.files) : 'NO FILES',
    );
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const {
      firstName,
      lastName,
      ciNumber,
      antecedentsDate,
      vehicleType,
      vehiclePlate,
      vehicleYear,
      vehicleColor,
      vehiclePassengerCapacity,
      licenseExpiryDate,
      vehicleBrand,
      vehicleModel,
    } = req.body;

    // Validate required fields
    if (
      !ciNumber ||
      !vehicleType ||
      !vehiclePlate ||
      !vehicleYear ||
      !vehicleColor ||
      !vehiclePassengerCapacity ||
      !licenseExpiryDate
    ) {
      return res.status(400).json({
        error:
          'Los datos del vehículo, licencia y cédula de identidad son requeridos.',
      });
    }

    const validVehicleTypes = ['taxi', 'minibus', 'bus', 'motorcycle'];
    const normalizedVehicleType = vehicleType.toLowerCase();
    if (!validVehicleTypes.includes(normalizedVehicleType)) {
      return res.status(400).json({
        error: `Tipo de vehículo inválido. Valores permitidos: ${validVehicleTypes.join(
          ', ',
        )}`,
      });
    }

    // Create first DriverRequest (version 1) - sin crear Driver aún
    const request = await DriverRequest.create({
      userId,
      driverId: null, // Se asignará cuando se apruebe
      version: 1,
      status: 'pending',
      metadata: {
        ciNumber,
        vehicleType: normalizedVehicleType,
        vehiclePlate,
        vehicleYear,
        vehicleColor,
        vehiclePassengerCapacity,
        licenseExpiryDate,
        vehicleBrand,
        vehicleModel,
      },
    });

    // Guardar archivos
    if (req.files) {
      console.log(
        '📁 Processing files for DriverRequest v1:',
        Object.keys(req.files),
      );
      const fileFields = [
        'profilePhoto',
        'ciFront',
        'ciBack',
        'licenseFront',
        'licenseBack',
        'antecedentsPhoto',
        'carFront',
        'carBack',
        'carLeft',
        'carRight',
        'soatPhoto',
        'ruatPhoto',
      ];

      for (const field of fileFields) {
        if (req.files[field] && req.files[field][0]) {
          const file = req.files[field][0];
          try {
            // Use findOrCreate to avoid duplicates
            const [fileRecord, created] = await RequestFile.findOrCreate({
              where: {
                requestId: request.id,
                fileType: field,
              },
              defaults: {
                filename: file.filename,
                fileSize: file.size,
                mimeType: file.mimetype,
                status: 'pending',
              },
            });

            // If it already existed, update it
            if (!created) {
              await fileRecord.update({
                filename: file.filename,
                fileSize: file.size,
                mimeType: file.mimetype,
                status: 'pending',
              });
              console.log(`🔄 File updated: ${field} -> ${file.filename}`);
            } else {
              console.log(`✅ File saved: ${field} -> ${file.filename}`);
            }
          } catch (fileError) {
            console.error(`❌ Error saving ${field}:`, fileError.message);
          }
        } else {
          console.log(`⏭️  File not provided: ${field}`);
        }
      }
    } else {
      console.log('⚠️ NO FILES received in request');
    }

    // Update user profile
    const user = await User.findByPk(userId);
    if (firstName || lastName) {
      await user.update({
        name: `${firstName || ''} ${lastName || ''}`.trim(),
      });
    }

    res.status(201).json({
      message: 'Solicitud de conductor creada correctamente',
      request: {
        id: request.id,
        version: request.version,
        status: request.status,
      },
    });
  } catch (error) {
    console.error('Error registering driver:', error);
    res.status(500).json({
      error: 'Error al crear solicitud de conductor: ' + error.message,
    });
  }
};

/**
 * Get current driver request status
 * GET /requests/status
 */
const getRequestStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    // Buscar la solicitud más reciente por userId (nuevo sistema)
    const latestRequest = await DriverRequest.findOne({
      where: { userId },
      order: [['version', 'DESC']],
    });

    if (!latestRequest) {
      return res.status(200).json({
        hasApplication: false,
        status: null,
      });
    }

    // Get files for this request
    const files = await RequestFile.findAll({
      where: { requestId: latestRequest.id },
    });

    const documents = {};
    files.forEach(file => {
      const BASE_URL =
        process.env.API_BASE_URL ||
        `http://localhost:${process.env.PORT || 3000}`;
      documents[file.fileType] = {
        filename: file.filename,
        url: `${BASE_URL}/uploads/drivers/${file.filename}`,
        status: file.status,
        uploadedAt: file.uploadedAt,
      };
    });

    res.status(200).json({
      hasApplication: true,
      status: latestRequest.status,
      request: {
        id: latestRequest.id,
        version: latestRequest.version,
        status: latestRequest.status,
        rejectionReason: latestRequest.rejectionReason,
        rejectedDocuments: latestRequest.rejectedDocuments || [],
        metadata: latestRequest.metadata || {},
        documents,
        createdAt: latestRequest.createdAt,
      },
    });
  } catch (error) {
    console.error('Error getting request status:', error);
    res.status(500).json({
      error: 'Error al obtener estado de solicitud',
    });
  }
};

/**
 * Resubmit documents - creates new DriverRequest version
 * POST /requests/resubmit
 */
const resubmitDocuments = async (req, res) => {
  try {
    console.log('Document resubmission request received');
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    // Get latest request by userId (nuevo sistema)
    const latestRequest = await DriverRequest.findOne({
      where: { userId },
      order: [['version', 'DESC']],
    });

    if (!latestRequest) {
      return res.status(404).json({
        error: 'No hay solicitud de conductor para reenviar',
      });
    }

    if (latestRequest.status !== 'rejected') {
      return res.status(400).json({
        error: 'Solo se pueden reenviar documentos de solicitudes rechazadas',
      });
    }

    // Merge updated metadata fields if provided by the user
    const { licenseExpiryDate, vehicleColor, vehiclePassengerCapacity } =
      req.body;

    const updatedMetadata = {
      ...(latestRequest.metadata || {}),
      ...(licenseExpiryDate !== undefined && licenseExpiryDate !== ''
        ? { licenseExpiryDate }
        : {}),
      ...(vehicleColor !== undefined && vehicleColor !== ''
        ? { vehicleColor }
        : {}),
      ...(vehiclePassengerCapacity !== undefined &&
      vehiclePassengerCapacity !== ''
        ? { vehiclePassengerCapacity }
        : {}),
    };

    console.log('Updated metadata for new request version:', updatedMetadata);

    // Create new request version
    const newRequest = await DriverRequest.create({
      userId,
      driverId: latestRequest.driverId, // Mantener mismo driverId (null si aún no aprobado)
      version: latestRequest.version + 1,
      status: 'pending',
      metadata: updatedMetadata,
    });

    console.log(`Created new request version: ${newRequest.version}`);
    console.log(
      `Previous request ID: ${latestRequest.id}, Status: ${latestRequest.status}, Version: ${latestRequest.version}`,
    );

    // Get previously approved files from the PREVIOUS rejected request (not newRequest)
    const previousApprovedFiles = await RequestFile.findAll({
      where: {
        requestId: latestRequest.id, // Esta es la versión anterior rechazada
        status: 'approved',
      },
    });

    console.log(
      `Found ${previousApprovedFiles.length} approved files from previous version`,
    );

    // Save new files
    const resubmittedFiles = new Set();
    if (req.files) {
      const fileFields = [
        'profilePhoto',
        'ciFront',
        'ciBack',
        'licenseFront',
        'licenseBack',
        'antecedentsPhoto',
        'carFront',
        'carBack',
        'carLeft',
        'carRight',
        'soatPhoto',
        'ruatPhoto',
      ];

      for (const field of fileFields) {
        if (req.files[field] && req.files[field][0]) {
          const file = req.files[field][0];
          try {
            const [fileRecord, created] = await RequestFile.findOrCreate({
              where: {
                requestId: newRequest.id,
                fileType: field,
              },
              defaults: {
                filename: file.filename,
                fileSize: file.size,
                mimeType: file.mimetype,
                status: 'pending',
              },
            });
            if (!created) {
              await fileRecord.update({
                filename: file.filename,
                fileSize: file.size,
                mimeType: file.mimetype,
                status: 'pending',
              });
              console.log(
                `Resubmitted file (updated): ${field} -> ${file.filename}`,
              );
            } else {
              console.log(
                `Resubmitted file (new): ${field} -> ${file.filename}`,
              );
            }
            resubmittedFiles.add(field);
          } catch (fileError) {
            console.error(`Error saving ${field}:`, fileError.message);
          }
        }
      }
    }

    // Copy previously approved files that weren't resubmitted
    console.log(
      `Copying ${previousApprovedFiles.length} approved files from version ${latestRequest.version}`,
    );
    for (const approvedFile of previousApprovedFiles) {
      if (!resubmittedFiles.has(approvedFile.fileType)) {
        console.log(
          `Copying ${approvedFile.fileType} - status will be 'approved'`,
        );
        try {
          const [fileRecord, created] = await RequestFile.findOrCreate({
            where: {
              requestId: newRequest.id,
              fileType: approvedFile.fileType,
            },
            defaults: {
              filename: approvedFile.filename,
              fileSize: approvedFile.fileSize,
              mimeType: approvedFile.mimeType,
              status: 'approved',
            },
          });
          if (!created) {
            // Update in case it exists with different status
            await fileRecord.update({
              filename: approvedFile.filename,
              fileSize: approvedFile.fileSize,
              mimeType: approvedFile.mimeType,
              status: 'approved',
            });
          }
          console.log(
            `✅ Copied approved file: ${approvedFile.fileType} from previous version`,
          );
        } catch (copyError) {
          console.error(
            `❌ Error copying ${approvedFile.fileType}:`,
            copyError.message,
          );
        }
      }
    }

    // ⚠️ NO actualizamos latestRequest aquí.
    // La versión rechazada (latestRequest) debe permanecer con status='rejected'
    // en la BD para mantener el historial correcto.
    // La nueva versión (newRequest) ya tiene status='pending' por defecto.

    res.json({
      message: 'Documentos reenviados correctamente',
      request: {
        id: newRequest.id,
        version: newRequest.version,
        status: newRequest.status,
      },
    });
  } catch (error) {
    console.error('Error resubmitting documents:', error);
    res.status(500).json({
      error: 'Error al reenviar documentos: ' + error.message,
    });
  }
};

module.exports = {
  registerDriver,
  getRequestStatus,
  resubmitDocuments,
};
