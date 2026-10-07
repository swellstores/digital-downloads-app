"""Builds the App Store listing pages. Run render.sh to render them into ../../assets."""
import pathlib

HERE = pathlib.Path(__file__).parent
GLYPH = (HERE / "glyph.svg.part").read_text()

# Sizes each ring around its target and moves each callout or menu next to its anchor, in document order
PLACE = """<script>
const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
for (const el of document.querySelectorAll("[data-ring], [data-at]")) {
  if (el.dataset.ring) {
    const t = rect(el.dataset.ring), pad = Number(el.dataset.pad ?? 6);
    Object.assign(el.style, { left: `${t.left - pad}px`, top: `${t.top - pad}px`, width: `${t.width + 2 * pad}px`, height: `${t.height + 2 * pad}px` });
    continue;
  }
  const t = rect(el.dataset.at), own = el.getBoundingClientRect(), gap = Number(el.dataset.gap ?? 14);
  const [side, align = "center"] = el.dataset.side.split(" ");
  const along = (start, size, length) => (align === "start" ? start : align === "end" ? start + size - length : start + (size - length) / 2);
  const across = side === "left" || side === "right";
  const x = across ? (side === "right" ? t.right + gap : t.left - gap - own.width) : along(t.left, t.width, own.width);
  const y = across ? along(t.top, t.height, own.height) : side === "below" ? t.bottom + gap : t.top - gap - own.height;
  el.style.left = `${x + Number(el.dataset.dx ?? 0)}px`;
  el.style.top = `${y + Number(el.dataset.dy ?? 0)}px`;
}
</script>"""

TRIANGLE = '<svg class="deco" style="{}" width="96" height="84" viewBox="0 0 96 84"><path d="M48 6 90 78H6Z" fill="none" stroke="#c4bff4" stroke-width="5" stroke-linejoin="round"/></svg>'
PLUS = '<svg class="deco" style="{}" width="60" height="60" viewBox="0 0 60 60"><path d="M30 6v48M6 30h48" stroke="#c4bff4" stroke-width="5" stroke-linecap="round"/></svg>'
DOTS = '<div class="deco dots" style="{}"></div>'
DECOS = [
    TRIANGLE.format("left:58px;top:140px") + PLUS.format("right:92px;top:112px") + DOTS.format("right:0;top:300px"),
    DOTS.format("left:52px;top:118px") + TRIANGLE.format("right:62px;top:136px") + PLUS.format("left:12px;top:620px"),
]

CHEVRON = '<svg class="chev" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>'
LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
ICONS = {
    "Home": '<path d="M4 10.5 12 4l8 6.5V20h-5v-5.5H9V20H4z"/>',
    "Orders": '<path d="M7 3.5h7l4 4v13H7z"/><path d="M13.5 3.5V8H18M9.5 12.5h6M9.5 16h6"/>',
    "Subscriptions": '<path d="M19.5 10.5A7.5 7.5 0 0 0 5.6 8M4.5 13.5a7.5 7.5 0 0 0 13.9 2.5"/><path d="M5 4v4h4M19 20v-4h-4"/>',
    "Customers": '<circle cx="9.5" cy="8.5" r="3.5"/><path d="M3 20c.7-3.4 3.2-5.3 6.5-5.3S15.3 16.6 16 20M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.9c1.6.8 2.6 2.4 3 5.1"/>',
    "Products": '<path d="M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9z"/><path d="M4.5 7.5 12 11.5l7.5-4M12 11.5v9"/>',
    "Discounts": '<path d="M4 12.5V4h8.5l8 8-8.5 8.5z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
    "Content": '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
    "Reporting": '<path d="M11 4.5a7.5 7.5 0 1 0 8.5 8.5H11z"/><path d="M14 3.5a7 7 0 0 1 6.5 6.5H14z"/>',
    "Online Store": '<path d="M4.5 10v10h15V10"/><path d="M3.5 9.5 5.5 4h13l2 5.5c0 1.4-1.2 2.5-2.7 2.5s-2.6-1.1-2.6-2.5c0 1.4-1.2 2.5-2.7 2.5S9.8 10.9 9.8 9.5c0 1.4-1.2 2.5-2.6 2.5S3.5 10.9 3.5 9.5"/>',
}
EXPANDS = {"Orders", "Products", "Discounts", "Content", "Reporting"}


def icon(name):
    return f'<svg class="ico" viewBox="0 0 24 24">{ICONS[name]}</svg>'


def sidebar(section, children, active_child):
    rows = []
    for item in ["Home", "Orders", "Subscriptions", "Customers", "Products", "Discounts", "Content", "Reporting"]:
        rows.append(f'<div class="item{" open" if item == section else ""}">{icon(item)}<span>{item}</span>{CHEVRON if item in EXPANDS else ""}</div>')
        if item == section:
            rows += [f'<div class="child{" on" if child == active_child else ""}">{child}</div>' for child in children]
    rows.append('<div class="group">Channels</div>')
    rows.append(f'<div class="item">{icon("Online Store")}<span>Online Store</span>{CHEVRON}</div>')
    return f'<div class="side"><div class="store"><span class="avatar">A</span>Alder &amp; Co.{CHEVRON}</div><div class="nav">{"".join(rows)}</div></div>'


def page(title, lede, body, deco=0, style=""):
    return (
        '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="listing.css">'
        + (f"<style>{style}</style>" if style else "")
        + "</head><body>"
        + DECOS[deco]
        + f'<div class="pill">{GLYPH}Digital Downloads <span class="x">&times;</span> Swell</div>'
        + f'<h1>{title}</h1><div class="lede">{lede}</div>'
        + body
        + PLACE
        + "</body></html>"
    )


# 1. The buyer's downloads page, styled like functions/lib/html.ts
DOWNLOADS_STYLE = """
.browser { height: 100%; background: #f6f6f4; }
.chrome { height: 52px; background: #fff; border-bottom: 1px solid var(--line); display: flex; align-items: center; padding: 0 20px; }
.lights span { display: inline-block; width: 13px; height: 13px; border-radius: 50%; margin-right: 7px; background: #e4e4e7; }
.url { margin: 0 auto; width: 720px; background: #f4f4f5; border-radius: 9px; padding: 8px 16px; font-size: 15px; color: var(--soft); display: flex; align-items: center; gap: 8px; }
.dl { width: 640px; margin: 0 auto; padding-top: 36px; color: #1d1d1b; font-size: 17px; line-height: 1.5; }
.dl .ph1 { display: inline-block; font-size: 27px; font-weight: 700; }
.dl .sub { color: #6b6b66; margin: 2px 0 22px; }
.dl .item { background: #fff; border: 1px solid #e4e4df; border-radius: 12px; padding: 22px; }
.dl .ph2 { font-size: 19px; font-weight: 700; }
.dl .variant { color: #6b6b66; font-weight: 400; margin-left: 8px; }
.dl .meta { display: inline-block; color: #6b6b66; font-size: 15px; margin-top: 4px; }
.dl ul { list-style: none; margin-top: 16px; }
.dl li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid #e4e4df; }
.dl .name { font-weight: 600; }
.dl .version, .dl .left { color: #6b6b66; font-size: 15px; margin-left: 8px; }
.dl .btn { background: #1d1d1b; color: #fff; border-radius: 8px; padding: 8px 16px; font-weight: 600; font-size: 16px; }
.dl .keys { margin-top: 16px; border-top: 1px solid #e4e4df; padding-top: 12px; }
.dl .ph3 { font-size: 15px; color: #6b6b66; font-weight: 600; margin-bottom: 8px; }
.dl code { display: block; font: 16px/1.4 ui-monospace, "SF Mono", Menlo, monospace; background: #f6f6f4; border: 1px solid #e4e4df; border-radius: 8px; padding: 9px 12px; }
"""

downloads_page = page(
    "Every order gets a <mark>private downloads page</mark>",
    "Buyers get an email after paying, with every file, link and license key they bought.",
    f"""
<div class="frame"><div class="browser">
  <div class="chrome"><div class="lights"><span></span><span></span><span></span></div>
    <div class="url">{LOCK}alder-co.swell.store/functions/&hellip;/downloads?order=6ac510b4&hellip;</div></div>
  <div class="dl">
    <div class="ph1" id="heading">Downloads for order 100482</div>
    <div class="sub">Keep this link private. Anyone who has it can use your downloads.</div>
    <div class="item">
      <div class="ph2">Film Presets Bundle<span class="variant">Lightroom Classic</span></div>
      <div class="meta" id="meta">Available until Oct 7, 2027</div>
      <ul>
        <li><div><span class="name">Film presets pack</span><span class="version">v2.1</span><span class="left">4 downloads left</span></div><span class="btn" id="download">Download</span></li>
        <li><div><span class="name">Install guide (PDF)</span><span class="left">5 downloads left</span></div><span class="btn">Download</span></li>
        <li><div><span class="name">Color grading masterclass</span><span class="left">5 downloads left</span></div><span class="btn">Open</span></li>
      </ul>
      <div class="keys"><div class="ph3">License key</div><code>7KQ2M-XW9PD-3HT8N-R4VBC</code></div>
    </div>
  </div>
</div></div>
<div class="callout" data-at="#heading" data-side="left"><b>1</b>Viewing never uses a download</div>
<div class="ring" id="ring-download" data-ring="#download"></div>
<div class="callout" data-at="#ring-download" data-side="right"><b>2</b>Each click gets a 5-minute link</div>
<div class="ring" id="ring-meta" data-ring="#meta" data-pad="5"></div>
<div class="callout" data-at="#ring-meta" data-side="left"><b>3</b>Download limits and expiry</div>
""",
    deco=0,
    style=DOWNLOADS_STYLE,
)

# 2. A product's Digital delivery tab, and the uploader from frontend/src/page.ts
PRODUCT_STYLE = """
.files td { vertical-align: top; }
.files .sub { color: var(--soft); font-size: 14px; margin-top: 2px; }
.files .muted { color: var(--soft); }
.limits { display: flex; gap: 18px; width: fit-content; margin-top: 20px; }
.limits > div { width: 180px; }
.license { margin-top: 22px; font-size: 16px; }
.drop { border: 2px dashed #d4d4d8; border-radius: 12px; padding: 22px 16px; text-align: center; margin-top: 20px; font-size: 16px; }
.drop .muted { color: var(--soft); font-size: 15px; margin-top: 2px; }
.upload .field-label { margin: 18px 0 6px; font-weight: 600; font-size: 15px; }
.progress { margin-top: 20px; }
.progress .track { height: 10px; background: #f4f4f5; border-radius: 5px; overflow: hidden; }
.progress .track div { height: 100%; width: 64%; background: #18181b; }
.progress .muted { color: var(--soft); font-size: 15px; margin-top: 8px; }
.uploaded { margin: 26px 0 8px; font-weight: 650; font-size: 16px; }
.uploaded-list div { display: flex; justify-content: space-between; padding: 10px 0; border-top: 1px solid var(--line); font-size: 15px; }
.uploaded-list span { color: var(--soft); }
"""

product_tab = page(
    "Files, links and <mark>license keys</mark> on any product",
    "Upload into your own S3 or R2 bucket, or link to Dropbox, Google Drive, Vimeo or Notion.",
    f"""
<div class="frame half-l"><div class="pad">
  <div class="crumb">&larr; Products</div>
  <div class="head"><div class="title">Film Presets Bundle</div><span class="button">Actions{CHEVRON}</span></div>
  <div class="tabs"><div>Details</div><div>Variants</div><div class="on app">Digital delivery</div><div>Reviews</div></div>
  <div class="card files">
    <div class="cardhead"><h3>Files and links</h3><span class="button small">New deliverable</span></div>
    <table>
      <tr><th>Name</th><th>Version</th><th>Variant</th></tr>
      <tr><td>Film presets pack<div class="sub">film-presets-v2.1.zip &middot; 405 MB</div></td><td>2.1</td><td class="muted">All variants</td></tr>
      <tr><td>Install guide (PDF)<div class="sub">install-guide.pdf &middot; 3.2 MB</div></td><td>1.0</td><td class="muted">All variants</td></tr>
      <tr><td>Color grading masterclass<div class="sub">https://vimeo.com/showcase/10482</div></td><td>&mdash;</td><td>Pro edition</td></tr>
    </table>
  </div>
  <div class="limits" id="limits">
    <div><div class="label">Downloads per item</div><div class="input">5</div></div>
    <div><div class="label">Access period (days)</div><div class="input">365</div></div>
  </div>
  <div class="license"><span class="toggle"></span>Give buyers a license key</div>
  <div class="limits" style="margin-top:14px">
    <div><div class="label">Keys come from</div><div class="input select">Use keys I import{CHEVRON}</div></div>
    <div><div class="label">Activations per key</div><div class="input">2</div></div>
  </div>
</div></div>
<div class="frame half-r"><div class="pad upload">
  <div class="crumb">&larr; Film Presets Bundle</div>
  <div class="title" style="margin-top:4px">Upload files for Film Presets Bundle</div>
  <div class="subtle">Buyers get these on their downloads page after paying.</div>
  <div class="drop"><b>film-presets-v2.2.zip</b><div class="muted">412 MB</div></div>
  <div class="field-label">Upload as</div>
  <div class="input select">Replace Film presets pack{CHEVRON}</div>
  <div class="progress" id="progress"><div class="track"><div></div></div><div class="muted">64% of 412 MB &middot; 38 MB/s</div></div>
  <div class="uploaded">Uploaded files</div>
  <div class="uploaded-list">
    <div>Film presets pack (film-presets-v2.1.zip)<span>405 MB</span></div>
    <div>Install guide (PDF) (install-guide.pdf)<span>3.2 MB</span></div>
  </div>
</div></div>
<div class="ring" id="ring-limits" data-ring="#limits" data-pad="8"></div>
<div class="callout" data-at="#ring-limits" data-side="right"><b>1</b>Limits per product</div>
<div class="ring" id="ring-progress" data-ring="#progress" data-pad="8"></div>
<div class="callout" data-at="#ring-progress" data-side="below end" data-gap="-14"><b>2</b>Big files go straight to your bucket</div>
""",
    deco=1,
    style=PRODUCT_STYLE,
)

# 3. An order's Digital delivery tab with the app's order actions
order_tools = page(
    "Stay in control of <mark>every order</mark>",
    "Resend, reset, extend or revoke access. Refunds and cancellations remove it on their own.",
    f"""
<div class="frame"><div class="dash">
  {sidebar("Orders", ["All orders", "Draft orders", "Carts", "Download access", "Download log"], "All orders")}
  <div class="main">
    <div class="crumb">&larr; Orders</div>
    <div class="head">
      <div><div class="title">Order 100482</div><div class="subtle">Maya Chen &middot; Paid Oct 7, 2:11 pm</div></div>
      <div class="buttons"><span class="button sq">&lsaquo;</span><span class="button sq">&rsaquo;</span><span class="button" id="actions">Actions{CHEVRON}</span></div>
    </div>
    <div class="tabs"><div>Details</div><div class="on app">Digital delivery</div><div>Activity</div></div>
    <div class="card" style="width:58%">
      <div class="field" id="access"><div class="label">Digital access</div><div class="value"><span class="tag green">Granted</span></div></div>
      <div class="field"><div class="label">Granted</div><div class="value">Oct 7, 2:12 pm</div></div>
      <div class="field"><div class="label">Downloads page</div><div class="value link">alder-co.swell.store/functions/&hellip;/downloads?order=6ac510b4&hellip;</div></div>
    </div>
    <div class="card">
      <h3>Download access</h3>
      <table>
        <tr><th>Product</th><th>Status</th><th>Downloads so far</th><th>Access until</th><th>Last download</th></tr>
        <tr><td>Film Presets Bundle</td><td><span class="tag green">Active</span></td><td>1</td><td>Oct 7, 2027</td><td>Oct 7, 2:14 pm</td></tr>
        <tr><td>Pro Plugin</td><td><span class="tag green">Active</span></td><td>2</td><td>&mdash;</td><td>Oct 7, 2:20 pm</td></tr>
      </table>
    </div>
  </div>
</div></div>
<div class="menu" data-at="#actions" data-side="below end" data-gap="8">
  <div class="mi">Cancel order</div><div class="mi">Resend order receipt</div><hr>
  <div id="app-actions"><div class="mi app">Resend downloads email</div><div class="mi app">Reset download counts</div><div class="mi app">Extend download access</div><div class="mi app danger">Revoke digital access</div></div>
</div>
<div class="ring" id="ring-actions" data-ring="#app-actions" data-pad="4"></div>
<div class="callout" data-at="#ring-actions" data-side="left end"><b>1</b>Fix buyer issues in a click</div>
<div class="ring" id="ring-access" data-ring="#access" data-pad="8"></div>
<div class="callout" data-at="#ring-access" data-side="right"><b>2</b>Refunds revoke access automatically</div>
""",
    deco=0,
)

# 4. The license keys list and a license API call
LICENSE_STYLE = """
.split { display: flex; height: 100%; }
.keys { flex: 1.3; padding: 24px 30px; min-width: 0; }
.keys td.mono { font-size: 14.5px; }
.code { flex: 1; background: #1e1b4b; color: #e0e7ff; padding: 30px 32px; font: 17px/1.6 ui-monospace, "SF Mono", Menlo, monospace; }
.code .h { font: 600 14px -apple-system, "SF Pro Text", sans-serif; letter-spacing: .4px; text-transform: uppercase; color: #c7d2fe; margin-bottom: 10px; }
.code pre { font: inherit; white-space: pre; margin-bottom: 28px; }
.code .c { color: #a5b4fc; }
.code .k { color: #fcd34d; }
.code .s { color: #86efac; }
"""


def key_row(key, product, status, order="&mdash;", expires="&mdash;"):
    tag = {"Available": "gray", "Assigned": "violet", "Revoked": "red"}[status]
    return f'<tr><td class="mono">{key}</td><td>{product}</td><td><span class="tag {tag}">{status}</span></td><td>{order}</td><td>{expires}</td></tr>'


license_keys = page(
    "License keys <mark>your software can check</mark>",
    "Activation limits, expiry and a low-stock email. Orders stop when imported keys run out.",
    f"""
<div class="frame"><div class="split">
  <div class="keys">
    <div class="head"><div class="title">License keys</div></div>
    <div class="tabs"><div class="on">All</div><div>Available</div><div>Assigned</div><div>Revoked</div></div>
    <table>
      <tr><th>Key</th><th>Product</th><th>Status</th><th>Order</th><th>Expires</th></tr>
      <tbody>
        {key_row("PRO-7H3NC-WD5RE-K9PZA", "Pro Plugin", "Assigned", "100482", "Oct 7, 2027")}
        {key_row("7KQ2M-XW9PD-3HT8N-R4VBC", "Film Presets Bundle", "Assigned", "100482")}
        {key_row("PRO-5TQ8W-BN4MV-R2DXJ", "Pro Plugin", "Assigned", "100471", "Sep 30, 2027")}
        {key_row("PRO-2GH6K-MT8WQ-C3NVF", "Pro Plugin", "Revoked", "100455")}
      </tbody>
      <tbody id="available">
        {key_row("PRO-8K2MX-QZ7TD-W4LNB", "Pro Plugin", "Available")}
        {key_row("PRO-3VJ9Q-HX2RT-M8CKE", "Pro Plugin", "Available")}
      </tbody>
    </table>
  </div>
  <div class="code" id="code">
    <div class="h">Your software asks</div>
<pre><span class="c">POST</span> /functions/digital_downloads/license-api
{{
  <span class="k">"action"</span>: <span class="s">"activate"</span>,
  <span class="k">"key"</span>: <span class="s">"PRO-7H3NC-WD5RE-K9PZA"</span>,
  <span class="k">"instance_id"</span>: <span class="s">"studio-mac"</span>
}}</pre>
    <div class="h">Swell answers</div>
<pre>{{
  <span class="k">"valid"</span>: true,
  <span class="k">"activated"</span>: true,
  <span class="k">"status"</span>: <span class="s">"active"</span>,
  <span class="k">"activation_limit"</span>: 2,
  <span class="k">"activations_used"</span>: 1,
  <span class="k">"date_expires"</span>: <span class="s">"2027-10-07T14:12:00Z"</span>
}}</pre>
  </div>
</div></div>
<div class="ring" id="ring-available" data-ring="#available" data-pad="4"></div>
<div class="callout" data-at="#ring-available" data-side="below start" data-gap="16"><b>1</b>Orders stop when these run out</div>
<div class="callout" data-at="#code" data-side="above end" data-gap="-24" data-dx="-28"><b>2</b>Validate, activate, deactivate</div>
""",
    deco=1,
    style=LICENSE_STYLE,
)

cover = f"""<!doctype html><html><head><meta charset="utf-8"><style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ width: 1200px; height: 630px; overflow: hidden; display: flex; align-items: center; gap: 70px; padding: 0 90px;
  font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
  background: linear-gradient(170deg, #ffffff 0%, #eceef4 100%); }}
svg {{ width: 320px; height: 320px; flex: none; filter: drop-shadow(0 8px 14px rgba(30,27,75,.18)); }}
h1 {{ font-size: 76px; font-weight: 800; letter-spacing: -2px; color: #1e1b4b; line-height: 1.02; }}
.bar {{ width: 128px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, #4f46e5, #f59e0b); margin: 24px 0; }}
p {{ font-size: 30px; color: #52556e; line-height: 1.35; max-width: 600px; }}
.pills {{ display: flex; gap: 14px; margin-top: 30px; }}
.pills span {{ border: 2px solid #6366f1; color: #4338ca; border-radius: 999px; padding: 9px 20px; font-size: 22px; }}
</style></head><body>
{GLYPH}
<div><h1>Digital<br>Downloads</h1><div class="bar"></div>
<p>Sell files, links and license keys, delivered right after payment.</p>
<div class="pills"><span>Private downloads</span><span>License keys</span><span>Your storage</span></div></div>
</body></html>"""

pages = {
    "1-private-downloads-page.html": downloads_page,
    "2-files-links-and-keys.html": product_tab,
    "3-control-every-order.html": order_tools,
    "4-license-keys.html": license_keys,
    "image.html": cover,
}

for name, html in pages.items():
    (HERE / name).write_text(html, encoding="utf-8")
    print("wrote", name)
