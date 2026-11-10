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
const administrador = require('firebase-admin');
const fs = require('fs');
const ruta = require('path');

let firebaseAplicacion = null;

function resolverCredencialesRuta(brutoRuta) {
  if (!brutoRuta) return null;
  if (ruta.isAbsolute(brutoRuta)) return brutoRuta;

  const desdeCwd = ruta.resolve(process.cwd(), brutoRuta);
  if (fs.existsSync(desdeCwd)) return desdeCwd;

  const desdeServidorRaiz = ruta.resolve(__dirname, '../../', brutoRuta);
  if (fs.existsSync(desdeServidorRaiz)) return desdeServidorRaiz;

  return desdeCwd;
}

function obtenerFirebaseAplicacion() {
  if (firebaseAplicacion) return firebaseAplicacion;

  // Si se provee el archivo de cuenta de servicio
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const resueltoRuta = resolverCredencialesRuta(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = resueltoRuta;

    if (!fs.existsSync(resueltoRuta)) {
      console.warn(`⚠️ [Firebase] No se encontró service account en: ${resueltoRuta}`);
      return null;
    }

    firebaseAplicacion = administrador.initializeApp({
      credential: administrador.credential.applicationDefault()
    });
    console.log(`🔥 [Firebase] Admin SDK inicializado con credenciales en: ${resueltoRuta}`);
    return firebaseAplicacion;
  }

  // Si se proveen las variables individuales
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL: FIREBASE_CLIENTE_CORREO, FIREBASE_PRIVATE_KEY: FIREBASE_PRIVADO_CLAVE } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENTE_CORREO || !FIREBASE_PRIVADO_CLAVE) {
    console.warn('⚠️ [Firebase] Variables de entorno FCM no configuradas. Push notifications desactivadas.');
    return null;
  }

  firebaseAplicacion = administrador.initializeApp({
    credential: administrador.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENTE_CORREO,
      privateKey: FIREBASE_PRIVADO_CLAVE.replace(/\\n/g, '\n')
    })
  });

  console.log('🔥 [Firebase] Admin SDK inicializado correctamente.');
  return firebaseAplicacion;
}

module.exports = { obtenerAplicacionFirebase: obtenerFirebaseAplicacion };
