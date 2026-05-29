// backend/src/controllers/vehicleController.js
const { Driver, Vehicle } = require('../models');

exports.createVehicle = async (req, res) => {
  try {
    const {
      driverId,
      brand,
      model,
      year,
      color,
      plate,
      capacity,
      vehicle_type,
      status,
    } = req.body;

    // Validate required fields
    if (!driverId || !brand || !model || !year || !plate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: driverId, brand, model, year, plate',
      });
    }

    // Check if driver exists
    const driver = await Driver.findByPk(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    // Check if plate already exists
    const existingVehicle = await Vehicle.findOne({ where: { plate } });
    if (existingVehicle) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle with this plate already exists',
      });
    }

    // Create vehicle
    const vehicle = await Vehicle.create({
      driver_id: driverId,
      brand,
      model,
      year,
      color,
      plate,
      capacity: capacity || 4,
      vehicle_type: vehicle_type || 'taxi',
      status: status || 'active',
    });

    console.log('✅ [vehicleController] Vehicle created:', vehicle.id);

    return res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      data: vehicle,
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error creating vehicle:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating vehicle',
      error: error.message,
    });
  }
};

exports.getVehicleById = async (req, res) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findByPk(id, {
      include: [{ model: Driver, as: 'driver', attributes: ['id', 'userId'] }],
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: vehicle,
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error fetching vehicle:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching vehicle',
      error: error.message,
    });
  }
};

exports.getVehiclesByDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status } = req.query;

    // Check if driver exists
    const driver = await Driver.findByPk(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    const where = { driver_id: driverId };
    if (status) {
      where.status = status;
    }

    const vehicles = await Vehicle.findAll({
      where,
      order: [['created_at', 'DESC']],
    });

    return res.status(200).json({
      success: true,
      data: vehicles,
      count: vehicles.length,
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error fetching vehicles:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching vehicles',
      error: error.message,
    });
  }
};

exports.updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { brand, model, year, color, plate, capacity, vehicle_type, status } =
      req.body;

    const vehicle = await Vehicle.findByPk(id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Check if plate is unique (if being updated)
    if (plate && plate !== vehicle.plate) {
      const existingVehicle = await Vehicle.findOne({ where: { plate } });
      if (existingVehicle) {
        return res.status(400).json({
          success: false,
          message: 'Vehicle with this plate already exists',
        });
      }
    }

    // Update fields
    if (brand) vehicle.brand = brand;
    if (model) vehicle.model = model;
    if (year) vehicle.year = year;
    if (color) vehicle.color = color;
    if (plate) vehicle.plate = plate;
    if (capacity) vehicle.capacity = capacity;
    if (vehicle_type) vehicle.vehicle_type = vehicle_type;
    if (status) vehicle.status = status;

    await vehicle.save();

    console.log('✅ [vehicleController] Vehicle updated:', id);

    return res.status(200).json({
      success: true,
      message: 'Vehicle updated successfully',
      data: vehicle,
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error updating vehicle:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating vehicle',
      error: error.message,
    });
  }
};

exports.deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findByPk(id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    await vehicle.destroy();

    console.log('✅ [vehicleController] Vehicle deleted:', id);

    return res.status(200).json({
      success: true,
      message: 'Vehicle deleted successfully',
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error deleting vehicle:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting vehicle',
      error: error.message,
    });
  }
};

exports.getAllVehicles = async (req, res) => {
  try {
    const { status, vehicle_type } = req.query;
    const { page = 1, limit = 10 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (vehicle_type) where.vehicle_type = vehicle_type;

    const offset = (page - 1) * limit;

    const { count, rows } = await Vehicle.findAndCountAll({
      where,
      include: [{ model: Driver, as: 'driver', attributes: ['id', 'userId'] }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']],
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error fetching all vehicles:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching vehicles',
      error: error.message,
    });
  }
};
