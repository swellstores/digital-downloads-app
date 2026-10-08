/**
 * S3-compatible storage (Amazon S3, Cloudflare R2, Backblaze B2, Wasabi).
 *
 * Shared by the functions (presigned downloads) and the frontend uploader
 * (multipart uploads relayed through its worker), so it must not use Swell
 * function globals.
 */
import { AwsClient } from "aws4fetch";

export interface StorageSettings {
  endpoint?: string | null;
  bucket?: string | null;
  prefix?: string | null;
  access_key_id?: string | null;
  secret_access_key?: string | null;
}

export interface Bucket {
  client: AwsClient;
  name: string;
  region: string;
  prefix: string;
  /** Custom endpoint for R2, B2, Wasabi; null for Amazon S3 */
  endpoint: string | null;
}

/**
 * Used when the Folder setting is empty. Installed apps start with empty
 * settings, so defaults in settings/*.json never reach the saved values.
 */
export const DEFAULT_PREFIX = "digital-downloads/";

/** Download links stop working after this many seconds. */
export const DOWNLOAD_URL_SECONDS = 300;

/** S3 allows at most 10,000 parts, so 16 MiB parts cap uploads at about 160 GB. */
export const PART_SIZE = 16 * 1024 * 1024;

export function openBucket(storage: StorageSettings): Bucket | null {
  if (!storage.bucket || !storage.access_key_id || !storage.secret_access_key) {
    return null;
  }

  const { endpoint, region } = locate(storage.endpoint);

  return {
    client: new AwsClient({
      accessKeyId: storage.access_key_id,
      secretAccessKey: storage.secret_access_key,
      service: "s3",
      region,
    }),
    name: storage.bucket.trim(),
    region,
    prefix: normalizePrefix(storage.prefix ?? DEFAULT_PREFIX),
    endpoint,
  };
}

/**
 * The region comes from the endpoint, so merchants don't have to enter it.
 * Amazon S3 endpoints (s3.<region>.amazonaws.com) become virtual-hosted URLs,
 * and an empty endpoint means Amazon S3 in us-east-1. Backblaze B2 and Wasabi
 * name the region in the host too. Anything else, like Cloudflare R2, signs
 * with "auto".
 */
function locate(value?: string | null): { endpoint: string | null; region: string } {
  const endpoint = value?.trim().replace(/\/+$/, "") || null;

  if (!endpoint) {
    return { endpoint: null, region: "us-east-1" };
  }

  const host = endpoint.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  const aws = host.match(/^s3[.-](?:dualstack\.)?([a-z0-9-]+)\.amazonaws\.com$/);

  if (aws) {
    return { endpoint: null, region: aws[1] };
  }

  const named = host.match(/^s3\.([a-z0-9-]+)\.(?:backblazeb2|wasabisys)\.com$/);

  return { endpoint, region: named?.[1] ?? "auto" };
}

function normalizePrefix(prefix?: string | null): string {
  const trimmed = (prefix ?? "").trim().replace(/^\/+/, "");
  return trimmed && !trimmed.endsWith("/") ? `${trimmed}/` : trimmed;
}

/** Amazon S3 uses virtual-hosted URLs; custom endpoints use path-style URLs. */
export function objectUrl(bucket: Bucket, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");

  if (!bucket.endpoint) {
    return `https://${bucket.name}.s3.${bucket.region}.amazonaws.com/${path}`;
  }

  return `${bucket.endpoint}/${encodeURIComponent(bucket.name)}/${path}`;
}

/**
 * Key for a new upload. A random folder keeps every upload separate, so
 * replacing a file never overwrites one a buyer may be downloading.
 */
export function newObjectKey(bucket: Bucket, productId: string, filename: string): string {
  const random = [...crypto.getRandomValues(new Uint8Array(8))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const safeName =
    filename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-120) || "file";

  return `${bucket.prefix}${productId}/${random}/${safeName}`;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function presign(
  bucket: Bucket,
  method: string,
  url: URL,
  seconds: number,
): Promise<string> {
  url.searchParams.set("X-Amz-Expires", String(seconds));

  const signed = await bucket.client.sign(url.toString(), {
    method,
    aws: { signQuery: true },
  });

  return signed.url;
}

/** Short-lived download link that saves the file under its original name. */
export function presignDownload(
  bucket: Bucket,
  key: string,
  filename: string,
  seconds = DOWNLOAD_URL_SECONDS,
): Promise<string> {
  const url = new URL(objectUrl(bucket, key));
  url.searchParams.set("response-content-disposition", contentDisposition(filename));

  return presign(bucket, "GET", url, seconds);
}

export class StorageError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function send(
  bucket: Bucket,
  url: string,
  init: RequestInit & { method: string },
): Promise<string> {
  return (await sendForResponse(bucket, url, init)).text;
}

async function sendForResponse(
  bucket: Bucket,
  url: string,
  init: RequestInit & { method: string },
): Promise<{ text: string; headers: Headers }> {
  const response = await bucket.client.fetch(url, init);
  const text = await response.text();

  // CompleteMultipartUpload can fail with a 200 and an error body
  if (!response.ok || text.includes("<Error>")) {
    const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
    const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1];

    throw new StorageError(
      message ?? `Storage request failed with status ${response.status}`,
      response.ok ? 502 : response.status,
      code,
    );
  }

  return { text, headers: response.headers };
}

export async function createMultipartUpload(
  bucket: Bucket,
  key: string,
  contentType: string,
): Promise<string> {
  const url = new URL(objectUrl(bucket, key));
  url.searchParams.set("uploads", "");

  const text = await send(bucket, url.toString(), {
    method: "POST",
    headers: { "Content-Type": contentType || "application/octet-stream" },
  });

  const uploadId = text.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];

  if (!uploadId) {
    throw new StorageError("The bucket didn't return an upload id", 502);
  }

  return uploadId;
}

export async function completeMultipartUpload(
  bucket: Bucket,
  key: string,
  uploadId: string,
  parts: Array<{ part_number: number; etag: string }>,
): Promise<void> {
  const url = new URL(objectUrl(bucket, key));
  url.searchParams.set("uploadId", uploadId);

  const body =
    "<CompleteMultipartUpload>" +
    [...parts]
      .sort((a, b) => a.part_number - b.part_number)
      .map(
        (part) =>
          `<Part><PartNumber>${part.part_number}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`,
      )
      .join("") +
    "</CompleteMultipartUpload>";

  await send(bucket, url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body,
  });
}

/**
 * Uploads one part of a multipart upload and returns its ETag. The payload
 * isn't hashed into the signature, which HTTPS makes unnecessary and which
 * would cost CPU time on every 16 MiB part.
 */
export async function uploadPart(
  bucket: Bucket,
  key: string,
  uploadId: string,
  partNumber: number,
  body: ArrayBuffer,
): Promise<string> {
  const url = new URL(objectUrl(bucket, key));
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);

  const { headers } = await sendForResponse(bucket, url.toString(), {
    method: "PUT",
    headers: { "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD" },
    body,
  });
  const etag = headers.get("ETag");

  if (!etag) {
    throw new StorageError("The bucket didn't return an ETag for the part", 502);
  }

  return etag;
}

export async function abortMultipartUpload(
  bucket: Bucket,
  key: string,
  uploadId: string,
): Promise<void> {
  const url = new URL(objectUrl(bucket, key));
  url.searchParams.set("uploadId", uploadId);

  await send(bucket, url.toString(), { method: "DELETE" });
}

export async function putObject(bucket: Bucket, key: string, body: string): Promise<void> {
  await send(bucket, objectUrl(bucket, key), {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body,
  });
}

export async function getObject(bucket: Bucket, key: string): Promise<string> {
  return send(bucket, objectUrl(bucket, key), { method: "GET" });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
