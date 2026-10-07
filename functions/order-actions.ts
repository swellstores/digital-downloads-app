import {
  getOrder,
  grantOrder,
  grantsPath,
  listGrants,
  setOrderGrantsStatus,
} from "./lib/grants";
import { isObjectId } from "./lib/tokens";

export const config: SwellConfig = {
  description: "Order page actions: resend the downloads email, reset download counts, extend, revoke or restore access",
  action: true,
};

const DAY_MS = 86_400_000;

export default async function (req: SwellRequest) {
  const { $action } = req.data;
  const orderId = $action?.record_id;

  if (!isObjectId(orderId)) {
    throw new SwellError("Run this action from an order", { status: 400 });
  }

  const order = await getOrder(req, orderId);

  if (!order) {
    throw new SwellError("Order not found", { status: 404 });
  }

  switch ($action?.id) {
    case "resend_email": {
      if (!order.paid && !(order.grand_total === 0 && !order.draft)) {
        throw new SwellError("This order isn't paid yet", { status: 400 });
      }

      // Creates anything missing first, e.g. keys owed after a pool ran out
      const result = await grantOrder(req, order, { notify: "always" });

      if (!result) {
        return { message: "This order has no digital items." };
      }

      if (!result.notified) {
        throw new SwellError("This order's access is revoked. Restore it first", { status: 400 });
      }

      return {
        message: result.keysMissing
          ? `Downloads email sent, but ${result.keysMissing} license ${result.keysMissing === 1 ? "key is" : "keys are"} still missing. Import more keys, then resend.`
          : "Downloads email sent.",
      };
    }

    case "reset_counts": {
      const grants = await listGrants(req, { order_id: order.id });

      await Promise.all(
        grants.map((grant) =>
          req.swell.put(`${grantsPath(req)}/${grant.id}`, { $set: { download_counts: {} } }),
        ),
      );

      return { message: "Download counts reset." };
    }

    case "extend_access": {
      const days = Number(req.data.days);

      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw new SwellError("Enter a number of days between 1 and 3650", { status: 400 });
      }

      const now = Date.now();
      const grants = (await listGrants(req, { order_id: order.id })).filter(
        (grant) => grant.date_expires,
      );

      // Expired access restarts from today rather than from the old date
      await Promise.all(
        grants.map((grant) => {
          const from = Math.max(now, new Date(grant.date_expires!).getTime());
          return req.swell.put(`${grantsPath(req)}/${grant.id}`, {
            date_expires: new Date(from + days * DAY_MS).toISOString(),
          });
        }),
      );

      return {
        message: grants.length
          ? `Access extended by ${days} ${days === 1 ? "day" : "days"}.`
          : "This order's downloads don't expire.",
      };
    }

    case "revoke_access": {
      await setOrderGrantsStatus(req, order.id, ["active", "suspended"], "revoked", "admin");
      await req.swell.put(`/orders/${order.id}`, req.appValues({ access_status: "revoked" }));

      return { message: "Access and license keys revoked." };
    }

    case "restore_access": {
      const grants = await setOrderGrantsStatus(req, order.id, ["revoked"], "active", null);

      if (grants.length === 0) {
        return { message: "Nothing to restore." };
      }

      await req.swell.put(`/orders/${order.id}`, req.appValues({ access_status: "granted" }));

      return {
        message:
          order.canceled || order.refunded
            ? "Access restored, but buyers still can't download because the order is canceled or refunded."
            : "Access and license keys restored.",
      };
    }

    default:
      throw new SwellError(`Unknown action ${$action?.id}`, { status: 400 });
  }
}
