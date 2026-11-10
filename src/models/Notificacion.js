// backend/src/models/Notificacion.js
'use strict';
const { DataTypes: DatosTipos } = require('sequelize');
const sequelize = require("../config/baseDatos");

const Notificacion = sequelize.define(
  'Notification',
  {
    id: {
      type: DatosTipos.UUID,
      defaultValue: DatosTipos.UUIDV4,
      primaryKey: true
    },
    user_id: {
      type: DatosTipos.UUID,
      allowNull: false,
      references: { model: "usuario", key: 'id' }
    },
    title: {
      type: DatosTipos.STRING,
      allowNull: false
    },
    body: {
      type: DatosTipos.TEXT,
      allowNull: false
    },
    type: {
      type: DatosTipos.ENUM(
        'solicitud_viaje',
        'viaje_aceptado',
        'viaje_cancelado',
        'pago',
        'sistema',
        'emergencia',
        'panico'
      ),
      allowNull: false
    },
    action: { type: DatosTipos.STRING, field: 'accion' },
    rideId: { type: DatosTipos.UUID, field: 'id_viaje' },
    offerId: { type: DatosTipos.UUID, field: 'id_oferta_viaje' },
    requestId: { type: DatosTipos.UUID, field: 'id_solicitud_conductor' },
    alertId: { type: DatosTipos.UUID, field: 'id_alerta_emergencia' },
    commissionId: { type: DatosTipos.UUID, field: 'id_comision' },
    data: {
      type: DatosTipos.VIRTUAL,
      get() {
        const keys = { action: 'action', rideId: 'ride_id', offerId: 'offer_id', requestId: 'request_id', alertId: 'idAlerta', commissionId: 'commission_id' };
        return Object.fromEntries(Object.entries(keys).filter(([key]) => this.getDataValue(key) != null).map(([key, alias]) => [alias, this.getDataValue(key)]));
      },
      set(value) {
        const d = value || {};
        this.setDataValue('action', d.action || null);
        this.setDataValue('offerId', d.offer_id || null);
        this.setDataValue('alertId', d.idAlerta || null);
        this.setDataValue('rideId', d.offer_id || d.idAlerta ? null : d.ride_id || d.idViaje || null);
        this.setDataValue('requestId', d.request_id || null);
        this.setDataValue('commissionId', d.commission_id || null);
      }
    },
    is_read: {
      type: new DatosTipos.VIRTUAL(DatosTipos.BOOLEAN, ['read_at']),
      get() { return this.getDataValue('read_at') != null; }
    },
    sent_at: {
      type: DatosTipos.DATE,
      allowNull: true
    },
    read_at: {
      type: DatosTipos.DATE,
      allowNull: true
    }
  },
  {
    tableName: "notificacion",
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);

module.exports = Notificacion;
