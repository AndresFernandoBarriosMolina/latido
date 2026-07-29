import {
  S3Client, PutObjectCommand, GetObjectCommand,
  CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/index.js';
import crypto from 'node:crypto';

// Cliente INTERNO: operaciones servidor→MinIO (crear buckets, políticas).
const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region:   config.s3.region,
  forcePathStyle: true,
  credentials: {
    accessKeyId:     config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
});

// Cliente de PRESIGN: firma URLs con el endpoint PÚBLICO (alcanzable por el
// navegador vía nginx). Se desactiva el checksum automático (CRC32) del SDK v3,
// que añade parámetros que rompen el PUT directo desde el navegador.
const s3Presign = new S3Client({
  endpoint: config.s3.publicEndpoint,
  region:   config.s3.region,
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId:     config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
});

export const BUCKET_MEDIA   = config.s3.bucketMedia  || 'latido-media';
export const BUCKET_PUBLIC  = config.s3.bucketPublic || 'latido-public';

// Inicializa buckets al arrancar (idempotente)
export async function initBuckets() {
  for (const bucket of [BUCKET_MEDIA, BUCKET_PUBLIC]) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (e) {
        if (!e.message?.includes('already exists') && !e.Code?.includes('BucketAlreadyOwned')) throw e;
      }
    }
  }
  // Política pública: lectura anónima SOLO de los prefijos verdaderamente
  // públicos (avatars, previews degradadas). Cualquier otro objeto que caiga en
  // este bucket NO queda expuesto. El listado del bucket nunca se concede
  // (sin s3:ListBucket) → no se puede enumerar el directorio.
  const publicPolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [
        `arn:aws:s3:::${BUCKET_PUBLIC}/avatars/*`,
        `arn:aws:s3:::${BUCKET_PUBLIC}/previews/*`,
        `arn:aws:s3:::${BUCKET_PUBLIC}/covers/*`,
      ],
    }],
  });
  try {
    await s3.send(new PutBucketPolicyCommand({ Bucket: BUCKET_PUBLIC, Policy: publicPolicy }));
  } catch {}
  // El bucket de media privada NO recibe ninguna política pública: solo
  // accesible con credenciales del servidor o URL firmada de corta vida.
}

// Valida una clave de objeto: evita path traversal y caracteres peligrosos.
// Lanza si la clave es inválida.
export function assertSafeKey(key) {
  if (typeof key !== 'string' || key.length < 3 || key.length > 300)
    throw Object.assign(new Error('invalid_key'), { status: 400 });
  if (key.startsWith('/') || key.includes('..') || key.includes('\\') || /[\x00-\x1f]/.test(key))
    throw Object.assign(new Error('invalid_key'), { status: 400 });
  if (!/^[a-zA-Z0-9/_.\-]+$/.test(key))
    throw Object.assign(new Error('invalid_key'), { status: 400 });
  return key;
}

// Verifica que la clave pertenezca al prefijo del propio usuario (anti-IDOR):
// p.ej. content/<userId>/...  evita referenciar objetos de otra persona.
export function assertOwnedKey(key, prefix, userId) {
  assertSafeKey(key);
  if (!key.startsWith(`${prefix}/${userId}/`))
    throw Object.assign(new Error('key_not_owned'), { status: 403 });
  return key;
}

// URL pública para archivos del bucket público (avatars, previews).
// Se sirve a través de nginx en /cdn/ — MinIO NO se expone al exterior, lo que
// reduce la superficie de ataque y evita el acceso/enumeración directa al store.
// Las URLs externas (http...) de Google se devuelven tal cual.
export function publicUrl(key) {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key;
  return `/cdn/${key}`;
}

// URL firmada para LECTURA privada (contenido premium, corta vida).
// Firmada con el endpoint público → el navegador la alcanza vía nginx.
export async function signedReadUrl(key, bucket = BUCKET_MEDIA, ttl = 45) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Presign, cmd, { expiresIn: ttl });
}

// URL firmada para SUBIDA directa desde el cliente (PUT, 5 min).
// Firmada con el endpoint público → el navegador la alcanza vía nginx.
export async function signedUploadUrl({ bucket, key, contentType, maxBytes = 10_000_000 }) {
  const cmd = new PutObjectCommand({
    Bucket: bucket, Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(s3Presign, cmd, { expiresIn: 300 });
  return url;
}

// Descarga un objeto de MinIO a un Buffer (uso servidor: generación de previews).
export async function getObjectBuffer(bucket, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Sube un Buffer a MinIO (uso servidor: guardar el preview degradado).
export async function putObjectBuffer(bucket, key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return key;
}

// Genera clave única para un archivo
export function uniqueKey(prefix, ext) {
  return `${prefix}/${crypto.randomUUID()}.${ext}`;
}

// Extensión a partir de MIME type
export function extFromMime(mime = '') {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif',  'video/mp4': 'mp4', 'video/webm': 'webm',
    'video/quicktime': 'mov',
  };
  return map[mime] || 'bin';
}
