const path = require('path');
const sequelize = require('../config/database');

// Authentication must run first. Filenames alone never authorize access.
function createDocumentAccess(database) {
return async function documentAccess(req, res, next) {
  try {
    const filename = req.params.filename || path.posix.basename(req.path);
    if (!filename || filename !== path.basename(filename) || filename.includes('..')) return res.sendStatus(403);
    const [[owner]] = await database.query(`
      SELECT d.id FROM documents d JOIN users u ON u.id = :userId
      WHERE d.file_path = :filename AND (d.user_id = :userId OR u.role = 'admin'
        OR (d.document_type = 'profilePhoto' AND d.verification_status = 'verified')) LIMIT 1
    `, { replacements: { userId: req.user.id, filename } });
    if (!owner) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store');
    next();
  } catch { res.sendStatus(503); }
};
}
module.exports = createDocumentAccess(sequelize);
module.exports.createDocumentAccess = createDocumentAccess;
