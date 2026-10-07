import { setOrderGrantsStatus } from "./lib/grants";

export const config: SwellConfig = {
  description: "Remove download access and license keys when an order is canceled or fully refunded",
  model: {
    events: ["order.canceled", "order.refunded"],
  },
};

export default async function (req: SwellRequest) {
  const reason = req.data.$event?.type === "order.refunded" ? "refunded" : "canceled";

  const grants = await setOrderGrantsStatus(
    req,
    req.data.id,
    ["active", "suspended"],
    "revoked",
    reason,
  );

  if (grants.length > 0) {
    await req.swell.put(`/orders/${req.data.id}`, req.appValues({ access_status: "revoked" }));
  }
}
