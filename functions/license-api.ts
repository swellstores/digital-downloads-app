import { grantsPath } from "./lib/grants";
import { keysPath, listKeys } from "./lib/licenses";
import type { Activation, Grant, LicenseKey } from "./lib/types";

export const config: SwellConfig = {
  description: "License key API for your software: validate, activate and deactivate keys",
  route: {
    methods: ["post"],
    public: true,
  },
};

type Action = "validate" | "activate" | "deactivate";
type Status = "active" | "revoked" | "expired" | "suspended";

const ACTIONS: Action[] = ["validate", "activate", "deactivate"];

const STATUS_MESSAGES: Record<Exclude<Status, "active">, string> = {
  revoked: "This license key has been revoked.",
  expired: "This license key has expired.",
  suspended: "This license key is paused because its subscription isn't active.",
};

/**
 * POST {action, key, instance_id?, name?}
 *
 * validate:   whether the key may be used now.
 * activate:   records instance_id (a machine id, site URL, etc.) against the
 *             key's activation limit. Activating the same instance again is a no-op.
 * deactivate: frees instance_id's activation.
 *
 * Responses always include `valid`; errors add `error` and `message`.
 */
export async function post(req: SwellRequest) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const action = body.action as Action;
  const key = typeof body.key === "string" ? body.key.trim() : "";

  if (!ACTIONS.includes(action)) {
    return failure(400, "invalid_action", "action must be validate, activate or deactivate.");
  }

  if (!key || key.length > 200) {
    return failure(400, "invalid_key", "Send the license key as key.");
  }

  const [license] = await listKeys(req, { key }, 1);

  // Unclaimed pool keys don't belong to anyone yet
  if (!license || license.status === "available") {
    return failure(404, "not_found", "License key not found.");
  }

  const status = await licenseStatus(req, license);

  if (action === "validate") {
    return { valid: status === "active", ...describe(license, status) };
  }

  if (status !== "active") {
    return failure(403, status, STATUS_MESSAGES[status], describe(license, status));
  }

  const instanceId = typeof body.instance_id === "string" ? body.instance_id.trim() : "";

  if (!instanceId || instanceId.length > 200) {
    return failure(400, "instance_id_required", "Send an instance_id that identifies the device or site.");
  }

  const activations = license.activations ?? [];
  const existing = activations.some((activation) => activation.instance_id === instanceId);

  if (action === "activate") {
    if (existing) {
      return { valid: true, activated: true, ...describe(license, status) };
    }

    if (license.activation_limit && activations.length >= license.activation_limit) {
      return failure(
        409,
        "activation_limit",
        "This license key is already active on the maximum number of devices.",
        describe(license, status),
      );
    }

    const activation: Activation = {
      instance_id: instanceId,
      name: typeof body.name === "string" ? body.name.trim().slice(0, 200) : null,
      date_created: new Date().toISOString(),
    };

    const updated = await setActivations(req, license, [...activations, activation]);

    return { valid: true, activated: true, ...describe(updated, status) };
  }

  if (!existing) {
    return { valid: true, activated: false, ...describe(license, status) };
  }

  const updated = await setActivations(
    req,
    license,
    activations.filter((activation) => activation.instance_id !== instanceId),
  );

  return { valid: true, activated: false, ...describe(updated, status) };
}

async function licenseStatus(req: SwellRequest, license: LicenseKey): Promise<Status> {
  if (license.status === "revoked") {
    return "revoked";
  }

  if (license.date_expires && new Date(license.date_expires) <= new Date()) {
    return "expired";
  }

  if (license.grant_id) {
    const grant: Grant | null = await req.swell.get(`${grantsPath(req)}/${license.grant_id}`);

    if (grant?.status === "suspended" || grant?.status === "revoked") {
      return grant.status;
    }
  }

  return "active";
}

/** $set replaces the array; a plain write would merge into it and never remove. */
async function setActivations(
  req: SwellRequest,
  license: LicenseKey,
  activations: Activation[],
): Promise<LicenseKey> {
  const updated: LicenseKey | null = await req.swell.put(`${keysPath(req)}/${license.id}`, {
    $set: { activations },
  });

  return updated ?? { ...license, activations };
}

function describe(license: LicenseKey, status: Status) {
  return {
    status,
    key: license.key,
    product_id: license.product_id,
    variant_id: license.variant_id ?? null,
    activation_limit: license.activation_limit ?? null,
    activations_used: license.activations?.length ?? 0,
    date_expires: license.date_expires ?? null,
  };
}

function failure(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return new SwellResponse({ valid: false, error, message, ...extra }, { status });
}
