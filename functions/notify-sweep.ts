import type { Page } from "./lib/types";

export const config: SwellConfig = {
  description: "Restart queued update emails whose next batch never ran",
  cron: {
    schedule: "40 */6 * * *",
  },
};

// Batches run on notify-batch's model schedule. This restarts a pending job
// whose scheduled run was lost (for example to a redeployed function), or one
// queued before the schedule existed. The grace period keeps it from racing a
// batch that is simply due now.
const OVERDUE_GRACE_MS = 15 * 60 * 1000;

interface PendingJob {
  id: string;
  date_next_batch?: string | null;
}

export default async function (req: SwellRequest) {
  const path = `/apps/${req.appId}/notify-jobs`;
  const jobs: Page<PendingJob> | null = await req.swell.get(path, {
    where: { status: "pending" },
    sort: "date_created asc",
    limit: 25,
  });

  const cutoff = Date.now() - OVERDUE_GRACE_MS;
  const now = new Date().toISOString();

  for (const job of jobs?.results ?? []) {
    const due = job.date_next_batch ? Date.parse(job.date_next_batch) : NaN;

    // Writing the date schedules the batch again
    if (Number.isNaN(due) || due < cutoff) {
      await req.swell.put(`${path}/${job.id}`, { date_next_batch: now });
    }
  }
}
