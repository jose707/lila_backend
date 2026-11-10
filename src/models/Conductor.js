// backend/src/models/Conductor.js
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");
const { v4: uuidv4 } = require('uuid');

const Conductor = sequelize.define(
  'Driver',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: () => uuidv4(),
      primaryKey: true
    },
    userId: {
      type: DatosTipos.UUID,
      allowNull: false,
      unique: 'conductor_usuario_id_clave',
      references: {
        model: "usuario",
        key: 'id'
      },
      field: 'user_id'
    },
    licenseNumber: { type: DatosTipos.VIRTUAL },
    licenseExpiry: { type: DatosTipos.VIRTUAL },
    licenseNationality: { type: DatosTipos.VIRTUAL },
    licenseIssueDate: { type: DatosTipos.VIRTUAL },
    licenseCategory: { type: DatosTipos.VIRTUAL },
    licenseVerificationStatus: { type: DatosTipos.VIRTUAL },
    licenseVerifiedAt: { type: DatosTipos.VIRTUAL },
    status: {
      type: DatosTipos.ENUM('pendiente', 'aprobado', 'rechazado', 'suspendido'),
      defaultValue: 'pendiente'
    },
    rejectionReason: {
      type: DatosTipos.STRING,
      allowNull: true,
      field: 'rejection_reason'
    },
    isAvailable: {
      type: DatosTipos.BOOLEAN,
      defaultValue: false,
      field: 'is_available'
    },

    deleted_at: {
      type: DatosTipos.DATE,
      allowNull: true
    }
  },
  {
    timestamps: true,
    tableName: "conductor",
    paranoid: true,
    deletedAt: 'deleted_at'
  }
);

module.exports = Conductor;
