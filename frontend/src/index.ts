/**
 * Uploader for files buyers download, embedded in the Swell dashboard.
 *
 * The page uploads straight from the browser to the store's own bucket with
 * presigned multipart URLs, so file size isn't limited by Swell or this worker.
 * Every API route requires a signed-in admin, proven by the Swell-Context the
 * proxy signs: the proxy injects app credentials into every request, including
 * ones that never came from the dashboard.
 */
import { Hono, type Context } from "hono";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  newObjectKey,
  openBucket,
  PART_SIZE,
  presignUploadPart,
  StorageError,
  type Bucket,
  type StorageSettings,
} from "../../functions/lib/s3";
import { verifyContext } from "./context";
import { uploaderPage } from "./page";

interface Swell {
  apiHost: string;
  storeId: string;
  accessToken: string;
  appId: string;
}

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// Presigned part URLs are handed out in batches as the upload needs them
const MAX_PARTS_PER_REQUEST = 50;

const app = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * The dashboard may forward paths with or without its /app/<slug> prefix, so
 * routes are matched on the end of the path. The API lives under
 * /uploader-api because the platform claims /api on app hosts.
 */
app.all("*", async (c) => {
  const path = new URL(c.req.url).pathname;
  const api = path.match(
    /\/uploader-api\/(products\/[0-9a-f]{24}|uploads(?:\/parts|\/complete|\/abort)?)$/i,
  )?.[1];

  if (!api) {
    return c.req.method === "GET" && /\/upload\/[0-9a-f]{24}\/?$/i.test(path)
      ? c.html(uploaderPage())
      : c.text("Not found", 404);
  }

  try {
    const swell = await requireAdmin(c);

    if (c.req.method === "GET" && api.startsWith("products/")) {
      return c.json(await getProduct(swell, api.slice("products/".length)));
    }

    if (c.req.method !== "POST") {
      throw new HttpError("Method not allowed", 405);
    }

    const body = await c.req.json().catch(() => ({}));
    const bucket = openBucket(await getStorage(swell));

    if (!bucket) {
      throw new HttpError("Connect a bucket in the app's File storage settings first", 400);
    }

    switch (api) {
      case "uploads":
        return c.json(await startUpload(swell, bucket, body));
      case "uploads/parts":
        return c.json(await signParts(bucket, body));
      case "uploads/complete":
        return c.json(await finishUpload(swell, bucket, body));
      case "uploads/abort":
        await abortMultipartUpload(
          bucket,
          requireKey(body.key),
          requireString(body.upload_id, "upload_id"),
        );
        return c.json({ aborted: true });
    }

    throw new HttpError("Not found", 404);
  } catch (err) {
    if (err instanceof HttpError || err instanceof StorageError) {
      return c.json({ error: err.message }, err.status as 400);
    }

    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  }
});

export default app;

/**
 * Requires a signed-in admin of this store. The proxy only sets `admin` in
 * Swell-Context for a dashboard admin, and for writes only when the request
 * came from this page's own origin.
 */
async function requireAdmin(c: Context): Promise<Swell> {
  const swell: Swell = {
    apiHost: c.req.header("swell-api-host") ?? "",
    storeId: c.req.header("swell-store-id") ?? "",
    accessToken: c.req.header("swell-access-token") ?? "",
    appId: c.req.header("swell-app-id") ?? "digital_downloads",
  };

  const context = await verifyContext(c.req.header("swell-context"), swell.appId);

  if (
    !swell.apiHost ||
    !swell.accessToken ||
    !context?.admin?.user_id ||
    context.store_id !== swell.storeId
  ) {
    throw new HttpError("Open this page from the Swell dashboard, signed in as an admin", 401);
  }

  return swell;
}

async function swellRequest(
  swell: Swell,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const response = await fetch(`${swell.apiHost}${path}`, {
    method,
    headers: {
      authorization: `Basic ${btoa(`${swell.storeId}:${swell.accessToken}`)}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok || data?.errors) {
    throw new HttpError(
      data?.error?.message ?? data?.error ?? "Swell API request failed",
      response.ok ? 400 : response.status,
    );
  }

  return data;
}

async function getStorage(swell: Swell): Promise<StorageSettings> {
  return (await swellRequest(swell, "GET", `/settings/${swell.appId}/storage`)) ?? {};
}

function deliverablesPath(swell: Swell): string {
  return `/products:apps.${swell.appId}.deliverables`;
}

async function getProduct(swell: Swell, productId: string) {
  const [product, deliverables, storage] = await Promise.all([
    swellRequest(swell, "GET", `/products/${productId}?fields=id,name`),
    swellRequest(swell, "GET", `${deliverablesPath(swell)}?where[parent_id]=${productId}&limit=100`),
    getStorage(swell),
  ]);

  if (!product) {
    throw new HttpError("Product not found", 404);
  }

  return {
    id: product.id,
    name: product.name,
    storage_ready: Boolean(openBucket(storage)),
    deliverables: (deliverables?.results ?? []).map((deliverable: any) => ({
      id: deliverable.id,
      name: deliverable.name,
      source: deliverable.source ?? "link",
      filename: deliverable.filename ?? null,
      size: deliverable.size ?? null,
    })),
  };
}

async function startUpload(swell: Swell, bucket: Bucket, body: any) {
  const productId = requireObjectId(body.product_id, "product_id");
  const filename = requireString(body.filename, "filename").slice(0, 255);
  const contentType =
    typeof body.content_type === "string" && body.content_type
      ? body.content_type
      : "application/octet-stream";

  const product = await swellRequest(swell, "GET", `/products/${productId}?fields=id`);

  if (!product) {
    throw new HttpError("Product not found", 404);
  }

  const key = newObjectKey(bucket, productId, filename);

  return {
    key,
    upload_id: await createMultipartUpload(bucket, key, contentType),
    part_size: PART_SIZE,
  };
}

async function signParts(bucket: Bucket, body: any) {
  const key = requireKey(body.key);
  const uploadId = requireString(body.upload_id, "upload_id");
  const partNumbers: unknown[] = Array.isArray(body.part_numbers) ? body.part_numbers : [];

  if (partNumbers.length === 0 || partNumbers.length > MAX_PARTS_PER_REQUEST) {
    throw new HttpError(`Ask for 1 to ${MAX_PARTS_PER_REQUEST} parts at a time`, 400);
  }

  const urls: Record<number, string> = {};

  for (const partNumber of partNumbers) {
    if (typeof partNumber !== "number" || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new HttpError("Part numbers must be between 1 and 10000", 400);
    }

    urls[partNumber] = await presignUploadPart(bucket, key, uploadId, partNumber);
  }

  return { urls };
}

async function finishUpload(swell: Swell, bucket: Bucket, body: any) {
  const productId = requireObjectId(body.product_id, "product_id");
  const key = requireKey(body.key);
  const uploadId = requireString(body.upload_id, "upload_id");
  const parts: Array<{ part_number: number; etag: string }> = Array.isArray(body.parts)
    ? body.parts
    : [];

  // Keys are made per product, so an upload can't be attached to another product
  if (!key.startsWith(`${bucket.prefix}${productId}/`)) {
    throw new HttpError("That upload belongs to another product", 400);
  }

  if (
    parts.length === 0 ||
    parts.some((part) => !Number.isInteger(part?.part_number) || typeof part?.etag !== "string")
  ) {
    throw new HttpError("Missing uploaded parts", 400);
  }

  await completeMultipartUpload(bucket, key, uploadId, parts);

  const filename = requireString(body.filename, "filename").slice(0, 255);
  const values = {
    source: "bucket",
    object_key: key,
    filename,
    size: Number.isInteger(body.size) ? body.size : null,
    content_type: typeof body.content_type === "string" ? body.content_type : null,
  };

  // Replacing keeps the deliverable's id, so past buyers' links get the new file
  if (body.deliverable_id) {
    const deliverableId = requireObjectId(body.deliverable_id, "deliverable_id");
    const deliverable = await swellRequest(
      swell,
      "PUT",
      `${deliverablesPath(swell)}/${deliverableId}`,
      values,
    );

    return { deliverable };
  }

  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : filename;

  const deliverable = await swellRequest(swell, "POST", deliverablesPath(swell), {
    parent_id: productId,
    name,
    ...values,
  });

  return { deliverable };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(`Missing ${field}`, 400);
  }

  return value.trim();
}

function requireObjectId(value: unknown, field: string): string {
  if (typeof value !== "string" || !OBJECT_ID.test(value)) {
    throw new HttpError(`Invalid ${field}`, 400);
  }

  return value;
}

function requireKey(value: unknown): string {
  const key = requireString(value, "key");

  if (key.includes("..") || key.length > 1024) {
    throw new HttpError("Invalid key", 400);
  }

  return key;
}
