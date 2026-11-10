// backend/src/models/index.js
// Punto de entrada único para todos los modelos de Sequelize.
// Importa los modelos desde este archivo en toda la aplicación.

const sequelize = require("../config/baseDatos");
const configurarAsociaciones = require('./associations');

const Usuario = require("./Usuario");
const UsuarioIdentidad = require("./UsuarioIdentidad");
const Conductor = require("./Conductor");
const Viaje = require("./Viaje");
const ViajeOferta = require("./ViajeOferta");
const Pago = require("./Pago");
const Calificacion = require("./Calificacion");
const Vehiculo = require("./Vehiculo");
const ConductorUbicacion = require("./ConductorUbicacion");
const ConductorSolicitud = require("./ConductorSolicitud");
const ConductorDomicilio = require("./ConductorDomicilio");
const SolicitudArchivo = require("./SolicitudArchivo");
const Notificacion = require("./Notificacion");
const CancelacionMotivo = require("./CancelacionMotivo");
const CobrosConductor = require("./CobrosConductor");
const ComisionLiquidacion = require("./ComisionLiquidacion");
const ServicioZona = require("./ServiceZona");
const TarifasRegla = require("./TarifaRegla");
const AuditoriaRegistro = require("./AuditRegistro");
const ViajeParada = require("./ViajeParada");

// Wire all associations in one call
configurarAsociaciones();

module.exports = {
  sequelize,
  Documento: require('./Documento'),
  DocumentoCi: UsuarioIdentidad,
  DocumentoDomicilio: ConductorDomicilio,
  Comision: ComisionLiquidacion,
  PagoComision: require('./PagoComision'),
  Usuario: Usuario,
  UsuarioIdentidad: UsuarioIdentidad,
  Conductor: Conductor,
  Viaje: Viaje,
  ViajeOferta: ViajeOferta,
  Pago: Pago,
  Calificacion: Calificacion,
  Vehiculo: Vehiculo,
  ConductorUbicacion: ConductorUbicacion,
  ConductorSolicitud: ConductorSolicitud,
  ConductorDomicilio: ConductorDomicilio,
  SolicitudArchivo: SolicitudArchivo,
  Notificacion: Notificacion,
  CancelacionMotivo: CancelacionMotivo,
  CobrosConductor: CobrosConductor,
  ComisionLiquidacion: ComisionLiquidacion,
  ServicioZona: ServicioZona,
  TarifaRegla: TarifasRegla,
  AuditoriaRegistro: AuditoriaRegistro,
  ViajeParada: ViajeParada
};
