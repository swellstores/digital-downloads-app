import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  newObjectKey,
  objectUrl,
  openBucket,
  presignDownload,
  uploadPart,
} from "../../functions/lib/s3";
import { STORAGE } from "../helpers/fixtures";

describe("openBucket", () => {
  it("needs a bucket and both keys", () => {
    expect(openBucket({ ...STORAGE, secret_access_key: "" })).toBeNull();
    expect(openBucket({})).toBeNull();
  });

  it("normalizes the folder prefix, defaulting it when unset", () => {
    expect(openBucket({ ...STORAGE, prefix: "/files" })!.prefix).toBe("files/");
    expect(openBucket({ ...STORAGE, prefix: "" })!.prefix).toBe("");
    expect(openBucket({ ...STORAGE, prefix: null })!.prefix).toBe("digital-downloads/");
  });

  it("defaults Amazon S3 to us-east-1, since it has no auto region", () => {
    expect(openBucket({ ...STORAGE, endpoint: "", region: "auto" })!.region).toBe("us-east-1");
    expect(openBucket({ ...STORAGE, region: "" })!.region).toBe("auto");
  });
});

describe("objectUrl", () => {
  it("uses path-style URLs for custom endpoints and encodes each segment", () => {
    expect(objectUrl(openBucket(STORAGE)!, "digital-downloads/p1/a b.zip")).toBe(
      "https://acct.r2.cloudflarestorage.com/downloads/digital-downloads/p1/a%20b.zip",
    );
  });

  it("uses virtual-hosted URLs for Amazon S3", () => {
    const bucket = openBucket({ ...STORAGE, endpoint: null, region: "eu-west-1" })!;

    expect(objectUrl(bucket, "x/y.pdf")).toBe("https://downloads.s3.eu-west-1.amazonaws.com/x/y.pdf");
  });
});

describe("presigned URLs", () => {
  it("signs a download that expires in 5 minutes and saves under the original name", async () => {
    const url = new URL(await presignDownload(openBucket(STORAGE)!, "digital-downloads/p1/abc/Course.zip", "Course (2026).zip"));

    expect(url.origin + url.pathname).toBe(
      "https://acct.r2.cloudflarestorage.com/downloads/digital-downloads/p1/abc/Course.zip",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("response-content-disposition")).toContain('filename="Course (2026).zip"');
  });

  it("sends an upload part unhashed and returns its ETag", async () => {
    const bucket = openBucket(STORAGE)!;
    let sent: Request | null = null;
    bucket.client.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = await bucket.client.sign(input as string, init);
      return new Response("", { status: 200, headers: { ETag: '"abc123"' } });
    }) as typeof bucket.client.fetch;

    const etag = await uploadPart(bucket, "k/file.bin", "upload-123", 7, new Uint8Array(5).buffer);
    const url = new URL(sent!.url);

    expect(etag).toBe('"abc123"');
    expect(sent!.method).toBe("PUT");
    expect(url.searchParams.get("partNumber")).toBe("7");
    expect(url.searchParams.get("uploadId")).toBe("upload-123");
    expect(sent!.headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD");
    expect(sent!.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("fails a part the bucket accepted without an ETag", async () => {
    const bucket = openBucket(STORAGE)!;
    bucket.client.fetch = (async () => new Response("", { status: 200 })) as typeof bucket.client.fetch;

    await expect(uploadPart(bucket, "k/file.bin", "upload-123", 1, new Uint8Array(1).buffer)).rejects.toThrow("ETag");
  });
});

describe("newObjectKey", () => {
  it("puts each upload in its own folder under the product, with a safe file name", () => {
    const bucket = openBucket(STORAGE)!;
    const first = newObjectKey(bucket, "p1", "My Course (final) é.zip");
    const second = newObjectKey(bucket, "p1", "My Course (final) é.zip");

    expect(first).toMatch(/^digital-downloads\/p1\/[0-9a-f]{16}\/My-Course-final-e.zip$/);
    expect(first).not.toBe(second);
  });
});

describe("contentDisposition", () => {
  it("keeps an ASCII fallback and the UTF-8 name", () => {
    expect(contentDisposition('Résumé "final".pdf')).toBe(
      `attachment; filename="R_sum_ _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf`,
    );
  });
});
