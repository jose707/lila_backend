# Registro de identidad — flujo actual

Google Vision extrae los datos. El servidor valida los campos, su consistencia entre ambas caras, las fechas y la MRZ cuando está disponible. El alta queda aprobada en un único envío si el CI, la prueba de vida y la comparación facial pasan sus validaciones.

## Flujo de captura y conservación

1. La persona acepta el consentimiento y captura frente y reverso.
2. La app conserva las rutas de ambas capturas del CI solo en memoria. Al confirmar inicia Face Liveness con credenciales temporales de AWS; la app no recibe ni sube una selfie separada.
3. `POST /api/auth/verify-identity` envía ambas fotos del CI, las regiones de recorte, el consentimiento y el identificador firmado de la sesión biométrica. El cliente no envía datos OCR, puntajes biométricos ni la foto de referencia.
4. El servidor ejecuta Google Vision y valida el CI. Consulta el resultado de Face Liveness, compara la imagen de referencia con el retrato del CI y aplica los umbrales configurados. Solo si todo pasa, una transacción guarda la identidad aprobada, las dos fotos del CI y una versión reducida de la imagen de referencia cifradas en `documents`. `users.profile_photo` apunta a `/api/users/:id/profile-photo`, servido con autenticación. Si algo falla, no guarda el registro y la app conserva las capturas del CI temporalmente para reintentar.

## Base de datos y despliegue

- `user_identities` guarda `first_names`, `paternal_surname` y `maternal_surname` en columnas separadas. El primer término leído de apellidos se asigna al apellido paterno y el resto al materno; confirma esta regla con ejemplos reales de los formatos de CI admitidos.
- `documents` guarda las dos imágenes del CI y la foto de perfil obtenida de Face Liveness cifradas con estado `verified`. La foto de perfil solo se entrega a usuarios autenticados.
- Configurar `IDENTITY_STORAGE_KEY` como secreto estable de 32 bytes en hexadecimal para proteger las imágenes.

## Campos obligatorios

- Formato actual: frente con número de CI, nombres, apellidos, nacimiento, emisión y expiración; reverso con lugar de nacimiento, domicilio, profesión y estado civil.
- Formato anterior: frente con número de CI, emisión y expiración; reverso con nombre completo después de `A:`, fecha tras `Nacido el`, lugar de nacimiento tras `EN`, estado civil, profesión/ocupación y domicilio. Todos son obligatorios; el nombre completo se separa en nombres y apellidos antes de guardarlo.
- El parser del formato anterior reconoce fechas con el mes escrito en letras y no exige MRZ, que no figura en ese diseño. Si el número de CI se lee en ambas caras, debe coincidir. Una CI vencida se rechaza en ambos formatos.
- En la CI anterior el parser lee primero el nombre después de `A:`, incluso cuando la etiqueta está al final de la frase de certificación o el OCR divide el nombre en dos líneas. Si el OCR omite esa etiqueta, solo usa líneas claras junto a `Nacido el`. Las dos últimas palabras se asignan a apellidos. Si no puede leer ese patrón, rechaza la captura; debe evaluarse con más muestras para cubrir nombres y apellidos compuestos.
- Se validan fechas, duplicidad del CI, coincidencias legibles entre caras y controles MRZ cuando se reconocen. Google Vision y la validación de formato no demuestran por sí solos que el documento sea auténtico.

## Pendiente antes de producción

Antes de producción falta evaluar ambos umbrales con imágenes reales, validar dispositivos/cámaras y completar una política de retención y respaldo compatible con la eliminación de evidencias. El valor local inicial de `FACE_LIVENESS_MIN_CONFIDENCE=90` es provisional.

## AWS Face Liveness (progreso de implementación)

- Lambda de referencia: `aws/api-face-liveness/index.mjs`. Se ejecuta con el rol IAM de la Lambda; las claves IAM permanentes no van en el teléfono.
- El registro actual usa Face Liveness cuando `FACE_LIVENESS_ENABLED=true` tanto en la app como en el backend. La Lambda devuelve al servidor la imagen de referencia solo después de una sesión completada; esa misma imagen se compara y se conserva como foto de perfil al aprobarse.
- El rol de ejecución de Lambda necesita `rekognition:CreateFaceLivenessSession`, `rekognition:GetFaceLivenessSessionResults`, `rekognition:CompareFaces` y `sts:AssumeRole` restringido al rol cliente. El rol cliente se limita a `rekognition:StartFaceLivenessSession`; STS emite credenciales temporales que la app recibe para el SDK nativo.
- Configurar `LINEALILA_SERVICE_KEY` en Lambda y el mismo valor como `FACE_LIVENESS_SHARED_SECRET` en el backend. Configurar `FACE_MATCH_MIN_CONFIDENCE` después de evaluar CI bolivianas e imágenes reales; la API no aprobará si falta.
- El detector nativo oficial de Amplify no tiene wrapper oficial para React Native: se enlaza Android Compose y SwiftUI con módulos nativos. No agregar credenciales permanentes ni llamar la URL de Lambda directamente desde el cliente.
- La Lambda mantiene `createSession`, `verifySession` y `compareFaces`; el registro activo usa las dos primeras.
- Para desplegar este cambio se debe cargar la nueva versión de `aws/api-face-liveness/index.mjs` en Lambda, reiniciar el backend y recompilar la app nativa. Un código Lambda anterior no devuelve la imagen de referencia y el registro fallará de forma segura.
- Esta Lambda usa la URL pública `NONE` solo con una clave de servicio servidor a servidor. Eso impide ejecutar las acciones Rekognition sin la clave, pero no impide invocaciones públicas que consuman cuota de Lambda; antes de producción se recomienda poner API Gateway con autorización o migrar el backend a invocación IAM firmada.
