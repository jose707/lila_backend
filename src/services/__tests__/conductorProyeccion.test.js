'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Conductor = require('../../models/Conductor');
const repo = require('../documentosRepositorio');
const originalSelect = repo.select;

after(() => { repo.select = originalSelect; });

test('id es la clave del modelo y del JSON, sin un alias adicional', () => {
  const conductor = Conductor.build({ id: 'conductor', userId: 'usuario' }, { isNewRecord: false });
  assert.equal(Conductor.primaryKeyAttribute, 'id');
  assert.equal(Conductor.rawAttributes.idConductor, undefined);
  assert.equal(conductor.toJSON().id, 'conductor');
  assert.equal(Object.hasOwn(conductor.toJSON(), 'idConductor'), false);
});

test('consulta parcial de conductor usada por asignación rápida no carga licencia sin id', async () => {
  const conductor = Conductor.build({ userId: 'usuario' }, {
    isNewRecord: false, attributes: ['userId']
  });
  assert.equal(conductor.id, undefined);
  let llamadas = 0;
  repo.select = async (_sql, replacements) => {
    llamadas++;
    assert.notEqual(replacements.id, undefined, 'La consulta de licencia recibe :id sin valor');
    return [];
  };
  await Conductor.runHooks('afterFind', conductor, { attributes: ['userId'] });
  assert.equal(llamadas, 0);
  assert.equal(conductor.userId, 'usuario');
});

test('consultar un conductor completo tampoco dispara búsquedas de licencia', async () => {
  const conductor = Conductor.build({ id: 'conductor', userId: 'usuario' }, { isNewRecord: false });
  repo.select = async () => { assert.fail('El modelo no debe consultar licencias'); };
  await Conductor.runHooks('afterFind', conductor, {});
  assert.equal(conductor.licenseNumber, undefined);
});

