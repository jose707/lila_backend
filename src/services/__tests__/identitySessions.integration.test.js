// Uses configured PostgreSQL, but creates every test object in a private schema
// inside one transaction that is always rolled back. No application rows touched.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('crypto');
const db = require('../../config/database');
const { createIdentitySessions } = require('../identitySessions');
const migration = require('../../../migrations/00000006-identity-sessions');
const { createDocumentAccess } = require('../../middleware/documentAccess');
const { createIdentityReviewRouter } = require('../../routes/identityReview');
const express = require('express');
const jwt = require('jsonwebtoken');

test('PostgreSQL: migration, ownership, expiry, retries, quota and retention', async () => {
  const rollback = new Error('TEST_ROLLBACK');
  const previous = process.env.IDENTITY_STORAGE_KEY;
  const previousJwt = process.env.JWT_SECRET;
  process.env.IDENTITY_STORAGE_KEY = randomBytes(32).toString('hex');
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  try {
    await db.transaction(async transaction => {
      const schema = 'identity_test_' + randomBytes(8).toString('hex');
      const adapter = {
        query: (sql, options = {}) => db.query(sql, { ...options, transaction }),
        transaction: fn => fn(transaction),
      };
      await adapter.query(`CREATE SCHEMA ${schema}`);
      await adapter.query(`SET LOCAL search_path TO ${schema}`);
      await adapter.query("CREATE TABLE users (id uuid PRIMARY KEY, role text DEFAULT 'user'); CREATE TABLE user_identities (id uuid PRIMARY KEY); CREATE TABLE documents (id uuid PRIMARY KEY, user_id uuid, file_path text, document_type text DEFAULT 'ciFront', verification_status text DEFAULT 'pending')");
      await migration.up({ sequelize: adapter });
      await migration.up({ sequelize: adapter });
      const service = createIdentitySessions(adapter);
      const user = randomUUID();
      const other = randomUUID();
      await adapter.query('INSERT INTO users(id) VALUES (:user), (:other)', { replacements: { user, other } });
      await adapter.query("INSERT INTO documents(id, user_id, file_path) VALUES (:id, :user, 'private-ci.png')", { replacements: { id: randomUUID(), user } });
      const access = createDocumentAccess(adapter);
      const probe = async userId => {
        let status;
        const res = { sendStatus: value => { status = value; }, set: () => {} };
        await access({ params: { filename: 'private-ci.png' }, user: { id: userId } }, res, () => { status = 200; });
        return status;
      };
      assert.equal(await probe(user), 200);
      assert.equal(await probe(other), 404);
      await adapter.query("UPDATE users SET role = 'admin' WHERE id = :other", { replacements: { other } });
      assert.equal(await probe(other), 200);
      const front = await service.reserve(user, 'ciFront');
      const back = await service.reserve(user, 'ciBack');
      const result = { fields: { ciNumber: '1234567' } };
      await service.complete(front, Buffer.from('exact cropped front'), result);
      await service.complete(back, Buffer.from('exact cropped back'), result);
      const app = express();
      app.use('/identity', createIdentityReviewRouter(adapter));
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      try {
        const base = `http://127.0.0.1:${server.address().port}/identity`;
        const authorization = id => ({ Authorization: 'Bearer ' + jwt.sign({ id, role: 'user' }, process.env.JWT_SECRET) });
        assert.equal((await fetch(`${base}/draft`)).status, 401);
        const draft = await fetch(`${base}/draft`, { headers: authorization(user) });
        assert.equal(draft.status, 200);
        const recovered = await draft.json();
        assert.equal(recovered.ciFront.sessionId, front.id);
        assert.equal(recovered.ciFront.image, undefined);
        const foreign = await fetch(`${base}/draft`, { headers: authorization(other) });
        assert.deepEqual(await foreign.json(), {});
        assert.equal((await fetch(`${base}/evidence/${front.id}`, { headers: authorization(user) })).status, 404);
      } finally { await new Promise(resolve => server.close(resolve)); }
      const pair = await service.readPair(user, front.id, back.id, transaction);
      assert.equal(Buffer.from(pair.frontData.image, 'base64').toString(), 'exact cropped front');
      assert.deepEqual(pair.frontData.result, result);
      await assert.rejects(service.readPair(other, front.id, back.id, transaction), { status: 404 });
      await assert.rejects(service.readPair(user, back.id, front.id, transaction), { status: 404 });
      await service.consume(pair.front, pair.back, transaction);
      assert.deepEqual(await service.readPair(user, front.id, back.id, transaction), { replay: true });
      const back2 = await service.reserve(user, 'ciBack');
      await service.complete(back2, Buffer.from('back 2'), result);
      await assert.rejects(service.readPair(user, front.id, back2.id, transaction), { status: 409 });
      const front2 = await service.reserve(user, 'ciFront');
      await service.complete(front2, Buffer.from('front 2'), result);
      await adapter.query("UPDATE identity_ocr_sessions SET expires_at = now() - interval '1 minute', purge_at = now() - interval '1 minute' WHERE id = :id", { replacements: { id: front2.id } });
      await assert.rejects(service.readPair(user, front2.id, back2.id, transaction), { status: 410 });
      await service.purge();
      const [[expired]] = await adapter.query('SELECT payload FROM identity_ocr_sessions WHERE id = :id', { replacements: { id: front2.id } });
      assert.equal(expired.payload, null);
      for (let i = 4; i < 20; i++) await service.reserve(user, 'ciFront');
      await assert.rejects(service.reserve(user, 'ciFront'), { status: 429 });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally {
    if (previous === undefined) delete process.env.IDENTITY_STORAGE_KEY;
    else process.env.IDENTITY_STORAGE_KEY = previous;
    if (previousJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
    await db.close();
  }
});
