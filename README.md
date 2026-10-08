# Digital Downloads

Sell files, links and license keys with Swell. After someone pays, they get an email and a private downloads page with everything they bought. You decide how many times each item can be downloaded and for how long, and you can change or remove access from the order at any time.

**Buyers never see where your files really live.** Every download goes through the downloads page, which checks the order is still paid and within its limits, counts the download, and only then sends the buyer on. Uploaded files get a link that stops working after 5 minutes, so a shared link is soon useless.

## Works with any storefront

The app adds no storefront of its own and needs none. The downloads page and email work for every order, whatever theme or storefront app you sell through. If you'd like a downloads section in the customer account, your theme can show the same links; see [Showing downloads in your theme](#showing-downloads-in-your-theme).

## Setup

1. **Set your defaults.** In Apps → Digital Downloads → Settings, under **Delivery**, choose how many downloads each item allows and for how many days. Leave either empty for no limit.
2. **Add what you sell.** Open a product and go to its **Digital delivery** tab. Under **Files and links**, choose **New deliverable** and paste a link: Dropbox, Google Drive, Vimeo, Notion, or any address that starts with `https://`. To give a file to buyers of one variant only, pick the variant; leave it empty to include the file with every variant.
3. **Optional: upload files.** To host files yourself instead of linking to them, connect a storage bucket under **File storage** (see below), then use **Actions → Upload files** on the product.
4. **Optional: license keys.** On the same tab, turn on **Give buyers a license key**, then either generate a random key for each purchase or sell keys you import.
5. **Place a test order.** Pay for it, open the email and the downloads page, and try a download.

### Connecting file storage

Uploaded files are stored in your own S3-compatible bucket: Amazon S3, Cloudflare R2, Backblaze B2 or Wasabi. They upload in 16 MB parts, so file size isn't limited, and the bucket needs no CORS rule. Cloudflare R2 is the cheapest choice for downloads because it doesn't charge for them.

1. Create a bucket, and an access key that can only reach one folder of it, allowing `PutObject`, `GetObject`, `AbortMultipartUpload` and `ListMultipartUploadParts`.
2. Fill in **File storage** in the app settings: the endpoint (leave it empty for Amazon S3), region, bucket, folder and access key. Save, then choose **Actions → Test connection**.

The settings page masks the secret key, but your admins can show it, so use a key limited to that folder.

## Selling license keys

- **Generated keys** are created at purchase, one per unit bought, using the key format on the product.
- **Imported keys** come from a list you paste in with **Actions → Import license keys**. They can be for any variant or for one variant only. When a product runs out, orders for it are stopped at checkout, and store admins get an email when the keys left reach the **Low key warning** level.
- Set **Activations per key** to limit how many devices or sites a key works on, and **Key valid for** to make keys expire.

Your software can check keys with the license API: `validate`, `activate` and `deactivate`. See the app guide for details.

## Subscriptions

Digital items on a subscription product stay available while the subscription is active. They pause if the subscription is paused or canceled and come back when it's active again. License keys for a subscription stay valid through the paid period and are extended at each renewal.

## Updating what you sell

Buyers always get your latest version: their access points at the deliverable, not at a copy of the file. Replace a file with **Upload files**, or edit a link, and everyone's existing downloads page uses the new one straight away. To tell past buyers, choose **Actions → Email past buyers about an update** on the product. You can add a note, and choose to reset their download counts so they can download the new version.

## Managing an order

The **Digital delivery** tab on each order shows its downloads link, what the buyer has downloaded and their license keys. The order's **Actions** menu can resend the downloads email, reset download counts, extend access, or revoke and later restore access. Canceling an order or refunding it in full removes access and stops its license keys validating on its own.

**Download access** and the **Download log** under Orders list every buyer's access and every download.

## Showing downloads in your theme

Each order's downloads link is available to the customer who placed it, as `$app.digital_downloads.downloads_url`, for example on an order history page. For a full downloads section, your theme can call `swell.functions.get("digital_downloads", "account-downloads")` for the signed-in customer's orders, items and keys. Link the download buttons to each order's downloads page, which checks and counts every download.

## Things worth knowing

- **Opening the downloads page never uses up a download.** Only the Download or Open buttons count, so email security scanners that open links can't use up a buyer's downloads.
- **Links are only as private as where they point.** After a buyer opens a link, they can see its address, as with any link. Use uploaded files for anything you want to protect.
- **One variant per file or link.** To include a file with two of a product's variants, add it once for each.
- **Links in test mode.** Downloads links open your store's live environment, so links for test-mode orders won't open in a browser. Check test orders from the order's Digital delivery tab instead.
- **Update emails go out in batches** of about 30 every 5 minutes.

## Support

Email [support@swell.is](mailto:support@swell.is).
