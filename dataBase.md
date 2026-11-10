# Base de datos de Línea Lila

Esquema para instalación nueva, definido íntegramente en `migrations/00000000-initial-schema.js`. La instalación se ejecuta en una transacción: si falla, no deja una instalación parcial. No contiene migraciones posteriores de renombrado ni columnas JSON/JSONB.

## Instalación

Configurar PostgreSQL con PostGIS y una base vacía en las variables DB_*. Desde backend ejecutar `npm run migrate`. El comando rechaza una base con tablas de la aplicación; no elimina la base existente.

Los campos no reconocidos por OCR se calculan al consultar los datos extraídos y sus requisitos; no se guardan en una tabla adicional.

Las características del vehículo se guardan exclusivamente en documento_ruat. Una renovación pendiente conserva el RUAT aprobado anterior como fuente; al aprobar el nuevo, se conserva el anterior como historial.

El conductor de una ganancia se obtiene mediante id_viaje y el método mediante ese viaje. Las fechas de emisión y vencimiento se guardan en las tablas específicas del documento; documento no contiene fechas generales de emisión ni vencimiento.

## Reglas del modelo

- Un usuario no puede repetir un teléfono entre sus contactos de emergencia activos, aunque cambie el nombre o el formato del número. La unicidad se comprueba usando sus dígitos. Los contactos eliminados quedan inactivos como historial y se permite volver a registrar ese número. Usuarios distintos pueden compartir un contacto.

- `solicitud_conductor.estado_ocr` distingue `pendiente`, `complete` (sin errores técnicos, aunque falten campos) y `fallido` (al menos un error técnico). `ocr_procesado_en` registra cuándo terminó el intento, incluso si falló. Se conservan las lecturas disponibles. Los reenvíos registran el resultado de los archivos nuevos y conservan los documentos aprobados; los fallidos no se reprocesan automáticamente al reiniciar.

- Las tablas específicas usan `id_documento_ci`, `id_documento_licencia`, `id_documento_ruat`, `id_documento_soat`, `id_documento_tic`, `id_documento_antecedentes`, `id_documento_domicilio` e `id_documento_informe_psicologico` como clave primaria y foránea a `documento.id_documento`. Conservan el mismo UUID del documento general.

- El texto de identidad se conserva en `consentimientos/identity-documents-v1.txt`. `GET /autenticacion/verificar-identidad/consentimiento` entrega `version` y `texto`; la app muestra ese texto y envía `consentVersion` al aceptar. El backend valida la versión tanto en OCR como al confirmar, la vincula al ticket OCR y la registra en `documento.consentimiento_version`. `consentimiento_en` usa la fecha del servidor al guardar la verificación. Las versiones publicadas no se modifican: se conservan sus archivos y se publica una nueva versión para cambiar el texto.

- Los adjuntos de CI, solicitud y renovación incluyen un campo por archivo, por ejemplo `licenseFrontOrigen`: `captura_camara` o `archivo_subido`. El backend exige y valida el valor declarado por la app. `prueba_vida` y `semilla_desarrollo` se asignan desde el servidor. Los documentos reutilizados conservan su origen; los registros sin archivo pueden tener origen NULL.
- El tamaño del archivo no se almacena en `documento`; los límites de carga se validan al recibir el archivo.
- `documento` guarda la imagen definitiva recortada, la evidencia cifrada cuando corresponde y el texto extraído por OCR. Los errores técnicos se registran en los logs del servidor; la decisión de revisión se guarda en `estado_verificacion` y `motivo_rechazo`. El recorte se aplica una sola vez al recibir la captura; no se guardan coordenadas. OCR y revisión de conductor leen el mismo archivo JPEG. El CI conserva la imagen recortada en color y cifrada; el tratamiento de OCR se aplica sobre esa imagen. Sus propietarios se enlazan mediante `usuario_documento`, `conductor_documento` o `vehiculo_documento`. Solo puede tener una de esas clases de propietario.
- `solicitud_documento` registra qué documentos se presentaron en cada solicitud; la verificación se guarda únicamente en documento. Una versión posterior de solicitud reutiliza los documentos ya aprobados. Las renovaciones generan documentos nuevos y conservan los anteriores.
- `documento_ci` reemplaza identidad_usuario y contiene los datos oficiales del CI. `documento_domicilio` reemplaza domicilio_conductor y reúne dirección declarada, ubicación y comprobante. Los campos detectados por OCR son observaciones del documento presentado, no otra identidad oficial. El número de licencia del perfil se obtiene del CI; los números detectados se usan para comprobar coincidencias.
- La revisión documental debe completarse antes de programar la evaluación psicológica. Solo una evaluación realizada con informe apto y vigente permite la aprobación final y creación de conductor y vehículo.
- `comision` agrupa las comisiones de un conductor por mes calendario. `pago_comision` conserva intentos pendientes, rechazados y confirmados. Solo se acepta el importe mensual completo y una confirmación por comisión. El comprobante es `id_documento_comprobante`, no otra tabla.
- `registro_auditoria_detalle` guarda un campo por fila y valores escalares TEXT. INSERT: anterior NULL; DELETE: nuevo NULL; UPDATE: campos modificados. El identificador afectado no tiene FK al registro original. Un borrado lógico se registra como actualización de eliminado_en.
- `notificacion` contiene acción y un destino opcional mediante FK. Los objetos de respuesta o de FCM se construyen en memoria; no son columnas JSON.
- `regla_tarifa.dia_semana` tiene un único SMALLINT entre 0 (domingo) y 6 (sábado), o NULL para todos los días. Jueves y domingo pueden tener reglas distintas.
- `pago` obtiene el pasajero mediante `id_viaje`; no repite `id_pasajero`.
- `calificacion` obtiene conductor y pasajero mediante el viaje y es única por viaje y tipo de calificador.

La tasa se administra mediante GET /administracion/zonas-servicio y PUT /administracion/zonas-servicio/:zoneId/tasa-comision, con cuerpo {"tasa_comision":0.03} para 3 %. Ambas rutas requieren administrador. Los cambios quedan registrados en auditoría. COMMISSION_RATE del entorno ya no determina las comisiones.

Si aún no existen zonas, pueden cargarse las zonas de desarrollo con npm run seed:zonas desde backend.

## API añadida

Rutas protegidas de administración:

- PUT /administracion/solicitudes/:requestId/documentos/aprobar, con verifiedDocuments.
- GET y POST /administracion/solicitudes/:requestId/evaluaciones; POST recibe programadaEn.
- POST /administracion/solicitudes/:requestId/evaluaciones/:evaluationId/informe, multipart: informe PDF, resultado, fechaEmision, validaHasta opcional y numeroInforme opcional.
- GET en la misma ruta del informe para descargarlo.
- PUT /administracion/solicitudes/:requestId/aprobar, aprobación final.
- GET /administracion/documentos/pendientes y PUT /administracion/documentos/:documentId/revisar, con estado verificado/rechazado y motivo cuando se rechaza.

Renovación autenticada: POST /conductores/renovar-documentos, multipart con los mismos nombres de archivos de registro. Para licencia se requieren ambas caras; para domicilio, dirección y coordenadas; vehicleId selecciona un vehículo propio. /conductores/enviar-ruat utiliza el mismo flujo.

## Tablas físicas (36)

Los importes, método y fecha del pago confirmado se obtienen de pago_comision. Los datos SOAT se consultan desde documento_soat mediante vehiculo_documento. La verificación de CI, RUAT, SOAT y demás documentos se almacena únicamente en documento. El estado y la fecha de cobro de una ganancia se obtienen mediante su comisión y el pago confirmado. Las vistas calculan estos datos al consultar; no se duplican como columnas físicas.

### alerta_emergencia

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_alerta_emergencia | uuid | No | uuid_generate_v4() |
| id_usuario | uuid | No |  |
| id_viaje | uuid | Sí |  |
| estado | emergencia_alerta_estado | No | 'activo'::emergencia_alerta_estado |
| ubicacion | geometry(Point,4326) | Sí |  |
| direccion_ubicacion | text | Sí |  |
| activada_en | timestamp with time zone | No | now() |
| resuelta_en | timestamp with time zone | Sí |  |
| id_usuario_resolutor | uuid | Sí |  |
| notas | text | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK ((((estado <> 'resuelto'::emergencia_alerta_estado) AND (resuelta_en IS NULL)) OR ((estado = 'resuelto'::emergencia_alerta_estado) AND (resuelta_en IS NOT NULL))))`
- `FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)`
- `FOREIGN KEY (id_usuario_resolutor) REFERENCES usuario(id_usuario)`
- `FOREIGN KEY (id_viaje) REFERENCES viaje(id_viaje)`
- `NOT NULL activada_en`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL estado`
- `NOT NULL id_alerta_emergencia`
- `NOT NULL id_usuario`
- `PRIMARY KEY (id_alerta_emergencia)`

Índices:

```sql
CREATE UNIQUE INDEX alerta_emergencia_pkey ON public.alerta_emergencia USING btree (id_alerta_emergencia);
CREATE INDEX idx_alerta_emergencia_estado ON public.alerta_emergencia USING btree (estado);
CREATE INDEX idx_alerta_emergencia_geografico ON public.alerta_emergencia USING gist (ubicacion);
CREATE INDEX idx_alerta_emergencia_usuario ON public.alerta_emergencia USING btree (id_usuario);
CREATE INDEX idx_alerta_emergencia_viaje ON public.alerta_emergencia USING btree (id_viaje);
```

### calificacion

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_calificacion | uuid | No | uuid_generate_v4() |
| id_viaje | uuid | No |  |
| calificacion | double precision | No |  |
| tipo_calificador | tipo_calificador | No |  |
| comentario | text | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK (((calificacion >= (1.0)::double precision) AND (calificacion <= (5.0)::double precision)))`
- `FOREIGN KEY (id_viaje) REFERENCES viaje(id_viaje) ON DELETE CASCADE`
- `NOT NULL actualizado_en`
- `NOT NULL calificacion`
- `NOT NULL creado_en`
- `NOT NULL id_calificacion`
- `NOT NULL id_viaje`
- `NOT NULL tipo_calificador`
- `PRIMARY KEY (id_calificacion)`

Índices:

```sql
CREATE UNIQUE INDEX calificacion_pkey ON public.calificacion USING btree (id_calificacion);
CREATE INDEX idx_calificacion_viaje ON public.calificacion USING btree (id_viaje);
CREATE UNIQUE INDEX unico_calificacion_per_viaje ON public.calificacion USING btree (id_viaje, tipo_calificador);
```

### comision

El periodo se identifica con inicio_periodo, siempre el primer día del mes. Se calculan fin_periodo (último día del mes) y fecha_limite (día 7 del mes siguiente, inclusive). El estado se calcula con la fecha de Bolivia: pagado si existe un pago confirmado; abierto antes del mes siguiente; pendiente_pago del día 1 al 7; atrasado desde el día 8. Un comprobante pendiente no equivale a un pago confirmado.

Los totales se calculan mediante calcular_totales_comision desde los cobros vinculados por id_comision; una comisión sin cobros devuelve cero. No se añaden bloqueos de cierre.

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_comision | uuid | No | uuid_generate_v4() |
| id_conductor | uuid | No |  |
| inicio_periodo | date | No |  |
| notas | text | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK ((inicio_periodo = (date_trunc('month'::text, (inicio_periodo)::timestamp with time zone))::date))`
- `FOREIGN KEY (id_conductor) REFERENCES conductor(id_conductor)`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL id_comision`
- `NOT NULL id_conductor`
- `NOT NULL inicio_periodo`
- `PRIMARY KEY (id_comision)`
- `UNIQUE (id_conductor, inicio_periodo)`

Índices:

```sql
CREATE UNIQUE INDEX comision_pkey ON public.comision USING btree (id_comision);
CREATE INDEX idx_settlements_conductor ON public.comision USING btree (id_conductor);
CREATE UNIQUE INDEX unico_liquidacion_per_periodo ON public.comision USING btree (id_conductor, inicio_periodo);
```


### conductor

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_conductor | uuid | No | uuid_generate_v4() |
| id_usuario | uuid | No |  |
| estado | conductor_estado | No | 'pendiente'::conductor_estado |
| disponible | boolean | No | false |
| motivo_rechazo | character varying(500) | Sí |  |
| eliminado_en | timestamp with time zone | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario) ON DELETE CASCADE`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL disponible`
- `NOT NULL estado`
- `NOT NULL id_conductor`
- `NOT NULL id_usuario`
- `PRIMARY KEY (id_conductor)`
- `UNIQUE (id_usuario)`

Índices:

```sql
CREATE UNIQUE INDEX conductor_id_usuario_key ON public.conductor USING btree (id_usuario);
CREATE UNIQUE INDEX conductor_pkey ON public.conductor USING btree (id_conductor);
```

### conductor_documento

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento | uuid | No |  |
| id_conductor | uuid | No |  |

Restricciones:

- `FOREIGN KEY (id_conductor) REFERENCES conductor(id_conductor)`
- `FOREIGN KEY (id_documento) REFERENCES documento(id_documento)`
- `NOT NULL id_conductor`
- `NOT NULL id_documento`
- `PRIMARY KEY (id_documento)`

Índices:

```sql
CREATE INDEX conductor_documento_conductor ON public.conductor_documento USING btree (id_conductor);
CREATE UNIQUE INDEX conductor_documento_pkey ON public.conductor_documento USING btree (id_documento);
```

### contacto_emergencia

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_contacto_emergencia | uuid | No | uuid_generate_v4() |
| id_usuario | uuid | No |  |
| nombre | character varying(100) | No |  |
| telefono | character varying(30) | No |  |
| relacion | character varying(50) | Sí |  |
| activo | boolean | No | true |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario) ON DELETE CASCADE`
- `NOT NULL activo`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL id_contacto_emergencia`
- `NOT NULL id_usuario`
- `NOT NULL nombre`
- `NOT NULL telefono`
- `PRIMARY KEY (id_contacto_emergencia)`

Índices:

```sql
CREATE UNIQUE INDEX contacto_emergencia_pkey ON public.contacto_emergencia USING btree (id_contacto_emergencia);
CREATE INDEX idx_contacto_emergencia_usuario ON public.contacto_emergencia USING btree (id_usuario);
CREATE UNIQUE INDEX contacto_emergencia_telefono_activo_unico ON public.contacto_emergencia (id_usuario, (regexp_replace(telefono, '[^0-9]', '', 'g'))) WHERE activo;
```

### documento

Las capturas con marco se recortan al recibirlas. `ruta_archivo` apunta a la imagen definitiva utilizada por OCR y revisión; las evidencias de CI se conservan cifradas en `evidencia_cifrada`. No se almacenan coordenadas de recorte.

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento | uuid | No | uuid_generate_v4() |
| tipo_documento | character varying(40) | No |  |
| ruta_archivo | character varying(500) | Sí |  |
| tipo_mime | character varying(100) | Sí |  |
| id_documento_principal | uuid | Sí |  |
| evidencia_cifrada | text | Sí |  |
| origen_evidencia | character varying(100) | Sí | captura_camara, archivo_subido, prueba_vida o semilla_desarrollo |
| consentimiento_version | character varying(100) | Sí |  |
| consentimiento_en | timestamp with time zone | Sí |  |
| texto_ocr | text | Sí |  |
| vigente | boolean | No | true |
| estado_verificacion | character varying(20) | No | 'pendiente'::character varying |
| verificado_en | timestamp with time zone | Sí |  |
| id_usuario_verificador | uuid | Sí |  |
| motivo_rechazo | text | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK (((estado_verificacion)::text = ANY ((ARRAY['pendiente'::character varying, 'verificado'::character varying, 'rechazado'::character varying])::text[])))`
- `CHECK (((tipo_documento)::text = ANY ((ARRAY['ciFront'::character varying, 'ciBack'::character varying, 'profilePhoto'::character varying, 'licenseFront'::character varying, 'licenseBack'::character varying, 'ticPhoto'::character varying, 'antecedentsPhoto'::character varying, 'ruatPhoto'::character varying, 'soatPhoto'::character varying, 'domicileProof'::character varying, 'carFront'::character varying, 'carBack'::character varying, 'carLeft'::character varying, 'carRight'::character varying, 'commissionProof'::character varying, 'psychologicalReport'::character varying, 'ci'::character varying])::text[])))`
- `FOREIGN KEY (id_documento_principal) REFERENCES documento(id_documento)`
- `FOREIGN KEY (id_usuario_verificador) REFERENCES usuario(id_usuario)`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL estado_verificacion`
- `NOT NULL id_documento`
- `NOT NULL tipo_documento`
- `NOT NULL vigente`
- `PRIMARY KEY (id_documento)`

Índices:

```sql
CREATE UNIQUE INDEX documento_pkey ON public.documento USING btree (id_documento);
```

### documento_antecedentes

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento_antecedentes | uuid | No |  |
| nombre_detectado | text | Sí |  |
| ci_detectado | text | Sí |  |
| fecha_emision_detectada | text | Sí |  |
| nacimiento_detectado | text | Sí |  |
| nacionalidad | text | Sí |  |
| lugar_nacimiento | text | Sí |  |
| expedido_en | text | Sí |  |
| estado_civil | text | Sí |  |
| ocupacion | text | Sí |  |
| direccion_detectada | text | Sí |  |
| motivo_tramite | text | Sí |  |
| destinatario | text | Sí |  |
| unidad_antecedentes | text | Sí |  |
| resultado | text | Sí |  |
| valido_hasta | text | Sí |  |
| numero_certificado | text | Sí |  |

Restricciones:

- `FOREIGN KEY (id_documento_antecedentes) REFERENCES documento(id_documento)`
- `NOT NULL id_documento_antecedentes`
- `PRIMARY KEY (id_documento_antecedentes)`

Índices:

```sql
CREATE UNIQUE INDEX documento_antecedentes_pkey ON public.documento_antecedentes USING btree (id_documento_antecedentes);
```

### documento_ci

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento_ci | uuid | No |  |
| nombres | character varying(150) | No |  |
| apellido_paterno | character varying(100) | Sí |  |
| apellido_materno | character varying(100) | Sí |  |
| numero_ci | character varying(20) | No |  |
| fecha_nacimiento | date | No |  |
| fecha_emision | date | Sí |  |
| fecha_vencimiento | date | Sí |  |
| lugar_nacimiento | character varying(150) | Sí |  |
| direccion | character varying(255) | Sí |  |
| ocupacion | character varying(150) | Sí |  |
| estado_civil | character varying(50) | Sí |  |
| grupo_sanguineo | character varying(5) | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_documento_ci) REFERENCES documento(id_documento)`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL fecha_nacimiento`
- `NOT NULL id_documento_ci`
- `NOT NULL nombres`
- `NOT NULL numero_ci`
- `PRIMARY KEY (id_documento_ci)`
- `UNIQUE (numero_ci)`

Índices:

```sql
CREATE UNIQUE INDEX documento_ci_numero_ci_key ON public.documento_ci USING btree (numero_ci);
CREATE UNIQUE INDEX documento_ci_pkey ON public.documento_ci USING btree (id_documento_ci);
```

### documento_domicilio

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento_domicilio | uuid | No |  |
| direccion_servicio | text | Sí |  |
| mes_facturacion | text | Sí |  |
| direccion | character varying(255) | Sí |  |
| ubicacion | geometry(Point,4326) | Sí |  |

Restricciones:

- `FOREIGN KEY (id_documento_domicilio) REFERENCES documento(id_documento)`
- `NOT NULL id_documento_domicilio`
- `PRIMARY KEY (id_documento_domicilio)`

Índices:

```sql
CREATE UNIQUE INDEX documento_domicilio_pkey ON public.documento_domicilio USING btree (id_documento_domicilio);
```

### documento_informe_psicologico

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento_informe_psicologico | uuid | No |  |
| numero_informe | character varying(100) | Sí |  |
| resultado | character varying(30) | No |  |
| fecha_emision | date | No |  |
| valida_hasta | date | Sí |  |

Restricciones:

- `CHECK (((valida_hasta IS NULL) OR (valida_hasta >= fecha_emision)))`
- `CHECK (((resultado)::text = ANY ((ARRAY['apto'::character varying, 'no_apto'::character varying, 'requiere_reevaluacion'::character varying])::text[])))`
- `FOREIGN KEY (id_documento_informe_psicologico) REFERENCES documento(id_documento)`
- `NOT NULL fecha_emision`
- `NOT NULL id_documento_informe_psicologico`
- `NOT NULL resultado`
- `PRIMARY KEY (id_documento_informe_psicologico)`

Índices:

```sql
CREATE UNIQUE INDEX documento_informe_psicologico_pkey ON public.documento_informe_psicologico USING btree (id_documento_informe_psicologico);
```

### documento_licencia

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento_licencia | uuid | No |  |
| nombre_detectado | text | Sí |  |
| numero_licencia | text | Sí |  |
| fecha_emision_detectada | text | Sí |  |
| nacimiento_detectado | text | Sí |  |
| nacionalidad | text | Sí |  |
| fecha_vencimiento | text | Sí |  |
| categoria | text | Sí |  |

Restricciones:

- `FOREIGN KEY (id_documento_licencia) REFERENCES documento(id_documento)`
- `NOT NULL id_documento_licencia`
- `PRIMARY KEY (id_documento_licencia)`

Índices:

```sql
CREATE UNIQUE INDEX documento_licencia_pkey ON public.documento_licencia USING btree (id_documento_licencia);
```

### documento_ruat

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento_ruat | uuid | No |  |
| placa | text | Sí |  |
| marca | text | Sí |  |
| modelo | text | Sí |  |
| anio | text | Sí |  |
| color | text | Sí |  |
| capacidad | text | Sí |  |
| tipo_vehiculo | text | Sí |  |
| clase_vehiculo | text | Sí |  |
| propietario_detectado | text | Sí |  |
| ci_propietario_detectado | text | Sí |  |
| municipio_registro | text | Sí |  |
| numero_crpva | text | Sí |  |
| fecha_emision | text | Sí |  |
| inicio_propiedad | text | Sí |  |
| cantidad_puertas | text | Sí |  |
| tipo_servicio | text | Sí |  |
| numero_chasis | text | Sí |  |
| numero_motor | text | Sí |  |
| combustible | text | Sí |  |
| cilindrada | text | Sí |  |
| tipo_motor | text | Sí |  |
| observaciones_legales | text | Sí |  |

Restricciones:

- `FOREIGN KEY (id_documento_ruat) REFERENCES documento(id_documento)`
- `NOT NULL id_documento_ruat`
- `PRIMARY KEY (id_documento_ruat)`

Índices:

```sql
CREATE UNIQUE INDEX documento_ruat_pkey ON public.documento_ruat USING btree (id_documento_ruat);
```

### documento_soat

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento_soat | uuid | No |  |
| numero_roseta | text | Sí |  |
| anio | text | Sí |  |
| departamento | text | Sí |  |
| tipo_vehiculo | text | Sí |  |
| placa_detectada | text | Sí |  |
| fecha_inicio | text | Sí |  |
| fecha_vencimiento | text | Sí |  |
| uso | text | Sí |  |

Restricciones:

- `FOREIGN KEY (id_documento_soat) REFERENCES documento(id_documento)`
- `NOT NULL id_documento_soat`
- `PRIMARY KEY (id_documento_soat)`

Índices:

```sql
CREATE UNIQUE INDEX documento_soat_pkey ON public.documento_soat USING btree (id_documento_soat);
```

### documento_tic

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento_tic | uuid | No |  |
| numero_licencia | text | Sí |  |
| fecha_emision_detectada | text | Sí |  |
| numero_tic | text | Sí |  |
| lugar_emision | text | Sí |  |
| nombres_detectados | text | Sí |  |
| apellidos_detectados | text | Sí |  |
| categoria | text | Sí |  |
| fecha_vencimiento | text | Sí |  |

Restricciones:

- `FOREIGN KEY (id_documento_tic) REFERENCES documento(id_documento)`
- `NOT NULL id_documento_tic`
- `PRIMARY KEY (id_documento_tic)`

Índices:

```sql
CREATE UNIQUE INDEX documento_tic_pkey ON public.documento_tic USING btree (id_documento_tic);
```

### evaluacion_psicologica

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_evaluacion_psicologica | uuid | No | uuid_generate_v4() |
| id_solicitud_conductor | uuid | No |  |
| id_usuario_evaluador | uuid | No |  |
| programada_en | timestamp with time zone | No |  |
| realizada_en | timestamp with time zone | Sí |  |
| estado | character varying(20) | No |  |
| id_documento_informe | uuid | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK ((((estado)::text = 'realizada'::text) = ((realizada_en IS NOT NULL) AND (id_documento_informe IS NOT NULL))))`
- `CHECK (((estado)::text = ANY ((ARRAY['programada'::character varying, 'realizada'::character varying, 'cancelada'::character varying])::text[])))`
- `FOREIGN KEY (id_documento_informe) REFERENCES documento_informe_psicologico(id_documento_informe_psicologico)`
- `FOREIGN KEY (id_solicitud_conductor) REFERENCES solicitud_conductor(id_solicitud_conductor)`
- `FOREIGN KEY (id_usuario_evaluador) REFERENCES usuario(id_usuario)`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL estado`
- `NOT NULL id_evaluacion_psicologica`
- `NOT NULL id_solicitud_conductor`
- `NOT NULL id_usuario_evaluador`
- `NOT NULL programada_en`
- `PRIMARY KEY (id_evaluacion_psicologica)`
- `UNIQUE (id_documento_informe)`

Índices:

```sql
CREATE UNIQUE INDEX evaluacion_psicologica_id_documento_informe_key ON public.evaluacion_psicologica USING btree (id_documento_informe);
CREATE UNIQUE INDEX evaluacion_psicologica_pkey ON public.evaluacion_psicologica USING btree (id_evaluacion_psicologica);
```

### cobros_conductor

Los importes se calculan mediante calcular_ganancia_viaje: bruto desde viaje.tarifa_final; comisión redondeada a dos decimales con la tasa guardada; neto como bruto menos comisión, redondeado a dos decimales. El cierre mensual suma las comisiones ya redondeadas por viaje. Estos importes no son columnas físicas de cobros_conductor.

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_ganancia_conductor | uuid | No | uuid_generate_v4() |
| id_viaje | uuid | No |  |
| id_comision | uuid | Sí |  |
| tasa_comision | double precision | No |  |
| creado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_comision) REFERENCES comision(id_comision)`
- `FOREIGN KEY (id_viaje) REFERENCES viaje(id_viaje)`
- `NOT NULL creado_en`
- `NOT NULL id_ganancia_conductor`
- `NOT NULL id_viaje`
- `NOT NULL tasa_comision`
- `PRIMARY KEY (id_ganancia_conductor)`
- `UNIQUE (id_viaje)`

Índices:

```sql
CREATE UNIQUE INDEX ganancia_conductor_id_viaje_key ON public.cobros_conductor USING btree (id_viaje);
CREATE UNIQUE INDEX ganancia_conductor_pkey ON public.cobros_conductor USING btree (id_ganancia_conductor);
CREATE INDEX idx_ganancia_conductor_comision ON public.cobros_conductor USING btree (id_comision);
```

### motivo_cancelacion

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_motivo_cancelacion | uuid | No | uuid_generate_v4() |
| codigo | character varying(50) | No |  |
| descripcion | text | No |  |
| aplicable_a | aplicable_a | Sí |  |
| activo | boolean | No | true |
| creado_en | timestamp with time zone | Sí | now() |

Restricciones:

- `NOT NULL activo`
- `NOT NULL codigo`
- `NOT NULL descripcion`
- `NOT NULL id_motivo_cancelacion`
- `PRIMARY KEY (id_motivo_cancelacion)`
- `UNIQUE (codigo)`

Índices:

```sql
CREATE UNIQUE INDEX motivo_cancelacion_codigo_key ON public.motivo_cancelacion USING btree (codigo);
CREATE UNIQUE INDEX motivo_cancelacion_pkey ON public.motivo_cancelacion USING btree (id_motivo_cancelacion);
```

### notificacion

La lectura se determina únicamente por leido_en: NULL significa no leída y una fecha significa leída. El atributo is_read de la respuesta se calcula en memoria para conservar el contrato de la API.

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_notificacion | uuid | No | uuid_generate_v4() |
| id_usuario | uuid | No |  |
| titulo | character varying(255) | No |  |
| cuerpo | text | No |  |
| tipo | notificacion_tipo | No |  |
| accion | character varying(100) | Sí |  |
| id_viaje | uuid | Sí |  |
| id_oferta_viaje | uuid | Sí |  |
| id_solicitud_conductor | uuid | Sí |  |
| id_alerta_emergencia | uuid | Sí |  |
| id_comision | uuid | Sí |  |
| enviado_en | timestamp with time zone | Sí |  |
| leido_en | timestamp with time zone | Sí |  |
| creado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK ((num_nonnulls(id_viaje, id_oferta_viaje, id_solicitud_conductor, id_alerta_emergencia, id_comision) <= 1))`
- `FOREIGN KEY (id_alerta_emergencia) REFERENCES alerta_emergencia(id_alerta_emergencia)`
- `FOREIGN KEY (id_comision) REFERENCES comision(id_comision)`
- `FOREIGN KEY (id_oferta_viaje) REFERENCES oferta_viaje(id_oferta_viaje)`
- `FOREIGN KEY (id_solicitud_conductor) REFERENCES solicitud_conductor(id_solicitud_conductor)`
- `FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)`
- `FOREIGN KEY (id_viaje) REFERENCES viaje(id_viaje)`
- `NOT NULL creado_en`
- `NOT NULL cuerpo`
- `NOT NULL id_notificacion`
- `NOT NULL id_usuario`
- `NOT NULL tipo`
- `NOT NULL titulo`
- `PRIMARY KEY (id_notificacion)`

Índices:

```sql
CREATE INDEX idx_notificacion_usuario ON public.notificacion USING btree (id_usuario);
CREATE UNIQUE INDEX notificacion_pkey ON public.notificacion USING btree (id_notificacion);
```

### oferta_viaje

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_oferta_viaje | uuid | No | uuid_generate_v4() |
| id_viaje | uuid | No |  |
| id_conductor | uuid | No |  |
| precio_ofertado | numeric(10,2) | No |  |
| estado | viaje_oferta_estado | No | 'pendiente'::viaje_oferta_estado |
| mensaje | text | Sí |  |
| vence_en | timestamp with time zone | No |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_conductor) REFERENCES conductor(id_conductor) ON DELETE CASCADE`
- `FOREIGN KEY (id_viaje) REFERENCES viaje(id_viaje) ON DELETE CASCADE`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL estado`
- `NOT NULL id_conductor`
- `NOT NULL id_oferta_viaje`
- `NOT NULL id_viaje`
- `NOT NULL precio_ofertado`
- `NOT NULL vence_en`
- `PRIMARY KEY (id_oferta_viaje)`

Índices:

```sql
CREATE INDEX idx_oferta_viaje_viaje_estado ON public.oferta_viaje USING btree (id_viaje, estado);
CREATE UNIQUE INDEX oferta_viaje_pkey ON public.oferta_viaje USING btree (id_oferta_viaje);
```

### pago

El método se consulta desde el viaje relacionado. Solo viaje.metodo_pago almacena este valor; el pago no permite registrar un método distinto.

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_pago | uuid | No | uuid_generate_v4() |
| id_viaje | uuid | No |  |
| importe | double precision | No |  |
| moneda | character varying(10) | No | 'BOB'::character varying |
| estado_pago | estado_pago | No | 'pendiente'::estado_pago |
| transaccion_id | character varying(255) | Sí |  |
| pagado_en | timestamp with time zone | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_viaje) REFERENCES viaje(id_viaje) ON DELETE CASCADE`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL estado_pago`
- `NOT NULL id_pago`
- `NOT NULL id_viaje`
- `NOT NULL importe`
- `NOT NULL moneda`
- `PRIMARY KEY (id_pago)`
- `UNIQUE (id_viaje)`

Índices:

```sql
CREATE UNIQUE INDEX pago_id_viaje_key ON public.pago USING btree (id_viaje);
CREATE UNIQUE INDEX pago_pkey ON public.pago USING btree (id_pago);
```

### pago_comision

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_pago_comision | uuid | No | uuid_generate_v4() |
| id_comision | uuid | No |  |
| id_documento_comprobante | uuid | Sí |  |
| importe | numeric(12,2) | No |  |
| metodo_pago | liquidacion_metodo_pago | No |  |
| referencia | character varying(100) | Sí |  |
| estado | character varying(20) | No |  |
| presentado_en | timestamp with time zone | No | now() |
| revisado_en | timestamp with time zone | Sí |  |
| id_usuario_revisor | uuid | Sí |  |
| motivo_rechazo | text | Sí |  |

Restricciones:

- `CHECK ((((estado)::text = 'pendiente'::text) OR ((revisado_en IS NOT NULL) AND (id_usuario_revisor IS NOT NULL))))`
- `CHECK ((((estado)::text <> 'rechazado'::text) OR (length(TRIM(BOTH FROM motivo_rechazo)) > 0)))`
- `CHECK (((estado)::text = ANY ((ARRAY['pendiente'::character varying, 'confirmado'::character varying, 'rechazado'::character varying])::text[])))`
- `CHECK ((importe > (0)::numeric))`
- `FOREIGN KEY (id_comision) REFERENCES comision(id_comision)`
- `FOREIGN KEY (id_documento_comprobante) REFERENCES documento(id_documento)`
- `FOREIGN KEY (id_usuario_revisor) REFERENCES usuario(id_usuario)`
- `NOT NULL estado`
- `NOT NULL id_comision`
- `NOT NULL id_pago_comision`
- `NOT NULL importe`
- `NOT NULL metodo_pago`
- `NOT NULL presentado_en`
- `PRIMARY KEY (id_pago_comision)`

Índices:

```sql
CREATE UNIQUE INDEX pago_comision_pkey ON public.pago_comision USING btree (id_pago_comision);
CREATE UNIQUE INDEX pago_comision_unico_confirmado ON public.pago_comision USING btree (id_comision) WHERE ((estado)::text = 'confirmado'::text);
CREATE UNIQUE INDEX pago_comision_unico_pendiente ON public.pago_comision USING btree (id_comision) WHERE ((estado)::text = 'pendiente'::text);
```

### parada_viaje

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_parada_viaje | uuid | No | uuid_generate_v4() |
| id_viaje | uuid | No |  |
| orden | smallint | No |  |
| ubicacion | geometry(Point,4326) | No |  |
| direccion | text | No |  |
| llegada_en | timestamp with time zone | Sí |  |
| salida_en | timestamp with time zone | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | Sí |  |

Restricciones:

- `FOREIGN KEY (id_viaje) REFERENCES viaje(id_viaje) ON DELETE CASCADE`
- `NOT NULL creado_en`
- `NOT NULL direccion`
- `NOT NULL id_parada_viaje`
- `NOT NULL id_viaje`
- `NOT NULL orden`
- `NOT NULL ubicacion`
- `PRIMARY KEY (id_parada_viaje)`
- `UNIQUE (id_viaje, orden)`

Índices:

```sql
CREATE INDEX idx_parada_viaje_geografico ON public.parada_viaje USING gist (ubicacion);
CREATE INDEX idx_parada_viaje_viaje_id ON public.parada_viaje USING btree (id_viaje);
CREATE UNIQUE INDEX parada_viaje_pkey ON public.parada_viaje USING btree (id_parada_viaje);
CREATE UNIQUE INDEX uq_viaje_waypoint ON public.parada_viaje USING btree (id_viaje, orden);
```

### registro_auditoria

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_registro_auditoria | uuid | No | uuid_generate_v4() |
| nombre_tabla | character varying(100) | No |  |
| id_registro_afectado | uuid | No |  |
| accion | auditoria_accion | No |  |
| motivo | text | Sí |  |
| id_usuario_responsable | uuid | Sí |  |
| realizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_usuario_responsable) REFERENCES usuario(id_usuario)`
- `NOT NULL accion`
- `NOT NULL id_registro_afectado`
- `NOT NULL id_registro_auditoria`
- `NOT NULL nombre_tabla`
- `NOT NULL realizado_en`
- `PRIMARY KEY (id_registro_auditoria)`

Índices:

```sql
CREATE UNIQUE INDEX registro_auditoria_pkey ON public.registro_auditoria USING btree (id_registro_auditoria);
```

### registro_auditoria_detalle

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_registro_auditoria | uuid | No |  |
| nombre_campo | character varying(100) | No |  |
| valor_anterior | text | Sí |  |
| valor_nuevo | text | Sí |  |

Restricciones:

- `FOREIGN KEY (id_registro_auditoria) REFERENCES registro_auditoria(id_registro_auditoria)`
- `NOT NULL id_registro_auditoria`
- `NOT NULL nombre_campo`
- `PRIMARY KEY (id_registro_auditoria, nombre_campo)`

Índices:

```sql
CREATE UNIQUE INDEX registro_auditoria_detalle_pkey ON public.registro_auditoria_detalle USING btree (id_registro_auditoria, nombre_campo);
```

### registro_sms_emergencia

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_registro_sms_emergencia | uuid | No | uuid_generate_v4() |
| id_alerta | uuid | No |  |
| id_contacto | uuid | Sí |  |
| telefono_destino | character varying(30) | No |  |
| cuerpo_mensaje | text | No |  |
| estado | sms_estado | No | 'pendiente'::sms_estado |
| proveedor_id | character varying(255) | Sí |  |
| enviado_en | timestamp with time zone | Sí |  |
| fallo_en | timestamp with time zone | Sí |  |
| mensaje_error | text | Sí |  |
| creado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK ((((estado = 'enviado'::sms_estado) AND (enviado_en IS NOT NULL)) OR ((estado = 'fallido'::sms_estado) AND (fallo_en IS NOT NULL)) OR (estado = 'pendiente'::sms_estado)))`
- `FOREIGN KEY (id_alerta) REFERENCES alerta_emergencia(id_alerta_emergencia) ON DELETE CASCADE`
- `FOREIGN KEY (id_contacto) REFERENCES contacto_emergencia(id_contacto_emergencia)`
- `NOT NULL creado_en`
- `NOT NULL cuerpo_mensaje`
- `NOT NULL estado`
- `NOT NULL id_alerta`
- `NOT NULL id_registro_sms_emergencia`
- `NOT NULL telefono_destino`
- `PRIMARY KEY (id_registro_sms_emergencia)`

Índices:

```sql
CREATE INDEX idx_sms_logs_alerta ON public.registro_sms_emergencia USING btree (id_alerta);
CREATE INDEX idx_sms_logs_estado ON public.registro_sms_emergencia USING btree (estado);
CREATE UNIQUE INDEX registro_sms_emergencia_pkey ON public.registro_sms_emergencia USING btree (id_registro_sms_emergencia);
```

### regla_tarifa

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_regla_tarifa | uuid | No | uuid_generate_v4() |
| nombre | character varying(100) | No |  |
| zona | geometry(Polygon,4326) | Sí |  |
| multiplicador | double precision | No | 1.0 |
| tipo_vehiculo | tipo_vehiculo | Sí |  |
| dia_semana | smallint | Sí |  |
| hora_inicio | time without time zone | Sí |  |
| hora_fin | time without time zone | Sí |  |
| activo | boolean | No | true |
| prioridad | integer | No | 0 |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK (((dia_semana >= 0) AND (dia_semana <= 6)))`
- `NOT NULL activo`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL id_regla_tarifa`
- `NOT NULL multiplicador`
- `NOT NULL nombre`
- `NOT NULL prioridad`
- `PRIMARY KEY (id_regla_tarifa)`

Índices:

```sql
CREATE UNIQUE INDEX regla_tarifa_pkey ON public.regla_tarifa USING btree (id_regla_tarifa);
```

### solicitud_conductor

No se almacena rechazo_definitivo. El reenvío se determina desde el estado de la solicitud y los documentos rechazados vinculados. El backend valida que todos los documentos requeridos hayan sido revisados antes de resolver la solicitud.

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_solicitud_conductor | uuid | No | uuid_generate_v4() |
| id_usuario | uuid | No |  |
| estado | conductor_solicitud_estado | No | 'pendiente'::conductor_solicitud_estado |
| motivo_rechazo | text | Sí |  |
| estado_ocr | character varying(20) | No | 'pendiente'; admite complete y fallido |
| ocr_procesado_en | timestamp with time zone | Sí |  |
| version | integer | No | 1 |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL estado`
- `NOT NULL estado_ocr`
- `NOT NULL id_solicitud_conductor`
- `NOT NULL id_usuario`
- `NOT NULL version`
- `PRIMARY KEY (id_solicitud_conductor)`

Índices:

```sql
CREATE UNIQUE INDEX solicitud_conductor_pkey ON public.solicitud_conductor USING btree (id_solicitud_conductor);
```

### solicitud_documento

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_solicitud_conductor | uuid | No |  |
| id_documento | uuid | No |  |

Restricciones:

- `FOREIGN KEY (id_documento) REFERENCES documento(id_documento)`
- `FOREIGN KEY (id_solicitud_conductor) REFERENCES solicitud_conductor(id_solicitud_conductor)`
- `NOT NULL id_documento`
- `NOT NULL id_solicitud_conductor`
- `PRIMARY KEY (id_solicitud_conductor, id_documento)`

Índices:

```sql
CREATE UNIQUE INDEX solicitud_documento_pkey ON public.solicitud_documento USING btree (id_solicitud_conductor, id_documento);
```

### ubicacion_conductor

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_conductor | uuid | No |  |
| ubicacion | geometry(Point,4326) | No |  |
| rumbo | double precision | Sí |  |
| velocidad | double precision | Sí |  |
| conectado | boolean | No | true |
| ubicacion_registrada_en | timestamp with time zone | Sí |  |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_conductor) REFERENCES conductor(id_conductor) ON DELETE CASCADE`
- `NOT NULL actualizado_en`
- `NOT NULL conectado`
- `NOT NULL id_conductor`
- `NOT NULL ubicacion`
- `PRIMARY KEY (id_conductor)`

Índices:

```sql
CREATE INDEX idx_ubicacion_conductor_geografico ON public.ubicacion_conductor USING gist (ubicacion);
CREATE INDEX ubicacion_conductor_geografia_idx ON public.ubicacion_conductor USING gist (((ubicacion)::geography));
CREATE UNIQUE INDEX ubicacion_conductor_pkey ON public.ubicacion_conductor USING btree (id_conductor);
```

### usuario

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_usuario | uuid | No | uuid_generate_v4() |
| firebase_uid | character varying(255) | No |  |
| fcm_token | character varying(255) | Sí |  |
| correo | character varying(255) | Sí |  |
| telefono | character varying(30) | Sí |  |
| contrasena | character varying(255) | Sí |  |
| rol | usuario_rol | No | 'pasajero'::usuario_rol |
| modo_actual | character varying(50) | Sí |  |
| foto_perfil | character varying(500) | Sí |  |
| activo | boolean | No | true |
| telefono_verificado | boolean | No | false |
| ultimo_acceso | timestamp with time zone | Sí |  |
| eliminado_en | timestamp with time zone | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `NOT NULL activo`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL firebase_uid`
- `NOT NULL id_usuario`
- `NOT NULL rol`
- `NOT NULL telefono_verificado`
- `PRIMARY KEY (id_usuario)`
- `UNIQUE (correo)`
- `UNIQUE (firebase_uid)`
- `UNIQUE (telefono)`

Índices:

```sql
CREATE UNIQUE INDEX usuario_correo_key ON public.usuario USING btree (correo);
CREATE UNIQUE INDEX usuario_firebase_uid_key ON public.usuario USING btree (firebase_uid);
CREATE UNIQUE INDEX usuario_pkey ON public.usuario USING btree (id_usuario);
CREATE UNIQUE INDEX usuario_telefono_key ON public.usuario USING btree (telefono);
```

### usuario_documento

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento | uuid | No |  |
| id_usuario | uuid | No |  |

Restricciones:

- `FOREIGN KEY (id_documento) REFERENCES documento(id_documento)`
- `FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)`
- `NOT NULL id_documento`
- `NOT NULL id_usuario`
- `PRIMARY KEY (id_documento)`

Índices:

```sql
CREATE UNIQUE INDEX usuario_documento_pkey ON public.usuario_documento USING btree (id_documento);
CREATE INDEX usuario_documento_usuario ON public.usuario_documento USING btree (id_usuario);
```

### vehiculo

Las características y datos del certificado se obtienen del RUAT aprobado vigente mediante vehiculo_documento. Esta tabla conserva únicamente identificación, conductor, estado operativo y fechas de control. No admite edición independiente de las características.

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_vehiculo | uuid | No | uuid_generate_v4() |
| id_conductor | uuid | No |  |
| estado | vehiculo_estado | No | 'activo'::vehiculo_estado |
| eliminado_en | timestamp with time zone | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `FOREIGN KEY (id_conductor) REFERENCES conductor(id_conductor) ON DELETE CASCADE`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL estado`
- `NOT NULL id_conductor`
- `NOT NULL id_vehiculo`
- `PRIMARY KEY (id_vehiculo)`

Índices:

```sql
CREATE UNIQUE INDEX vehiculo_pkey ON public.vehiculo USING btree (id_vehiculo);
```

La placa de un RUAT aprobado vigente no puede pertenecer a dos vehículos no eliminados. Esta regla se comprueba al vincular el documento, al aprobarlo y al cambiar sus datos.

### vehiculo_documento

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_documento | uuid | No |  |
| id_vehiculo | uuid | No |  |

Restricciones:

- `FOREIGN KEY (id_documento) REFERENCES documento(id_documento)`
- `FOREIGN KEY (id_vehiculo) REFERENCES vehiculo(id_vehiculo)`
- `NOT NULL id_documento`
- `NOT NULL id_vehiculo`
- `PRIMARY KEY (id_documento)`

Índices:

```sql
CREATE UNIQUE INDEX vehiculo_documento_pkey ON public.vehiculo_documento USING btree (id_documento);
CREATE INDEX vehiculo_documento_vehiculo ON public.vehiculo_documento USING btree (id_vehiculo);
```

### viaje

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_viaje | uuid | No | uuid_generate_v4() |
| id_pasajero | uuid | No |  |
| id_conductor | uuid | Sí |  |
| estado | enum_viaje_estado | No | 'solicitado'::enum_viaje_estado |
| ubicacion_recogida | geometry(Point,4326) | No |  |
| direccion_recogida | text | No |  |
| ubicacion_destino | geometry(Point,4326) | No |  |
| direccion_destino | text | No |  |
| tipo_vehiculo_solicitado | tipo_vehiculo | Sí |  |
| metodo_pago | metodo_pago | No | 'efectivo'::metodo_pago |
| tarifa_base | double precision | Sí |  |
| tarifa_km | double precision | Sí |  |
| tarifa_minuto | double precision | Sí |  |
| tarifa_total | double precision | Sí |  |
| tarifa_final | double precision | No |  |
| distancia | double precision | Sí |  |
| duracion | integer | Sí |  |
| id_zona_servicio | uuid | Sí |  |
| id_motivo_cancelacion | uuid | Sí |  |
| cancelado_por | cancelado_por_tipo | Sí |  |
| modo_solicitud | text | No | 'negociacion'::text |
| clave_solicitud | text | Sí |  |
| distancia_recogida | double precision | Sí |  |
| duracion_recogida | integer | Sí |  |
| aceptado_en | timestamp with time zone | Sí |  |
| llegada_en | timestamp with time zone | Sí |  |
| pasajero_listo_en | timestamp with time zone | Sí |  |
| iniciado_en | timestamp with time zone | Sí |  |
| ruta_recorrida | geometry(LineString,4326) | Sí |  |
| completado_en | timestamp with time zone | Sí |  |
| cancelado_en | timestamp with time zone | Sí |  |
| vence_en | timestamp with time zone | Sí |  |
| eliminado_en | timestamp with time zone | Sí |  |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

Restricciones:

- `CHECK ((((cancelado_por IS NULL) AND (cancelado_en IS NULL)) OR ((cancelado_por IS NOT NULL) AND (cancelado_en IS NOT NULL))))`
- `CHECK (((id_motivo_cancelacion IS NULL) OR (cancelado_por IS NOT NULL)))`
- `FOREIGN KEY (id_conductor) REFERENCES conductor(id_conductor)`
- `FOREIGN KEY (id_motivo_cancelacion) REFERENCES motivo_cancelacion(id_motivo_cancelacion)`
- `FOREIGN KEY (id_pasajero) REFERENCES usuario(id_usuario)`
- `FOREIGN KEY (id_zona_servicio) REFERENCES zona_servicio(id_zona_servicio)`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL direccion_destino`
- `NOT NULL direccion_recogida`
- `NOT NULL estado`
- `NOT NULL id_pasajero`
- `NOT NULL id_viaje`
- `NOT NULL metodo_pago`
- `NOT NULL modo_solicitud`
- `NOT NULL tarifa_final`
- `NOT NULL ubicacion_destino`
- `NOT NULL ubicacion_recogida`
- `PRIMARY KEY (id_viaje)`

Índices:

```sql
CREATE INDEX idx_viaje_conductor ON public.viaje USING btree (id_conductor);
CREATE INDEX idx_viaje_estado ON public.viaje USING btree (estado);
CREATE INDEX idx_viaje_pasajero ON public.viaje USING btree (id_pasajero);
CREATE INDEX idx_viaje_service_area ON public.viaje USING btree (id_zona_servicio);
CREATE UNIQUE INDEX viaje_clave_solicitud_unico ON public.viaje USING btree (id_pasajero, clave_solicitud) WHERE (clave_solicitud IS NOT NULL);
CREATE UNIQUE INDEX viaje_conductor_ocupado_unico ON public.viaje USING btree (id_conductor) WHERE ((eliminado_en IS NULL) AND (id_conductor IS NOT NULL) AND ((estado = ANY (ARRAY['aceptado'::enum_viaje_estado, 'llegado'::enum_viaje_estado, 'en_curso'::enum_viaje_estado])) OR ((modo_solicitud = 'asignacion_rapida'::text) AND (estado = 'solicitado'::enum_viaje_estado))));
CREATE UNIQUE INDEX viaje_pkey ON public.viaje USING btree (id_viaje);
CREATE UNIQUE INDEX viaje_un_ocupado_pasajero ON public.viaje USING btree (id_pasajero) WHERE ((eliminado_en IS NULL) AND ((estado = ANY (ARRAY['aceptado'::enum_viaje_estado, 'llegado'::enum_viaje_estado, 'en_curso'::enum_viaje_estado])) OR ((modo_solicitud = 'asignacion_rapida'::text) AND (estado = 'solicitado'::enum_viaje_estado))));
```

### zona_servicio

| Columna | Tipo | Nulo | Predeterminado |
|---|---|---|---|
| id_zona_servicio | uuid | No | uuid_generate_v4() |
| nombre | character varying(100) | No |  |
| limite | geometry(Polygon,4326) | No |  |
| activo | boolean | No | true |
| tarifa_base | double precision | Sí |  |
| tarifa_km | double precision | Sí |  |
| tarifa_minuto | double precision | Sí |  |
| moneda | character varying(10) | No | 'BOB'::character varying |
| tasa_comision | numeric(9,6) | No | 0.02 |
| creado_en | timestamp with time zone | No | now() |
| actualizado_en | timestamp with time zone | No | now() |

La tasa se configura como fracción: 0.02 = 2 %. Se admite de 0 a 1, con hasta seis decimales. El valor predeterminado para zonas nuevas es 0.02. Al registrar una ganancia, la base obtiene esta tasa desde la zona del viaje y conserva la tasa aplicada; los cambios posteriores no modifican ganancias existentes. Un viaje sin zona debe asociarse a una zona válida antes de completarse.

Restricciones:

- `CHECK (tasa_comision BETWEEN 0 AND 1)`
- `NOT NULL tasa_comision`
- `CHECK ((tarifa_base > (0)::double precision))`
- `CHECK ((tarifa_km > (0)::double precision))`
- `CHECK ((tarifa_minuto > (0)::double precision))`
- `NOT NULL activo`
- `NOT NULL actualizado_en`
- `NOT NULL creado_en`
- `NOT NULL id_zona_servicio`
- `NOT NULL limite`
- `NOT NULL moneda`
- `NOT NULL nombre`
- `PRIMARY KEY (id_zona_servicio)`

Índices:

```sql
CREATE INDEX idx_zona_servicio_activo ON public.zona_servicio USING btree (activo);
CREATE INDEX idx_zona_servicio_limite ON public.zona_servicio USING gist (limite);
CREATE UNIQUE INDEX zona_servicio_pkey ON public.zona_servicio USING btree (id_zona_servicio);
```

## Proyecciones del backend

El esquema compatibilidad contiene vistas para conservar nombres de atributos y contratos de respuesta existentes. No contiene copias de datos ni pasos de transformación. Las proyecciones documentales son de lectura; las escrituras se realizan en las tablas físicas mediante los servicios de documentos, en la misma transacción que la operación.

Los atributos virtuales metadata, rejectedDocuments, data, old_values y new_values se reconstruyen en JavaScript desde columnas y relaciones. No se persisten como JSON ni como objetos serializados en TEXT.

La instalación incluye los datos de prueba ya existentes para desarrollo. No representa una aprobación real de conductor.
