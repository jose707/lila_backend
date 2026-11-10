// backend/src/models/Usuario.js
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");
const { v4: uuidv4 } = require('uuid');

const Usuario = sequelize.define(
  'User',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true
    },
    name: {
      // Nombre oficial vive únicamente en user_identities. Se conserva como
      // virtual por compatibilidad temporal con respuestas de la aplicación.
      type: DatosTipos.VIRTUAL,
      allowNull: true
    },
    email: {
      type: DatosTipos.STRING,
      allowNull: false,
      unique: "usuario_correo_unico",
      validate: {
        isEmail: true
      }
    },
    phone: {
      type: DatosTipos.STRING,
      allowNull: false,
      unique: "usuario_telefono_unico"
    },
    password: {
      type: DatosTipos.STRING,
      allowNull: false
    },
    firebaseUid: {
      type: DatosTipos.STRING,
      allowNull: true,
      unique: "usuario_firebase_uid_unico",
      field: 'firebase_uid'
    },
    fcmToken: {
      type: DatosTipos.STRING,
      allowNull: true,
      field: 'fcm_token',
      comment: 'Firebase Cloud Messaging Device Token for Push Notifications'
    },
    role: {
      type: DatosTipos.ENUM({
        values: ['pasajero', 'conductor', 'administrador']
      }),
      defaultValue: 'pasajero'
    },
    profilePhoto: {
      type: DatosTipos.STRING,
      allowNull: true,
      field: 'profile_photo'
    },
    isActive: {
      type: DatosTipos.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    },
    phoneVerified: {
      type: DatosTipos.BOOLEAN,
      defaultValue: false,
      field: 'phone_verified'
    },
    lastLogin: {
      type: DatosTipos.DATE,
      allowNull: true,
      field: 'last_login'
    },
    modoActual: {
      type: DatosTipos.STRING(20),
      defaultValue: 'pasajero',
      comment: 'Modo actual: pasajero o conductor',
      field: 'current_mode'
    },
    deleted_at: {
      type: DatosTipos.DATE,
      allowNull: true
    }
  },
  {
    timestamps: true,
    tableName: "usuario",
    paranoid: true,
    deletedAt: 'deleted_at'
  }
);


module.exports = Usuario;
