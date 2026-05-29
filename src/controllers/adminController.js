// backend/src/controllers/adminController.js
const User = require('../models/User');
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const Ride = require('../models/Ride');
const Payment = require('../models/Payment');
const DriverRequest = require('../models/DriverRequest');
const RequestFile = require('../models/RequestFile');
const sequelize = require('../config/database');
const { Op } = require('sequelize');

const getAllUsers = async (req, res) => {
  try {
    const { search, role, limit = 20, offset = 0, inactive } = req.query;
    const whereClause = {};

    // Si inactive=true, mostrar solo inactivos; si no, mostrar solo activos
    whereClause.isActive = inactive === 'true' ? false : true;

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (role) {
      whereClause.role = role;
    }

    const users = await User.findAll({
      where: whereClause,
      attributes: { exclude: ['password'] },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
    });

    const total = await User.count({ where: whereClause });

    res.status(200).json({
      users,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({
      error: 'Error al obtener usuarios',
    });
  }
};

const getAllDrivers = async (req, res) => {
  try {
    const { status, search, limit = 20, offset = 0 } = req.query;
    const whereClause = { userId: { [Op.not]: null } };

    if (status) {
      whereClause.status = status;
    }

    // Obtener la solicitud más reciente por usuario
    const requests = await DriverRequest.findAll({
      where: whereClause,
      order: [
        ['userId', 'ASC'],
        ['version', 'DESC'],
      ],
      raw: false,
    });

    // Agrupar por userId y quedarse solo con la versión más reciente
    const latestByUser = {};
    requests.forEach(req => {
      if (!latestByUser[req.userId]) {
        latestByUser[req.userId] = req;
      }
    });

    const uniqueRequests = Object.values(latestByUser).slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit),
    );

    // Para cada solicitud, obtener sus archivos y usuario
    const requestsWithFiles = await Promise.all(
      uniqueRequests.map(async request => {
        // Obtener el usuario
        const user = await User.findByPk(request.userId, {
          attributes: { exclude: ['password'] },
        });

        const requestFiles = await RequestFile.findAll({
          where: { requestId: request.id },
        });

        console.log(`📋 Request ${request.id} (v${request.version}):`, {
          status: request.status,
          fileCount: requestFiles.length,
          files: requestFiles.map(f => `${f.fileType}(${f.status})`).join(', '),
        });

        // Log detallado de archivos
        requestFiles.forEach(f => {
          console.log(`  - ${f.fileType}: ${f.filename} [${f.status}]`);
        });

        let files = {};
        requestFiles.forEach(file => {
          const BASE_URL =
            process.env.API_BASE_URL ||
            `http://localhost:${process.env.PORT || 3000}`;
          files[file.fileType] = {
            filename: file.filename,
            url: `${BASE_URL}/uploads/drivers/${file.filename}`,
            status: file.status,
            uploadedAt: file.uploadedAt,
          };
        });

        console.log(
          `Final files object keys for request ${request.id}:`,
          Object.keys(files),
        );

        // Incluir datos del vehículo si la solicitud tiene driverId (aprobada)
        let vehicleData = null;
        if (request.driverId) {
          const vehicle = await Vehicle.findOne({
            where: { driver_id: request.driverId },
          });
          if (vehicle) {
            const BASE_URL =
              process.env.API_BASE_URL ||
              `http://localhost:${process.env.PORT || 3000}`;
            vehicleData = {
              id: vehicle.id,
              // ruatFile != null && ruatVerified = false → "en revisión"
              // ruatFile != null && ruatVerified = true  → "aprobado"
              ruatFile: vehicle.ruatFile || null,
              ruatFileUrl: vehicle.ruatFile
                ? `${BASE_URL}/uploads/drivers/${vehicle.ruatFile}`
                : null,
              ruatVerified: vehicle.ruatVerified,
              ruatVerifiedAt: vehicle.ruatVerifiedAt,
              ruatRequired: vehicle.ruatRequired,
              ruatRequiredReason: vehicle.ruatRequiredReason,
              ruatRequiredAt: vehicle.ruatRequiredAt,
            };
          }
        }

        return {
          ...request.toJSON(),
          User: user ? user.toJSON() : null,
          files,
          vehicle: vehicleData,
          driver: request.driverId ? { id: request.driverId } : null,
        };
      }),
    );

    const total = Object.keys(latestByUser).length;

    res.status(200).json({
      requests: requestsWithFiles,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error al obtener solicitudes de conductores:', error);
    res.status(500).json({
      error: 'Error al obtener solicitudes',
    });
  }
};

const approveDriver = async (req, res) => {
  try {
    const { requestId } = req.params;

    // Obtener la solicitud del conductor
    const request = await DriverRequest.findByPk(requestId);
    if (!request) {
      return res.status(404).json({
        error: 'Solicitud no encontrada',
      });
    }

    if (request.status === 'approved') {
      return res.status(400).json({
        error: 'Esta solicitud ya fue aprobada',
      });
    }

    // Obtener userId del request (ahora es columna directa)
    const userId = request.userId;

    if (!userId) {
      return res.status(400).json({
        error: 'No se encontró el usuario en la solicitud',
      });
    }

    // Obtener los datos del vehículo de metadata
    const metadata = request.metadata || {};
    // Detectar si el RUAT fue enviado y aprobado en esta solicitud
    const ruatFile = await RequestFile.findOne({
      where: {
        requestId: request.id,
        fileType: 'ruatPhoto',
        status: 'approved',
      },
    });

    // Crear el Driver con los datos de la solicitud
    const driver = await Driver.create({
      userId,
      status: 'approved',
      licenseNumber: metadata.ciNumber,
      licenseExpiry: new Date(new Date().getFullYear() + 1, 0, 1),
      isAvailable: true,
    });

    // ── Crear el vehículo en la tabla vehicles ────────────────────────────
    // Sin esto, el conductor no puede ofertar en ningún viaje
    const validVehicleTypes = ['taxi', 'minibus', 'bus', 'motorcycle'];
    const vType = validVehicleTypes.includes(metadata.vehicleType)
      ? metadata.vehicleType
      : 'taxi';

    await Vehicle.create({
      driver_id: driver.id,
      brand: metadata.vehicleBrand || 'Sin especificar',
      model: metadata.vehicleModel || 'Sin especificar',
      year: parseInt(metadata.vehicleYear) || new Date().getFullYear(),
      color: metadata.vehicleColor || 'Sin especificar',
      plate: metadata.vehiclePlate || `TEMP-${driver.id.slice(0, 6)}`,
      capacity: parseInt(metadata.vehicleCapacity) || 4,
      vehicle_type: vType,
      status: 'active',
      // Si el conductor envió el RUAT y fue aprobado, el vehículo queda verificado
      ruat_verified: !!ruatFile,
      ruat_verified_at: ruatFile ? new Date() : null,
    });

    console.log(
      `🚗 Vehículo creado para driver ${driver.id}: ${vType} - ${metadata.vehiclePlate}`,
    );

    // Asociar el driver a la solicitud
    await request.update({ driverId: driver.id, status: 'approved' });

    // Marcar todos los archivos como aprobados
    await RequestFile.update(
      { status: 'approved' },
      { where: { requestId: request.id } },
    );

    // ── Notificar al conductor ────────────────────────────────────────────
    const { notify } = require('../services/notificationService');
    notify({
      userId,
      title: '✅ ¡Solicitud aprobada!',
      body: 'Tu solicitud como conductor fue aprobada. Ya puedes recibir viajes.',
      type: 'system',
      data: { driver_id: driver.id },
    });

    console.log(
      `✅ Solicitud ${requestId} aprobada - Driver ${driver.id} creado para usuario ${userId}`,
    );

    res.status(200).json({
      message: 'Conductor aprobado y creado exitosamente',
      driver,
    });
  } catch (error) {
    console.error('Error al aprobar solicitud:', error);
    res.status(500).json({
      error: 'Error al aprobar la solicitud',
    });
  }
};

const rejectDriver = async (req, res) => {
  try {
    const { driverId, requestId } = req.params;
    const { reason } = req.body;

    // Soportar ambos parámetros: driverId (legacy) y requestId (nuevo)
    let request;

    if (requestId) {
      // Nuevo sistema: recibir requestId
      request = await DriverRequest.findByPk(requestId);
    } else if (driverId) {
      // Sistema legacy: encontrar la solicitud más reciente del driver
      request = await DriverRequest.findOne({
        where: { driverId },
        order: [['version', 'DESC']],
      });
    }

    if (!request) {
      return res.status(404).json({
        error: 'Solicitud no encontrada',
      });
    }

    if (request.status === 'rejected') {
      return res.status(400).json({
        error: 'Esta solicitud ya fue rechazada',
      });
    }

    // Extraer documentos rechazados del reason
    const rejectionReason = reason || '';
    let rejectedDocsList = [];
    let rejectedDocumentsKeys = [];

    // Soportar ambos formatos de razón de rechazo
    const NUEVO_PREFIJO = 'Documentos a reenviar: ';
    const VIEJO_PREFIJO = 'Documentos rechazados que deben ser reenviados:';

    if (rejectionReason.includes(NUEVO_PREFIJO)) {
      const parts = rejectionReason.split(NUEVO_PREFIJO);
      if (parts.length > 1) {
        rejectedDocsList = parts[1]
          .split(',')
          .map(doc => doc.trim())
          .filter(doc => doc.length > 0);
      }
    } else if (rejectionReason.includes(VIEJO_PREFIJO)) {
      const parts = rejectionReason.split(VIEJO_PREFIJO);
      if (parts.length > 1) {
        rejectedDocsList = parts[1]
          .split(',')
          .map(doc => doc.trim())
          .filter(doc => doc.length > 0);
      }
    }

    // Mapear nombres en español a claves técnicas
    // Incluye variantes con distinto capitalizado para mayor compatibilidad
    const docMapping = {
      // Formato nuevo (labels del admin screen)
      'Foto perfil': 'profilePhoto',
      'CI frente': 'ciFront',
      'CI dorso': 'ciBack',
      'Licencia frente': 'licenseFront',
      'Licencia dorso': 'licenseBack',
      Antecedentes: 'antecedentsPhoto',
      'Auto frente': 'carFront',
      'Auto dorso': 'carBack',
      'Auto izq.': 'carLeft',
      'Auto der.': 'carRight',
      SOAT: 'soatPhoto',
      RUAT: 'ruatPhoto',
      // Formato antiguo (mayúsculas)
      'Foto Perfil': 'profilePhoto',
      'CI Frente': 'ciFront',
      'CI Dorso': 'ciBack',
      'Licencia Frente': 'licenseFront',
      'Licencia Dorso': 'licenseBack',
      'Auto Frente': 'carFront',
      'Auto Dorso': 'carBack',
      'Auto Izquierda': 'carLeft',
      'Auto Derecha': 'carRight',
    };

    // Marcar documentos como rejected en la BD
    for (const rejectedName of rejectedDocsList) {
      const rejectedKey = docMapping[rejectedName];
      if (rejectedKey) {
        rejectedDocumentsKeys.push(rejectedKey);
        await RequestFile.update(
          { status: 'rejected' },
          {
            where: {
              requestId: request.id,
              fileType: rejectedKey,
            },
          },
        );
      }
    }

    // Marcar todos los documentos NO rechazados como 'approved'
    // Lista explícita para evitar duplicados por las variantes de capitalizado
    const allDocumentTypes = [
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
    for (const docType of allDocumentTypes) {
      if (!rejectedDocumentsKeys.includes(docType)) {
        await RequestFile.update(
          { status: 'approved' },
          {
            where: {
              requestId: request.id,
              fileType: docType,
            },
          },
        );
      }
    }

    // Update request status
    await request.update({
      status: 'rejected',
      rejectionReason: reason,
      rejectedDocuments: rejectedDocumentsKeys,
    });

    // ── Notificar al conductor ────────────────────────────────────────────
    const { notify } = require('../services/notificationService');
    notify({
      userId: request.userId,
      title: '❌ Solicitud rechazada',
      body: reason
        ? `Tu solicitud fue rechazada. Motivo: ${reason
            .split('Documentos rechazados')[0]
            .trim()}`
        : 'Tu solicitud fue rechazada. Revisa los documentos y vuelve a enviarlos.',
      type: 'system',
      data: {
        request_id: request.id,
        rejected_documents: rejectedDocumentsKeys,
      },
    });

    console.log(
      `✅ Solicitud ${request.id} rechazada - Usuario ${request.userId} - Razón: ${reason}`,
    );

    res.status(200).json({
      message: 'Solicitud rechazada correctamente',
      request,
    });
  } catch (error) {
    console.error('Error al rechazar solicitud:', error);
    res.status(500).json({
      error: 'Error al rechazar la solicitud',
    });
  }
};

const getPendingDriverRequests = async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    // Obtener las solicitudes de conductor pendientes (nuevo sistema)
    const pendingRequests = await DriverRequest.findAll({
      where: { status: 'pending' },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    // Para cada solicitud, obtener datos del usuario y archivos
    const requestsWithDetails = await Promise.all(
      pendingRequests.map(async request => {
        // Obtener usuario
        const user = await User.findByPk(request.userId, {
          attributes: { exclude: ['password'] },
        });

        // Obtener archivos de esta solicitud
        const requestFiles = await RequestFile.findAll({
          where: { requestId: request.id },
        });

        // Construir objeto de archivos con URL completa
        let files = {};
        requestFiles.forEach(file => {
          const BASE_URL =
            process.env.API_BASE_URL ||
            `http://localhost:${process.env.PORT || 3000}`;
          files[file.fileType] = {
            filename: file.filename,
            url: `${BASE_URL}/uploads/drivers/${file.filename}`,
            status: file.status,
            uploadedAt: file.uploadedAt,
          };
        });

        return {
          id: request.id,
          name: user?.name || '',
          email: user?.email || '',
          phone: user?.phone || '',
          licenseNumber: request.metadata?.ciNumber || '',
          licenseExpiryDate: new Date(
            new Date().getFullYear() + 1,
            0,
            1,
          ).toISOString(),
          vehicleType: request.metadata?.vehicleType || '',
          vehiclePlate: request.metadata?.vehiclePlate || '',
          vehicleYear: request.metadata?.vehicleYear || 0,
          documentsVerified: Object.values(files).every(
            f => f.status === 'approved',
          ),
          backgroundCheckPassed: false,
          backgroundCheckDate: request.createdAt?.toISOString() || '',
          applicationDate: request.createdAt?.toISOString() || '',
          status: request.status,
          rejectionReason: request.rejectionReason || '',
          verificationNotes: '',
          userId: request.userId,
          currentRequest: {
            id: request.id,
            version: request.version,
            status: request.status,
            rejectionReason: request.rejectionReason,
            files,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
          },
        };
      }),
    );

    // Contar total de solicitudes pendientes
    const total = await DriverRequest.count({ where: { status: 'pending' } });

    res.status(200).json({
      drivers: requestsWithDetails,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error al obtener solicitudes pendientes:', error);
    res.status(500).json({
      error: 'Error al obtener solicitudes pendientes',
    });
  }
};

const getAllRides = async (req, res) => {
  try {
    const { status, startDate, endDate, limit = 20, offset = 0 } = req.query;
    const whereClause = {};

    if (status) {
      whereClause.status = status;
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereClause.createdAt[Op.lte] = new Date(endDate);
      }
    }

    const rides = await Ride.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'passenger',
          attributes: ['id', 'name', 'email', 'phone'],
        },
        {
          // Ride → Driver (not User). Nest User inside Driver to get name/phone.
          model: Driver,
          as: 'driver',
          attributes: ['id', 'userId'],
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'name', 'email', 'phone'],
            },
          ],
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
    });

    const total = await Ride.count({ where: whereClause });

    // Flatten driver.user into a simpler shape for the frontend
    const mapped = rides.map(r => {
      const plain = r.toJSON();
      if (plain.driver && plain.driver.user) {
        plain.driver = {
          id: plain.driver.user.id,
          name: plain.driver.user.name,
          email: plain.driver.user.email,
          phone: plain.driver.user.phone,
        };
      }
      return plain;
    });

    res.status(200).json({
      rides: mapped,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error al obtener viajes:', error.message || error);
    res.status(500).json({
      error: 'Error al obtener viajes',
      detail: error.message,
    });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const totalUsers    = await User.count();
    const totalDrivers  = await Driver.count();
    const activeDrivers = await Driver.count({ where: { isAvailable: true } });
    const totalRides    = await Ride.count();
    const completedRides = await Ride.count({ where: { status: 'completed' } });
    const cancelledRides = await Ride.count({ where: { status: 'cancelled' } });

    // Sum finalFare on all completed rides (no paymentStatus column in rides table)
    const totalRevenue = await Ride.sum('finalFare', {
      where: { status: 'completed' },
    });

    const averageFare = completedRides > 0 ? (totalRevenue || 0) / completedRides : 0;

    const ridesThisMonth = await Ride.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(new Date().setDate(1)),
        },
        status: 'completed',
      },
    });

    const completionRate = totalRides > 0 ? ((completedRides / totalRides) * 100) : 0;

    res.status(200).json({
      analytics: {
        totalUsers,
        totalDrivers,
        activeDrivers,
        totalRides,
        completedRides,
        cancelledRides,
        totalRevenue: totalRevenue || 0,
        averageFare: Math.round(averageFare * 100) / 100,
        ridesThisMonth,
        completionRate: Math.round(completionRate * 10) / 10,
      },
    });
  } catch (error) {
    console.error('Error al obtener análiticas:', error.message || error);
    res.status(500).json({
      error: 'Error al obtener las análiticas',
      detail: error.message,
    });
  }
};

const createPromoCode = async (req, res) => {
  try {
    const { code, discountPercentage, discountAmount, maxUses, expiryDate } =
      req.body;

    if (!code) {
      return res.status(400).json({
        error: 'Código promocional requerido',
      });
    }

    res.status(201).json({
      message: 'Código promocional creado',
      promoCode: {
        code,
        discountPercentage,
        discountAmount,
        maxUses,
        expiryDate,
      },
    });
  } catch (error) {
    console.error('Error al crear código promocional:', error);
    res.status(500).json({
      error: 'Error al crear código promocional',
    });
  }
};

const deleteDriver = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findByPk(driverId);
    if (!driver) {
      return res.status(404).json({
        error: 'Conductor no encontrado',
      });
    }

    // Verificar si tiene viajes activos
    const activeRides = await Ride.count({
      where: {
        driverId: driverId,
        status: { [Op.in]: ['accepted', 'in_progress'] },
      },
    });

    if (activeRides > 0) {
      return res.status(400).json({
        error: 'No se puede eliminar un conductor con viajes activos',
      });
    }

    // Eliminar el registro del conductor (User se mantiene)
    await driver.destroy();

    res.status(200).json({
      message: 'Conductor eliminado exitosamente',
    });
  } catch (error) {
    console.error('Error al eliminar conductor:', error);
    res.status(500).json({
      error: 'Error al eliminar el conductor',
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    // Desactivar el usuario en lugar de eliminarlo
    await user.update({
      isActive: false,
    });

    res.status(200).json({
      message: 'Usuario desactivado exitosamente',
      user,
    });
  } catch (error) {
    console.error('Error al desactivar usuario:', error);
    res.status(500).json({
      error: 'Error al desactivar el usuario',
    });
  }
};

const enableUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    // Habilitar el usuario
    await user.update({
      isActive: true,
    });

    res.status(200).json({
      message: 'Usuario habilitado exitosamente',
      user,
    });
  } catch (error) {
    console.error('Error al habilitar usuario:', error);
    res.status(500).json({
      error: 'Error al habilitar el usuario',
    });
  }
};

/**
 * Admin aprueba el RUAT enviado por el conductor
 * POST /admin/vehicles/:vehicleId/approve-ruat
 */
const approveVehicleRuat = async (req, res) => {
  try {
    const { vehicleId } = req.params;

    const vehicle = await Vehicle.findByPk(vehicleId);
    if (!vehicle)
      return res.status(404).json({ error: 'Vehículo no encontrado' });

    // El archivo está referenciado en vehicle.ruatFile (puesto al subir)
    if (!vehicle.ruatFile) {
      return res.status(400).json({
        error: 'Este vehículo no tiene un RUAT pendiente de revisión',
      });
    }

    // Buscar el RequestFile vinculado para marcarlo como aprobado
    const driver = await Driver.findOne({ where: { id: vehicle.driver_id } });
    if (driver) {
      const latestRequest = await DriverRequest.findOne({
        where: { userId: driver.userId },
        order: [['version', 'DESC']],
      });
      if (latestRequest) {
        await RequestFile.update(
          { status: 'approved' },
          { where: { requestId: latestRequest.id, fileType: 'ruatPhoto' } },
        );
      }
    }

    // ruatFile permanece → referencia definitiva al RUAT aprobado
    // ruat_verified = true indica que ya está aprobado
    await vehicle.update({
      ruatVerified: true,
      ruatVerifiedAt: new Date(),
      ruatRequired: false,
      ruatRequiredReason: null,
      ruatRequiredAt: null,
    });

    // Notificar al conductor
    if (driver) {
      const { notify } = require('../services/notificationService');
      notify({
        userId: driver.userId,
        title: '✅ Vehículo verificado',
        body: 'Tu RUAT fue revisado y aprobado. Tu vehículo ahora tiene el estado Verificado.',
        type: 'system',
        data: { vehicle_verified: true },
      });
    }

    console.log(`✅ RUAT aprobado para vehículo ${vehicleId}`);
    res.json({
      message: 'RUAT aprobado. Vehículo verificado.',
      vehicle: {
        id: vehicle.id,
        ruatFile: vehicle.ruatFile,
        ruatVerified: true,
        ruatVerifiedAt: vehicle.ruatVerifiedAt,
      },
    });
  } catch (error) {
    console.error('Error al aprobar RUAT:', error);
    res.status(500).json({ error: 'Error al aprobar RUAT: ' + error.message });
  }
};

/**
 * Admin rechaza el RUAT enviado por el conductor
 * POST /admin/vehicles/:vehicleId/reject-ruat
 * body: { reason: string }
 */
const rejectVehicleRuat = async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { reason } = req.body;

    const vehicle = await Vehicle.findByPk(vehicleId);
    if (!vehicle)
      return res.status(404).json({ error: 'Vehículo no encontrado' });

    // Marcar el RequestFile como rechazado
    const driver = await Driver.findOne({ where: { id: vehicle.driver_id } });
    if (driver) {
      const latestRequest = await DriverRequest.findOne({
        where: { userId: driver.userId },
        order: [['version', 'DESC']],
      });
      if (latestRequest) {
        await RequestFile.update(
          { status: 'rejected' },
          { where: { requestId: latestRequest.id, fileType: 'ruatPhoto' } },
        );
      }
    }

    // Limpiar ruatFile → el conductor debe subir uno nuevo
    // ruat_required = true → notifica urgencia en la app del conductor
    await vehicle.update({
      ruatFile: null,
      ruatRequired: true,
      ruatRequiredAt: new Date(),
    });

    // Notificar al conductor
    if (driver) {
      const { notify } = require('../services/notificationService');
      notify({
        userId: driver.userId,
        title: '❌ RUAT rechazado',
        body: reason
          ? `Tu RUAT fue rechazado. Motivo: ${reason}. Por favor envía una nueva foto.`
          : 'Tu RUAT fue rechazado. Por favor envía una nueva foto clara del documento.',
        type: 'system',
        data: { ruat_rejected: true, reason },
      });
    }

    console.log(`❌ RUAT rechazado para vehículo ${vehicleId}`);
    res.json({
      message: 'RUAT rechazado. El conductor deberá reenviar el documento.',
      vehicle: { id: vehicle.id, ruatFile: null, ruatRequired: true },
    });
  } catch (error) {
    console.error('Error al rechazar RUAT:', error);
    res.status(500).json({ error: 'Error al rechazar RUAT: ' + error.message });
  }
};

/**
 * Requerir RUAT a un conductor ya aprobado
 * POST /admin/drivers/:driverId/require-ruat
 * body: { reason: 'accident'|'vehicle_mismatch'|'suspension_reactivation'|'criminal_record', suspend: boolean }
 */
const requireRuatVerification = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason, suspend } = req.body;

    const VALID_REASONS = [
      'accident',
      'vehicle_mismatch',
      'suspension_reactivation',
      'criminal_record',
    ];
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({
        error: `Razón inválida. Válidas: ${VALID_REASONS.join(', ')}`,
      });
    }

    const driver = await Driver.findByPk(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Conductor no encontrado' });
    }

    // El RUAT es un documento del vehículo → actualizar en la tabla vehicles
    const vehicle = await Vehicle.findOne({ where: { driver_id: driverId } });
    if (!vehicle) {
      return res
        .status(404)
        .json({ error: 'Vehículo del conductor no encontrado' });
    }

    await vehicle.update({
      ruat_required: true,
      ruat_required_reason: reason,
      ruat_required_at: new Date(),
      // Al requerir nuevo RUAT, la verificación anterior queda anulada
      ruat_verified: false,
      ruat_verified_at: null,
    });

    // La suspensión sí va en el conductor (afecta su cuenta, no solo el vehículo)
    if (suspend) {
      await driver.update({ status: 'suspended', isAvailable: false });
    }

    const REASON_MESSAGES = {
      accident:
        'Se registró un accidente en tu cuenta. Debes verificar tu vehículo enviando el RUAT para continuar operando.',
      vehicle_mismatch:
        'Se reportó que el vehículo no coincide con el registrado. Envía el RUAT para verificar la propiedad del vehículo.',
      suspension_reactivation:
        'Para reactivar tu cuenta debes enviar el RUAT de tu vehículo como paso de verificación adicional.',
      criminal_record:
        'Se requiere verificación adicional de tu vehículo. Por favor envía el RUAT para continuar.',
    };

    const { notify } = require('../services/notificationService');
    notify({
      userId: driver.userId,
      title: '⚠️ Verificación de vehículo requerida',
      body: REASON_MESSAGES[reason],
      type: 'system',
      data: { ruat_required: true, reason, suspended: !!suspend },
    });

    console.log(
      `⚠️ RUAT requerido - vehicle ${
        vehicle.id
      } (driver ${driverId}) - Razón: ${reason} - Suspendido: ${!!suspend}`,
    );

    res.json({
      message: suspend
        ? 'Conductor suspendido. Se requiere RUAT del vehículo para reactivar.'
        : 'RUAT requerido. El conductor fue notificado.',
      vehicle: {
        id: vehicle.id,
        ruatRequired: vehicle.ruat_required,
        ruatRequiredReason: vehicle.ruat_required_reason,
        ruatVerified: vehicle.ruat_verified,
      },
      driver: {
        id: driver.id,
        status: driver.status,
      },
    });
  } catch (error) {
    console.error('Error al requerir RUAT:', error);
    res.status(500).json({ error: 'Error al requerir RUAT: ' + error.message });
  }
};

/**
 * Suspender / reactivar un conductor manualmente
 * PUT /admin/drivers/:driverId/suspend   { suspend: true }
 * PUT /admin/drivers/:driverId/suspend   { suspend: false }
 */
const toggleSuspendDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { suspend } = req.body;

    const driver = await Driver.findByPk(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Conductor no encontrado' });
    }

    if (suspend) {
      await driver.update({ status: 'suspended', isAvailable: false });
      console.log(`🔴 Conductor ${driverId} suspendido`);
    } else {
      // Al reactivar verificar si el vehículo tiene RUAT pendiente
      const vehicle = await Vehicle.findOne({ where: { driver_id: driverId } });
      if (vehicle && vehicle.ruat_required) {
        return res.status(400).json({
          error:
            'El vehículo de este conductor tiene verificación de RUAT pendiente. Resuelve esa solicitud antes de reactivar.',
          ruatRequiredReason: vehicle.ruat_required_reason,
        });
      }
      await driver.update({ status: 'approved', isAvailable: true });
      console.log(`🟢 Conductor ${driverId} reactivado`);
    }

    const { notify } = require('../services/notificationService');
    notify({
      userId: driver.userId,
      title: suspend ? '🔴 Cuenta suspendida' : '✅ Cuenta reactivada',
      body: suspend
        ? 'Tu cuenta ha sido suspendida temporalmente. Contacta soporte para más información.'
        : 'Tu cuenta ha sido reactivada. Ya puedes recibir viajes.',
      type: 'system',
      data: { suspended: suspend },
    });

    res.json({
      message: suspend ? 'Conductor suspendido' : 'Conductor reactivado',
      driver: {
        id: driver.id,
        status: driver.status,
        isAvailable: driver.isAvailable,
      },
    });
  } catch (error) {
    console.error('Error al cambiar estado del conductor:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
};

const getAllPayments = async (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;
    const whereClause = {};

    if (status) {
      whereClause.payment_status = status;
    }

    const payments = await Payment.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'passenger',
          attributes: ['id', 'name', 'email', 'phone'],
        },
        {
          model: Ride,
          as: 'ride',
          attributes: ['id', 'pickup_address', 'dropoff_address', 'status', 'finalFare'],
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
    });

    const total = await Payment.count({ where: whereClause });

    // Summary totals
    const completedRevenue = await Payment.sum('amount', {
      where: { payment_status: 'completed' },
    }) || 0;
    const pendingAmount = await Payment.sum('amount', {
      where: { payment_status: 'pending' },
    }) || 0;
    const pendingCount = await Payment.count({
      where: { payment_status: 'pending' },
    });

    res.status(200).json({
      payments,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      summary: {
        completedRevenue: Number(completedRevenue),
        pendingAmount: Number(pendingAmount),
        pendingCount,
      },
    });
  } catch (error) {
    console.error('Error al obtener pagos:', error.message || error);
    res.status(500).json({
      error: 'Error al obtener pagos',
      detail: error.message,
    });
  }
};
// ─── ADVANCED ANALYTICS ────────────────────────────────────────────────────

// Helper: get date range boundaries
const getDateRange = (range = 'month') => {
  const now = new Date();
  let currentStart, previousStart, previousEnd;

  if (range === 'week') {
    currentStart = new Date(now);
    currentStart.setDate(now.getDate() - 7);
    previousEnd = new Date(currentStart);
    previousStart = new Date(previousEnd);
    previousStart.setDate(previousEnd.getDate() - 7);
  } else if (range === 'year') {
    currentStart = new Date(now.getFullYear(), 0, 1);
    previousStart = new Date(now.getFullYear() - 1, 0, 1);
    previousEnd = new Date(now.getFullYear() - 1, 11, 31);
  } else {
    // month
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  }
  return { currentStart, previousStart, previousEnd, now };
};

const getAnalyticsExtended = async (req, res) => {
  try {
    const { range = 'month' } = req.query;
    const { currentStart, previousStart, previousEnd, now } = getDateRange(range);

    const dateFilter = { createdAt: { [Op.gte]: currentStart, [Op.lte]: now } };
    const prevFilter = { createdAt: { [Op.gte]: previousStart, [Op.lte]: previousEnd } };

    // Current period
    const rides     = await Ride.count({ where: dateFilter });
    const completed = await Ride.count({ where: { ...dateFilter, status: 'completed' } });
    const cancelled = await Ride.count({ where: { ...dateFilter, status: 'cancelled' } });
    const revenue   = (await Ride.sum('finalFare', { where: { ...dateFilter, status: 'completed' } })) || 0;
    const users     = await User.count({ where: dateFilter });

    // Previous period
    const prevRides   = await Ride.count({ where: prevFilter });
    const prevRevenue = (await Ride.sum('finalFare', { where: { ...prevFilter, status: 'completed' } })) || 0;
    const prevUsers   = await User.count({ where: prevFilter });
    const prevCompleted = await Ride.count({ where: { ...prevFilter, status: 'completed' } });

    const pct = (cur, prev) => prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur > 0 ? 100 : 0);

    // All-time totals
    const totalUsers   = await User.count();
    const totalDrivers = await Driver.count();
    const activeDrivers = await Driver.count({ where: { isAvailable: true } });

    res.json({
      range,
      current: {
        rides, completed, cancelled, revenue: Math.round(revenue * 100) / 100,
        users,
        avgFare: completed > 0 ? Math.round((revenue / completed) * 100) / 100 : 0,
        completionRate: rides > 0 ? Math.round((completed / rides) * 1000) / 10 : 0,
        cancellationRate: rides > 0 ? Math.round((cancelled / rides) * 1000) / 10 : 0,
      },
      deltas: {
        rides: pct(rides, prevRides),
        revenue: pct(revenue, prevRevenue),
        users: pct(users, prevUsers),
        completed: pct(completed, prevCompleted),
      },
      totals: { totalUsers, totalDrivers, activeDrivers },
    });
  } catch (error) {
    console.error('getAnalyticsExtended error:', error.message);
    res.status(500).json({ error: 'Error al obtener analíticas extendidas', detail: error.message });
  }
};

const getRidesByDay = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const results = await sequelize.query(`
      SELECT DATE(created_at) AS day, COUNT(*)::int AS count
      FROM rides
      WHERE created_at >= :since AND deleted_at IS NULL
      GROUP BY DATE(created_at)
      ORDER BY day
    `, { replacements: { since }, type: sequelize.QueryTypes.SELECT });

    res.json({ days: results });
  } catch (error) {
    console.error('getRidesByDay error:', error.message);
    res.status(500).json({ error: 'Error', detail: error.message });
  }
};

const getRevenueByDay = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const results = await sequelize.query(`
      SELECT DATE(created_at) AS day,
             COALESCE(SUM(final_fare), 0)::float AS revenue,
             COUNT(*)::int AS rides
      FROM rides
      WHERE created_at >= :since AND status = 'completed' AND deleted_at IS NULL
      GROUP BY DATE(created_at)
      ORDER BY day
    `, { replacements: { since }, type: sequelize.QueryTypes.SELECT });

    res.json({ days: results });
  } catch (error) {
    console.error('getRevenueByDay error:', error.message);
    res.status(500).json({ error: 'Error', detail: error.message });
  }
};

const getUserSegmentation = async (req, res) => {
  try {
    const passengers = await User.count({ where: { role: 'passenger' } });
    const drivers    = await Driver.count();
    const admins     = await User.count({ where: { role: 'admin' } });
    const active     = await User.count({ where: { isActive: true } });
    const inactive   = await User.count({ where: { isActive: false } });
    const verified   = await User.count({ where: { isVerified: true } });
    const unverified = await User.count({ where: { isVerified: false } });

    res.json({
      byRole: { passengers, drivers, admins },
      byStatus: { active, inactive },
      byVerification: { verified, unverified },
    });
  } catch (error) {
    console.error('getUserSegmentation error:', error.message);
    res.status(500).json({ error: 'Error', detail: error.message });
  }
};

const getRideFunnel = async (req, res) => {
  try {
    const { range = 'month' } = req.query;
    const { currentStart } = getDateRange(range);
    const w = { createdAt: { [Op.gte]: currentStart } };

    const requested  = await Ride.count({ where: w });
    const accepted   = await Ride.count({ where: { ...w, status: { [Op.in]: ['accepted', 'arrived', 'in_progress', 'completed'] } } });
    const inProgress = await Ride.count({ where: { ...w, status: { [Op.in]: ['in_progress', 'completed'] } } });
    const completed  = await Ride.count({ where: { ...w, status: 'completed' } });

    res.json({
      funnel: [
        { stage: 'Solicitados',  count: requested },
        { stage: 'Aceptados',    count: accepted },
        { stage: 'En curso',     count: inProgress },
        { stage: 'Completados',  count: completed },
      ],
    });
  } catch (error) {
    console.error('getRideFunnel error:', error.message);
    res.status(500).json({ error: 'Error', detail: error.message });
  }
};

const getUnitEconomics = async (req, res) => {
  try {
    const totalUsers    = await User.count();
    const totalDrivers  = await Driver.count();
    const completedRides = await Ride.count({ where: { status: 'completed' } });
    const totalRevenue  = (await Ride.sum('finalFare', { where: { status: 'completed' } })) || 0;

    // Users who have taken at least 1 ride
    const activeRiders = await Ride.count({
      distinct: true,
      col: 'passengerId',
    });

    const r = (v) => Math.round(v * 100) / 100;

    res.json({
      revenuePerUser:   r(totalUsers > 0 ? totalRevenue / totalUsers : 0),
      revenuePerDriver: r(totalDrivers > 0 ? totalRevenue / totalDrivers : 0),
      revenuePerRide:   r(completedRides > 0 ? totalRevenue / completedRides : 0),
      ridesPerUser:     r(activeRiders > 0 ? completedRides / activeRiders : 0),
      totalRevenue:     r(totalRevenue),
      completedRides,
      totalUsers,
      totalDrivers,
      activeRiders,
    });
  } catch (error) {
    console.error('getUnitEconomics error:', error.message);
    res.status(500).json({ error: 'Error', detail: error.message });
  }
};

const getTopRoutes = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);

    const routes = await sequelize.query(`
      SELECT pickup_address, dropoff_address, COUNT(*)::int AS count,
             COALESCE(AVG(final_fare), 0)::float AS avg_fare
      FROM rides
      WHERE status = 'completed' AND deleted_at IS NULL
        AND pickup_address IS NOT NULL AND dropoff_address IS NOT NULL
      GROUP BY pickup_address, dropoff_address
      ORDER BY count DESC
      LIMIT :limit
    `, { replacements: { limit }, type: sequelize.QueryTypes.SELECT });

    res.json({ routes });
  } catch (error) {
    console.error('getTopRoutes error:', error.message);
    res.status(500).json({ error: 'Error', detail: error.message });
  }
};

module.exports = {
  getAllUsers,
  getAllDrivers,
  approveDriver,
  rejectDriver,
  getPendingDriverRequests,
  getAllRides,
  getAllPayments,
  getAnalytics,
  getAnalyticsExtended,
  getRidesByDay,
  getRevenueByDay,
  getUserSegmentation,
  getRideFunnel,
  getUnitEconomics,
  getTopRoutes,
  createPromoCode,
  deleteDriver,
  deleteUser,
  enableUser,
  requireRuatVerification,
  toggleSuspendDriver,
  approveVehicleRuat,
  rejectVehicleRuat,
};
