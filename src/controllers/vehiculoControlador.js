// backend/src/controllers/vehiculoControlador.js
const { Conductor: Conductor, Vehiculo: Vehiculo } = require('../models');

exports.crearVehiculo = async (req,res) => res.status(409).json({error:'El vehículo se crea al aprobar su solicitud y los datos se obtienen del RUAT aprobado.'});

exports.obtenerVehiculoPorId = async (solicitud, respuesta) => {
  try {
    const { id } = solicitud.params;

    const vehiculo = await Vehiculo.findByPk(id, {
      include: [{ model: Conductor, as: 'driver', attributes: ['id', 'userId'] }]
    });

    if (!vehiculo) {
      return respuesta.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    return respuesta.status(200).json({
      success: true,
      data: vehiculo
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error fetching vehicle:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching vehicle',
      error: error.message
    });
  }
};

exports.obtenerVehiculosConductor = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId } = solicitud.params;
    const { status: estado } = solicitud.query;

    // Check if driver exists
    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return respuesta.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const condiciones = { driver_id: conductorId };
    if (estado) {
      condiciones.status = estado;
    }

    const vehiculos = await Vehiculo.findAll({
      where: condiciones,
      order: [['created_at', 'DESC']]
    });

    return respuesta.status(200).json({
      success: true,
      data: vehiculos,
      count: vehiculos.length
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error fetching vehicles:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching vehicles',
      error: error.message
    });
  }
};

exports.actualizarVehiculo = async (solicitud, respuesta) => {
  try {
    const { id } = solicitud.params;
    const { status: estado } = solicitud.body;

    const vehiculo = await Vehiculo.findByPk(id);
    if (!vehiculo) {
      return respuesta.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    const datosRuat=['brand','model','year','color','plate','capacity','vehicle_type','registrationMunicipality','crpvaNumber','ruatIssueDate','ownershipStartDate','doorCount','serviceType','chassisNumber','engineNumber','fuelType','engineDisplacement','engineType','legalObservations'];
    if(datosRuat.some(key=>Object.hasOwn(solicitud.body,key))) return respuesta.status(409).json({error:'Las características se obtienen del RUAT aprobado. Para corregirlas, presenta un documento nuevo.'});
    if (estado) vehiculo.status = estado;

    await vehiculo.save();

    console.log('✅ [vehicleController] Vehicle updated:', id);

    return respuesta.status(200).json({
      success: true,
      message: 'Vehicle updated successfully',
      data: vehiculo
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error updating vehicle:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error updating vehicle',
      error: error.message
    });
  }
};

exports.eliminarVehiculo = async (solicitud, respuesta) => {
  try {
    const { id } = solicitud.params;

    const vehiculo = await Vehiculo.findByPk(id);
    if (!vehiculo) {
      return respuesta.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    await vehiculo.destroy();

    console.log('✅ [vehicleController] Vehicle deleted:', id);

    return respuesta.status(200).json({
      success: true,
      message: 'Vehicle deleted successfully'
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error deleting vehicle:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error deleting vehicle',
      error: error.message
    });
  }
};

exports.obtenerTodosVehiculos = async (solicitud, respuesta) => {
  try {
    const { status: estado, vehicle_type: vehiculo_Tipo } = solicitud.query;
    const { page: pagina = 1, limit: limite = 10 } = solicitud.query;

    const condiciones = {};
    if (estado) condiciones.status = estado;
    if (vehiculo_Tipo) condiciones.vehicle_type = vehiculo_Tipo;

    const desplazamiento = (pagina - 1) * limite;

    const { count: cantidad, rows: filas } = await Vehiculo.findAndCountAll({
      where: condiciones,
      include: [{ model: Conductor, as: 'driver', attributes: ['id', 'userId'] }],
      limit: parseInt(limite),
      offset: parseInt(desplazamiento),
      order: [['created_at', 'DESC']]
    });

    return respuesta.status(200).json({
      success: true,
      data: filas,
      pagination: {
        total: cantidad,
        page: parseInt(pagina),
        limit: parseInt(limite),
        pages: Math.ceil(cantidad / limite)
      }
    });
  } catch (error) {
    console.error('❌ [vehicleController] Error fetching all vehicles:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching vehicles',
      error: error.message
    });
  }
};
