'use strict';

/**
 * Migración maestra — esquema completo de la BD.
 * Generada a partir del estado actual de la base de datos (dataBase.md).
 * Incluye módulo de emergencias (botón SOS, contactos, SMS y grabaciones).
 *
 * ⚠️  Esta migración asume que la BD está vacía (fresh install).
 *     Si ya tienes tablas, NO la ejecutes — solo sirve para recrear
 *     el esquema desde cero en un entorno nuevo.
 *
 * Requiere: extensión PostGIS instalada en el servidor PostgreSQL.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const q = sql => queryInterface.sequelize.query(sql);

    // ─── Extensiones ──────────────────────────────────────────────────────────
    await q(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    await q(`CREATE EXTENSION IF NOT EXISTS postgis;`);

    // ─── ENUMs ────────────────────────────────────────────────────────────────
    await q(
      `CREATE TYPE user_role               AS ENUM ('passenger', 'driver', 'admin');`,
    );
    await q(
      `CREATE TYPE driver_status           AS ENUM ('pending', 'approved', 'rejected', 'suspended');`,
    );
    await q(
      `CREATE TYPE vehicle_type            AS ENUM ('taxi', 'minibus', 'bus', 'motorcycle');`,
    );
    await q(
      `CREATE TYPE vehicle_status          AS ENUM ('active', 'inactive', 'pending_review');`,
    );
    await q(
      `CREATE TYPE enum_rides_status       AS ENUM ('requested', 'offered', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired');`,
    );
    await q(
      `CREATE TYPE cancelled_by_type       AS ENUM ('passenger', 'driver', 'system');`,
    );
    await q(
      `CREATE TYPE ride_offer_status       AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'cancelled');`,
    );
    await q(`CREATE TYPE payment_method          AS ENUM ('cash', 'qr');`);
    await q(
      `CREATE TYPE payment_status          AS ENUM ('pending', 'completed', 'failed', 'refunded');`,
    );
    await q(
      `CREATE TYPE rater_type              AS ENUM ('passenger', 'driver');`,
    );
    await q(
      `CREATE TYPE commission_status       AS ENUM ('pending', 'collected');`,
    );
    await q(
      `CREATE TYPE settlement_status       AS ENUM ('open', 'pending_payment', 'paid', 'overdue');`,
    );
    await q(
      `CREATE TYPE settlement_payment_method AS ENUM ('cash', 'qr', 'transfer');`,
    );
    await q(
      `CREATE TYPE discount_type           AS ENUM ('percentage', 'fixed');`,
    );
    await q(
      `CREATE TYPE applicable_to           AS ENUM ('passenger', 'driver', 'both');`,
    );
    await q(
      `CREATE TYPE notification_type       AS ENUM ('ride_request', 'ride_accepted', 'ride_cancelled', 'payment', 'promo', 'system', 'emergency');`,
    );
    await q(
      `CREATE TYPE audit_action            AS ENUM ('INSERT', 'UPDATE', 'DELETE');`,
    );
    await q(
      `CREATE TYPE driver_request_status   AS ENUM ('pending', 'approved', 'rejected');`,
    );
    await q(
      `CREATE TYPE request_file_type       AS ENUM ('profilePhoto', 'ciFront', 'ciBack', 'licenseFront', 'licenseBack', 'antecedentsPhoto', 'carFront', 'carBack', 'carLeft', 'carRight', 'soatPhoto', 'ruatPhoto');`,
    );
    await q(
      `CREATE TYPE request_file_status     AS ENUM ('pending', 'approved', 'rejected');`,
    );
    await q(
      `CREATE TYPE ruat_required_reason    AS ENUM ('accident', 'vehicle_mismatch', 'suspension_reactivation', 'criminal_record');`,
    );

    // ─── ENUMs módulo emergencias ─────────────────────────────────────────────
    await q(
      `CREATE TYPE emergency_alert_status  AS ENUM ('active', 'resolved', 'false_alarm');`,
    );
    await q(
      `CREATE TYPE sms_status              AS ENUM ('pending', 'sent', 'failed');`,
    );

    // ─── USERS ────────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE users (
        id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        firebase_uid    VARCHAR(255) NOT NULL UNIQUE,
        fcm_token       VARCHAR(255),
        name            VARCHAR(255) NOT NULL,
        email           VARCHAR(255) UNIQUE,
        phone           VARCHAR(30)  UNIQUE,
        password        VARCHAR(255),
        role            user_role    NOT NULL DEFAULT 'passenger',
        current_mode    VARCHAR(50),
        profile_photo   VARCHAR(500),
        is_active       BOOLEAN      NOT NULL DEFAULT true,
        is_verified     BOOLEAN      NOT NULL DEFAULT false,
        last_login      TIMESTAMPTZ,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ─── DRIVERS ──────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE drivers (
        id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id           UUID          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        license_number    VARCHAR(100),
        license_expiry    TIMESTAMPTZ,
        status            driver_status NOT NULL DEFAULT 'pending',
        is_available      BOOLEAN       NOT NULL DEFAULT false,
        rejection_reason  VARCHAR(500),
        deleted_at        TIMESTAMPTZ,
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);

    // ─── VEHICLES ─────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE vehicles (
        id                    UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
        driver_id             UUID                  NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
        brand                 VARCHAR(100)          NOT NULL,
        model                 VARCHAR(100)          NOT NULL,
        year                  INTEGER               NOT NULL,
        color                 VARCHAR(50),
        plate                 VARCHAR(20)           NOT NULL UNIQUE,
        capacity              INTEGER               NOT NULL DEFAULT 4,
        vehicle_type          vehicle_type          NOT NULL DEFAULT 'taxi',
        status                vehicle_status        NOT NULL DEFAULT 'active',
        -- ── Verificación RUAT ──────────────────────────────────────────────
        -- ruat_file != NULL && ruat_verified = false → en revisión por admin
        -- ruat_file != NULL && ruat_verified = true  → vehículo verificado
        -- ruat_file  = NULL && ruat_required = true  → requerido urgentemente
        ruat_file             VARCHAR(255),
        ruat_verified         BOOLEAN               NOT NULL DEFAULT FALSE,
        ruat_verified_at      TIMESTAMPTZ,
        ruat_required         BOOLEAN               NOT NULL DEFAULT FALSE,
        ruat_required_reason  ruat_required_reason,
        ruat_required_at      TIMESTAMPTZ,
        deleted_at            TIMESTAMPTZ,
        created_at            TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ           NOT NULL DEFAULT NOW()
      );
    `);

    // ─── DRIVER LOCATIONS ─────────────────────────────────────────────────────
    await q(`
      CREATE TABLE driver_locations (
        driver_id  UUID      PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
        location   GEOMETRY(POINT, 4326) NOT NULL,
        heading    DOUBLE PRECISION,
        speed      DOUBLE PRECISION,
        is_online  BOOLEAN   NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await q(
      `CREATE INDEX idx_driver_locations_geo ON driver_locations USING GIST(location);`,
    );

    // ─── DRIVER REQUESTS ──────────────────────────────────────────────────────
    await q(`
      CREATE TABLE driver_requests (
        id                  UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id             UUID                  NOT NULL REFERENCES users(id),
        driver_id           UUID                  REFERENCES drivers(id),
        status              driver_request_status NOT NULL DEFAULT 'pending',
        rejection_reason    TEXT,
        rejected_documents  JSONB,
        metadata            JSONB,
        version             INTEGER               NOT NULL DEFAULT 1,
        created_at          TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ           NOT NULL DEFAULT NOW()
      );
    `);

    // ─── REQUEST FILES ────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE request_files (
        id           UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
        request_id   UUID                NOT NULL REFERENCES driver_requests(id) ON DELETE CASCADE,
        file_type    request_file_type   NOT NULL,
        filename     VARCHAR(500)        NOT NULL,
        mime_type    VARCHAR(100)        NOT NULL,
        file_size    INTEGER             NOT NULL,
        status       request_file_status NOT NULL DEFAULT 'pending',
        uploaded_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW()
      );
    `);

    // ─── SERVICE AREAS ────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE service_areas (
        id               UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
        name             VARCHAR(100)            NOT NULL,
        boundary         GEOMETRY(POLYGON, 4326) NOT NULL,
        is_active        BOOLEAN                 NOT NULL DEFAULT true,
        base_fare        DOUBLE PRECISION        CHECK (base_fare > 0),
        fare_per_km      DOUBLE PRECISION        CHECK (fare_per_km > 0),
        fare_per_minute  DOUBLE PRECISION        CHECK (fare_per_minute > 0),
        currency         VARCHAR(10)             NOT NULL DEFAULT 'BOB',
        created_at       TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ             NOT NULL DEFAULT NOW()
      );
    `);
    await q(
      `CREATE INDEX idx_service_areas_boundary ON service_areas USING GIST(boundary);`,
    );
    await q(
      `CREATE INDEX idx_service_areas_active   ON service_areas(is_active);`,
    );

    // ─── PROMO CODES ──────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE promo_codes (
        id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        code            VARCHAR(50)   NOT NULL UNIQUE,
        discount_type   discount_type NOT NULL,
        discount_value  DOUBLE PRECISION NOT NULL,
        expires_at      TIMESTAMPTZ,
        max_uses        INTEGER,
        uses_count      INTEGER       NOT NULL DEFAULT 0,
        is_active       BOOLEAN       NOT NULL DEFAULT true,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);

    // ─── CANCELLATION REASONS ─────────────────────────────────────────────────
    await q(`
      CREATE TABLE cancellation_reasons (
        id            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
        code          VARCHAR(50)    NOT NULL UNIQUE,
        description   TEXT           NOT NULL,
        applicable_to applicable_to,
        is_active     BOOLEAN        NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ    DEFAULT NOW()
      );
    `);

    // ─── RIDES ────────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE rides (
        id                        UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
        passenger_id              UUID             NOT NULL REFERENCES users(id),
        driver_id                 UUID             REFERENCES drivers(id),
        status                    enum_rides_status NOT NULL DEFAULT 'requested',
        pickup_location           GEOMETRY(POINT, 4326) NOT NULL,
        pickup_address            TEXT             NOT NULL,
        dropoff_location          GEOMETRY(POINT, 4326) NOT NULL,
        dropoff_address           TEXT             NOT NULL,
        vehicle_type_requested    vehicle_type,
        payment_method            payment_method     NOT NULL DEFAULT 'cash',
        base_fare                 DOUBLE PRECISION,
        fare_per_km               DOUBLE PRECISION,
        fare_per_minute           DOUBLE PRECISION,
        total_fare                DOUBLE PRECISION,
        discount_amount           DOUBLE PRECISION NOT NULL DEFAULT 0,
        final_fare                DOUBLE PRECISION NOT NULL,
        distance                  DOUBLE PRECISION,
        duration                  INTEGER,
        service_area_id           UUID             REFERENCES service_areas(id),
        promo_code_id             UUID             REFERENCES promo_codes(id),
        cancellation_reason_id    UUID             REFERENCES cancellation_reasons(id),
        cancelled_by              cancelled_by_type,
        accepted_at               TIMESTAMPTZ,
        arrived_at                TIMESTAMPTZ,
        passenger_ready_at        TIMESTAMPTZ,
        started_at                TIMESTAMPTZ,
        completed_at              TIMESTAMPTZ,
        cancelled_at              TIMESTAMPTZ,
        expires_at                TIMESTAMPTZ,

        deleted_at                TIMESTAMPTZ,
        created_at                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

        CONSTRAINT check_cancelled_consistency
          CHECK (
            (cancelled_by IS NULL AND cancelled_at IS NULL)
            OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
          ),
        CONSTRAINT check_reason_requires_cancellation
          CHECK (
            cancellation_reason_id IS NULL OR cancelled_by IS NOT NULL
          )
      );
    `);
    await q(`CREATE INDEX idx_rides_passenger    ON rides(passenger_id);`);
    await q(`CREATE INDEX idx_rides_driver       ON rides(driver_id);`);
    await q(`CREATE INDEX idx_rides_status       ON rides(status);`);
    await q(`CREATE INDEX idx_rides_service_area ON rides(service_area_id);`);

    // ─── RIDE OFFERS ──────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE ride_offers (
        id             UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        ride_id        UUID              NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
        driver_id      UUID              NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
        offered_price  NUMERIC(10,2)     NOT NULL,
        status         ride_offer_status NOT NULL DEFAULT 'pending',
        message        TEXT,
        expires_at     TIMESTAMPTZ       NOT NULL,
        created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW()
      );
    `);
    await q(
      `CREATE INDEX idx_ride_offers_ride_status ON ride_offers(ride_id, status);`,
    );

    // ─── PAYMENTS ─────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE payments (
        id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
        ride_id         UUID           NOT NULL UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
        passenger_id    UUID           NOT NULL REFERENCES users(id),
        amount          DOUBLE PRECISION NOT NULL,
        currency        VARCHAR(10)    NOT NULL DEFAULT 'BOB',
        payment_method  payment_method NOT NULL,
        payment_status  payment_status NOT NULL DEFAULT 'pending',
        transaction_id  VARCHAR(255),
        paid_at         TIMESTAMPTZ,
        created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      );
    `);
    await q(`CREATE INDEX idx_payments_ride ON payments(ride_id);`);

    // ─── RATINGS ──────────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE ratings (
        id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        ride_id       UUID        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
        driver_id     UUID        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
        passenger_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating        DOUBLE PRECISION NOT NULL,
        rater_type    rater_type  NOT NULL,
        comment       TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT check_rating_range CHECK (rating >= 1.0 AND rating <= 5.0)
      );
    `);
    await q(
      `CREATE UNIQUE INDEX unique_rating_per_ride ON ratings(ride_id, rater_type);`,
    );
    await q(`CREATE INDEX idx_ratings_ride ON ratings(ride_id);`);

    // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE notifications (
        id         UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id    UUID              NOT NULL REFERENCES users(id),
        title      VARCHAR(255)      NOT NULL,
        body       TEXT              NOT NULL,
        type       notification_type NOT NULL,
        data       JSONB,
        is_read    BOOLEAN           NOT NULL DEFAULT false,
        sent_at    TIMESTAMPTZ,
        read_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ       NOT NULL DEFAULT NOW()
      );
    `);
    await q(`CREATE INDEX idx_notifications_user ON notifications(user_id);`);

    // ─── COMMISSION SETTLEMENTS ───────────────────────────────────────────────
    await q(`
      CREATE TABLE commission_settlements (
        id               UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        driver_id        UUID              NOT NULL REFERENCES drivers(id),
        period_start     DATE              NOT NULL,
        period_end       DATE              NOT NULL,
        total_rides      INTEGER           NOT NULL,
        gross_amount     DOUBLE PRECISION  NOT NULL,
        total_commission DOUBLE PRECISION  NOT NULL,
        amount_paid      DOUBLE PRECISION,
        status           settlement_status NOT NULL DEFAULT 'open',
        due_date         DATE              NOT NULL,
        paid_at          TIMESTAMPTZ,
        payment_method   settlement_payment_method,
        notes            TEXT,
        created_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

        CONSTRAINT unique_settlement_per_period UNIQUE (driver_id, period_start, period_end),
        CONSTRAINT check_period_order            CHECK (period_end > period_start),
        CONSTRAINT check_amount_paid_positive    CHECK (amount_paid IS NULL OR amount_paid >= 0),
        CONSTRAINT check_paid_has_date           CHECK (status != 'paid' OR paid_at IS NOT NULL)
      );
    `);
    await q(
      `CREATE INDEX idx_settlements_driver   ON commission_settlements(driver_id);`,
    );
    await q(
      `CREATE INDEX idx_settlements_status   ON commission_settlements(status);`,
    );
    await q(
      `CREATE INDEX idx_settlements_due_date ON commission_settlements(due_date);`,
    );

    // ─── DRIVER EARNINGS ──────────────────────────────────────────────────────
    await q(`
      CREATE TABLE driver_earnings (
        id                 UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        driver_id          UUID              NOT NULL REFERENCES drivers(id),
        ride_id            UUID              NOT NULL UNIQUE REFERENCES rides(id),
        settlement_id      UUID              REFERENCES commission_settlements(id),
        payment_method     payment_method    NOT NULL,
        gross_amount       DOUBLE PRECISION  NOT NULL,
        commission_rate    DOUBLE PRECISION  NOT NULL,
        commission_amount  DOUBLE PRECISION  NOT NULL,
        net_amount         DOUBLE PRECISION  NOT NULL,
        commission_status  commission_status NOT NULL DEFAULT 'pending',
        commission_paid_at TIMESTAMPTZ,
        created_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW()
      );
    `);
    await q(
      `CREATE INDEX idx_driver_earnings_driver     ON driver_earnings(driver_id);`,
    );
    await q(
      `CREATE INDEX idx_driver_earnings_settlement ON driver_earnings(settlement_id);`,
    );

    // ─── PRICING RULES ────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE pricing_rules (
        id           UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
        name         VARCHAR(100)     NOT NULL,
        zone         GEOMETRY(POLYGON, 4326),
        multiplier   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        vehicle_type vehicle_type,
        day_of_week  INTEGER[],
        time_start   TIME,
        time_end     TIME,
        is_active    BOOLEAN          NOT NULL DEFAULT true,
        priority     INTEGER          NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW()
      );
    `);

    // ─── AUDIT LOGS ───────────────────────────────────────────────────────────
    await q(`
      CREATE TABLE audit_logs (
        id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        table_name  VARCHAR(100) NOT NULL,
        record_id   UUID         NOT NULL,
        action      audit_action NOT NULL,
        old_values  JSONB,
        new_values  JSONB,
        changed_by  UUID         REFERENCES users(id),
        changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ─── EMERGENCY CONTACTS ───────────────────────────────────────────────────
    // Contactos de confianza que recibirán SMS cuando el usuario pulse SOS.
    // Se recomienda limitar a 5 contactos por usuario en la capa de aplicación.
    await q(`
      CREATE TABLE emergency_contacts (
        id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        phone       VARCHAR(30)  NOT NULL,
        relation    VARCHAR(50),
        is_active   BOOLEAN      NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await q(`CREATE INDEX idx_emergency_contacts_user ON emergency_contacts(user_id);`);

    // ─── EMERGENCY ALERTS ─────────────────────────────────────────────────────
    // Registro central de cada activación del botón SOS.
    // ride_id es opcional: la emergencia puede ocurrir fuera de un viaje activo.
    // location guarda el punto GPS al momento de pulsar el botón.
    // resolved_by referencia al admin que marcó la alerta como resuelta.
    await q(`
      CREATE TABLE emergency_alerts (
        id               UUID                   PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id          UUID                   NOT NULL REFERENCES users(id),
        ride_id          UUID                   REFERENCES rides(id),
        status           emergency_alert_status NOT NULL DEFAULT 'active',
        location         GEOMETRY(POINT, 4326),
        location_address TEXT,
        triggered_at     TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        resolved_at      TIMESTAMPTZ,
        resolved_by      UUID                   REFERENCES users(id),
        notes            TEXT,
        created_at       TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ            NOT NULL DEFAULT NOW(),

        CONSTRAINT check_resolved_consistency
          CHECK (
            (status != 'resolved' AND resolved_at IS NULL)
            OR  (status  = 'resolved' AND resolved_at IS NOT NULL)
          )
      );
    `);
    await q(`CREATE INDEX idx_emergency_alerts_user   ON emergency_alerts(user_id);`);
    await q(`CREATE INDEX idx_emergency_alerts_ride   ON emergency_alerts(ride_id);`);
    await q(`CREATE INDEX idx_emergency_alerts_status ON emergency_alerts(status);`);
    await q(`CREATE INDEX idx_emergency_alerts_geo    ON emergency_alerts USING GIST(location);`);

    // ─── EMERGENCY SMS LOGS ───────────────────────────────────────────────────
    // Un alert genera una fila por cada contacto notificado.
    // provider_id almacena el ID del mensaje en el proveedor SMS (Twilio, AWS SNS…).
    await q(`
      CREATE TABLE emergency_sms_logs (
        id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        alert_id     UUID        NOT NULL REFERENCES emergency_alerts(id) ON DELETE CASCADE,
        contact_id   UUID        REFERENCES emergency_contacts(id),
        phone_to     VARCHAR(30) NOT NULL,
        message_body TEXT        NOT NULL,
        status       sms_status  NOT NULL DEFAULT 'pending',
        provider_id  VARCHAR(255),
        sent_at      TIMESTAMPTZ,
        failed_at    TIMESTAMPTZ,
        error_msg    TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT check_sms_status_dates
          CHECK (
            (status = 'sent'    AND sent_at   IS NOT NULL)
            OR (status = 'failed'  AND failed_at IS NOT NULL)
            OR  status = 'pending'
          )
      );
    `);
    await q(`CREATE INDEX idx_sms_logs_alert  ON emergency_sms_logs(alert_id);`);
    await q(`CREATE INDEX idx_sms_logs_status ON emergency_sms_logs(status);`);

    // ─── EMERGENCY RECORDINGS ─────────────────────────────────────────────────
    // El audio se almacena en storage externo (S3, GCS, etc.).
    // Esta tabla guarda solo la referencia y metadatos.
    // Un alert puede tener múltiples segmentos si la grabación se divide en chunks.
    await q(`
      CREATE TABLE emergency_recordings (
        id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        alert_id     UUID         NOT NULL REFERENCES emergency_alerts(id) ON DELETE CASCADE,
        file_url     VARCHAR(500) NOT NULL,
        duration_sec INTEGER,
        file_size    INTEGER,
        mime_type    VARCHAR(50)  NOT NULL DEFAULT 'audio/mp4',
        uploaded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

        CONSTRAINT check_file_size_positive CHECK (file_size    IS NULL OR file_size    > 0),
        CONSTRAINT check_duration_positive  CHECK (duration_sec IS NULL OR duration_sec > 0)
      );
    `);
    await q(`CREATE INDEX idx_recordings_alert ON emergency_recordings(alert_id);`);

    // ─── TRIGGER: validar razón de cancelación ────────────────────────────────
    await q(`
      CREATE OR REPLACE FUNCTION check_cancellation_reason_match()
      RETURNS TRIGGER AS $$
      DECLARE
        reason_applicable_to TEXT;
      BEGIN
        IF NEW.cancellation_reason_id IS NOT NULL THEN
          SELECT applicable_to INTO reason_applicable_to
          FROM cancellation_reasons
          WHERE id = NEW.cancellation_reason_id;

          IF reason_applicable_to = 'driver' AND NEW.cancelled_by = 'passenger' THEN
            RAISE EXCEPTION 'Esta razón de cancelación no aplica para pasajeros';
          END IF;
          IF reason_applicable_to = 'passenger' AND NEW.cancelled_by = 'driver' THEN
            RAISE EXCEPTION 'Esta razón de cancelación no aplica para conductores';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER validate_cancellation_reason
      BEFORE INSERT OR UPDATE ON rides
      FOR EACH ROW EXECUTE FUNCTION check_cancellation_reason_match();
    `);

    // ─── FUNCIONES PostgreSQL ─────────────────────────────────────────────────
    await q(`
      CREATE OR REPLACE FUNCTION generate_monthly_settlement(
        p_driver_id UUID, p_year INTEGER, p_month INTEGER
      )
      RETURNS UUID AS $$
      DECLARE
        v_period_start  DATE;
        v_period_end    DATE;
        v_settlement_id UUID;
        v_total_rides   INTEGER;
        v_gross_amount  DOUBLE PRECISION;
        v_total_comm    DOUBLE PRECISION;
      BEGIN
        v_period_start := make_date(p_year, p_month, 1);
        v_period_end   := (v_period_start + INTERVAL '1 month - 1 day')::DATE;

        IF EXISTS (
          SELECT 1 FROM commission_settlements
          WHERE driver_id = p_driver_id
          AND period_start = v_period_start AND period_end = v_period_end
        ) THEN
          RAISE EXCEPTION 'Ya existe un settlement para este conductor en ese periodo';
        END IF;

        SELECT COUNT(*), SUM(gross_amount), SUM(commission_amount)
        INTO v_total_rides, v_gross_amount, v_total_comm
        FROM driver_earnings
        WHERE driver_id = p_driver_id
        AND created_at BETWEEN v_period_start AND v_period_end + INTERVAL '1 day'
        AND commission_status = 'pending' AND settlement_id IS NULL;

        IF v_total_rides = 0 THEN RETURN NULL; END IF;

        v_settlement_id := gen_random_uuid();
        INSERT INTO commission_settlements (
          id, driver_id, period_start, period_end,
          total_rides, gross_amount, total_commission,
          status, due_date, created_at, updated_at
        ) VALUES (
          v_settlement_id, p_driver_id, v_period_start, v_period_end,
          v_total_rides, v_gross_amount, v_total_comm,
          'pending_payment', v_period_end + INTERVAL '5 days', now(), now()
        );

        UPDATE driver_earnings SET settlement_id = v_settlement_id
        WHERE driver_id = p_driver_id
        AND created_at BETWEEN v_period_start AND v_period_end + INTERVAL '1 day'
        AND commission_status = 'pending' AND settlement_id IS NULL;

        RETURN v_settlement_id;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await q(`
      CREATE OR REPLACE FUNCTION mark_settlement_paid(
        p_settlement_id UUID, p_amount DOUBLE PRECISION, p_payment_method TEXT
      )
      RETURNS BOOLEAN AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM commission_settlements
          WHERE id = p_settlement_id AND status IN ('pending_payment', 'overdue')
        ) THEN
          RAISE EXCEPTION 'Settlement no encontrado o no está pendiente de pago';
        END IF;

        UPDATE commission_settlements SET
          status = 'paid', paid_at = now(), amount_paid = p_amount,
          payment_method = p_payment_method::settlement_payment_method,
          updated_at = now()
        WHERE id = p_settlement_id;

        UPDATE driver_earnings SET
          commission_status = 'collected', commission_paid_at = now()
        WHERE settlement_id = p_settlement_id;

        RETURN TRUE;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await q(`
      CREATE OR REPLACE FUNCTION mark_overdue_settlements()
      RETURNS INTEGER AS $$
      DECLARE v_count INTEGER;
      BEGIN
        UPDATE commission_settlements
        SET status = 'overdue', updated_at = now()
        WHERE status = 'pending_payment' AND due_date < CURRENT_DATE;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await q(`
      CREATE OR REPLACE FUNCTION get_service_area(p_location GEOMETRY)
      RETURNS service_areas AS $$
      DECLARE v_area service_areas;
      BEGIN
        SELECT * INTO v_area FROM service_areas
        WHERE ST_Contains(boundary, p_location) AND is_active = true
        LIMIT 1;
        RETURN v_area;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await q(`
      CREATE OR REPLACE FUNCTION is_location_serviceable(p_location GEOMETRY)
      RETURNS BOOLEAN AS $$
      BEGIN
        RETURN EXISTS (
          SELECT 1 FROM service_areas
          WHERE ST_Contains(boundary, p_location) AND is_active = true
        );
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ─── Seed: usuario administrador ──────────────────────────────────────────
    const bcrypt = require('bcryptjs');
    const adminPasswordHash = bcrypt.hashSync('admin123', 10);
    await q(`
      INSERT INTO users (id, name, phone, email, password, role, firebase_uid, is_active, is_verified, created_at, updated_at)
      VALUES (
        '00000000-0000-0000-0000-000000000001',
        'Administrador',
        '+59169164016',
        'admin@linealila.com',
        '${adminPasswordHash}',
        'admin',
        'admin-uid',
        true,
        true,
        NOW(),
        NOW()
      );
    `);
  },

  // ────────────────────────────────────────────────────────────────────────────
  async down(queryInterface) {
    const q = sql => queryInterface.sequelize.query(sql);

    // Eliminar triggers y funciones
    await q(`DROP TRIGGER IF EXISTS validate_cancellation_reason ON rides;`);
    await q(`DROP FUNCTION IF EXISTS check_cancellation_reason_match CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS generate_monthly_settlement CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS mark_settlement_paid CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS mark_overdue_settlements CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS get_service_area CASCADE;`);
    await q(`DROP FUNCTION IF EXISTS is_location_serviceable CASCADE;`);

    // Eliminar tablas en orden inverso (respetando FKs)
    // — Módulo emergencias —
    await q(`DROP TABLE IF EXISTS emergency_recordings  CASCADE;`);
    await q(`DROP TABLE IF EXISTS emergency_sms_logs    CASCADE;`);
    await q(`DROP TABLE IF EXISTS emergency_alerts      CASCADE;`);
    await q(`DROP TABLE IF EXISTS emergency_contacts    CASCADE;`);
    // — Core —
    await q(`DROP TABLE IF EXISTS audit_logs             CASCADE;`);
    await q(`DROP TABLE IF EXISTS pricing_rules          CASCADE;`);
    await q(`DROP TABLE IF EXISTS driver_earnings        CASCADE;`);
    await q(`DROP TABLE IF EXISTS commission_settlements CASCADE;`);
    await q(`DROP TABLE IF EXISTS notifications          CASCADE;`);
    await q(`DROP TABLE IF EXISTS ratings                CASCADE;`);
    await q(`DROP TABLE IF EXISTS payments               CASCADE;`);
    await q(`DROP TABLE IF EXISTS ride_offers            CASCADE;`);
    await q(`DROP TABLE IF EXISTS rides                  CASCADE;`);
    await q(`DROP TABLE IF EXISTS cancellation_reasons   CASCADE;`);
    await q(`DROP TABLE IF EXISTS promo_codes            CASCADE;`);
    await q(`DROP TABLE IF EXISTS service_areas          CASCADE;`);
    await q(`DROP TABLE IF EXISTS request_files          CASCADE;`);
    await q(`DROP TABLE IF EXISTS driver_requests        CASCADE;`);
    await q(`DROP TABLE IF EXISTS driver_locations       CASCADE;`);
    await q(`DROP TABLE IF EXISTS vehicles               CASCADE;`);
    await q(`DROP TABLE IF EXISTS drivers                CASCADE;`);
    await q(`DROP TABLE IF EXISTS users                  CASCADE;`);

    // Eliminar ENUMs
    const enumNames = [
      'emergency_alert_status',
      'sms_status',
      'user_role',
      'driver_status',
      'vehicle_type',
      'vehicle_status',
      'enum_rides_status',
      'cancelled_by_type',
      'ride_offer_status',
      'payment_method',
      'payment_status',
      'rater_type',
      'commission_status',
      'settlement_status',
      'settlement_payment_method',
      'discount_type',
      'applicable_to',
      'notification_type',
      'audit_action',
      'driver_request_status',
      'request_file_type',
      'request_file_status',
      'ruat_required_reason',
    ];
    for (const e of enumNames) {
      await q(`DROP TYPE IF EXISTS ${e} CASCADE;`);
    }
  },
};