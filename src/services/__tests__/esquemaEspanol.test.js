'use strict';
const prueba = require('node:test');
const comprobar = require('node:assert/strict');
const { traducirSql: traducirSql } = require('../../config/esquema-espanol');

prueba('traduce identificadores sin cambiar literales, parámetros ni comentarios', () => {
  comprobar.equal(
    traducirSql(`SELECT "email", status, metadata FROM usuario WHERE email = :email AND role = 'conductor' -- email status\n/* name */`),
    `SELECT "correo", estado, metadatos FROM usuario WHERE correo = :email AND rol = 'conductor' -- email status\n/* name */`
  );
});
prueba('conserva los alias de atributos del ORM y las rutas de propiedades anidadas', () => {
  comprobar.equal(
    traducirSql('SELECT "correo" AS "email", "estado" AS "status", "nombre" AS "identity.name" FROM usuario', undefined, true),
    'SELECT "correo" AS "email", "estado" AS "status", "nombre" AS "identity.name" FROM usuario'
  );
});
prueba('no toma miembros heredados de Object como traducciones', () => {
  comprobar.equal(traducirSql('SELECT toString, constructor, hasOwnProperty'), 'SELECT toString, constructor, hasOwnProperty');
});
prueba('actualiza llamadas a funciones y mantiene parámetros PostgreSQL', () => {
  comprobar.equal(traducirSql('SELECT generate_monthly_settlement($1,$2,$3)'), 'SELECT generar_liquidacion_mensual($1,$2,$3)');
});

prueba('consultas y escritura ORM conservan datos y contratos al usar el esquema español', { skip: process.env.PROBAR_ESQUEMA_BD !== '1' }, async () => {
  const baseDatos = require("../../config/baseDatos");
  const { Usuario: Usuario } = require('../../models');
  const transaccion = await baseDatos.transaction();
  try {
    const id = require('node:crypto').randomUUID();
    const usuario = await Usuario.create({ id, email: `${id}@prueba.invalid`, phone: id.slice(0, 20), password: 'prueba', firebaseUid: id, role: 'pasajero' }, { transaction: transaccion });
    comprobar.equal(usuario.email, `${id}@prueba.invalid`);
    const leido = await Usuario.findByPk(id, { transaction: transaccion, include: [{ association: 'identity', required: false }] });
    comprobar.equal(leido.email, usuario.email);
    comprobar.equal(leido.role, 'pasajero');
    const [[fila]] = await baseDatos.query('SELECT email, role FROM usuario WHERE id = :id', { replacements: { id }, transaction: transaccion });
    comprobar.equal(fila.email, usuario.email);
    const [[fisico]] = await baseDatos.query('SELECT correo, rol FROM usuario WHERE id = :id', { replacements: { id }, transaction: transaccion, esquemaFisico: true });
    comprobar.equal(fisico.correo, usuario.email);
    comprobar.equal(fisico.rol, 'pasajero');
    await usuario.update({ phoneVerified: true }, { transaction: transaccion });
    comprobar.equal((await Usuario.findByPk(id, { transaction: transaccion })).phoneVerified, true);
    const [[zona]] = await baseDatos.query('SELECT is_location_serviceable(ST_SetSRID(ST_MakePoint(0,0),4326)) AS cobertura', { transaction: transaccion });
    comprobar.equal(typeof zona.cobertura, 'boolean');
  } finally {
    await transaccion.rollback();
    await baseDatos.close();
  }
});
