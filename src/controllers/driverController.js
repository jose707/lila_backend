// backend/src/controllers/driverController.js
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const DriverRequest = require('../models/DriverRequest');
const RequestFile = require('../models/RequestFile');
const fs = require('fs');
const path = require('path');

// Crear directorio de uploads si no existe
const uploadDir = path.join(__dirname, '../uploads/drivers');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Register a new driver application
 * POST /drivers/register
 */
const registerDriver = async (req, res) => {
  try {
    console.log('Driver registration request received');
    console.log('Body:', req.body);
    console.log('Files:', req.files ? Object.keys(req.files) : 'no files');
    console.log('User:', req.user);

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    const {
      firstName,
      lastName,
      birthDate,
      ciNumber,
      antecedentsDate,
      vehicleType,
      vehiclePlate,
      vehicleYear,
    } = req.body;

    // Validate required fields
    if (!ciNumber || !vehicleType || !vehiclePlate || !vehicleYear) {
      console.log('Missing required fields:', {
        ciNumber,
        vehicleType,
        vehiclePlate,
        vehicleYear,
      });
      return res.status(400).json({
        error:
          'Los datos del vehículo y cédula de identidad son requeridos. Completa todos los campos.',
      });
    }

    // Validate vehicleType
    const validVehicleTypes = ['sedan', 'suv', 'van', 'motorcycle'];
    const normalizedVehicleType = vehicleType.toLowerCase();
    if (!validVehicleTypes.includes(normalizedVehicleType)) {
      return res.status(400).json({
        error: `Tipo de vehículo inválido. Valores permitidos: ${validVehicleTypes.join(
          ', ',
        )}`,
      });
    }

    // Check if driver already has a pending application
    const existingDriver = await Driver.findOne({
      where: { userId },
    });

    if (existingDriver) {
      return res.status(400).json({
        error: 'Ya tienes una solicitud de conductor en proceso',
      });
    }

    // Procesar y guardar archivos
    const documents = {
      profilePhoto: null,
      ciFront: null,
      ciBack: null,
      antecedentsPhoto: null,
      carFront: null,
      carBack: null,
      carLeft: null,
      carRight: null,
      soatPhoto: null,
      ruatPhoto: null,
    };

    // Procesar cada archivo si existe
    const fileFields = [
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

    if (req.files) {
      fileFields.forEach(field => {
        if (req.files[field] && req.files[field][0]) {
          const file = req.files[field][0];
          // Guardar la ruta relativa del archivo
          documents[field] = `/uploads/drivers/${file.filename}`;
          const fullPath = path.join(
            __dirname,
            '../uploads/drivers',
            file.filename,
          );
          const exists = fs.existsSync(fullPath);
          console.log(`File uploaded: ${field} -> ${documents[field]}`);
          console.log(`File path: ${fullPath}`);
          console.log(`File exists: ${exists}`);
        }
      });
    }

    // Create driver record
    const driver = await Driver.create({
      userId,
      licenseNumber: ciNumber,
      licenseExpiry: antecedentsDate
        ? new Date(antecedentsDate)
        : new Date(new Date().getFullYear() + 1, 0, 1),
      vehicleType: normalizedVehicleType,
      vehiclePlate,
      vehicleYear: parseInt(vehicleYear),
      vehicleColor: 'No especificado',
      vehicleModel: 'No especificado',
      documents,
      status: 'pending',
      backgroundCheckPassed: false,
      isAvailable: false,
    });

    // Update user profile with personal data if provided
    const user = await User.findByPk(userId);
    if (firstName || lastName) {
      await user.update({
        name: `${firstName || ''} ${lastName || ''}`.trim(),
      });
    }

    res.status(201).json({
      message: 'Solicitud de conductor registrada exitosamente',
      driver: {
        id: driver.id,
        status: driver.status,
        licenseNumber: driver.licenseNumber,
        vehicleType: driver.vehicleType,
        vehiclePlate: driver.vehiclePlate,
      },
    });
  } catch (error) {
    console.error('Error completo al registrar conductor:', error);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);

    // Validación de errores de Sequelize
    if (error.name === 'SequelizeUniqueConstraintError') {
      const field = error.errors?.[0]?.path || 'campo';
      const message = `El ${field} ya está registrado`;
      console.error('Unique constraint error:', message);
      return res.status(400).json({ error: message });
    }

    if (error.name === 'SequelizeValidationError') {
      const messages = error.errors?.map(e => e.message) || [];
      const message = messages.join(', ') || 'Datos inválidos';
      console.error('Validation error:', message);
      return res.status(400).json({ error: message });
    }

    if (error.name === 'SequelizeForeignKeyConstraintError') {
      console.error('Foreign key error:', error.message);
      return res.status(400).json({
        error: 'El usuario especificado no existe',
      });
    }

    // Mostrar el error exacto
    const errorMessage =
      error.message || 'Error al registrar la solicitud de conductor';
    console.error('Enviando error al cliente:', errorMessage);
    res.status(500).json({
      error: errorMessage,
      details: error.errors ? error.errors.map(e => e.message) : [],
    });
  }
};

/**
 * Get driver application status for current user
 * GET /drivers/status
 */
const getDriverStatus = async (req, res) => {
  try {
    console.log('getDriverStatus called');
    const userId = req.user?.id;
    console.log('User ID:', userId);

    if (!userId) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    const driver = await Driver.findOne({
      where: { userId },
    });

    console.log('Driver found:', driver ? 'Yes' : 'No');
    if (driver) {
      console.log('Driver status:', driver.status);
    }

    if (!driver) {
      // Usuario no tiene solicitud de conductor
      return res.status(200).json({
        hasApplication: false,
        status: null,
        driver: null,
      });
    }

    // Obtener datos del vehículo (incluye estado RUAT)
    const vehicle = await Vehicle.findOne({ where: { driver_id: driver.id } });

    // Usuario tiene solicitud
    res.status(200).json({
      hasApplication: true,
      status: driver.status,
      driver: {
        id: driver.id,
        status: driver.status,
        licenseNumber: driver.licenseNumber,
        vehicleType: driver.vehicleType,
        vehiclePlate: driver.vehiclePlate,
        rejectionReason: driver.rejectionReason,
        documents: driver.documents,
        createdAt: driver.createdAt,
        vehicle: vehicle
          ? {
              id: vehicle.id,
              ruatFile: vehicle.ruatFile,
              ruatVerified: vehicle.ruatVerified,
              ruatVerifiedAt: vehicle.ruatVerifiedAt,
              ruatRequired: vehicle.ruatRequired,
              ruatRequiredReason: vehicle.ruatRequiredReason,
              ruatRequiredAt: vehicle.ruatRequiredAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Error getting driver status:', error);
    res.status(500).json({
      error: 'Error al obtener estado de solicitud',
    });
  }
};

/**
 * Resubmit rejected documents
 * POST /drivers/resubmit
 */
const resubmitDocuments = async (req, res) => {
  try {
    console.log('Document resubmission request received');
    console.log('Files:', req.files ? Object.keys(req.files) : 'no files');
    console.log('User:', req.user);

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    // Find driver by userId
    let driver = await Driver.findOne({ where: { userId } });

    if (!driver) {
      return res.status(404).json({
        error: 'No hay solicitud de conductor para reenviar',
      });
    }

    if (driver.status !== 'rejected') {
      return res.status(400).json({
        error: 'Solo se pueden reenviar documentos de solicitudes rechazadas',
      });
    }

    // Update documents with new uploads (solo los documentos que vienen)
    const documents = driver.documents || {};
    const resubmittedDocuments = {};

    if (req.files?.profilePhoto) {
      documents.profilePhoto =
        '/uploads/drivers/' + req.files.profilePhoto[0].filename;
      resubmittedDocuments.profilePhoto = true;
    }
    if (req.files?.ciFront) {
      documents.ciFront = '/uploads/drivers/' + req.files.ciFront[0].filename;
      resubmittedDocuments.ciFront = true;
    }
    if (req.files?.ciBack) {
      documents.ciBack = '/uploads/drivers/' + req.files.ciBack[0].filename;
      resubmittedDocuments.ciBack = true;
    }
    if (req.files?.antecedentsPhoto) {
      documents.antecedentsPhoto =
        '/uploads/drivers/' + req.files.antecedentsPhoto[0].filename;
      resubmittedDocuments.antecedentsPhoto = true;
    }
    if (req.files?.carFront) {
      documents.carFront = '/uploads/drivers/' + req.files.carFront[0].filename;
      resubmittedDocuments.carFront = true;
    }
    if (req.files?.carBack) {
      documents.carBack = '/uploads/drivers/' + req.files.carBack[0].filename;
      resubmittedDocuments.carBack = true;
    }
    if (req.files?.carLeft) {
      documents.carLeft = '/uploads/drivers/' + req.files.carLeft[0].filename;
      resubmittedDocuments.carLeft = true;
    }
    if (req.files?.carRight) {
      documents.carRight = '/uploads/drivers/' + req.files.carRight[0].filename;
      resubmittedDocuments.carRight = true;
    }
    if (req.files?.soatPhoto) {
      documents.soatPhoto =
        '/uploads/drivers/' + req.files.soatPhoto[0].filename;
      resubmittedDocuments.soatPhoto = true;
    }
    if (req.files?.ruatPhoto) {
      documents.ruatPhoto =
        '/uploads/drivers/' + req.files.ruatPhoto[0].filename;
      resubmittedDocuments.ruatPhoto = true;
    }

    // Crear objeto de documentos pendientes = todos menos los aprobados
    const approvedDocuments = driver.approvedDocuments || {};
    const pendingDocuments = {};

    // Los documentos reenviados ahora están pendientes de revisión
    Object.keys(resubmittedDocuments).forEach(key => {
      pendingDocuments[key] = 'pending';
    });

    // Los documentos aprobados siguen siendo aprobados
    Object.entries(approvedDocuments).forEach(([key, value]) => {
      if (value && !resubmittedDocuments[key]) {
        pendingDocuments[key] = 'approved';
      }
    });

    console.log('Resubmitted documents:', resubmittedDocuments);
    console.log('Approved documents from DB:', approvedDocuments);
    console.log('Pending status map:', pendingDocuments);
    console.log('Documents object BEFORE update:', driver.documents);

    // Update driver status back to pending
    driver.status = 'pending';
    driver.documents = documents; // Actualizar con nuevas rutas
    driver.rejectionReason = null; // Clear rejection reason
    driver.backgroundCheckPassed = false;
    driver.documentStatus = pendingDocuments; // Nuevo campo para rastrear estado
    driver.approvedDocuments = approvedDocuments; // Asegurar que approvedDocuments persiste

    // Usar setDataValue para asegurar que Sequelize detecte cambios en JSON
    driver.setDataValue('documents', documents);
    driver.setDataValue('documentStatus', pendingDocuments);
    driver.setDataValue('approvedDocuments', approvedDocuments);

    await driver.save();

    // Recargar desde DB para verificar que se guardó correctamente
    const updatedDriver = await Driver.findByPk(driver.id);
    console.log(
      'Documents object AFTER save from DB:',
      updatedDriver.documents,
    );

    res.json({
      message: 'Documentos reenviados correctamente',
      driver: {
        id: driver.id,
        status: driver.status,
        documents: driver.documents,
      },
    });
  } catch (error) {
    console.error('Error resubmitting documents:', error);
    res.status(500).json({
      error: 'Error al reenviar documentos: ' + error.message,
    });
  }
};

/**
 * 📍 Actualizar ubicación del conductor en tiempo real
 * PUT /drivers/location
 */
const updateDriverLocation = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { latitude, longitude } = req.body;

    console.log('📍 [updateDriverLocation] Actualizando ubicación:', {
      userId,
      latitude,
      longitude,
    });

    if (!userId) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    if (!latitude || !longitude) {
      return res.status(400).json({
        error: 'Debe proporcionar latitude y longitude',
      });
    }

    // Encontrar el conductor asociado al usuario
    const driver = await Driver.findOne({
      where: { userId },
    });

    if (!driver) {
      return res.status(404).json({
        error: 'Conductor no encontrado',
      });
    }

    // Guardar ubicación en driver_locations (upsert: crea o actualiza)
    const DriverLocation = require('../models/DriverLocation');
    await DriverLocation.upsert({
      driver_id: driver.id,
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      },
      is_online: true,
    });

    console.log('✅ [updateDriverLocation] Ubicación actualizada:', {
      driverId: driver.id,
      latitude,
      longitude,
    });

    res.json({
      message: 'Ubicación actualizada exitosamente',
      driver: {
        id: driver.id,
        currentLocation: {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
        },
      },
    });
  } catch (error) {
    console.error('❌ [updateDriverLocation] Error:', error);
    res.status(500).json({
      error: 'Error al actualizar ubicación',
      details: error.message,
    });
  }
};

/**
 * Conductor sube su RUAT para verificación del vehículo
 * POST /drivers/submit-ruat
 */
const submitRuat = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ error: 'Usuario no autenticado' });

    const driver = await Driver.findOne({ where: { userId } });
    if (!driver)
      return res
        .status(404)
        .json({ error: 'Perfil de conductor no encontrado' });

    const vehicle = await Vehicle.findOne({ where: { driver_id: driver.id } });
    if (!vehicle)
      return res.status(404).json({ error: 'Vehículo no encontrado' });

    if (!req.files?.ruatPhoto?.[0]) {
      return res.status(400).json({ error: 'No se recibió la foto del RUAT' });
    }

    const file = req.files.ruatPhoto[0];

    // Buscar la última DriverRequest del conductor para vincular el RequestFile
    const latestRequest = await DriverRequest.findOne({
      where: { userId },
      order: [['version', 'DESC']],
    });

    if (!latestRequest) {
      return res
        .status(404)
        .json({ error: 'No se encontró solicitud de conductor' });
    }

    // Crear o actualizar el RequestFile de tipo ruatPhoto vinculado a esa request
    const [fileRecord, created] = await RequestFile.findOrCreate({
      where: { requestId: latestRequest.id, fileType: 'ruatPhoto' },
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
    }

    // Guardar referencia del archivo en el vehículo y limpiar el requerimiento
    // ruat_file != null && ruat_verified = false  →  "en revisión"
    await vehicle.update({
      ruatFile: file.filename,
      ruatRequired: false,
      ruatRequiredAt: null,
    });

    console.log(
      `📄 RUAT enviado por driver ${driver.id}: ${file.filename} → RequestFile ${fileRecord.id}`,
    );

    res.json({
      message:
        'RUAT enviado correctamente. El administrador lo revisará pronto.',
      vehicle: {
        id: vehicle.id,
        ruatFile: vehicle.ruatFile,
        ruatRequired: vehicle.ruatRequired,
        ruatVerified: vehicle.ruatVerified,
      },
    });
  } catch (error) {
    console.error('Error al enviar RUAT:', error);
    res
      .status(500)
      .json({ error: 'Error al enviar el RUAT: ' + error.message });
  }
};

module.exports = {
  registerDriver,
  getDriverStatus,
  resubmitDocuments,
  updateDriverLocation,
  submitRuat,
};
