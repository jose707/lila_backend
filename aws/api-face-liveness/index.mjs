import { timingSafeEqual } from 'node:crypto';
import {
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const rekognition = new RekognitionClient({ region });
const sts = new STSClient({ region });
const MAX_BODY_BYTES = 7 * 1024 * 1024;

function authorized(event) {
  const expected = Buffer.from(process.env.LINEALILA_SERVICE_KEY || '');
  const headers = event.headers || {};
  const supplied = Buffer.from(headers['x-linealila-service-key'] || headers['X-LineaLila-Service-Key'] || '');
  return expected.length >= 32 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const handler = async event => {
  if (!authorized(event)) return response(401, { error: 'No autorizado.' });
  if (event.requestContext?.http?.method && event.requestContext.http.method !== 'POST') {
    return response(405, { error: 'Método no permitido.' });
  }
  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY_BYTES) {
    return response(413, { error: 'Solicitud demasiado grande.' });
  }

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch {
    return response(400, { error: 'JSON inválido.' });
  }

  try {
    if (input.action === 'createSession') {
      const { SessionId } = await rekognition.send(new CreateFaceLivenessSessionCommand({}));
      if (!SessionId) throw new Error('Rekognition no devolvió un identificador de sesión.');

      const { Credentials } = await sts.send(new AssumeRoleCommand({
        RoleArn: required('FACE_LIVENESS_CLIENT_ROLE_ARN'),
        RoleSessionName: `lila-liveness-${Date.now()}`,
        DurationSeconds: 900,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: 'rekognition:StartFaceLivenessSession', Resource: '*' }],
        }),
      }));
      if (!Credentials?.AccessKeyId || !Credentials.SecretAccessKey || !Credentials.SessionToken || !Credentials.Expiration) {
        throw new Error('STS no devolvió credenciales temporales completas.');
      }
      return response(200, {
        sessionId: SessionId,
        region,
        credentials: {
          accessKeyId: Credentials.AccessKeyId,
          secretAccessKey: Credentials.SecretAccessKey,
          sessionToken: Credentials.SessionToken,
          expiration: Credentials.Expiration.toISOString(),
        },
      });
    }

    if (input.action === 'verifySession') {
      if (typeof input.sessionId !== 'string' || input.sessionId.length > 128) {
        return response(400, { error: 'La sesión biométrica no es válida.' });
      }
      const documentImage = decodeImage(input.documentImageBase64);
      const result = await rekognition.send(new GetFaceLivenessSessionResultsCommand({ SessionId: input.sessionId }));
      if (result.Status !== 'SUCCEEDED' || !result.ReferenceImage?.Bytes) {
        return response(200, { status: result.Status || 'FAILED', feedback: result.Confidence < 50 ? 'No se pudo validar la prueba de vida.' : null });
      }

      const comparison = await rekognition.send(new CompareFacesCommand({
        SourceImage: { Bytes: documentImage },
        TargetImage: { Bytes: Buffer.from(result.ReferenceImage.Bytes) },
        SimilarityThreshold: 0,
        QualityFilter: 'AUTO',
      }));
      const faceMatchConfidence = Math.max(0, ...(comparison.FaceMatches || []).map(match => Number(match.Similarity) || 0));
      return response(200, {
        status: result.Status,
        livenessConfidence: Number(result.Confidence) || 0,
        faceMatchConfidence,
        referenceImageBase64: Buffer.from(result.ReferenceImage.Bytes).toString('base64'),
      });
    }

    if (input.action === 'compareFaces') {
      const selfieImage = decodeImage(input.selfieImageBase64);
      const documentImage = decodeImage(input.documentImageBase64);
      const comparison = await rekognition.send(new CompareFacesCommand({
        SourceImage: { Bytes: selfieImage },
        TargetImage: { Bytes: documentImage },
        SimilarityThreshold: 0,
        QualityFilter: 'AUTO',
      }));
      const faceMatchConfidence = Math.max(0, ...(comparison.FaceMatches || []).map(match => Number(match.Similarity) || 0));
      return response(200, { status: 'SUCCEEDED', faceMatchConfidence });
    }

    return response(400, { error: 'Acción no reconocida.' });
  } catch (error) {
    console.error('Face Liveness operation failed:', error.name || 'Error');
    return response(502, { error: 'No se pudo completar la verificación facial.' });
  }
};

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function decodeImage(value) {
  if (typeof value !== 'string' || value.length < 100 || value.length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid document image payload');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 64 || bytes.length > 4 * 1024 * 1024) throw new Error('Invalid document image size');
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) throw new Error('Unsupported document image format');
  return bytes;
}
