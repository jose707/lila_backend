// backend/src/controllers/authController.js
const User = require('../models/User');
const Driver = require('../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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
  const responseUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    isVerified: user.isVerified,
    role: user.role,
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
      if (user.firebaseUid && !user.isVerified) {
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
      name,
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
    if (user.firebaseUid && !user.isVerified) {
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
        name,
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
        name: name || 'Usuario', // Use the name from frontend
        email: email, // Use the actual Google email
        phone,
        firebaseUid,
        profilePhoto: photoURL || null, // Save the photo URL from Google
        password: firebaseUid, // Use Firebase UID as temporary password
        role: 'passenger', // New users start as passenger; driver role is via Driver table
        isVerified: true,
      });

      console.log('✅ New user created from Firebase:', {
        id: user.id,
        name: user.name,
        email: user.email,
        photoURL: photoURL ? 'YES' : 'NO',
        firebaseUid: user.firebaseUid,
      });
    } else {
      // Update user with latest data from frontend
      await user.update({
        name: name || user.name,
        email: email || user.email,
        phone,
        profilePhoto: photoURL || user.profilePhoto,
        isVerified: true,
      });

      console.log('✅ User updated:', {
        id: user.id,
        name: user.name,
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

module.exports = {
  signup,
  login,
  getCurrentUser,
  refreshToken,
  googleAuth,
  checkFirebaseUser,
  verifyPhoneOTP,
  buildUserResponseObject,
};
