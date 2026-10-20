// backend/src/controllers/authController.js
const User = require('../models/User');
const UserIdentity = require('../models/UserIdentity');
const sequelize = require('../config/database');
const Driver = require('../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const ocrService = require('../services/ocrService');
const { cropForOcr, parseCropRect } = require('../services/documentCrop');
const { validateIdentity } = require('../services/identityValidation');
const { seal, unseal } = require('../services/identitySessionCrypto');
const { invokeLambda } = require('../services/faceLivenessLambda');

// El OCR devuelve fechas como DD/MM/AAAA; PostgreSQL DATE usa AAAA-MM-DD.
const toIsoDate = value => {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : (value || null);
};

const generateToken = user => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET || 'secret',
    {
      expiresIn: process.env.JWT_EXPIRE || '30d',
    },
  );
};

// Helper function to build response user object with driver rating
const buildUserResponseObject = async user => {
  const identity = await UserIdentity.findOne({ where: { userId: user.id } });
  const officialName = identity
    ? [identity.firstNames, identity.paternalSurname, identity.maternalSurname]
        .filter(Boolean).join(' ')
    : '';
  const responseUser = {
    id: user.id,
    // Compatibilidad de API: se expone el nombre oficial, no se duplica en users.
    name: officialName,
    email: user.email,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    identityVerificationStatus: identity?.verificationStatus || 'pending',
    identityDocumentsSubmitted: !!identity,
    identityRejectionReason: identity?.verificationStatus === 'rejected' ? identity.rejectionReason : null,
    role: user.role,
    profilePhoto: user.profilePhoto,
    photoURL: user.profilePhoto,
    rating: user.rating,
    totalRides: user.totalTrips || 0,
    currentMode: user.currentMode || 'passenger',
  };

  // Fetch driver data if user has a driver profile
  try {
    const driver = await Driver.findOne({
      where: { userId: user.id },
    });
    if (driver) {
      responseUser.driverRating = driver.rating;
      responseUser.totalTripsAsDriver = driver.totalRides || 0;
      console.log('✅ [buildUserResponseObject] Driver encontrado:', {
        userId: user.id,
        driverRating: driver.rating,
        totalRidesAsDriver: driver.totalRides,
      });
    } else {
      console.log(
        '⚠️ [buildUserResponseObject] No driver profile found for userId:',
        user.id,
      );
      // Si no existe registro de conductor pero el modo guardado es 'driver',
      // lo reseteamos a 'passenger' para evitar acceso indebido al panel de conductor.
      if (responseUser.currentMode === 'driver') {
        console.log(
          '🔄 [buildUserResponseObject] Reseteando currentMode a passenger (sin registro de conductor)',
        );
        responseUser.currentMode = 'passenger';
        // Persistir en la BD para que futuros logins ya estén limpios
        try {
          await user.update({ currentMode: 'passenger' });
        } catch (updateErr) {
          console.error(
            '⚠️ [buildUserResponseObject] No se pudo actualizar currentMode en BD:',
            updateErr,
          );
        }
      }
    }
  } catch (error) {
    console.error('Error fetching driver data:', error);
  }

  console.log('📤 [buildUserResponseObject] Retornando user object:', {
    id: responseUser.id,
    name: responseUser.name,
    rating: responseUser.rating,
    driverRating: responseUser.driverRating,
    currentMode: responseUser.currentMode,
  });

  return responseUser;
};

// Check if user exists by Firebase UID
const checkFirebaseUser = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        error: 'Firebase UID is required',
      });
    }

    const user = await User.findOne({
      where: { firebaseUid },
    });

    if (user) {
      // Si el usuario fue creado con Firebase/Google pero no completó la verificación de teléfono,
      // no debemos permitir inicio de sesión.
      if (user.firebaseUid && !user.phoneVerified) {
        return res.status(200).json({
          exists: true,
          needsPhoneVerification: true,
          message: 'Phone verification required',
        });
      }

      // User exists, return user data and generate token
      const token = generateToken(user);
      const responseUser = await buildUserResponseObject(user);

      return res.status(200).json({
        exists: true,
        message: 'User found',
        token,
        user: responseUser,
      });
    } else {
      // User doesn't exist, needs to complete registration
      return res.status(200).json({
        exists: false,
        message: 'User not found, needs registration',
      });
    }
  } catch (error) {
    console.error('Error checking Firebase user:', error);
    res.status(500).json({ error: 'Error checking user: ' + error.message });
  }
};

const signup = async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword } = req.body;

    // Validaciones
    if (!name || !email || !phone || !password || !confirmPassword) {
      return res.status(400).json({
        error: 'Todos los campos son requeridos',
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        error: 'Las contraseñas no coinciden',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 6 caracteres',
      });
    }

    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({
        error: 'El email ya está registrado',
      });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crear usuario: por defecto todos son pasajeros al inicio
    const user = await User.create({
      email,
      phone,
      password: hashedPassword,
      role: 'passenger',
    });

    // Generar token
    const token = generateToken(user);

    const responseUser = await buildUserResponseObject(user);

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      token,
      user: responseUser,
    });
  } catch (error) {
    console.error('Error en signup:', error);
    res.status(500).json({
      error: 'Error al registrar el usuario',
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validaciones
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email y contraseña son requeridos',
      });
    }

    // Buscar usuario
    const user = await User.findOne({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Email o contraseña incorrectos',
      });
    }

    // Verificar si el usuario está activo
    if (!user.isActive) {
      return res.status(403).json({
        error:
          'Tu cuenta ha sido deshabilitada. Contacta al administrador para más información.',
      });
    }

    // Si este usuario está asociado a Firebase/Google, exigir verificación (teléfono/OTP)
    if (user.firebaseUid && !user.phoneVerified) {
      return res.status(403).json({
        error:
          'Debes verificar tu número de celular antes de iniciar sesión.',
      });
    }

    // Comparar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Email o contraseña incorrectos',
      });
    }

    // Actualizar último login
    await user.update({
      lastLogin: new Date(),
    });

    // Generar token
    const token = generateToken(user);

    const responseUser = await buildUserResponseObject(user);

    res.status(200).json({
      message: 'Login exitoso',
      token,
      user: responseUser,
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      error: 'Error al iniciar sesión',
    });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    // Usar buildUserResponseObject para validar que el registro de conductor existe
    // y resetear currentMode si fue eliminado de la BD
    const responseUser = await buildUserResponseObject(user);

    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      user: responseUser,
    });
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({
      error: 'Error al obtener el usuario',
    });
  }
};

const refreshToken = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    const token = generateToken(user);

    res.status(200).json({
      token,
    });
  } catch (error) {
    console.error('Error al refrescar token:', error);
    res.status(500).json({
      error: 'Error al refrescar el token',
    });
  }
};

const googleAuth = async (req, res) => {
  try {
    const { idToken, email, name, photo } = req.body;

    // Log para debugging
    console.log('Google Auth Request:', {
      idToken: idToken ? 'present' : 'missing',
      email,
      name,
      photo,
    });

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    let user = await User.findOne({ where: { email } });

    if (!user) {
      user = await User.create({
        email,
        phone: '', // Valor por defecto para Google Auth
        profilePhoto: photo,
        password: 'google_auth', // Valor por defecto para Google Auth
        role: 'user',
        isActive: true,
      });
      console.log('New user created from Google:', user.id, email);
    } else {
      console.log('Existing user found:', user.id, email);
      if (!user.isActive) {
        return res.status(403).json({
          error:
            'Tu cuenta ha sido deshabilitada. Contacta al administrador para más información.',
        });
      }
    }

    const token = generateToken(user);

    const responseUser = await buildUserResponseObject(user);

    res.json({
      message: 'Google login successful',
      token,
      user: responseUser,
    });
  } catch (error) {
    console.error('Error in googleAuth:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Verify phone number with Firebase OTP
 * POST /auth/verify-phone
 */
const verifyPhoneOTP = async (req, res) => {
  try {
    const { firebaseUid, phone, email, name, photoURL, checkOnly } = req.body;

    // Modo "solo consulta": NO escribir en BD, solo verificar duplicados
    if (checkOnly) {
      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
      }

      const existingByPhone = await User.findOne({ where: { phone } });

      // Si el teléfono ya está registrado por otra cuenta, bloquear
      if (
        existingByPhone &&
        (!firebaseUid || existingByPhone.firebaseUid !== firebaseUid)
      ) {
        return res.status(409).json({
          error: 'Este número de teléfono ya está registrado',
        });
      }

      return res.status(200).json({
        ok: true,
        exists: false,
      });
    }

    if (!firebaseUid || !phone || !email) {
      return res.status(400).json({
        error: 'Firebase UID, phone number, and email are required',
      });
    }

    // Find or create user with Firebase UID
    let user = await User.findOne({
      where: { firebaseUid },
    });

    if (!user) {
      // Create new user from Firebase with the data sent from frontend
      user = await User.create({
      email: email, // Use the actual Google email
        phone,
        firebaseUid,
        profilePhoto: photoURL || null, // Save the photo URL from Google
        password: firebaseUid, // Use Firebase UID as temporary password
        role: 'passenger', // New users start as passenger; driver role is via Driver table
        phoneVerified: true,
      });

      console.log('✅ New user created from Firebase:', {
        id: user.id,
        name: (await buildUserResponseObject(user)).name,
        email: user.email,
        photoURL: photoURL ? 'YES' : 'NO',
        firebaseUid: user.firebaseUid,
      });
    } else {
      // Update user with latest data from frontend
      await user.update({
        email: email || user.email,
        phone,
        profilePhoto: user.profilePhoto === `/api/users/${user.id}/profile-photo`
          ? user.profilePhoto : (photoURL || user.profilePhoto),
        phoneVerified: true,
      });

      console.log('✅ User updated:', {
        id: user.id,
        name: (await buildUserResponseObject(user)).name,
        email: user.email,
        photoURL: photoURL ? 'YES' : 'NO',
      });
    }

    const token = generateToken(user);

    const responseUser = await buildUserResponseObject(user);

    res.status(200).json({
      message: 'Phone verified successfully',
      token,
      user: responseUser,
    });
  } catch (error) {
    console.error('Error verifying phone:', error);
    res.status(500).json({ error: 'Error verifying phone: ' + error.message });
  }
};

const getLivenessTicketSecret = () => {
  const secret = process.env.FACE_LIVENESS_TICKET_SECRET;
  if (!secret || secret === 'secret' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw Object.assign(new Error('Configura FACE_LIVENESS_TICKET_SECRET con al menos 32 caracteres aleatorios y reinicia el backend.'), { status: 503 });
  }
  return secret;
};

const verifyLivenessTicket = (ticket, sessionId, userId) => {
  if (typeof ticket !== 'string' || ticket.length > 2048 || typeof sessionId !== 'string' || sessionId.length > 128) {
    throw Object.assign(new Error('La sesión de prueba de vida no es válida. Iníciala nuevamente.'), { status: 403 });
  }
  let claims;
  const secret = getLivenessTicketSecret();
  try { claims = jwt.verify(ticket, secret); } catch {
    throw Object.assign(new Error('La autorización de prueba de vida expiró. Iníciala nuevamente.'), { status: 403 });
  }
  if (claims.purpose !== 'identity-face-liveness' || claims.sub !== String(userId) || claims.sessionId !== sessionId) {
    throw Object.assign(new Error('La prueba de vida no pertenece a este registro.'), { status: 403 });
  }
  return claims;
};

const prepareVerifiedProfilePhoto = async referenceImageBase64 => {
  if (typeof referenceImageBase64 !== 'string' || referenceImageBase64.length > 6 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(referenceImageBase64)) {
    throw Object.assign(new Error('La prueba de vida no devolvió una foto de perfil válida. Repítela.'), { status: 502 });
  }
  try {
    const image = Buffer.from(referenceImageBase64, 'base64');
    if (image.length < 64 || image.length > 4 * 1024 * 1024) throw new Error('Invalid image size');
    return await sharp(image, { limitInputPixels: 24000000 })
      .rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();
  } catch {
    throw Object.assign(new Error('No se pudo procesar la foto de la prueba de vida. Repítela.'), { status: 502 });
  }
};

const saveVerifiedProfilePhoto = async (user, image, transaction) => {
  const documentId = require('crypto').randomUUID();
  const encrypted = seal({ image: image.toString('base64') }, `${documentId}:${user.id}:profilePhoto`);
  await sequelize.query(
    "UPDATE documents SET is_current = false WHERE user_id = :userId AND document_type = 'profilePhoto' AND driver_request_id IS NULL",
    { replacements: { userId: user.id }, transaction },
  );
  await sequelize.query(
    `INSERT INTO documents (id, user_id, document_type, file_path, mime_type, file_size, ocr_data, verification_status, verified_at)
     VALUES (:id, :userId, 'profilePhoto', :path, 'application/octet-stream', :size, CAST(:metadata AS JSONB), 'verified', NOW())`,
    { replacements: {
      id: documentId, userId: user.id, path: `encrypted-identity:${documentId}`,
      size: encrypted.length,
      metadata: JSON.stringify({ encryptedEvidence: encrypted.toString('base64'), source: 'face-liveness-reference-v1' }),
    }, transaction },
  );
  await user.update({ profilePhoto: `/api/users/${user.id}/profile-photo` }, { transaction });
};

/** Process both CI images together; OCR data is never accepted from the app. */
const verifyIdentity = async (req, res) => {
  try {
    const { consent, livenessSessionId, livenessTicket } = req.body || {};
    const frontImage = req.files?.ciFront?.[0]?.buffer;
    const backImage = req.files?.ciBack?.[0]?.buffer;
    const selfieImage = req.files?.selfie?.[0]?.buffer;
    const livenessEnabled = process.env.FACE_LIVENESS_ENABLED === 'true';
    if (consent !== 'true' && consent !== true) return res.status(400).json({ error: 'Debes autorizar el tratamiento de los documentos para verificar tu identidad.' });
    if (!frontImage || !backImage) return res.status(400).json({ error: 'Envía el frente y reverso de la cédula para completar el registro.' });
    if (!selfieImage && !livenessEnabled) return res.status(400).json({ error: 'Envía una selfie para completar el registro.' });
    const extract = async (image, side) => {
      let normalized = await sharp(image, { limitInputPixels: 24000000 }).rotate().toBuffer();
      const cropRect = parseCropRect(req.body, side);
      if (cropRect) normalized = await cropForOcr(normalized, cropRect, 0.05);
      normalized = await sharp(normalized).grayscale().normalize().png().toBuffer();
      const result = await ocrService.extractDocument(normalized, side);
      if (result.rejected) throw Object.assign(new Error(result.rejectReason || `No se reconoce el lado ${side} de la cédula.`), { status: 422 });
      return result;
    };
    let front;
    let back;
    try {
      [front, back] = await Promise.all([extract(frontImage, 'ciFront'), extract(backImage, 'ciBack')]);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
    // La MRZ solo está en el reverso y determina qué lector usar para ambos
    // lados. Una lectura incompleta de la MRZ no valida como formato actual.
    const ciFormat = back.classify.hasMRZ ? 'current' : 'legacy';
    front.fields = ocrService.parseCI(front.rawText, {
      documentType: 'ciFront', words: front.words, format: ciFormat,
    });
    back.fields = ocrService.parseCI(back.rawText, {
      documentType: 'ciBack', words: back.words, format: ciFormat,
    });
    const fields = validateIdentity(front, back);
    const prepareFaceImage = image => sharp(image, { limitInputPixels: 24000000 })
      .rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer();
    let biometricResult;
    let livenessPassed = true;
    if (livenessEnabled) {
      verifyLivenessTicket(livenessTicket, livenessSessionId, req.user.id);
      const compareImage = await prepareFaceImage(frontImage);
      biometricResult = await invokeLambda({
        action: 'verifySession',
        sessionId: livenessSessionId,
        documentImageBase64: compareImage.toString('base64'),
      });
      if (biometricResult.status !== 'SUCCEEDED') {
        return res.status(422).json({ error: 'No se completó la prueba de vida. Vuelve a iniciarla antes de confirmar el CI.' });
      }
      const livenessThreshold = Number(process.env.FACE_LIVENESS_MIN_CONFIDENCE);
      if (!Number.isFinite(livenessThreshold) || livenessThreshold < 0 || livenessThreshold > 100) {
        throw Object.assign(new Error('Configura FACE_LIVENESS_MIN_CONFIDENCE para validar la prueba de vida.'), { status: 503 });
      }
      livenessPassed = Number(biometricResult.livenessConfidence) >= livenessThreshold;
    } else {
      const [compareImage, compareSelfie] = await Promise.all([
        prepareFaceImage(frontImage),
        prepareFaceImage(selfieImage),
      ]);
      biometricResult = await invokeLambda({
        action: 'compareFaces',
        documentImageBase64: compareImage.toString('base64'),
        selfieImageBase64: compareSelfie.toString('base64'),
      });
    }
    const faceMatchThreshold = Number(process.env.FACE_MATCH_MIN_CONFIDENCE);
    if (!Number.isFinite(faceMatchThreshold) || faceMatchThreshold < 0 || faceMatchThreshold > 100) {
      throw Object.assign(new Error('Configura FACE_MATCH_MIN_CONFIDENCE para validar la comparación facial.'), { status: 503 });
    }
    const faceMatchConfidence = Number(biometricResult.faceMatchConfidence);
    if (!livenessPassed) {
      return res.status(422).json({ error: 'No se pudo confirmar la prueba de vida. Vuelve a intentarlo.' });
    }
    if (!Number.isFinite(faceMatchConfidence) || faceMatchConfidence < faceMatchThreshold) {
      return res.status(422).json({ error: livenessEnabled
        ? 'El rostro no coincide suficientemente con el CI. Repite la prueba en buena iluminación.'
        : 'La selfie no coincide suficientemente con el rostro del CI. Toma otra selfie, con buena iluminación y el rostro visible.' });
    }
    const verifiedProfilePhoto = livenessEnabled
      ? await prepareVerifiedProfilePhoto(biometricResult.referenceImageBase64)
      : null;
    await sequelize.transaction(async transaction => {
      const user = await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
      const existing = await UserIdentity.findOne({ where: { ciNumber: fields.ciNumber }, transaction });
      if (existing && existing.userId !== user.id) throw Object.assign(new Error('La cédula ya está registrada.'), { status: 409 });
      const [identity] = await UserIdentity.findOrCreate({ where: { userId: user.id }, defaults: fields, transaction });
      if (identity.verificationStatus === 'verified') throw Object.assign(new Error('La identidad ya está verificada. Los cambios requieren revisión.'), { status: 409 });
      await identity.update({ ...fields, verificationStatus: 'verified', verifiedAt: new Date(), rejectionReason: null }, { transaction });
      await sequelize.query("UPDATE documents SET is_current = false WHERE user_id = :userId AND document_type IN ('ciFront', 'ciBack') AND driver_request_id IS NULL", { replacements: { userId: user.id }, transaction });
      for (const [side, image, result] of [['ciFront', frontImage, front], ['ciBack', backImage, back]]) {
        const documentId = require('crypto').randomUUID();
        const binding = `${documentId}:${user.id}:${side}`;
        const encrypted = seal({ image: image.toString('base64') }, binding);
        await sequelize.query(
          `INSERT INTO documents (id, user_id, document_type, file_path, mime_type, file_size, ocr_data, issued_at, expires_at, verification_status, verified_at)
           VALUES (:id, :userId, :side, :path, 'application/octet-stream', :size, CAST(:metadata AS JSONB), :issueDate, :expiryDate, 'verified', NOW())`,
          { transaction, replacements: {
            id: documentId, userId: user.id, side, path: `encrypted-identity:${documentId}`,
            size: encrypted.length,
            metadata: JSON.stringify({ encryptedEvidence: encrypted.toString('base64'), ocr: result.fields, consentVersion: 'identity-documents-v1', consentAt: new Date().toISOString() }),
            issueDate: fields.issueDate, expiryDate: fields.expiryDate,
          } },
        );
      }
      if (verifiedProfilePhoto) await saveVerifiedProfilePhoto(user, verifiedProfilePhoto, transaction);
    });
    const user = await User.findByPk(req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({ message: livenessEnabled ? 'CI validado, prueba de vida y comparación facial aprobados.' : 'CI validado y rostro comparado con la selfie.', user: await buildUserResponseObject(user) });
  } catch (error) {
    console.error('Error verifying identity:', error.name);
    const duplicate = error.name === 'SequelizeUniqueConstraintError';
    res.status(error.status || (duplicate ? 409 : 500)).json({ error: error.status ? error.message : duplicate ? 'La cédula ya está registrada.' : 'No se pudo guardar la identidad. Intenta nuevamente.' });
  }
};

const startFaceLiveness = async (req, res) => {
  try {
    const secret = getLivenessTicketSecret();
    const existingIdentity = await UserIdentity.findOne({ where: { userId: req.user.id } });
    if (existingIdentity?.verificationStatus === 'verified') {
      return res.status(409).json({ error: 'La identidad ya está verificada.' });
    }
    const result = await invokeLambda({ action: 'createSession' });
    if (!result.sessionId || !result.region || !result.credentials?.accessKeyId || !result.credentials?.secretAccessKey || !result.credentials?.sessionToken || !result.credentials?.expiration) {
      throw Object.assign(new Error('La sesión biométrica no devolvió los datos temporales necesarios.'), { status: 502 });
    }
    const credentialExpiry = new Date(result.credentials.expiration);
    if (!Number.isFinite(credentialExpiry.getTime()) || credentialExpiry.getTime() < Date.now() + 60_000) {
      throw Object.assign(new Error('Las credenciales temporales de la sesión ya expiraron.'), { status: 502 });
    }
    const ticket = jwt.sign(
      { purpose: 'identity-face-liveness', sessionId: result.sessionId },
      secret,
      { subject: String(req.user.id), expiresIn: '5m' },
    );
    res.set('Cache-Control', 'no-store');
    return res.json({ sessionId: result.sessionId, region: result.region, credentials: result.credentials, ticket });
  } catch (error) {
    console.error('Could not create face liveness session:', error.name || 'Error');
    return res.status(error.status || 502).json({ error: error.status ? error.message : 'No se pudo iniciar la prueba de vida. Intenta nuevamente.' });
  }
};

const completeFaceLiveness = async (req, res) => {
  try {
    const { sessionId, ticket } = req.body || {};
    if (typeof sessionId !== 'string' || sessionId.length > 128) return res.status(400).json({ error: 'La sesión biométrica no es válida.' });
    verifyLivenessTicket(ticket, sessionId, req.user.id);
    const identity = await UserIdentity.findOne({ where: { userId: req.user.id } });
    if (!identity || identity.verificationStatus !== 'pending') return res.status(409).json({ error: 'No hay una identidad pendiente de verificación.' });

    const [frontDocument] = await sequelize.query(
      `SELECT id, ocr_data FROM documents
       WHERE user_id = :userId AND document_type = 'ciFront' AND driver_request_id IS NULL AND is_current = true
       ORDER BY created_at DESC LIMIT 1`,
      { replacements: { userId: req.user.id }, type: sequelize.QueryTypes.SELECT },
    );
    if (!frontDocument) return res.status(409).json({ error: 'No encontramos el frente vigente de tu CI.' });
    const metadata = typeof frontDocument.ocr_data === 'string' ? JSON.parse(frontDocument.ocr_data) : frontDocument.ocr_data;
    if (!metadata?.encryptedEvidence) throw new Error('Identity evidence is unavailable');
    const binding = `${frontDocument.id}:${req.user.id}:ciFront`;
    const evidence = unseal(Buffer.from(metadata.encryptedEvidence, 'base64'), binding);
    if (typeof evidence.image !== 'string') throw new Error('Identity image is unavailable');
    const compareImage = await sharp(Buffer.from(evidence.image, 'base64'), { limitInputPixels: 24000000 })
      .rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer();

    const result = await invokeLambda({ action: 'verifySession', sessionId, documentImageBase64: compareImage.toString('base64') });
    const isComplete = result.status === 'SUCCEEDED';
    if (!isComplete) {
      return res.status(422).json({ error: result.feedback || 'La prueba no se completó. Iníciala nuevamente.', status: result.status || 'FAILED' });
    }

    const livenessThreshold = Number(process.env.FACE_LIVENESS_MIN_CONFIDENCE);
    const faceMatchThreshold = Number(process.env.FACE_MATCH_MIN_CONFIDENCE);
    if (![livenessThreshold, faceMatchThreshold].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
      throw Object.assign(new Error('La verificación biométrica requiere configurar umbrales evaluados.'), { status: 503 });
    }
    const livenessPassed = Number(result.livenessConfidence) >= livenessThreshold;
    const faceMatchPassed = Number(result.faceMatchConfidence) >= faceMatchThreshold;
    const passed = livenessPassed && faceMatchPassed;
    const rejectionReason = !livenessPassed
      ? 'No se pudo confirmar la prueba de vida. Vuelve a intentarlo.'
      : !faceMatchPassed
        ? 'La comparación de tu rostro con la foto del CI no fue suficiente. Revisa la captura y vuelve a enviarla.'
        : null;

    const verifiedProfilePhoto = passed
      ? await prepareVerifiedProfilePhoto(result.referenceImageBase64)
      : null;
    await sequelize.transaction(async transaction => {
      await identity.update({
        verificationStatus: passed ? 'verified' : 'rejected',
        verifiedAt: passed ? new Date() : null,
        rejectionReason,
      }, { transaction });
      await sequelize.query(
        `UPDATE documents SET verification_status = :status, verified_at = :verifiedAt, rejection_reason = :reason, updated_at = NOW()
         WHERE user_id = :userId AND document_type IN ('ciFront', 'ciBack') AND driver_request_id IS NULL AND is_current = true`,
        { transaction, replacements: { status: passed ? 'verified' : 'rejected', verifiedAt: passed ? new Date() : null, reason: rejectionReason, userId: req.user.id } },
      );
      if (verifiedProfilePhoto) {
        const user = await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!user) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
        await saveVerifiedProfilePhoto(user, verifiedProfilePhoto, transaction);
      }
    });

    const user = await User.findByPk(req.user.id);
    return res.json({
      verified: passed,
      livenessConfidence: Number(result.livenessConfidence),
      faceMatchConfidence: Number(result.faceMatchConfidence),
      message: passed ? 'Prueba de vida y comparación facial completadas.' : rejectionReason,
      user: await buildUserResponseObject(user),
    });
  } catch (error) {
    console.error('Could not complete face liveness:', error.name || 'Error');
    return res.status(error.status || 502).json({ error: error.status ? error.message : 'No se pudo completar la verificación facial.' });
  }
};

module.exports = {
  signup,
  login,
  getCurrentUser,
  refreshToken,
  googleAuth,
  checkFirebaseUser,
  verifyPhoneOTP,
  verifyIdentity,
  startFaceLiveness,
  completeFaceLiveness,
  buildUserResponseObject,
};
