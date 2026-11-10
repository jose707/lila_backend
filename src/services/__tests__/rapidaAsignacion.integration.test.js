'use strict';
// Crea y elimina únicamente una base de datos local nueva con nombre único. No migra datos de la aplicación.
const { test, before: antes, after: despues, beforeEach: antesCada } = require('node:test');
const comprobar = require('node:assert/strict');
const { randomUUID: aleatorioUUID } = require('node:crypto');
require('dotenv').config();
const { Client: Cliente } = require('pg');
process.env.COMMISSION_PROOF_DIR = require('path').resolve(__dirname,'../../../../.tmp-normalizacion/comprobantes');
const habilitado = process.env.RUN_QUICK_DB_TESTS === '1';
let administrador,
  db,
  servicio,
  Viaje,
  creado = false;
const baseDatos = `linealila_quick_test_${Date.now()}`;
let pasajero, segundoPasajero, cercanoConductor, lejanoConductor;
const eventosSocket = [];
const ubicacion = { latitude: -16.5, longitude: -68.15, address: 'Recogida' };
const entrada = () => ({
  pickupLocation: ubicacion,
  dropoffLocation: { ...ubicacion, latitude: -16.52, address: 'Destino' },
  vehicleTypeRequested: 'taxi',
  paymentMethod: 'efectivo',
  requestKey: aleatorioUUID(),
  fare: 0,
  distance: 1,
  duration: 1
});

antes(async () => {
  if (!habilitado) return;
  const servidor = process.env.DB_HOST || 'localhost';
  comprobar.ok(
    ['localhost', '127.0.0.1', '::1'].includes(servidor),
    'Tests only run against localhost'
  );
  administrador = new Cliente({
    host: servidor,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password'
  });
  await administrador.connect();
  await administrador.query(`CREATE DATABASE "${baseDatos}"`);
  creado = true;
  process.env.DB_NAME = baseDatos;
  db = require("../../config/baseDatos");
  await require('../../../migrations/00000000-initial-schema').up(
    db.getQueryInterface(),
    db.Sequelize
  );
  // Reconectar después de instalar PostGIS para cargar los tipos de geometría.
  await db.connectionManager.pool.destroyAllNow();
  db.connectionManager._clearDynamicOIDs();
  require("../asignacionRouting").conduccionRuta = async () => ({
    distance: 2000,
    duration: 240
  });
  // Keep delivery out of these database tests, while exercising the actual transaction service.
  require('../../socket').obtenerIo = () => ({
    to: canal => ({ emit: (evento, datos) => eventosSocket.push({ canal, evento, datos }) }),
    emit: (evento, datos) => eventosSocket.push({ evento, datos })
  });
  servicio = require("../rapidaAsignacionServicio");
  require("../notificacionServicio").notificar = async () => {};
  Viaje = require("../../models/Viaje");
  await db.authenticate();
});
despues(async () => {
  if (db) await db.close();
  if (creado) {
    comprobar.match(baseDatos, /^linealila_quick_test_\d+$/);
    await administrador.query(`DROP DATABASE "${baseDatos}" WITH (FORCE)`);
  }
  if (administrador) await administrador.end();
});
antesCada(async () => {
  if (!habilitado) return;
  eventosSocket.length = 0;
  require("../asignacionRouting").conduccionRuta = async () => ({
    distance: 2000,
    duration: 240
  });
  await db.query("TRUNCATE usuario CASCADE");
  await db.query("TRUNCATE public.zona_servicio CASCADE",{esquemaFisico:true});
  pasajero = aleatorioUUID();
  segundoPasajero = aleatorioUUID();
  cercanoConductor = aleatorioUUID();
  lejanoConductor = aleatorioUUID();
  for (const id of [pasajero, segundoPasajero]) {
    await db.query("INSERT INTO usuario(id, firebase_uid) VALUES (:id,:id)", {
      replacements: { id }
    });
  }
  for (const [id, latitud] of [
  [cercanoConductor, -16.501],
  [lejanoConductor, -16.51]])
  {
    const usuario = aleatorioUUID();
    await db.query(
      `INSERT INTO usuario(id,firebase_uid,role) VALUES (:user,:user,'conductor');
      INSERT INTO conductor(id,user_id,status) VALUES (:id,:user,'aprobado');
      INSERT INTO vehiculo(driver_id,status) VALUES (:id,'activo');
      INSERT INTO ubicacion_conductor(driver_id,location,is_online,location_recorded_at)
        VALUES (:id,ST_SetSRID(ST_MakePoint(-68.15,:latitude),4326),true,NOW());`,
      {
        replacements: { id, user: usuario, latitude: latitud, plate: id.slice(0, 10) }
      }
    );
    const repo=require('../documentosRepositorio');
    const [vehicle]=await repo.select('SELECT id_vehiculo FROM public.vehiculo WHERE id_conductor=:id',{id});
    const doc=await repo.createDocument({vehicleId:vehicle.id_vehiculo,tipo_documento:'ruatPhoto',ruta_archivo:'test-ruat.jpg',estado_verificacion:'verificado',verificado_en:new Date(),vigente:true});
    await repo.insert('documento_ruat',{id_documento_ruat:doc,marca:'Test',modelo:'Test',anio:'2025',placa:id.slice(0,10),capacidad:'4',tipo_vehiculo:'taxi'});
  }
});
const baseDatosTest = (nombre, accion) => test(nombre, { skip: !habilitado }, accion);

async function crearComisionConViajes(cantidad=1){
  const repo=require('../documentosRepositorio');const {ComisionLiquidacion,CobrosConductor}=require('../../models');
  await repo.query("INSERT INTO public.zona_servicio(nombre,limite,tasa_comision) VALUES('Zona comisión',ST_GeomFromText('POLYGON((-69 -17,-67 -17,-67 -16,-69 -16,-69 -17))',4326),0.2)");
  const reserved=await servicio.reservar(pasajero,entrada());const ride=await Viaje.findByPk(reserved.id);
  await ride.update({status:'completado',finalFare:100/cantidad,completedAt:new Date()});
  const hoy=require('../../jobs/liquidacionJobs').fechaBolivia();const [year,month]=hoy.split('-').map(Number);const periodo=new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,10);
  const row=await ComisionLiquidacion.create({driver_id:ride.driverId,period_start:periodo});
  for(let i=0;i<cantidad;i++){
    const viaje=i===0?ride:await Viaje.create({...ride.get({plain:true}),id:aleatorioUUID(),requestKey:aleatorioUUID()});
    await CobrosConductor.create({ride_id:viaje.id,settlement_id:row.id});
  }
  return row.reload();
}

baseDatosTest('el perfil de conductor se crea únicamente al aprobar una solicitud y la aprobación es atómica', async t => {
  const { Conductor, ConductorSolicitud, Vehiculo, UsuarioIdentidad, SolicitudArchivo } = require('../../models');
  const registro = require('../../controllers/solicitudControlador');
  const revision = require('../../controllers/conductorRevisionControlador');
  const legado = require('../../controllers/conductorControlador');
  const respuesta = () => ({ codigo: 200, status(codigo) { this.codigo = codigo; return this; }, json(datos) { this.datos = datos; return this; } });
  const tipos = ['licenseFront', 'licenseBack', 'ticPhoto', 'antecedentsPhoto', 'ruatPhoto', 'soatPhoto', 'carFront', 'carBack', 'domicileProof'];
  await UsuarioIdentidad.create({ userId: pasajero, firstNames: 'Ana', paternalSurname: 'Paz',
    ciNumber: '12345678', birthDate: '1995-01-01', verificationStatus: 'verificado' });
  const inmediato = global.setImmediate;
  t.mock.method(global, 'setImmediate', (fn, ...args) =>
    fn.toString().includes('procesarConductorSolicitudOcr') ? undefined : inmediato(fn, ...args));
  const fs = require('fs/promises'), path = require('path');
  const directory = await fs.mkdtemp(path.join(require('os').tmpdir(),'linealila-documentos-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  const imagen = await require('sharp')({create:{width:200,height:200,channels:3,background:'#cccccc'}}).png().toBuffer();
  const archivos = Object.fromEntries(await Promise.all(tipos.map(async tipo => {
    const filename = tipo + '.png', archivo = path.join(directory,filename);
    await fs.writeFile(archivo,imagen);
    return [tipo,[{filename,path:archivo,size:imagen.length,mimetype:'image/png'}]];
  })));
  comprobar.equal(legado.registrarConductor, registro.registrarConductor);
  comprobar.equal(legado.reenviarDocumentos, registro.reenviarDocumentos);
  const registrar = async () => {
    const resultado = respuesta();
    await legado.registrarConductor({ user: { id: pasajero }, body: {
      ...Object.fromEntries(tipos.map(tipo=>[tipo+'Origen',tipo==='licenseBack'?'archivo_subido':'captura_camara'])),
      domicileAddress: 'Avenida de prueba 123', domicileLatitude: -16.5, domicileLongitude: -68.15,
      licenseFrontCropX:50,licenseFrontCropY:60,licenseFrontCropW:100,licenseFrontCropH:80,licenseFrontCropScreenW:200,licenseFrontCropScreenH:200
    }, files: archivos }, resultado);
    return resultado;
  };
  const resultados = await Promise.all([registrar(), registrar()]);
  comprobar.deepEqual(resultados.map(r => r.codigo).sort(), [201, 409]);
  comprobar.equal(await Conductor.count({ where: { userId: pasajero } }), 0);
  comprobar.equal(await ConductorSolicitud.count({ where: { userId: pasajero } }), 1);
  const primera = await ConductorSolicitud.findOne({ where: { userId: pasajero } });
  const archivoGuardado = await SolicitudArchivo.findOne({where:{requestId:primera.id,fileType:'licenseFront'}});
  comprobar.equal(archivoGuardado.filename,archivos.licenseFront[0].filename);
  comprobar.equal(archivoGuardado.mimeType,'image/jpeg');
  comprobar.equal(archivoGuardado.evidenceOrigin,'captura_camara');
  comprobar.equal((await SolicitudArchivo.findOne({where:{requestId:primera.id,fileType:'licenseBack'}})).evidenceOrigin,'archivo_subido');
  const guardada = await fs.readFile(archivos.licenseFront[0].path);
  const dimensiones = await require('sharp')(guardada).metadata();
  comprobar.equal(dimensiones.width,110);comprobar.equal(dimensiones.height,88);
  comprobar.equal(Object.hasOwn(archivoGuardado.get({plain:true}),'fileSize'),false);
  comprobar.equal(Object.hasOwn(archivoGuardado.get({plain:true}),'originalFilename'),false);
  const [columnasRecorte] = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='documento' AND column_name LIKE 'recorte_%'",{esquemaFisico:true});
  comprobar.equal(columnasRecorte.length,0);
  const estado = respuesta();
  await legado.obtenerConductorEstado({ user: { id: pasajero } }, estado);
  comprobar.equal(estado.datos.hasApplication, true);
  comprobar.equal(estado.datos.status, 'pendiente');
  comprobar.equal(estado.datos.driver, null);

  const licencia = { licenseNumber: '12345678', fullName: 'Ana Paz', birthDate: '1995-01-01',
    issueDate: '2025-01-01', licenseExpiryDate: '2099-01-01', licenseCategory: 'A' };
  const placa = `AP-${pasajero.slice(0, 8)}`;
  await primera.update({ metadata: { ocrProcessingStatus: 'complete', vehicleType: 'taxi', ocr: {
    licenseFront: { fields: licencia }, licenseBack: { fields: { licenseNumber: licencia.licenseNumber } },
    ticPhoto: { fields: { firstNames:'Ana', surnames:'Paz', licenseNumber: '12345678' } },
    ruatPhoto: { fields: { vehicleOwnerName: 'Ana Paz', vehicleOwnerCi: '12345678',
      vehiclePlate: placa, vehicleBrand: 'Prueba', vehicleModel: 'Taxi', vehicleYear: '2025' } },
    soatPhoto: { fields: { soatExpiryDate: '2099-01-01', soatUse: 'PUBLICO' } }
  } } });
  process.env.PSYCHOLOGICAL_REPORT_DIR = require('path').resolve(__dirname,'../../../../.tmp-normalizacion/informes');
  const app = require('express')();
  app.use(require('express').json());
  app.use('/administracion', require('../../routes/administracion'));
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const token = require('jsonwebtoken').sign({ id: segundoPasajero, role: 'administrador' }, process.env.JWT_SECRET || 'secret');
  const repoCorrecciones = require('../documentosRepositorio');
  const Auditoria = require('../../models/AuditRegistro');
  await repoCorrecciones.update('documento','id_documento',archivoGuardado.id,{texto_ocr:'Lectura OCR original conservada'});
  const datosUrl = `http://127.0.0.1:${server.address().port}/administracion/solicitudes/${primera.id}/documentos/licenseFront/datos`;
  const headersCorreccion = {Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const editar = (revision,campos) => fetch(datosUrl,{method:'PUT',headers:headersCorreccion,body:JSON.stringify({revision,campos})});
  comprobar.equal((await fetch(datosUrl)).status,401);
  const pasajeroToken=require('jsonwebtoken').sign({id:pasajero,role:'pasajero'},process.env.JWT_SECRET||'secret');
  comprobar.equal((await fetch(datosUrl,{headers:{Authorization:`Bearer ${pasajeroToken}`}})).status,403);
  await repoCorrecciones.update('solicitud_conductor','id_solicitud_conductor',primera.id,{estado_ocr:'pendiente'});
  comprobar.equal((await fetch(datosUrl,{headers:headersCorreccion})).status,409);
  await repoCorrecciones.update('solicitud_conductor','id_solicitud_conductor',primera.id,{estado_ocr:'complete'});
  comprobar.equal((await fetch(datosUrl.replace('licenseFront','ciFront'),{headers:headersCorreccion})).status,400);
  const lectura = await fetch(datosUrl,{headers:headersCorreccion});
  comprobar.equal(lectura.status,200);
  const original = await lectura.json();
  comprobar.ok(original.campos.some(c=>c.clave==='nationality' && c.valor===''));
  comprobar.equal((await editar(original.revision,{status:'verificado'})).status,400);
  comprobar.equal((await editar(original.revision,{issueDate:'31/02/2026'})).status,400);
  const futura = await editar(original.revision,{issueDate:'01/01/2099'});
  comprobar.equal(futura.status,200);
  const datosFuturos = await futura.json();
  comprobar.ok(datosFuturos.validaciones.some(v=>v.mensaje.includes('emisión no puede ser futura')));
  comprobar.deepEqual(datosFuturos.revisarDeNuevo.sort(),['licenseBack','licenseFront']);
  const noAprobar = respuesta();
  await revision.aprobarConductor({user:{id:segundoPasajero},params:{requestId:primera.id},body:{verifiedDocuments:tipos},soloRevisionDocumental:true},noAprobar);
  comprobar.equal(noAprobar.codigo,400);
  comprobar.equal((await editar(original.revision,{issueDate:'2024-01-01'})).status,409);
  const [auditoria] = await Auditoria.findAll({where:{record_id:archivoGuardado.id}});
  comprobar.equal(auditoria.changed_by,segundoPasajero);
  comprobar.equal(auditoria.old_values.issueDate,'2025-01-01');
  comprobar.equal(auditoria.new_values.issueDate,'2099-01-01');
  comprobar.equal(auditoria.new_values.tipo,'correccion_ocr');
  comprobar.ok(auditoria.changed_at);
  const falloAuditoria=t.mock.method(Auditoria,'create',async()=>{throw new Error('Fallo de auditoría simulado');});
  const fallidaCorreccion=await editar(datosFuturos.revision,{issueDate:'2025-01-01'});
  comprobar.equal(fallidaCorreccion.status,500);
  falloAuditoria.mock.restore();
  const [trasFallo]=await repoCorrecciones.select('SELECT fecha_emision_detectada FROM public.documento_licencia WHERE id_documento_licencia=:id',{id:archivoGuardado.id});
  comprobar.equal(trasFallo.fecha_emision_detectada,'2099-01-01','Si falla auditoría, también se revierte la corrección');
  const corregida=await editar(datosFuturos.revision,{issueDate:'2025-01-01'});
  comprobar.equal(corregida.status,200);
  const guardados=await corregida.json();
  comprobar.equal(guardados.validaciones.length,0);
  const antesSinCambios=await Auditoria.count({where:{record_id:archivoGuardado.id}});
  comprobar.equal((await editar(guardados.revision,{})).status,200);
  comprobar.equal(await Auditoria.count({where:{record_id:archivoGuardado.id}}),antesSinCambios);
  comprobar.deepEqual(await fs.readFile(archivos.licenseFront[0].path),guardada);
  const [evidencia]=await repoCorrecciones.select('SELECT texto_ocr,estado_verificacion FROM public.documento WHERE id_documento=:id',{id:archivoGuardado.id});
  comprobar.equal(evidencia.texto_ocr,'Lectura OCR original conservada');
  comprobar.equal(evidencia.estado_verificacion,'pendiente');
  for (const [tipo,clave,valor,esperado] of [
    ['licenseBack','issueDate','11/10/2022','2022-10-11'],
    ['ticPhoto','issuingPlace','La Paz','La Paz'],
    ['antecedentsPhoto','certificateNumber','CERT-123','CERT-123'],
    ['ruatPhoto','vehicleType','minibus','minibus'],
    ['soatPhoto','soatUse','PARTICULAR','PARTICULAR'],
    ['domicileProof','serviceAddress','Avenida Corregida 123','Avenida Corregida 123']
  ]) {
    const url=datosUrl.replace('licenseFront',tipo);
    const previo=await (await fetch(url,{headers:headersCorreccion})).json();
    const actualizado=await fetch(url,{method:'PUT',headers:headersCorreccion,
      body:JSON.stringify({revision:previo.revision,campos:{[clave]:valor}})});
    comprobar.equal(actualizado.status,200,JSON.stringify(await actualizado.clone().json()));
    const datos=await actualizado.json();
    comprobar.equal(datos.campos.find(c=>c.clave===clave).valor,esperado);
    if (tipo==='soatPhoto') comprobar.ok(datos.validaciones.some(v=>v.documento==='soatPhoto' && v.mensaje.includes('PUBLICO')));
    if (tipo==='ruatPhoto') {
      const actual=await ConductorSolicitud.findByPk(primera.id);
      comprobar.equal(actual.metadata.vehicleType,'minibus');
    }
    const restaurado=await fetch(url,{method:'PUT',headers:headersCorreccion,body:JSON.stringify({revision:datos.revision,
      campos:{[clave]:previo.campos.find(c=>c.clave===clave).valor}})});
    comprobar.equal(restaurado.status,200);
  }
  const soatUrl=datosUrl.replace('licenseFront','soatPhoto');
  const soatLectura=await (await fetch(soatUrl,{headers:headersCorreccion})).json();
  comprobar.equal((await fetch(soatUrl,{method:'PUT',headers:headersCorreccion,body:JSON.stringify({revision:soatLectura.revision,campos:{soatUse:'PRIVADO'}})})).status,400);
  const simultaneos=await Promise.all(['LP','SC'].map(soatDepartment=>fetch(soatUrl,{method:'PUT',headers:headersCorreccion,
    body:JSON.stringify({revision:soatLectura.revision,campos:{soatDepartment}})})));
  comprobar.deepEqual(simultaneos.map(r=>r.status).sort(),[200,409]);
  const observado = respuesta();
  await revision.observeConductor({ user: { id: segundoPasajero }, params: { requestId: primera.id }, body: {
    reason: 'Repetir foto frontal', rejectedDocuments: ['carFront'], verifiedDocuments: tipos.filter(tipo => tipo !== 'carFront')
  } }, observado);
  comprobar.equal(observado.codigo, 200);
  comprobar.equal(await Conductor.count({ where: { userId: pasajero } }), 0);
  const sinOrigen = respuesta();
  await legado.reenviarDocumentos({user:{id:pasajero},body:{},files:{carFront:archivos.carFront}},sinOrigen);
  comprobar.equal(sinOrigen.codigo,400);
  comprobar.equal(await ConductorSolicitud.count({where:{userId:pasajero}}),1);
  const crearArchivo = SolicitudArchivo.create.bind(SolicitudArchivo);
  const falloArchivo = t.mock.method(SolicitudArchivo, 'create', async (datos, opciones) => {
    if (datos.fileType === 'carFront') throw new Error('Fallo de archivo simulado');
    return crearArchivo(datos, opciones);
  });
  const reenvioFallido = respuesta();
  await legado.reenviarDocumentos({ user: { id: pasajero }, body: {carFrontOrigen:'archivo_subido'}, files: { carFront: archivos.carFront } }, reenvioFallido);
  comprobar.equal(reenvioFallido.codigo, 500);
  comprobar.equal(await ConductorSolicitud.count({ where: { userId: pasajero } }), 1);
  falloArchivo.mock.restore();
  const reenviado = respuesta();
  await legado.reenviarDocumentos({ user: { id: pasajero }, body: {carFrontOrigen:'archivo_subido'}, files: { carFront: archivos.carFront } }, reenviado);
  comprobar.equal(reenviado.codigo, 200);
  const segunda = await ConductorSolicitud.findByPk(reenviado.datos.request.id);
  const domicilio = await require('../../models/ConductorDomicilio').findOne({ where: { driverRequestId: segunda.id } });
  comprobar.equal(domicilio?.userId, pasajero, JSON.stringify(domicilio));
  comprobar.equal(domicilio?.address, 'Avenida de prueba 123', JSON.stringify(domicilio));
  comprobar.deepEqual(domicilio?.location?.coordinates, [-68.15, -16.5], JSON.stringify(domicilio));
  comprobar.equal(segunda.version, 2);
  comprobar.equal((await SolicitudArchivo.findOne({where:{requestId:segunda.id,fileType:'licenseFront'}})).evidenceOrigin,'captura_camara');
  comprobar.equal((await SolicitudArchivo.findOne({where:{requestId:segunda.id,fileType:'carFront'}})).evidenceOrigin,'archivo_subido');
  comprobar.equal((await SolicitudArchivo.findOne({where:{requestId:primera.id,fileType:'carFront'}})).evidenceOrigin,'captura_camara');
  comprobar.equal(await Conductor.count({ where: { userId: pasajero } }), 0);
  const aprobar = async id => {
    const resultado = respuesta();
    await revision.aprobarConductor({ user: { id: segundoPasajero }, params: { requestId: id },
      body: { verifiedDocuments: tipos } }, resultado);
    return resultado;
  };
  comprobar.equal((await aprobar(primera.id)).codigo, 409);
  // El vehículo puede pertenecer a una persona distinta del solicitante.
  const documentosValidos = { ...segunda.metadata, ocr: { ...segunda.metadata.ocr,
    ruatPhoto: { fields: { ...segunda.metadata.ocr.ruatPhoto.fields,
      vehicleOwnerName: 'Otra Persona', vehicleOwnerCi: '87654321' } }
  } };
  await segunda.update({ metadata: { ...documentosValidos, ocr: { ...documentosValidos.ocr,
    soatPhoto: { fields: { ...documentosValidos.ocr.soatPhoto.fields, soatUse: 'PARTICULAR' } }
  } } });
  const documentosInvalidos = await aprobar(segunda.id);
  comprobar.equal(documentosInvalidos.codigo, 400);
  comprobar.deepEqual(documentosInvalidos.datos.detalles, [
    'SOAT: el uso debe ser PUBLICO.'
  ]);
  comprobar.ok(documentosInvalidos.datos.detalles.every(detalle => documentosInvalidos.datos.error.includes(detalle)));
  comprobar.equal(await Conductor.count({ where: { userId: pasajero } }), 0);
  for (const cara of ['licenseFront', 'licenseBack']) {
    await segunda.update({ metadata: { ...documentosValidos, ocr: { ...documentosValidos.ocr,
      [cara]: { fields: { ...documentosValidos.ocr[cara].fields, issueDate: '2099-01-01' } }
    } } });
    const emisionFutura = await aprobar(segunda.id);
    comprobar.equal(emisionFutura.codigo, 400);
    comprobar.deepEqual(emisionFutura.datos.detalles, ['Licencia: la fecha de emisión no puede ser futura.']);
    comprobar.equal(await Conductor.count({ where: { userId: pasajero } }), 0);
  }
  await segunda.update({ metadata: documentosValidos });
  comprobar.equal((await aprobar(segunda.id)).codigo, 409, 'Sin evaluación no debe crearse el conductor');
  const revisada = await fetch(`http://127.0.0.1:${server.address().port}/administracion/solicitudes/${segunda.id}/documentos/aprobar`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ verifiedDocuments: tipos })
  });
  comprobar.equal(revisada.status, 200, JSON.stringify(await revisada.json()));
  comprobar.equal((await fetch(datosUrl,{headers:headersCorreccion})).status,409,'No se edita una versión anterior');
  comprobar.equal((await fetch(datosUrl.replace(primera.id,segunda.id),{headers:headersCorreccion})).status,409,'No se edita un documento aprobado');
  const documentosGuardados = await SolicitudArchivo.findAll({ where: { requestId: segunda.id } });
  comprobar.ok(tipos.every(tipo => documentosGuardados.some(archivo => archivo.fileType === tipo && archivo.status === 'verificado')));
  comprobar.equal((await segunda.reload()).status, 'pendiente');
  comprobar.equal(await Conductor.count({ where: { userId: pasajero } }), 0);
  // Simular una instalación anterior y aplicar la migración sin perder registros.
  await db.query('ALTER TABLE public.evaluacion_psicologica ALTER COLUMN programada_en SET NOT NULL', { esquemaFisico: true });
  await require('../../../migrations/20261109-informes-sin-programacion').up(db);
  const enviarInforme = async (resultado, pdf = '%PDF-1.4\n%%EOF') => {
    const form = new FormData();
    form.set('resultado', resultado);
    form.set('informe', new Blob([pdf], { type: 'application/pdf' }), 'informe.pdf');
    return fetch(`http://127.0.0.1:${server.address().port}/administracion/solicitudes/${segunda.id}/informes-psicologicos`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
    });
  };
  comprobar.equal((await enviarInforme('apto', 'archivo que no es PDF')).status, 400);
  comprobar.equal((await enviarInforme('no_apto')).status, 201);
  const noApto = await aprobar(segunda.id);
  comprobar.equal(noApto.codigo, 409);
  comprobar.match(noApto.datos.error, /evaluación psicológica apta y vigente/);
  const informe = await enviarInforme('apto');
  comprobar.equal(informe.status, 201, JSON.stringify(await informe.json()));
  const repoInformes = require('../documentosRepositorio');
  const evaluaciones = await repoInformes.select('SELECT * FROM public.evaluacion_psicologica WHERE id_solicitud_conductor=:id ORDER BY creado_en DESC', {id:segunda.id});
  comprobar.equal(evaluaciones.length, 2);
  const detallesInformes = await repoInformes.select(`SELECT numero_informe,fecha_emision,valida_hasta
    FROM public.documento_informe_psicologico WHERE id_documento_informe_psicologico IN (:ids)`, {
    ids: evaluaciones.map(e => e.id_documento_informe)
  });
  comprobar.ok(detallesInformes.every(i => i.numero_informe === null && i.fecha_emision === null && i.valida_hasta === null));
  comprobar.ok(evaluaciones.every(e => e.programada_en === null && e.estado === 'realizada'));
  const historial = await fetch(`http://127.0.0.1:${server.address().port}/administracion/solicitudes/${segunda.id}/evaluaciones`, {
    headers: {Authorization:`Bearer ${token}`}
  });
  comprobar.equal(historial.status, 200);
  comprobar.equal((await historial.json()).length, 2);
  const pdf = await fetch(`http://127.0.0.1:${server.address().port}/administracion/solicitudes/${segunda.id}/evaluaciones/${evaluaciones[0].id_evaluacion_psicologica}/informe`, {
    headers: {Authorization:`Bearer ${token}`}
  });
  comprobar.equal(pdf.status, 200);
  comprobar.match(await pdf.text(), /^%PDF-/);
  // Forzar un error después de crear el conductor para comprobar el rollback.
  const vehiculoExistente = await Vehiculo.findOne({ where: { driver_id: cercanoConductor } });
  const metadatos = segunda.metadata;
  await segunda.update({ metadata: { ...metadatos, ocr: { ...metadatos.ocr,
    ruatPhoto: { fields: { ...metadatos.ocr.ruatPhoto.fields, vehiclePlate: vehiculoExistente.plate } }
  } } });
  const fallida = await aprobar(segunda.id);
  comprobar.equal(fallida.codigo, 500, JSON.stringify(fallida.datos));
  comprobar.equal(await Conductor.count({ where: { userId: pasajero } }), 0);
  await segunda.reload();
  comprobar.equal(segunda.status, 'pendiente');
  const frontal = await SolicitudArchivo.findOne({ where: { requestId: segunda.id, fileType: 'carFront' } });
  comprobar.equal(frontal.status, 'verificado');
  await segunda.update({ metadata: metadatos });
  const aprobaciones = await Promise.all([aprobar(segunda.id), aprobar(segunda.id)]);
  comprobar.deepEqual(aprobaciones.map(r => r.codigo).sort(), [200, 409]);
  const conductor = await Conductor.findOne({ where: { userId: pasajero } });
  comprobar.equal(conductor.status, 'aprobado');
  comprobar.equal(await Conductor.count({ where: { userId: pasajero } }), 1);
  comprobar.equal(await Vehiculo.count({ where: { driver_id: conductor.id } }), 1);
  await segunda.reload();
  comprobar.equal(segunda.status, 'aprobado');
  comprobar.equal(ConductorSolicitud.rawAttributes.driverId, undefined);
  const [columnas] = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='solicitud_conductor'", { esquemaFisico: true });
  comprobar.equal(columnas.some(c => c.column_name === 'id_conductor'), false);
  const listado = respuesta();
  await require('../../controllers/adminControlador').obtenerTodosConductores({ query: { userId: pasajero } }, listado);
  comprobar.equal(listado.codigo, 200);
  comprobar.equal(listado.datos.requests[0].driver.id, conductor.id);
  comprobar.equal(listado.datos.requests[0].vehicle.id, (await Vehiculo.findOne({ where: { driver_id: conductor.id } })).id);
});

baseDatosTest('ambas rutas de registro validan la solicitud sin crear perfiles pendientes', async t => {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  await require('../../models/UsuarioIdentidad').create({ userId: pasajero, firstNames: 'Ana',
    ciNumber: '12345678', birthDate: '1995-01-01', verificationStatus: 'verificado' });
  const app = express();
  app.use(express.json());
  app.use('/solicitudes', require('../../routes/solicitudes'));
  app.use('/conductores', require('../../routes/conductores'));
  const servidor = await new Promise(resolve => {
    const servidor = app.listen(0, '127.0.0.1', () => resolve(servidor));
  });
  t.after(() => new Promise(resolve => { servidor.closeAllConnections(); servidor.close(resolve); }));
  const token = jwt.sign({ id: pasajero }, process.env.JWT_SECRET || 'secret');
  for (const ruta of ['/solicitudes/registrar', '/conductores/registrar']) {
    const resultado = await fetch(`http://127.0.0.1:${servidor.address().port}${ruta}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}'
    });
    comprobar.equal(resultado.status, 422, JSON.stringify(await resultado.json()));
  }
  comprobar.equal(await require('../../models/Conductor').count({ where: { userId: pasajero } }), 0);
  comprobar.equal(await require('../../models/ConductorSolicitud').count({ where: { userId: pasajero } }), 0);
});

baseDatosTest('calificaciones normalizadas obtienen participantes y promedios desde el viaje', async () => {
  const { Conductor, Calificacion } = require('../../models');
  const controlador = require('../../controllers/ratingsControlador');
  const respuesta = () => ({ status(codigo) { this.codigo = codigo; return this; }, json(datos) { this.datos = datos; return this; } });
  const viaje = await servicio.reservar(pasajero, entrada());
  const conductor = await Conductor.findByPk(viaje.driverId);
  const crear = async (usuario, tipo, valor) => {
    const resultado = respuesta();
    await controlador.crearCalificacion({ user: { id: usuario }, body: {
      rideId: viaje.id, raterType: tipo, rating: valor,
      // Los identificadores enviados por el cliente no determinan los participantes.
      driverId: lejanoConductor, passengerId: segundoPasajero
    } }, resultado);
    return resultado;
  };
  comprobar.equal((await crear(pasajero, 'pasajero', 4)).codigo, 400);
  await viaje.update({ status: 'completado' });
  comprobar.equal((await crear(segundoPasajero, 'pasajero', 4)).codigo, 403);
  comprobar.equal((await crear(pasajero, 'conductor', 4)).codigo, 403);
  const primera = await crear(pasajero, 'pasajero', 4);
  comprobar.equal(primera.codigo, 201);
  comprobar.equal(primera.datos.rating.driverId, conductor.id);
  comprobar.equal(primera.datos.rating.passengerId, pasajero);
  comprobar.equal((await crear(pasajero, 'pasajero', 3)).codigo, 409);
  comprobar.equal((await crear(conductor.userId, 'conductor', 2)).codigo, 201);
  comprobar.equal(await Calificacion.count(), 2);
  comprobar.equal(Calificacion.rawAttributes.driverId, undefined);
  comprobar.equal(Calificacion.rawAttributes.passengerId, undefined);
  const [columnas] = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='calificacion'", { esquemaFisico: true });
  comprobar.equal(columnas.some(c => ['id_conductor', 'id_pasajero'].includes(c.column_name)), false);

  const listado = respuesta();
  await controlador.obtenerCalificacionesConductor({ params: { driverId: conductor.id }, query: {} }, listado);
  comprobar.equal(listado.codigo, 200);
  comprobar.equal(listado.datos.total, 1);
  comprobar.equal(listado.datos.ratings[0].passengerId, pasajero);
  comprobar.equal(listado.datos.ratings[0].rating, 4);
  const promedio = respuesta();
  await controlador.obtenerPromedioCalificacionesConductor({ params: { driverId: conductor.id } }, promedio);
  comprobar.equal(promedio.datos.averageRating, 4.5);
  comprobar.equal(promedio.datos.totalRatings, 1);
  const mia = respuesta();
  await controlador.obtenerMiCalificacion({ user: { id: pasajero } }, mia);
  comprobar.equal(mia.datos.passengerRating, 3.5);
  const suya = respuesta();
  await controlador.obtenerMiCalificacion({ user: { id: conductor.userId } }, suya);
  comprobar.equal(suya.datos.driverRating, 4.5);
  const existente = respuesta();
  await controlador.comprobarCalificacionExistente({ params: { rideId: viaje.id } }, existente);
  comprobar.equal(existente.datos.exists, true);
  comprobar.equal(existente.datos.rating.driverId, conductor.id);
});

baseDatosTest('registra alertas para la central y envía un SMS por contacto sin duplicar avisos', async (t) => {
  const { registrarEmergenciaViaje, listarEmergencias } = require('../../controllers/emergenciaViajeControlador');
  const { agregarContacto } = require('../../controllers/contactosEmergenciaControlador');
  const { Conductor } = require('../../models');
  const viaje = await servicio.reservar(pasajero, entrada());
  const conductor = await Conductor.findByPk(viaje.driverId);
  const configuracion = { TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32), TWILIO_AUTH_TOKEN: 'prueba', TWILIO_SMS_FROM: '+15550100001' };
  for (const [clave, valor] of Object.entries(configuracion)) {
    const anterior = process.env[clave];
    process.env[clave] = valor;
    t.after(() => { if (anterior === undefined) delete process.env[clave]; else process.env[clave] = anterior; });
  }
  const envios = t.mock.method(globalThis, 'fetch', async (_url, opciones) => {
    comprobar.equal(opciones.body.get('To'), '+15550100002');
    comprobar.match(opciones.body.get('Body'), /maps\.google\.com/);
    return { ok: true, json: async () => ({ sid: 'SM' + '2'.repeat(32), status: 'queued' }) };
  });
  const respuestaContacto = { status(codigo) { this.codigo = codigo; return this; }, json(datos) { this.datos = datos; } };
  await agregarContacto({ user: { id: pasajero }, body: { nombre: 'Ana', telefono: '+15550100002' } }, respuestaContacto);
  comprobar.equal(respuestaContacto.codigo, 201);
  async function registrar(id, body = {}) {
    const respuesta = { status(codigo) { this.codigo = codigo; return this; }, json(datos) { this.datos = datos; } };
    await registrarEmergenciaViaje({ user: { id }, params: { rideId: viaje.id }, body }, respuesta);
    return respuesta;
  }
  comprobar.equal((await registrar(pasajero)).codigo, 409);
  await viaje.update({ status: 'aceptado' });
  comprobar.equal((await registrar(pasajero)).codigo, 409);
  await viaje.update({ status: 'en_curso' });
  comprobar.equal((await registrar(segundoPasajero)).codigo, 404);
  const ubicacion = { latitud: -16.5, longitud: -68.15 };
  const primera = await registrar(pasajero, ubicacion);
  comprobar.equal(primera.codigo, 201);
  comprobar.equal(primera.datos.registradaEnCentral, true);
  comprobar.deepEqual(primera.datos.contactos, { total: 1, aceptados: 1, fallidos: 0 });
  comprobar.deepEqual((await registrar(pasajero, ubicacion)).datos, primera.datos);
  comprobar.equal(envios.mock.callCount(), 1);
  comprobar.equal((await registrar(conductor.userId)).codigo, 201);
  const [alertas] = await db.query(`SELECT id_usuario, ST_X(ubicacion) AS longitud FROM public.alerta_emergencia
    WHERE id_viaje = :id`, { esquemaFisico: true, replacements: { id: viaje.id } });
  comprobar.equal(alertas.length, 2);
  comprobar.equal(alertas.find(alerta => alerta.id_usuario === pasajero).longitud, -68.15);
  comprobar.equal(alertas.find(alerta => alerta.id_usuario === conductor.userId).longitud, null);
  const central = { json(datos) { this.datos = datos; } };
  await listarEmergencias({}, central);
  comprobar.ok(central.datos.alertas.some(alerta => alerta.idAlerta === primera.datos.idAlerta));
});

baseDatosTest('el detalle del viaje devuelve los nombres de ambos participantes', async () => {
  const { Conductor, UsuarioIdentidad } = require('../../models');
  const { obtenerViajePorId } = require('../../controllers/viajeControlador');
  const conductor = await Conductor.findByPk(cercanoConductor);
  await UsuarioIdentidad.bulkCreate([
    { userId: pasajero, firstNames: 'Ana', paternalSurname: 'Paz', ciNumber: '12345678', birthDate: '1995-01-01' },
    { userId: conductor.userId, firstNames: 'Luis', paternalSurname: 'Vargas', maternalSurname: 'Rojas', ciNumber: '87654321', birthDate: '1990-01-01' }
  ]);
  const viaje = await servicio.reservar(pasajero, entrada());
  const respuesta = { status(codigo) { this.codigo = codigo; return this; }, json(datos) { this.datos = datos; } };
  await obtenerViajePorId({ params: { id: viaje.id }, user: { id: pasajero } }, respuesta);
  comprobar.equal(respuesta.codigo, 200);
  comprobar.equal(respuesta.datos.passenger.name, 'Ana Paz');
  comprobar.equal(respuesta.datos.driver.User.name, 'Luis Vargas Rojas');
});

baseDatosTest('publica contraofertas nuevas y actualizadas y retira la solicitud al cancelar', async () => {
  const controlador = require('../../controllers/viajeControlador');
  const { Conductor, UsuarioIdentidad } = require('../../models');
  const conductor = await Conductor.findByPk(cercanoConductor);
  await UsuarioIdentidad.create({
    userId: pasajero, firstNames: 'Ana', paternalSurname: 'Paz', ciNumber: '12345678', birthDate: '1995-01-01'
  });
  const viaje = await Viaje.create({
    passengerId: pasajero, pickupLocation: { type: 'Point', coordinates: [-68.15, -16.5] },
    dropoffLocation: { type: 'Point', coordinates: [-68.15, -16.52] },
    pickup_address: 'Recogida', dropoff_address: 'Destino', totalFare: 14, finalFare: 14,
    distance: 1000, duration: 300
  });
  async function llamar(accion, usuario, body = {}) {
    const respuesta = { codigo: 200, status(codigo) { this.codigo = codigo; return this; }, json(datos) { this.datos = datos; return this; } };
    await accion({ user: { id: usuario }, params: { rideId: viaje.id }, body }, respuesta);
    return respuesta;
  }
  const solicitudes = await llamar(controlador.obtenerSolicitudesViaje, conductor.userId);
  comprobar.equal(solicitudes.codigo, 200);
  comprobar.equal(solicitudes.datos.find(solicitud => solicitud.rideId === viaje.id)?.passengerName, 'Ana Paz');
  const nueva = await llamar(controlador.enviarContraoferta, conductor.userId, { proposedPrice: 16 });
  comprobar.equal(nueva.codigo, 201, JSON.stringify(nueva.datos));
  const actualizada = await llamar(controlador.enviarContraoferta, conductor.userId, { proposedPrice: 17 });
  comprobar.equal(actualizada.codigo, 200, JSON.stringify(actualizada.datos));
  comprobar.deepEqual(eventosSocket.filter(e => e.evento === 'offer:new' && e.canal === 'user:' + pasajero)
    .map(e => e.datos.offer.proposedPrice), [16, 17]);
  const consulta = await llamar(controlador.obtenerContraofertas, pasajero);
  comprobar.equal(consulta.datos.offers[0].proposedPrice, 17);
  const cancelacion = await llamar(controlador.cancelarViaje, pasajero, { cancelledBy: 'pasajero' });
  comprobar.equal(cancelacion.codigo, 200, JSON.stringify(cancelacion.datos));
  comprobar.ok(eventosSocket.some(e => e.evento === 'ride:request:cancelled' && e.datos.rideId === viaje.id));
  comprobar.deepEqual((await llamar(controlador.obtenerContraofertas, pasajero)).datos.offers, []);
});

baseDatosTest('conecta a un conductor que todavía no tiene ubicación registrada', async () => {
  const { Conductor, ConductorUbicacion } = require('../../models');
  const { registrarUbicacionHandlers } = require('../../socket/handlers/ubicacionHandlers');
  const conductor = await Conductor.findByPk(cercanoConductor);
  await ConductorUbicacion.destroy({ where: { driver_id: conductor.id } });
  const eventos = new Map();
  const canales = new Set();
  registrarUbicacionHandlers({}, {
    user: { id: conductor.userId },
    on: (evento, callback) => eventos.set(evento, callback),
    join: canal => canales.add(canal)
  });
  const conectar = datos => new Promise(resolve => eventos.get('driver:go_online')(datos, resolve));
  comprobar.deepEqual(await conectar({ latitude: -16.5, longitude: -68.15 }), { ok: true });
  comprobar.deepEqual(await conectar({}), { ok: true });
  comprobar.ok(canales.has('drivers:available'));
  const [[ubicacion]] = await db.query(`SELECT conectado, ST_X(ubicacion) AS longitud, ST_Y(ubicacion) AS latitud
    FROM public.ubicacion_conductor WHERE id_conductor = :id`, {
    esquemaFisico: true, replacements: { id: conductor.id }
  });
  comprobar.deepEqual(ubicacion, { conectado: true, longitud: -68.15, latitud: -16.5 });
});

baseDatosTest('crea y verifica la identidad a través de las vistas de compatibilidad', async () => {
  const UsuarioIdentidad = require('../../models/UsuarioIdentidad');
  await db.transaction(async transaction => {
    const identidad = await UsuarioIdentidad.create({
      userId: pasajero, firstNames: 'Ana', ciNumber: '12345678',
      birthDate: '1995-01-01', verificationStatus: 'verificado'
    }, { transaction });
    await require('../documentosRepositorio').createDocument({id_documento:aleatorioUUID(),userId:pasajero,tipo_documento:'profilePhoto',ruta_archivo:'encrypted-identity:prueba',estado_verificacion:'verificado'},transaction);
    comprobar.equal((await UsuarioIdentidad.findByPk(identidad.id, { transaction })).verificationStatus, 'verificado');
  });
});

baseDatosTest('el envío HTTP recorta ambas caras de la licencia una sola vez, igual que el CI', async t => {
  const { UsuarioIdentidad, ConductorSolicitud, SolicitudArchivo } = require('../../models');
  const sharp = require('sharp');
  const fs = require('fs/promises');
  const path = require('path');
  await UsuarioIdentidad.create({ userId: pasajero, firstNames: 'Ana', paternalSurname: 'Paz',
    ciNumber: '12345678', birthDate: '1995-01-01', verificationStatus: 'verificado' });
  const inmediato = global.setImmediate;
  t.mock.method(global, 'setImmediate', (fn, ...args) =>
    fn.toString().includes('procesarConductorSolicitudOcr') ? undefined : inmediato(fn, ...args));
  const app = require('express')();
  app.use('/solicitudes', require('../../routes/solicitudes'));
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const imagen = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#c82850' } }).png().toBuffer();
  const recorte = { x: 50, y: 60, w: 100, h: 80, screenW: 200, screenH: 200 };
  const formulario = new FormData();
  formulario.set('domicileAddress', 'Avenida de prueba 123');
  formulario.set('domicileLatitude', '-16.5');
  formulario.set('domicileLongitude', '-68.15');
  const tipos = ['licenseFront', 'licenseBack', 'ticPhoto', 'antecedentsPhoto', 'ruatPhoto', 'soatPhoto', 'carFront', 'carBack', 'domicileProof'];
  for (const tipo of tipos) {
    formulario.set(tipo + 'Origen', 'captura_camara');
    formulario.set(tipo, new Blob([imagen], { type: 'image/png' }), tipo + '.png');
    if (tipo.startsWith('license')) for (const [clave, valor] of Object.entries(recorte)) {
      formulario.set(tipo + 'Crop' + clave[0].toUpperCase() + clave.slice(1), String(valor));
    }
  }
  const token = require('jsonwebtoken').sign({ id: pasajero }, process.env.JWT_SECRET || 'secret');
  const resultado = await fetch(`http://127.0.0.1:${server.address().port}/solicitudes/registrar`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formulario
  });
  comprobar.equal(resultado.status, 201, JSON.stringify(await resultado.json()));
  const solicitud = await ConductorSolicitud.findOne({ where: { userId: pasajero } });
  const archivos = await SolicitudArchivo.findAll({ where: { requestId: solicitud.id } });
  const directorio = path.resolve(__dirname, '../../uploads/drivers');
  t.after(async () => {
    for (const archivo of archivos) await fs.unlink(path.join(directorio, archivo.filename));
  });
  const ci = await require('../documentoRecorte').prepararDocumentoImagen(imagen, recorte);
  const esperado = await sharp(ci).metadata();
  for (const tipo of ['licenseFront', 'licenseBack']) {
    const archivo = archivos.find(archivo => archivo.fileType === tipo);
    const guardada = await sharp(await fs.readFile(path.join(directorio, archivo.filename))).metadata();
    comprobar.equal(guardada.width, esperado.width);
    comprobar.equal(guardada.height, esperado.height);
  }
});

baseDatosTest('comparte solo el PDF de todos los pendientes de psicología sin duplicados ni límite de pantalla', async t => {
  const repo = require('../documentosRepositorio');
  const usuarios = Array.from({ length: 58 }, (_, i) => ({ id: aleatorioUUID(), solicitud: aleatorioUUID(),
    telefono: `001234${String(i).padStart(4, '0')}`, correo: `contacto${i}@ejemplo.invalid` }));
  await repo.query(`INSERT INTO public.usuario(id_usuario,firebase_uid,telefono,correo)
    SELECT id,id::text,telefono,correo FROM jsonb_to_recordset(CAST(:datos AS jsonb)) AS x(id uuid,telefono text,correo text)`,
    { datos: JSON.stringify(usuarios) });
  await repo.query(`INSERT INTO public.solicitud_conductor(id_solicitud_conductor,id_usuario,version,estado)
    SELECT solicitud,id,1,'pendiente' FROM jsonb_to_recordset(CAST(:datos AS jsonb)) AS x(id uuid,solicitud uuid)`,
    { datos: JSON.stringify(usuarios) });
  const tipos = ['licenseFront','licenseBack','ticPhoto','antecedentsPhoto','ruatPhoto','soatPhoto','carFront','carBack','domicileProof'];
  const documentos = usuarios.flatMap(usuario => tipos.map(tipo => ({ id: aleatorioUUID(), solicitud: usuario.solicitud, tipo })));
  await repo.query(`INSERT INTO public.documento(id_documento,tipo_documento,estado_verificacion,verificado_en)
    SELECT id,tipo,'verificado',NOW() FROM jsonb_to_recordset(CAST(:datos AS jsonb)) AS x(id uuid,tipo text)`,
    { datos: JSON.stringify(documentos) });
  await repo.query(`INSERT INTO public.solicitud_documento(id_documento,id_solicitud_conductor)
    SELECT id,solicitud FROM jsonb_to_recordset(CAST(:datos AS jsonb)) AS x(id uuid,solicitud uuid)`,
    { datos: JSON.stringify(documentos) });
  await repo.update('solicitud_conductor','id_solicitud_conductor',usuarios[0].solicitud,{estado:'rechazado'});
  await repo.insert('solicitud_conductor',{id_usuario:usuarios[1].id,version:2,estado:'pendiente'});
  const informe = await repo.createDocument({ requestId: usuarios[2].solicitud, tipo_documento:'psychologicalReport', ruta_archivo:'informe-prueba.pdf' });
  await repo.insert('documento_informe_psicologico',{id_documento_informe_psicologico:informe,resultado:'no_apto',fecha_emision:'2026-01-01'});
  await repo.insert('evaluacion_psicologica',{id_solicitud_conductor:usuarios[2].solicitud,id_usuario_evaluador:segundoPasajero,
    estado:'realizada',realizada_en:new Date(),id_documento_informe:informe});
  await require('../../models/UsuarioIdentidad').create({userId:usuarios[3].id,firstNames:'María Elena',paternalSurname:'Pérez',
    ciNumber:'001234567',birthDate:'1990-01-01',verificationStatus:'verificado'});
  const lista = require('../listaPsicologiaServicio');
  const contactos = await lista.obtenerPendientesPsicologia();
  comprobar.equal(contactos.length,55);
  comprobar.equal(new Set(contactos.map(contacto => contacto.id_solicitud_conductor)).size,55);
  comprobar.ok(contactos.every(contacto => !usuarios.slice(0,3).some(usuario => usuario.solicitud === contacto.id_solicitud_conductor)));
  const app = require('express')();
  app.use('/administracion',require('../../routes/administracion'));
  const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const token = require('jsonwebtoken').sign({id:segundoPasajero,role:'administrador'},process.env.JWT_SECRET||'secret');
  const url=`http://127.0.0.1:${server.address().port}/administracion/psicologia/pendientes.pdf`;
  const headers={Authorization:`Bearer ${token}`};
  comprobar.equal((await fetch(url)).status,401);
  const usuarioToken=require('jsonwebtoken').sign({id:pasajero,role:'pasajero'},process.env.JWT_SECRET||'secret');
  comprobar.equal((await fetch(url,{headers:{Authorization:`Bearer ${usuarioToken}`}})).status,403);
  const contacto=contactos.find(contacto=>contacto.correo==='contacto3@ejemplo.invalid');
  comprobar.equal(contacto.nombre,'María Elena Pérez');
  comprobar.equal(contacto.ci,'001234567');
  comprobar.equal(contacto.telefono,usuarios[3].telefono);
  comprobar.equal((await fetch(url.replace('pendientes.pdf','pendientes/exportar')+'?formato=xlsx',{headers})).status,404);
  const pdf=await fetch(url,{headers});
  comprobar.equal(pdf.status,200);
  comprobar.match(pdf.headers.get('content-type'),/application\/pdf/);
  comprobar.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
});

baseDatosTest('la reserva rápida responde con conductor.id y carga sus relaciones', async (t) => {
  const repo = require('../documentosRepositorio');
  const originalSelect = repo.select;
  const consultasLicencia = [];
  t.mock.method(repo, 'select', async (sql, ...argumentos) => {
    if (sql.includes('public.documento_licencia')) consultasLicencia.push(sql);
    return originalSelect(sql, ...argumentos);
  });
  const { Conductor, Vehiculo } = require('../../models');
  const conductor = await Conductor.findByPk(cercanoConductor, {
    include: [{ model: Vehiculo, as: 'vehicles' }]
  });
  comprobar.equal(conductor.id, cercanoConductor);
  comprobar.equal(Object.hasOwn(conductor.toJSON(), 'idConductor'), false);
  comprobar.equal(conductor.vehicles.length, 1);
  const res = {
    code: 200,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await require('../../controllers/rapidaAsignacionControlador').reservar({
    user: { id: pasajero }, body: entrada()
  }, res);
  comprobar.equal(res.code, 200);
  comprobar.equal(res.body.ride.driverId, cercanoConductor);
  comprobar.ok(res.body.ride.vehicle);
  comprobar.equal(consultasLicencia.length, 0);
});

baseDatosTest('la zona conserva el atributo id al consultar las columnas renombradas', async () => {
  const id = aleatorioUUID();
  await db.query(`INSERT INTO public.zona_servicio (id_zona_servicio, nombre, limite)
    VALUES (:id, 'Prueba', ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))',4326))`, {
    esquemaFisico: true, replacements: { id }
  });
  const [[zona]] = await db.query('SELECT * FROM get_service_area(ST_SetSRID(ST_MakePoint(0.5,0.5),4326))');
  comprobar.equal(zona.id, id);
});

baseDatosTest('el recorrido se guarda en el viaje con la clave física id_viaje', async () => {
  const viaje = await servicio.reservar(pasajero, entrada());
  await Viaje.update({ status: 'en_curso' }, { where: { id: viaje.id } });
  const { registrarPunto } = require('../rutaRecorrida');
  const ViajeParada = require('../../models/ViajeParada');
  const primera = await ViajeParada.create({
    ride_id: viaje.id, sequence: 1, address: 'Primera parada',
    location: { type: 'Point', coordinates: [-68.15, -16.5] }
  });
  const segunda = await ViajeParada.create({
    ride_id: viaje.id, sequence: 2, address: 'Segunda parada',
    location: { type: 'Point', coordinates: [-68.15, -16.51] }
  });
  // Pasar primero por la segunda no permite saltarse la primera.
  await registrarPunto(viaje.id, viaje.driverId, -16.51, -68.15);
  comprobar.equal((await segunda.reload()).arrived_at, null);
  await registrarPunto(viaje.id, viaje.driverId, -16.5, -68.15);
  comprobar.ok((await primera.reload()).arrived_at);
  await registrarPunto(viaje.id, viaje.driverId, -16.51, -68.15);
  comprobar.ok((await segunda.reload()).arrived_at);
  const [[fila]] = await db.query(`SELECT ST_NPoints(ruta_recorrida) AS puntos
    FROM public.viaje WHERE id_viaje = :id`, {
    esquemaFisico: true, replacements: { id: viaje.id }
  });
  comprobar.equal(fila.puntos, 4);
});

baseDatosTest(
  'selecciona al más cercano, calcula en servidor y repite sin duplicar',
  async () => {
    const solicitud = entrada();
    const viaje = await servicio.reservar(pasajero, solicitud);
    comprobar.equal(viaje.driverId, cercanoConductor);
    comprobar.equal(viaje.status, 'solicitado');
    comprobar.equal(viaje.distance, 2000);
    comprobar.equal(viaje.pickupSurcharge, undefined);
    comprobar.equal(viaje.discountAmount, undefined);
    comprobar.equal(Number(viaje.finalFare), Number(viaje.totalFare));
    comprobar.ok(new Date(viaje.expiresAt) - Date.now() <= 20000);
    comprobar.equal((await servicio.reservar(pasajero, solicitud)).id, viaje.id);
    comprobar.equal(await Viaje.count(), 1);
  }
);
baseDatosTest(
  'descarta ubicación antigua, desconectados, vehículos incompatibles y más de 3 km',
  async () => {
    await db.query(
      "UPDATE ubicacion_conductor SET location_recorded_at = NOW() - INTERVAL '2 minutes' WHERE driver_id = :id",
      { replacements: { id: cercanoConductor } }
    );
    comprobar.equal(
      (await servicio.reservar(pasajero, entrada())).driverId,
      lejanoConductor
    );
    await db.query(
      "UPDATE viaje SET status = 'vencido'; UPDATE ubicacion_conductor SET is_online = false"
    );
    await comprobar.rejects(
      servicio.reservar(segundoPasajero, entrada(), undefined, { searchWindowMs: 0 }),
      (error) => error.code === 'NO_DRIVERS'
    );
    await db.query(
      "UPDATE ubicacion_conductor SET is_online = true, location_recorded_at = NOW(), location = ST_SetSRID(ST_MakePoint(-68.15,-16.54),4326)"
    );
    await comprobar.rejects(
      servicio.reservar(segundoPasajero, entrada(), undefined, { searchWindowMs: 0 }),
      (error) => error.code === 'NO_DRIVERS'
    );
    await db.query(
      "UPDATE ubicacion_conductor SET location = ST_SetSRID(ST_MakePoint(-68.15,-16.501),4326)"
    );
    await db.query("UPDATE public.documento_ruat SET tipo_vehiculo='motocicleta'", {esquemaFisico:true});
    await comprobar.rejects(
      servicio.reservar(segundoPasajero, entrada(), undefined, { searchWindowMs: 0 }),
      (error) => error.code === 'NO_DRIVERS'
    );
  }
);
baseDatosTest('espera brevemente y asigna apenas aparece un conductor', async () => {
  await db.query("UPDATE ubicacion_conductor SET is_online = false");
  const iniciado = Date.now();
  const reserva = servicio.reservar(pasajero, entrada(), undefined, {
    searchWindowMs: 1500,
    searchIntervalMs: 100
  });
  await new Promise((resolver) => setTimeout(resolver, 250));
  await db.query(
    "UPDATE ubicacion_conductor SET is_online = true, location_recorded_at = NOW() WHERE driver_id = :id",
    { replacements: { id: cercanoConductor } }
  );
  comprobar.equal((await reserva).driverId, cercanoConductor);
  comprobar.ok(Date.now() - iniciado < 1500);
});
baseDatosTest('termina la búsqueda al vencer el plazo sin conductores', async () => {
  await db.query("UPDATE ubicacion_conductor SET is_online = false");
  const iniciado = Date.now();
  await comprobar.rejects(
    servicio.reservar(pasajero, entrada(), undefined, {
      searchWindowMs: 250,
      searchIntervalMs: 50
    }),
    (error) => error.code === 'NO_DRIVERS'
  );
  comprobar.ok(Date.now() - iniciado >= 250);
});
baseDatosTest('reservas concurrentes nunca comparten conductor', async () => {
  const resultados = await Promise.all([
  servicio.reservar(pasajero, entrada()),
  servicio.reservar(segundoPasajero, entrada())]
  );
  comprobar.notEqual(resultados[0].driverId, resultados[1].driverId);
});
baseDatosTest(
  'un solo conductor, dos pasajeros concurrentes: solo uno obtiene reserva',
  async () => {
    await db.query(
      "UPDATE ubicacion_conductor SET is_online = false WHERE driver_id = :id",
      { replacements: { id: lejanoConductor } }
    );
    const resultados = await Promise.allSettled([
    servicio.reservar(pasajero, entrada(), undefined, { searchWindowMs: 0 }),
    servicio.reservar(segundoPasajero, entrada(), undefined, { searchWindowMs: 0 })]
    );
    comprobar.equal(
      resultados.filter((resultado) => resultado.status === 'fulfilled').length,
      1
    );
  }
);
baseDatosTest(
  'reserva bloquea otras asignaciones y ofertas de negociación en BD',
  async () => {
    const reservado = await servicio.reservar(pasajero, entrada());
    const valores = {
      ...reservado.toJSON(),
      id: aleatorioUUID(),
      passengerId: segundoPasajero,
      requestMode: 'negociacion',
      requestKey: null,
      status: 'aceptado'
    };
    valores.pickupLocation = { type: 'Point', coordinates: [-68.15, -16.5] };
    valores.dropoffLocation = { type: 'Point', coordinates: [-68.15, -16.52] };
    await comprobar.rejects(
      Viaje.create(valores),
      (error) => error.original?.code === '23505'
    );
    valores.id = aleatorioUUID();
    valores.driverId = null;
    valores.status = 'solicitado';
    const negociacion = await Viaje.create(valores);
    await comprobar.rejects(
      db.query(
        `INSERT INTO oferta_viaje(id,ride_id,driver_id,offered_price,expires_at,status)
    VALUES (:id,:ride,:driver,20,NOW()+INTERVAL '1 minute','pendiente')`,
        {
          replacements: {
            id: aleatorioUUID(),
            ride: negociacion.id,
            driver: reservado.driverId
          }
        }
      ),
      (error) => error.original?.code === '23514'
    );
  }
);
baseDatosTest('rechaza ofertas sobre asignación rápida', async () => {
  const viaje = await servicio.reservar(pasajero, entrada());
  await comprobar.rejects(
    db.query(
      `INSERT INTO oferta_viaje(id,ride_id,driver_id,offered_price,expires_at,status)
    VALUES (:id,:ride,:driver,20,NOW()+INTERVAL '1 minute','pendiente')`,
      {
        replacements: { id: aleatorioUUID(), ride: viaje.id, driver: lejanoConductor }
      }
    ),
    (error) => error.original?.code === '23514'
  );
});
baseDatosTest('vencimiento y cancelación liberan sin revivir la reserva', async () => {
  const viaje = await servicio.reservar(pasajero, entrada());
  await viaje.update({ expiresAt: new Date(Date.now() - 1000) });
  comprobar.equal(
    (await servicio.finalizarReserva(pasajero, viaje.id, true)).status,
    'vencido'
  );
  comprobar.equal(await servicio.actual(pasajero), null);
  const siguiente = await servicio.reservar(pasajero, entrada());
  comprobar.equal(siguiente.driverId, cercanoConductor);
  comprobar.equal(
    (await servicio.finalizarReserva(pasajero, siguiente.id, false)).status,
    'cancelado'
  );
  comprobar.equal(
    (await servicio.finalizarReserva(pasajero, siguiente.id, true)).status,
    'cancelado'
  );
});
baseDatosTest(
  'solo el pasajero dueño puede confirmar; desconexión invalida la confirmación',
  async () => {
    const viaje = await servicio.reservar(pasajero, entrada());
    await comprobar.rejects(
      servicio.finalizarReserva(segundoPasajero, viaje.id, true),
      (error) => error.status === 403
    );
    const [[conductor]] = await db.query(
      "SELECT user_id FROM conductor WHERE id = :id",
      { replacements: { id: viaje.driverId } }
    );
    await comprobar.rejects(
      servicio.finalizarReserva(conductor.user_id, viaje.id, true),
      (error) => error.status === 403
    );
    comprobar.equal((await servicio.actual(conductor.user_id, true)).id, viaje.id);
    await db.query(
      "UPDATE ubicacion_conductor SET is_online = false WHERE driver_id = :id",
      { replacements: { id: viaje.driverId } }
    );
    comprobar.equal(
      (await servicio.finalizarReserva(pasajero, viaje.id, true)).status,
      'vencido'
    );
  }
);
baseDatosTest(
  'confirmación automática e idempotente; cancelar tarde no desasigna',
  async () => {
    const viaje = await servicio.reservar(pasajero, entrada());
    comprobar.equal(
      (await servicio.finalizarReserva(pasajero, viaje.id, true)).status,
      'aceptado'
    );
    comprobar.equal(
      (await servicio.finalizarReserva(pasajero, viaje.id, true)).status,
      'aceptado'
    );
    comprobar.equal(
      (await servicio.finalizarReserva(pasajero, viaje.id, false)).status,
      'aceptado'
    );
  }
);
baseDatosTest(
  'dos solicitudes simultáneas del mismo pasajero obtienen una sola reserva',
  async () => {
    const [primero, segundo] = await Promise.all([
    servicio.reservar(pasajero, entrada()),
    servicio.reservar(pasajero, entrada())]
    );
    comprobar.equal(primero.id, segundo.id);
    comprobar.equal(await Viaje.count(), 1);
  }
);
baseDatosTest(
  'confirmación y cancelación simultáneas producen un único resultado',
  async () => {
    const viaje = await servicio.reservar(pasajero, entrada());
    const [primero, segundo] = await Promise.all([
    servicio.finalizarReserva(pasajero, viaje.id, true),
    servicio.finalizarReserva(pasajero, viaje.id, false)]
    );
    comprobar.equal(primero.status, segundo.status);
    comprobar.ok(['aceptado', 'cancelado'].includes(primero.status));
  }
);
baseDatosTest(
  'fallar la ruta de recogida revierte todo y no bloquea al conductor',
  async () => {
    let llamadas = 0;
    require("../asignacionRouting").conduccionRuta = async () => {
      if (++llamadas === 2) throw new Error('routing unavailable');
      return { distance: 2000, duration: 240 };
    };
    await comprobar.rejects(servicio.reservar(pasajero, entrada()));
    comprobar.equal(await Viaje.count(), 0);
    require("../asignacionRouting").conduccionRuta = async () => ({
      distance: 2000,
      duration: 240
    });
    comprobar.equal(
      (await servicio.reservar(pasajero, entrada())).driverId,
      cercanoConductor
    );
  }
);
baseDatosTest('esquema nuevo sin columnas JSON ni propietarios redundantes en documento',async()=>{
  const repo=require('../documentosRepositorio');
  const json=await repo.select("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('json','jsonb')");
  comprobar.deepEqual(json,[]);
  const cols=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='documento'");
  for(const name of ['id_usuario','id_conductor','id_vehiculo','id_solicitud_conductor'])comprobar.equal(cols.some(c=>c.column_name===name),false);
  const old=await repo.select("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('identidad_usuario','domicilio_conductor','liquidacion_comision')");
  comprobar.deepEqual(old,[]);
});
baseDatosTest('auditoría escalar conserva INSERT, UPDATE y DELETE aunque desaparezca el registro',async()=>{
  const Audit=require('../../models/AuditRegistro'),repo=require('../documentosRepositorio');
  const id=aleatorioUUID();
  const inserted=await Audit.create({table_name:'prueba',record_id:id,action:'INSERCION',changed_by:segundoPasajero,new_values:{estado:'activo',observacion:'NULL'}});
  await Audit.create({table_name:'prueba',record_id:id,action:'ACTUALIZACION',changed_by:segundoPasajero,old_values:{eliminado_en:null},new_values:{eliminado_en:'2026-11-08T00:00:00Z'}});
  const deleted=await Audit.create({table_name:'prueba',record_id:id,action:'ELIMINACION',old_values:{estado:'activo'}});
  const rows=await repo.select('SELECT * FROM public.registro_auditoria_detalle WHERE id_registro_auditoria=:id',{id:inserted.id});
  comprobar.equal(rows.find(r=>r.nombre_campo==='estado').valor_anterior,null);
  comprobar.equal(rows.find(r=>r.nombre_campo==='observacion').valor_nuevo,'NULL');
  comprobar.equal((await repo.select('SELECT * FROM public.registro_auditoria_detalle WHERE id_registro_auditoria=:id',{id:deleted.id}))[0].valor_nuevo,null);
  await comprobar.rejects(Audit.create({table_name:'prueba',record_id:id,action:'INSERCION',new_values:{objeto:{x:1}}}),/escalar/);
  comprobar.equal(await Audit.count({where:{record_id:id}}),3);
});
baseDatosTest('comisión solo acepta el saldo mensual completo y una confirmación concurrente',async()=>{
  const {ComisionLiquidacion}=require('../../models');
  const PagoComision=require('../../models/PagoComision');
  const controller=require('../../controllers/comisionesAdminControlador');
  const row=await crearComisionConViajes(2);
  const response=()=>({codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;}});
  const pay=async amount=>{const res=response();await controller.registrarPago({params:{id:row.id},body:{amount,payment_method:'efectivo'},user:{id:segundoPasajero}},res);return res;};
  comprobar.equal((await pay(10)).codigo,400);
  comprobar.equal(await PagoComision.count(),0);
  await comprobar.rejects(PagoComision.create({commissionId:row.id,amount:10,method:'efectivo',status:'pendiente'}),/saldo mensual completo/);
  const results=await Promise.all([pay(20),pay(20)]);
  comprobar.deepEqual(results.map(r=>r.codigo).sort(),[200,409],JSON.stringify(results));
  comprobar.equal(await PagoComision.count({where:{commissionId:row.id,status:'confirmado'}}),1);
  comprobar.equal((await row.reload()).status,'pagado');
  const detail=response();await controller.detalle({params:{id:row.id}},detail);comprobar.equal(detail.codigo,200,JSON.stringify(detail.datos));comprobar.equal(detail.datos.historial.length,1);
});
baseDatosTest('notificación persiste un destino y reconstruye los datos de navegación',async()=>{
  const Notificacion=require('../../models/Notificacion');
  const viaje=await servicio.reservar(pasajero,entrada());
  const row=await Notificacion.create({user_id:pasajero,title:'Viaje',body:'Confirmado',type:'viaje_aceptado',data:{ride_id:viaje.id,action:'open_ride'}});
  await row.reload();comprobar.equal(row.rideId,viaje.id);comprobar.equal(row.data.ride_id,viaje.id);comprobar.equal(row.data.action,'open_ride');
});
baseDatosTest('comprobantes pendientes y rechazados no liquidan la deuda y conservan su documento',async()=>{
  const {ComisionLiquidacion,Conductor}=require('../../models');
  const PagoComision=require('../../models/PagoComision');
  const proof=require('../../controllers/comprobantesComisionControlador');
  const payment=require('../../controllers/comisionesAdminControlador');
  const driver=await Conductor.findByPk(cercanoConductor);
  const row=await crearComisionConViajes(1);
  const response=()=>({codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;}});
  const send=async()=>{const res=response();await proof.enviar({params:{id:row.id},body:{metodo:'qr',referencia:'REF1'},user:{id:driver.userId},conductorComisionesId:driver.id,file:{buffer:Buffer.from('%PDF-1.4\n%%EOF'),size:14,originalname:'pago.pdf'}},res);return res;};
  const first=await send();comprobar.equal(first.codigo,201,JSON.stringify(first.datos));
  comprobar.equal((await send()).codigo,409);
  comprobar.ok(['pendiente_pago','atrasado'].includes((await row.reload()).status));
  const last=(await proof.ultimosComprobantes([row.id])).get(row.id);
  comprobar.ok(last.documentId);comprobar.equal(proof.presentarComprobante(last,row.due_date,x=>new Date(x).toISOString().slice(0,10)).tipoArchivo,'application/pdf');
  const rejected=response();await proof.rechazar({params:{id:row.id,comprobanteId:first.datos.comprobanteId},body:{motivo:'No corresponde'},user:{id:segundoPasajero}},rejected);comprobar.equal(rejected.codigo,200);
  comprobar.ok(['pendiente_pago','atrasado'].includes((await row.reload()).status));
  const second=await send();comprobar.equal(second.codigo,201);
  const confirmed=response();await payment.registrarPago({params:{id:row.id},body:{amount:20,payment_method:'qr',comprobanteId:second.datos.comprobanteId},user:{id:segundoPasajero}},confirmed);comprobar.equal(confirmed.codigo,200,JSON.stringify(confirmed.datos));
  comprobar.equal(await PagoComision.count({where:{commissionId:row.id}}),2);
  comprobar.equal((await PagoComision.findByPk(first.datos.comprobanteId)).status,'rechazado');
});
baseDatosTest('renovar documentos conserva la versión anterior y no requiere otra solicitud',async()=>{
  const repo=require('../documentosRepositorio');const {Vehiculo}=require('../../models');const controller=require('../../controllers/documentosRenovacionControlador');
  const vehicle=await Vehiculo.findOne({where:{driver_id:cercanoConductor}});
  const old=await repo.createDocument({vehicleId:vehicle.id,tipo_documento:'carFront',ruta_archivo:'anterior.jpg',estado_verificacion:'verificado',vigente:true});
  const fresh=await repo.createDocument({vehicleId:vehicle.id,tipo_documento:'carFront',ruta_archivo:'nuevo.jpg',vigente:false});
  const res={codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;}};
  await controller.revisar({params:{documentId:fresh},body:{estado:'verificado'},user:{id:segundoPasajero}},res);
  comprobar.equal(res.codigo,200,JSON.stringify(res.datos));
  const rows=await repo.select('SELECT id_documento,vigente FROM public.documento WHERE id_documento IN (:old,:fresh)',{old,fresh});
  comprobar.equal(rows.length,2);comprobar.equal(rows.find(d=>d.id_documento===old).vigente,false);comprobar.equal(rows.find(d=>d.id_documento===fresh).vigente,true);
  comprobar.equal((await repo.select('SELECT 1 FROM public.solicitud_documento WHERE id_documento=:id',{id:fresh})).length,0);
  await comprobar.rejects(repo.insert('usuario_documento',{id_documento:fresh,id_usuario:pasajero}),/otro propietario/);
});
baseDatosTest('pago de viaje obtiene el pasajero desde viaje y permite consultar su historial',async()=>{
  const controller=require('../../controllers/pagoControlador'),repo=require('../documentosRepositorio');
  const viaje=await servicio.reservar(pasajero,entrada());
  const response=()=>({codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;},sendStatus(c){this.codigo=c;return this;}});
  const created=response();await controller.crearPago({user:{id:pasajero,role:'pasajero'},body:{ride_id:viaje.id,amount:10}},created);
  comprobar.equal(created.codigo,201,JSON.stringify(created.datos));
  const detail=response();await controller.obtenerPagoPorViaje({params:{rideId:viaje.id}},detail);
  comprobar.equal(detail.codigo,200,JSON.stringify(detail.datos));comprobar.equal(detail.datos.payment.passengerId,pasajero);
  const list=response();await controller.obtenerPagosPasajero({params:{passengerId:pasajero},query:{}},list);
  comprobar.equal(list.codigo,200,JSON.stringify(list.datos));comprobar.equal(list.datos.total,1);
  const columns=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='pago'");comprobar.equal(columns.some(c=>c.column_name==='id_pasajero'),false);
});
baseDatosTest('campos OCR faltantes se calculan sin tabla auxiliar y no se crea grabación de emergencia',async()=>{
  const repo=require('../documentosRepositorio');
  const {ConductorSolicitud}=require('../../models');
  const solicitud=await ConductorSolicitud.create({userId:pasajero,version:1,status:'pendiente'});
  const id=await repo.createDocument({requestId:solicitud.id,tipo_documento:'licenseFront',ruta_archivo:'licencia-test.jpg'});
  await repo.saveReading(id,'licenseFront',{fields:{licenseNumber:'12345678',fullName:'Ana Paz'},text:'Licencia',missing:['dato_obsoleto'],error:'Error técnico de prueba',rejected:true,rejectReason:'Rechazo automático de prueba'});
  const loaded=await require('../solicitudDocumentos').readMetadata(solicitud.id);
  comprobar.ok(loaded.metadata.ocr.licenseFront.missing.includes('licenseCategory'));
  comprobar.equal(loaded.metadata.ocr.licenseFront.missing.includes('licenseNumber'),false);
  comprobar.equal(loaded.metadata.ocr.licenseFront.missing.includes('dato_obsoleto'),false);
  const ocrGuardado=loaded.metadata.ocr.licenseFront;
  for(const key of ['error','rejected','rejectReason']) comprobar.equal(Object.hasOwn(ocrGuardado,key),false);
  const eliminadas=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='documento' AND column_name IN ('ocr_error','ocr_rechazado','ocr_motivo_rechazo')");
  comprobar.deepEqual(eliminadas,[]);
  await repo.update('documento','id_documento',id,{estado_verificacion:'rechazado',motivo_rechazo:'Imagen ilegible'});
  const [revisado]=await repo.select('SELECT estado_verificacion,motivo_rechazo,texto_ocr FROM public.documento WHERE id_documento=:id',{id});
  comprobar.equal(revisado.estado_verificacion,'rechazado');comprobar.equal(revisado.motivo_rechazo,'Imagen ilegible');comprobar.equal(revisado.texto_ocr,'Licencia');
  comprobar.deepEqual((await require('../solicitudDocumentos').readMetadata(solicitud.id)).rejected,['licenseFront']);
  const removed=await repo.select("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('documento_ocr_faltante','grabacion_emergencia')");
  comprobar.deepEqual(removed,[]);
});
baseDatosTest('las cinco duplicaciones no se almacenan y los datos SOAT se consultan desde el documento vigente',async()=>{
  const repo=require('../documentosRepositorio');const {Vehiculo}=require('../../models');
  const removed={comision:['importe_pagado','pagado_en','metodo_pago'],vehiculo:['numero_roseta_soat','fecha_inicio_soat','fecha_vencimiento_soat','uso_soat','estado_verificacion_soat','soat_verificado_en','ruat_verificado','ruat_verificado_en'],documento_ci:['estado_verificacion','verificado_en','id_usuario_verificador','motivo_rechazo'],cobros_conductor:['estado_comision','comision_pagada_en'],solicitud_documento:['estado_revision','motivo_rechazo','revisado_en','id_usuario_revisor']};
  for(const [table,columns] of Object.entries(removed)){
    const actual=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:table",{table});
    comprobar.equal(actual.some(x=>columns.includes(x.column_name)),false,table);
  }
  const vehicle=await Vehiculo.findOne({where:{driver_id:cercanoConductor}});
  const doc=await repo.createDocument({vehicleId:vehicle.id,tipo_documento:'soatPhoto',ruta_archivo:'soat-validado.jpg',estado_verificacion:'verificado',vigente:true,verificado_en:new Date()});
  await repo.insert('documento_soat',{id_documento_soat:doc,numero_roseta:'123456',fecha_inicio:'09/01/2026',fecha_vencimiento:'2026-12-31',uso:'PUBLICO'});
  const refreshed=await vehicle.reload();
  comprobar.equal(refreshed.soatRosetteNumber,'123456');comprobar.equal(refreshed.soatStartDate,'2026-01-09');comprobar.equal(refreshed.soatExpiryDate,'2026-12-31');
  await repo.update('documento_soat','id_documento_soat',doc,{numero_roseta:'654321'});
  comprobar.equal((await vehicle.reload()).soatRosetteNumber,'654321');
});
baseDatosTest('vehiculo conserva solo datos operativos y obtiene sus características del RUAT aprobado vigente',async()=>{
  const repo=require('../documentosRepositorio');const {Vehiculo}=require('../../models');
  const vehicle=await Vehiculo.findOne({where:{driver_id:cercanoConductor}});
  const columns=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='vehiculo'");
  for(const name of ['ruat_requerido','motivo_requerimiento_ruat','ruat_requerido_en','marca','modelo','anio','color','placa','capacidad','tipo_vehiculo','municipio_registro','numero_crpva','fecha_emision_ruat','fecha_inicio_propiedad','cantidad_puertas','tipo_servicio','numero_chasis','numero_motor','tipo_combustible','cilindrada_motor','tipo_motor','observaciones_legales'])comprobar.equal(columns.some(c=>c.column_name===name),false,name);
  const old=await repo.select("SELECT r.id_documento_ruat AS id_documento FROM public.documento_ruat r JOIN public.vehiculo_documento vd ON vd.id_documento=r.id_documento_ruat WHERE vd.id_vehiculo=:id",{id:vehicle.id});
  const fresh=await repo.createDocument({vehicleId:vehicle.id,tipo_documento:'ruatPhoto',ruta_archivo:'ruat-nuevo.jpg',vigente:false});
  await repo.insert('documento_ruat',{id_documento_ruat:fresh,marca:'NuevaMarca',modelo:'NuevoModelo',anio:'2026',color:'Rojo',placa:vehicle.plate,capacidad:'5',tipo_vehiculo:'taxi'});
  comprobar.equal((await vehicle.reload()).brand,'Test');
  const response=()=>({codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;}});
  const reviewed=response();await require('../../controllers/documentosRenovacionControlador').revisar({params:{documentId:fresh},user:{id:segundoPasajero},body:{estado:'verificado'}},reviewed);
  comprobar.equal(reviewed.codigo,200,JSON.stringify(reviewed.datos));await vehicle.reload();
  comprobar.equal(vehicle.brand,'NuevaMarca');comprobar.equal(vehicle.model,'NuevoModelo');comprobar.equal(vehicle.year,2026);comprobar.equal(vehicle.capacity,5);
  const historical=await repo.select('SELECT vigente FROM public.documento WHERE id_documento=:id',{id:old[0].id_documento});comprobar.equal(historical[0].vigente,false);
  const editing=response();await require('../../controllers/vehiculoControlador').actualizarVehiculo({params:{id:vehicle.id},body:{brand:'OtraMarca'}},editing);comprobar.equal(editing.codigo,409);comprobar.equal((await vehicle.reload()).brand,'NuevaMarca');
});
baseDatosTest('ganancias derivan conductor y método del viaje y pago, y el cierre mensual funciona sin columnas duplicadas',async()=>{
  const {CobrosConductor,Pago,UsuarioIdentidad}=require('../../models');const repo=require('../documentosRepositorio');
  await repo.query("INSERT INTO public.zona_servicio(nombre,limite,tasa_comision) VALUES('Zona 20',ST_GeomFromText('POLYGON((-69 -17,-67 -17,-67 -16,-69 -16,-69 -17))',4326),0.2)");
  const ride=await servicio.reservar(pasajero,entrada());
  await Viaje.update({finalFare:100,paymentMethod:'qr'},{where:{id:ride.id}});
  await Pago.create({rideId:ride.id,amount:100,currency:'BOB',payment_status:'completado',paid_at:new Date()});
  const earning=await CobrosConductor.create({ride_id:ride.id,commission_rate:0.2,created_at:new Date('2026-10-15T12:00:00Z')});
  await earning.reload();comprobar.equal(earning.driver_id,ride.driverId);comprobar.equal(earning.payment_method,'qr');
  const [[result]]=await db.query('SELECT generate_monthly_settlement(:id,2026,10) AS cierre',{replacements:{id:ride.driverId}});
  comprobar.ok(result.cierre);await earning.reload();comprobar.equal(earning.settlement_id,result.cierre);
  const [commission]=await repo.select('SELECT total_comision,total_viajes FROM public.calcular_totales_comision(:id)',{id:result.cierre});
  comprobar.equal(Number(commission.total_comision),20);comprobar.equal(commission.total_viajes,1);
  const identity=await UsuarioIdentidad.create({userId:pasajero,firstNames:'Ana',ciNumber:'12345678',birthDate:'1995-01-01',issueDate:'2025-01-01',expiryDate:'2035-01-01',verificationStatus:'verificado'});
  await identity.reload();comprobar.equal(identity.issueDate,'2025-01-01');comprobar.equal(identity.expiryDate,'2035-01-01');
  for(const [table,removed] of Object.entries({cobros_conductor:['id_conductor','metodo_pago'],documento:['emitido_en','vence_en']})){
    const columns=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:table",{table});
    comprobar.equal(columns.some(c=>removed.includes(c.column_name)),false,table);
  }
});
baseDatosTest('ganancias calculan bruto, comisión y neto sin almacenarlos y el cierre suma los redondeos por viaje',async()=>{
  const repo=require('../documentosRepositorio');const {CobrosConductor}=require('../../models');
  await repo.query("DELETE FROM public.zona_servicio");
  await repo.query("INSERT INTO public.zona_servicio(nombre,limite,tasa_comision) VALUES('Zona 2',ST_GeomFromText('POLYGON((-69 -17,-67 -17,-67 -16,-69 -16,-69 -17))',4326),0.02)");
  const reserved=await servicio.reservar(pasajero,entrada());const original=await Viaje.findByPk(reserved.id);
  await original.update({status:'completado',finalFare:0.25,completedAt:new Date()});
  const second=await Viaje.create({...original.get({plain:true}),id:aleatorioUUID(),requestKey:aleatorioUUID()});
  for(const ride of [original,second]){
    const earning=await CobrosConductor.create({ride_id:ride.id,commission_rate:0.02,created_at:new Date('2026-10-15T12:00:00Z')});
    await earning.reload();comprobar.equal(Number(earning.gross_amount),0.25);comprobar.equal(Number(earning.commission_amount),0.01);comprobar.equal(Number(earning.net_amount),0.24);
  }
  const [[closed]]=await db.query('SELECT generate_monthly_settlement(:id,2026,10) AS id',{replacements:{id:original.driverId}});
  const [row]=await repo.select('SELECT total_viajes,importe_bruto,total_comision FROM public.calcular_totales_comision(:id)',{id:closed.id});
  comprobar.equal(row.total_viajes,2);comprobar.equal(Number(row.importe_bruto),0.5);comprobar.equal(Number(row.total_comision),0.02);
  const columns=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='cobros_conductor'");
  comprobar.equal(columns.some(c=>['importe_bruto','importe_comision','importe_neto'].includes(c.column_name)),false);
});
baseDatosTest('tasas por zona se configuran, se aplican a cada ganancia y conservan la tasa histórica',async()=>{
 const repo=require('../documentosRepositorio'),{CobrosConductor}=require('../../models'),controller=require('../../controllers/comisionZonaControlador');
 const [a]=await repo.select("INSERT INTO public.zona_servicio(nombre,limite,tasa_comision) VALUES('Zona A',ST_GeomFromText('POLYGON((-68.2 -16.6,-68.1 -16.6,-68.1 -16.4,-68.2 -16.4,-68.2 -16.6))',4326),0.02) RETURNING id_zona_servicio");
 const [b]=await repo.select("INSERT INTO public.zona_servicio(nombre,limite,tasa_comision) VALUES('Zona B',ST_GeomFromText('POLYGON((-68.6 -16.6,-68.4 -16.6,-68.4 -16.4,-68.6 -16.4,-68.6 -16.6))',4326),0.05) RETURNING id_zona_servicio");
 const reserved=await servicio.reservar(pasajero,entrada());const ride=await Viaje.findByPk(reserved.id);await ride.update({status:'completado',finalFare:100,completedAt:new Date()});
 const one=await CobrosConductor.create({ride_id:ride.id});await one.reload();comprobar.equal(Number(one.commission_rate),0.02);comprobar.equal(Number(one.commission_amount),2);
 const rideB=await Viaje.create({...ride.get({plain:true}),id:aleatorioUUID(),requestKey:aleatorioUUID(),service_area_id:b.id_zona_servicio});
 const two=await CobrosConductor.create({ride_id:rideB.id,commission_rate:0.99});await two.reload();comprobar.equal(Number(two.commission_rate),0.05);comprobar.equal(Number(two.commission_amount),5);
 const response=()=>({codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;}});
 for(const value of [-1,1.1,null,'0.1234567']){const res=response();await controller.actualizar({params:{zoneId:a.id_zona_servicio},body:{tasa_comision:value},user:{id:segundoPasajero}},res);comprobar.equal(res.codigo,400);}
 const updated=response();await controller.actualizar({params:{zoneId:a.id_zona_servicio},body:{tasa_comision:0.03},user:{id:segundoPasajero}},updated);comprobar.equal(updated.codigo,200,JSON.stringify(updated.datos));
 await one.reload();comprobar.equal(Number(one.commission_rate),0.02);comprobar.equal(Number(one.commission_amount),2);
 const next=await Viaje.create({...ride.get({plain:true}),id:aleatorioUUID(),requestKey:aleatorioUUID()});const three=await CobrosConductor.create({ride_id:next.id});await three.reload();comprobar.equal(Number(three.commission_rate),0.03);
 await comprobar.rejects(one.update({commission_rate:0.5}));
 const list=response();await controller.listar({},list);comprobar.equal(list.codigo,200);comprobar.equal(list.datos.zonas.length,2);
 const noZone=await Viaje.create({...ride.get({plain:true}),id:aleatorioUUID(),requestKey:aleatorioUUID(),service_area_id:null,pickupLocation:{type:'Point',coordinates:[0,0]}});
 await comprobar.rejects(CobrosConductor.create({ride_id:noZone.id}),/zona de servicio/);
});
baseDatosTest('totales de comisión se calculan desde los cobros vinculados sin almacenar copias ni bloquear correcciones',async()=>{
 const {CobrosConductor}=require('../../models');const repo=require('../documentosRepositorio');
 const row=await crearComisionConViajes(2);comprobar.equal(row.total_rides,2);comprobar.equal(Number(row.gross_amount),100);comprobar.equal(Number(row.total_commission),20);
 const cobros=await CobrosConductor.findAll({where:{settlement_id:row.id}});
 await Viaje.update({finalFare:100},{where:{id:cobros[0].ride_id}});await row.reload();
 comprobar.equal(Number(row.gross_amount),150);comprobar.equal(Number(row.total_commission),30);
 await cobros[1].update({settlement_id:null});await row.reload();comprobar.equal(row.total_rides,1);comprobar.equal(Number(row.total_commission),20);
 await cobros[0].update({settlement_id:null});await row.reload();comprobar.equal(row.total_rides,0);comprobar.equal(Number(row.gross_amount),0);comprobar.equal(Number(row.total_commission),0);
 const columns=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='comision'");comprobar.equal(columns.some(c=>['total_viajes','importe_bruto','total_comision'].includes(c.column_name)),false);
});
baseDatosTest('comisión mensual calcula fechas y estado en Bolivia sin columnas duplicadas',async()=>{
 const repo=require('../documentosRepositorio');const {ComisionLiquidacion}=require('../../models');
 const row=await ComisionLiquidacion.create({driver_id:cercanoConductor,period_start:'2026-10-01'});await row.reload();
 comprobar.equal(row.period_end,'2026-10-31');comprobar.equal(row.due_date,'2026-11-07');
 for(const [date,state] of [['2026-10-31','abierto'],['2026-11-01','pendiente_pago'],['2026-11-07','pendiente_pago'],['2026-11-08','atrasado']]){
  const [r]=await repo.select('SELECT public.estado_comision_mensual(:id,CAST(:date AS date)) AS estado',{id:row.id,date});comprobar.equal(r.estado,state);
 }
 const leap=await ComisionLiquidacion.create({driver_id:cercanoConductor,period_start:'2028-02-01'});await leap.reload();comprobar.equal(leap.period_end,'2028-02-29');comprobar.equal(leap.due_date,'2028-03-07');
 const december=await ComisionLiquidacion.create({driver_id:cercanoConductor,period_start:'2026-12-01'});await december.reload();comprobar.equal(december.period_end,'2026-12-31');comprobar.equal(december.due_date,'2027-01-07');
 const [boundary]=await repo.select("SELECT estado_comision_mensual(:id,('2026-11-08 03:59:59+00'::timestamptz AT TIME ZONE 'America/La_Paz')::date) AS antes,estado_comision_mensual(:id,('2026-11-08 04:00:00+00'::timestamptz AT TIME ZONE 'America/La_Paz')::date) AS despues",{id:row.id});comprobar.equal(boundary.antes,'pendiente_pago');comprobar.equal(boundary.despues,'atrasado');
 const columns=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='comision'");comprobar.equal(columns.some(c=>['fin_periodo','fecha_limite','estado'].includes(c.column_name)),false);
 await comprobar.rejects(ComisionLiquidacion.create({driver_id:cercanoConductor,period_start:'2026-10-01'}));
});
baseDatosTest('notificaciones calculan lectura desde la fecha y las rutas conservan conteos y propiedad',async()=>{
 const {Notificacion}=require('../../models');const express=require('express'),jwt=require('jsonwebtoken');
 const first=await Notificacion.create({user_id:pasajero,title:'Primera',body:'Prueba',type:'sistema'});
 const second=await Notificacion.create({user_id:pasajero,title:'Segunda',body:'Prueba',type:'sistema'});
 const other=await Notificacion.create({user_id:segundoPasajero,title:'Otro usuario',body:'Prueba',type:'sistema'});
 comprobar.equal(first.is_read,false);
 const app=express();app.use(express.json());app.use('/notificaciones',require('../../routes/notificaciones'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const base='http://127.0.0.1:'+server.address().port+'/notificaciones';
  const headers={Authorization:'Bearer '+jwt.sign({id:pasajero,role:'pasajero'},process.env.JWT_SECRET||'secret')};
  const call=async(path='',method='GET')=>{const res=await fetch(base+path,{method,headers});const value=await res.json();comprobar.equal(res.status,200,JSON.stringify(value));return value;};
  const before=await call('?unread=true');comprobar.equal(before.unread_count,2);comprobar.equal(before.data.length,2);comprobar.equal(before.data[0].is_read,false);
  await call('/'+first.id+'/leer','PATCH');await first.reload();comprobar.equal(first.is_read,true);const date=first.read_at.toISOString();
  const after=await call('?unread=true');comprobar.equal(after.unread_count,1);comprobar.equal(after.data[0].id,second.id);
  await call('/'+first.id+'/leer','PATCH');await first.reload();comprobar.equal(first.read_at.toISOString(),date);
  const all=await call('/leer-todas','PATCH');comprobar.equal(all.marked,1);comprobar.equal((await call()).unread_count,0);
  await other.reload();comprobar.equal(other.is_read,false);comprobar.equal(other.read_at,null);
  const [cols]=await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='notificacion'",{esquemaFisico:true});comprobar.equal(cols.some(c=>c.column_name==='leida'),false);
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
baseDatosTest('pago obtiene el método del viaje y rechaza registrar uno diferente',async()=>{
 const {Pago}=require('../../models');const repo=require('../documentosRepositorio');const controller=require('../../controllers/pagoControlador');
 const ride=await servicio.reservar(pasajero,entrada());await Viaje.update({paymentMethod:'qr'},{where:{id:ride.id}});
 const response=()=>({codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;},sendStatus(c){this.codigo=c;return this;}});
 const wrong=response();await controller.crearPago({params:{},user:{id:pasajero,role:'pasajero'},body:{ride_id:ride.id,amount:100,payment_method:'efectivo'}},wrong);comprobar.equal(wrong.codigo,400);comprobar.equal(await Pago.count({where:{rideId:ride.id}}),0);
 const correct=response();await controller.crearPago({params:{},user:{id:pasajero,role:'pasajero'},body:{ride_id:ride.id,amount:100}},correct);comprobar.equal(correct.codigo,201,JSON.stringify(correct.datos));
 const saved=await Pago.findByPk(correct.datos.payment.id);comprobar.equal(saved.payment_method,'qr');
 const detail=response();await controller.obtenerPagoPorViaje({params:{rideId:ride.id}},detail);comprobar.equal(detail.codigo,200);comprobar.equal(detail.datos.payment.payment_method,'qr');
 const columns=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='pago'");comprobar.equal(columns.some(c=>c.column_name==='metodo_pago'),false);
});
baseDatosTest('solicitudes no almacenan rechazo definitivo y mantienen revisión y reenvíos derivados de documentos',async()=>{
 const {ConductorSolicitud}=require('../../models');const repo=require('../documentosRepositorio');
 const row=await ConductorSolicitud.create({userId:pasajero,status:'pendiente',metadata:{finalRejection:true}});await row.reload();comprobar.equal(row.finalRejection,false);comprobar.equal(row.metadata.finalRejection,false);
 await row.update({status:'rechazado',metadata:{finalRejection:false}});await row.reload();comprobar.equal(row.finalRejection,true);comprobar.equal(row.metadata.finalRejection,true);
 const doc=await repo.createDocument({requestId:row.id,tipo_documento:'carFront',ruta_archivo:'foto-rechazada.jpg',estado_verificacion:'rechazado'});
 await row.reload();comprobar.deepEqual(row.rejectedDocuments,['carFront']);comprobar.equal(row.finalRejection,false);comprobar.equal(row.metadata.finalRejection,false);
 const selected=await ConductorSolicitud.findByPk(row.id,{attributes:['metadata']});comprobar.equal(selected.metadata.finalRejection,false);
 const response={codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;}};
 await require('../../controllers/conductorRevisionControlador').rechazarConductor({params:{requestId:row.id},body:{reason:'Prueba',verifiedDocuments:[],rejectedDocuments:[]},user:{id:segundoPasajero}},response);comprobar.equal(response.codigo,400);
 const columns=await repo.select("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='solicitud_conductor'");comprobar.equal(columns.some(c=>c.column_name==='rechazo_definitivo'),false);
});

baseDatosTest('la renovación envía al OCR exactamente el JPEG recortado que se guarda',async t=>{
  const fs=require('fs/promises'),path=require('path'),sharp=require('sharp');
  const directory=path.resolve(__dirname,'../../uploads/drivers');
  await fs.mkdir(directory,{recursive:true});
  const filename='prueba-recorte-'+aleatorioUUID()+'.png',archivo=path.join(directory,filename);
  t.after(async()=>{await fs.rm(archivo,{force:true});await fs.rm(archivo+'.jpg',{force:true});});
  await sharp({create:{width:200,height:200,channels:3,background:'#aaaacc'}}).png().toFile(archivo);
  let enviada;
  const ocr=require('../servicioOcr');
  t.mock.method(ocr,'extraerDocumento',async imagen=>{enviada=imagen;return {fields:{fullName:'Ana Paz'},rawText:'Lectura de prueba'};});
  const {Conductor}=require('../../models');const driver=await Conductor.findByPk(cercanoConductor);
  const res={codigo:200,status(c){this.codigo=c;return this;},json(datos){this.datos=datos;return this;}};
  await require('../../controllers/documentosRenovacionControlador').enviar({user:{id:driver.userId},body:{
    ticPhotoOrigen:'captura_camara',ticPhotoCropX:50,ticPhotoCropY:60,ticPhotoCropW:100,ticPhotoCropH:80,ticPhotoCropScreenW:200,ticPhotoCropScreenH:200
  },files:{ticPhoto:[{filename,path:archivo,mimetype:'image/png',size:100}]}},res);
  comprobar.equal(res.codigo,201,JSON.stringify(res.datos));
  const repo=require('../documentosRepositorio');
  const [documento]=await repo.select('SELECT * FROM public.documento WHERE id_documento=:id',{id:res.datos.documents.ticPhoto});
  const guardada=await fs.readFile(path.join(directory,documento.ruta_archivo));
  comprobar.deepEqual(enviada,guardada);comprobar.equal(documento.tipo_mime,'image/jpeg');
  comprobar.equal(Object.hasOwn(documento,'tamano_archivo'),false);
  const [columns]=await repo.query("SELECT column_name FROM information_schema.columns WHERE table_schema IN ('public','compatibilidad') AND table_name IN ('documento','archivo_solicitud') AND column_name IN ('tamano_archivo','nombre_original_archivo')");
  comprobar.equal(columns.length,0);
  comprobar.equal(documento.origen_evidencia,'captura_camara');
  const meta=await sharp(guardada).metadata();comprobar.equal(meta.width,110);comprobar.equal(meta.height,88);
  await comprobar.rejects(fs.access(archivo),{code:'ENOENT'});
});

baseDatosTest('el origen por adjunto exige cámara o archivo y reserva los valores internos al servidor',async()=>{
 const repo=require('../documentosRepositorio');
 comprobar.deepEqual(repo.origenesAdjuntos({ciFrontOrigen:'captura_camara',ciBackOrigen:'archivo_subido'},{ciFront:[{}],ciBack:[{}]}),{ciFront:'captura_camara',ciBack:'archivo_subido'});
 for(const origen of [undefined,null,'prueba_vida','semilla_desarrollo','otro',['captura_camara']]){
   comprobar.throws(()=>repo.origenAdjunto({ciFrontOrigen:origen},'ciFront'),{status:400});
 }
 const doc=await repo.createDocument({userId:pasajero,tipo_documento:'ciFront',origen_evidencia:'captura_camara'});
 await comprobar.rejects(repo.update('documento','id_documento',doc,{origen_evidencia:'otro'}),e=>e.original?.code==='23514');
 const [row]=await repo.select('SELECT origen_evidencia FROM public.documento WHERE id_documento=:id',{id:doc});comprobar.equal(row.origen_evidencia,'captura_camara');
});

baseDatosTest('la API entrega el texto versionado y valida su aceptación antes de procesar el CI',async t=>{
 const express=require('express'),jwt=require('jsonwebtoken');
 const anterior=process.env.IDENTITY_VERIFICATION_ENABLED;process.env.IDENTITY_VERIFICATION_ENABLED='true';
 t.after(()=>{if(anterior===undefined)delete process.env.IDENTITY_VERIFICATION_ENABLED;else process.env.IDENTITY_VERIFICATION_ENABLED=anterior;});
 const app=express();app.use(express.json());app.use('/autenticacion',require('../../routes/autenticacion'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const url='http://127.0.0.1:'+server.address().port+'/autenticacion/verificar-identidad';
 const headers={Authorization:'Bearer '+jwt.sign({id:pasajero},process.env.JWT_SECRET||'secret'),'Content-Type':'application/json'};
 const unauth=await fetch(url+'/consentimiento');comprobar.equal(unauth.status,401);
 const response=await fetch(url+'/consentimiento',{headers});comprobar.equal(response.status,200);comprobar.equal(response.headers.get('cache-control'),'no-store');
 const publicado=await response.json();
 comprobar.deepEqual(publicado,require('../consentimientos').obtenerConsentimientoIdentidad());
 for(const ruta of ['/ocr','']){
  for(const version of [undefined,'identity-documents-v0']){
    const r=await fetch(url+ruta,{method:'POST',headers,body:JSON.stringify({consent:true,consentVersion:version})});
    comprobar.equal(r.status,409);comprobar.equal((await r.json()).code,'CONSENT_VERSION_MISMATCH');
  }
  const no=await fetch(url+ruta,{method:'POST',headers,body:JSON.stringify({consent:false,consentVersion:publicado.version})});comprobar.equal(no.status,400);
  const aceptado=await fetch(url+ruta,{method:'POST',headers,body:JSON.stringify({consent:true,consentVersion:publicado.version})});comprobar.equal(aceptado.status,400);comprobar.match((await aceptado.json()).error,/caras del CI|frente y reverso/);
 }
});

baseDatosTest('identidad, domicilio y OCR escriben y consultan las claves específicas de los documentos',async()=>{
 const repo=require('../documentosRepositorio'),specs=require('../../config/documentos-estructura');
 const {ConductorSolicitud,UsuarioIdentidad,ConductorDomicilio}=require('../../models');
 const identidad=await UsuarioIdentidad.create({userId:pasajero,firstNames:'Ana',ciNumber:'87654321',birthDate:'1995-01-01'});
 await identidad.update({firstNames:'Ana María'});await identidad.reload();comprobar.equal(identidad.firstNames,'Ana María');
 const [ci]=await repo.select('SELECT id_documento_ci,nombres FROM public.documento_ci WHERE id_documento_ci=:id',{id:identidad.id});comprobar.equal(ci.nombres,'Ana María');
 const solicitud=await ConductorSolicitud.create({userId:pasajero,version:1});
 const domicilio=await ConductorDomicilio.create({userId:pasajero,driverRequestId:solicitud.id,address:'Calle inicial 123',location:{type:'Point',coordinates:[-68.15,-16.5]}});
 await domicilio.update({address:'Calle corregida 456',location:{type:'Point',coordinates:[-68.16,-16.51]}});
 await domicilio.reload();comprobar.equal(domicilio.address,'Calle corregida 456');comprobar.deepEqual(domicilio.location.coordinates,[-68.16,-16.51]);
 for(const [type,spec] of Object.entries(specs)){
  const id=type==='domicileProof'?domicilio.id:await repo.createDocument({requestId:solicitud.id,tipo_documento:type});
  const [key,column]=Object.entries(spec.fields)[0];
  await repo.saveReading(id,type,{text:'OCR '+type,fields:{[key]:'Valor '+type,...(type==='ticPhoto'?{firstNames:'Ana',surnames:'Paz',fullName:'No debe almacenarse'}:{})}});
  const [row]=await repo.select('SELECT * FROM public.'+spec.table+' WHERE '+spec.primaryKey+'=:id',{id});
  comprobar.equal(row[spec.primaryKey],id);comprobar.equal(row[column],'Valor '+type);comprobar.equal(Object.hasOwn(row,'id_documento'),false);
  if(type==='ticPhoto') comprobar.equal(Object.hasOwn(row,'nombre_detectado'),false);
 }
 const metadata=(await require('../solicitudDocumentos').readMetadata(solicitud.id)).metadata;
 for(const [type,spec] of Object.entries(specs)){
  const key=Object.keys(spec.fields)[0];comprobar.equal(metadata.ocr[type].fields[key],'Valor '+type);
 }
 comprobar.equal(metadata.ocr.ticPhoto.fields.fullName,'Ana Paz');
 comprobar.equal(metadata.ocr.ticPhoto.missing.includes('fullName'),false);
 const informe=await repo.createDocument({requestId:solicitud.id,tipo_documento:'psychologicalReport'});
 await repo.insert('documento_informe_psicologico',{id_documento_informe_psicologico:informe,resultado:'apto',fecha_emision:'2026-01-01'});
 const [report]=await repo.select('SELECT id_documento_informe_psicologico FROM public.documento_informe_psicologico WHERE id_documento_informe_psicologico=:id',{id:informe});comprobar.equal(report.id_documento_informe_psicologico,informe);
});

baseDatosTest('OCR distingue fallos técnicos de lecturas incompletas y no reintenta fallidos al reiniciar',async t=>{
 const fs=require('fs/promises'),path=require('path'),sharp=require('sharp');
 const {ConductorSolicitud,SolicitudArchivo}=require('../../models');
 const directory=path.resolve(__dirname,'../../uploads/drivers');await fs.mkdir(directory,{recursive:true});
 const creados=[];t.after(async()=>{for(const file of creados)await fs.rm(file,{force:true});});
 const pendientes=[];
 for(const [userId,type] of [[pasajero,'ticPhoto'],[segundoPasajero,'soatPhoto']]){
  const solicitud=await ConductorSolicitud.create({userId,version:1,metadata:{ocrProcessingStatus:'pendiente'}});
  const filename='prueba-estado-ocr-'+aleatorioUUID()+'.jpg',file=path.join(directory,filename);creados.push(file);
  await sharp({create:{width:20,height:20,channels:3,background:'#ffffff'}}).jpeg().toFile(file);
  await SolicitudArchivo.create({requestId:solicitud.id,userId,fileType:type,filename,mimeType:'image/jpeg',evidenceOrigin:'captura_camara'});
  pendientes.push(solicitud);
 }
 const ocr=require('../servicioOcr');
 const mock=t.mock.method(ocr,'extraerDocumento',async(_imagen,type)=>{
  if(type==='soatPhoto')throw new Error('Servicio OCR no disponible');
  return {fields:{firstNames:'Ana'},rawText:'Lectura parcial',missing:['licenseNumber'],rejected:true};
 });
 const controller=require('../../controllers/solicitudControlador');await controller.reanudarPendienteConductorOcr();
 for(const solicitud of pendientes)await solicitud.reload();
 comprobar.equal(pendientes[0].ocrProcessingStatus,'complete');comprobar.equal(pendientes[1].ocrProcessingStatus,'fallido');
 for(const solicitud of pendientes){comprobar.ok(solicitud.ocrProcessedAt);comprobar.equal(solicitud.metadata.ocrProcessingStatus,solicitud.ocrProcessingStatus);}
 comprobar.equal(pendientes[0].metadata.ocr.ticPhoto.fields.firstNames,'Ana');
 comprobar.equal(mock.mock.callCount(),2);
 await controller.reanudarPendienteConductorOcr();comprobar.equal(mock.mock.callCount(),2);
 const repo=require('../documentosRepositorio');
 await comprobar.rejects(repo.update('solicitud_conductor','id_solicitud_conductor',pendientes[0].id,{estado_ocr:'desconocido'}),e=>e.original?.code==='23514');
 const response={codigo:200,status(c){this.codigo=c;return this;},json(v){this.datos=v;return this;}};
 await controller.obtenerSolicitudEstado({user:{id:segundoPasajero}},response);comprobar.equal(response.codigo,200);
 comprobar.equal(response.datos.request.metadata.ocrProcessingStatus,'fallido');
});

baseDatosTest('contactos impiden repetir teléfonos activos por usuario sin depender del nombre o formato',async t=>{
 const express=require('express'),jwt=require('jsonwebtoken'),repo=require('../documentosRepositorio');
 const app=express();app.use(express.json());app.use('/usuarios',require('../../routes/usuarios'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const url='http://127.0.0.1:'+server.address().port+'/usuarios/contactos-emergencia';
 const headers=user=>({Authorization:'Bearer '+jwt.sign({id:user},process.env.JWT_SECRET||'secret'),'Content-Type':'application/json'});
 const agregar=async(user,nombre,telefono)=>{const r=await fetch(url,{method:'POST',headers:headers(user),body:JSON.stringify({nombre,telefono})});return {status:r.status,data:await r.json()};};
 const original=await agregar(pasajero,'Ana','+59171234567');comprobar.equal(original.status,201);
 for(const [nombre,telefono]of [['Ana','+59171234567'],['Luis','+591 (712) 34-567'],['Otro','+591.71234567']]){
  const r=await agregar(pasajero,nombre,telefono);comprobar.equal(r.status,409);comprobar.match(r.data.error,/ya está registrado/);
 }
 comprobar.equal((await agregar(segundoPasajero,'Ana','+59171234567')).status,201);
 await repo.query("UPDATE public.contacto_emergencia SET telefono='+591 (712) 34-567' WHERE id_usuario=:id",{id:segundoPasajero});
 comprobar.equal((await agregar(segundoPasajero,'Otro nombre','+59171234567')).status,409);
 comprobar.equal((await agregar(pasajero,'Ana','+59172345678')).status,201);
 const concurrentes=await Promise.all([agregar(pasajero,'Uno','+59173456789'),agregar(pasajero,'Dos','+59173456789')]);
 comprobar.deepEqual(concurrentes.map(r=>r.status).sort(),[201,409]);
 await comprobar.rejects(repo.insert('contacto_emergencia',{id_usuario:pasajero,nombre:'Directo',telefono:'+591 (712) 34-567'}),e=>e.original?.code==='23505'&&e.original.constraint==='contacto_emergencia_telefono_activo_unico');
 const borrado=await fetch(url+'/'+original.data.contacto.id,{method:'DELETE',headers:headers(pasajero)});comprobar.equal(borrado.status,200);
 const reemplazo=await agregar(pasajero,'Ana actualizada','+59171234567');comprobar.equal(reemplazo.status,201);
 await comprobar.rejects(repo.update('contacto_emergencia','id_contacto_emergencia',original.data.contacto.id,{activo:true}),e=>e.original?.code==='23505');
 const listado=await fetch(url,{headers:headers(pasajero)});const datos=await listado.json();comprobar.equal(datos.contactos.length,3);
 comprobar.equal(datos.contactos.filter(c=>c.telefono==='+59171234567').length,1);
});

baseDatosTest('los mapeos y las correcciones documentales respetan las columnas simplificadas',async()=>{
 const repo=require('../documentosRepositorio'),specs=require('../../config/documentos-estructura'),correcciones=require('../documentosCorreccionServicio');
 const {ConductorSolicitud}=require('../../models');
 const request=await ConductorSolicitud.create({userId:pasajero,version:1,metadata:{ocrProcessingStatus:'complete',ocrProcessedAt:new Date()}});
 const casos=[
  ['licenseFront',{licenseNumber:'12345678',ciNumber:'ignorar',birthDate:'1990-01-01'},['ciNumber'],'numero_licencia','12345678'],
  ['licenseBack',{licenseNumber:'12345678',ciNumber:'ignorar'},['ciNumber'],'numero_licencia','12345678'],
  ['ticPhoto',{licenseNumber:'12345678',ciNumber:'ignorar',birthDate:'1990-01-01',firstNames:'Ana',surnames:'Paz'},['ciNumber','birthDate'],'numero_licencia','12345678'],
  ['antecedentsPhoto',{ciNumber:'12345678',licenseNumber:'ignorar',documentNumber:'ignorar',institution:'ignorar'},['licenseNumber','documentNumber','institution'],'ci_detectado','12345678'],
  ['domicileProof',{serviceAddress:'Avenida de prueba 123',billingMonth:'NOVIEMBRE',accountNumber:'ignorar',customerName:'ignorar',meterNumber:'ignorar',invoiceNumber:'ignorar',issueDate:'2026-01-01'},['accountNumber','customerName','meterNumber','invoiceNumber','issueDate'],'direccion_servicio','Avenida de prueba 123']
 ];
 for(const[type,fields,retirados,columna,esperado]of casos){
  const spec=specs[type],id=await repo.createDocument({requestId:request.id,tipo_documento:type});
  await repo.saveReading(id,type,{fields,text:'OCR conservado'});
  const [row]=await repo.select('SELECT * FROM public.'+spec.table+' WHERE '+spec.primaryKey+'=:id',{id});comprobar.equal(row[columna],esperado);
  for(const column of Object.values(spec.fields))comprobar.ok(Object.hasOwn(row,column),spec.table+'.'+column);
  const lectura=(await require('../solicitudDocumentos').readMetadata(request.id)).metadata.ocr[type];
  const editable=await correcciones.consultarDatos(request.id,type);
  for(const key of retirados){
   comprobar.equal(Object.hasOwn(lectura.fields,key),false);
   comprobar.equal(editable.campos.some(c=>c.clave===key),false);
  }
  await comprobar.rejects(correcciones.corregirDatos(request.id,type,{revision:editable.revision,campos:{[retirados[0]]:'No permitido'}},segundoPasajero),{status:400});
 }
 const licencia=await correcciones.consultarDatos(request.id,'licenseFront');
 await correcciones.corregirDatos(request.id,'licenseFront',{revision:licencia.revision,campos:{licenseNumber:'87654321'}},segundoPasajero);
 const [actual]=await repo.select('SELECT numero_licencia FROM public.documento_licencia l JOIN public.solicitud_documento sd ON sd.id_documento=l.id_documento_licencia JOIN public.documento d ON d.id_documento=l.id_documento_licencia WHERE sd.id_solicitud_conductor=:id AND d.tipo_documento=:tipo',{id:request.id,tipo:'licenseFront'});
 comprobar.equal(actual.numero_licencia,'87654321');
});
baseDatosTest('la renovación de licencia verifica ambas caras usando numero_licencia',async()=>{
 const repo=require('../documentosRepositorio'),{Conductor,UsuarioIdentidad}=require('../../models');
 const driver=await Conductor.findByPk(cercanoConductor);
 await UsuarioIdentidad.create({userId:driver.userId,firstNames:'Ana',ciNumber:'12345678',birthDate:'1995-01-01',verificationStatus:'verificado'});
 const ids=[];
 for(const type of ['licenseFront','licenseBack']){
  const id=await repo.createDocument({driverId:driver.id,tipo_documento:type,vigente:false});ids.push(id);
  await repo.saveReading(id,type,{fields:{licenseNumber:'12345678',issueDate:'2025-01-01',licenseExpiryDate:'2099-01-01'}});
 }
 await repo.update('documento','id_documento',ids[1],{id_documento_principal:ids[0]});
 const res={codigo:200,status(c){this.codigo=c;return this;},json(datos){this.datos=datos;return this;}};
 await require('../../controllers/documentosRenovacionControlador').revisar({params:{documentId:ids[0]},body:{estado:'verificado'},user:{id:segundoPasajero}},res);
 comprobar.equal(res.codigo,200,JSON.stringify(res.datos));
 const rows=await repo.select('SELECT estado_verificacion,vigente FROM public.documento WHERE id_documento IN (:ids)',{ids});
 comprobar.equal(rows.length,2);for(const row of rows){comprobar.equal(row.estado_verificacion,'verificado');comprobar.equal(row.vigente,true);}
});
