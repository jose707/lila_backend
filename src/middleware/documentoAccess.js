const ruta = require('path');
const sequelize = require("../config/baseDatos");

// Authentication must run first. Filenames alone never authorize access.
function crearDocumentoAcceso(baseDatos) {
  return async function documentoAcceso(solicitud, respuesta, siguiente) {
    try {
      const nombreArchivo = solicitud.params.filename || ruta.posix.basename(solicitud.path);
      if (!nombreArchivo || nombreArchivo !== ruta.basename(nombreArchivo) || nombreArchivo.includes('..')) return respuesta.sendStatus(403);
      const [[propietario]] = await baseDatos.query(`
      SELECT d.id FROM documento d JOIN usuario u ON u.id = :userId
      WHERE d.file_path = :filename AND (d.user_id = :userId OR u.role = 'administrador'
        OR (d.document_type = 'profilePhoto' AND d.verification_status = 'verificado')) LIMIT 1
    `, { replacements: { userId: solicitud.user.id, filename: nombreArchivo } });
      if (!propietario) return respuesta.sendStatus(404);
      respuesta.set('Cache-Control', 'private, no-store');
      siguiente();
    } catch {respuesta.sendStatus(503);}
  };
}
module.exports = crearDocumentoAcceso(sequelize);
module.exports.createDocumentAccess = crearDocumentoAcceso;
