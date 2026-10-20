# AWS Face Liveness para Línea Lila

Este código implementa las acciones internas que el backend Node invoca. Configura la función Lambda api-face-liveness con runtime Node.js 20 o posterior, handler index.handler, URL HTTPS y payload format v2. Empaqueta esta carpeta con sus dependencias (npm install --omit=dev) y publica el contenido como código de la función.

La integración nativa del repositorio está implementada para Android y iOS, pero sus builds deben ejecutarse en sus toolchains compatibles antes de publicar la app (Android Studio/Gradle y Xcode); las pruebas locales de este entorno no pudieron completar la compilación nativa.

## Variables de entorno de Lambda

- LINEALILA_SERVICE_KEY: secreto aleatorio de al menos 32 bytes, idéntico a FACE_LIVENESS_SHARED_SECRET del backend.
- FACE_LIVENESS_CLIENT_ROLE_ARN: ARN del rol limitado que permite transmitir el flujo de video desde el SDK nativo.
- AWS_REGION: región donde se creó Lambda y la sesión Rekognition.

No pongas la clave IAM Lila en esta función, en el backend ni en la app. Lambda obtiene las credenciales de su rol de ejecución.

## Permisos IAM

El rol de ejecución de Lambda necesita estas acciones sobre * para esta integración: rekognition:CreateFaceLivenessSession, rekognition:GetFaceLivenessSessionResults, rekognition:CompareFaces y sts:AssumeRole sobre el ARN exacto indicado en FACE_LIVENESS_CLIENT_ROLE_ARN. No necesita permisos de S3: la foto del CI se envía temporalmente a CompareFaces y no se guarda en AWS.

Crea un rol aparte, por ejemplo LineaLilaFaceLivenessClient. Su política de confianza debe permitir sts:AssumeRole únicamente al ARN exacto del rol de ejecución de api-face-liveness. No permitas cuentas públicas ni usuarios IAM. El rol debe permitir solamente rekognition:StartFaceLivenessSession sobre *. Lambda emite credenciales de este rol por 15 minutos con una política de sesión aún más limitada. El backend firma un ticket temporal ligado al usuario y al SessionId; no guarda la sesión en la base de datos.

## Variables del backend Node

Configura en el entorno de despliegue, no en código móvil:

FACE_LIVENESS_LAMBDA_URL=https://<id>.lambda-url.<region>.on.aws/
FACE_LIVENESS_SHARED_SECRET=<mismo secreto aleatorio de LINEALILA_SERVICE_KEY>
FACE_LIVENESS_TICKET_SECRET=<secreto aleatorio de al menos 32 caracteres>
FACE_LIVENESS_MIN_CONFIDENCE=<umbral evaluado de prueba de vida>
FACE_MATCH_MIN_CONFIDENCE=<umbral evaluado de comparación facial>

`FACE_LIVENESS_TICKET_SECRET` firma los tickets temporales que vinculan la sesión de Rekognition con el usuario autenticado. Debe configurarse en el backend (por ejemplo, en `backend/.env` para desarrollo o en el gestor de secretos del despliegue) y no en la app móvil. Después de configurarlo, reinicia el backend. Esta clave está separada de `JWT_SECRET`, por lo que no invalida las sesiones de inicio de sesión existentes.

La API falla cerrada si faltan los umbrales. No copies puntuaciones de ejemplo a producción: ajústalas con pruebas de CI reales, dispositivos, iluminación y personas de la población usuaria.

## API interna

- POST con action=createSession crea la sesión y devuelve sessionId, region y credenciales STS temporales de mínimo privilegio.
- POST con action=verifySession, sessionId y documentImageBase64 obtiene el resultado de Face Liveness, compara su imagen de referencia contra el frente del CI y devuelve estado, puntuaciones y la imagen de referencia al backend. El backend cifra una versión reducida de esa imagen como foto de perfil únicamente cuando el registro se aprueba.
- POST con action=compareFaces, selfieImageBase64 y documentImageBase64 compara una selfie normal con el retrato del frente del CI y devuelve el nivel de similitud. La selfie no se guarda.

La ruta de producto POST /api/auth/verify-identity requiere JWT Línea Lila. El registro actual usa `createSession` y `verifySession` después de recibir las dos imágenes del CI; la app nunca recibe la imagen de referencia. `compareFaces` permanece para el flujo de selfie normal desactivado. `FACE_LIVENESS_ENABLED` debe ser `true` en la app y el backend. El cliente nunca decide las puntuaciones ni el estado final.

La Function URL NONE sigue aceptando invocaciones HTTP públicas, aunque Lambda rechaza acciones sin LINEALILA_SERVICE_KEY. Esto protege operaciones de Rekognition, pero una invocación sin permiso todavía puede consumir cuota de Lambda. Antes de producción, protege con API Gateway y autorización o cambia a AWS_IAM cuando el backend pueda firmar la llamada.
