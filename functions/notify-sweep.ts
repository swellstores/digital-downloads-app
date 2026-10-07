import { grantsPath, listGrants, orderAccess } from "./lib/grants";
import type { Order, Page, Product } from "./lib/types";

export const config: SwellConfig = {
  description: "Send queued 'new version available' emails to past buyers in batches",
  cron: {
    schedule: "*/5 * * * *",
  },
};

// Grants read per run, and sends in flight at once
const PAGE = 100;
const CHUNK = 10;

// No new sends start after this, so the last chunk and the cursor write finish
// well inside the 10 second timeout. A timed-out run would repeat its batch and
// email people twice. Workers open at most 6 connections at once, so a run
// sends roughly 30 emails.
const BUDGET_MS = 5000;

interface NotifyJob {
  id: string;
  product_id: string;
  message?: string | null;
  reset_counts?: boolean;
  last_grant_id?: string | null;
  sent_count?: number;
}

export default async function (req: SwellRequest) {
  const started = Date.now();

  const jobs: Page<NotifyJob> | null = await req.swell.get(`/apps/${req.appId}/notify-jobs`, {
    where: { status: "pending" },
    sort: "date_created asc",
    limit: 1,
  });

  const job = jobs?.results?.[0];

  if (!job) {
    return;
  }

  // Grants are read in id order, so the cursor survives new purchases mid-run
  const grants = await listGrants(
    req,
    {
      product_id: job.product_id,
      status: "active",
      ...(job.last_grant_id ? { id: { $gt: job.last_grant_id } } : {}),
    },
    PAGE,
    "id asc",
  );

  const orderIds = [...new Set(grants.map((grant) => grant.order_id))];

  const [product, orders]: [Product | null, Page<Order> | null] = await Promise.all([
    req.swell.get(`/products/${job.product_id}`),
    orderIds.length
      ? req.swell.get("/orders", { where: { id: { $in: orderIds } }, limit: orderIds.length })
      : null,
  ]);

  const ordersById = new Map((orders?.results ?? []).map((order) => [order.id, order]));
  const emailed = new Set<string>();
  const now = new Date().toISOString();
  let lastGrantId = job.last_grant_id ?? null;
  let processed = 0;
  let sent = 0;

  while (processed < grants.length && Date.now() - started < BUDGET_MS) {
    const chunk = grants.slice(processed, processed + CHUNK);

    await Promise.all(
      chunk.map(async (grant) => {
        const order = ordersById.get(grant.order_id);
        const downloadsUrl = order ? orderAccess(req, order).downloads_url : null;

        // One email per order, even when it has several items of the product
        const email = Boolean(downloadsUrl) && !emailed.has(grant.order_id);

        if (email) {
          emailed.add(grant.order_id);
        }

        // The email goes out with a write to the grant, which is cheap, rather
        // than to the order, which runs order formulas and other apps' hooks
        const update = {
          ...(job.reset_counts ? { $set: { download_counts: {} } } : {}),
          ...(email
            ? {
                date_update_notified: now,
                $notify: {
                  id: `${req.appId}.file-updated`,
                  data: {
                    product_name: product?.name ?? "your purchase",
                    message: job.message ?? null,
                    downloads_url: downloadsUrl,
                  },
                },
              }
            : {}),
        };

        if (Object.keys(update).length > 0) {
          await req.swell.put(`${grantsPath(req)}/${grant.id}`, update);
        }

        if (email) {
          sent++;
        }
      }),
    );

    processed += chunk.length;
    lastGrantId = chunk.at(-1)!.id;
  }

  const done = processed === grants.length && grants.length < PAGE;

  await req.swell.put(`/apps/${req.appId}/notify-jobs/${job.id}`, {
    last_grant_id: lastGrantId,
    sent_count: (job.sent_count ?? 0) + sent,
    ...(done ? { status: "done", date_completed: now } : {}),
  });
}
