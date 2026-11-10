const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const ConductorSolicitud = sequelize.define(
  'DriverRequest',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DatosTipos.UUID,
      allowNull: false,
      // Para vincular solicitudes del mismo usuario (v1, v2, v3...)
      field: 'user_id'
    },
    version: {
      type: DatosTipos.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    status: {
      type: DatosTipos.ENUM('pendiente', 'observado', 'aprobado', 'rechazado'),
      allowNull: false,
      defaultValue: 'pendiente'
    },
    rejectionReason: {
      type: DatosTipos.TEXT,
      allowNull: true,
      field: 'rejection_reason'
    },
    rejectedDocuments: { type: DatosTipos.VIRTUAL },
    ocrProcessingStatus: { type: DatosTipos.STRING, field: 'estado_ocr', allowNull:false, defaultValue: 'pendiente', validate:{isIn:[['pendiente','complete','fallido']]} },
    ocrProcessedAt: { type: DatosTipos.DATE, field: 'ocr_procesado_en' },
    finalRejection: { type: DatosTipos.VIRTUAL, get() { return this.getDataValue('status') === 'rechazado' && (this.getDataValue('rejectedDocuments') || []).length === 0; } },
    metadata: { type: DatosTipos.VIRTUAL, get() { return {...(this.getDataValue('metadata') || {}), finalRejection:this.finalRejection}; }, set(value) {
      this.setDataValue('metadata',value);
      if(value?.ocrProcessingStatus !== undefined)this.setDataValue('ocrProcessingStatus',value.ocrProcessingStatus);
      if(value?.ocrProcessedAt !== undefined)this.setDataValue('ocrProcessedAt',value.ocrProcessedAt);
    } }
  },
  {
    tableName: "solicitud_conductor",
    timestamps: true,
    underscored: true
  }
);

require('../services/solicitudDocumentos').configure(ConductorSolicitud);
module.exports = ConductorSolicitud;
