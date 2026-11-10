'use strict';

/**
 * Migración maestra — esquema completo de la BD.
 * Generada a partir del estado actual de la base de datos (dataBase.md).
 * Crea directamente los nombres físicos finales, sin renombrados posteriores.
 * Incluye módulo de emergencias (botón SOS, contactos y SMS).
 *
 * ⚠️  Esta migración asume que la BD está vacía (fresh install).
 *     Si ya tienes tablas, NO la ejecutes — solo sirve para recrear
 *     el esquema desde cero en un entorno nuevo.
 *
 * Requiere: extensión PostGIS instalada en el servidor PostgreSQL.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async instalacion => {
    const q = sql => queryInterface.sequelize.query(sql, { esquemaFisico: true, transaction: instalacion });

    // ─── Extensiones ──────────────────────────────────────────────────────────
    await q(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    await q(`CREATE EXTENSION IF NOT EXISTS postgis;`);

    // ─── ENUMs ────────────────────────────────────────────────────────────────
    await q(
      `CREATE TYPE usuario_rol               AS ENUM ('pasajero', 'conductor', 'administrador');`,
    );
    await q(
      `CREATE TYPE conductor_estado           AS ENUM ('pendiente', 'aprobado', 'rechazado', 'suspendido');`,
    );
    await q(
      `CREATE TYPE tipo_vehiculo            AS ENUM ('taxi', 'minibus', 'bus', 'motocicleta');`,
    );
    await q(
      `CREATE TYPE vehiculo_estado          AS ENUM ('activo', 'inactivo', 'pendiente_revision', 'suspendido');`,
    );
    await q(
      `CREATE TYPE enum_viaje_estado       AS ENUM ('solicitado', 'ofertado', 'aceptado', 'llegado', 'en_curso', 'completado', 'cancelado', 'vencido');`,
    );
    await q(
      `CREATE TYPE cancelado_por_tipo       AS ENUM ('pasajero', 'conductor', 'sistema');`,
    );
    await q(
      `CREATE TYPE viaje_oferta_estado       AS ENUM ('pendiente', 'aceptado', 'rechazado', 'vencido', 'cancelado');`,
    );
    await q(`CREATE TYPE metodo_pago          AS ENUM ('efectivo', 'qr');`);
    await q(
      `CREATE TYPE estado_pago          AS ENUM ('pendiente', 'completado', 'fallido', 'reembolsado');`,
    );
    await q(
      `CREATE TYPE tipo_calificador              AS ENUM ('pasajero', 'conductor');`,
    );
    await q(
      `CREATE TYPE estado_comision       AS ENUM ('pendiente', 'cobrado');`,
    );
    await q(
      `CREATE TYPE liquidacion_estado       AS ENUM ('abierto', 'pendiente_pago', 'pagado', 'atrasado');`,
    );
    await q(
      `CREATE TYPE liquidacion_metodo_pago AS ENUM ('efectivo', 'qr', 'transferencia');`,
    );
    await q(
      `CREATE TYPE aplicable_a           AS ENUM ('pasajero', 'conductor', 'ambos');`,
    );
    await q(
      `CREATE TYPE notificacion_tipo       AS ENUM ('solicitud_viaje', 'viaje_aceptado', 'viaje_cancelado', 'pago', 'sistema', 'emergencia', 'panico');`,
    );
    await q(
      `CREATE TYPE auditoria_accion            AS ENUM ('INSERCION', 'ACTUALIZACION', 'ELIMINACION');`,
    );
    await q(
      `CREATE TYPE conductor_solicitud_estado   AS ENUM ('pendiente', 'observado', 'aprobado', 'rechazado');`,
    );

    // ─── ENUMs módulo emergencias ─────────────────────────────────────────────
    await q(
      `CREATE TYPE emergencia_alerta_estado  AS ENUM ('activo', 'resuelto', 'falsa_alarma');`,
    );
    await q(
      `CREATE TYPE sms_estado              AS ENUM ('pendiente', 'enviado', 'fallido');`,
    );

    // ─── USERS ────────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE usuario (
        id_usuario              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        firebase_uid    VARCHAR(255) NOT NULL UNIQUE,
        fcm_token       VARCHAR(255),
        correo           VARCHAR(255) UNIQUE,
        telefono           VARCHAR(30)  UNIQUE,
        contrasena        VARCHAR(255),
        rol            usuario_rol    NOT NULL DEFAULT 'pasajero',
        modo_actual    VARCHAR(50),
        foto_perfil   VARCHAR(500),
        activo       BOOLEAN      NOT NULL DEFAULT true,
        telefono_verificado  BOOLEAN      NOT NULL DEFAULT false,
        ultimo_acceso      TIMESTAMPTZ,
        eliminado_en      TIMESTAMPTZ,
        creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        actualizado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ─── DRIVERS ──────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE conductor (
        id_conductor                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_usuario           UUID          NOT NULL UNIQUE REFERENCES usuario(id_usuario) ON DELETE CASCADE,
        estado            conductor_estado NOT NULL DEFAULT 'pendiente',
        disponible      BOOLEAN       NOT NULL DEFAULT false,
        motivo_rechazo  VARCHAR(500),
        eliminado_en        TIMESTAMPTZ,
        creado_en        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        actualizado_en        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);

    // ─── VEHICLES ─────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE vehiculo (
        id_vehiculo                    UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_conductor             UUID                  NOT NULL REFERENCES conductor(id_conductor) ON DELETE CASCADE,
        estado                vehiculo_estado        NOT NULL DEFAULT 'activo',
        eliminado_en            TIMESTAMPTZ,
        creado_en            TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        actualizado_en            TIMESTAMPTZ           NOT NULL DEFAULT NOW()
      );
    `);

    // ─── DRIVER LOCATIONS ─────────────────────────────────────────────────────
    await q(`
      CREATE TABLE ubicacion_conductor (
        id_conductor  UUID      PRIMARY KEY REFERENCES conductor(id_conductor) ON DELETE CASCADE,
        ubicacion   GEOMETRY(POINT, 4326) NOT NULL,
        rumbo    DOUBLE PRECISION,
        velocidad      DOUBLE PRECISION,
        conectado  BOOLEAN   NOT NULL DEFAULT true,
        ubicacion_registrada_en TIMESTAMPTZ,
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await q(
      `CREATE INDEX idx_ubicacion_conductor_geografico ON ubicacion_conductor USING GIST(ubicacion);`,
    );
    await q(`CREATE INDEX ubicacion_conductor_geografia_idx ON ubicacion_conductor USING GIST ((ubicacion::geography));`);

    // ─── DRIVER REQUESTS ──────────────────────────────────────────────────────
    await q(`
      CREATE TABLE solicitud_conductor (
        id_solicitud_conductor                  UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_usuario             UUID                  NOT NULL REFERENCES usuario(id_usuario),
        estado              conductor_solicitud_estado NOT NULL DEFAULT 'pendiente',
        motivo_rechazo    TEXT,
        estado_ocr VARCHAR(20) NOT NULL DEFAULT 'pendiente' CONSTRAINT solicitud_conductor_estado_ocr_valido CHECK (estado_ocr IN ('pendiente','complete','fallido')),
        ocr_procesado_en TIMESTAMPTZ,
        version             INTEGER               NOT NULL DEFAULT 1,
        creado_en          TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        actualizado_en          TIMESTAMPTZ           NOT NULL DEFAULT NOW()
      );
    `);

    await q(`
      CREATE TABLE documento (
        id_documento UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tipo_documento VARCHAR(40) NOT NULL CHECK (tipo_documento IN ('ciFront', 'ciBack', 'profilePhoto', 'licenseFront', 'licenseBack', 'ticPhoto', 'antecedentsPhoto', 'ruatPhoto', 'soatPhoto', 'domicileProof', 'carFront', 'carBack', 'carLeft', 'carRight', 'commissionProof', 'psychologicalReport', 'ci')),
        ruta_archivo VARCHAR(500), tipo_mime VARCHAR(100),
        id_documento_principal UUID REFERENCES documento(id_documento),
        evidencia_cifrada TEXT, origen_evidencia VARCHAR(100) CONSTRAINT documento_origen_evidencia_valido CHECK (origen_evidencia IN ('captura_camara','archivo_subido','prueba_vida','semilla_desarrollo')), consentimiento_version VARCHAR(100), consentimiento_en TIMESTAMPTZ,
        texto_ocr TEXT,
        vigente BOOLEAN NOT NULL DEFAULT TRUE,
        estado_verificacion VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado_verificacion IN ('pendiente', 'verificado', 'rechazado')),
        verificado_en TIMESTAMPTZ, id_usuario_verificador UUID REFERENCES usuario(id_usuario), motivo_rechazo TEXT,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(), actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await q(`CREATE TABLE usuario_documento (id_documento UUID PRIMARY KEY REFERENCES documento(id_documento), id_usuario UUID NOT NULL REFERENCES usuario(id_usuario));
      CREATE TABLE conductor_documento (id_documento UUID PRIMARY KEY REFERENCES documento(id_documento), id_conductor UUID NOT NULL REFERENCES conductor(id_conductor));
      CREATE TABLE vehiculo_documento (id_documento UUID PRIMARY KEY REFERENCES documento(id_documento), id_vehiculo UUID NOT NULL REFERENCES vehiculo(id_vehiculo));
      CREATE TABLE solicitud_documento (
        id_solicitud_conductor UUID NOT NULL REFERENCES solicitud_conductor(id_solicitud_conductor),
        id_documento UUID NOT NULL REFERENCES documento(id_documento),
        PRIMARY KEY(id_solicitud_conductor,id_documento)
      );
      CREATE INDEX usuario_documento_usuario ON usuario_documento(id_usuario);
      CREATE INDEX conductor_documento_conductor ON conductor_documento(id_conductor);
      CREATE INDEX vehiculo_documento_vehiculo ON vehiculo_documento(id_vehiculo);
`);
    await q(`CREATE FUNCTION validar_solicitud_documento() RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$
      DECLARE tipo TEXT;
      BEGIN
        PERFORM 1 FROM solicitud_conductor WHERE id_solicitud_conductor=NEW.id_solicitud_conductor FOR UPDATE;
        SELECT tipo_documento INTO tipo FROM documento WHERE id_documento=NEW.id_documento;
        IF tipo <> 'psychologicalReport' AND EXISTS (SELECT 1 FROM solicitud_documento sd JOIN documento d USING(id_documento)
          WHERE sd.id_solicitud_conductor=NEW.id_solicitud_conductor AND d.tipo_documento=tipo AND sd.id_documento<>NEW.id_documento) THEN
          RAISE EXCEPTION 'La solicitud ya contiene un documento de este tipo';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER solicitud_documento_tipo_unico BEFORE INSERT OR UPDATE ON solicitud_documento FOR EACH ROW EXECUTE FUNCTION validar_solicitud_documento();
      CREATE FUNCTION validar_propietario_documento() RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$
      BEGIN
        PERFORM 1 FROM documento WHERE id_documento=NEW.id_documento FOR UPDATE;
        IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'El propietario documental no se modifica; cree una nueva presentación';
        END IF;
        IF TG_TABLE_NAME='usuario_documento' THEN
          PERFORM 1 FROM usuario WHERE id_usuario=NEW.id_usuario FOR UPDATE;
          IF EXISTS(SELECT 1 FROM documento WHERE id_documento=NEW.id_documento AND tipo_documento='ci') AND
             EXISTS(SELECT 1 FROM usuario_documento ud JOIN documento d USING(id_documento) WHERE ud.id_usuario=NEW.id_usuario AND d.tipo_documento='ci' AND ud.id_documento<>NEW.id_documento) THEN
            RAISE EXCEPTION 'El usuario ya tiene un documento de identidad principal';
          END IF;
        END IF;
        IF (TG_TABLE_NAME <> 'usuario_documento' AND EXISTS(SELECT 1 FROM usuario_documento WHERE id_documento=NEW.id_documento)) OR
           (TG_TABLE_NAME <> 'conductor_documento' AND EXISTS(SELECT 1 FROM conductor_documento WHERE id_documento=NEW.id_documento)) OR
           (TG_TABLE_NAME <> 'vehiculo_documento' AND EXISTS(SELECT 1 FROM vehiculo_documento WHERE id_documento=NEW.id_documento)) THEN
          RAISE EXCEPTION 'El documento ya tiene otro propietario';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER propietario_usuario_documento BEFORE INSERT OR UPDATE ON usuario_documento FOR EACH ROW EXECUTE FUNCTION validar_propietario_documento();
      CREATE TRIGGER propietario_conductor_documento BEFORE INSERT OR UPDATE ON conductor_documento FOR EACH ROW EXECUTE FUNCTION validar_propietario_documento();
      CREATE TRIGGER propietario_vehiculo_documento BEFORE INSERT OR UPDATE ON vehiculo_documento FOR EACH ROW EXECUTE FUNCTION validar_propietario_documento();`);
    await q(`CREATE TABLE documento_licencia (id_documento_licencia UUID PRIMARY KEY REFERENCES documento(id_documento),
      nombre_detectado TEXT,
      numero_licencia TEXT,
      fecha_emision_detectada TEXT,
      nacimiento_detectado TEXT,
      nacionalidad TEXT,
      fecha_vencimiento TEXT,
      categoria TEXT);`);
    await q(`CREATE TABLE documento_tic (id_documento_tic UUID PRIMARY KEY REFERENCES documento(id_documento),
      numero_licencia TEXT,
      fecha_emision_detectada TEXT,
      numero_tic TEXT,
      lugar_emision TEXT,
      nombres_detectados TEXT,
      apellidos_detectados TEXT,
      categoria TEXT,
      fecha_vencimiento TEXT);`);
    await q(`CREATE TABLE documento_antecedentes (id_documento_antecedentes UUID PRIMARY KEY REFERENCES documento(id_documento),
      nombre_detectado TEXT,
      ci_detectado TEXT,
      fecha_emision_detectada TEXT,
      nacimiento_detectado TEXT,
      nacionalidad TEXT,
      lugar_nacimiento TEXT,
      expedido_en TEXT,
      estado_civil TEXT,
      ocupacion TEXT,
      direccion_detectada TEXT,
      motivo_tramite TEXT,
      destinatario TEXT,
      unidad_antecedentes TEXT,
      resultado TEXT,
      valido_hasta TEXT,
      numero_certificado TEXT);`);
    await q(`CREATE TABLE documento_ruat (id_documento_ruat UUID PRIMARY KEY REFERENCES documento(id_documento),
      placa TEXT,
      marca TEXT,
      modelo TEXT,
      anio TEXT,
      color TEXT,
      capacidad TEXT,
      tipo_vehiculo TEXT,
      clase_vehiculo TEXT,
      propietario_detectado TEXT,
      ci_propietario_detectado TEXT,
      municipio_registro TEXT,
      numero_crpva TEXT,
      fecha_emision TEXT,
      inicio_propiedad TEXT,
      cantidad_puertas TEXT,
      tipo_servicio TEXT,
      numero_chasis TEXT,
      numero_motor TEXT,
      combustible TEXT,
      cilindrada TEXT,
      tipo_motor TEXT,
      observaciones_legales TEXT);`);
    await q(`CREATE FUNCTION validar_placa_ruat(p_documento UUID,p_vehiculo UUID) RETURNS void LANGUAGE plpgsql SET search_path TO public AS $$
      DECLARE p TEXT;
      BEGIN
        SELECT upper(regexp_replace(r.placa,'[^a-zA-Z0-9]','','g')) INTO p FROM documento_ruat r JOIN documento d ON d.id_documento=r.id_documento_ruat
          WHERE r.id_documento_ruat=p_documento AND d.vigente AND d.estado_verificacion='verificado';
        IF p IS NULL OR p='' THEN RETURN; END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(p,0));
        IF EXISTS(SELECT 1 FROM documento_ruat r JOIN documento d ON d.id_documento=r.id_documento_ruat JOIN vehiculo_documento vd ON vd.id_documento=d.id_documento JOIN vehiculo v USING(id_vehiculo)
          WHERE upper(regexp_replace(r.placa,'[^a-zA-Z0-9]','','g'))=p AND vd.id_vehiculo<>p_vehiculo AND v.eliminado_en IS NULL AND d.vigente AND d.estado_verificacion='verificado') THEN
          RAISE EXCEPTION 'La placa ya pertenece a otro vehículo' USING ERRCODE='23505';
        END IF;
      END $$;
      CREATE FUNCTION comprobar_placa_ruat() RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$
      DECLARE v UUID; documento_id UUID;
      BEGIN
        IF TG_TABLE_NAME='documento_ruat' THEN documento_id:=NEW.id_documento_ruat;
        ELSE documento_id:=NEW.id_documento; END IF;
        IF TG_TABLE_NAME='vehiculo_documento' THEN v:=NEW.id_vehiculo;
        ELSE SELECT id_vehiculo INTO v FROM vehiculo_documento WHERE id_documento=documento_id; END IF;
        IF v IS NOT NULL THEN PERFORM validar_placa_ruat(documento_id,v); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER placa_ruat_propietario AFTER INSERT OR UPDATE ON vehiculo_documento FOR EACH ROW EXECUTE FUNCTION comprobar_placa_ruat();
      CREATE TRIGGER placa_ruat_aprobacion AFTER UPDATE ON documento FOR EACH ROW EXECUTE FUNCTION comprobar_placa_ruat();
      CREATE TRIGGER placa_ruat_datos AFTER INSERT OR UPDATE ON documento_ruat FOR EACH ROW EXECUTE FUNCTION comprobar_placa_ruat();`);
    await q(`CREATE TABLE documento_soat (id_documento_soat UUID PRIMARY KEY REFERENCES documento(id_documento),
      numero_roseta TEXT,
      anio TEXT,
      departamento TEXT,
      tipo_vehiculo TEXT,
      placa_detectada TEXT,
      fecha_inicio TEXT,
      fecha_vencimiento TEXT,
      uso TEXT);`);
    await q(`CREATE TABLE documento_domicilio (id_documento_domicilio UUID PRIMARY KEY REFERENCES documento(id_documento),
      direccion_servicio TEXT,
      mes_facturacion TEXT,
      direccion VARCHAR(255), ubicacion GEOMETRY(POINT,4326));`);
    await q(`CREATE TABLE documento_informe_psicologico (
      id_documento_informe_psicologico UUID PRIMARY KEY REFERENCES documento(id_documento), numero_informe VARCHAR(100),
      resultado VARCHAR(30) NOT NULL CHECK(resultado IN ('apto','no_apto','requiere_reevaluacion')),
      fecha_emision DATE, valida_hasta DATE,
      CHECK(valida_hasta IS NULL OR valida_hasta >= fecha_emision)
    );
    CREATE TABLE evaluacion_psicologica (
      id_evaluacion_psicologica UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      id_solicitud_conductor UUID NOT NULL REFERENCES solicitud_conductor(id_solicitud_conductor),
      id_usuario_evaluador UUID NOT NULL REFERENCES usuario(id_usuario),
      programada_en TIMESTAMPTZ, realizada_en TIMESTAMPTZ,
      estado VARCHAR(20) NOT NULL CHECK(estado IN ('programada','realizada','cancelada')),
      id_documento_informe UUID UNIQUE REFERENCES documento_informe_psicologico(id_documento_informe_psicologico),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(), actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK((estado='realizada') = (realizada_en IS NOT NULL AND id_documento_informe IS NOT NULL))
    );`);
    // Datos oficiales obtenidos de la cédula; una identidad por usuario.
    await q(`
      CREATE TABLE documento_ci (
        id_documento_ci UUID PRIMARY KEY REFERENCES documento(id_documento),
        nombres VARCHAR(150) NOT NULL,
        apellido_paterno VARCHAR(100), apellido_materno VARCHAR(100),
        numero_ci VARCHAR(20) NOT NULL UNIQUE, fecha_nacimiento DATE NOT NULL,
        fecha_emision DATE, fecha_vencimiento DATE, lugar_nacimiento VARCHAR(150),
        direccion VARCHAR(255), ocupacion VARCHAR(150), estado_civil VARCHAR(50), grupo_sanguineo VARCHAR(5),
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(), actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ─── SERVICE AREAS ────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE zona_servicio (
        id_zona_servicio               UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
        nombre             VARCHAR(100)            NOT NULL,
        limite         GEOMETRY(POLYGON, 4326) NOT NULL,
        activo        BOOLEAN                 NOT NULL DEFAULT true,
        tarifa_base        DOUBLE PRECISION        CHECK (tarifa_base > 0),
        tarifa_km      DOUBLE PRECISION        CHECK (tarifa_km > 0),
        tarifa_minuto  DOUBLE PRECISION        CHECK (tarifa_minuto > 0),
        moneda         VARCHAR(10)             NOT NULL DEFAULT 'BOB',
        tasa_comision NUMERIC(9,6) NOT NULL DEFAULT 0.02 CHECK (tasa_comision BETWEEN 0 AND 1),
        creado_en       TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
        actualizado_en       TIMESTAMPTZ             NOT NULL DEFAULT NOW()
      );
    `);
    await q(
      `CREATE INDEX idx_zona_servicio_limite ON zona_servicio USING GIST(limite);`,
    );
    await q(
      `CREATE INDEX idx_zona_servicio_activo   ON zona_servicio(activo);`,
    );

    // ─── CANCELLATION REASONS ─────────────────────────────────────────────────
    await q(`
      CREATE TABLE motivo_cancelacion (
        id_motivo_cancelacion            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
        codigo          VARCHAR(50)    NOT NULL UNIQUE,
        descripcion   TEXT           NOT NULL,
        aplicable_a aplicable_a,
        activo     BOOLEAN        NOT NULL DEFAULT true,
        creado_en    TIMESTAMPTZ    DEFAULT NOW()
      );
    `);

    // ─── RIDES ────────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE viaje (
        id_viaje                        UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_pasajero              UUID             NOT NULL REFERENCES usuario(id_usuario),
        id_conductor                 UUID             REFERENCES conductor(id_conductor),
        estado                    enum_viaje_estado NOT NULL DEFAULT 'solicitado',
        ubicacion_recogida           GEOMETRY(POINT, 4326) NOT NULL,
        direccion_recogida            TEXT             NOT NULL,
        ubicacion_destino          GEOMETRY(POINT, 4326) NOT NULL,
        direccion_destino           TEXT             NOT NULL,
        tipo_vehiculo_solicitado    tipo_vehiculo,
        metodo_pago            metodo_pago     NOT NULL DEFAULT 'efectivo',
        tarifa_base                 DOUBLE PRECISION,
        tarifa_km               DOUBLE PRECISION,
        tarifa_minuto           DOUBLE PRECISION,
        tarifa_total                DOUBLE PRECISION,
        tarifa_final                DOUBLE PRECISION NOT NULL,
        distancia                  DOUBLE PRECISION,
        duracion                  INTEGER,
        id_zona_servicio           UUID             REFERENCES zona_servicio(id_zona_servicio),
        id_motivo_cancelacion    UUID             REFERENCES motivo_cancelacion(id_motivo_cancelacion),
        cancelado_por              cancelado_por_tipo,
        modo_solicitud              TEXT NOT NULL DEFAULT 'negociacion',
        clave_solicitud               TEXT,
        distancia_recogida           DOUBLE PRECISION,
        duracion_recogida           INTEGER,
        aceptado_en               TIMESTAMPTZ,
        llegada_en                TIMESTAMPTZ,
        pasajero_listo_en        TIMESTAMPTZ,
        iniciado_en                TIMESTAMPTZ,
        ruta_recorrida            GEOMETRY(LINESTRING, 4326),
        completado_en              TIMESTAMPTZ,
        cancelado_en              TIMESTAMPTZ,
        vence_en                TIMESTAMPTZ,

        eliminado_en                TIMESTAMPTZ,
        creado_en                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        actualizado_en                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

        CONSTRAINT comprobacion_cancelled_consistency
          CHECK (
            (cancelado_por IS NULL AND cancelado_en IS NULL)
            OR (cancelado_por IS NOT NULL AND cancelado_en IS NOT NULL)
          ),
        CONSTRAINT comprobacion_motivo_requires_cancelacion
          CHECK (
            id_motivo_cancelacion IS NULL OR cancelado_por IS NOT NULL
          )
      );
    `);
    await q(`CREATE INDEX idx_viaje_pasajero    ON viaje(id_pasajero);`);
    await q(`CREATE INDEX idx_viaje_conductor       ON viaje(id_conductor);`);
    await q(`CREATE INDEX idx_viaje_estado       ON viaje(estado);`);
    await q(`CREATE INDEX idx_viaje_service_area ON viaje(id_zona_servicio);`);

    // ─── RIDE OFFERS ──────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE oferta_viaje (
        id_oferta_viaje             UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_viaje        UUID              NOT NULL REFERENCES viaje(id_viaje) ON DELETE CASCADE,
        id_conductor      UUID              NOT NULL REFERENCES conductor(id_conductor) ON DELETE CASCADE,
        precio_ofertado  NUMERIC(10,2)     NOT NULL,
        estado         viaje_oferta_estado NOT NULL DEFAULT 'pendiente',
        mensaje        TEXT,
        vence_en     TIMESTAMPTZ       NOT NULL,
        creado_en     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        actualizado_en     TIMESTAMPTZ       NOT NULL DEFAULT NOW()
      );
    `);
    await q(
      `CREATE INDEX idx_oferta_viaje_viaje_estado ON oferta_viaje(id_viaje, estado);`,
    );

    // ─── Asignación rápida y protección de conductores ocupados ──────────────
    await q(`CREATE UNIQUE INDEX viaje_clave_solicitud_unico ON viaje(id_pasajero, clave_solicitud) WHERE clave_solicitud IS NOT NULL;`);
    await q(`
      CREATE UNIQUE INDEX viaje_conductor_ocupado_unico ON viaje(id_conductor)
      WHERE eliminado_en IS NULL AND id_conductor IS NOT NULL AND
        (estado IN ('aceptado','llegado','en_curso') OR (modo_solicitud = 'asignacion_rapida' AND estado = 'solicitado'));
    `);
    await q(`
      CREATE UNIQUE INDEX viaje_un_ocupado_pasajero ON viaje(id_pasajero)
      WHERE eliminado_en IS NULL AND
        (estado IN ('aceptado','llegado','en_curso') OR (modo_solicitud = 'asignacion_rapida' AND estado = 'solicitado'));
    `);
    await q(`
      CREATE OR REPLACE FUNCTION validar_disponibilidad_oferta() RETURNS trigger AS $$
      BEGIN
        IF NEW.estado IN ('pendiente', 'aceptado') THEN
          PERFORM 1 FROM conductor WHERE id_conductor = NEW.id_conductor FOR UPDATE;
          IF EXISTS (SELECT 1 FROM viaje WHERE id_viaje = NEW.id_viaje AND modo_solicitud = 'asignacion_rapida') THEN
            RAISE EXCEPTION 'La asignación rápida no admite ofertas' USING ERRCODE = '23514';
          END IF;
          IF EXISTS (
            SELECT 1 FROM viaje WHERE id_conductor = NEW.id_conductor AND eliminado_en IS NULL
              AND (estado IN ('aceptado','llegado','en_curso') OR
                (modo_solicitud = 'asignacion_rapida' AND estado = 'solicitado' AND vence_en > clock_timestamp()))
          ) THEN
            RAISE EXCEPTION 'El conductor está ocupado o reservado' USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SET search_path TO public;
    `);
    await q(`
      CREATE TRIGGER oferta_viaje_disponible_validar BEFORE INSERT OR UPDATE ON oferta_viaje
      FOR EACH ROW EXECUTE FUNCTION validar_disponibilidad_oferta();
    `);

    // ─── PAYMENTS ─────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE pago (
        id_pago              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_viaje         UUID           NOT NULL UNIQUE REFERENCES viaje(id_viaje) ON DELETE CASCADE,
        importe          DOUBLE PRECISION NOT NULL,
        moneda        VARCHAR(10)    NOT NULL DEFAULT 'BOB',
        estado_pago  estado_pago NOT NULL DEFAULT 'pendiente',
        transaccion_id  VARCHAR(255),
        pagado_en         TIMESTAMPTZ,
        creado_en      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        actualizado_en      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      );
    `);

    // ─── RATINGS ──────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE calificacion (
        id_calificacion            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_viaje       UUID        NOT NULL REFERENCES viaje(id_viaje) ON DELETE CASCADE,
        calificacion        DOUBLE PRECISION NOT NULL,
        tipo_calificador    tipo_calificador  NOT NULL,
        comentario       TEXT,
        creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT comprobacion_calificacion_range CHECK (calificacion >= 1.0 AND calificacion <= 5.0)
      );
    `);
    await q(
      `CREATE UNIQUE INDEX unico_calificacion_per_viaje ON calificacion(id_viaje, tipo_calificador);`,
    );
    await q(`CREATE INDEX idx_calificacion_viaje ON calificacion(id_viaje);`);

    // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE notificacion (
        id_notificacion         UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_usuario    UUID              NOT NULL REFERENCES usuario(id_usuario),
        titulo      VARCHAR(255)      NOT NULL,
        cuerpo       TEXT              NOT NULL,
        tipo       notificacion_tipo NOT NULL,
        accion VARCHAR(100),
        id_viaje UUID REFERENCES viaje(id_viaje),
        id_oferta_viaje UUID REFERENCES oferta_viaje(id_oferta_viaje),
        id_solicitud_conductor UUID REFERENCES solicitud_conductor(id_solicitud_conductor),
        id_alerta_emergencia UUID,
        id_comision UUID,
        CHECK (num_nonnulls(id_viaje, id_oferta_viaje, id_solicitud_conductor, id_alerta_emergencia, id_comision) <= 1),
        enviado_en    TIMESTAMPTZ,
        leido_en    TIMESTAMPTZ,
        creado_en TIMESTAMPTZ       NOT NULL DEFAULT NOW()
      );
    `);
    await q(`CREATE INDEX idx_notificacion_usuario ON notificacion(id_usuario);`);

    // ─── COMMISSION SETTLEMENTS ───────────────────────────────────────────────
    await q(`
      CREATE TABLE comision (
        id_comision               UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_conductor        UUID              NOT NULL REFERENCES conductor(id_conductor),
        inicio_periodo     DATE              NOT NULL,
        notas            TEXT,
        creado_en       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        actualizado_en       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

        CONSTRAINT unico_liquidacion_per_periodo UNIQUE (id_conductor, inicio_periodo),
        CONSTRAINT comprobacion_periodo_order            CHECK (inicio_periodo = date_trunc('month',inicio_periodo)::date)
      );
    `);
    await q(
      `CREATE INDEX idx_settlements_conductor   ON comision(id_conductor);`,
    );

    // ─── DRIVER EARNINGS ──────────────────────────────────────────────────────
    await q(`
      CREATE TABLE cobros_conductor (
        id_ganancia_conductor                 UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_viaje            UUID              NOT NULL UNIQUE REFERENCES viaje(id_viaje),
        id_comision      UUID              REFERENCES comision(id_comision),
        tasa_comision    DOUBLE PRECISION  NOT NULL,
        creado_en         TIMESTAMPTZ       NOT NULL DEFAULT NOW()
      );
    `);
    await q(
      `CREATE INDEX idx_ganancia_conductor_comision ON cobros_conductor(id_comision);`,
    );

    await q(`CREATE FUNCTION calcular_ganancia_viaje(p_viaje UUID,p_tasa NUMERIC)
      RETURNS TABLE(importe_bruto NUMERIC,importe_comision NUMERIC,importe_neto NUMERIC)
      LANGUAGE sql STABLE SET search_path TO public AS $$
        SELECT bruto,comision,ROUND(bruto-comision,2) FROM (
          SELECT v.tarifa_final::numeric AS bruto,ROUND(GREATEST(v.tarifa_final::numeric,0)*p_tasa,2) AS comision
          FROM viaje v WHERE v.id_viaje=p_viaje
        ) calculo
      $$;`);
    await q(`CREATE FUNCTION calcular_totales_comision(p_comision UUID)
      RETURNS TABLE(total_viajes INTEGER,importe_bruto NUMERIC,total_comision NUMERIC)
      LANGUAGE sql STABLE SET search_path TO public AS $$
        SELECT COUNT(*)::integer,COALESCE(SUM(calculo.importe_bruto),0),COALESCE(SUM(calculo.importe_comision),0)
        FROM cobros_conductor c CROSS JOIN LATERAL calcular_ganancia_viaje(c.id_viaje,c.tasa_comision::numeric) calculo
        WHERE c.id_comision=p_comision
      $$;`);
    await q(`CREATE FUNCTION tasa_comision_para_viaje(p_viaje UUID) RETURNS NUMERIC LANGUAGE plpgsql SET search_path TO public AS $$
      DECLARE zona UUID; tasa NUMERIC;
      BEGIN
        SELECT tasa_comision INTO tasa FROM cobros_conductor WHERE id_viaje=p_viaje;
        IF FOUND THEN RETURN tasa; END IF;
        SELECT COALESCE(v.id_zona_servicio,(obtener_zona_servicio(v.ubicacion_recogida)).id_zona_servicio) INTO zona FROM viaje v WHERE v.id_viaje=p_viaje FOR UPDATE;
        IF zona IS NULL THEN RAISE EXCEPTION 'El viaje necesita una zona de servicio con tasa de comisión configurada' USING ERRCODE='23514'; END IF;
        SELECT tasa_comision INTO tasa FROM zona_servicio WHERE id_zona_servicio=zona FOR SHARE;
        IF tasa IS NULL THEN RAISE EXCEPTION 'La zona no tiene tasa de comisión configurada' USING ERRCODE='23514'; END IF;
        UPDATE viaje SET id_zona_servicio=zona WHERE id_viaje=p_viaje AND id_zona_servicio IS NULL;
        RETURN tasa;
      END $$;
      CREATE FUNCTION aplicar_tasa_comision_zona() RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$
      BEGIN
        IF TG_OP='INSERT' THEN NEW.tasa_comision:=tasa_comision_para_viaje(NEW.id_viaje);
        ELSIF NEW.id_viaje IS DISTINCT FROM OLD.id_viaje OR NEW.tasa_comision IS DISTINCT FROM OLD.tasa_comision THEN
          RAISE EXCEPTION 'La tasa aplicada a una ganancia no puede modificarse' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ganancia_tasa_zona BEFORE INSERT OR UPDATE ON cobros_conductor FOR EACH ROW EXECUTE FUNCTION aplicar_tasa_comision_zona();`);
    // ─── PRICING RULES ────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE regla_tarifa (
        id_regla_tarifa           UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
        nombre         VARCHAR(100)     NOT NULL,
        zona         GEOMETRY(POLYGON, 4326),
        multiplicador   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        tipo_vehiculo tipo_vehiculo,
        dia_semana  SMALLINT CHECK (dia_semana BETWEEN 0 AND 6),
        hora_inicio   TIME,
        hora_fin     TIME,
        activo    BOOLEAN          NOT NULL DEFAULT true,
        prioridad     INTEGER          NOT NULL DEFAULT 0,
        creado_en   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        actualizado_en   TIMESTAMPTZ      NOT NULL DEFAULT NOW()
      );
    `);

    // ─── AUDIT LOGS ───────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE registro_auditoria (
        id_registro_auditoria          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        nombre_tabla  VARCHAR(100) NOT NULL,
        id_registro_afectado   UUID         NOT NULL,
        accion      auditoria_accion NOT NULL,
        motivo TEXT,
        id_usuario_responsable  UUID         REFERENCES usuario(id_usuario),
        realizado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    await q(`CREATE TABLE registro_auditoria_detalle (
      id_registro_auditoria UUID NOT NULL REFERENCES registro_auditoria(id_registro_auditoria),
      nombre_campo VARCHAR(100) NOT NULL,
      valor_anterior TEXT, valor_nuevo TEXT,
      PRIMARY KEY(id_registro_auditoria, nombre_campo)
    );`);
    await q(`CREATE TABLE pago_comision (
      id_pago_comision UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      id_comision UUID NOT NULL REFERENCES comision(id_comision),
      id_documento_comprobante UUID REFERENCES documento(id_documento),
      importe NUMERIC(12,2) NOT NULL CHECK (importe > 0),
      metodo_pago liquidacion_metodo_pago NOT NULL,
      referencia VARCHAR(100),
      estado VARCHAR(20) NOT NULL CHECK (estado IN ('pendiente','confirmado','rechazado')),
      presentado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(), revisado_en TIMESTAMPTZ,
      id_usuario_revisor UUID REFERENCES usuario(id_usuario), motivo_rechazo TEXT,
      CHECK (estado = 'pendiente' OR (revisado_en IS NOT NULL AND id_usuario_revisor IS NOT NULL)),
      CHECK (estado <> 'rechazado' OR length(trim(motivo_rechazo)) > 0)
    );
    CREATE UNIQUE INDEX pago_comision_unico_confirmado ON pago_comision(id_comision) WHERE estado='confirmado';
    CREATE UNIQUE INDEX pago_comision_unico_pendiente ON pago_comision(id_comision) WHERE estado='pendiente';
    CREATE FUNCTION estado_comision_mensual(p_comision UUID,p_hoy DATE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'America/La_Paz')::date)
      RETURNS TEXT LANGUAGE sql STABLE SET search_path TO public AS $$
        SELECT CASE WHEN EXISTS(SELECT 1 FROM pago_comision p WHERE p.id_comision=c.id_comision AND p.estado='confirmado') THEN 'pagado'
          WHEN p_hoy < (c.inicio_periodo + INTERVAL '1 month')::date THEN 'abierto'
          WHEN p_hoy <= (c.inicio_periodo + INTERVAL '1 month 6 days')::date THEN 'pendiente_pago'
          ELSE 'atrasado' END FROM comision c WHERE c.id_comision=p_comision
      $$;
    CREATE FUNCTION validar_pago_comision() RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$
    DECLARE saldo NUMERIC; situacion TEXT;
    BEGIN
      IF TG_OP = 'UPDATE' AND (OLD.estado <> 'pendiente' OR OLD.id_comision <> NEW.id_comision OR OLD.id_documento_comprobante IS DISTINCT FROM NEW.id_documento_comprobante) THEN
        RAISE EXCEPTION 'Un pago resuelto no puede modificarse';
      END IF;
      PERFORM 1 FROM comision WHERE id_comision=NEW.id_comision FOR UPDATE;
      SELECT estado_comision_mensual(NEW.id_comision) INTO situacion;
      SELECT total_comision INTO saldo FROM calcular_totales_comision(NEW.id_comision);
      IF NEW.estado <> 'rechazado' AND (NEW.importe <> saldo OR situacion NOT IN ('pendiente_pago','atrasado')) THEN
        RAISE EXCEPTION 'El pago debe cubrir el saldo mensual completo';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER comprobar_pago_comision BEFORE INSERT OR UPDATE ON pago_comision FOR EACH ROW EXECUTE FUNCTION validar_pago_comision();`);

    // ─── EMERGENCY CONTACTS ───────────────────────────────────────────────────
    // Contactos de confianza que recibirán SMS cuando el usuario pulse SOS.
    // Se permiten hasta 3 contactos activos por usuario en la capa de aplicación.
    await q(`
      CREATE TABLE contacto_emergencia (
        id_contacto_emergencia          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_usuario     UUID         NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
        nombre        VARCHAR(100) NOT NULL,
        telefono       VARCHAR(30)  NOT NULL,
        relacion    VARCHAR(50),
        activo   BOOLEAN      NOT NULL DEFAULT true,
        creado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await q(`CREATE INDEX idx_contacto_emergencia_usuario ON contacto_emergencia(id_usuario);`);
    await q(`CREATE UNIQUE INDEX contacto_emergencia_telefono_activo_unico
      ON contacto_emergencia(id_usuario, (regexp_replace(telefono, '[^0-9]', '', 'g'))) WHERE activo;`);

    // ─── EMERGENCY ALERTS ─────────────────────────────────────────────────────
    // Registro central de cada activación del botón SOS.
    // id_viaje es opcional: la emergencia puede ocurrir fuera de un viaje activo.
    // location guarda el punto GPS al momento de pulsar el botón.
    // id_usuario_resolutor referencia al admin que marcó la alerta como resuelta.
    await q(`
      CREATE TABLE alerta_emergencia (
        id_alerta_emergencia               UUID                   PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_usuario          UUID                   NOT NULL REFERENCES usuario(id_usuario),
        id_viaje          UUID                   REFERENCES viaje(id_viaje),
        estado           emergencia_alerta_estado NOT NULL DEFAULT 'activo',
        ubicacion         GEOMETRY(POINT, 4326),
        direccion_ubicacion TEXT,
        activada_en     TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        resuelta_en      TIMESTAMPTZ,
        id_usuario_resolutor      UUID                   REFERENCES usuario(id_usuario),
        notas            TEXT,
        creado_en       TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        actualizado_en       TIMESTAMPTZ            NOT NULL DEFAULT NOW(),

        CONSTRAINT comprobacion_resolved_consistency
          CHECK (
            (estado != 'resuelto' AND resuelta_en IS NULL)
            OR  (estado  = 'resuelto' AND resuelta_en IS NOT NULL)
          )
      );
    `);
    await q(`CREATE INDEX idx_alerta_emergencia_usuario   ON alerta_emergencia(id_usuario);`);
    await q(`CREATE INDEX idx_alerta_emergencia_viaje   ON alerta_emergencia(id_viaje);`);
    await q(`CREATE INDEX idx_alerta_emergencia_estado ON alerta_emergencia(estado);`);
    await q(`CREATE INDEX idx_alerta_emergencia_geografico    ON alerta_emergencia USING GIST(ubicacion);`);

    // ─── EMERGENCY SMS LOGS ───────────────────────────────────────────────────
    // Un alert genera una fila por cada contacto notificado.
    // provider_id almacena el ID del mensaje en el proveedor SMS (Twilio, AWS SNS…).
    await q(`
      CREATE TABLE registro_sms_emergencia (
        id_registro_sms_emergencia           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_alerta     UUID        NOT NULL REFERENCES alerta_emergencia(id_alerta_emergencia) ON DELETE CASCADE,
        id_contacto   UUID        REFERENCES contacto_emergencia(id_contacto_emergencia),
        telefono_destino     VARCHAR(30) NOT NULL,
        cuerpo_mensaje TEXT        NOT NULL,
        estado       sms_estado  NOT NULL DEFAULT 'pendiente',
        proveedor_id  VARCHAR(255),
        enviado_en      TIMESTAMPTZ,
        fallo_en    TIMESTAMPTZ,
        mensaje_error    TEXT,
        creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT comprobacion_sms_estado_dates
          CHECK (
            (estado = 'enviado'    AND enviado_en   IS NOT NULL)
            OR (estado = 'fallido'  AND fallo_en IS NOT NULL)
            OR  estado = 'pendiente'
          )
      );
    `);
    await q(`CREATE INDEX idx_sms_logs_alerta  ON registro_sms_emergencia(id_alerta);`);
    await q(`CREATE INDEX idx_sms_logs_estado ON registro_sms_emergencia(estado);`);

    // ─── RIDE WAYPOINTS (Paradas intermedias) ─────────────────────────────────
    // Paradas intermedias de un viaje (rutas con múltiples destinos).
    // Cada viaje puede tener 0 o más paradas ordenadas por secuencia.
    await q(`
      CREATE TABLE parada_viaje (
        id_parada_viaje          UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
        id_viaje     UUID                 NOT NULL REFERENCES viaje(id_viaje) ON DELETE CASCADE,
        orden    SMALLINT             NOT NULL,
        ubicacion    GEOMETRY(POINT, 4326) NOT NULL,
        direccion     TEXT                 NOT NULL,
        llegada_en  TIMESTAMPTZ,
        salida_en TIMESTAMPTZ,
        creado_en  TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
        actualizado_en  TIMESTAMPTZ,

        CONSTRAINT uq_viaje_waypoint UNIQUE (id_viaje, orden)
      );
    `);
    await q(`CREATE INDEX idx_parada_viaje_viaje_id ON parada_viaje(id_viaje);`);
    await q(`CREATE INDEX idx_parada_viaje_geografico     ON parada_viaje USING GIST(ubicacion);`);

    await q('ALTER TABLE notificacion ADD FOREIGN KEY (id_alerta_emergencia) REFERENCES alerta_emergencia(id_alerta_emergencia), ADD FOREIGN KEY (id_comision) REFERENCES comision(id_comision);');
    // ─── TRIGGER: validar razón de cancelación ────────────────────────────────
    await q(`
      CREATE OR REPLACE FUNCTION comprobar_motivo_cancelacion()
      RETURNS TRIGGER AS $$
      DECLARE
        reason_applicable_to TEXT;
      BEGIN
        IF NEW.id_motivo_cancelacion IS NOT NULL THEN
          SELECT aplicable_a INTO reason_applicable_to
          FROM motivo_cancelacion
          WHERE id_motivo_cancelacion = NEW.id_motivo_cancelacion;

          IF reason_applicable_to = 'conductor' AND NEW.cancelado_por = 'pasajero' THEN
            RAISE EXCEPTION 'Esta razón de cancelación no aplica para pasajeros';
          END IF;
          IF reason_applicable_to = 'pasajero' AND NEW.cancelado_por = 'conductor' THEN
            RAISE EXCEPTION 'Esta razón de cancelación no aplica para conductor';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SET search_path TO public;

      CREATE TRIGGER validate_cancelacion_motivo
      BEFORE INSERT OR UPDATE ON viaje
      FOR EACH ROW EXECUTE FUNCTION comprobar_motivo_cancelacion();
    `);

    // ─── FUNCIONES PostgreSQL ─────────────────────────────────────────────────
    await q(`
      CREATE OR REPLACE FUNCTION generar_liquidacion_mensual(
        p_driver_id UUID, p_year INTEGER, p_month INTEGER
      )
      RETURNS UUID AS $$
      DECLARE
        v_period_start  DATE;
        v_period_end    DATE;
        v_settlement_id UUID;
        v_total_rides   INTEGER;
      BEGIN
        v_period_start := make_date(p_year, p_month, 1);
        v_period_end   := (v_period_start + INTERVAL '1 month - 1 day')::DATE;

        IF EXISTS (
          SELECT 1 FROM comision
          WHERE id_conductor = p_driver_id
          AND inicio_periodo = v_period_start
        ) THEN
          RAISE EXCEPTION 'Ya existe un settlement para este conductor en ese periodo';
        END IF;

        SELECT COUNT(*) INTO v_total_rides
        FROM cobros_conductor g
        WHERE g.id_viaje IN (SELECT id_viaje FROM viaje WHERE id_conductor=p_driver_id)
        AND g.creado_en >= v_period_start AND g.creado_en < v_period_end + INTERVAL '1 day'
        AND g.id_comision IS NULL;

        IF v_total_rides = 0 THEN RETURN NULL; END IF;

        v_settlement_id := gen_random_uuid();
        INSERT INTO comision (
          id_comision, id_conductor, inicio_periodo,
          creado_en, actualizado_en
        ) VALUES (
          v_settlement_id, p_driver_id, v_period_start,
          now(), now()
        );

        UPDATE cobros_conductor SET id_comision = v_settlement_id
        WHERE id_viaje IN (SELECT id_viaje FROM viaje WHERE id_conductor=p_driver_id)
        AND creado_en >= v_period_start AND creado_en < v_period_end + INTERVAL '1 day'
        AND id_comision IS NULL;

        RETURN v_settlement_id;
      END;
      $$ LANGUAGE plpgsql SET search_path TO public;
    `);

    await q(`
      CREATE OR REPLACE FUNCTION marcar_liquidaciones_vencidas()
      RETURNS INTEGER AS $$
      DECLARE v_count INTEGER;
      BEGIN
        SELECT COUNT(*)::integer INTO v_count FROM comision c WHERE estado_comision_mensual(c.id_comision)='atrasado';
        RETURN v_count;
      END;
      $$ LANGUAGE plpgsql SET search_path TO public;
    `);

    await q(`
      CREATE OR REPLACE FUNCTION obtener_zona_servicio(p_location GEOMETRY)
      RETURNS zona_servicio AS $$
      DECLARE v_area zona_servicio;
      BEGIN
        SELECT * INTO v_area FROM zona_servicio
        WHERE ST_Contains(limite, p_location) AND activo = true
        LIMIT 1;
        RETURN v_area;
      END;
      $$ LANGUAGE plpgsql SET search_path TO public;
    `);

    await q(`
      CREATE OR REPLACE FUNCTION ubicacion_tiene_cobertura(p_location GEOMETRY)
      RETURNS BOOLEAN AS $$
      BEGIN
        RETURN EXISTS (
          SELECT 1 FROM zona_servicio
          WHERE ST_Contains(limite, p_location) AND activo = true
        );
      END;
      $$ LANGUAGE plpgsql SET search_path TO public;
    `);

    // ─── Seed: usuario administrador ──────────────────────────────────────────
    const bcrypt = require('bcryptjs');
    const adminPasswordHash = bcrypt.hashSync('admin123', 10);
    await q(`
      INSERT INTO usuario (id_usuario, telefono, correo, contrasena, rol, firebase_uid, activo, telefono_verificado, creado_en, actualizado_en)
      VALUES (
        '00000000-0000-0000-0000-000000000001',
        '+59169164016',
        'admin@linealila.com',
        '${adminPasswordHash}',
        'administrador',
        'admin-uid',
        true,
        true,
        NOW(),
        NOW()
      );
    `);

    // ─── Seed: conductor de prueba para el acceso de desarrollo ───────────────
    const testDriverPasswordHash = bcrypt.hashSync('Conductor123!', 10);
    await q(`
      INSERT INTO usuario (id_usuario, firebase_uid, telefono, correo, contrasena, rol, modo_actual, activo, telefono_verificado, creado_en, actualizado_en)
      VALUES (
        '00000000-0000-0000-0000-000000000002',
        'test-driver-seed',
        '+59179990001',
        'conductor.prueba@linealila.test',
        '${testDriverPasswordHash}',
        'conductor',
        'conductor',
        true,
        true,
        NOW(),
        NOW()
      );
      INSERT INTO conductor (id_conductor, id_usuario, estado, disponible, creado_en, actualizado_en)
      VALUES (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000002',
        'aprobado',
        false,
        NOW(),
        NOW()
      );
      INSERT INTO vehiculo(id_vehiculo,id_conductor,estado) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','activo');
      INSERT INTO documento(id_documento,tipo_documento,ruta_archivo,origen_evidencia,estado_verificacion,verificado_en) VALUES('00000000-0000-0000-0000-000000000004','ruatPhoto','seed:ruat-prueba','semilla_desarrollo','verificado',NOW());
      INSERT INTO documento_ruat(id_documento_ruat,marca,modelo,anio,color,placa,capacidad,tipo_vehiculo) VALUES('00000000-0000-0000-0000-000000000004','Prueba','Taxi','2020','Blanco','TEST-0001','4','taxi');
      INSERT INTO vehiculo_documento(id_vehiculo,id_documento) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004');
    `);
    // Proyecciones de lectura para conservar los contratos del backend. No renombran tablas.
    const mapa = require('../src/config/nombres-columnas-por-tabla.json');
    const citar = nombre => '"' + nombre.replaceAll('"', '""') + '"';
    const db = queryInterface.sequelize;
    await (async transaction => {
      const consultar = (sql, replacements) => db.query(sql, {
        transaction, replacements, esquemaFisico: true,
      });
      await consultar('CREATE SCHEMA compatibilidad');
      for (const [tabla, cambios] of Object.entries(mapa)) {
        if (['documento', 'documento_ci', 'documento_domicilio'].includes(tabla)) continue;
        const inversos = Object.fromEntries(Object.entries(cambios).map(([antes, despues]) => [despues, antes]));
        const [columnas] = await consultar(`SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = :tabla ORDER BY ordinal_position`, { tabla });
        const derivadas = {
          comision: ["COALESCE((SELECT p.importe FROM public.pago_comision p WHERE p.id_comision=b.id_comision AND p.estado='confirmado'),0) AS importe_pagado", "(SELECT p.revisado_en FROM public.pago_comision p WHERE p.id_comision=b.id_comision AND p.estado='confirmado') AS pagado_en", "(SELECT p.metodo_pago FROM public.pago_comision p WHERE p.id_comision=b.id_comision AND p.estado='confirmado') AS metodo_pago"],
          cobros_conductor: ["(SELECT v.id_conductor FROM public.viaje v WHERE v.id_viaje=b.id_viaje) AS conductor_id", "(SELECT v.metodo_pago FROM public.viaje v WHERE v.id_viaje=b.id_viaje) AS metodo_pago", "CASE WHEN EXISTS(SELECT 1 FROM public.pago_comision p WHERE p.id_comision=b.id_comision AND p.estado='confirmado') THEN 'cobrado' ELSE 'pendiente' END AS estado_comision", "(SELECT p.revisado_en FROM public.pago_comision p WHERE p.id_comision=b.id_comision AND p.estado='confirmado') AS comision_pagada_en"],
          pago: ["(SELECT v.metodo_pago FROM public.viaje v WHERE v.id_viaje=b.id_viaje) AS metodo_pago"],
          vehiculo: []
        };
        derivadas.comision.push("(b.inicio_periodo + INTERVAL '1 month - 1 day')::date AS fin_periodo", "(b.inicio_periodo + INTERVAL '1 month 6 days')::date AS fecha_limite", "public.estado_comision_mensual(b.id_comision) AS estado");
        for(const total of ['total_viajes','importe_bruto','total_comision']) {
          derivadas.comision.push(`(SELECT ${total} FROM public.calcular_totales_comision(b.id_comision)) AS ${total}`);
        }
        for(const importe of ['importe_bruto','importe_comision','importe_neto']) {
          derivadas.cobros_conductor.push(`(SELECT ${importe}::double precision FROM public.calcular_ganancia_viaje(b.id_viaje,b.tasa_comision::numeric)) AS ${importe}`);
        }
        const soat = field => `(SELECT s.${field} FROM public.vehiculo_documento vd JOIN public.documento d USING(id_documento) JOIN public.documento_soat s ON s.id_documento_soat=d.id_documento WHERE vd.id_vehiculo=b.id_vehiculo AND d.vigente AND d.estado_verificacion='verificado' ORDER BY d.creado_en DESC,d.id_documento DESC LIMIT 1)`;
        const ruat = field => `(SELECT d.${field} FROM public.vehiculo_documento vd JOIN public.documento d USING(id_documento) WHERE vd.id_vehiculo=b.id_vehiculo AND d.tipo_documento='ruatPhoto' ORDER BY d.creado_en DESC,d.id_documento DESC LIMIT 1)`;
        const fecha = expr => `CASE WHEN ${expr} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (${expr})::date WHEN ${expr} ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date(${expr},'DD/MM/YYYY') END`;
        derivadas.vehiculo = [soat('numero_roseta')+' AS numero_roseta_soat',fecha(soat('fecha_inicio'))+' AS fecha_inicio_soat',fecha(soat('fecha_vencimiento'))+' AS fecha_vencimiento_soat',soat('uso')+' AS uso_soat',`COALESCE(${ruat('estado_verificacion')}='verificado',false) AS ruat_verificado`,ruat('verificado_en')+' AS ruat_verificado_en',`CASE WHEN ${soat('id_documento_soat')} IS NOT NULL THEN 'verificado' ELSE 'pendiente' END AS estado_verificacion_soat`,`(SELECT d.verificado_en FROM public.documento d WHERE d.id_documento=${soat('id_documento_soat')}) AS soat_verificado_en`];
        const datosRuat = field => `(SELECT r.${field} FROM public.vehiculo_documento vd JOIN public.documento d USING(id_documento) JOIN public.documento_ruat r ON r.id_documento_ruat=d.id_documento WHERE vd.id_vehiculo=b.id_vehiculo AND d.vigente AND d.estado_verificacion='verificado' ORDER BY d.creado_en DESC,d.id_documento DESC LIMIT 1)`;
        const camposRuat = {"marca":"marca","modelo":"modelo","anio":"anio","color":"color","placa":"placa","capacidad":"capacidad","tipo_vehiculo":"tipo_vehiculo","municipio_registro":"municipio_registro","numero_crpva":"numero_crpva","fecha_emision_ruat":"fecha_emision","fecha_inicio_propiedad":"inicio_propiedad","cantidad_puertas":"cantidad_puertas","tipo_servicio":"tipo_servicio","numero_chasis":"numero_chasis","numero_motor":"numero_motor","tipo_combustible":"combustible","cilindrada_motor":"cilindrada","tipo_motor":"tipo_motor","observaciones_legales":"observaciones_legales"};
        for(const [destino,origen] of Object.entries(camposRuat)) {
          let expresion=datosRuat(origen);
          if(['anio','capacidad','cantidad_puertas'].includes(destino)) expresion=`CASE WHEN ${expresion} ~ '^[0-9]{1,6}$' THEN (${expresion})::integer END`;
          if(['fecha_emision_ruat','fecha_inicio_propiedad'].includes(destino)) expresion=fecha(expresion);
          if(destino==='tipo_vehiculo') expresion=`CASE WHEN ${expresion} IN ('taxi','minibus','bus','motocicleta') THEN (${expresion})::public.tipo_vehiculo END`;
          derivadas.vehiculo.push(expresion+' AS '+citar(destino));
        }
        const proyeccion = columnas.map(({column_name:nombre}) => `b.${citar(nombre)} AS ${citar(inversos[nombre] ?? nombre)}`).concat(derivadas[tabla] || []).join(', ');
        await consultar(`CREATE VIEW compatibilidad.${citar(tabla)} AS SELECT ${proyeccion} FROM public.${citar(tabla)} b`);
      }
      const [docCols] = await consultar("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='documento' ORDER BY ordinal_position");
      const docProjection = docCols.map(({column_name:n}) => 'd.'+citar(n)+' AS '+citar(n === 'id_documento' ? 'id' : n === 'id_usuario_verificador' ? 'verificado_por' : n)).join(',');
      await consultar(`CREATE VIEW compatibilidad.documento AS SELECT ${docProjection},
        COALESCE(ud.id_usuario, c.id_usuario, cv.id_usuario, sc.id_usuario) AS usuario_id,
        sd.id_solicitud_conductor AS solicitud_conductor_id,
        cd.id_conductor AS conductor_id, vd.id_vehiculo AS vehiculo_id
        FROM public.documento d
        LEFT JOIN public.usuario_documento ud USING(id_documento)
        LEFT JOIN public.conductor_documento cd USING(id_documento) LEFT JOIN public.conductor c USING(id_conductor)
        LEFT JOIN public.vehiculo_documento vd USING(id_documento) LEFT JOIN public.vehiculo v ON v.id_vehiculo=vd.id_vehiculo LEFT JOIN public.conductor cv ON cv.id_conductor=v.id_conductor
        LEFT JOIN public.solicitud_documento sd USING(id_documento) LEFT JOIN public.solicitud_conductor sc USING(id_solicitud_conductor)`);
      await consultar(`CREATE VIEW compatibilidad.archivo_solicitud AS SELECT
        d.id_documento AS id, sd.id_solicitud_conductor AS solicitud_conductor_id, sc.id_usuario AS usuario_id,
        d.tipo_documento,d.ruta_archivo,d.tipo_mime,d.creado_en,d.origen_evidencia,
        d.estado_verificacion,d.verificado_en,d.id_usuario_verificador AS verificado_por
        FROM public.solicitud_documento sd JOIN public.documento d USING(id_documento) JOIN public.solicitud_conductor sc USING(id_solicitud_conductor)`);
      const [ciCols] = await consultar("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='documento_ci' ORDER BY ordinal_position");
      const ciProjection = ciCols.map(({column_name:n}) => 'ci.'+citar(n)+' AS '+citar(n === 'id_documento_ci' ? 'id' : n === 'id_usuario_verificador' ? 'verificado_por' : n)).join(',');
      await consultar(`CREATE VIEW compatibilidad.documento_ci AS SELECT ${ciProjection},ud.id_usuario AS usuario_id,d.estado_verificacion,d.verificado_en,d.id_usuario_verificador AS verificado_por,d.motivo_rechazo FROM public.documento_ci ci JOIN public.usuario_documento ud ON ud.id_documento=ci.id_documento_ci JOIN public.documento d ON d.id_documento=ud.id_documento`);
      await consultar(`CREATE VIEW compatibilidad.documento_domicilio AS SELECT dd.id_documento_domicilio AS id,sc.id_usuario AS usuario_id,sd.id_solicitud_conductor AS solicitud_conductor_id,
        dd.direccion,dd.ubicacion,d.estado_verificacion,d.verificado_en,d.id_usuario_verificador AS verificado_por,d.motivo_rechazo,
        d.creado_en,d.actualizado_en FROM public.documento_domicilio dd JOIN public.documento d ON d.id_documento=dd.id_documento_domicilio
        JOIN public.solicitud_documento sd USING(id_documento) JOIN public.solicitud_conductor sc USING(id_solicitud_conductor)`);
      await consultar(`CREATE FUNCTION compatibilidad.obtener_zona_servicio(geometry)
        RETURNS compatibilidad.zona_servicio LANGUAGE sql STABLE AS $$
          SELECT (public.obtener_zona_servicio($1)).*
        $$`);
    })(instalacion);
    });
  },

  // ────────────────────────────────────────────────────────────────────────────
  async down(queryInterface) {
    const q = sql => queryInterface.sequelize.query(sql, { esquemaFisico: true });

    await q('DROP SCHEMA IF EXISTS compatibilidad CASCADE;');
    await q('DROP FUNCTION IF EXISTS estado_comision_mensual(UUID,DATE) CASCADE;');
    await q('DROP FUNCTION IF EXISTS calcular_totales_comision(UUID) CASCADE;');
    await q('DROP FUNCTION IF EXISTS aplicar_tasa_comision_zona() CASCADE; DROP FUNCTION IF EXISTS tasa_comision_para_viaje(UUID) CASCADE;');
    await q('DROP FUNCTION IF EXISTS calcular_ganancia_viaje(UUID,NUMERIC) CASCADE;');
    await q('DROP FUNCTION IF EXISTS comprobar_placa_ruat() CASCADE; DROP FUNCTION IF EXISTS validar_placa_ruat(UUID,UUID) CASCADE;');
    await q('DROP FUNCTION IF EXISTS validar_solicitud_documento() CASCADE; DROP FUNCTION IF EXISTS validar_propietario_documento() CASCADE;');
    await q('DROP TABLE IF EXISTS pago_comision, registro_auditoria_detalle, evaluacion_psicologica, documento_informe_psicologico, documento_ci, documento_licencia, documento_ruat, documento_soat, documento_tic, documento_antecedentes, documento_domicilio, solicitud_documento, usuario_documento, conductor_documento, vehiculo_documento CASCADE; DROP FUNCTION IF EXISTS validar_pago_comision() CASCADE;');

    // Eliminar triggers y funciones
    await q(`DROP FUNCTION IF EXISTS validar_disponibilidad_oferta() CASCADE;`);
    await q(`DROP TRIGGER IF EXISTS validate_cancelacion_motivo ON viaje;`);
    await q(`DROP FUNCTION IF EXISTS comprobar_motivo_cancelacion CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS generar_liquidacion_mensual CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS marcar_liquidacion_pagada CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS marcar_liquidaciones_vencidas CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS obtener_zona_servicio CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS ubicacion_tiene_cobertura CASCADE;`);

    // Eliminar tablas en orden inverso (respetando FKs)
    await q(`DROP TABLE IF EXISTS parada_viaje        CASCADE;`);
    // — Módulo emergencias —
    await q(`DROP TABLE IF EXISTS registro_sms_emergencia    CASCADE;`);
    await q(`DROP TABLE IF EXISTS alerta_emergencia      CASCADE;`);
    await q(`DROP TABLE IF EXISTS contacto_emergencia    CASCADE;`);
    // — Core —
    await q(`DROP TABLE IF EXISTS registro_auditoria             CASCADE;`);
    await q(`DROP TABLE IF EXISTS regla_tarifa          CASCADE;`);
    await q(`DROP TABLE IF EXISTS cobros_conductor        CASCADE;`);
    await q(`DROP TABLE IF EXISTS comision CASCADE;`);
    await q(`DROP TABLE IF EXISTS notificacion          CASCADE;`);
    await q(`DROP TABLE IF EXISTS calificacion                CASCADE;`);
    await q(`DROP TABLE IF EXISTS pago               CASCADE;`);
    await q(`DROP TABLE IF EXISTS oferta_viaje            CASCADE;`);
    await q(`DROP TABLE IF EXISTS viaje                  CASCADE;`);
    await q(`DROP TABLE IF EXISTS motivo_cancelacion   CASCADE;`);
    await q(`DROP TABLE IF EXISTS zona_servicio          CASCADE;`);
    await q(`DROP TABLE IF EXISTS documento_domicilio       CASCADE;`);
    await q(`DROP TABLE IF EXISTS solicitud_conductor        CASCADE;`);
    await q(`DROP TABLE IF EXISTS documento              CASCADE;`);
    await q(`DROP TABLE IF EXISTS ubicacion_conductor       CASCADE;`);
    await q(`DROP TABLE IF EXISTS vehiculo               CASCADE;`);
    await q(`DROP TABLE IF EXISTS conductor                CASCADE;`);
    await q(`DROP TABLE IF EXISTS documento_ci        CASCADE;`);
    await q(`DROP TABLE IF EXISTS usuario                  CASCADE;`);

    // Eliminar ENUMs
    const enumNames = [
      'emergencia_alerta_estado',
      'sms_estado',
      'usuario_rol',
      'conductor_estado',
      'tipo_vehiculo',
      'vehiculo_estado',
      'enum_viaje_estado',
      'cancelado_por_tipo',
      'viaje_oferta_estado',
      'metodo_pago',
      'estado_pago',
      'tipo_calificador',
      'estado_comision',
      'liquidacion_estado',
      'liquidacion_metodo_pago',
      'aplicable_a',
      'notificacion_tipo',
      'auditoria_accion',
      'conductor_solicitud_estado',
    ];
    for (const e of enumNames) {
      await q(`DROP TYPE IF EXISTS ${e} CASCADE;`);
    }
  },
};
 
