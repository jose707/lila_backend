'use strict';
// Cada propiedad OCR tiene una columna escalar. No se almacenan objetos serializados.
const comunes = {
  fullName: 'nombre_detectado',
  issueDate: 'fecha_emision_detectada',
  birthDate: 'nacimiento_detectado'
};
module.exports = {
  licenseFront: {
    table: 'documento_licencia',
    primaryKey: 'id_documento_licencia',
    fields: {
      ...comunes,
      licenseNumber: 'numero_licencia',
      nationality: 'nacionalidad',
      licenseExpiryDate: 'fecha_vencimiento',
      licenseCategory: 'categoria'
    }
  },
  licenseBack: {
    table: 'documento_licencia',
    primaryKey: 'id_documento_licencia',
    fields: {
      ...comunes,
      licenseNumber: 'numero_licencia',
      nationality: 'nacionalidad',
      licenseExpiryDate: 'fecha_vencimiento',
      licenseCategory: 'categoria'
    }
  },
  ticPhoto: {
    table: 'documento_tic',
    primaryKey: 'id_documento_tic',
    fields: {
      licenseNumber: 'numero_licencia',
      issueDate: comunes.issueDate,
      ticNumber: 'numero_tic',
      issuingPlace: 'lugar_emision',
      firstNames: 'nombres_detectados',
      surnames: 'apellidos_detectados',
      category: 'categoria',
      expiryDate: 'fecha_vencimiento'
    }
  },
  antecedentsPhoto: {
    table: 'documento_antecedentes',
    primaryKey: 'id_documento_antecedentes',
    fields: {
      ...comunes,
      ciNumber: 'ci_detectado',
      nationality: 'nacionalidad',
      birthPlace: 'lugar_nacimiento',
      issuedIn: 'expedido_en',
      maritalStatus: 'estado_civil',
      occupation: 'ocupacion',
      address: 'direccion_detectada',
      procedureReason: 'motivo_tramite',
      recipient: 'destinatario',
      backgroundUnit: 'unidad_antecedentes',
      backgroundResult: 'resultado',
      validUntil: 'valido_hasta',
      certificateNumber: 'numero_certificado'
    }
  },
  ruatPhoto: {
    table: 'documento_ruat',
    primaryKey: 'id_documento_ruat',
    fields: {
      vehiclePlate: 'placa',
      vehicleBrand: 'marca',
      vehicleModel: 'modelo',
      vehicleYear: 'anio',
      vehicleColor: 'color',
      vehiclePassengerCapacity: 'capacidad',
      vehicleType: 'tipo_vehiculo',
      vehicleClass: 'clase_vehiculo',
      vehicleOwnerName: 'propietario_detectado',
      vehicleOwnerCi: 'ci_propietario_detectado',
      registrationMunicipality: 'municipio_registro',
      crpvaNumber: 'numero_crpva',
      ruatIssueDate: 'fecha_emision',
      ownershipStartDate: 'inicio_propiedad',
      doorCount: 'cantidad_puertas',
      serviceType: 'tipo_servicio',
      chassisNumber: 'numero_chasis',
      engineNumber: 'numero_motor',
      fuelType: 'combustible',
      engineDisplacement: 'cilindrada',
      engineType: 'tipo_motor',
      legalObservations: 'observaciones_legales'
    }
  },
  soatPhoto: {
    table: 'documento_soat',
    primaryKey: 'id_documento_soat',
    fields: {
      soatRosetteNumber: 'numero_roseta',
      soatYear: 'anio',
      soatDepartment: 'departamento',
      soatVehicleType: 'tipo_vehiculo',
      soatPlate: 'placa_detectada',
      soatStartDate: 'fecha_inicio',
      soatExpiryDate: 'fecha_vencimiento',
      soatUse: 'uso'
    }
  },
  domicileProof: {
    table: 'documento_domicilio',
    primaryKey: 'id_documento_domicilio',
    fields: {
      serviceAddress: 'direccion_servicio',
      billingMonth: 'mes_facturacion'
    }
  }
};
