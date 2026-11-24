// backend/src/controllers/adminControlador.js
const Usuario = require("../models/Usuario");
const UsuarioIdentidad = require("../models/UsuarioIdentidad");
const Conductor = require("../models/Conductor");
const Vehiculo = require("../models/Vehiculo");
const Viaje = require("../models/Viaje");
const Pago = require("../models/Pago");
const CancelacionMotivo = require('../models/CancelacionMotivo');
const ServicioZona = require('../models/ServiceZona');
const ViajeParada = require('../models/ViajeParada');
const ConductorSolicitud = require("../models/ConductorSolicitud");
const ConductorDomicilio = require("../models/ConductorDomicilio");
const SolicitudArchivo = require("../models/SolicitudArchivo");
const AuditoriaRegistro = require('../models/AuditRegistro');
const sequelize = require("../config/baseDatos");
const { Op: Operador } = require('sequelize');
const ruta = require('path');
const fs = require('fs/promises');
const { createHash } = require('node:crypto');
const { isoFecha, boliviaHoy, comprobarAdulto } = require('../services/identidadValidacion');
const { CONDUCTOR_OCR_DOCUMENTOS: CONDUCTOR_OCR_DOCUMENTS } = require("../services/conductorOcrImage");

// Admin-only preview of the exact JPEG buffer sent to Vision for driver OCR.
const obtenerConductorOcrVistaPrevia = async (solicitud, respuesta) => {
  const { requestId: solicitudId, documentType: documentoTipo } = solicitud.params;
  if (!CONDUCTOR_OCR_DOCUMENTS.has(documentoTipo)) {
    return respuesta.status(400).json({ error: 'Este documento no se procesa con el OCR de conductor.' });
  }
  try {
    const archivo = await SolicitudArchivo.findOne({
      where: { requestId: solicitudId, fileType: documentoTipo },
      order: [['uploadedAt', 'DESC']]
    });
    if (!archivo) return respuesta.status(404).json({ error: 'Documento no encontrado.' });
    const nombreArchivo = archivo.filename;
    if (!nombreArchivo || nombreArchivo !== ruta.basename(nombreArchivo)) return respuesta.sendStatus(404);
    const imagen = await fs.readFile(ruta.join(__dirname, '../uploads/drivers', nombreArchivo));
    respuesta.set('Cache-Control', 'private, no-store');
    respuesta.type('jpeg').send(imagen);
  } catch (error) {
    if (error.code === 'ENOENT') return respuesta.status(404).json({ error: 'Imagen no encontrada.' });
    console.error('Error al generar vista OCR:', error);
    return respuesta.status(500).json({ error: 'No se pudo generar la vista OCR.' });
  }
};

const obtenerIdentidadEvidencia = async (solicitud, respuesta) => {
  const { userId: usuarioId, side: lado } = solicitud.params;
  if (lado !== 'ciFront' && lado !== 'ciBack') return respuesta.sendStatus(400);
  try {
    const { unseal } = require('../services/identidadSessionCrypto');
    const [documento] = await sequelize.query(
      `SELECT id, evidencia_cifrada FROM documento
       WHERE user_id = :userId AND document_type = :side
         AND driver_request_id IS NULL AND is_current = true
       ORDER BY created_at DESC LIMIT 1`,
      { replacements: { userId: usuarioId, side: lado }, type: sequelize.QueryTypes.SELECT }
    );
    const metadatos = documento ? { encryptedEvidence: documento.evidencia_cifrada } : null;
    if (!metadatos?.encryptedEvidence) return respuesta.sendStatus(404);
    const evidencia = unseal(
      Buffer.from(metadatos.encryptedEvidence, 'base64'),
      `${documento.id}:${usuarioId}:${lado}`
    );
    if (typeof evidencia.image !== 'string') return respuesta.sendStatus(404);
    const imagen = Buffer.from(evidencia.image, 'base64');
    respuesta.set('Cache-Control', 'private, no-store');
    return respuesta.type('png').send(imagen);
  } catch (error) {
    console.error('Error al servir CI para revisión:', error.name || 'Error');
    return respuesta.sendStatus(503);
  }
};

const camposIdentidad = [
  ['ciNumber', 'Número de CI', 20], ['firstNames', 'Nombres', 150],
  ['paternalSurname', 'Apellido paterno', 100], ['maternalSurname', 'Apellido materno', 100],
  ['birthDate', 'Fecha de nacimiento'], ['issueDate', 'Fecha de emisión'], ['expiryDate', 'Fecha de vencimiento'],
  ['birthPlace', 'Lugar de nacimiento', 150], ['address', 'Domicilio', 255],
  ['occupation', 'Ocupación', 150], ['maritalStatus', 'Estado civil', 50]
];

function presentarDatosIdentidad(identidad) {
  const campos = camposIdentidad.map(([clave, etiqueta, maximo]) => ({
    clave, etiqueta, maximo, tipo: maximo ? 'texto' : 'fecha', valor: identidad[clave] ?? ''
  }));
  const revision = createHash('sha256').update(JSON.stringify([identidad.id, campos])).digest('hex');
  return { campos, revision };
}

const consultarDatosIdentidad = editar => async (solicitud, respuesta) => {
  const { userId } = solicitud.params;
  const { revision, campos } = solicitud.body ?? {};
  const fallar = (status, message) => { throw Object.assign(new Error(message), { status }); };
  respuesta.set('Cache-Control', 'private, no-store');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(userId)) {
    return respuesta.status(400).json({ error: 'Identificador de usuario inválido.' });
  }
  try {
    const administrador = await Usuario.findOne({
      attributes: ['id'], where: { id: solicitud.user.id, role: 'administrador', isActive: true }
    });
    if (!administrador) return respuesta.status(403).json({ error: 'Se requiere una cuenta de administrador activa.' });

    const cargar = async transaccion => {
      const identidad = await UsuarioIdentidad.findOne({ where: { userId }, transaction: transaccion });
      if (!identidad) fallar(404, 'El usuario aún no tiene un CI registrado.');
      return identidad;
    };
    if (!editar) return respuesta.json(presentarDatosIdentidad(await cargar()));
    if (typeof revision !== 'string' || !campos || typeof campos !== 'object' || Array.isArray(campos)) {
      return respuesta.status(400).json({ error: 'Los datos de la corrección no son válidos.' });
    }

    const resultado = await sequelize.transaction(async transaccion => {
      // El registro inicial del CI también bloquea la fila del usuario.
      const usuario = await Usuario.findByPk(userId, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
      if (!usuario) fallar(404, 'Usuario no encontrado.');
      const identidad = await cargar(transaccion);
      if (presentarDatosIdentidad(identidad).revision !== revision) {
        fallar(409, 'Los datos del CI cambiaron. Cierra la edición y vuelve a abrirla.');
      }

      const cambios = {};
      const anteriores = {};
      for (const [clave, entrada] of Object.entries(campos)) {
        const campo = camposIdentidad.find(([nombre]) => nombre === clave);
        if (!campo || typeof entrada !== 'string') fallar(400, 'La corrección contiene un campo inválido.');
        const [, etiqueta, maximo] = campo;
        const texto = entrada.trim();
        const valor = maximo ? texto || null : isoFecha(texto);
        if (texto && (!valor || texto.length > (maximo ?? 10))) fallar(422, etiqueta + ' no es válido.');
        if (valor === identidad[clave]) continue;
        if (['firstNames', 'ciNumber', 'birthDate'].includes(clave) && !valor) fallar(422, 'Completa el campo ' + etiqueta + '.');
        if (clave === 'ciNumber' && !/^\d+$/.test(valor)) fallar(422, 'El número de CI debe contener solo dígitos.');
        cambios[clave] = valor;
        anteriores[clave] = identidad[clave];
      }
      if (!Object.keys(cambios).length) return presentarDatosIdentidad(identidad);
      const datos = { ...identidad.get(), ...cambios };
      if ('birthDate' in cambios) comprobarAdulto(datos.birthDate);
      if (('issueDate' in cambios || 'birthDate' in cambios) && datos.issueDate &&
          (datos.issueDate > boliviaHoy() || datos.issueDate < datos.birthDate)) {
        fallar(422, 'La fecha de emisión debe estar entre el nacimiento y hoy.');
      }
      if (('expiryDate' in cambios || 'issueDate' in cambios) && datos.expiryDate && datos.issueDate &&
          datos.expiryDate < datos.issueDate) {
        fallar(422, 'El vencimiento debe ser igual o posterior a la fecha de emisión.');
      }
      await identidad.update(cambios, { transaction: transaccion });
      await AuditoriaRegistro.create({
        table_name: 'documento_ci', record_id: identidad.id, action: 'ACTUALIZACION',
        old_values: anteriores, new_values: { tipo: 'correccion_ci', ...cambios }, changed_by: solicitud.user.id
      }, { transaction: transaccion });
      return presentarDatosIdentidad(identidad);
    });
    return respuesta.json(resultado);
  } catch (error) {
    if (error.original?.code === '23505') return respuesta.status(409).json({ error: 'Ese número de CI ya está registrado.' });
    if (error.status) return respuesta.status(error.status).json({ error: error.message });
    console.error('Error al procesar los datos del CI:', error.original?.code ?? error.name);
    return respuesta.status(500).json({ error: 'No se pudieron procesar los datos del CI.' });
  }
};

const hastaIsoFecha = (valor) => {
  const coincidencia = String(valor || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return coincidencia ? `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}` : valor || null;
};

const obtenerTodosUsuarios = async (solicitud, respuesta) => {
  try {
    const { search: buscar, role: rol, limit: limite = 20, offset: desplazamiento = 0, inactive: inactivo } = solicitud.query;
    const condicionesClausula = {};

    // Si inactive=true, mostrar solo inactivos; si no, mostrar solo activos
    condicionesClausula.isActive = inactivo === 'true' ? false : true;

    const consulta = typeof buscar === 'string' ? buscar.trim().slice(0, 150) : '';
    if (consulta) {
      const coincidencias = consulta.split(/\s+/).map(palabra => ({
        [Operador.or]: ['firstNames', 'paternalSurname', 'maternalSurname'].map(campo => ({
          [campo]: { [Operador.iLike]: `%${palabra}%` }
        }))
      }));
      const identidades = await UsuarioIdentidad.findAll({
        attributes: ['userId'], where: { [Operador.and]: coincidencias }
      });
      condicionesClausula[Operador.or] = [
        { nombreGoogle: { [Operador.iLike]: `%${consulta}%` } },
        { email: { [Operador.iLike]: `%${consulta}%` } },
        { phone: { [Operador.iLike]: `%${consulta}%` } },
        { id: { [Operador.in]: identidades.map(identidad => identidad.userId) } }
      ];
    }

    if (rol) {
      condicionesClausula.role = rol;
    }

    const usuarios = await Usuario.findAll({
      where: condicionesClausula,
      attributes: { exclude: ['password'] },
      include: [{ model: UsuarioIdentidad, as: 'identity', attributes: ['firstNames', 'paternalSurname', 'maternalSurname', 'verificationStatus'] }],
      limit: parseInt(limite),
      offset: parseInt(desplazamiento),
      order: [['createdAt', 'DESC'], ['id', 'DESC']]
    });

    const total = await Usuario.count({ where: condicionesClausula });

    const mapeadoUsuarios = usuarios.map((usuario) => {
      const plano = usuario.toJSON();
      plano.name = plano.identity?.verificationStatus === 'verificado'
        ? [plano.identity.firstNames, plano.identity.paternalSurname, plano.identity.maternalSurname].filter(Boolean).join(' ')
        : plano.nombreGoogle || '';
      return plano;
    });
    respuesta.status(200).json({
      users: mapeadoUsuarios,
      total,
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    respuesta.status(500).json({
      error: 'Error al obtener usuarios'
    });
  }
};

const obtenerTodosConductores = async (solicitud, respuesta) => {
  try {
    const { status: estado, userId: usuarioId, limit: limite = 20, offset: desplazamiento = 0 } = solicitud.query;
    if (usuarioId && (typeof usuarioId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(usuarioId))) {
      return respuesta.status(400).json({ error: 'Usuario inválido.' });
    }
    const condicionesClausula = { userId: usuarioId || { [Operador.not]: null } };

    if (estado) {
      condicionesClausula.status = estado;
    }

    // Obtener la solicitud más reciente por usuario
    const solicitudes = await ConductorSolicitud.findAll({
      where: condicionesClausula,
      order: [
      ['userId', 'ASC'],
      ['version', 'DESC']],

      raw: false
    });

    // Agrupar por userId y quedarse solo con la versión más reciente
    const recientePorUsuario = {};
    solicitudes.forEach((req) => {
      if (!recientePorUsuario[req.userId]) {
        recientePorUsuario[req.userId] = req;
      }
    });

    const unicoSolicitudes = Object.values(recientePorUsuario).slice(
      parseInt(desplazamiento),
      parseInt(desplazamiento) + parseInt(limite)
    );

    // Para cada solicitud, obtener sus archivos y usuario
    const solicitudesConArchivos = await Promise.all(
      unicoSolicitudes.map(async (request) => {
        // Obtener el usuario
        const usuario = await Usuario.findByPk(request.userId, {
          attributes: { exclude: ['password'] }
        });
        const identidad = await UsuarioIdentidad.findOne({ where: { userId: request.userId } });
        const domicilio = await ConductorDomicilio.findOne({ where: { driverRequestId: request.id } });

        const solicitudArchivos = await SolicitudArchivo.findAll({
          where: { requestId: request.id }
        });

        console.log(`📋 Request ${request.id} (v${request.version}):`, {
          status: request.status,
          fileCount: solicitudArchivos.length,
          files: solicitudArchivos.map((f) => `${f.fileType}(${f.status})`).join(', ')
        });

        // Log detallado de archivos
        solicitudArchivos.forEach((f) => {
          console.log(`  - ${f.fileType}: ${f.filename} [${f.status}]`);
        });

        let archivos = {};
        solicitudArchivos.forEach((archivo) => {
          archivos[archivo.fileType] = {
            filename: archivo.filename,
            url: `/archivos/conductores/${encodeURIComponent(archivo.filename)}`,
            status: archivo.status,
            uploadedAt: archivo.uploadedAt
          };
        });

        console.log(
          `Final files object keys for request ${request.id}:`,
          Object.keys(archivos)
        );

        // Obtener el perfil aprobado mediante el usuario de la solicitud.
        const conductor = request.status === 'aprobado' ? await Conductor.findOne({ where: { userId: request.userId } }) : null;
        let vehiculoDatos = null;
        if (conductor) {
          const vehiculo = await Vehiculo.findOne({
            where: { driver_id: conductor.id }
          });
          if (vehiculo) {
            const ruatDocumento = await require('./documentosRenovacionControlador').latestVehicleFile(vehiculo.id,'ruatPhoto');
            const realRuat = ruatDocumento?.status !== 'rechazado' ?
            ruatDocumento : null;
            vehiculoDatos = {
              id: vehiculo.id,
              ruatFile: realRuat?.filename || null,
              ruatFileUrl: realRuat ?
              `/archivos/conductores/${encodeURIComponent(realRuat.filename)}` :
              null,
              ruatVerified: vehiculo.ruatVerified,
              ruatVerifiedAt: vehiculo.ruatVerifiedAt,
            };
          }
        }

        return {
          ...request.toJSON(),
          User: usuario ? {
            ...usuario.toJSON(),
            name: [identidad?.firstNames, identidad?.paternalSurname, identidad?.maternalSurname].
            filter(Boolean).join(' ')
          } : null,
          identity: identidad ? {
            ciNumber: identidad.ciNumber,
            firstNames: identidad.firstNames,
            paternalSurname: identidad.paternalSurname,
            maternalSurname: identidad.maternalSurname,
            birthDate: identidad.birthDate,
            issueDate: identidad.issueDate,
            expiryDate: identidad.expiryDate,
            birthPlace: identidad.birthPlace,
            address: identidad.address,
            occupation: identidad.occupation,
            maritalStatus: identidad.maritalStatus,
            verificationStatus: identidad.verificationStatus
          } : null,
          domicile: domicilio ? {
            address: domicilio.address,
            latitude: domicilio.location?.coordinates?.[1],
            longitude: domicilio.location?.coordinates?.[0],
            verificationStatus: domicilio.verificationStatus
          } : null,
          files: archivos,
          vehicle: vehiculoDatos,
          driverId: conductor?.id || null,
          driver: conductor ? { id: conductor.id } : null
        };
      })
    );

    const total = Object.keys(recientePorUsuario).length;

    respuesta.status(200).json({
      requests: solicitudesConArchivos,
      total,
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });
  } catch (error) {
    console.error('Error al obtener solicitudes de conductores:', error);
    respuesta.status(500).json({
      error: 'Error al obtener solicitudes'
    });
  }
};

const aprobarConductor = async (solicitud, respuesta) => {
  return respuesta.status(403).json({
    error: 'La aprobación es automática. El administrador solo puede consultar el resultado.'
  });
};

const rechazarConductor = async (solicitud, respuesta) => {
  return respuesta.status(403).json({
    error: 'El rechazo es automático. El administrador solo puede consultar el resultado.'
  });
};

const obtenerPendienteConductorSolicitudes = async (solicitud, respuesta) => {
  try {
    const { limit: limite = 20, offset: desplazamiento = 0 } = solicitud.query;

    // Obtener las solicitudes de conductor pendientes (nuevo sistema)
    const pendienteSolicitudes = await ConductorSolicitud.findAll({
      where: { status: 'pendiente' },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });

    // Para cada solicitud, obtener datos del usuario y archivos
    const solicitudesConDetalles = await Promise.all(
      pendienteSolicitudes.map(async (request) => {
        // El nombre se lee de la CI verificada, no de users.
        const usuario = await Usuario.findByPk(request.userId, {
          attributes: { exclude: ['password'] }
        });
        const identidad = await UsuarioIdentidad.findOne({ where: { userId: request.userId } });

        // Obtener archivos de esta solicitud
        const solicitudArchivos = await SolicitudArchivo.findAll({
          where: { requestId: request.id }
        });

        // Construir objeto de archivos con URL completa
        let archivos = {};
        solicitudArchivos.forEach((archivo) => {
          archivos[archivo.fileType] = {
            filename: archivo.filename,
            url: `/archivos/conductores/${encodeURIComponent(archivo.filename)}`,
            status: archivo.status,
            uploadedAt: archivo.uploadedAt
          };
        });

        return {
          id: request.id,
          name: [identidad?.firstNames, identidad?.paternalSurname, identidad?.maternalSurname].filter(Boolean).join(' '),
          email: usuario?.email || '',
          phone: usuario?.phone || '',
          licenseNumber: request.metadata?.licenseNumber || '',
          licenseExpiryDate: request.metadata?.licenseExpiryDate || null,
          vehicleType: request.metadata?.vehicleType || '',
          vehiclePlate: request.metadata?.vehiclePlate || '',
          vehicleYear: request.metadata?.vehicleYear || 0,
          documentsVerified: Object.values(archivos).every(
            (f) => f.status === 'verificado'
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
            files: archivos,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt
          }
        };
      })
    );

    // Contar total de solicitudes pendientes
    const total = await ConductorSolicitud.count({ where: { status: 'pendiente' } });

    respuesta.status(200).json({
      drivers: solicitudesConDetalles,
      total,
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });
  } catch (error) {
    console.error('Error al obtener solicitudes pendientes:', error);
    respuesta.status(500).json({
      error: 'Error al obtener solicitudes pendientes'
    });
  }
};

const obtenerTodosViajes = async (solicitud, respuesta) => {
  try {
    const { status: estado, startDate: inicioFecha, endDate: finFecha, passengerId, driverId,
      limit: limite = 20, offset: desplazamiento = 0 } = solicitud.query;
    const condicionesClausula = {};
    for (const [campo, id] of Object.entries({ passengerId, driverId })) {
      if (id === undefined) continue;
      if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
        return respuesta.status(400).json({ error: 'Identificador de participante inválido.' });
      }
      condicionesClausula[campo] = id;
    }

    if (estado) {
      condicionesClausula.status = estado;
    }

    if (inicioFecha || finFecha) {
      condicionesClausula.createdAt = {};
      if (inicioFecha) {
        condicionesClausula.createdAt[Operador.gte] = new Date(inicioFecha);
      }
      if (finFecha) {
        condicionesClausula.createdAt[Operador.lte] = new Date(finFecha);
      }
    }

    const viajes = await Viaje.findAll({
      attributes: { exclude: ['rutaRecorrida'] },
      where: condicionesClausula,
      include: [
      {
        model: Usuario,
        as: 'passenger',
        attributes: ['id', 'email', 'phone'],
        include: [{ model: UsuarioIdentidad, as: 'identity', attributes: ['firstNames', 'paternalSurname', 'maternalSurname'] }]
      },
      {
        // Ride → Driver (not User). Nest User inside Driver to get name/phone.
        model: Conductor,
        as: 'driver',
        attributes: ['id', 'userId'],
        include: [
        {
          model: Usuario,
          as: 'user',
          attributes: ['id', 'email', 'phone'],
          include: [{ model: UsuarioIdentidad, as: 'identity', attributes: ['firstNames', 'paternalSurname', 'maternalSurname'] }]
        }]

      }],

      limit: parseInt(limite),
      offset: parseInt(desplazamiento),
      order: [['createdAt', 'DESC'], ['id', 'DESC']]
    });

    const total = await Viaje.count({ where: condicionesClausula });

    // Flatten driver.user into a simpler shape for the frontend
    const mapeado = viajes.map((r) => {
      const plano = r.toJSON();
      if (plano.passenger) {
        plano.passenger.name = [plano.passenger.identity?.firstNames, plano.passenger.identity?.paternalSurname, plano.passenger.identity?.maternalSurname].
        filter(Boolean).join(' ');
      }
      if (plano.driver && plano.driver.user) {
        plano.driver = {
          id: plano.driver.user.id,
          name: [plano.driver.user.identity?.firstNames, plano.driver.user.identity?.paternalSurname, plano.driver.user.identity?.maternalSurname].
          filter(Boolean).join(' '),
          email: plano.driver.user.email,
          phone: plano.driver.user.phone
        };
      }
      return plano;
    });

    respuesta.status(200).json({
      rides: mapeado,
      total,
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });
  } catch (error) {
    console.error('Error al obtener viajes:', error.message || error);
    respuesta.status(500).json({
      error: 'Error al obtener viajes',
      detail: error.message
    });
  }
};

const consultarViajeAdministrativo = consultar => async (solicitud, respuesta) => {
  const { rideId } = solicitud.params;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(rideId)) {
    return respuesta.status(400).json({ error: 'Identificador de viaje inválido.' });
  }
  try {
    const administrador = await Usuario.findOne({
      attributes: ['id'], where: { id: solicitud.user.id, role: 'administrador', isActive: true }
    });
    if (!administrador) return respuesta.status(403).json({ error: 'Se requiere una cuenta de administrador activa.' });

    const datos = await consultar(rideId);
    if (!datos) return respuesta.status(404).json({ error: 'Viaje no encontrado.' });
    return respuesta.set('Cache-Control', 'private, no-store').json(datos);
  } catch (error) {
    console.error('Error al consultar el detalle administrativo del viaje:', error.original?.code ?? error.name);
    return respuesta.status(500).json({ error: 'No se pudieron cargar los datos del viaje.' });
  }
};

const atributosRecorrido = ['status', 'pickupLocation', 'dropoffLocation', 'rutaRecorrida'];

const coordenadasDelPunto = punto => {
  if (!punto?.coordinates) return null;
  const [longitude, latitude] = punto.coordinates;
  return { latitude, longitude };
};

const presentarRecorrido = viaje => ({
  status: viaje.status,
  pickupLocation: coordenadasDelPunto(viaje.pickupLocation),
  dropoffLocation: coordenadasDelPunto(viaje.dropoffLocation),
  rutaRecorrida: viaje.rutaRecorrida
    ? { type: viaje.rutaRecorrida.type, coordinates: viaje.rutaRecorrida.coordinates }
    : null
});

const obtenerRecorridoViaje = consultarViajeAdministrativo(async rideId => {
  const viaje = await Viaje.findByPk(rideId, { attributes: atributosRecorrido });
  return viaje && presentarRecorrido(viaje);
});

const obtenerDetalleViaje = consultarViajeAdministrativo(async rideId => {
  const participante = as => ({
    model: Usuario, as, attributes: ['id', 'phone'],
    include: [{ model: UsuarioIdentidad, as: 'identity', attributes: ['firstNames', 'paternalSurname', 'maternalSurname'] }]
  });
  const atributosDetalle = [
    'id', 'driverId', 'pickup_address', 'dropoff_address', 'distance', 'duration', 'requestMode', 'vehicle_type_requested',
    'paymentMethod', 'baseFare', 'farePerKm', 'farePerMinute', 'totalFare', 'finalFare',
    'createdAt', 'acceptedAt', 'arrivedAt', 'passengerReadyAt', 'startedAt', 'completedAt', 'cancelledAt', 'cancelledBy'
  ];
  const viaje = await Viaje.findByPk(rideId, {
    attributes: [...atributosRecorrido, ...atributosDetalle],
    include: [
      participante('passenger'),
      { model: Conductor, as: 'driver', attributes: ['id'], include: [participante('user')] },
      { model: CancelacionMotivo, as: 'cancellationReason', attributes: ['description'] },
      { model: ServicioZona, as: 'serviceArea', attributes: ['name'] },
      { model: Pago, as: 'payment', attributes: ['amount', 'currency', 'payment_status', 'paid_at'] },
      { model: ViajeParada, as: 'waypoints', separate: true,
        attributes: ['id', 'sequence', 'address', 'arrived_at', 'departed_at'], order: [['sequence', 'ASC']] }
    ]
  });
  if (!viaje) return null;

  const presentarParticipante = usuario => usuario ? {
    name: [usuario.identity?.firstNames, usuario.identity?.paternalSurname, usuario.identity?.maternalSurname]
      .filter(Boolean).join(' '),
    phone: usuario.phone
  } : null;
  const pago = viaje.payment;
  return {
    ...Object.fromEntries(atributosDetalle.map(campo => [campo, viaje[campo]])),
    ...presentarRecorrido(viaje),
    passenger: presentarParticipante(viaje.passenger),
    driver: presentarParticipante(viaje.driver?.user),
    cancellationReason: viaje.cancellationReason?.description ?? null,
    serviceArea: viaje.serviceArea?.name ?? null,
    payment: pago ? { amount: pago.amount, currency: pago.currency, payment_status: pago.payment_status, paid_at: pago.paid_at } : null,
    waypoints: viaje.waypoints.map(parada => ({
      sequence: parada.sequence, address: parada.address, arrived_at: parada.arrived_at, departed_at: parada.departed_at
    }))
  };
});

const obtenerAnalitica = async (solicitud, respuesta) => {
  try {
    const totalUsuarios = await Usuario.count();
    const totalConductores = await Conductor.count();
    const activoConductores = await Conductor.count({ where: { isAvailable: true } });
    const totalViajes = await Viaje.count();
    const completadoViajes = await Viaje.count({ where: { status: 'completado' } });
    const canceladoViajes = await Viaje.count({ where: { status: 'cancelado' } });

    // Sum finalFare on all completed rides (no paymentStatus column in rides table)
    const totalIngresos = await Viaje.sum('finalFare', {
      where: { status: 'completado' }
    });

    const promedioTarifa = completadoViajes > 0 ? (totalIngresos || 0) / completadoViajes : 0;

    const viajesThisMes = await Viaje.count({
      where: {
        createdAt: {
          [Operador.gte]: new Date(new Date().setDate(1))
        },
        status: 'completado'
      }
    });

    const completionRate = totalViajes > 0 ? completadoViajes / totalViajes * 100 : 0;

    respuesta.status(200).json({
      analytics: {
        totalUsers: totalUsuarios,
        totalDrivers: totalConductores,
        activeDrivers: activoConductores,
        totalRides: totalViajes,
        completedRides: completadoViajes,
        cancelledRides: canceladoViajes,
        totalRevenue: totalIngresos || 0,
        averageFare: Math.round(promedioTarifa * 100) / 100,
        ridesThisMonth: viajesThisMes,
        completionRate: Math.round(completionRate * 10) / 10
      }
    });
  } catch (error) {
    console.error('Error al obtener análiticas:', error.message || error);
    respuesta.status(500).json({
      error: 'Error al obtener las análiticas',
      detail: error.message
    });
  }
};

const eliminarConductor = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId } = solicitud.params;

    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return respuesta.status(404).json({
        error: 'Conductor no encontrado'
      });
    }

    // Verificar si tiene viajes activos
    const activoViajes = await Viaje.count({
      where: {
        driverId: conductorId,
        status: { [Operador.in]: ['aceptado', 'en_curso'] }
      }
    });

    if (activoViajes > 0) {
      return respuesta.status(400).json({
        error: 'No se puede eliminar un conductor con viajes activos'
      });
    }

    // Eliminar el registro del conductor (User se mantiene)
    await conductor.destroy();

    respuesta.status(200).json({
      message: 'Conductor eliminado exitosamente'
    });
  } catch (error) {
    console.error('Error al eliminar conductor:', error);
    respuesta.status(500).json({
      error: 'Error al eliminar el conductor'
    });
  }
};

const obtenerDetalleUsuario = async (solicitud, respuesta) => {
  try {
    const { userId: usuarioId } = solicitud.params;
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(usuarioId)) {
      return respuesta.status(400).json({ error: 'Identificador de usuario inválido.' });
    }
    const usuario = await Usuario.findByPk(usuarioId, {
      attributes: ['id', 'email', 'phone', 'role', 'createdAt', 'profilePhoto', 'isActive', 'phoneVerified', 'nombreGoogle'],
      include: [{ model: UsuarioIdentidad, as: 'identity', attributes: ['firstNames', 'paternalSurname', 'maternalSurname', 'verificationStatus'] }]
    });
    if (!usuario) return respuesta.status(404).json({ error: 'Usuario no encontrado.' });

    const [solicitudConductor, registros] = await Promise.all([
      ConductorSolicitud.findOne({
        where: { userId: usuarioId }, attributes: ['id', 'status', 'version'], order: [['version', 'DESC']]
      }),
      AuditoriaRegistro.findAll({
        where: {
          table_name: 'usuario', record_id: usuarioId
        },
        include: [AuditoriaRegistro.eventFilter('cambio_acceso'), { model: Usuario, as: 'changedBy', attributes: ['email'], include: [{
          model: UsuarioIdentidad, as: 'identity', attributes: ['firstNames', 'paternalSurname', 'maternalSurname']
        }] }],
        order: [['changed_at', 'DESC'], ['id', 'DESC']]
      })
    ]);

    const identidad = usuario.identity;
    return respuesta.set('Cache-Control', 'private, no-store').json({
      usuario: {
        id: usuario.id,
        nombre: identidad?.verificationStatus === 'verificado'
          ? [identidad.firstNames, identidad.paternalSurname, identidad.maternalSurname].filter(Boolean).join(' ')
          : usuario.nombreGoogle || 'Sin nombre',
        correo: usuario.email,
        telefono: usuario.phone,
        rol: usuario.role,
        fechaRegistro: usuario.createdAt,
        foto: usuario.profilePhoto,
        activo: usuario.isActive,
        telefonoVerificado: usuario.phoneVerified,
        estadoIdentidad: identidad?.verificationStatus ?? null,
        ...await require('../services/identidadAcceso').accesoIdentidad(usuario.id, identidad?.verificationStatus === 'verificado')
      },
      solicitudConductor,
      historial: registros.map(registro => {
        const identidad = registro.changedBy?.identity;
        const nombre = [identidad?.firstNames, identidad?.paternalSurname, identidad?.maternalSurname].filter(Boolean).join(' ');
        return {
          id: registro.id,
          activo: registro.new_values.isActive,
          motivo: registro.new_values.motivo,
          fecha: registro.changed_at,
          administrador: nombre || registro.changedBy?.email || null
        };
      })
    });
  } catch (error) {
    console.error('Error al obtener el detalle del usuario:', error);
    return respuesta.status(500).json({ error: 'No se pudo cargar el detalle del usuario.' });
  }
};

const cambiarAccesoUsuario = (activo) => async (solicitud, respuesta) => {
  const motivo = typeof solicitud.body?.motivo === 'string' ? solicitud.body.motivo.trim() : '';
  if ((!activo && !motivo) || motivo.length > 500) {
    return respuesta.status(400).json({ error: 'Ingresa un motivo de hasta 500 caracteres.' });
  }
  try {
    const usuario = await sequelize.transaction(async transaccion => {
      const registro = await Usuario.findByPk(solicitud.params.userId, {
        transaction: transaccion, lock: transaccion.LOCK.UPDATE
      });
      if (!registro || registro.isActive === activo) return registro;

      const estadoAnterior = registro.isActive;
      await registro.update({ isActive: activo }, { transaction: transaccion });
      await AuditoriaRegistro.create({
        table_name: 'usuario', record_id: registro.id, action: 'ACTUALIZACION',
        old_values: { isActive: estadoAnterior },
        new_values: { tipo: 'cambio_acceso', isActive: activo, motivo: motivo || null },
        changed_by: solicitud.user.id
      }, { transaction: transaccion });
      return registro;
    });
    if (!usuario) return respuesta.status(404).json({ error: 'Usuario no encontrado.' });
    if (!activo) require('../socket').desconectarCuentaDesactivada(usuario.id);
    return respuesta.json({ message: activo ? 'Usuario habilitado.' : 'Usuario desactivado.' });
  } catch (error) {
    console.error('Error al actualizar el acceso del usuario:', error);
    return respuesta.status(500).json({ error: 'No se pudo actualizar el acceso del usuario.' });
  }
};

const eliminarUsuario = cambiarAccesoUsuario(false);
const enableUsuario = cambiarAccesoUsuario(true);

/**
 * Admin aprueba el RUAT enviado por el conductor
 * POST /administracion/vehiculos/:vehicleId/aprobar-ruat
 */
const aprobarVehiculoRuat = async (solicitud, respuesta) => {
  return respuesta.status(403).json({
    error: 'La verificación del RUAT es automática. El administrador solo puede consultar el resultado.'
  });
};

/**
 * Admin rechaza el RUAT enviado por el conductor
 * POST /administracion/vehiculos/:vehicleId/rechazar-ruat
 * body: { reason: string }
 */
const rechazarVehiculoRuat = async (solicitud, respuesta) => {
  return respuesta.status(403).json({
    error: 'El rechazo del RUAT es automático. El administrador solo puede consultar el resultado.'
  });
};

/**
 * Suspender / reactivar un conductor manualmente
 * PUT /administracion/conductores/:driverId/suspender   { suspend: true }
 * PUT /administracion/conductores/:driverId/suspender   { suspend: false }
 */
const alternarSuspenderConductor = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId } = solicitud.params;
    const { suspend: suspender } = solicitud.body;

    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return respuesta.status(404).json({ error: 'Conductor no encontrado' });
    }

    if (suspender) {
      await conductor.update({ status: 'suspendido', isAvailable: false });
      console.log(`🔴 Conductor ${conductorId} suspendido`);
    } else {
      await conductor.update({ status: 'aprobado', isAvailable: true });
      console.log(`🟢 Conductor ${conductorId} reactivado`);
    }

    const { notificar: notificar } = require("../services/notificacionServicio");
    notificar({
      userId: conductor.userId,
      title: suspender ? 'Cuenta suspendida' : 'Cuenta reactivada',
      body: suspender ?
      'Tu cuenta ha sido suspendida temporalmente. Contacta soporte para más información.' :
      'Tu cuenta ha sido reactivada. Ya puedes recibir viajes.',
      type: 'sistema',
      data: { suspended: suspender }
    });

    respuesta.json({
      message: suspender ? 'Conductor suspendido' : 'Conductor reactivado',
      driver: {
        id: conductor.id,
        status: conductor.status,
        isAvailable: conductor.isAvailable
      }
    });
  } catch (error) {
    console.error('Error al cambiar estado del conductor:', error);
    respuesta.status(500).json({ error: 'Error: ' + error.message });
  }
};

const obtenerTodosPagos = async (solicitud, respuesta) => {
  try {
    const { status: estado, limit: limite = 20, offset: desplazamiento = 0 } = solicitud.query;
    const condicionesClausula = {};

    if (estado) {
      condicionesClausula.payment_status = estado;
    }

    const pagos = await Pago.findAll({
      where: condicionesClausula,
      include: [
      { model: Viaje, as: 'ride', attributes:['id','passengerId','pickup_address','dropoff_address','status','finalFare'], include:[{model:Usuario,as:'passenger',attributes:['id','email','phone'],include:[{model:UsuarioIdentidad,as:'identity'}]}]
      }],

      limit: parseInt(limite),
      offset: parseInt(desplazamiento),
      order: [['createdAt', 'DESC']]
    });

    const total = await Pago.count({ where: condicionesClausula });

    // Summary totals
    const completadoIngresos = (await Pago.sum('amount', {
      where: { payment_status: 'completado' }
    })) || 0;
    const pendienteImporte = (await Pago.sum('amount', {
      where: { payment_status: 'pendiente' }
    })) || 0;
    const pendienteCantidad = await Pago.count({
      where: { payment_status: 'pendiente' }
    });

    respuesta.status(200).json({
      payments: pagos,
      total,
      limit: parseInt(limite),
      offset: parseInt(desplazamiento),
      summary: {
        completedRevenue: Number(completadoIngresos),
        pendingAmount: Number(pendienteImporte),
        pendingCount: pendienteCantidad
      }
    });
  } catch (error) {
    console.error('Error al obtener pagos:', error.message || error);
    respuesta.status(500).json({
      error: 'Error al obtener pagos',
      detail: error.message
    });
  }
};
// ─── ADVANCED ANALYTICS ────────────────────────────────────────────────────

// Helper: get date range boundaries
const obtenerFechaIntervalo = (intervalo = 'month') => {
  const ahora = new Date();
  let realInicio, anteriorInicio, anteriorFin;

  if (intervalo === 'week') {
    realInicio = new Date(ahora);
    realInicio.setDate(ahora.getDate() - 7);
    anteriorFin = new Date(realInicio);
    anteriorInicio = new Date(anteriorFin);
    anteriorInicio.setDate(anteriorFin.getDate() - 7);
  } else if (intervalo === 'year') {
    realInicio = new Date(ahora.getFullYear(), 0, 1);
    anteriorInicio = new Date(ahora.getFullYear() - 1, 0, 1);
    anteriorFin = new Date(ahora.getFullYear() - 1, 11, 31);
  } else {
    // month
    realInicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    anteriorInicio = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    anteriorFin = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
  }
  return { currentStart: realInicio, previousStart: anteriorInicio, previousEnd: anteriorFin, now: ahora };
};

const obtenerAnaliticaExtendido = async (solicitud, respuesta) => {
  try {
    const { range: intervalo = 'month' } = solicitud.query;
    const { currentStart: realInicio, previousStart: anteriorInicio, previousEnd: anteriorFin, now: ahora } = obtenerFechaIntervalo(intervalo);

    const fechaFiltro = { createdAt: { [Operador.gte]: realInicio, [Operador.lte]: ahora } };
    const anteriorFiltro = { createdAt: { [Operador.gte]: anteriorInicio, [Operador.lte]: anteriorFin } };

    // Current period
    const viajes = await Viaje.count({ where: fechaFiltro });
    const completado = await Viaje.count({ where: { ...fechaFiltro, status: 'completado' } });
    const cancelado = await Viaje.count({ where: { ...fechaFiltro, status: 'cancelado' } });
    const ingresos = (await Viaje.sum('finalFare', { where: { ...fechaFiltro, status: 'completado' } })) || 0;
    const usuarios = await Usuario.count({ where: fechaFiltro });

    // Previous period
    const anteriorViajes = await Viaje.count({ where: anteriorFiltro });
    const anteriorIngresos = (await Viaje.sum('finalFare', { where: { ...anteriorFiltro, status: 'completado' } })) || 0;
    const anteriorUsuarios = await Usuario.count({ where: anteriorFiltro });
    const anteriorCompletado = await Viaje.count({ where: { ...anteriorFiltro, status: 'completado' } });

    const porcentaje = (cur, anterior) => anterior > 0 ? Math.round((cur - anterior) / anterior * 1000) / 10 : cur > 0 ? 100 : 0;

    // All-time totals
    const totalUsuarios = await Usuario.count();
    const totalConductores = await Conductor.count();
    const activoConductores = await Conductor.count({ where: { isAvailable: true } });

    respuesta.json({
      range: intervalo,
      current: {
        rides: viajes, completed: completado, cancelled: cancelado, revenue: Math.round(ingresos * 100) / 100,
        users: usuarios,
        avgFare: completado > 0 ? Math.round(ingresos / completado * 100) / 100 : 0,
        completionRate: viajes > 0 ? Math.round(completado / viajes * 1000) / 10 : 0,
        cancellationRate: viajes > 0 ? Math.round(cancelado / viajes * 1000) / 10 : 0
      },
      deltas: {
        rides: porcentaje(viajes, anteriorViajes),
        revenue: porcentaje(ingresos, anteriorIngresos),
        users: porcentaje(usuarios, anteriorUsuarios),
        completed: porcentaje(completado, anteriorCompletado)
      },
      totals: { totalUsers: totalUsuarios, totalDrivers: totalConductores, activeDrivers: activoConductores }
    });
  } catch (error) {
    console.error('getAnalyticsExtended error:', error.message);
    respuesta.status(500).json({ error: 'Error al obtener analíticas extendidas', detail: error.message });
  }
};

const obtenerViajesPorDia = async (solicitud, respuesta) => {
  try {
    const dias = Math.min(parseInt(solicitud.query.days) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - dias);

    const resultados = await sequelize.query(`
      SELECT DATE(created_at) AS day, COUNT(*)::int AS count
      FROM viaje
      WHERE created_at >= :since AND deleted_at IS NULL
      GROUP BY DATE(created_at)
      ORDER BY day
    `, { replacements: { since }, type: sequelize.QueryTypes.SELECT });

    respuesta.json({ days: resultados });
  } catch (error) {
    console.error('getRidesByDay error:', error.message);
    respuesta.status(500).json({ error: 'Error', detail: error.message });
  }
};

const obtenerIngresosPorDia = async (solicitud, respuesta) => {
  try {
    const dias = Math.min(parseInt(solicitud.query.days) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - dias);

    const resultados = await sequelize.query(`
      SELECT DATE(created_at) AS day,
             COALESCE(SUM(final_fare), 0)::float AS revenue,
             COUNT(*)::int AS viaje
      FROM viaje
      WHERE created_at >= :since AND status = 'completado' AND deleted_at IS NULL
      GROUP BY DATE(created_at)
      ORDER BY day
    `, { replacements: { since }, type: sequelize.QueryTypes.SELECT });

    respuesta.json({ days: resultados });
  } catch (error) {
    console.error('getRevenueByDay error:', error.message);
    respuesta.status(500).json({ error: 'Error', detail: error.message });
  }
};

const obtenerUsuarioSegmentacion = async (solicitud, respuesta) => {
  try {
    const pasajeros = await Usuario.count({ where: { role: 'pasajero' } });
    const conductores = await Conductor.count();
    const admins = await Usuario.count({ where: { role: 'administrador' } });
    const activo = await Usuario.count({ where: { isActive: true } });
    const inactivo = await Usuario.count({ where: { isActive: false } });
    const verificado = await Usuario.count({ where: { phoneVerified: true } });
    const unverified = await Usuario.count({ where: { phoneVerified: false } });

    respuesta.json({
      byRole: { passengers: pasajeros, drivers: conductores, admins },
      byStatus: { active: activo, inactive: inactivo },
      byVerification: { verified: verificado, unverified }
    });
  } catch (error) {
    console.error('getUserSegmentation error:', error.message);
    respuesta.status(500).json({ error: 'Error', detail: error.message });
  }
};

const obtenerViajeEmbudo = async (solicitud, respuesta) => {
  try {
    const { range: intervalo = 'month' } = solicitud.query;
    const { currentStart: realInicio } = obtenerFechaIntervalo(intervalo);
    const w = { createdAt: { [Operador.gte]: realInicio } };

    const solicitado = await Viaje.count({ where: w });
    const aceptado = await Viaje.count({ where: { ...w, status: { [Operador.in]: ['aceptado', 'llegado', 'en_curso', 'completado'] } } });
    const enProgreso = await Viaje.count({ where: { ...w, status: { [Operador.in]: ['en_curso', 'completado'] } } });
    const completado = await Viaje.count({ where: { ...w, status: 'completado' } });

    respuesta.json({
      funnel: [
      { stage: 'Solicitados', count: solicitado },
      { stage: 'Aceptados', count: aceptado },
      { stage: 'En curso', count: enProgreso },
      { stage: 'Completados', count: completado }]

    });
  } catch (error) {
    console.error('getRideFunnel error:', error.message);
    respuesta.status(500).json({ error: 'Error', detail: error.message });
  }
};

const obtenerEconomiaUnitaria = async (solicitud, respuesta) => {
  try {
    const totalUsuarios = await Usuario.count();
    const totalConductores = await Conductor.count();
    const completadoViajes = await Viaje.count({ where: { status: 'completado' } });
    const totalIngresos = (await Viaje.sum('finalFare', { where: { status: 'completado' } })) || 0;

    // Users who have taken at least 1 ride
    const activoRiders = await Viaje.count({
      distinct: true,
      col: 'passengerId'
    });

    const r = (v) => Math.round(v * 100) / 100;

    respuesta.json({
      revenuePerUser: r(totalUsuarios > 0 ? totalIngresos / totalUsuarios : 0),
      revenuePerDriver: r(totalConductores > 0 ? totalIngresos / totalConductores : 0),
      revenuePerRide: r(completadoViajes > 0 ? totalIngresos / completadoViajes : 0),
      ridesPerUser: r(activoRiders > 0 ? completadoViajes / activoRiders : 0),
      totalRevenue: r(totalIngresos),
      completedRides: completadoViajes,
      totalUsers: totalUsuarios,
      totalDrivers: totalConductores,
      activeRiders: activoRiders
    });
  } catch (error) {
    console.error('getUnitEconomics error:', error.message);
    respuesta.status(500).json({ error: 'Error', detail: error.message });
  }
};

const obtenerSuperiorRutas = async (solicitud, respuesta) => {
  try {
    const limite = Math.min(parseInt(solicitud.query.limit) || 10, 20);

    const rutas = await sequelize.query(`
      SELECT pickup_address, dropoff_address, COUNT(*)::int AS count,
             COALESCE(AVG(final_fare), 0)::float AS avg_fare
      FROM viaje
      WHERE status = 'completado' AND deleted_at IS NULL
        AND pickup_address IS NOT NULL AND dropoff_address IS NOT NULL
      GROUP BY pickup_address, dropoff_address
      ORDER BY count DESC
      LIMIT :limit
    `, { replacements: { limit: limite }, type: sequelize.QueryTypes.SELECT });

    respuesta.json({ routes: rutas });
  } catch (error) {
    console.error('getTopRoutes error:', error.message);
    respuesta.status(500).json({ error: 'Error', detail: error.message });
  }
};

module.exports = {
  obtenerDatosIdentidad: consultarDatosIdentidad(false),
  corregirDatosIdentidad: consultarDatosIdentidad(true),
  obtenerIdentidadEvidencia: obtenerIdentidadEvidencia,
  obtenerConductorOcrVistaPrevia: obtenerConductorOcrVistaPrevia,
  obtenerTodosUsuarios: obtenerTodosUsuarios,
  obtenerDetalleUsuario,
  obtenerTodosConductores: obtenerTodosConductores,
  aprobarConductor: aprobarConductor,
  rechazarConductor: rechazarConductor,
  obtenerPendienteConductorSolicitudes: obtenerPendienteConductorSolicitudes,
  obtenerTodosViajes: obtenerTodosViajes,
  obtenerRecorridoViaje,
  obtenerDetalleViaje,
  obtenerTodosPagos: obtenerTodosPagos,
  obtenerAnalitica: obtenerAnalitica,
  obtenerAnaliticaExtendido: obtenerAnaliticaExtendido,
  obtenerViajesPorDia: obtenerViajesPorDia,
  obtenerIngresosPorDia: obtenerIngresosPorDia,
  obtenerUsuarioSegmentacion: obtenerUsuarioSegmentacion,
  obtenerViajeEmbudo: obtenerViajeEmbudo,
  obtenerEconomiaUnitaria: obtenerEconomiaUnitaria,
  obtenerSuperiorRutas: obtenerSuperiorRutas,
  eliminarConductor: eliminarConductor,
  eliminarUsuario: eliminarUsuario,
  enableUsuario: enableUsuario,
  alternarSuspenderConductor: alternarSuspenderConductor,
  aprobarVehiculoRuat: aprobarVehiculoRuat,
  rechazarVehiculoRuat: rechazarVehiculoRuat
};
