import { timingSafeEqual } from 'node:crypto';
import {
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  RekognitionClient } from
'@aws-sdk/client-rekognition';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const rekognition = new RekognitionClient({ region });
const sts = new STSClient({ region });
const MAXIMO_BYTES_CUERPO = 7 * 1024 * 1024;

function estaAutorizado(evento) {
  const esperada = Buffer.from(process.env.LINEALILA_SERVICE_KEY || '');
  const cabeceras = evento.headers || {};
  const recibida = Buffer.from(cabeceras['x-linealila-service-key'] || cabeceras['X-LineaLila-Service-Key'] || '');
  return esperada.length >= 32 && esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

function crearRespuesta(codigoEstado, cuerpo) {
  return {
    statusCode: codigoEstado,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(cuerpo)
  };
}

export const handler = async (evento) => {
  if (!estaAutorizado(evento)) return crearRespuesta(401, { error: 'No autorizado.' });
  if (evento.requestContext?.http?.method && evento.requestContext.http.method !== 'POST') {
    return crearRespuesta(405, { error: 'Método no permitido.' });
  }
  if (Buffer.byteLength(evento.body || '', 'utf8') > MAXIMO_BYTES_CUERPO) {
    return crearRespuesta(413, { error: 'Solicitud demasiado grande.' });
  }

  let entrada;
  try {entrada = JSON.parse(evento.body || '{}');} catch {
    return crearRespuesta(400, { error: 'JSON inválido.' });
  }

  try {
    if (entrada.action === 'createSession') {
      const { SessionId: sesionId } = await rekognition.send(new CreateFaceLivenessSessionCommand({}));
      if (!sesionId) throw new Error('Rekognition no devolvió un identificador de sesión.');

      const { Credentials: credenciales } = await sts.send(new AssumeRoleCommand({
        RoleArn: obtenerVariableRequerida('FACE_LIVENESS_CLIENT_ROLE_ARN'),
        RoleSessionName: `lila-liveness-${Date.now()}`,
        DurationSeconds: 900,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: 'rekognition:StartFaceLivenessSession', Resource: '*' }]
        })
      }));
      if (!credenciales?.AccessKeyId || !credenciales.SecretAccessKey || !credenciales.SessionToken || !credenciales.Expiration) {
        throw new Error('STS no devolvió credenciales temporales completas.');
      }
      return crearRespuesta(200, {
        sessionId: sesionId,
        region,
        credentials: {
          accessKeyId: credenciales.AccessKeyId,
          secretAccessKey: credenciales.SecretAccessKey,
          sessionToken: credenciales.SessionToken,
          expiration: credenciales.Expiration.toISOString()
        }
      });
    }

    if (entrada.action === 'verifySession') {
      if (typeof entrada.sessionId !== 'string' || entrada.sessionId.length > 128) {
        return crearRespuesta(400, { error: 'La sesión biométrica no es válida.' });
      }
      const imagenDocumento = decodificarImagen(entrada.documentImageBase64);
      const resultado = await rekognition.send(new GetFaceLivenessSessionResultsCommand({ SessionId: entrada.sessionId }));
      if (resultado.Status !== 'SUCCEEDED' || !resultado.ReferenceImage?.Bytes) {
        return crearRespuesta(200, { status: resultado.Status || 'FAILED', feedback: resultado.Confidence < 50 ? 'No se pudo validar la prueba de vida.' : null });
      }

      const comparacion = await rekognition.send(new CompareFacesCommand({
        SourceImage: { Bytes: imagenDocumento },
        TargetImage: { Bytes: Buffer.from(resultado.ReferenceImage.Bytes) },
        SimilarityThreshold: 0,
        QualityFilter: 'AUTO'
      }));
      const confianzaCoincidenciaRostros = Math.max(0, ...(comparacion.FaceMatches || []).map((coincidencia) => Number(coincidencia.Similarity) || 0));
      return crearRespuesta(200, {
        status: resultado.Status,
        livenessConfidence: Number(resultado.Confidence) || 0,
        faceMatchConfidence: confianzaCoincidenciaRostros,
        referenceImageBase64: Buffer.from(resultado.ReferenceImage.Bytes).toString('base64')
      });
    }

    if (entrada.action === 'compareFaces') {
      const imagenAutorretrato = decodificarImagen(entrada.selfieImageBase64);
      const imagenDocumento = decodificarImagen(entrada.documentImageBase64);
      const comparacion = await rekognition.send(new CompareFacesCommand({
        SourceImage: { Bytes: imagenAutorretrato },
        TargetImage: { Bytes: imagenDocumento },
        SimilarityThreshold: 0,
        QualityFilter: 'AUTO'
      }));
      const confianzaCoincidenciaRostros = Math.max(0, ...(comparacion.FaceMatches || []).map((coincidencia) => Number(coincidencia.Similarity) || 0));
      return crearRespuesta(200, { status: 'SUCCEEDED', faceMatchConfidence: confianzaCoincidenciaRostros });
    }

    return crearRespuesta(400, { error: 'Acción no reconocida.' });
  } catch (error) {
    console.error('Face Liveness operation failed:', error.name || 'Error');
    return crearRespuesta(502, { error: 'No se pudo completar la verificación facial.' });
  }
};

function obtenerVariableRequerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Missing ${nombre}`);
  return valor;
}

function decodificarImagen(valor) {
  if (typeof valor !== 'string' || valor.length < 100 || valor.length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(valor)) {
    throw new Error('Invalid document image payload');
  }
  const bytes = Buffer.from(valor, 'base64');
  if (bytes.length < 64 || bytes.length > 4 * 1024 * 1024) throw new Error('Invalid document image size');
  const esJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const esPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!esJpeg && !esPng) throw new Error('Unsupported document image format');
  return bytes;
}
