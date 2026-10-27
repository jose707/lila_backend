# Documentación de Base de Datos — App de Transporte tipo InDrive

> PostgreSQL con extensión PostGIS | ORM: Sequelize

`migrations/00000000-initial-schema.js` es la migración maestra y crea el esquema completo para una instalación nueva, incluidas las reglas de asignación rápida. `migrate.js` la ejecuta una sola vez y se detiene si encuentra tablas existentes de la aplicación. En una base existente, `npm run migrate:remove-retired` actualiza el esquema anterior. El OCR de CI se procesa en una sola solicitud. El esquema de CI no incluye tablas de sesión OCR o revisión manual, apellidos combinados ni un estado separado de aprobación documental.

---

## Índice

1. [Visión general](#visión-general)
2. [Diagrama de relaciones](#diagrama-de-relaciones)
3. [Tablas principales](#tablas-principales)
4. [Tablas de soporte](#tablas-de-soporte)
5. [Tablas de configuración](#tablas-de-configuración)
6. [Tablas del sistema](#tablas-del-sistema)
7. [ENUMs](#enums)
8. [Índices](#índices)
9. [Constraints](#constraints)
10. [Triggers](#triggers)
11. [Campos calculados](#campos-calculados)
12. [Flujos principales](#flujos-principales)

---

## Visión general

La base de datos soporta una aplicación de transporte donde pasajeros solicitan viajes, conductores hacen ofertas con su precio, y el pasajero acepta la oferta que prefiera (modelo InDrive).

**Características clave del modelo de negocio:**
- Los pagos son únicamente en **efectivo o QR directo al conductor**
- La plataforma **no intermedia el dinero**, solo cobra su comisión
- Las comisiones se acumulan por viaje y se cobran **una vez al mes** mediante un settlement
- Si el conductor no paga antes de la fecha límite, su cuenta puede bloquearse
- Un mismo usuario puede tener rol de pasajero y conductor simultáneamente

---

## Diagrama de relaciones

```
users ──────────────────── drivers ──────── vehicles
  │                           │
  ├── user_identities          ├── documents
  ├── documents ───────────────┘
  │                           ├── driver_locations
  │                           ├── driver_domiciles
  │                           ├── driver_requests ── documents
  │                           ├── driver_earnings ── commission_settlements
  │                           └── ride_offers
  ├────── rides ───────────────────────┤
  │          │                          │
  │          ├── ride_waypoints
  │          ├── ride_offers ───────────┘
  │          ├── payments
  │          ├── ratings
  │          ├── driver_earnings
  │          ├── cancellation_reasons (FK)
  │          └── service_areas (FK)
  │
  ├── emergency_contacts
  └── emergency_alerts ── emergency_sms_logs
                └──────── emergency_recordings

notifications ──── users
service_areas (zonas geográficas de operación — PostGIS)
pricing_rules (multiplicadores por zona/hora — PostGIS)
audit_logs (registra cambios en tablas críticas)
```

---

## Tablas principales

### `users`
Todos los usuarios de la app, tanto pasajeros como conductores. Un mismo usuario puede tener ambos roles.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `firebase_uid` | VARCHAR | NO | | ID de autenticación Firebase |
| `fcm_token` | VARCHAR | YES | | Firebase Device Token para Notificaciones Push |
| `email` | VARCHAR | YES | | Correo electrónico |
| `phone` | VARCHAR | YES | | Teléfono |
| `password` | VARCHAR | YES | | Contraseña hasheada |
| `role` | ENUM | NO | | `passenger`, `driver`, `admin` |
| `current_mode` | VARCHAR | YES | | Modo activo si el usuario tiene doble rol |
| `profile_photo` | VARCHAR | YES | | Ruta autenticada de la foto obtenida en Face Liveness (`/api/users/:id/profile-photo`) después de verificar la identidad |
| `is_active` | BOOLEAN | NO | true | Si la cuenta está activa |
| `phone_verified` | BOOLEAN | NO | false | Si el número de celular fue validado mediante OTP |
| `last_login` | TIMESTAMPTZ | YES | | Último inicio de sesión |
| `deleted_at` | TIMESTAMPTZ | YES | | Soft delete — no se borra físicamente |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

> ⚠️ `total_trips` fue eliminado — se calcula con `SELECT COUNT(*) FROM rides WHERE passenger_id = ?`
>
> ⚠️ `users` no guarda nombre ni estado de identidad. Para mostrar el nombre y validar identidad se consulta `user_identities`.

---

### `user_identities`

Datos oficiales de la cédula. Tiene una relación 1:1 con `users`; se mantiene fuera de `users` porque es información sensible.

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | UUID | NO | Identificador |
| `user_id` | UUID | NO | FK única → `users` |
| `first_names` | VARCHAR(150) | NO | Nombres |
| `paternal_surname` | VARCHAR(100) | YES | Apellido paterno |
| `maternal_surname` | VARCHAR(100) | YES | Apellido materno |
| `ci_number` | VARCHAR(20) | NO | Número de CI, único |
| `birth_date`, `issue_date`, `expiry_date` | DATE | | Fechas del CI |
| `birth_place`, `address`, `occupation` | VARCHAR | YES | Datos personales extraídos |
| `marital_status`, `blood_type` | VARCHAR | YES | Estado civil y grupo sanguíneo |
| `verification_status` | VARCHAR(20) | NO | `pending`, `verified`, `rejected` |
| `verified_at`, `verified_by`, `rejection_reason` | TIMESTAMPTZ/UUID/TEXT | YES | Resultado de verificación |

La identidad solo pasa a `verified` después de que el OCR valida los campos requeridos, Face Liveness supera su umbral y Rekognition compara su imagen de referencia con el rostro del frente del CI. El OCR admite la CI actual y la anterior: en la anterior los nombres se leen tras `A:`, el nacimiento tras `Nacido el` y el lugar de nacimiento tras `EN` en el reverso; las fechas impresas con meses en letras se normalizan antes de validar. El lugar de nacimiento es obligatorio para ambos formatos. No se exige MRZ en el diseño anterior. Las dos imágenes del CI y una versión reducida de la foto de referencia se conservan cifradas tras la aprobación.

El registro actual envía ambas caras del CI y el identificador de la prueba de vida al backend en una sola solicitud. El servidor obtiene el resultado y la foto de referencia directamente de la Lambda; la app no envía una selfie separada. La foto de referencia aprobada se guarda como documento `profilePhoto` cifrado y se sirve solo mediante una ruta autenticada.

El registro envía ambas imágenes juntas. El OCR y la validación se ejecutan antes de guardar; si todos los campos requeridos son válidos, la identidad y las referencias cifradas de documentos se guardan en una transacción. No existe guardado de borradores OCR en la base de datos.

---

### `drivers`
Perfil del conductor vinculado a un `user`. Solo existe si el usuario solicitó y fue aprobado como conductor.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `user_id` | UUID | NO | | FK → users |
| `license_number` | VARCHAR | YES | | Número de licencia; debe coincidir con el CI |
| `license_nationality` | VARCHAR | YES | | Nacionalidad impresa en la licencia |
| `license_issue_date`, `license_expiry` | DATE | YES | | Emisión y vencimiento |
| `license_category` | VARCHAR(20) | YES | | Categoría de conducir |
| `license_wears_glasses`, `license_uses_hearing_aid` | BOOLEAN | YES | | Restricciones indicadas en la licencia |
| `license_verification_status`, `license_verified_at` | VARCHAR/TIMESTAMPTZ | NO/YES | | Estado y fecha de revisión |
| `status` | ENUM | NO | | `pending`, `approved`, `rejected`, `suspended` |
| `is_available` | BOOLEAN | NO | false | Si está disponible para recibir viajes |
| `rejection_reason` | VARCHAR | YES | | Razón si fue rechazado |
| `deleted_at` | TIMESTAMPTZ | YES | | Soft delete |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

> ⚠️ Los siguientes campos **no son columnas físicas** — se calculan en tiempo de ejecución:
> - `rating` → promedio calculado desde la tabla `ratings` (`WHERE rater_type = 'passenger'`)
> - `total_trips_as_driver` → `COUNT(*)` desde `rides` (`WHERE driver_id = ? AND status = 'completed'`)
> - `total_earnings` → `SUM(net_amount)` desde `driver_earnings`

---

### `vehicles`
Vehículo(s) registrado(s) por el conductor. Un conductor puede tener múltiples vehículos pero solo uno activo.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `driver_id` | UUID | NO | | FK → drivers |
| `brand` | VARCHAR | NO | | Marca del vehículo |
| `model` | VARCHAR | NO | | Modelo del vehículo |
| `year` | INTEGER | NO | | Año de fabricación |
| `color` | VARCHAR | YES | | Color |
| `plate` | VARCHAR | NO | | Placa — UNIQUE |
| `capacity` | INTEGER | NO | 4 | Número de pasajeros |
| `vehicle_type` | ENUM | NO | `taxi` | `taxi`, `minibus`, `bus`, `motorcycle` |
| `registration_municipality`, `crpva_number` | VARCHAR | YES | | Radicatoria y código CRPVA del RUAT |
| `ruat_issue_date`, `ownership_start_date` | DATE | YES | | Emisión del RUAT e inicio de la propiedad actual |
| `door_count`, `service_type` | INTEGER/VARCHAR | YES | | Número de puertas y tipo de servicio declarado |
| `chassis_number`, `engine_number` | VARCHAR | YES | | Identificadores técnicos del vehículo |
| `fuel_type`, `engine_displacement`, `engine_type` | VARCHAR | YES | | Combustible, cilindrada y tipo de motor |
| `legal_observations` | TEXT | YES | | Restricciones u observaciones legales del RUAT |
| `status` | ENUM | NO | `active` | `active`, `inactive`, `suspended` |
| `ruat_file` | VARCHAR | YES | | Nombre del archivo RUAT en `/uploads/drivers/`. `NULL` = sin RUAT o rechazado. Presente = en revisión o aprobado (ver `ruat_verified`) |
| `ruat_verified` | BOOLEAN | NO | `false` | `true` = RUAT aprobado por el admin. Vehículo verificado |
| `ruat_verified_at` | TIMESTAMPTZ | YES | | Fecha en que el admin aprobó el RUAT |
| `ruat_required` | BOOLEAN | NO | `false` | `true` = el admin exige que el conductor envíe el RUAT urgentemente |
| `ruat_required_reason` | ENUM | YES | | Motivo del requerimiento: `accident`, `vehicle_mismatch`, `suspension_reactivation`, `criminal_record` |
| `ruat_required_at` | TIMESTAMPTZ | YES | | Fecha en que el admin activó el requerimiento |
| `soat_rosette_number` | VARCHAR | YES | | Número de roseta del SOAT vigente |
| `soat_start_date`, `soat_expiry_date` | DATE | YES | | Inicio y vencimiento de vigencia; el estado se calcula por vencimiento |
| `soat_use` | VARCHAR | YES | | Uso declarado: `PUBLICO` o `PARTICULAR` |
| `soat_verification_status`, `soat_verified_at` | VARCHAR/TIMESTAMPTZ | NO/YES | | Estado y fecha de revisión del SOAT |
| `deleted_at` | TIMESTAMPTZ | YES | | Soft delete |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

#### Estados derivados del RUAT (sin columnas extra)

| `ruat_file` | `ruat_verified` | `ruat_required` | Estado visible |
|---|---|---|---|
| `NULL` | `false` | `false` | ○ Sin RUAT (opcional) |
| `"foto.jpg"` | `false` | `false` | ⏳ En revisión por el admin |
| `"foto.jpg"` | `true` | `false` | ✅ Vehículo Verificado |
| `NULL` | `false` | `true` | ⚠️ RUAT requerido urgentemente |

#### Motivos de requerimiento (`ruat_required_reason`)

| Valor | Cuándo se usa |
|---|---|
| `accident` | Se reportó un accidente con el vehículo dentro de la app |
| `vehicle_mismatch` | Un pasajero reportó que el vehículo no coincide con el registrado |
| `suspension_reactivation` | El conductor fue suspendido y necesita verificar el vehículo para reactivarse |
| `criminal_record` | Se detectaron antecedentes que requieren verificación adicional del vehículo |

---

### `rides`
Viaje desde solicitud hasta completado o cancelado. Es la tabla central del sistema.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `passenger_id` | UUID | NO | | FK → users |
| `driver_id` | UUID | YES | | FK → drivers (se asigna cuando acepta una oferta) |
| `status` | ENUM | NO | | Ver estados abajo |
| `pickup_location` | GEOMETRY | NO | | Punto de recogida (PostGIS) |
| `pickup_address` | TEXT | NO | | Dirección de recogida en texto |
| `dropoff_location` | GEOMETRY | NO | | Punto de destino (PostGIS) |
| `dropoff_address` | TEXT | NO | | Dirección de destino en texto |
| `vehicle_type_requested` | ENUM | YES | | Tipo de vehículo que solicita el pasajero |
| `payment_method` | ENUM | NO | `cash` | Método de pago: `cash` o `qr` |
| `base_fare` | DOUBLE | YES | | Tarifa base calculada |
| `fare_per_km` | DOUBLE | YES | | Tarifa por kilómetro |
| `fare_per_minute` | DOUBLE | YES | | Tarifa por minuto |
| `total_fare` | DOUBLE | YES | | Tarifa total antes de descuentos |
| `discount_amount` | DOUBLE | YES | | Descuento aplicado, si corresponde |
| `final_fare` | DOUBLE | YES | | Tarifa final pagada |
| `distance` | DOUBLE | YES | | Distancia en km |
| `duration` | INTEGER | YES | | Duración en segundos |
| `service_area_id` | UUID | YES | | FK → service_areas. Zona donde ocurrió el viaje. NULL = viaje histórico antes de implementar zonas |
| `cancellation_reason_id` | UUID | YES | | FK → cancellation_reasons |
| `cancellation_reason` | VARCHAR | YES | | Razón en texto (campo legacy, deprecado) |
| `cancelled_by` | ENUM | YES | | `passenger` o `driver` |
| `requested_at` | TIMESTAMPTZ | YES | | Cuándo el pasajero solicitó el viaje |
| `accepted_at` | TIMESTAMPTZ | YES | | Cuándo el conductor aceptó |
| `arrived_at` | TIMESTAMPTZ | YES | | Cuándo el conductor llegó al punto de recogida |
| `passenger_ready_at` | TIMESTAMPTZ | YES | | Cuándo el pasajero confirmó que está listo |
| `started_at` | TIMESTAMPTZ | YES | | Cuándo inició el viaje |
| `completed_at` | TIMESTAMPTZ | YES | | Cuándo se completó |
| `cancelled_at` | TIMESTAMPTZ | YES | | Cuándo se canceló |
| `expires_at` | TIMESTAMPTZ | YES | | Cuándo expira la solicitud sin respuesta |

| `deleted_at` | TIMESTAMPTZ | YES | | Soft delete |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

**Estados posibles de `rides.status`:**
```
requested → offered → accepted → arrived → in_progress → completed
                                                        ↘ cancelled
```

> ⚠️ Las columnas `base_fare`, `fare_per_km` y `fare_per_minute` se mantienen aunque exista `service_areas`. Son una fotografía de las tarifas vigentes en el momento del viaje — si las tarifas de la zona cambian después, los viajes históricos conservan los valores que se aplicaron realmente.

---

### `ride_offers`
Ofertas que los conductores hacen a un viaje solicitado. El pasajero elige cuál aceptar.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `ride_id` | UUID | NO | | FK → rides |
| `driver_id` | UUID | NO | | FK → drivers |
| `offered_price` | NUMERIC | NO | | Precio que ofrece el conductor |
| `status` | ENUM | NO | | `pending`, `accepted`, `rejected`, `expired` |
| `message` | TEXT | YES | | Mensaje opcional del conductor al pasajero |
| `expires_at` | TIMESTAMPTZ | NO | | Cuándo expira la oferta |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

> **Constraint:** Un conductor no puede tener dos ofertas activas al mismo viaje — `UNIQUE INDEX unique_active_offer ON ride_offers(driver_id, ride_id) WHERE status = 'active'`

---

### `payments`
Registro del pago de cada viaje.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `ride_id` | UUID | NO | | FK → rides — UNIQUE (un pago por viaje) |
| `passenger_id` | UUID | NO | | FK → users |
| `amount` | DOUBLE | NO | | Monto pagado |
| `currency` | VARCHAR | NO | | Moneda, ej: `BOB`, `USD` |
| `payment_method` | ENUM | NO | | `cash`, `qr` |
| `payment_status` | ENUM | NO | | `pending`, `completed`, `failed`, `refunded` |
| `transaction_id` | VARCHAR | YES | | ID de transacción externa si aplica |
| `paid_at` | TIMESTAMPTZ | YES | | Cuándo se confirmó el pago |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

---

### `ratings`
Calificaciones entre pasajero y conductor al finalizar un viaje. Ambos se califican mutuamente.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `ride_id` | UUID | NO | | FK → rides |
| `driver_id` | UUID | NO | | FK → drivers |
| `passenger_id` | UUID | NO | | FK → users |
| `rating` | DOUBLE | NO | | Calificación entre 1.0 y 5.0 |
| `rater_type` | ENUM | NO | | `passenger` (califica al driver) o `driver` (califica al pasajero) |
| `comment` | TEXT | YES | | Comentario opcional |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

> **Constraints:**
> - `CHECK (rating >= 1.0 AND rating <= 5.0)`
> - `UNIQUE (ride_id, rater_type)` — evita doble calificación por viaje

---

### `driver_earnings`
Detalle de ganancias del conductor por cada viaje. Reemplaza el campo `total_earnings` que antes se acumulaba en `drivers`.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `driver_id` | UUID | NO | | FK → drivers |
| `ride_id` | UUID | NO | | FK → rides — UNIQUE (un registro por viaje) |
| `settlement_id` | UUID | YES | NULL | FK → commission_settlements. NULL mientras el viaje no ha sido incluido en un cobro mensual |
| `payment_method` | ENUM | NO | | `cash` o `qr` |
| `gross_amount` | DOUBLE | NO | | Lo que pagó el pasajero |
| `commission_rate` | DOUBLE | NO | | Tasa de comisión aplicada, ej: `0.20` = 20% |
| `commission_amount` | DOUBLE | NO | | `gross_amount × commission_rate` |
| `net_amount` | DOUBLE | NO | | `gross_amount - commission_amount` |
| `commission_status` | ENUM | NO | pending | `pending` = comisión no cobrada aún. `collected` = cobrada en el settlement mensual |
| `commission_paid_at` | TIMESTAMPTZ | YES | | Cuándo se marcó como cobrada (al pagar el settlement) |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |

**Relación entre `commission_status` y `settlement_id`:**

| settlement_id | commission_status | Significado |
|---|---|---|
| NULL | `pending` | Viaje recién completado, no incluido en ningún cobro |
| UUID | `pending` | Incluido en un settlement pero el conductor aún no pagó |
| UUID | `collected` | El conductor pagó el settlement, comisión cobrada |

**Flujo del dinero:**
```
Pasajero paga $10 al conductor (cash o QR)
→ gross_amount      = 10.00
→ commission_amount = 2.00  (el conductor le debe esto a la plataforma)
→ net_amount        = 8.00  (lo que se queda el conductor)
→ commission_status = 'pending'
→ settlement_id     = NULL  (hasta fin de mes)
```

---

### `commission_settlements`
Cobro mensual de comisiones agrupadas por conductor. En vez de cobrar viaje por viaje, al fin de cada mes se genera un resumen con el total acumulado.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `driver_id` | UUID | NO | | FK → drivers |
| `period_start` | DATE | NO | | Primer día del periodo, ej: `2024-01-01` |
| `period_end` | DATE | NO | | Último día del periodo, ej: `2024-01-31` |
| `total_rides` | INTEGER | NO | | Cantidad de viajes incluidos en este cobro |
| `gross_amount` | DOUBLE | NO | | Suma de todos los `gross_amount` del periodo |
| `total_commission` | DOUBLE | NO | | Suma de todas las comisiones del periodo |
| `amount_paid` | DOUBLE | YES | NULL | Lo que pagó el conductor (puede ser parcial) |
| `status` | ENUM | NO | `open` | Ver estados abajo |
| `due_date` | DATE | NO | | Fecha límite de pago (generalmente 5 días después del cierre) |
| `paid_at` | TIMESTAMPTZ | YES | | Cuándo pagó el conductor |
| `payment_method` | ENUM | YES | | `cash`, `qr`, `transfer` |
| `notes` | TEXT | YES | | Observaciones del admin |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

**Estados posibles de `commission_settlements.status`:**

| Estado | Significado |
|---|---|
| `open` | Mes en curso, los viajes se siguen acumulando |
| `pending_payment` | Mes cerrado, esperando que el conductor pague |
| `paid` | El conductor pagó |
| `overdue` | Venció el `due_date` sin pago — se puede bloquear la cuenta |

**Constraints:**
- `UNIQUE (driver_id, period_start, period_end)` — un solo settlement por conductor por periodo
- `CHECK (period_end > period_start)`
- `CHECK (amount_paid >= 0)` cuando no es NULL
- `CHECK` si `status = 'paid'` entonces `paid_at` no puede ser NULL

---

## Tablas de soporte

### `driver_locations`
Ubicación en tiempo real del conductor. Se actualiza constantemente mientras está en línea.

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `driver_id` | UUID | NO | PK + FK → drivers |
| `location` | GEOMETRY | NO | Punto geográfico PostGIS |
| `heading` | DOUBLE | YES | Dirección en grados (0-360) |
| `speed` | DOUBLE | YES | Velocidad en km/h |
| `is_online` | BOOLEAN | NO | Si el conductor está activo en la app |
| `updated_at` | TIMESTAMPTZ | NO | Última actualización de ubicación |

> **Índice espacial:** `CREATE INDEX idx_driver_locations_geo ON driver_locations USING GIST(location)`

---

### `driver_requests`
Solicitudes de registro como conductor. Incluye el historial de versiones si hay rechazos y reenvíos.

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | UUID | NO | Identificador único |
| `driver_id` | UUID | YES | FK → drivers (si ya fue creado) |
| `user_id` | UUID | NO | FK → users |
| `status` | ENUM | NO | `pending`, `observed`, `approved`, `rejected` |
| `rejection_reason` | TEXT | YES | Motivo de observación o rechazo (nombre heredado de la columna) |
| `rejected_documents` | JSON | YES | Documentos que deben corregirse al observar la solicitud (nombre heredado) |
| `metadata` | JSON | YES | Datos OCR y auxiliares de la solicitud; el domicilio se guarda en `driver_domiciles` |
| `version` | INTEGER | NO | Versión del intento (incrementa en cada reenvío) |
| `created_at` | TIMESTAMPTZ | NO | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | Fecha de última modificación |

`pending` = recibida para revisión; `observed` = requiere correcciones y puede reenviarse; `approved` = habilitada; `rejected` = decisión negativa. En una base existente, ejecutar `npm run migrate:driver-request-status` dentro de `backend` para agregar `observed` al ENUM; la migración maestra ya lo incluye para bases nuevas.

### `driver_domiciles`

Una fila por versión de solicitud. El domicilio declarado puede diferir del domicilio impreso en `user_identities.address` (CI). No se utiliza para la posición operativa del conductor.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Identificador |
| `user_id` | UUID | Usuario solicitante |
| `driver_request_id` | UUID UNIQUE | Solicitud/version a la que pertenece |
| `address` | VARCHAR(255) | Dirección actual declarada |
| `location` | GEOMETRY(POINT, 4326) | Punto marcado en el mapa |
| `verification_status` | VARCHAR(20) | `pending`, `verified` o `rejected` |
| `verified_by`, `verified_at` | UUID, TIMESTAMPTZ | Revisor y fecha |
| `rejection_reason` | TEXT | Motivo de observación |
| `created_at`, `updated_at` | TIMESTAMPTZ | Historial |

El comprobante permanece en `documents` con tipo `domicileProof` y el mismo `driver_request_id`. En una base existente, ejecutar `npm run migrate:driver-domiciles`: crea la tabla, traslada los domicilios válidos de `metadata` y elimina allí la copia. Las entradas inválidas quedan intactas para revisión manual.

---

### `documents`

Registro genérico de archivos vigentes. Evita crear una tabla por cada foto.
Reemplaza a la antigua tabla `request_files`: los archivos de una solicitud se
vinculan mediante `driver_request_id`.

| Grupo de columnas | Descripción |
|---|---|
| `user_id`, `driver_id`, `vehicle_id` | Propietario del documento; solo `user_id` es obligatorio |
| `driver_request_id` | Solicitud de conductor que presentó el archivo; conserva las versiones y el historial |
| `document_type` | `ciFront`, `ciBack`, `licenseFront`, `licenseBack`, `ticPhoto`, `antecedentsPhoto`, `ruatPhoto`, `soatPhoto`, `domicileProof` o fotos del vehículo/perfil |
| `file_path`, `original_filename`, `mime_type`, `file_size` | Archivo almacenado |
| `ocr_data`, `issued_at`, `expires_at` | Lectura OCR y vigencias |
| `is_current` | Permite conservar documentos vencidos como historial |
| `verification_status`, `verified_at`, `verified_by`, `rejection_reason` | Revisión documental administrativa. Estado: `pending`, `verified` o `rejected` |

El OCR y las comparaciones (CI/licencia, TIC/CI y licencia, CI/RUAT, RUAT/SOAT) validan el envío inicial, pero la solicitud queda `pending`. El administrador marca los documentos revisados y decide `approved`, `observed` o `rejected`. Solo al aprobar se crean el conductor y el vehículo. `observed` permite corregir y reenviar los documentos señalados; `rejected` es una decisión final. La TIC se guarda como documento, sin duplicar el nombre del conductor.

En una base existente, ejecutar `npm run migrate:tic` dentro de `backend` para permitir `ticPhoto` en el `CHECK` de `documents.document_type`. La migración maestra ya lo incluye para bases nuevas.

El domicilio requiere dirección escrita, ubicación marcada en el mapa y `domicileProof`. Los dos primeros se guardan en `driver_domiciles`; la foto se guarda en `documents`. El administrador comprueba el conjunto y puede observarlo para corrección. Para una base existente, ejecutar primero `npm run migrate:domicile` si aún no se ejecutó, y después `npm run migrate:driver-domiciles`. La migración maestra incluye ambos para bases nuevas.

---

### `ride_waypoints`
Paradas intermedias de un viaje (rutas con múltiples destinos). Cada viaje puede tener 0 o más paradas ordenadas por secuencia.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `ride_id` | UUID | NO | | FK → rides (CASCADE) |
| `sequence` | SMALLINT | NO | | Número de orden de la parada (1, 2, 3...) |
| `location` | GEOMETRY(POINT, 4326) | NO | | Ubicación de la parada intermedia (WGS84) |
| `address` | TEXT | NO | | Dirección legible de la parada |
| `arrived_at` | TIMESTAMPTZ | YES | | Cuándo llegó el conductor a la parada |
| `departed_at` | TIMESTAMPTZ | YES | | Cuándo salió el conductor de la parada |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |

**Constraints:**
- `UNIQUE (ride_id, sequence)` — previene paradas duplicadas con el mismo número
- `ON DELETE CASCADE` — al borrar un viaje se borran sus paradas

**Índices:**
- `idx_ride_waypoints_ride_id` — búsquedas por viaje
- `idx_ride_waypoints_geo` (GIST) — queries espaciales de ubicación

**Notas:**
- El campo `pickup_location` en `rides` es el inicio; el `dropoff_location` es el destino final
- Las paradas intermedias son complementarias al flujo principal pickup → dropoff
- `arrived_at` y `departed_at` se registran en tiempo real durante el viaje

---

### `emergency_contacts`
Contactos del usuario que pueden recibir avisos por SMS durante una emergencia. Cada fila guarda `user_id`, `name`, `phone`, `relation`, `is_active` y fechas de creación y actualización.

### `emergency_alerts`
Cada activación SOS crea una alerta vinculada a `users` y, opcionalmente, a `rides`. Guarda estado (`active`, `resolved` o `false_alarm`), ubicación, dirección, hora de activación, resolución, responsable y notas.

### `emergency_sms_logs`
Registra un envío de SMS por contacto y alerta. Incluye número de destino, mensaje, estado (`pending`, `sent` o `failed`), identificador del proveedor y fechas o error del envío.

### `emergency_recordings`
Guarda referencias y metadatos de las grabaciones externas asociadas con una alerta. Una alerta puede tener varios segmentos de audio.

---

### `notifications`
Historial de notificaciones push enviadas a los usuarios.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `user_id` | UUID | NO | | FK → users |
| `title` | VARCHAR | NO | | Título de la notificación |
| `body` | TEXT | NO | | Texto del mensaje |
| `type` | ENUM | NO | | `ride_request`, `ride_accepted`, `ride_cancelled`, `payment`, `system`, `emergency`, `panic` |
| `data` | JSONB | YES | | Payload extra, ej: `{"ride_id": "uuid"}` para abrir el viaje al tocar |
| `is_read` | BOOLEAN | NO | false | Si el usuario ya la leyó |
| `sent_at` | TIMESTAMPTZ | YES | | Cuándo se envió al dispositivo |
| `read_at` | TIMESTAMPTZ | YES | | Cuándo el usuario la abrió |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |

---

### `audit_logs`
Registro de cambios en tablas críticas para trazabilidad y auditoría.

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | UUID | NO | Identificador único |
| `table_name` | VARCHAR | NO | Tabla que fue modificada |
| `record_id` | UUID | NO | ID del registro modificado |
| `action` | ENUM | NO | `INSERT`, `UPDATE`, `DELETE` |
| `old_values` | JSONB | YES | Valores anteriores al cambio |
| `new_values` | JSONB | YES | Valores nuevos tras el cambio |
| `changed_by` | UUID | YES | FK → users (quién hizo el cambio) |
| `changed_at` | TIMESTAMPTZ | NO | Cuándo ocurrió el cambio |

---

## Tablas de configuración

### `service_areas`
Define las zonas geográficas donde opera la app. Cada zona tiene sus propias tarifas base y límites geográficos. Las solicitudes fuera de toda zona activa son rechazadas.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `name` | VARCHAR(100) | NO | | Nombre descriptivo, ej: `La Paz`, `El Alto`, `Cochabamba` |
| `boundary` | GEOMETRY(POLYGON) | NO | | Polígono PostGIS que define los límites geográficos del área |
| `is_active` | BOOLEAN | NO | true | Si la app opera actualmente en esta zona |
| `base_fare` | DOUBLE PRECISION | YES | | Tarifa base de esta zona. NULL = usar tarifa global |
| `fare_per_km` | DOUBLE PRECISION | YES | | Precio por km en esta zona. NULL = usar tarifa global |
| `fare_per_minute` | DOUBLE PRECISION | YES | | Precio por minuto en esta zona. NULL = usar tarifa global |
| `currency` | VARCHAR(10) | NO | `BOB` | Moneda que se usa en esta zona |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

**Constraints:**
- `CHECK (base_fare > 0)` cuando no es NULL
- `CHECK (fare_per_km > 0)` cuando no es NULL
- `CHECK (fare_per_minute > 0)` cuando no es NULL

**¿Por qué no usar ENUM para los nombres de zonas?**
Un ENUM requiere una migración y despliegue cada vez que se agrega una ciudad. Con esta tabla basta con insertar un registro desde el panel de admin sin tocar el código ni reiniciar el servidor.

**Flujo de uso:**
```
1. Pasajero solicita viaje
2. Se consulta service_areas con ST_Contains(boundary, pickup_location)
3. Si no hay zona activa → solicitud rechazada
4. Si hay zona → se copian sus tarifas a rides.baseFare, farePerKm, farePerMinute
5. rides.service_area_id → apunta a la zona donde ocurrió el viaje
```

---

### `cancellation_reasons`
Catálogo de razones de cancelación. Reemplaza el campo de texto libre `cancellationReason` en `rides`.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `code` | VARCHAR(50) | NO | | Clave interna, ej: `driver_no_show` |
| `description` | TEXT | NO | | Texto que ve el usuario, ej: "El conductor no se presentó" |
| `applicable_to` | ENUM | YES | | `passenger`, `driver`, `both` |
| `is_active` | BOOLEAN | NO | true | Si aparece en la app |
| `created_at` | TIMESTAMPTZ | YES | | Fecha de creación |

---

### `pricing_rules`
Reglas de precios dinámicos (surge pricing) por zona geográfica y franja horaria.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | UUID | NO | | Identificador único |
| `name` | VARCHAR(100) | NO | | Nombre descriptivo, ej: "Hora pico mañana centro" |
| `zone` | GEOMETRY(POLYGON) | YES | | Polígono PostGIS que define el área de aplicación |
| `multiplier` | DOUBLE | NO | 1.0 | Factor multiplicador, ej: `1.5` = 50% más caro |
| `vehicle_type` | ENUM | YES | | Si aplica solo a un tipo de vehículo. NULL = todos |
| `day_of_week` | INTEGER[] | YES | | Días que aplica, ej: `{1,2,3,4,5}`. NULL = todos los días |
| `time_start` | TIME | YES | | Hora de inicio, ej: `07:00` |
| `time_end` | TIME | YES | | Hora de fin, ej: `09:00` |
| `is_active` | BOOLEAN | NO | true | Si la regla está activa |
| `priority` | INTEGER | NO | 0 | Si dos reglas se solapan, gana la de mayor prioridad |
| `created_at` | TIMESTAMPTZ | NO | | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | NO | | Fecha de última modificación |

---

## Tablas del sistema

| Tabla | Descripción |
|---|---|
| `SequelizeMeta` | No se usa; `migrate.js` ejecuta directamente la migración maestra una sola vez |
| `spatial_ref_sys` | Sistema de referencia espacial de PostGIS (no modificar) |
| `geometry_columns` | Metadatos de columnas geométricas de PostGIS (no modificar) |
| `geography_columns` | Metadatos de columnas geográficas de PostGIS (no modificar) |

---

## ENUMs

```sql
-- Roles de usuario
user_role: 'passenger', 'driver', 'admin'

-- Estados del conductor
driver_status: 'pending', 'approved', 'rejected', 'suspended'

-- Estados del viaje
ride_status: 'requested', 'offered', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'

-- Quién canceló el viaje
cancelled_by_type: 'passenger', 'driver', 'system'

-- Tipo de vehículo
vehicle_type: 'taxi', 'minibus', 'motorcycle', 'bus'

-- Estados del vehículo
vehicle_status: 'active', 'inactive', 'pending_review'

-- Estados de la oferta
ride_offer_status: 'pending', 'accepted', 'rejected', 'expired'

-- Métodos de pago
payment_method: 'cash', 'qr'

-- Estados del pago
payment_status: 'pending', 'completed', 'failed', 'refunded'

-- Quién calificó
rater_type: 'passenger', 'driver'

-- Estado de comisión del conductor
commission_status: 'pending', 'collected'

-- A quién aplica la razón de cancelación
applicable_to: 'passenger', 'driver', 'both'

-- Tipo de notificación
notification_type: 'ride_request', 'ride_accepted', 'ride_cancelled', 'payment', 'system', 'emergency', 'panic'

-- Estado del cobro mensual
settlement_status: 'open', 'pending_payment', 'paid', 'overdue'

-- Método de pago del settlement
settlement_payment_method: 'cash', 'qr', 'transfer'

-- Acciones de auditoría
audit_action: 'INSERT', 'UPDATE', 'DELETE'

-- document_type es VARCHAR con valores controlados por CHECK en documents
-- (ciFront, ciBack, licenseFront, licenseBack, ticPhoto, antecedentes, RUAT, SOAT y fotos del vehículo)
```

---

## Índices

```sql
-- Rendimiento en consultas de viajes
CREATE INDEX idx_rides_passenger    ON rides(passenger_id);
CREATE INDEX idx_rides_driver       ON rides(driver_id);
CREATE INDEX idx_rides_status       ON rides(status);

-- Rendimiento en ofertas
CREATE INDEX idx_ride_offers_ride_status ON ride_offers(ride_id, status);

-- Rendimiento en pagos
CREATE INDEX idx_payments_ride      ON payments(ride_id);

-- Rendimiento en calificaciones
CREATE INDEX idx_ratings_ride       ON ratings(ride_id);

-- Rendimiento en notificaciones
CREATE INDEX idx_notifications_user ON notifications(user_id);

-- Rendimiento en ganancias
CREATE INDEX idx_driver_earnings_driver     ON driver_earnings(driver_id);
CREATE INDEX idx_driver_earnings_settlement ON driver_earnings(settlement_id);

-- Rendimiento en settlements
CREATE INDEX idx_settlements_driver   ON commission_settlements(driver_id);
CREATE INDEX idx_settlements_status   ON commission_settlements(status);
CREATE INDEX idx_settlements_due_date ON commission_settlements(due_date);

-- Índice espacial para ubicaciones en tiempo real
CREATE INDEX idx_driver_locations_geo ON driver_locations USING GIST(location);

-- Índices de zonas de servicio
CREATE INDEX idx_service_areas_boundary ON service_areas USING GIST(boundary);
CREATE INDEX idx_service_areas_active   ON service_areas(is_active);
CREATE INDEX idx_rides_service_area     ON rides(service_area_id);

-- Índices para paradas intermedias de viajes
CREATE INDEX idx_ride_waypoints_ride_id ON ride_waypoints(ride_id);
CREATE INDEX idx_ride_waypoints_geo     ON ride_waypoints USING GIST(location);

```

---

## Constraints

```sql
-- Evitar que un conductor haga dos ofertas activas al mismo viaje
CREATE UNIQUE INDEX unique_active_offer
ON ride_offers(driver_id, ride_id)
WHERE status = 'active';

-- Evitar que alguien califique dos veces el mismo viaje
CREATE UNIQUE INDEX unique_rating_per_ride
ON ratings(ride_id, rater_type);

-- Validar que la calificación esté entre 1 y 5
ALTER TABLE ratings
ADD CONSTRAINT check_rating_range
CHECK (rating >= 1.0 AND rating <= 5.0);

-- Consistencia de cancelación: si hay cancelled_by debe haber cancelled_at y viceversa
ALTER TABLE rides
ADD CONSTRAINT check_cancelled_consistency
CHECK (
  (cancelled_by IS NULL AND cancelled_at IS NULL)
  OR
  (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
);

-- Si hay razón de cancelación, debe haber cancelled_by
ALTER TABLE rides
ADD CONSTRAINT check_reason_requires_cancellation
CHECK (
  cancellation_reason_id IS NULL
  OR cancelled_by IS NOT NULL
);

-- Un solo settlement por conductor por periodo
ALTER TABLE commission_settlements
ADD CONSTRAINT unique_settlement_per_period
UNIQUE (driver_id, period_start, period_end);

-- El periodo debe ser válido
ALTER TABLE commission_settlements
ADD CONSTRAINT check_period_order
CHECK (period_end > period_start);

-- Si el monto pagado existe, debe ser positivo
ALTER TABLE commission_settlements
ADD CONSTRAINT check_amount_paid_positive
CHECK (amount_paid IS NULL OR amount_paid >= 0);

-- Si está marcado como pagado, debe tener fecha de pago
ALTER TABLE commission_settlements
ADD CONSTRAINT check_paid_has_date
CHECK (
  status != 'paid' OR paid_at IS NOT NULL
);

-- Paradas intermedias: una parada por secuencia por viaje
ALTER TABLE ride_waypoints
ADD CONSTRAINT uq_ride_waypoint UNIQUE (ride_id, sequence);

```

---

## Triggers

### `validate_cancellation_reason`
Valida que la razón de cancelación sea compatible con quién canceló el viaje. Ejemplo: un pasajero no puede usar una razón que solo aplica a conductores.

```sql
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
FOR EACH ROW
EXECUTE FUNCTION check_cancellation_reason_match();
```

---

### `generate_monthly_settlement`
Genera el cobro mensual de comisiones para un conductor. Se ejecuta al cerrar cada mes.

```sql
CREATE OR REPLACE FUNCTION generate_monthly_settlement(
  p_driver_id UUID,
  p_year INTEGER,
  p_month INTEGER
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

  -- Verificar que no exista ya un settlement para ese periodo
  IF EXISTS (
    SELECT 1 FROM commission_settlements
    WHERE driver_id = p_driver_id
    AND period_start = v_period_start
    AND period_end = v_period_end
  ) THEN
    RAISE EXCEPTION 'Ya existe un settlement para este conductor en ese periodo';
  END IF;

  -- Calcular resumen del periodo
  SELECT COUNT(*), SUM(gross_amount), SUM(commission_amount)
  INTO v_total_rides, v_gross_amount, v_total_comm
  FROM driver_earnings
  WHERE driver_id = p_driver_id
  AND created_at BETWEEN v_period_start AND v_period_end + INTERVAL '1 day'
  AND commission_status = 'pending'
  AND settlement_id IS NULL;

  -- Si no hay viajes pendientes, no hacer nada
  IF v_total_rides = 0 THEN
    RETURN NULL;
  END IF;

  -- Crear el settlement
  v_settlement_id := gen_random_uuid();
  INSERT INTO commission_settlements (
    id, driver_id, period_start, period_end,
    total_rides, gross_amount, total_commission,
    status, due_date, created_at, updated_at
  ) VALUES (
    v_settlement_id, p_driver_id, v_period_start, v_period_end,
    v_total_rides, v_gross_amount, v_total_comm,
    'pending_payment',
    v_period_end + INTERVAL '5 days',
    now(), now()
  );

  -- Vincular los viajes al settlement
  UPDATE driver_earnings
  SET settlement_id = v_settlement_id
  WHERE driver_id = p_driver_id
  AND created_at BETWEEN v_period_start AND v_period_end + INTERVAL '1 day'
  AND commission_status = 'pending'
  AND settlement_id IS NULL;

  RETURN v_settlement_id;
END;
$$ LANGUAGE plpgsql;
```

---

### `mark_settlement_paid`
Registra el pago de un settlement y actualiza todos los viajes vinculados a `collected`.

```sql
CREATE OR REPLACE FUNCTION mark_settlement_paid(
  p_settlement_id  UUID,
  p_amount         DOUBLE PRECISION,
  p_payment_method TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Verificar que existe y está en estado cobrable
  IF NOT EXISTS (
    SELECT 1 FROM commission_settlements
    WHERE id = p_settlement_id
    AND status IN ('pending_payment', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Settlement no encontrado o no está pendiente de pago';
  END IF;

  -- Marcar el settlement como pagado
  UPDATE commission_settlements SET
    status         = 'paid',
    paid_at        = now(),
    amount_paid    = p_amount,
    payment_method = p_payment_method::settlement_payment_method,
    updated_at     = now()
  WHERE id = p_settlement_id;

  -- Marcar todos los viajes vinculados como cobrados
  UPDATE driver_earnings SET
    commission_status  = 'collected',
    commission_paid_at = now()
  WHERE settlement_id = p_settlement_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

---

### `mark_overdue_settlements`
Marca como vencidos todos los settlements que superaron su `due_date`. Debe ejecutarse diariamente con un cron job.

```sql
CREATE OR REPLACE FUNCTION mark_overdue_settlements()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE commission_settlements
  SET status     = 'overdue',
      updated_at = now()
  WHERE status   = 'pending_payment'
  AND due_date   < CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
```

---

### `get_service_area`
Recibe un punto geográfico y retorna el área de servicio activa que lo contiene. Se usa al crear una solicitud de viaje para determinar la zona y sus tarifas.

```sql
CREATE OR REPLACE FUNCTION get_service_area(p_location GEOMETRY)
RETURNS service_areas AS $$
DECLARE
  v_area service_areas;
BEGIN
  SELECT * INTO v_area
  FROM service_areas
  WHERE ST_Contains(boundary, p_location)
  AND is_active = true
  LIMIT 1;

  RETURN v_area;
END;
$$ LANGUAGE plpgsql;
```

---

### `is_location_serviceable`
Retorna `TRUE` si el punto está dentro de alguna zona activa, `FALSE` si está fuera. Se usa para rechazar solicitudes fuera de cobertura antes de crearlas.

```sql
CREATE OR REPLACE FUNCTION is_location_serviceable(p_location GEOMETRY)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM service_areas
    WHERE ST_Contains(boundary, p_location)
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql;
```

---

## Campos calculados

Estos campos **no se almacenan** en la BD. Se calculan con queries en tiempo de ejecución:

### Ganancias totales del conductor
```sql
SELECT SUM(net_amount)
FROM driver_earnings
WHERE driver_id = 'uuid-del-driver';
```

### Comisiones pendientes del conductor
```sql
SELECT SUM(commission_amount)
FROM driver_earnings
WHERE driver_id = 'uuid-del-driver'
AND commission_status = 'pending';
```

### Total de viajes completados del conductor
```sql
SELECT COUNT(*)
FROM rides
WHERE driver_id = 'uuid-del-driver'
AND status = 'completed';
```

### Total de viajes del pasajero
```sql
SELECT COUNT(*)
FROM rides
WHERE passenger_id = 'uuid-del-usuario'
AND status = 'completed';
```

### Calificación promedio del conductor
```sql
SELECT AVG(rating)
FROM ratings
WHERE driver_id = 'uuid-del-driver'
AND rater_type = 'passenger';
```

### Calificación promedio del pasajero
```sql
SELECT AVG(rating)
FROM ratings
WHERE passenger_id = 'uuid-del-pasajero'
AND rater_type = 'driver';
```

### Ver deuda actual de un conductor
```sql
SELECT
  period_start,
  period_end,
  total_rides,
  total_commission,
  status,
  due_date
FROM commission_settlements
WHERE driver_id = 'uuid-del-driver'
ORDER BY period_start DESC;
```

### Ver todos los conductores con deuda vencida
```sql
SELECT
  d.id AS driver_id,
  CONCAT_WS(' ', ui.first_names, ui.paternal_surname, ui.maternal_surname) AS name,
  u.phone,
  SUM(cs.total_commission) AS deuda_total
FROM commission_settlements cs
JOIN drivers d ON d.id = cs.driver_id
JOIN users u ON u.id = d.user_id
LEFT JOIN user_identities ui ON ui.user_id = u.id
WHERE cs.status = 'overdue'
GROUP BY d.id, ui.first_names, ui.paternal_surname, ui.maternal_surname, u.phone
ORDER BY deuda_total DESC;
```

### Ver detalle de viajes de un settlement
```sql
SELECT
  r.pickup_address,
  r.dropoff_address,
  de.gross_amount,
  de.commission_amount,
  de.net_amount,
  de.payment_method,
  r.completed_at
FROM driver_earnings de
JOIN rides r ON r.id = de.ride_id
WHERE de.settlement_id = 'uuid-del-settlement'
ORDER BY r.completed_at;
```

### Validar si un punto está dentro de una zona activa
```sql
SELECT id, name, base_fare, fare_per_km, fare_per_minute
FROM service_areas
WHERE ST_Contains(boundary, ST_GeomFromText('POINT(-68.1193 -16.5000)', 4326))
AND is_active = true
LIMIT 1;
```

### Ver en qué zona ocurrió cada viaje
```sql
SELECT
  r.id,
  r.pickup_address,
  sa.name          AS zona,
  r.base_fare,
  r.fare_per_km,
  r.final_fare
FROM rides r
LEFT JOIN service_areas sa ON sa.id = r.service_area_id
ORDER BY r.created_at DESC;
```

### Detectar viajes fuera de zona (no deberían existir)
```sql
SELECT COUNT(*)
FROM rides
WHERE service_area_id IS NULL
AND created_at > '2024-01-01';  -- solo viajes nuevos, no históricos
```

### Comparar tarifa aplicada vs tarifa actual de la zona
```sql
SELECT
  r.id,
  r.created_at,
  r.base_fare        AS tarifa_aplicada,
  sa.base_fare        AS tarifa_actual,
  r.base_fare - sa.base_fare AS diferencia
FROM rides r
JOIN service_areas sa ON sa.id = r.service_area_id
WHERE r.status = 'completed'
ORDER BY r.created_at DESC;
```

### Ver todas las paradas de un viaje ordenadas
```sql
SELECT
  rw.sequence,
  rw.address,
  ST_X(rw.location)::NUMERIC(10,6) AS longitude,
  ST_Y(rw.location)::NUMERIC(10,6) AS latitude,
  rw.arrived_at,
  rw.departed_at,
  EXTRACT(EPOCH FROM (rw.departed_at - rw.arrived_at)) / 60 AS duracion_minutos
FROM ride_waypoints rw
WHERE rw.ride_id = 'uuid-del-viaje'
ORDER BY rw.sequence ASC;
```

### Verificar que todas las paradas fueron completadas
```sql
SELECT
  COUNT(*) AS total_paradas,
  COUNT(CASE WHEN arrived_at IS NOT NULL THEN 1 END) AS completadas,
  COUNT(CASE WHEN arrived_at IS NULL THEN 1 END) AS pendientes
FROM ride_waypoints
WHERE ride_id = 'uuid-del-viaje';
```

---

## Flujos principales

### 1. Solicitud y aceptación de viaje
```
1. Pasajero crea registro en rides (status = 'requested')
2. Conductores cercanos ven la solicitud
3. Cada conductor interesado crea un registro en ride_offers
4. Pasajero ve las ofertas y acepta una
5. rides.status → 'accepted', rides.driver_id se asigna
6. Las otras ofertas pasan a status = 'rejected'
```

### 2. Ejecución del viaje
```
1. Conductor se dirige al pasajero → rides.status = 'arrived', rides.arrived_at = now
2. Pasajero confirma que está listo → rides.passenger_ready_at = now
3. Viaje inicia → rides.status = 'in_progress', rides.started_at = now
4. Viaje termina → rides.status = 'completed', rides.completed_at = now
```

### 3. Registro de pago y comisión
```
1. Al completar el viaje, pasajero paga al conductor (cash o QR)
2. Se crea registro en payments (payment_status = 'completed')
3. Se crea registro en driver_earnings:
   - gross_amount = monto cobrado
   - commission_amount = gross_amount × commission_rate
   - net_amount = gross_amount - commission_amount
   - commission_status = 'pending'
4. Cuando el conductor paga la comisión a la plataforma:
   - commission_status → 'collected'
   - commission_paid_at = now
```

### 4. Calificaciones
```
1. Al completar el viaje, ambas partes pueden calificar
2. Pasajero crea ratings con rater_type = 'passenger' (califica al driver)
3. Conductor crea ratings con rater_type = 'driver' (califica al pasajero)
4. El constraint UNIQUE (ride_id, rater_type) impide doble calificación
```

### 5. Registro de conductor
```
1. Usuario crea driver_request (status = 'pending')
2. Sube documentos → documents (vinculados con driver_request_id), incluyendo fotos frontal y trasera del vehículo
3. Admin revisa → aprueba o rechaza con razón
4. Si aprueba → se crea registro en drivers y vehicles
5. Si rechaza → driver_request.version++ y puede reintentar
```

### 6. Cobro mensual de comisiones
```
Durante el mes:
→ Cada viaje completado crea driver_earnings con:
   commission_status = 'pending'
   settlement_id = NULL

Fin de mes (cron job o proceso manual):
→ Se llama generate_monthly_settlement(driver_id, year, month)
→ Se crea registro en commission_settlements (status = 'pending_payment')
→ Todos los driver_earnings del periodo se vinculan al settlement
→ Se notifica al conductor el monto total a pagar y el due_date

Conductor paga antes del due_date:
→ Se llama mark_settlement_paid(settlement_id, amount, method)
→ commission_settlements.status → 'paid'
→ Todos los driver_earnings vinculados → commission_status = 'collected'

Si no paga antes del due_date:
→ Cron job diario llama mark_overdue_settlements()
→ commission_settlements.status → 'overdue'
→ Se puede bloquear la cuenta del conductor (drivers.is_available = false)
```

### 7. Sistema de emergencias y pánico
```
Setup inicial:
→ Usuario registra sus contactos en emergency_contacts
→ Especifica nombre, teléfono y relación

Durante un viaje o en cualquier momento:
→ Usuario presiona botón de pánico (SOS)
→ Se captura la ubicación y se crea un registro en emergency_alerts:
   - user_id = usuario que activó
   - ride_id = viaje actual (nullable si no está en viaje)
   - location = POINT geoespacial
   - status = active
   - triggered_at = now()
→ La referencia y metadatos de cada audio se guardan en emergency_recordings

Notificaciones inmediatas:
→ Cada SMS dirigido a un contacto se registra en emergency_sms_logs
→ El estado de cada envío puede ser pending, sent o failed

Resolución del evento:
→ Se actualizan status y resolved_at en emergency_alerts
```

### 8. Viajes con múltiples paradas intermedias
```
Flujo de viaje con paradas:
1. Pasajero solicita viaje con destinos múltiples
2. Se crea ride con pickup_location y dropoff_location (destino final)
3. Para cada parada intermedia se crea registro en ride_waypoints:
   - sequence = 1, 2, 3, 4... (orden de ruta)
   - location = POINT de cada parada
   - address = dirección legible
   - arrived_at = NULL (se completa al llegar)
   - departed_at = NULL (se completa al partir)

Durante la ejecución:
4. Conductor navega a la primera parada (sequence=1)
5. Al llegar → ride_waypoints[1].arrived_at = now()
6. Al partir → ride_waypoints[1].departed_at = now()
7. Repite para paradas 2, 3, etc.
8. Finalmente va a dropoff_location

Cálculo de tarifa:
→ Se incluyen todas las distancias y tiempos en la ruta completa
→ El pasajero ve el monto total antes de confirmar

Consultas útiles:
→ Ver todas las paradas de un viaje ordenadas por sequence
→ Calcular tiempo entre paradas (departed_at[n] - arrived_at[n])
→ Detectar paradas incompletas (arrived_at existe pero departed_at es NULL)
```

---

*Documentación generada para uso interno del equipo de desarrollo.*
