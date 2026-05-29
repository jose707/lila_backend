// backend/src/routes/ratings.js
const express = require('express');
const router = express.Router();
const ratingsController = require('../controllers/ratingsController');
const { authMiddleware } = require('../middleware/auth');

// Create a new rating
router.post('/', authMiddleware, ratingsController.createRating);

// Get ratings for a specific driver
router.get('/driver/:driverId', ratingsController.getDriverRatings);

// Get driver's average rating
router.get(
  '/driver/:driverId/average',
  ratingsController.getDriverAverageRating,
);

// Check if a rating exists for a ride
router.get('/ride/:rideId/exists', ratingsController.checkRatingExists);

// Get calculated rating for the authenticated user
router.get('/me', authMiddleware, ratingsController.getMyRating);

module.exports = router;
