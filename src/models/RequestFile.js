const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const DriverRequest = require('./DriverRequest');

const RequestFile = sequelize.define(
  'RequestFile',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    requestId: {
      type: DataTypes.UUID,
      allowNull: false,
      // Referencias foráneas se definen en associations.js
      field: 'driver_request_id',
    },
    fileType: {
      type: DataTypes.STRING(40),
      allowNull: false,
      field: 'document_type',
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'file_path',
    },
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'file_size',
    },
    mimeType: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'mime_type',
    },
    uploadedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      field: 'verification_status',
    },
    verifiedAt: { type: DataTypes.DATE, allowNull: true, field: 'verified_at' },
    verifiedBy: { type: DataTypes.UUID, allowNull: true, field: 'verified_by' },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
    },
    originalFilename: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'original_filename',
    },
  },
  {
    // Modelo de compatibilidad: no existe una tabla request_files. Los
    // adjuntos de solicitudes viven en la tabla genérica documents.
    tableName: 'documents',
    timestamps: false,
    hooks: {
      beforeValidate: async file => {
        if (file.userId || !file.requestId) return;
        const request = await DriverRequest.findByPk(file.requestId, {
          attributes: ['userId'],
        });
        if (!request) throw new Error('Solicitud de conductor no encontrada.');
        file.userId = request.userId;
      },
      beforeCreate: file => {
        if (!file.originalFilename) file.originalFilename = file.filename;
      },
    },
  },
);

module.exports = RequestFile;
