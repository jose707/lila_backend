'use strict';
const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');
const places = require('../services/placesService');
router.use(authMiddleware);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
for (const action of ['autocomplete', 'details']) {
  router.post(`/${action}`, async (req, res) => {
    try {
      res.json({
        [action === 'autocomplete' ? 'suggestions' : 'place']: await places[
          action
        ](req.body || {}),
      });
    } catch (error) {
      res
        .status(error.status || 500)
        .json({
          error: error.status
            ? error.message
            : 'No se pudo procesar la búsqueda.',
        });
    }
  });
}
module.exports = router;
