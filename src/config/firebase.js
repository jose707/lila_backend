// backend/src/config/firebase.js
/**
 * Inicialización de Firebase Admin SDK.
 *
 * Requiere en .env:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (con \n reales, entre comillas dobles en .env)
 *
 * O bien: GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let firebaseApp = null;

function resolveCredentialsPath(rawPath) {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return rawPath;

  const fromCwd = path.resolve(process.cwd(), rawPath);
  if (fs.existsSync(fromCwd)) return fromCwd;

  const fromBackendRoot = path.resolve(__dirname, '../../', rawPath);
  if (fs.existsSync(fromBackendRoot)) return fromBackendRoot;

  return fromCwd;
}

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  // Si se provee el archivo de cuenta de servicio
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const resolvedPath = resolveCredentialsPath(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = resolvedPath;

    if (!fs.existsSync(resolvedPath)) {
      console.warn(`⚠️ [Firebase] No se encontró service account en: ${resolvedPath}`);
      return null;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    console.log(`🔥 [Firebase] Admin SDK inicializado con credenciales en: ${resolvedPath}`);
    return firebaseApp;
  }

  // Si se proveen las variables individuales
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.warn('⚠️ [Firebase] Variables de entorno FCM no configuradas. Push notifications desactivadas.');
    return null;
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey:  FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  console.log('🔥 [Firebase] Admin SDK inicializado correctamente.');
  return firebaseApp;
}

module.exports = { getFirebaseApp };
