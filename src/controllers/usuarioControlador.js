// backend/src/controllers/usuarioControlador.js
const Usuario = require("../models/Usuario");
const UsuarioIdentidad = require("../models/UsuarioIdentidad");
const sequelize = require("../config/baseDatos");
const { unseal: unseal } = require("../services/identidadSessionCrypto");

const officialNombre = (identidad) => [identidad?.firstNames, identidad?.paternalSurname, identidad?.maternalSurname].
filter(Boolean).join(' ');

const obtenerUsuarioPerfil = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.params.id || solicitud.user.id;

    const usuario = await Usuario.findByPk(usuarioId, {
      attributes: { exclude: ['password'] },
      include: [{ model: UsuarioIdentidad, as: 'identity' }]
    });

    if (!usuario) {
      return respuesta.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    respuesta.status(200).json({
      user: { ...usuario.toJSON(), name: officialNombre(usuario.identity) }
    });
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    respuesta.status(500).json({
      error: 'Error al obtener el perfil'
    });
  }
};

const actualizarUsuarioPerfil = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user.id;
    const { name: nombre, phone: telefono, email: correo } = solicitud.body;

    if (nombre) {
      return respuesta.status(400).json({ error: 'El nombre se obtiene de la cédula verificada y no se puede editar aquí.' });
    }

    const usuario = await Usuario.findByPk(usuarioId);
    if (!usuario) {
      return respuesta.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    if (correo && correo !== usuario.email) {
      const existenteUsuario = await Usuario.findOne({ where: { email: correo } });
      if (existenteUsuario) {
        return respuesta.status(400).json({
          error: 'El email ya está en uso'
        });
      }
    }

    await usuario.update({
      email: correo || usuario.email,
      phone: telefono || usuario.phone
    });

    respuesta.status(200).json({
      message: 'Perfil actualizado correctamente',
      user: {
        id: usuario.id,
        name: officialNombre(await UsuarioIdentidad.findOne({ where: { userId: usuarioId } })),
        email: usuario.email,
        phone: usuario.phone,
        role: usuario.role,
        profilePhoto: usuario.profilePhoto,
        rating: usuario.rating
      }
    });
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    respuesta.status(500).json({
      error: 'Error al actualizar el perfil'
    });
  }
};

const actualizarPerfilFoto = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user.id;
    const { photoUrl: fotoUrl } = solicitud.body;

    if (!fotoUrl) {
      return respuesta.status(400).json({
        error: 'URL de la foto es requerida'
      });
    }

    const usuario = await Usuario.findByPk(usuarioId);
    if (!usuario) {
      return respuesta.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    if ([`/api/usuarios/${usuario.id}/foto-perfil`, `/api/users/${usuario.id}/profile-photo`].includes(usuario.profilePhoto)) {
      return respuesta.status(409).json({ error: 'La foto de perfil verificada proviene de la prueba de vida.' });
    }

    await usuario.update({ profilePhoto: fotoUrl });

    respuesta.status(200).json({
      message: 'Foto de perfil actualizada',
      user: { id: usuario.id, profilePhoto: usuario.profilePhoto }
    });
  } catch (error) {
    console.error('Error al actualizar foto:', error);
    respuesta.status(500).json({
      error: 'Error al actualizar la foto de perfil'
    });
  }
};

const obtenerVerificadoPerfilFoto = async (solicitud, respuesta) => {
  try {
    const [documento] = await sequelize.query(
      `SELECT id, evidencia_cifrada FROM documento
       WHERE user_id = :userId AND document_type = 'profilePhoto' AND driver_request_id IS NULL
         AND is_current = true AND verification_status = 'verificado'
       ORDER BY created_at DESC LIMIT 1`,
      { replacements: { userId: solicitud.params.id }, type: sequelize.QueryTypes.SELECT }
    );
    if (!documento?.evidencia_cifrada) return respuesta.sendStatus(404);
    const contenido = unseal(
      Buffer.from(documento.evidencia_cifrada, 'base64'),
      `${documento.id}:${solicitud.params.id}:profilePhoto`
    );
    if (typeof contenido.image !== 'string') return respuesta.sendStatus(404);
    respuesta.set('Cache-Control', 'private, no-store');
    respuesta.type('jpeg').send(Buffer.from(contenido.image, 'base64'));
  } catch (error) {
    console.error('Error al servir foto de perfil verificada:', error.name || 'Error');
    respuesta.sendStatus(503);
  }
};

const verificarTelefono = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user.id;
    const { verificationCode: verificacionCodigo } = solicitud.body;

    if (!verificacionCodigo) {
      return respuesta.status(400).json({
        error: 'Código de verificación requerido'
      });
    }

    const usuario = await Usuario.findByPk(usuarioId);
    await usuario.update({ phoneVerified: true });

    respuesta.status(200).json({
      message: 'Teléfono verificado correctamente'
    });
  } catch (error) {
    console.error('Error al verificar teléfono:', error);
    respuesta.status(500).json({
      error: 'Error al verificar el teléfono'
    });
  }
};

const actualizarRealModo = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user.id;
    const { modoActual: realModo } = solicitud.body;

    // Validar que el modo sea válido
    if (!realModo || !['pasajero', 'conductor'].includes(realModo)) {
      return respuesta.status(400).json({
        error: 'Modo inválido. Debe ser "pasajero" o "conductor"'
      });
    }

    // Si intenta cambiar a modo conductor, verificar que sea un conductor aprobado
    if (realModo === 'conductor') {
      const Conductor = require("../models/Conductor");
      const conductor = await Conductor.findOne({
        where: { userId: usuarioId, status: 'aprobado' }
      });

      if (!conductor) {
        return respuesta.status(403).json({
          error:
          'No tienes permisos para ser conductor. Tu solicitud de registro aún no ha sido aprobada.'
        });
      }
    }

    const usuario = await Usuario.findByPk(usuarioId);
    if (!usuario) {
      return respuesta.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    await usuario.update({ modoActual: realModo });

    const autenticacionControlador = require("./autenticacionControlador");
    const respuestaUsuario = await autenticacionControlador.construirUsuarioRespuestaObjeto(usuario);

    respuesta.status(200).json({
      message: `Modo cambiado a ${realModo} correctamente`,
      user: respuestaUsuario
    });
  } catch (error) {
    console.error('Error al cambiar modo:', error);
    respuesta.status(500).json({
      error: 'Error al cambiar el modo'
    });
  }
};

module.exports = {
  obtenerUsuarioPerfil: obtenerUsuarioPerfil,
  obtenerFotoPerfilVerificada: obtenerVerificadoPerfilFoto,
  actualizarUsuarioPerfil: actualizarUsuarioPerfil,
  actualizarFotoPerfil: actualizarPerfilFoto,
  verificarTelefono: verificarTelefono,
  actualizarActualModo: actualizarRealModo
};
