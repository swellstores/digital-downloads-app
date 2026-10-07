import { grantsPath, listGrants } from "./lib/grants";
import { extendSubscriptionKeys } from "./lib/licenses";
import type { Subscription } from "./lib/types";

export const config: SwellConfig = {
  description: "Pause downloads while a subscription is paused or canceled, and restore them when it's active again",
  model: {
    events: [
      "subscription.canceled",
      "subscription.paused",
      "subscription.resumed",
      "subscription.activated",
      "subscription.paid",
    ],
  },
};

export default async function (req: SwellRequest) {
  const type: string = req.data.$event?.type ?? "";
  const grants = await listGrants(req, { subscription_id: req.data.id });

  if (grants.length === 0) {
    return;
  }

  if (type === "subscription.canceled" || type === "subscription.paused") {
    const reason = type === "subscription.canceled" ? "subscription_canceled" : "subscription_paused";

    await Promise.all(
      grants
        .filter((grant) => grant.status === "active")
        .map((grant) =>
          req.swell.put(`${grantsPath(req)}/${grant.id}`, { status: "suspended", reason }),
        ),
    );

    return;
  }

  // Only access the subscription paused; grants an admin revoked stay revoked
  await Promise.all(
    grants
      .filter((grant) => grant.status === "suspended")
      .map((grant) =>
        req.swell.put(`${grantsPath(req)}/${grant.id}`, { status: "active", reason: null }),
      ),
  );

  const subscription: Subscription | null = await req.swell.get(`/subscriptions/${req.data.id}`);

  if (subscription?.date_period_end) {
    await extendSubscriptionKeys(req, subscription.id, subscription.date_period_end);
  }
}
