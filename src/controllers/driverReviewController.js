'use strict';

const sequelize = require('../config/database');
const DriverRequest = require('../models/DriverRequest');
const DriverDomicile = require('../models/DriverDomicile');
const RequestFile = require('../models/RequestFile');
const UserIdentity = require('../models/UserIdentity');
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const { notify } = require('../services/notificationService');

const REQUIRED_FILES = [
  'licenseFront', 'licenseBack', 'ticPhoto', 'antecedentsPhoto',
  'ruatPhoto', 'soatPhoto', 'carFront', 'carBack',
  'domicileProof',
];

const isoDate = value => {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : (value || null);
};

const futureOrToday = value => {
  const date = isoDate(value);
  return !!date && new Date(`${date}T23:59:59.999Z`) >= new Date();
};

const comparableName = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z ]/g, ' ')
  .split(/\s+/).filter(Boolean).sort().join(' ');

const notifyApplicant = (userId, title, body, requestId) => {
  Promise.resolve(notify({ userId, title, body, type: 'system', data: { request_id: requestId } }))
    .catch(error => console.warn('No se pudo notificar la revisión:', error.message));
};

const approveDriver = async (req, res) => {
  const { requestId } = req.params;
  const verifiedDocuments = req.body?.verifiedDocuments;
  if (!Array.isArray(verifiedDocuments)) {
    return res.status(400).json({ error: 'Indica los documentos revisados.' });
  }
  const missingReview = REQUIRED_FILES.filter(type => !verifiedDocuments.includes(type));
  if (missingReview.length) {
    return res.status(400).json({ error: `Faltan documentos por aprobar: ${missingReview.join(', ')}.` });
  }

  let transaction;
  try {
    transaction = await sequelize.transaction();
    const request = await DriverRequest.findByPk(requestId, {
      transaction, lock: transaction.LOCK.UPDATE,
    });
    if (!request) { await transaction.rollback(); return res.status(404).json({ error: 'Solicitud no encontrada.' }); }
    if (request.status !== 'pending') {
      await transaction.rollback();
      return res.status(409).json({ error: 'Solo puede aprobarse una solicitud pendiente.' });
    }
    const latest = await DriverRequest.findOne({
      where: { userId: request.userId }, order: [['version', 'DESC']], transaction,
    });
    if (latest?.id !== request.id) {
      await transaction.rollback();
      return res.status(409).json({ error: 'Existe una versión más reciente de esta solicitud.' });
    }
    const identity = await UserIdentity.findOne({ where: { userId: request.userId }, transaction });
    if (identity?.verificationStatus !== 'verified') {
      await transaction.rollback();
      return res.status(400).json({ error: 'La cédula de identidad aún no está verificada.' });
    }
    const files = await RequestFile.findAll({ where: { requestId }, transaction });
    const missingFiles = REQUIRED_FILES.filter(type => !files.some(file => file.fileType === type));
    if (missingFiles.length) {
      await transaction.rollback();
      return res.status(400).json({ error: `Faltan archivos: ${missingFiles.join(', ')}.` });
    }
    const existingDriver = await Driver.findOne({ where: { userId: request.userId }, transaction });
    if (existingDriver) {
      await transaction.rollback();
      return res.status(409).json({ error: 'Esta persona ya tiene un registro de conductor.' });
    }

    const metadata = request.metadata || {};
    const domicile = await DriverDomicile.findOne({ where: { driverRequestId: request.id }, transaction });
    const coordinates = domicile?.location?.coordinates;
    if (!domicile || domicile.userId !== request.userId ||
        typeof domicile.address !== 'string' || domicile.address.trim().length < 8 ||
        !Array.isArray(coordinates) || coordinates.length !== 2 ||
        !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]) ||
        coordinates[0] < -180 || coordinates[0] > 180 ||
        coordinates[1] < -90 || coordinates[1] > 90) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Falta la dirección o ubicación válida del domicilio.' });
    }
    const license = metadata.ocr?.licenseFront?.fields || {};
    const licenseBack = metadata.ocr?.licenseBack?.fields || {};
    const tic = metadata.ocr?.ticPhoto?.fields || {};
    const ruat = metadata.ocr?.ruatPhoto?.fields || {};
    const soat = metadata.ocr?.soatPhoto?.fields || {};
    const identityName = [identity.firstNames, identity.paternalSurname, identity.maternalSurname]
      .filter(Boolean).join(' ');
    if (!license.licenseNumber || license.licenseNumber !== identity.ciNumber ||
        comparableName(license.fullName) !== comparableName(identityName) ||
        isoDate(license.birthDate) !== identity.birthDate ||
        !tic.fullName || comparableName(tic.fullName) !== comparableName(identityName) ||
        tic.licenseNumber !== license.licenseNumber ||
        comparableName(ruat.vehicleOwnerName) !== comparableName(identityName) ||
        String(ruat.vehicleOwnerCi || '').replace(/\D/g, '') !== String(identity.ciNumber).replace(/\D/g, '') ||
        !ruat.vehiclePlate || !ruat.vehicleBrand || !ruat.vehicleModel || !ruat.vehicleYear ||
        !futureOrToday(license.licenseExpiryDate) || !futureOrToday(soat.soatExpiryDate) ||
        soat.soatUse !== 'PUBLICO') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Los datos o vigencias de CI, licencia, TIC, RUAT y SOAT deben corregirse antes de aprobar.' });
    }
    const vehicleType = metadata.vehicleType;
    if (!['taxi', 'minibus', 'bus', 'motorcycle'].includes(vehicleType)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'El tipo de vehículo no es válido.' });
    }

    const driver = await Driver.create({
      userId: request.userId,
      status: 'approved',
      licenseNumber: license.licenseNumber,
      licenseNationality: license.nationality || null,
      licenseIssueDate: isoDate(license.issueDate),
      licenseExpiry: isoDate(license.licenseExpiryDate),
      licenseCategory: license.licenseCategory || null,
      licenseWearsGlasses: licenseBack.glasses === 'Sí',
      licenseUsesHearingAid: licenseBack.hearingAid === 'Sí',
      licenseVerificationStatus: 'verified',
      licenseVerifiedAt: new Date(),
      isAvailable: false,
    }, { transaction });
    const vehicle = await Vehicle.create({
      driver_id: driver.id,
      brand: ruat.vehicleBrand,
      model: ruat.vehicleModel,
      year: Number(ruat.vehicleYear),
      color: ruat.vehicleColor || null,
      plate: ruat.vehiclePlate,
      capacity: Number(ruat.vehiclePassengerCapacity) || 4,
      vehicle_type: vehicleType,
      registrationMunicipality: ruat.registrationMunicipality || null,
      crpvaNumber: ruat.crpvaNumber || null,
      ruatIssueDate: isoDate(ruat.ruatIssueDate),
      ownershipStartDate: isoDate(ruat.ownershipStartDate),
      doorCount: Number(ruat.doorCount) || null,
      serviceType: ruat.serviceType || null,
      chassisNumber: ruat.chassisNumber || null,
      engineNumber: ruat.engineNumber || null,
      fuelType: ruat.fuelType || null,
      engineDisplacement: ruat.engineDisplacement || null,
      engineType: ruat.engineType || null,
      legalObservations: ruat.legalObservations || null,
      ruatVerified: true,
      ruatVerifiedAt: new Date(),
      soatRosetteNumber: soat.soatRosetteNumber || null,
      soatStartDate: isoDate(soat.soatStartDate),
      soatExpiryDate: isoDate(soat.soatExpiryDate),
      soatUse: soat.soatUse,
      soatVerificationStatus: 'verified',
      soatVerifiedAt: new Date(),
      status: 'active',
    }, { transaction });
    await RequestFile.update(
      { status: 'verified', verifiedAt: new Date(), verifiedBy: req.user.id },
      { where: { requestId }, transaction },
    );
    await domicile.update({
      verificationStatus: 'verified', verifiedAt: new Date(), verifiedBy: req.user.id,
      rejectionReason: null,
    }, { transaction });
    await request.update({ status: 'approved', driverId: driver.id, rejectionReason: null, rejectedDocuments: [] }, { transaction });
    await transaction.commit();
    notifyApplicant(request.userId, 'Solicitud aprobada', 'Tu registro como conductor fue aprobado.', request.id);
    return res.json({ message: 'Solicitud aprobada.', driverId: driver.id, vehicleId: vehicle.id });
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    console.error('Error al aprobar solicitud:', error);
    return res.status(500).json({ error: 'No se pudo aprobar la solicitud.' });
  }
};

const decideRequest = status => async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Indica el motivo de la decisión.' });
  if (!Array.isArray(req.body?.rejectedDocuments) || !Array.isArray(req.body?.verifiedDocuments)) {
    return res.status(400).json({ error: 'Indica los documentos revisados.' });
  }
  const rejectedDocuments = [...new Set(req.body.rejectedDocuments)];
  const verifiedDocuments = [...new Set(req.body.verifiedDocuments)];
  if (status === 'observed' && !rejectedDocuments.length) {
    return res.status(400).json({ error: 'Selecciona al menos un documento para corregir.' });
  }
  if (status === 'observed' && REQUIRED_FILES.some(type =>
    !rejectedDocuments.includes(type) && !verifiedDocuments.includes(type))) {
    return res.status(400).json({ error: 'Revisa todos los documentos antes de observar la solicitud.' });
  }
  if (rejectedDocuments.some(type => verifiedDocuments.includes(type))) {
    return res.status(400).json({ error: 'Un documento no puede estar verificado y rechazado a la vez.' });
  }
  if (rejectedDocuments.some(type => !REQUIRED_FILES.includes(type)) ||
      verifiedDocuments.some(type => !REQUIRED_FILES.includes(type))) {
    return res.status(400).json({ error: 'Hay tipos de documento inválidos.' });
  }
  let transaction;
  try {
    transaction = await sequelize.transaction();
    const request = await DriverRequest.findByPk(req.params.requestId, {
      transaction, lock: transaction.LOCK.UPDATE,
    });
    if (!request) { await transaction.rollback(); return res.status(404).json({ error: 'Solicitud no encontrada.' }); }
    if (request.status !== 'pending') {
      await transaction.rollback();
      return res.status(409).json({ error: 'Solo puede resolverse una solicitud pendiente.' });
    }
    const latest = await DriverRequest.findOne({
      where: { userId: request.userId }, order: [['version', 'DESC']], transaction,
    });
    if (latest?.id !== request.id) {
      await transaction.rollback();
      return res.status(409).json({ error: 'Existe una versión más reciente de esta solicitud.' });
    }
    await RequestFile.update(
      { status: 'verified', verifiedAt: new Date(), verifiedBy: req.user.id },
      { where: { requestId: request.id, fileType: verifiedDocuments }, transaction },
    );
    await RequestFile.update(
      { status: 'rejected', verifiedAt: null, verifiedBy: req.user.id },
      { where: { requestId: request.id, fileType: rejectedDocuments }, transaction },
    );
    const domicile = await DriverDomicile.findOne({ where: { driverRequestId: request.id }, transaction });
    if (domicile && rejectedDocuments.includes('domicileProof')) {
      await domicile.update({
        verificationStatus: 'rejected', verifiedAt: null, verifiedBy: req.user.id,
        rejectionReason: reason,
      }, { transaction });
    } else if (domicile && verifiedDocuments.includes('domicileProof')) {
      await domicile.update({
        verificationStatus: 'verified', verifiedAt: new Date(), verifiedBy: req.user.id,
        rejectionReason: null,
      }, { transaction });
    }
    await request.update({
      status, rejectionReason: reason,
      rejectedDocuments,
      metadata: { ...(request.metadata || {}), finalRejection: status === 'rejected' },
    }, { transaction });
    await transaction.commit();
    notifyApplicant(request.userId,
      status === 'observed' ? 'Solicitud observada' : 'Solicitud rechazada',
      reason, request.id);
    return res.json({ message: status === 'observed' ? 'Solicitud observada.' : 'Solicitud rechazada.' });
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    console.error('Error al resolver solicitud:', error);
    return res.status(500).json({ error: 'No se pudo resolver la solicitud.' });
  }
};

module.exports = {
  approveDriver,
  observeDriver: decideRequest('observed'),
  rejectDriver: decideRequest('rejected'),
};
