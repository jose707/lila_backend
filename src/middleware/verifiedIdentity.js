const UserIdentity = require('../models/UserIdentity');
module.exports = async (req, res, next) => {
  // Temporalmente permite continuar a pasajeros con celular verificado.
  // Al reactivar CI + prueba de vida, establecer IDENTITY_VERIFICATION_ENABLED=true.
  if (process.env.IDENTITY_VERIFICATION_ENABLED !== 'true') return next();
  try {
    const identity = await UserIdentity.findOne({ where: { userId: req.user.id } });
    if (identity?.verificationStatus !== 'verified') return res.status(403).json({ error: 'Completa la verificación de identidad antes de iniciar esta operación.' });
    next();
  } catch { res.status(503).json({ error: 'No se pudo comprobar la identidad. Intenta nuevamente.' }); }
};
