// backend/src/controllers/userController.js
const User = require('../models/User');
const UserIdentity = require('../models/UserIdentity');
const sequelize = require('../config/database');
const { unseal } = require('../services/identitySessionCrypto');

const officialName = identity => [identity?.firstNames, identity?.paternalSurname, identity?.maternalSurname]
  .filter(Boolean).join(' ');

const getUserProfile = async (req, res) => {
  try {
    const userId = req.params.id || req.user.id;

    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password'] },
      include: [{ model: UserIdentity, as: 'identity' }],
    });

    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    res.status(200).json({
      user: { ...user.toJSON(), name: officialName(user.identity) },
    });
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({
      error: 'Error al obtener el perfil',
    });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone, email } = req.body;

    if (name) {
      return res.status(400).json({ error: 'El nombre se obtiene de la cédula verificada y no se puede editar aquí.' });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(400).json({
          error: 'El email ya está en uso',
        });
      }
    }

    await user.update({
      email: email || user.email,
      phone: phone || user.phone,
    });

    res.status(200).json({
      message: 'Perfil actualizado correctamente',
      user: {
        id: user.id,
        name: officialName(await UserIdentity.findOne({ where: { userId } })),
        email: user.email,
        phone: user.phone,
        role: user.role,
        profilePhoto: user.profilePhoto,
        rating: user.rating,
      },
    });
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    res.status(500).json({
      error: 'Error al actualizar el perfil',
    });
  }
};

const updateProfilePhoto = async (req, res) => {
  try {
    const userId = req.user.id;
    const { photoUrl } = req.body;

    if (!photoUrl) {
      return res.status(400).json({
        error: 'URL de la foto es requerida',
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    if (user.profilePhoto === `/api/users/${user.id}/profile-photo`) {
      return res.status(409).json({ error: 'La foto de perfil verificada proviene de la prueba de vida.' });
    }

    await user.update({ profilePhoto: photoUrl });

    res.status(200).json({
      message: 'Foto de perfil actualizada',
      user: { id: user.id, profilePhoto: user.profilePhoto },
    });
  } catch (error) {
    console.error('Error al actualizar foto:', error);
    res.status(500).json({
      error: 'Error al actualizar la foto de perfil',
    });
  }
};

const getVerifiedProfilePhoto = async (req, res) => {
  try {
    const [document] = await sequelize.query(
      `SELECT id, ocr_data FROM documents
       WHERE user_id = :userId AND document_type = 'profilePhoto' AND driver_request_id IS NULL
         AND is_current = true AND verification_status = 'verified'
       ORDER BY created_at DESC LIMIT 1`,
      { replacements: { userId: req.params.id }, type: sequelize.QueryTypes.SELECT },
    );
    if (!document?.ocr_data?.encryptedEvidence) return res.sendStatus(404);
    const payload = unseal(
      Buffer.from(document.ocr_data.encryptedEvidence, 'base64'),
      `${document.id}:${req.params.id}:profilePhoto`,
    );
    if (typeof payload.image !== 'string') return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store');
    res.type('jpeg').send(Buffer.from(payload.image, 'base64'));
  } catch (error) {
    console.error('Error al servir foto de perfil verificada:', error.name || 'Error');
    res.sendStatus(503);
  }
};

const verifyPhone = async (req, res) => {
  try {
    const userId = req.user.id;
    const { verificationCode } = req.body;

    if (!verificationCode) {
      return res.status(400).json({
        error: 'Código de verificación requerido',
      });
    }

    const user = await User.findByPk(userId);
    await user.update({ phoneVerified: true });

    res.status(200).json({
      message: 'Teléfono verificado correctamente',
    });
  } catch (error) {
    console.error('Error al verificar teléfono:', error);
    res.status(500).json({
      error: 'Error al verificar el teléfono',
    });
  }
};

const updateCurrentMode = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentMode } = req.body;

    // Validar que el modo sea válido
    if (!currentMode || !['passenger', 'driver'].includes(currentMode)) {
      return res.status(400).json({
        error: 'Modo inválido. Debe ser "passenger" o "driver"',
      });
    }

    // Si intenta cambiar a modo conductor, verificar que sea un conductor aprobado
    if (currentMode === 'driver') {
      const Driver = require('../models/Driver');
      const driver = await Driver.findOne({
        where: { userId, status: 'approved' },
      });

      if (!driver) {
        return res.status(403).json({
          error:
            'No tienes permisos para ser conductor. Tu solicitud de registro aún no ha sido aprobada.',
        });
      }
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    await user.update({ currentMode });

    // Importar buildUserResponseObject desde authController
    const authController = require('./authController');
    const responseUser = await authController.buildUserResponseObject(user);

    res.status(200).json({
      message: `Modo cambiado a ${currentMode} correctamente`,
      user: responseUser,
    });
  } catch (error) {
    console.error('Error al cambiar modo:', error);
    res.status(500).json({
      error: 'Error al cambiar el modo',
    });
  }
};

module.exports = {
  getUserProfile,
  getVerifiedProfilePhoto,
  updateUserProfile,
  updateProfilePhoto,
  verifyPhone,
  updateCurrentMode,
};
