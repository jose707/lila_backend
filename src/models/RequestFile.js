const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

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
      field: 'request_id',
    },
    fileType: {
      type: DataTypes.ENUM(
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
      ),
      allowNull: false,
      field: 'file_type',
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false,
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
      field: 'uploaded_at',
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'pending',
    },
  },
  {
    tableName: 'request_files',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['request_id', 'file_type'],
        name: 'unique_request_file_type',
      },
    ],
  },
);

module.exports = RequestFile;
