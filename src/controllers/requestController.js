// backend/src/controllers/requestController.js
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const DriverRequest = require('../models/DriverRequest');
const RequestFile = require('../models/RequestFile');
const User = require('../models/User');
const UserIdentity = require('../models/UserIdentity');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ocrService = require('../services/ocrService');
const { cropForOcr } = require('../services/documentCrop');

const toIsoDate = value => {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : (value || null);
};

const REQUIRED_DRIVER_DOCUMENTS = [
  'licenseFront', 'licenseBack',
  'antecedentsPhoto', 'carFront', 'carBack',
  'soatPhoto', 'ruatPhoto',
];

const isFutureOrToday = value => {
  const iso = toIsoDate(value);
  if (!iso) return false;
  return new Date(`${iso}T23:59:59.999Z`) >= new Date();
};

const uploadDir = path.join(__dirname, '../uploads/drivers');

/**
 * Preprocesa la imagen para OCR: blanco y negro + estiramiento de contraste.
 * Vision lee mejor en escala de grises con contraste normalizado.
 */
async function preprocessForOcr(buffer) {
  try {
    return await sharp(buffer).grayscale().normalize().toBuffer();
  } catch (e) {
    console.warn('No se pudo preprocesar la imagen para OCR:', e.message);
    return buffer;
  }
}

/**
 * Extrae datos de una imagen de documento usando OCR.
 * POST /requests/ocr-extract  (multipart: image + documentType + recorte opcional)
 */
const extractDocument = async (req, res) => {
  try {
    const documentType = req.body && req.body.documentType;
    if (!Object.prototype.hasOwnProperty.call(ocrService.REQUIRED_BY_TYPE, documentType)) {
      return res.status(400).json({
        error: 'Se requiere el campo "documentType".',
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
    }


    // Geometría del molde de la cámara (si el cliente la envió)
    let cropRect = null;
    if (req.body) {
      const vals = [
        'cropX',
        'cropY',
        'cropW',
        'cropH',
        'cropScreenW',
        'cropScreenH',
      ].map((f) => parseFloat(req.body[f]));
      if (vals.every((v, index) => Number.isFinite(v) && (index < 2 ? v >= 0 : v > 0))) {
        cropRect = {
          x: vals[0],
          y: vals[1],
          w: vals[2],
          h: vals[3],
          screenW: vals[4],
          screenH: vals[5],
        };
        const outside =
          cropRect.x + cropRect.w > cropRect.screenW * 1.05 ||
          cropRect.y + cropRect.h > cropRect.screenH * 1.05;
        if (outside) cropRect = null;
      }
    }
    const wantCrop =
      cropRect ||
      (req.body &&
        (req.body.crop === '1' || req.body.crop === 'true' || req.body.crop === true));

    let buffer = req.file.buffer;
    // Rotate based on EXIF orientation so the image is upright for OCR.
    // Sharp's .rotate() reads the EXIF 'orientation' tag and applies the
    // correct transformation (90°, 270°, or flip) before any further processing.
    buffer = await sharp(buffer, { limitInputPixels: 24000000 }).rotate().toBuffer();
    if (wantCrop) buffer = await cropForOcr(buffer, cropRect, 0.05);
    buffer = await preprocessForOcr(buffer);
    buffer = await sharp(buffer).png().toBuffer();

    // Vista previa (reducida) de exactamente lo que se envía a Vision
    let previewBase64 = '';
    try {
      const preview = await sharp(buffer)
        .resize({ width: 480, withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      previewBase64 = `data:image/jpeg;base64,${preview.toString('base64')}`;
    } catch (e) {
      console.warn('No se pudo generar la vista previa:', e.message);
    }

    const { fields, rawText, missing, facesFound, rejected, rejectReason, words, classify } =
      await ocrService.extractDocument(buffer, documentType);

    if (rejected && (documentType === 'ciFront' || documentType === 'ciBack')) {
      console.log(
        `[OCR] ${documentType} rechazado. Clasificación:`,
        JSON.stringify(classify),
      );
    }

    res.json({
      documentType,
      fields,
      rawText,
      missing,
      facesFound,
      rejected,
      rejectReason,
      words,
      classify,
      previewBase64,
    });
  } catch (error) {
    console.error('Error extracting document:', error.name);
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'No se pudo analizar la imagen. Intenta una nueva captura.',
    });
  }
};

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
      fullName,
      birthDate,
      ciNumber,
      issueDate,
      expiryDate,
      birthPlace,
      address,
      occupation,
      maritalStatus,
      bloodType,
      antecedentsDate,
      vehicleType,
      vehiclePlate,
      vehicleYear,
      vehicleColor,
      vehiclePassengerCapacity,
      licenseExpiryDate,
      licenseCategory,
      licenseNumber,
      licenseIssueDate,
      licenseNationality,
      licenseGlasses,
      licenseHearingAid,
      vehicleBrand,
      vehicleModel,
      ocrData,
    } = req.body;

    // Datos OCR por documento (para verificación del admin)
    let ocr = {};
    if (typeof ocrData === 'string' && ocrData.trim()) {
      try {
        ocr = JSON.parse(ocrData);
      } catch (e) {
        console.warn('⚠️ ocrData inválido, se ignora:', e.message);
      }
    }

    // La licencia boliviana debe pertenecer a la misma persona que la CI.
    const compactIdentity = value => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(' ');
    const licenseOcr = ocr.licenseFront?.fields || {};
    const licenseBackOcr = ocr.licenseBack?.fields || {};
    const identity = await UserIdentity.findOne({ where: { userId } });
    if (!identity || identity.verificationStatus !== 'verified') {
      return res.status(400).json({ error: 'Debes verificar tu identidad con la cédula antes de solicitar ser conductor.' });
    }
    const officialName = [identity.firstNames, identity.paternalSurname, identity.maternalSurname]
      .filter(Boolean).join(' ');
    if (
      !licenseOcr.licenseNumber || !licenseOcr.fullName || !licenseOcr.birthDate ||
      licenseOcr.licenseNumber !== identity.ciNumber ||
      compactIdentity(licenseOcr.fullName) !== compactIdentity(officialName) ||
      toIsoDate(licenseOcr.birthDate) !== identity.birthDate
    ) {
      return res.status(400).json({
        error: 'La licencia debe contener y coincidir con el número, nombre y fecha de nacimiento de la identidad verificada.',
      });
    }
    if (licenseBackOcr.bloodType && identity.bloodType && licenseBackOcr.bloodType !== identity.bloodType) {
      return res.status(400).json({ error: 'El grupo sanguíneo de la licencia no coincide con la cédula.' });
    }
    const ruatOcr = ocr.ruatPhoto?.fields || {};
    const comparableCi = value => String(value || '').replace(/\D/g, '');
    if (
      !ruatOcr.vehicleOwnerName ||
      !ruatOcr.vehicleOwnerCi ||
      compactIdentity(ruatOcr.vehicleOwnerName) !== compactIdentity(officialName) ||
      comparableCi(ruatOcr.vehicleOwnerCi) !== comparableCi(identity.ciNumber)
    ) {
      return res.status(400).json({ error: 'El nombre o CI del propietario del RUAT no coincide con la identidad verificada.' });
    }
    if (
      licenseOcr.licenseNumber &&
      licenseBackOcr.licenseNumber &&
      (licenseOcr.licenseNumber !== licenseBackOcr.licenseNumber ||
        licenseOcr.issueDate !== licenseBackOcr.issueDate ||
        licenseOcr.licenseExpiryDate !== licenseBackOcr.licenseExpiryDate ||
        licenseOcr.licenseCategory !== licenseBackOcr.licenseCategory)
    ) {
      return res.status(400).json({
        error: 'Los datos del frente y reverso de la licencia no coinciden.',
      });
    }

    // Validate required fields
    if (
      !vehicleType ||
      !vehiclePlate ||
      !vehicleYear ||
      !vehicleColor ||
      !vehiclePassengerCapacity ||
      !licenseExpiryDate
    ) {
      return res.status(400).json({
        error:
          'Los datos del vehículo y licencia son requeridos.',
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

    // Validar edad (fecha de nacimiento DD/MM/YYYY extraída por OCR)
    if (birthDate) {
      const [d, m, y] = birthDate.split('/').map(Number);
      if (d && m && y) {
        const b = new Date(y, m - 1, d);
        const now = new Date();
        let age = now.getFullYear() - b.getFullYear();
        const mo = now.getMonth() - b.getMonth();
        if (mo < 0 || (mo === 0 && now.getDate() < b.getDate())) age--;
        if (age < 18) {
          return res.status(400).json({
            error: 'Debes ser mayor de 18 años para registrarte como conductor.',
          });
        }
      }
    }

    // Create first DriverRequest (version 1) - sin crear Driver aún
    const request = await DriverRequest.create({
      userId,
      driverId: null, // Se asignará cuando se apruebe
      version: 1,
      status: 'pending',
      metadata: {
        vehicleType: normalizedVehicleType,
        vehiclePlate,
        vehicleYear,
        vehicleColor,
        vehiclePassengerCapacity,
        licenseExpiryDate,
        licenseCategory: licenseCategory || undefined,
        licenseNumber: licenseNumber || undefined,
        licenseIssueDate: licenseIssueDate || undefined,
        licenseNationality: licenseNationality || undefined,
        licenseGlasses: licenseGlasses || undefined,
        licenseHearingAid: licenseHearingAid || undefined,
        vehicleBrand,
        vehicleModel,
        registrationMunicipality: ruatOcr.registrationMunicipality || undefined,
        crpvaNumber: ruatOcr.crpvaNumber || undefined,
        ruatIssueDate: ruatOcr.ruatIssueDate || undefined,
        ownershipStartDate: ruatOcr.ownershipStartDate || undefined,
        doorCount: ruatOcr.doorCount || undefined,
        serviceType: ruatOcr.serviceType || undefined,
        chassisNumber: ruatOcr.chassisNumber || undefined,
        engineNumber: ruatOcr.engineNumber || undefined,
        fuelType: ruatOcr.fuelType || undefined,
        engineDisplacement: ruatOcr.engineDisplacement || undefined,
        engineType: ruatOcr.engineType || undefined,
        legalObservations: ruatOcr.legalObservations || undefined,
        soatRosetteNumber: (ocr.soatPhoto?.fields || {}).soatRosetteNumber || undefined,
        soatStartDate: (ocr.soatPhoto?.fields || {}).soatStartDate || undefined,
        soatExpiryDate: (ocr.soatPhoto?.fields || {}).soatExpiryDate || undefined,
        soatUse: (ocr.soatPhoto?.fields || {}).soatUse || undefined,
        ocr,
      },
    });

    // Guardar archivos
    if (req.files) {
      console.log(
        '📁 Processing files for DriverRequest v1:',
        Object.keys(req.files),
      );
      const fileFields = [
        'licenseFront',
        'licenseBack',
        'antecedentsPhoto',
        'carFront',
        'carBack',
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

    // Decisión automática: no hay aprobación manual. El registro solo se
    // habilita si los documentos requeridos, cruces OCR y vigencias son válidos.
    const storedFiles = await RequestFile.findAll({ where: { requestId: request.id } });
    const storedTypes = new Set(storedFiles.map(file => file.fileType));
    const missingFiles = REQUIRED_DRIVER_DOCUMENTS.filter(type => !storedTypes.has(type));
    const soatOcr = ocr.soatPhoto?.fields || {};
    const automaticRejection =
      missingFiles.length ? `Faltan documentos obligatorios: ${missingFiles.join(', ')}.` :
      !isFutureOrToday(licenseOcr.licenseExpiryDate) ? 'La licencia de conducir está vencida o no tiene una fecha de vencimiento válida.' :
      !isFutureOrToday(soatOcr.soatExpiryDate) ? 'El SOAT está vencido o no tiene una fecha de vencimiento válida.' :
      soatOcr.soatUse !== 'PUBLICO' ? 'El SOAT debe indicar uso PUBLICO para registrar un vehículo de transporte.' :
      '';

    if (automaticRejection) {
      await request.update({ status: 'rejected', rejectionReason: automaticRejection });
      return res.status(422).json({
        error: automaticRejection,
        request: { id: request.id, version: request.version, status: 'rejected' },
      });
    }

    await RequestFile.update(
      { status: 'verified', verifiedAt: new Date() },
      { where: { requestId: request.id } },
    );

    const driver = await Driver.create({
      userId,
      status: 'approved',
      licenseNumber: licenseOcr.licenseNumber,
      licenseNationality: licenseOcr.nationality || null,
      licenseIssueDate: toIsoDate(licenseOcr.issueDate),
      licenseExpiry: toIsoDate(licenseOcr.licenseExpiryDate),
      licenseCategory: licenseOcr.licenseCategory || null,
      licenseWearsGlasses: licenseBackOcr.glasses === 'Sí',
      licenseUsesHearingAid: licenseBackOcr.hearingAid === 'Sí',
      licenseVerificationStatus: 'verified',
      licenseVerifiedAt: new Date(),
      isAvailable: true,
    });
    const vehicle = await Vehicle.create({
      driver_id: driver.id,
      brand: ruatOcr.vehicleBrand,
      model: ruatOcr.vehicleModel,
      year: parseInt(ruatOcr.vehicleYear),
      color: ruatOcr.vehicleColor,
      plate: ruatOcr.vehiclePlate,
      capacity: parseInt(ruatOcr.vehiclePassengerCapacity) || 4,
      vehicle_type: normalizedVehicleType,
      registrationMunicipality: ruatOcr.registrationMunicipality || null,
      crpvaNumber: ruatOcr.crpvaNumber || null,
      ruatIssueDate: toIsoDate(ruatOcr.ruatIssueDate),
      ownershipStartDate: toIsoDate(ruatOcr.ownershipStartDate),
      doorCount: parseInt(ruatOcr.doorCount) || null,
      serviceType: ruatOcr.serviceType || null,
      chassisNumber: ruatOcr.chassisNumber || null,
      engineNumber: ruatOcr.engineNumber || null,
      fuelType: ruatOcr.fuelType || null,
      engineDisplacement: ruatOcr.engineDisplacement || null,
      engineType: ruatOcr.engineType || null,
      legalObservations: ruatOcr.legalObservations || null,
      ruatVerified: true,
      ruatVerifiedAt: new Date(),
      soatRosetteNumber: soatOcr.soatRosetteNumber || null,
      soatStartDate: toIsoDate(soatOcr.soatStartDate),
      soatExpiryDate: toIsoDate(soatOcr.soatExpiryDate),
      soatUse: soatOcr.soatUse,
      soatVerificationStatus: 'verified',
      soatVerifiedAt: new Date(),
      status: 'active',
    });
    await request.update({ driverId: driver.id, status: 'approved' });

    res.status(201).json({
      message: 'Registro aprobado automáticamente.',
      request: {
        id: request.id,
        version: request.version,
        status: request.status,
      },
      driver: { id: driver.id },
      vehicle: { id: vehicle.id },
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
        status: 'verified',
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
              status: 'verified',
            },
          });
          if (!created) {
            // Update in case it exists with different status
            await fileRecord.update({
              filename: approvedFile.filename,
              fileSize: approvedFile.fileSize,
              mimeType: approvedFile.mimeType,
              status: 'verified',
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
  extractDocument,
};
