import { DENIAL_MESSAGES } from "./access";
import type { ItemView } from "./grants";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" });
}

const STYLES = `
:root{--bg:#f6f6f4;--card:#fff;--text:#1d1d1b;--muted:#6b6b66;--line:#e4e4df;--accent:#1d1d1b;--accent-text:#fff;--notice:#fff4e5;--notice-text:#7a4b00}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1f1f1d;--text:#f0f0ec;--muted:#a3a39c;--line:#33332f;--accent:#f0f0ec;--accent-text:#141413;--notice:#3a2c12;--notice-text:#f5d08a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:40px 16px}
h1{font-size:24px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 24px}
.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
h2{font-size:18px;margin:0}
.variant{color:var(--muted);font-weight:400;margin-left:8px}
.meta{color:var(--muted);font-size:14px;margin:4px 0 0}
.notice{background:var(--notice);color:var(--notice-text);border-radius:8px;padding:10px 12px;margin:12px 0 0;font-size:14px}
ul{list-style:none;margin:16px 0 0;padding:0}
li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.name{font-weight:600}
.version,.left{color:var(--muted);font-size:14px;margin-left:8px}
form{margin:0}
button{background:var(--accent);color:var(--accent-text);border:0;border-radius:8px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}
button:disabled{opacity:.4;cursor:not-allowed}
.keys{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}
h3{font-size:14px;margin:0 0 8px;color:var(--muted);font-weight:600}
code{display:block;font:15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:8px;user-select:all;overflow-wrap:anywhere}
.key-meta{color:var(--muted);font-size:13px;margin:-4px 0 8px}
`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLES}</style></head><body><main>${body}</main></body></html>`;
}

export function renderMessagePage(title: string, message: string): string {
  return layout(title, `<h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(message)}</p>`);
}

export interface DownloadsPage {
  orderId: string;
  token: string;
  orderNumber?: string;
  items: ItemView[];
  notice?: string | null;
}

function renderItem(page: DownloadsPage, item: ItemView): string {
  const { grant } = item;
  const meta = item.denial
    ? ""
    : grant.date_expires
      ? `<p class="meta">Available until ${escapeHtml(formatDate(grant.date_expires))}</p>`
      : "";

  const files = item.deliverables
    .map((deliverable) => {
      const left =
        deliverable.downloads_left === null
          ? ""
          : `<span class="left">${deliverable.downloads_left} ${deliverable.downloads_left === 1 ? "download" : "downloads"} left</span>`;

      const label = deliverable.source === "bucket" ? "Download" : "Open";
      const disabled = deliverable.denial ? " disabled" : "";

      return `<li><div><span class="name">${escapeHtml(deliverable.name)}</span>${deliverable.version ? `<span class="version">v${escapeHtml(deliverable.version)}</span>` : ""}${left}</div><form method="post"><input type="hidden" name="order" value="${escapeHtml(page.orderId)}"><input type="hidden" name="token" value="${escapeHtml(page.token)}"><input type="hidden" name="grant" value="${escapeHtml(grant.id)}"><input type="hidden" name="deliverable" value="${escapeHtml(deliverable.id)}"><button type="submit"${disabled}>${deliverable.denial === "limit" ? "Limit reached" : label}</button></form></li>`;
    })
    .join("");

  const keys = item.license_keys.length
    ? `<div class="keys"><h3>${item.license_keys.length === 1 ? "License key" : "License keys"}</h3>${item.license_keys
        .map((key) => {
          const notes = [
            key.status === "revoked" ? "Revoked" : null,
            key.date_expires ? `Valid until ${formatDate(key.date_expires)}` : null,
            key.activation_limit
              ? `${key.activations_used} of ${key.activation_limit} activations used`
              : null,
          ].filter(Boolean);

          return `<code>${escapeHtml(key.key)}</code>${notes.length ? `<p class="key-meta">${escapeHtml(notes.join(" · "))}</p>` : ""}`;
        })
        .join("")}</div>`
    : "";

  return `<section class="item"><h2>${escapeHtml(item.product_name)}${item.variant_name ? `<span class="variant">${escapeHtml(item.variant_name)}</span>` : ""}</h2>${meta}${item.denial ? `<p class="notice">${escapeHtml(DENIAL_MESSAGES[item.denial])}</p>` : ""}${files ? `<ul>${files}</ul>` : ""}${item.denial ? "" : keys}</section>`;
}

export function renderDownloadsPage(page: DownloadsPage): string {
  const title = page.orderNumber ? `Downloads for order ${page.orderNumber}` : "Your downloads";
  const notice = page.notice ? `<p class="notice">${escapeHtml(page.notice)}</p>` : "";
  const items = page.items.length
    ? page.items.map((item) => renderItem(page, item)).join("")
    : `<p class="sub">There's nothing to download for this order yet.</p>`;

  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1><p class="sub">Keep this link private. Anyone who has it can use your downloads.</p>${notice}${items}`,
  );
}

export function htmlResponse(html: string, status = 200): SwellResponse {
  return new SwellResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
