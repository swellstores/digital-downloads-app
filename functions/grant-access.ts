import { getOrder, grantOrder } from "./lib/grants";

export const config: SwellConfig = {
  description: "Give buyers their downloads and license keys when an order is paid, or placed for free",
  model: {
    // Free orders never become paid, so they're handled when submitted
    events: ["order.paid", "order.submitted"],
  },
};

export default async function (req: SwellRequest) {
  const { $event, id, draft, grand_total } = req.data;

  if ($event?.type === "order.submitted" && (draft || grand_total !== 0)) {
    return;
  }

  const order = await getOrder(req, id);

  if (!order || order.canceled) {
    return;
  }

  // Duplicate deliveries, and $0 orders that fire both events, email once
  await grantOrder(req, order, { notify: "if_new" });
}
