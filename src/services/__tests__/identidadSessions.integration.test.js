// Uses configured PostgreSQL, but creates every test object in a private schema
// inside one transaction that is always rolled back. No application rows touched.
const { test } = require('node:test');
const comprobar = require('node:assert/strict');
const { randomUUID: aleatorioUUID, randomBytes: aleatorioBytes } = require('crypto');
const baseDatos = require("../../config/baseDatos");
const { createIdentitySessions: crearIdentidadSesiones } = require('../identitySessions');
const migration = require('../../../migrations/00000006-identity-sessions');
const { createDocumentAccess: crearDocumentoAcceso } = require("../../middleware/documentoAccess");
const { createIdentityReviewRouter: crearIdentidadRevisionEnrutador } = require('../../routes/identityReview');
const express = require('express');
const jwt = require('jsonwebtoken');

test('PostgreSQL: migration, ownership, expiry, retries, quota and retention', async () => {
  const rollback = new Error('TEST_ROLLBACK');
  const anterior = process.env.IDENTITY_STORAGE_KEY;
  const anteriorJwt = process.env.JWT_SECRET;
  process.env.IDENTITY_STORAGE_KEY = aleatorioBytes(32).toString('hex');
  process.env.JWT_SECRET = aleatorioBytes(32).toString('hex');
  try {
    await baseDatos.transaction(async (transaccion) => {
      const esquema = 'identity_test_' + aleatorioBytes(8).toString('hex');
      const adapter = {
        query: (sql, opciones = {}) => baseDatos.query(sql, { ...opciones, transaction: transaccion }),
        transaccion: (funcion) => funcion(transaccion)
      };
      await adapter.query(`CREATE SCHEMA ${esquema}`);
      await adapter.query(`SET LOCAL search_path TO ${esquema}`);
      await adapter.query("CREATE TABLE usuario (id uuid PRIMARY KEY, role text DEFAULT 'user'); CREATE TABLE documento_ci (id uuid PRIMARY KEY); CREATE TABLE documento (id uuid PRIMARY KEY, user_id uuid, file_path text, document_type text DEFAULT 'ciFront', verification_status text DEFAULT 'pendiente')");
      await migration.up({ sequelize: adapter });
      await migration.up({ sequelize: adapter });
      const servicio = crearIdentidadSesiones(adapter);
      const usuario = aleatorioUUID();
      const otro = aleatorioUUID();
      await adapter.query("INSERT INTO usuario(id) VALUES (:user), (:other)", { replacements: { user: usuario, other: otro } });
      await adapter.query("INSERT INTO documento(id, user_id, file_path) VALUES (:id, :user, 'private-ci.png')", { replacements: { id: aleatorioUUID(), user: usuario } });
      const acceso = crearDocumentoAcceso(adapter);
      const probe = async (usuarioId) => {
        let estado;
        const respuesta = { enviarEstado: (valor) => {estado = valor;}, establecer: () => {} };
        await acceso({ params: { filename: 'private-ci.png' }, user: { id: usuarioId } }, respuesta, () => {estado = 200;});
        return estado;
      };
      comprobar.equal(await probe(usuario), 200);
      comprobar.equal(await probe(otro), 404);
      await adapter.query("UPDATE usuario SET role = 'administrador' WHERE id = :other", { replacements: { other: otro } });
      comprobar.equal(await probe(otro), 200);
      const frontal = await servicio.reserve(usuario, 'ciFront');
      const reverso = await servicio.reserve(usuario, 'ciBack');
      const resultado = { fields: { ciNumber: '1234567' } };
      await servicio.complete(frontal, Buffer.from('exact cropped front'), resultado);
      await servicio.complete(reverso, Buffer.from('exact cropped back'), resultado);
      const aplicacion = express();
      aplicacion.use('/identity', crearIdentidadRevisionEnrutador(adapter));
      const servidor = aplicacion.listen(0, '127.0.0.1');
      await new Promise((resolver) => servidor.once('listening', resolver));
      try {
        const base = `http://127.0.0.1:${servidor.address().port}/identity`;
        const autorizacion = (id) => ({ Authorization: 'Bearer ' + jwt.sign({ id, role: 'user' }, process.env.JWT_SECRET) });
        comprobar.equal((await fetch(`${base}/draft`)).status, 401);
        const borrador = await fetch(`${base}/draft`, { headers: autorizacion(usuario) });
        comprobar.equal(borrador.status, 200);
        const recovered = await borrador.json();
        comprobar.equal(recovered.ciFront.sessionId, frontal.id);
        comprobar.equal(recovered.ciFront.image, undefined);
        const foranea = await fetch(`${base}/draft`, { headers: autorizacion(otro) });
        comprobar.deepEqual(await foranea.json(), {});
        comprobar.equal((await fetch(`${base}/evidence/${frontal.id}`, { headers: autorizacion(usuario) })).status, 404);
      } finally {await new Promise((resolver) => servidor.close(resolver));}
      const pair = await servicio.readPair(usuario, frontal.id, reverso.id, transaccion);
      comprobar.equal(Buffer.from(pair.frontData.image, 'base64').toString(), 'exact cropped front');
      comprobar.deepEqual(pair.frontData.result, resultado);
      await comprobar.rejects(servicio.readPair(otro, frontal.id, reverso.id, transaccion), { status: 404 });
      await comprobar.rejects(servicio.readPair(usuario, reverso.id, frontal.id, transaccion), { status: 404 });
      await servicio.consume(pair.front, pair.back, transaccion);
      comprobar.deepEqual(await servicio.readPair(usuario, frontal.id, reverso.id, transaccion), { replay: true });
      const reverso2 = await servicio.reserve(usuario, 'ciBack');
      await servicio.complete(reverso2, Buffer.from('back 2'), resultado);
      await comprobar.rejects(servicio.readPair(usuario, frontal.id, reverso2.id, transaccion), { status: 409 });
      const frontal2 = await servicio.reserve(usuario, 'ciFront');
      await servicio.complete(frontal2, Buffer.from('front 2'), resultado);
      await adapter.query("UPDATE identity_ocr_sessions SET expires_at = now() - interval '1 minute', purge_at = now() - interval '1 minute' WHERE id = :id", { replacements: { id: frontal2.id } });
      await comprobar.rejects(servicio.readPair(usuario, frontal2.id, reverso2.id, transaccion), { status: 410 });
      await servicio.purge();
      const [[vencido]] = await adapter.query("SELECT payload FROM identity_ocr_sessions WHERE id = :id", { replacements: { id: frontal2.id } });
      comprobar.equal(vencido.payload, null);
      for (let indice = 4; indice < 20; indice++) await servicio.reserve(usuario, 'ciFront');
      await comprobar.rejects(servicio.reserve(usuario, 'ciFront'), { status: 429 });
      throw rollback;
    });
  } catch (error) {if (error !== rollback) throw error;} finally
  {
    if (anterior === undefined) delete process.env.IDENTITY_STORAGE_KEY;else
    process.env.IDENTITY_STORAGE_KEY = anterior;
    if (anteriorJwt === undefined) delete process.env.JWT_SECRET;else
    process.env.JWT_SECRET = anteriorJwt;
    await baseDatos.close();
  }
});
