const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");
const ConductorSolicitud = require("./ConductorSolicitud");

const SolicitudArchivo = sequelize.define(
  'RequestFile',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    requestId: {
      type: DatosTipos.UUID,
      allowNull: false,
      // Referencias foráneas se definen en associations.js
      field: 'driver_request_id'
    },
    fileType: {
      type: DatosTipos.STRING(40),
      allowNull: false,
      field: 'document_type'
    },
    filename: {
      type: DatosTipos.STRING,
      allowNull: false,
      field: 'file_path'
    },
    evidenceOrigin: { type: DatosTipos.STRING(100), field: 'origen_evidencia' },
    mimeType: {
      type: DatosTipos.STRING,
      allowNull: true,
      field: 'mime_type'
    },
    uploadedAt: {
      type: DatosTipos.DATE,
      defaultValue: DatosTipos.NOW,
      field: 'created_at'
    },
    status: {
      type: DatosTipos.STRING(20),
      allowNull: false,
      defaultValue: 'pendiente',
      field: 'verification_status'
    },
    verifiedAt: { type: DatosTipos.DATE, allowNull: true, field: 'verified_at' },
    verifiedBy: { type: DatosTipos.UUID, allowNull: true, field: 'verified_by' },
    userId: {
      type: DatosTipos.UUID,
      allowNull: false,
      field: 'user_id'
    }
  },
  {
    // Modelo de compatibilidad: no existe una tabla request_files. Los
    // adjuntos de solicitudes viven en la tabla genérica documents.
    tableName: "archivo_solicitud",
    timestamps: false,
    hooks: {
      beforeValidate: async (archivo) => {
        if (archivo.userId || !archivo.requestId) return;
        const solicitud = await ConductorSolicitud.findByPk(archivo.requestId, {
          attributes: ['userId']
        });
        if (!solicitud) throw new Error('Solicitud de conductor no encontrada.');
        archivo.userId = solicitud.userId;
      }
    }
  }
);

require('../services/documentosModelos').configureFile(SolicitudArchivo);
module.exports = SolicitudArchivo;
