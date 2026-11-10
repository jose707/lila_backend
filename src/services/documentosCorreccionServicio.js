'use strict';
const { createHash } = require('crypto');
const db = require('../config/baseDatos');
const repo = require('./documentosRepositorio');
const tipos = require('../config/documentos-estructura');
const { compararLicenciaLados, emisionLicenciaFutura } = require('./licenseValidacion');

const etiquetas = {
  fullName:'Nombre completo', ciNumber:'CI', licenseNumber:'Número de licencia', issueDate:'Fecha de emisión',
  birthDate:'Fecha de nacimiento', nationality:'Nacionalidad', licenseExpiryDate:'Vencimiento de licencia', licenseCategory:'Categoría de licencia',
  ticNumber:'Número de TIC', issuingPlace:'Lugar de emisión', firstNames:'Nombres', surnames:'Apellidos', category:'Categoría', expiryDate:'Vencimiento',
  birthPlace:'Lugar de nacimiento', issuedIn:'Expedido en', maritalStatus:'Estado civil', occupation:'Ocupación', address:'Dirección',
  procedureReason:'Motivo del trámite', recipient:'Destinatario', backgroundUnit:'Unidad de antecedentes', backgroundResult:'Resultado de antecedentes',
  validUntil:'Válido hasta', certificateNumber:'Número de certificado',
  vehiclePlate:'Placa', vehicleBrand:'Marca', vehicleModel:'Modelo', vehicleYear:'Año del vehículo', vehicleColor:'Color',
  vehiclePassengerCapacity:'Capacidad de pasajeros', vehicleType:'Tipo de vehículo', vehicleClass:'Clase de vehículo', vehicleOwnerName:'Propietario',
  vehicleOwnerCi:'CI del propietario', registrationMunicipality:'Municipio de registro', crpvaNumber:'Número CRPVA', ruatIssueDate:'Fecha de emisión del RUAT',
  ownershipStartDate:'Inicio de propiedad', doorCount:'Cantidad de puertas', serviceType:'Tipo de servicio', chassisNumber:'Número de chasis',
  engineNumber:'Número de motor', fuelType:'Combustible', engineDisplacement:'Cilindrada', engineType:'Tipo de motor', legalObservations:'Observaciones legales',
  soatRosetteNumber:'Número de roseta', soatYear:'Gestión del SOAT', soatDepartment:'Departamento', soatVehicleType:'Tipo de vehículo del SOAT',
  soatPlate:'Placa del SOAT', soatStartDate:'Inicio de vigencia del SOAT', soatExpiryDate:'Vencimiento del SOAT', soatUse:'Uso del SOAT',
  serviceAddress:'Dirección del servicio', billingMonth:'Mes de facturación'
};
const fechas = new Set(['issueDate','birthDate','licenseExpiryDate','expiryDate','validUntil','ruatIssueDate','ownershipStartDate','soatStartDate','soatExpiryDate']);
const opciones = { vehicleType:['taxi','minibus','bus','motocicleta'], soatUse:['PUBLICO','PARTICULAR'] };
const error = (status, message) => Object.assign(new Error(message), { status });
const fechaIso = valor => {
  const texto = String(valor || '').trim();
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  return local ? `${local[3]}-${local[2]}-${local[1]}` : texto;
};
const nombre = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
  .replace(/[^A-Z ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
const vigente = valor => !!valor && new Date(`${fechaIso(valor)}T23:59:59.999Z`) >= new Date();

// Las mismas reglas se usan al corregir y al aprobar; corregir no las omite.
function validarDatosDocumentales(metadata, identidad) {
  const ocr = metadata.ocr || {};
  const licencia = ocr.licenseFront?.fields || {}, reverso = ocr.licenseBack?.fields || {};
  const tic = ocr.ticPhoto?.fields || {}, ruat = ocr.ruatPhoto?.fields || {}, soat = ocr.soatPhoto?.fields || {};
  const esperado = [identidad?.firstNames,identidad?.paternalSurname,identidad?.maternalSurname].filter(Boolean).join(' ');
  const errores = [];
  const agregar = (documentos, mensaje) => documentos.forEach(documento => errores.push({ documento, mensaje }));
  if (!compararLicenciaLados(licencia,reverso).matches)
    agregar(['licenseFront','licenseBack'],'El número de licencia debe estar leído y coincidir en ambas caras.');
  if (emisionLicenciaFutura(licencia,reverso))
    agregar(['licenseFront','licenseBack'],'Licencia: la fecha de emisión no puede ser futura.');
  if (!licencia.licenseNumber || licencia.licenseNumber !== identidad?.ciNumber)
    agregar(['licenseFront'],'Licencia: el número falta o no coincide con el CI.');
  if (nombre(licencia.fullName) !== nombre(esperado)) agregar(['licenseFront'],'Licencia: el nombre no coincide con el CI.');
  if (fechaIso(licencia.birthDate) !== identidad?.birthDate) agregar(['licenseFront'],'Licencia: la fecha de nacimiento no coincide con el CI.');
  if (!tic.fullName || nombre(tic.fullName) !== nombre(esperado)) agregar(['ticPhoto'],'TIC: el nombre falta o no coincide con el CI.');
  if (tic.licenseNumber !== licencia.licenseNumber) agregar(['ticPhoto'],'TIC: el número de licencia no coincide con la licencia presentada.');
  if (!ruat.vehiclePlate || !ruat.vehicleBrand || !ruat.vehicleModel || !ruat.vehicleYear)
    agregar(['ruatPhoto'],'RUAT: faltan placa, marca, modelo o año del vehículo.');
  if (!opciones.vehicleType.includes(metadata.vehicleType)) agregar(['ruatPhoto'],'El tipo de vehículo no es válido.');
  if (!vigente(licencia.licenseExpiryDate)) agregar(['licenseFront'],'Licencia: la fecha de vencimiento falta, es inválida o está vencida.');
  if (!vigente(soat.soatExpiryDate)) agregar(['soatPhoto'],'SOAT: la fecha de vencimiento falta, es inválida o está vencida.');
  if (soat.soatUse !== 'PUBLICO') agregar(['soatPhoto'],'SOAT: el uso debe ser PUBLICO.');
  return errores;
}

function revision(campos) { return createHash('sha256').update(JSON.stringify(campos)).digest('hex'); }
function describir(spec, campos) {
  return Object.keys(spec.fields).map(clave => ({ clave, etiqueta:etiquetas[clave], valor:campos[clave],
    tipo:fechas.has(clave) ? 'fecha' : 'texto', opciones:opciones[clave] }));
}
async function cargar(requestId, tipo, t) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) || !Object.hasOwn(tipos,tipo))
    throw error(400,'Documento o solicitud inválidos.');
  const Solicitud = require('../models/ConductorSolicitud');
  const solicitud = await Solicitud.findByPk(requestId,{transaction:t,lock:t.LOCK.UPDATE});
  if (!solicitud) throw error(404,'Solicitud no encontrada.');
  if (solicitud.status !== 'pendiente') throw error(409,'Solo se pueden corregir solicitudes pendientes de revisión.');
  if (solicitud.ocrProcessingStatus === 'pendiente') throw error(409,'Espera a que termine la lectura OCR antes de corregir.');
  const [reciente] = await repo.select(`SELECT id_solicitud_conductor FROM public.solicitud_conductor
    WHERE id_usuario=:id ORDER BY version DESC LIMIT 1`,{id:solicitud.userId},t);
  if (reciente?.id_solicitud_conductor !== solicitud.id) throw error(409,'Existe una versión más reciente de esta solicitud.');
  const [documento] = await repo.select(`SELECT d.* FROM public.solicitud_documento sd
    JOIN public.documento d USING(id_documento) WHERE sd.id_solicitud_conductor=:id AND d.tipo_documento=:tipo FOR UPDATE OF d`,
    {id:requestId,tipo},t);
  if (!documento) throw error(404,'Documento no encontrado en la solicitud.');
  if (documento.estado_verificacion === 'verificado') throw error(409,'El documento ya fue aprobado y no puede corregirse desde esta revisión.');
  const spec = tipos[tipo];
  const [fila] = await repo.select(`SELECT * FROM public.${spec.table} WHERE ${spec.primaryKey}=:id`,{id:documento.id_documento},t);
  const campos = Object.fromEntries(Object.entries(spec.fields).map(([clave,columna])=>[clave,String(fila?.[columna] ?? '')]));
  return {solicitud,documento,spec,campos};
}
async function consultarDatos(requestId,tipo) {
  return db.transaction(async t => {
    const {solicitud,spec,campos} = await cargar(requestId,tipo,t);
    const identidad = await require('../models/UsuarioIdentidad').findOne({where:{userId:solicitud.userId},transaction:t});
    return {campos:describir(spec,campos),revision:revision(campos),validaciones:validarDatosDocumentales(solicitud.metadata || {},identidad)};
  });
}
async function corregirDatos(requestId,tipo,body,administrador) {
  const recibidos = body?.campos;
  if (!recibidos || typeof recibidos !== 'object' || Array.isArray(recibidos) || typeof body.revision !== 'string')
    throw error(400,'Envía los campos y la versión de lectura del documento.');
  return db.transaction(async t => {
    const {solicitud,documento,spec,campos} = await cargar(requestId,tipo,t);
    if (body.revision !== revision(campos)) throw error(409,'Los datos cambiaron. Vuelve a abrir la corrección antes de guardar.');
    const nuevos = {...campos};
    for (const [clave,valor] of Object.entries(recibidos)) {
      if (!Object.hasOwn(spec.fields,clave) || typeof valor !== 'string' || valor.length > 2000)
        throw error(400,'Los campos enviados no son válidos para este documento.');
      let limpio = valor.trim();
      if (fechas.has(clave) && limpio) {
        limpio = fechaIso(limpio);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio) || !Number.isFinite(Date.parse(limpio)) || new Date(limpio).toISOString().slice(0,10) !== limpio)
          throw error(400,`${etiquetas[clave]}: utiliza una fecha válida en AAAA-MM-DD o DD/MM/AAAA.`);
      }
      if (opciones[clave] && limpio && !opciones[clave].includes(limpio)) throw error(400,`${etiquetas[clave]}: elige una de las opciones disponibles.`);
      if (['vehicleYear','soatYear'].includes(clave) && limpio && !/^\d{4}$/.test(limpio)) throw error(400,`${etiquetas[clave]} debe tener cuatro dígitos.`);
      if (['vehiclePassengerCapacity','doorCount'].includes(clave) && limpio && (!/^\d{1,3}$/.test(limpio) || Number(limpio) === 0)) throw error(400,`${etiquetas[clave]} debe ser un número entero positivo.`);
      nuevos[clave] = limpio;
    }
    const cambios = Object.keys(nuevos).filter(clave => nuevos[clave] !== campos[clave]);
    const revisarDeNuevo = [];
    if (cambios.length) {
      await repo.query(`INSERT INTO public.${spec.table}(${spec.primaryKey}) VALUES(:id) ON CONFLICT DO NOTHING`,{id:documento.id_documento},t);
      await repo.update(spec.table,spec.primaryKey,documento.id_documento,
        Object.fromEntries(cambios.map(clave=>[spec.fields[clave],nuevos[clave] || null])),t);
      await repo.update('documento','id_documento',documento.id_documento,
        {estado_verificacion:'pendiente',verificado_en:null,id_usuario_verificador:null,motivo_rechazo:null},t);
      await require('../models/AuditRegistro').create({table_name:spec.table,record_id:documento.id_documento,
        action:'ACTUALIZACION',changed_by:administrador,motivo:'Corrección manual de datos OCR durante la revisión',
        old_values:Object.fromEntries(cambios.map(clave=>[clave,campos[clave]])),
        new_values:{...Object.fromEntries(cambios.map(clave=>[clave,nuevos[clave]])),tipo:'correccion_ocr',solicitud:requestId,documento:tipo}
      },{transaction:t});
      revisarDeNuevo.push(tipo);
      if (tipo.startsWith('license')) {
        const [otra] = await repo.select(`SELECT d.tipo_documento FROM public.solicitud_documento sd JOIN public.documento d USING(id_documento)
          WHERE sd.id_solicitud_conductor=:id AND d.tipo_documento=:tipo AND d.estado_verificacion <> 'verificado'`,
          {id:requestId,tipo:tipo==='licenseFront'?'licenseBack':'licenseFront'},t);
        if (otra) revisarDeNuevo.push(otra.tipo_documento);
      }
    }
    const {metadata} = await require('./solicitudDocumentos').readMetadata(requestId,t);
    const identidad = await require('../models/UsuarioIdentidad').findOne({where:{userId:solicitud.userId},transaction:t});
    return {campos:describir(spec,nuevos),revision:revision(nuevos),usuarioId:solicitud.userId,revisarDeNuevo,
      modificados:cambios.length>0,validaciones:validarDatosDocumentales(metadata,identidad)};
  });
}

module.exports = { consultarDatos, corregirDatos, validarDatosDocumentales };
