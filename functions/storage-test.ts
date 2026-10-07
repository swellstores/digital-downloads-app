import { getObject, openBucket, putObject, StorageError } from "./lib/s3";
import { getSettings } from "./lib/settings";

export const config: SwellConfig = {
  description: "Check the storage settings by writing and reading a small test file in the bucket folder",
  action: true,
};

export default async function (req: SwellRequest) {
  const bucket = openBucket((await getSettings(req)).storage);

  if (!bucket) {
    throw new SwellError("Fill in the bucket, access key ID and secret access key, then save", {
      status: 400,
    });
  }

  // Overwritten on every test, so at most one small file is ever left behind
  const key = `${bucket.prefix}.connection-test`;
  const stamp = `Digital Downloads connection test ${new Date().toISOString()}`;

  try {
    await putObject(bucket, key, stamp);

    if ((await getObject(bucket, key)) !== stamp) {
      throw new SwellError("The bucket returned a different file than was written. Check the endpoint and bucket name", { status: 400 });
    }
  } catch (err) {
    if (err instanceof StorageError) {
      throw new SwellError(`The bucket refused the test (${err.code ?? err.status}): ${err.message}`, {
        status: 400,
      });
    }

    throw err;
  }

  return {
    message: `Connected. Uploads go to ${bucket.name}/${bucket.prefix}. The uploader also needs a CORS rule allowing PUT from its address and exposing the ETag header. If the rule is missing, the uploader shows the address to add.`,
  };
}
