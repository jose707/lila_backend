const { obtenerConsentimientoIdentidad, validarConsentimientoIdentidad } = require('../services/consentimientos');
const documentosRepo = require('../services/documentosRepositorio');
// backend/src/controllers/autenticacionControlador.js
const Usuario = require("../models/Usuario");
const UsuarioIdentidad = require("../models/UsuarioIdentidad");
const sequelize = require("../config/baseDatos");
const Conductor = require("../models/Conductor");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const ocrServicio = require("../services/servicioOcr");
const { prepararDocumentoImagen, analizarRecorteRectangulo: analizarRecorteRectangulo, prepararCiParaOcr: prepararCiParaOcr } = require("../services/documentoRecorte");
const { isoFecha: isoFecha, comprobarAdulto: comprobarAdulto, compararIdentidadMrz: compararIdentidadMrz, validarIdentidad: validarIdentidad } = require("../services/identidadValidacion");
const { sellar: sellar, unseal: unseal } = require("../services/identidadSessionCrypto");
const { invokeLambda: invokeLambda } = require("../services/rostroLivenessLambda");
const crypto = require('crypto');

const CI_OCR_COMPROBANTE_VINCULACION = (usuarioId) => `${usuarioId}:ci-ocr-precheck-v1`;
const CI_OCR_COMPROBANTE_VIGENCIA_MILISEGUNDOS = 10 * 60 * 1000;
const imagenDigest = (imagen) => crypto.createHash('sha256').update(imagen).digest('hex');

// El OCR devuelve fechas como DD/MM/AAAA; PostgreSQL DATE usa AAAA-MM-DD.
const hastaIsoFecha = (valor) => {
  const coincidencia = String(valor || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return coincidencia ? `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}` : valor || null;
};

const generarToken = (usuario) => {
  return jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
      role: usuario.role
    },
    process.env.JWT_SECRET || 'secret',
    {
      expiresIn: process.env.JWT_EXPIRE || '30d'
    }
  );
};

// Helper function to build response user object with driver rating
const construirUsuarioRespuestaObjeto = async (usuario) => {
  const identidad = await UsuarioIdentidad.findOne({ where: { userId: usuario.id } });
  const officialNombre = identidad ?
  [identidad.firstNames, identidad.paternalSurname, identidad.maternalSurname].
  filter(Boolean).join(' ') :
  '';
  const respuestaUsuario = {
    id: usuario.id,
    // Compatibilidad de API: se expone el nombre oficial, no se duplica en users.
    nombre: officialNombre,
    correo: usuario.email,
    telefono: usuario.phone,
    telefonoVerificado: usuario.phoneVerified,
    estadoVerificacionIdentidad: identidad?.verificationStatus || 'pendiente',
    documentosIdentidadEnviados: !!identidad,
    motivoRechazoIdentidad: identidad?.verificationStatus === 'rechazado' ? identidad.rejectionReason : null,
    rol: usuario.role,
    fotoPerfil: usuario.profilePhoto,
    urlFoto: usuario.profilePhoto,
    calificacion: usuario.rating,
    totalViajes: usuario.totalTrips || 0,
    modoActual: usuario.modoActual || 'pasajero'
  };

  // Fetch driver data if user has a driver profile
  try {
    const conductor = await Conductor.findOne({
      where: { userId: usuario.id }
    });
    if (conductor) {
      respuestaUsuario.calificacionConductor = conductor.rating;
      respuestaUsuario.totalViajesComoConductor = conductor.totalRides || 0;
      console.log('✅ Perfil del conductor encontrado:', {
        idUsuario: usuario.id,
        calificacionConductor: conductor.rating,
        totalViajesComoConductor: conductor.totalRides
      });
    } else {
      console.log(
        '⚠️ Usuario sin perfil de conductor:',
        usuario.id
      );
      // Si no existe registro de conductor pero el modo guardado es 'conductor',
      // lo reseteamos a 'pasajero' para evitar acceso indebido al panel de conductor.
      if (respuestaUsuario.modoActual === 'conductor') {
        console.log(
          '🔄 Modo restablecido a pasajero'
        );
        respuestaUsuario.modoActual = 'pasajero';
        // Persistir en la BD para que futuros logins ya estén limpios
        try {
          await usuario.update({ modoActual: 'pasajero' });
        } catch (actualizarError) {
          console.error(
            '⚠️ No se pudo actualizar el modo actual:',
            actualizarError
          );
        }
      }
    }
  } catch (error) {
    console.error('Error al cargar el perfil del conductor:', error);
  }

  console.log('📤 Respuesta de usuario:', {
    id: respuestaUsuario.id,
    nombre: respuestaUsuario.nombre,
    calificacion: respuestaUsuario.calificacion,
    calificacionConductor: respuestaUsuario.calificacionConductor,
    modoActual: respuestaUsuario.modoActual
  });

  return respuestaUsuario;
};

// Check if user exists by Firebase UID
const comprobarFirebaseUsuario = async (solicitud, respuesta) => {
  try {
    const { firebaseUid } = solicitud.params;

    if (!firebaseUid) {
      return respuesta.status(400).json({
        error: 'Firebase UID is required'
      });
    }

    const usuario = await Usuario.findOne({
      where: { firebaseUid }
    });

    if (usuario) {
      // Si el usuario fue creado con Firebase/Google pero no completó la verificación de teléfono,
      // no debemos permitir inicio de sesión.
      if (usuario.firebaseUid && !usuario.phoneVerified) {
        return respuesta.status(200).json({
          exists: true,
          needsPhoneVerification: true,
          message: 'Phone verification required'
        });
      }

      // User exists, return user data and generate token
      const token = generarToken(usuario);
      const respuestaUsuario = await construirUsuarioRespuestaObjeto(usuario);

      return respuesta.status(200).json({
        exists: true,
        message: 'User found',
        token,
        user: respuestaUsuario
      });
    } else {
      // User doesn't exist, needs to complete registration
      return respuesta.status(200).json({
        exists: false,
        message: 'User not found, needs registration'
      });
    }
  } catch (error) {
    console.error('Error checking Firebase user:', error);
    respuesta.status(500).json({ error: 'Error checking user: ' + error.message });
  }
};

const registrarse = async (solicitud, respuesta) => {
  try {
    const { name: nombre, email: correo, phone: telefono, password: contrasena, confirmPassword: confirmarContrasena } = solicitud.body;

    // Validaciones
    if (!nombre || !correo || !telefono || !contrasena || !confirmarContrasena) {
      return respuesta.status(400).json({
        error: 'Todos los campos son requeridos'
      });
    }

    if (contrasena !== confirmarContrasena) {
      return respuesta.status(400).json({
        error: 'Las contraseñas no coinciden'
      });
    }

    if (contrasena.length < 6) {
      return respuesta.status(400).json({
        error: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    // Verificar si el usuario ya existe
    const existenteUsuario = await Usuario.findOne({
      where: { email: correo }
    });

    if (existenteUsuario) {
      return respuesta.status(400).json({
        error: 'El email ya está registrado'
      });
    }

    // Hash de la contraseña
    const hashedContrasena = await bcrypt.hash(contrasena, 10);

    // Crear usuario: por defecto todos son pasajeros al inicio
    const usuario = await Usuario.create({
      email: correo,
      phone: telefono,
      password: hashedContrasena,
      role: 'pasajero'
    });

    // Generar token
    const token = generarToken(usuario);

    const respuestaUsuario = await construirUsuarioRespuestaObjeto(usuario);

    respuesta.status(201).json({
      message: 'Usuario registrado exitosamente',
      token,
      user: respuestaUsuario
    });
  } catch (error) {
    console.error('Error en signup:', error);
    respuesta.status(500).json({
      error: 'Error al registrar el usuario'
    });
  }
};

const ingresar = async (solicitud, respuesta) => {
  try {
    const { email: correo, password: contrasena } = solicitud.body;

    // Validaciones
    if (!correo || !contrasena) {
      return respuesta.status(400).json({
        error: 'Email y contraseña son requeridos'
      });
    }

    // Buscar usuario
    const usuario = await Usuario.findOne({
      where: { email: correo }
    });

    if (!usuario) {
      return respuesta.status(401).json({
        error: 'Email o contraseña incorrectos'
      });
    }

    // Verificar si el usuario está activo
    if (!usuario.isActive) {
      return respuesta.status(403).json({
        error:
        'Tu cuenta ha sido deshabilitada. Contacta al administrador para más información.'
      });
    }

    // Si este usuario está asociado a Firebase/Google, exigir verificación (teléfono/OTP)
    if (usuario.firebaseUid && !usuario.phoneVerified) {
      return respuesta.status(403).json({
        error:
        'Debes verificar tu número de celular antes de iniciar sesión.'
      });
    }

    // Comparar contraseña
    const esContrasenaValido = await bcrypt.compare(contrasena, usuario.password);

    if (!esContrasenaValido) {
      return respuesta.status(401).json({
        error: 'Email o contraseña incorrectos'
      });
    }

    // Actualizar último login
    await usuario.update({
      lastLogin: new Date()
    });

    // Generar token
    const token = generarToken(usuario);

    const respuestaUsuario = await construirUsuarioRespuestaObjeto(usuario);

    respuesta.status(200).json({
      message: 'Login exitoso',
      token,
      user: respuestaUsuario
    });
  } catch (error) {
    console.error('Error en login:', error);
    respuesta.status(500).json({
      error: 'Error al iniciar sesión'
    });
  }
};

const obtenerRealUsuario = async (solicitud, respuesta) => {
  try {
    const usuario = await Usuario.findByPk(solicitud.user.id, {
      attributes: { exclude: ['password'] }
    });

    if (!usuario) {
      return respuesta.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    // Usar buildUserResponseObject para validar que el registro de conductor existe
    // y resetear modoActual si fue eliminado de la BD
    const respuestaUsuario = await construirUsuarioRespuestaObjeto(usuario);

    respuesta.set('Cache-Control', 'no-store');
    respuesta.status(200).json({
      user: respuestaUsuario
    });
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    respuesta.status(500).json({
      error: 'Error al obtener el usuario'
    });
  }
};

const renovarToken = async (solicitud, respuesta) => {
  try {
    const usuario = await Usuario.findByPk(solicitud.user.id);

    if (!usuario) {
      return respuesta.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    const token = generarToken(usuario);

    respuesta.status(200).json({
      token
    });
  } catch (error) {
    console.error('Error al refrescar token:', error);
    respuesta.status(500).json({
      error: 'Error al refrescar el token'
    });
  }
};

const googleAutenticacion = async (solicitud, respuesta) => {
  try {
    const { idToken, email: correo, name: nombre, photo: foto } = solicitud.body;

    // Log para debugging
    console.log('Google Auth Request:', {
      idToken: idToken ? 'present' : 'missing',
      email: correo,
      name: nombre,
      photo: foto
    });

    if (!correo) {
      return respuesta.status(400).json({ error: 'Email is required' });
    }

    let usuario = await Usuario.findOne({ where: { email: correo } });

    if (!usuario) {
      usuario = await Usuario.create({
        email: correo,
        phone: '', // Valor por defecto para Google Auth
        profilePhoto: foto,
        password: 'google_auth', // Valor por defecto para Google Auth
        role: 'user',
        isActive: true
      });
      console.log('New user created from Google:', usuario.id, correo);
    } else {
      console.log('Existing user found:', usuario.id, correo);
      if (!usuario.isActive) {
        return respuesta.status(403).json({
          error:
          'Tu cuenta ha sido deshabilitada. Contacta al administrador para más información.'
        });
      }
    }

    const token = generarToken(usuario);

    const respuestaUsuario = await construirUsuarioRespuestaObjeto(usuario);

    respuesta.json({
      message: 'Google login successful',
      token,
      user: respuestaUsuario
    });
  } catch (error) {
    console.error('Error in googleAuth:', error);
    respuesta.status(500).json({ error: error.message });
  }
};

/**
 * Verify phone number with Firebase OTP
 * POST /autenticacion/verificar-telefono
 */
const verificarTelefonoOtp = async (solicitud, respuesta) => {
  try {
    const { firebaseUid, phone: telefono, email: correo, name: nombre, photoURL: fotoUrl, checkOnly: comprobarOnly } = solicitud.body;

    // Modo "solo consulta": NO escribir en BD, solo verificar duplicados
    if (comprobarOnly) {
      if (!telefono) {
        return respuesta.status(400).json({ error: 'Phone number is required' });
      }

      const existentePorTelefono = await Usuario.findOne({ where: { phone: telefono } });

      // Si el teléfono ya está registrado por otra cuenta, bloquear
      if (
      existentePorTelefono && (
      !firebaseUid || existentePorTelefono.firebaseUid !== firebaseUid))
      {
        return respuesta.status(409).json({
          error: 'Este número de teléfono ya está registrado'
        });
      }

      return respuesta.status(200).json({
        ok: true,
        exists: false
      });
    }

    if (!firebaseUid || !telefono || !correo) {
      return respuesta.status(400).json({
        error: 'Firebase UID, phone number, and email are required'
      });
    }

    // Find or create user with Firebase UID
    let usuario = await Usuario.findOne({
      where: { firebaseUid }
    });

    if (!usuario) {
      // Create new user from Firebase with the data sent from frontend
      usuario = await Usuario.create({
        email: correo, // Use the actual Google email
        phone: telefono,
        firebaseUid,
        profilePhoto: fotoUrl || null, // Save the photo URL from Google
        password: firebaseUid, // Use Firebase UID as temporary password
        role: 'pasajero', // New users start as passenger; driver role is via Driver table
        phoneVerified: true
      });

      console.log('✅ Usuario creado desde Firebase');
    } else {
      // Update user with latest data from frontend
      await usuario.update({
        email: correo || usuario.email,
        phone: telefono,
        profilePhoto: [`/api/usuarios/${usuario.id}/foto-perfil`, `/api/users/${usuario.id}/profile-photo`].includes(usuario.profilePhoto) ?
        usuario.profilePhoto : fotoUrl || usuario.profilePhoto,
        phoneVerified: true
      });

      console.log('✅ Usuario actualizado');
    }

    const token = generarToken(usuario);

    const respuestaUsuario = await construirUsuarioRespuestaObjeto(usuario);

    respuesta.status(200).json({
      message: 'Phone verified successfully',
      token,
      user: respuestaUsuario
    });
  } catch (error) {
    console.error('Error verifying phone:', error);
    respuesta.status(500).json({ error: 'Error verifying phone: ' + error.message });
  }
};

const obtenerLivenessComprobanteSecreto = () => {
  const secreto = process.env.FACE_LIVENESS_TICKET_SECRET;
  if (!secreto || secreto === 'secret' || Buffer.byteLength(secreto, 'utf8') < 32) {
    throw Object.assign(new Error('Configura FACE_LIVENESS_TICKET_SECRET con al menos 32 caracteres aleatorios y reinicia el backend.'), { status: 503 });
  }
  return secreto;
};

const verificarLivenessComprobante = (comprobante, sesionId, usuarioId) => {
  if (typeof comprobante !== 'string' || comprobante.length > 2048 || typeof sesionId !== 'string' || sesionId.length > 128) {
    throw Object.assign(new Error('La sesión de prueba de vida no es válida. Iníciala nuevamente.'), { status: 403 });
  }
  let claims;
  const secreto = obtenerLivenessComprobanteSecreto();
  try {claims = jwt.verify(comprobante, secreto);} catch {
    throw Object.assign(new Error('La autorización de prueba de vida expiró. Iníciala nuevamente.'), { status: 403 });
  }
  if (claims.purpose !== 'identity-face-liveness' || claims.sub !== String(usuarioId) || claims.sessionId !== sesionId) {
    throw Object.assign(new Error('La prueba de vida no pertenece a este registro.'), { status: 403 });
  }
  return claims;
};

const prepararVerificadoPerfilFoto = async (referenciaImagenBase64) => {
  if (typeof referenciaImagenBase64 !== 'string' || referenciaImagenBase64.length > 6 * 1024 * 1024 ||
  !/^[A-Za-z0-9+/]+={0,2}$/.test(referenciaImagenBase64)) {
    throw Object.assign(new Error('La prueba de vida no devolvió una foto de perfil válida. Repítela.'), { status: 502 });
  }
  try {
    const imagen = Buffer.from(referenciaImagenBase64, 'base64');
    if (imagen.length < 64 || imagen.length > 4 * 1024 * 1024) throw new Error('Invalid image size');
    return await sharp(imagen, { limitInputPixels: 24000000 }).
    rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).
    jpeg({ quality: 85 }).toBuffer();
  } catch {
    throw Object.assign(new Error('No se pudo procesar la foto de la prueba de vida. Repítela.'), { status: 502 });
  }
};

const guardarVerificadoPerfilFoto = async (usuario, imagen, transaccion) => {
  const documentoId = require('crypto').randomUUID();
  const cifrado = sellar({ image: imagen.toString('base64') }, `${documentoId}:${usuario.id}:profilePhoto`);
  await documentosRepo.query("UPDATE public.documento SET vigente=false WHERE tipo_documento='profilePhoto' AND id_documento IN (SELECT id_documento FROM public.usuario_documento WHERE id_usuario=:userId)", { userId: usuario.id }, transaccion);
  await documentosRepo.createDocument({ id_documento: documentoId, userId: usuario.id,
    tipo_documento:'profilePhoto',ruta_archivo: `encrypted-identity:${documentoId}`,tipo_mime:'application/octet-stream',
    evidencia_cifrada:cifrado.toString('base64'),origen_evidencia:'prueba_vida',estado_verificacion:'verificado',verificado_en:new Date()
  },transaccion);
  await usuario.update({ profilePhoto: `/api/usuarios/${usuario.id}/foto-perfil` }, { transaction: transaccion });
};

/** Process both CI images together; OCR data is never accepted from the app. */
const leerIdentidadDocumentos = async (cuerpo, frontalImagen, reversoImagen) => {
  const extraer = async (imagen, lado) => {
    const recorteRectangulo = analizarRecorteRectangulo(cuerpo, lado);
    const imagenProcesada = await prepararCiParaOcr(imagen, recorteRectangulo, lado);
    return {
      read: await ocrServicio.extraerDocumento(imagenProcesada, lado),
      preview: `data:image/png;base64,${imagenProcesada.toString('base64')}`
    };
  };
  const [frontalResultado, reversoResultado] = await Promise.all([
  extraer(frontalImagen, 'ciFront'), extraer(reversoImagen, 'ciBack')]
  );
  const frontal = frontalResultado.read;
  const reverso = reversoResultado.read;
  const imagenesProcesadas = {
    ciFront: frontalResultado.preview,
    ciBack: reversoResultado.preview
  };
  const ciFormatear = reverso.classify.hasMRZ ? 'current' : 'legacy';
  frontal.fields = ocrServicio.analizarCi(frontal.rawText, {
    documentType: 'ciFront', words: frontal.words, format: ciFormatear
  });
  reverso.fields = ocrServicio.analizarCi(reverso.rawText, {
    documentType: 'ciBack', words: reverso.words, format: ciFormatear
  });
  const mrzComparacion = compararIdentidadMrz(frontal, reverso, ciFormatear);
  const vistaPrevia = {
    ciFront: { fields: frontal.fields, rawText: String(frontal.rawText || '').slice(0, 6000) },
    ciBack: { fields: reverso.fields, rawText: String(reverso.rawText || '').slice(0, 6000) }
  };
  try {
    // Si se leyó una fecha válida, avisar primero que es menor de edad,
    // incluso si otra validación de captura también habría fallado.
    const nacimientoFecha = isoFecha(ciFormatear === 'legacy' ? reverso.fields.birthDate : frontal.fields.birthDate);
    if (nacimientoFecha) comprobarAdulto(nacimientoFecha);
    if (frontal.rejected || reverso.rejected) {
      const rechazado = frontal.rejected ? frontal : reverso;
      throw Object.assign(new Error(rechazado.rejectReason || 'No se reconoce una cara de la cédula.'), {
        status: 422
      });
    }
    return { front: frontal, back: reverso, fields: validarIdentidad(frontal, reverso), processedImages: imagenesProcesadas, ciFormat: ciFormatear, mrzComparison: mrzComparacion, ocrPreview: vistaPrevia };
  } catch (error) {
    if (error.status === 422) {
      // Solo para mostrar al titular qué leyó OCR cuando falla la validación.
      // No se persiste ni se incluye en la respuesta de una CI aprobada.
      error.ocrPreview = vistaPrevia;
      error.processedImages = imagenesProcesadas;
      error.ciFormat = ciFormatear;
      error.mrzComparison = mrzComparacion;
    }
    throw error;
  }
};

const obtenerConsentimiento = (_solicitud, respuesta) => {
  respuesta.set('Cache-Control', 'no-store');
  return respuesta.json(obtenerConsentimientoIdentidad());
};

const precheckIdentidadOcr = async (solicitud, respuesta) => {
  try {
    const consentimientoAceptado = validarConsentimientoIdentidad(solicitud.body);
    const frontalImagen = solicitud.files?.ciFront?.[0]?.buffer;
    const reversoImagen = solicitud.files?.ciBack?.[0]?.buffer;
    if (!frontalImagen || !reversoImagen) return respuesta.status(400).json({ error: 'Envía ambas caras del CI.' });
    const origenes = ['ciFront','ciBack'].map(lado => documentosRepo.origenAdjunto(solicitud.body,lado));
    const real = await UsuarioIdentidad.findOne({ where: { userId: solicitud.user.id } });
    if (real?.verificationStatus === 'verificado') return respuesta.status(409).json({ error: 'La identidad ya está verificada.' });
    const { front: frontal, back: reverso, fields: campos, processedImages: imagenesProcesadas, ciFormat: ciFormatear, mrzComparison: mrzComparacion, ocrPreview: ocrVistaPrevia } = await leerIdentidadDocumentos(solicitud.body, frontalImagen, reversoImagen);
    const duplicado = await UsuarioIdentidad.findOne({ where: { ciNumber: campos.ciNumber } });
    if (duplicado && duplicado.userId !== solicitud.user.id) return respuesta.status(409).json({ error: 'La cédula ya está registrada.' });
    const ocrComprobante = sellar({
      expiresAt: Date.now() + CI_OCR_COMPROBANTE_VIGENCIA_MILISEGUNDOS,
      frontDigest: imagenDigest(frontalImagen), backDigest: imagenDigest(reversoImagen),
      consentVersion: consentimientoAceptado.version,
      origins: origenes,
      crops: ['ciFront','ciBack'].map(lado => analizarRecorteRectangulo(solicitud.body,lado)),
      frontFields: frontal.fields, backFields: reverso.fields, fields: campos, ciFormat: ciFormatear, mrzComparison: mrzComparacion
    }, CI_OCR_COMPROBANTE_VINCULACION(solicitud.user.id)).toString('base64');
    respuesta.set('Cache-Control', 'no-store');
    return respuesta.json({ ocrTicket: ocrComprobante, fields: campos, ciFormat: ciFormatear, mrzComparison: mrzComparacion, processedImages: imagenesProcesadas, ocrPreview: ocrVistaPrevia, message: 'Datos del CI leídos. Revísalos antes de la prueba de vida.' });
  } catch (error) {
    console.error('Could not read identity documents:', error.name || 'Error');
    respuesta.set('Cache-Control', 'no-store');
    return respuesta.status(error.status || 500).json({
      error: error.status ? error.message : 'No se pudo leer el CI. Intenta nuevamente.',
      ...(error.status === 422 && error.ocrPreview ? { ocrPreview: error.ocrPreview } : {}),
      ...(error.status === 422 && error.processedImages ? { processedImages: error.processedImages } : {}),
      ...(error.status === 422 && error.ciFormat ? { ciFormat: error.ciFormat } : {}),
      ...(error.status === 422 && error.mrzComparison ? { mrzComparison: error.mrzComparison } : {}),
      ...(['UNDERAGE','CONSENT_VERSION_MISMATCH'].includes(error.code) ? { code: error.code } : {})
    });
  }
};

const verificarIdentidad = async (solicitud, respuesta) => {
  try {
    const { livenessSessionId: livenessSesionId, livenessTicket: livenessComprobante, ocrTicket: ocrComprobante } = solicitud.body || {};
    const frontalImagen = solicitud.files?.ciFront?.[0]?.buffer;
    const reversoImagen = solicitud.files?.ciBack?.[0]?.buffer;
    const autorretratoImagen = solicitud.files?.selfie?.[0]?.buffer;
    const livenessHabilitado = process.env.FACE_LIVENESS_ENABLED === 'true';
    const consentimientoAceptado = validarConsentimientoIdentidad(solicitud.body);
    if (!frontalImagen || !reversoImagen) return respuesta.status(400).json({ error: 'Envía el frente y reverso de la cédula para completar el registro.' });
    if (!autorretratoImagen && !livenessHabilitado) return respuesta.status(400).json({ error: 'Envía una selfie para completar el registro.' });
    const origenes = Object.fromEntries(['ciFront','ciBack'].map(lado => [lado,documentosRepo.origenAdjunto(solicitud.body,lado)]));
    let frontal;
    let reverso;
    let campos;
    let ciFormatear;
    let mrzComparacion;
    if (livenessHabilitado) {
      if (typeof ocrComprobante !== 'string' || ocrComprobante.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ocrComprobante)) {
        return respuesta.status(409).json({ error: 'Primero verifica los datos del CI antes de la prueba de vida.' });
      }
      let comprobado;
      try {comprobado = unseal(Buffer.from(ocrComprobante, 'base64'), CI_OCR_COMPROBANTE_VINCULACION(solicitud.user.id));} catch {
        return respuesta.status(409).json({ error: 'La lectura del CI no es válida. Verifica los datos nuevamente.' });
      }
      if (!Number.isFinite(comprobado.expiresAt) || comprobado.expiresAt < Date.now() ||
      comprobado.consentVersion !== consentimientoAceptado.version ||
      JSON.stringify(comprobado.origins) !== JSON.stringify([origenes.ciFront,origenes.ciBack]) ||
      comprobado.frontDigest !== imagenDigest(frontalImagen) || comprobado.backDigest !== imagenDigest(reversoImagen) ||
      JSON.stringify(comprobado.crops) !== JSON.stringify(['ciFront','ciBack'].map(lado => analizarRecorteRectangulo(solicitud.body,lado)))) {
        return respuesta.status(409).json({ error: 'La lectura del CI expiró o las fotos cambiaron. Verifica los datos nuevamente.' });
      }
      frontal = { fields: comprobado.frontFields };
      reverso = { fields: comprobado.backFields };
      campos = comprobado.fields;
      ciFormatear = comprobado.ciFormat || comprobado.backFields?.format;
      mrzComparacion = comprobado.mrzComparison;
    } else {
      ({ front: frontal, back: reverso, fields: campos, ciFormat: ciFormatear, mrzComparison: mrzComparacion } = await leerIdentidadDocumentos(solicitud.body, frontalImagen, reversoImagen));
    }
    // También valida tickets OCR emitidos antes de este control.
    comprobarAdulto(campos.birthDate);
    const [frontalRecortada, reversoRecortada] = await Promise.all([
      prepararDocumentoImagen(frontalImagen, analizarRecorteRectangulo(solicitud.body,'ciFront')),
      prepararDocumentoImagen(reversoImagen, analizarRecorteRectangulo(solicitud.body,'ciBack'))
    ]);
    const prepararRostroImagen = (imagen) => sharp(imagen, { limitInputPixels: 24000000 }).
    rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).
    jpeg({ quality: 80 }).toBuffer();
    let biometricResultado;
    let livenessPasado = true;
    if (livenessHabilitado) {
      verificarLivenessComprobante(livenessComprobante, livenessSesionId, solicitud.user.id);
      const imagenParaComparar = await prepararRostroImagen(frontalRecortada);
      biometricResultado = await invokeLambda({
        action: 'verifySession',
        sessionId: livenessSesionId,
        documentImageBase64: imagenParaComparar.toString('base64')
      });
      if (biometricResultado.status !== 'SUCCEEDED') {
        return respuesta.status(422).json({ error: 'No se completó la prueba de vida. Vuelve a iniciarla antes de confirmar el CI.' });
      }
      const livenessUmbral = Number(process.env.FACE_LIVENESS_MIN_CONFIDENCE);
      if (!Number.isFinite(livenessUmbral) || livenessUmbral < 0 || livenessUmbral > 100) {
        throw Object.assign(new Error('Configura FACE_LIVENESS_MIN_CONFIDENCE para validar la prueba de vida.'), { status: 503 });
      }
      livenessPasado = Number(biometricResultado.livenessConfidence) >= livenessUmbral;
    } else {
      const [imagenParaComparar, autorretratoParaComparar] = await Promise.all([
      prepararRostroImagen(frontalRecortada),
      prepararRostroImagen(autorretratoImagen)]
      );
      biometricResultado = await invokeLambda({
        action: 'compareFaces',
        documentImageBase64: imagenParaComparar.toString('base64'),
        selfieImageBase64: autorretratoParaComparar.toString('base64')
      });
    }
    const rostroCoincidenciaUmbral = Number(process.env.FACE_MATCH_MIN_CONFIDENCE);
    if (!Number.isFinite(rostroCoincidenciaUmbral) || rostroCoincidenciaUmbral < 0 || rostroCoincidenciaUmbral > 100) {
      throw Object.assign(new Error('Configura FACE_MATCH_MIN_CONFIDENCE para validar la comparación facial.'), { status: 503 });
    }
    const rostroCoincidenciaConfianza = Number(biometricResultado.faceMatchConfidence);
    if (!livenessPasado) {
      return respuesta.status(422).json({ error: 'No se pudo confirmar la prueba de vida. Vuelve a intentarlo.' });
    }
    if (!Number.isFinite(rostroCoincidenciaConfianza) || rostroCoincidenciaConfianza < rostroCoincidenciaUmbral) {
      return respuesta.status(422).json({ error: livenessHabilitado ?
        'El rostro no coincide suficientemente con el CI. Repite la prueba en buena iluminación.' :
        'La selfie no coincide suficientemente con el rostro del CI. Toma otra selfie, con buena iluminación y el rostro visible.' });
    }
    const verificadoPerfilFoto = livenessHabilitado ?
    await prepararVerificadoPerfilFoto(biometricResultado.referenceImageBase64) :
    null;
    await sequelize.transaction(async (transaccion) => {
      const user = await Usuario.findByPk(solicitud.user.id, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
      if (!user) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
      const existente = await UsuarioIdentidad.findOne({ where: { ciNumber: campos.ciNumber }, transaction: transaccion });
      if (existente && existente.userId !== user.id) throw Object.assign(new Error('La cédula ya está registrada.'), { status: 409 });
      const identidad = await UsuarioIdentidad.findOne({ where: { userId: user.id }, transaction: transaccion });
      if (identidad?.verificationStatus === 'verificado') throw Object.assign(new Error('La identidad ya está verificada. Los cambios requieren revisión.'), { status: 409 });
      const datosVerificados = { ...campos, verificationStatus: 'verificado', verifiedAt: new Date(), rejectionReason: null };
      // El bloqueo de la fila del usuario serializa los intentos de la misma cuenta.
      if (identidad) await identidad.update(datosVerificados, { transaction: transaccion });
      else await UsuarioIdentidad.create({ ...datosVerificados, userId: user.id }, { transaction: transaccion });
      await documentosRepo.query("UPDATE public.documento SET vigente=false WHERE tipo_documento IN ('ciFront','ciBack') AND id_documento IN (SELECT id_documento FROM public.usuario_documento WHERE id_usuario=:userId)",{userId:user.id},transaccion);
      for (const [lado, imagen, resultado] of [['ciFront', frontalRecortada, frontal], ['ciBack', reversoRecortada, reverso]]) {
        const documentoId = require('crypto').randomUUID();
        const vinculacion = `${documentoId}:${user.id}:${lado}`;
        const cifrado = sellar({ image: imagen.toString('base64') }, vinculacion);
        await documentosRepo.createDocument({id_documento:documentoId,userId:user.id,tipo_documento:lado,
          ruta_archivo:`encrypted-identity:${documentoId}`,tipo_mime:'application/octet-stream',
          origen_evidencia:origenes[lado],
          evidencia_cifrada:cifrado.toString('base64'),consentimiento_version:consentimientoAceptado.version,consentimiento_en:new Date(),
          estado_verificacion:'verificado',verificado_en:new Date()
        },transaccion);
        await documentosRepo.saveReading(documentoId,lado,{text:resultado.rawText},transaccion);
      }
      if (verificadoPerfilFoto) await guardarVerificadoPerfilFoto(user, verificadoPerfilFoto, transaccion);
    });
    const usuario = await Usuario.findByPk(solicitud.user.id);
    respuesta.set('Cache-Control', 'no-store');
    respuesta.json({ message: livenessHabilitado ? 'CI validado, prueba de vida y comparación facial aprobados.' : 'CI validado y rostro comparado con la selfie.', ciFormat: ciFormatear, mrzComparison: mrzComparacion, user: await construirUsuarioRespuestaObjeto(usuario) });
  } catch (error) {
    const postgres = error.original;
    console.error('Error al guardar la identidad:', {
      tipo: error.name,
      codigo: postgres?.code,
      tabla: postgres?.table,
      columna: postgres?.column,
      restriccion: postgres?.constraint
    });
    const duplicado = error.name === 'SequelizeUniqueConstraintError';
    respuesta.set('Cache-Control', 'no-store');
    respuesta.status(error.status || (duplicado ? 409 : 500)).json({
      error: error.status ? error.message : duplicado ? 'La cédula ya está registrada.' : 'No se pudo guardar la identidad. Intenta nuevamente.',
      ...(error.status === 422 && error.ocrPreview ? { ocrPreview: error.ocrPreview } : {}),
      ...(error.status === 422 && error.processedImages ? { processedImages: error.processedImages } : {}),
      ...(error.status === 422 && error.ciFormat ? { ciFormat: error.ciFormat } : {}),
      ...(error.status === 422 && error.mrzComparison ? { mrzComparison: error.mrzComparison } : {}),
      ...(['UNDERAGE','CONSENT_VERSION_MISMATCH'].includes(error.code) ? { code: error.code } : {})
    });
  }
};

const inicioRostroLiveness = async (solicitud, respuesta) => {
  try {
    const secreto = obtenerLivenessComprobanteSecreto();
    const existenteIdentidad = await UsuarioIdentidad.findOne({ where: { userId: solicitud.user.id } });
    if (existenteIdentidad?.verificationStatus === 'verificado') {
      return respuesta.status(409).json({ error: 'La identidad ya está verificada.' });
    }
    const resultado = await invokeLambda({ action: 'createSession' });
    if (!resultado.sessionId || !resultado.region || !resultado.credentials?.accessKeyId || !resultado.credentials?.secretAccessKey || !resultado.credentials?.sessionToken || !resultado.credentials?.expiration) {
      throw Object.assign(new Error('La sesión biométrica no devolvió los datos temporales necesarios.'), { status: 502 });
    }
    const credencialVencimiento = new Date(resultado.credentials.expiration);
    if (!Number.isFinite(credencialVencimiento.getTime()) || credencialVencimiento.getTime() < Date.now() + 60_000) {
      throw Object.assign(new Error('Las credenciales temporales de la sesión ya expiraron.'), { status: 502 });
    }
    const comprobante = jwt.sign(
      { purpose: 'identity-face-liveness', sessionId: resultado.sessionId },
      secreto,
      { subject: String(solicitud.user.id), expiresIn: '5m' }
    );
    respuesta.set('Cache-Control', 'no-store');
    return respuesta.json({ sessionId: resultado.sessionId, region: resultado.region, credentials: resultado.credentials, ticket: comprobante });
  } catch (error) {
    console.error('Could not create face liveness session:', error.name || 'Error');
    return respuesta.status(error.status || 502).json({ error: error.status ? error.message : 'No se pudo iniciar la prueba de vida. Intenta nuevamente.' });
  }
};

const completarRostroLiveness = async (solicitud, respuesta) => {
  try {
    const { sessionId: sesionId, ticket: comprobante } = solicitud.body || {};
    if (typeof sesionId !== 'string' || sesionId.length > 128) return respuesta.status(400).json({ error: 'La sesión biométrica no es válida.' });
    verificarLivenessComprobante(comprobante, sesionId, solicitud.user.id);
    const identidad = await UsuarioIdentidad.findOne({ where: { userId: solicitud.user.id } });
    if (!identidad || identidad.verificationStatus !== 'pendiente') return respuesta.status(409).json({ error: 'No hay una identidad pendiente de verificación.' });

    const [frontalDocumento] = await sequelize.query(
      `SELECT id, evidencia_cifrada FROM documento
       WHERE user_id = :userId AND document_type = 'ciFront' AND driver_request_id IS NULL AND is_current = true
       ORDER BY created_at DESC LIMIT 1`,
      { replacements: { userId: solicitud.user.id }, type: sequelize.QueryTypes.SELECT }
    );
    if (!frontalDocumento) return respuesta.status(409).json({ error: 'No encontramos el frente vigente de tu CI.' });
    const metadatos = frontalDocumento ? { encryptedEvidence: frontalDocumento.evidencia_cifrada } : null;
    if (!metadatos?.encryptedEvidence) throw new Error('Identity evidence is unavailable');
    const vinculacion = `${frontalDocumento.id}:${solicitud.user.id}:ciFront`;
    const evidencia = unseal(Buffer.from(metadatos.encryptedEvidence, 'base64'), vinculacion);
    if (typeof evidencia.image !== 'string') throw new Error('Identity image is unavailable');
    const imagenParaComparar = await sharp(Buffer.from(evidencia.image, 'base64'), { limitInputPixels: 24000000 }).
    rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).
    jpeg({ quality: 82 }).toBuffer();

    const resultado = await invokeLambda({ action: 'verifySession', sessionId: sesionId, documentImageBase64: imagenParaComparar.toString('base64') });
    const esCompletar = resultado.status === 'SUCCEEDED';
    if (!esCompletar) {
      return respuesta.status(422).json({ error: resultado.feedback || 'La prueba no se completó. Iníciala nuevamente.', status: resultado.status || 'FAILED' });
    }

    const livenessUmbral = Number(process.env.FACE_LIVENESS_MIN_CONFIDENCE);
    const rostroCoincidenciaUmbral = Number(process.env.FACE_MATCH_MIN_CONFIDENCE);
    if (![livenessUmbral, rostroCoincidenciaUmbral].every((valor) => Number.isFinite(valor) && valor >= 0 && valor <= 100)) {
      throw Object.assign(new Error('La verificación biométrica requiere configurar umbrales evaluados.'), { status: 503 });
    }
    const livenessPasado = Number(resultado.livenessConfidence) >= livenessUmbral;
    const rostroCoincidenciaPasado = Number(resultado.faceMatchConfidence) >= rostroCoincidenciaUmbral;
    const pasado = livenessPasado && rostroCoincidenciaPasado;
    const rechazoMotivo = !livenessPasado ?
    'No se pudo confirmar la prueba de vida. Vuelve a intentarlo.' :
    !rostroCoincidenciaPasado ?
    'La comparación de tu rostro con la foto del CI no fue suficiente. Revisa la captura y vuelve a enviarla.' :
    null;

    const verificadoPerfilFoto = pasado ?
    await prepararVerificadoPerfilFoto(resultado.referenceImageBase64) :
    null;
    await sequelize.transaction(async (transaccion) => {
      await identidad.update({
        verificationStatus: pasado ? 'verificado' : 'rechazado',
        verifiedAt: pasado ? new Date() : null,
        rejectionReason: rechazoMotivo
      }, { transaction: transaccion });
      await documentosRepo.query(
        `UPDATE public.documento SET estado_verificacion=:status,verificado_en=:verifiedAt,motivo_rechazo=:reason,actualizado_en=NOW()
         WHERE tipo_documento IN ('ciFront','ciBack') AND vigente AND id_documento IN (SELECT id_documento FROM public.usuario_documento WHERE id_usuario=:userId)`,
        {status:pasado?'verificado':'rechazado',verifiedAt:pasado?new Date():null,reason:rechazoMotivo,userId:solicitud.user.id},transaccion);
      if (verificadoPerfilFoto) {
        const user = await Usuario.findByPk(solicitud.user.id, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
        if (!user) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
        await guardarVerificadoPerfilFoto(user, verificadoPerfilFoto, transaccion);
      }
    });

    const usuario = await Usuario.findByPk(solicitud.user.id);
    return respuesta.json({
      verified: pasado,
      livenessConfidence: Number(resultado.livenessConfidence),
      faceMatchConfidence: Number(resultado.faceMatchConfidence),
      message: pasado ? 'Prueba de vida y comparación facial completadas.' : rechazoMotivo,
      user: await construirUsuarioRespuestaObjeto(usuario)
    });
  } catch (error) {
    console.error('Could not complete face liveness:', error.name || 'Error');
    return respuesta.status(error.status || 502).json({ error: error.status ? error.message : 'No se pudo completar la verificación facial.' });
  }
};

module.exports = {
  registrarse: registrarse,
  ingresar: ingresar,
  obtenerUsuarioActual: obtenerRealUsuario,
  renovarToken: renovarToken,
  googleAutenticacion: googleAutenticacion,
  comprobarUsuarioFirebase: comprobarFirebaseUsuario,
  verificarTelefonoOTP: verificarTelefonoOtp,
  obtenerConsentimiento,
  precheckIdentidadOcr: precheckIdentidadOcr,
  verificarIdentidad: verificarIdentidad,
  iniciarRostroVitalidad: inicioRostroLiveness,
  completarRostroVitalidad: completarRostroLiveness,
  construirUsuarioRespuestaObjeto: construirUsuarioRespuestaObjeto
};
