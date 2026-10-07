import { isUniqueViolation } from "./lib/errors";
import { countAvailable, keysPath } from "./lib/licenses";
import { isObjectId } from "./lib/tokens";
import { mapLimit } from "./lib/util";

export const config: SwellConfig = {
  description: "Product page actions: import license keys, and email past buyers about an update",
  action: true,
};

// Keeps an import inside the 10 second function timeout
const MAX_IMPORT = 500;

export default async function (req: SwellRequest) {
  const { $action } = req.data;
  const productId = $action?.record_id;

  if (!isObjectId(productId)) {
    throw new SwellError("Run this action from a product", { status: 400 });
  }

  switch ($action?.id) {
    case "import_keys": {
      // The modal's variant lookup may send the id under its key or its field id
      const variant = req.data.variant_id ?? req.data.variant;
      return importKeys(req, productId, req.data.keys, variant?.id ?? variant);
    }

    case "notify_buyers": {
      const message = typeof req.data.message === "string" ? req.data.message.trim() : "";

      await req.swell.post(`/apps/${req.appId}/notify-jobs`, {
        product_id: productId,
        message: message.slice(0, 2000) || null,
        reset_counts: req.data.reset_counts === true,
        status: "pending",
      });

      return { message: "Update emails will go out to past buyers over the next few minutes." };
    }

    default:
      throw new SwellError(`Unknown action ${$action?.id}`, { status: 400 });
  }
}

async function importKeys(req: SwellRequest, productId: string, text: unknown, variantId: unknown) {
  const keys = [
    ...new Set(
      String(text ?? "")
        .split(/[\r\n,]+/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];

  if (keys.length === 0) {
    throw new SwellError("Paste at least one key, one per line", { status: 400 });
  }

  if (keys.length > MAX_IMPORT) {
    throw new SwellError(`Import up to ${MAX_IMPORT} keys at a time`, { status: 400 });
  }

  let duplicates = 0;

  await mapLimit(keys, 10, async (key) => {
    try {
      await req.swell.post(keysPath(req), {
        key,
        product_id: productId,
        // Left out rather than null, so pool queries can find it with $exists
        ...(isObjectId(variantId) ? { variant_id: variantId } : {}),
        source: "pool",
        status: "available",
        claims: 0,
      });
    } catch (err) {
      if (!isUniqueViolation(err, "key")) {
        throw err;
      }

      duplicates++;
    }
  });

  const imported = keys.length - duplicates;
  const available = await countAvailable(req, productId);

  return {
    message:
      `Imported ${imported} ${imported === 1 ? "key" : "keys"}` +
      (duplicates ? `; skipped ${duplicates} that already exist` : "") +
      `. ${available} available to sell.`,
  };
}
