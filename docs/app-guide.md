# Digital Downloads

Digital Downloads lets you sell files, links and license keys in your Swell store. After someone pays, they get an email and a private downloads page with everything they bought. You set how many times each item can be downloaded and for how long, and you can change or remove access from the order at any time.

## How it works

| When | What the app does |
|---|---|
| An order is paid, or placed for free | Gives each digital item its access, issues license keys, and emails the buyer a link to their downloads page |
| The buyer opens the downloads page | Lists their files, links and keys, with downloads left and the access period. Opening the page doesn't count as a download |
| The buyer chooses Download or Open | Checks the order isn't canceled or refunded, and that the item is within its limits. Counts and logs the download, then sends the buyer to the file (through a link that expires after 5 minutes) or to the link |
| The order is canceled or fully refunded | Removes access and stops its license keys validating |
| A subscription is paused or canceled | Pauses access to the subscription's downloads until it's active again |
| You replace a file or edit a link | Every past buyer's downloads page uses the new version |

## Before you begin

- To sell links, you need nothing else.
- To upload files, you need a bucket in Amazon S3, Cloudflare R2, Backblaze B2 or Wasabi, and an access key for it. Cloudflare R2 doesn't charge for downloads, which makes it the cheapest choice.
- Downloads links in emails open your store's live environment. Use a live order to try the whole flow in a browser.

## Set up

1. Install Digital Downloads from the App Store.
2. In **Apps → Digital Downloads → Settings**, under **Delivery**, set **Downloads per item** and **Access period (days)**. Leave either empty for no limit.
3. Open a product and go to its **Digital delivery** tab. Under **Files and links**, choose **New deliverable**, give it a name, and paste a link that starts with `https://`. Leave **Variant** empty to include it with every variant.
4. Optional: to give buyers a license key, turn on **Give buyers a license key** on the same tab.
5. Optional: to upload files, connect a bucket under **File storage**. See [Uploading files](#uploading-files).
6. Place a test order on your live store, pay for it, and open the downloads email.

## Using Digital Downloads

### Adding files and links

Each product's **Digital delivery** tab lists its files and links. A link can go anywhere that starts with `https://`: Dropbox, Google Drive, Vimeo, Notion, a course platform or your own site. To give a file or link to one variant only, choose the variant. To include it with two variants, add it once for each.

**Downloads per item** and **Access period (days)** on the tab override the app's defaults for that product.

### Uploading files

1. Create a bucket, and an access key limited to one folder of it, allowing `PutObject`, `GetObject`, `AbortMultipartUpload` and `ListMultipartUploadParts`.
2. Under **File storage** in the app settings, fill in the endpoint (like `https://s3.us-west-2.amazonaws.com`; the region is read from it), bucket, folder and access key, and save.
3. Choose **Actions → Test connection** to check the key works.
4. On a product, choose **Actions → Upload files**. Drop in a file, give it a name, and upload. To replace an existing file, choose it under **Upload as**.

Files upload to your bucket in 16 MB parts, so large files are fine, and the bucket needs no CORS rule. The settings page masks the secret key, but admins can show it.

### Selling license keys

Turn on **Give buyers a license key** on a product, then choose where keys come from:

- **Generate a random key for each purchase.** Each X in **Key format** becomes a random letter or digit. Use at least 16 Xs; a shorter format falls back to the default, `XXXXX-XXXXX-XXXXX-XXXXX`.
- **Use keys I import.** Choose **Actions → Import license keys** and paste one key per line, for any variant or one variant. Orders are stopped at checkout when a product runs out. Store admins get an email when the keys left reach the **Low stock alert for imported keys** level, and if an order is left without keys.

**Activations per key** limits how many devices or sites a key works on. **Key valid for (days)** makes keys expire. One key is issued per unit bought.

If an order was left without keys because the imported keys ran out, import more keys, then choose **Actions → Resend downloads email** on the order. The email includes the new keys.

### Subscriptions

Files and links on a subscription product stay available while the subscription is active. They pause if the subscription is paused or canceled and come back when it's active again. Renewal orders don't create new access or keys. Subscription keys stay valid through the paid period and are extended at each renewal.

### Releasing an update

Replace the file with **Upload files**, or edit the link. Every past buyer's downloads page uses the new version straight away. To tell them, choose **Actions → Email past buyers about an update** on the product, add an optional note, and choose whether to reset their download counts. Emails go out in batches of about 30 every 5 minutes.

### Managing an order

An order's **Digital delivery** tab shows its downloads link, each item's access and downloads, and its license keys. From the order's **Actions** menu you can:

- **Resend downloads email**
- **Reset download counts**, giving the buyer their full number of downloads again
- **Extend download access** by a number of days
- **Revoke digital access**, which also stops its license keys validating, and **Restore digital access** later

Canceling an order or refunding it in full revokes access automatically. For a partial refund, revoke access from the order if you need to. **Orders → Download access** lists every buyer's access, and **Orders → Download log** lists every download with its IP address and browser.

## Settings

| Setting | What it does |
|---|---|
| Downloads per item | Downloads allowed for each file or link in a purchase. Empty means unlimited |
| Access period (days) | Days after purchase that downloads stay available. Empty means no limit |
| Low stock alert for imported keys | Admins are emailed to import more when a product has this many unsold imported keys left. Defaults to 10. Generated keys never run out |
| Endpoint | The bucket's S3 API address. The region is read from it. Empty means Amazon S3 in us-east-1 |
| Bucket | The bucket's name |
| Folder | The folder uploads go into. Defaults to `digital-downloads/` |
| Access key ID, Secret access key | The key the app uploads and signs downloads with |

## Limitations

- After a buyer opens a link, they can see its address, as with any link. Use uploaded files for anything you want to keep private.
- Each file or link belongs to every variant or to one variant.
- Downloads links open the live environment, so links for test-mode orders won't open in a browser.
- Update emails go out at about 30 every 5 minutes.
- Activation limits are checked as each activation is recorded, so two activations at the same instant can go one over the limit.

## Troubleshooting

| Problem | What to check |
|---|---|
| The buyer didn't get an email | Check the order is paid. Choose **Actions → Resend downloads email** on the order |
| "This link isn't valid" | The link is incomplete. Resend the downloads email from the order |
| "This download isn't set up correctly" | The link doesn't start with `https://`, or the bucket settings are missing. Check the deliverable and **File storage** |
| An order is missing license keys | The imported keys ran out. Import more, then resend the downloads email from the order |
| A buyer has used all their downloads | Choose **Actions → Reset download counts** on the order |

## Uninstalling

Uninstalling stops new orders getting access, and existing downloads links stop working. Files you uploaded stay in your bucket. Access records, license keys and the download log stay on your store's records.

## For developers

**Order fields.** `$app.digital_downloads.downloads_url` is the order's private downloads page, readable by the customer who placed the order through the storefront API. `access_status` is `granted` or `revoked`. If another app saves the order at the same moment, these order fields can be missing; the account route below always returns the link.

**Account route.** `GET /functions/digital_downloads/account-downloads`, called with `swell.functions.get("digital_downloads", "account-downloads")`, returns the signed-in customer's orders with their items, downloads left and license keys. Link download buttons to the order's `downloads_url`.

**License API.** `POST https://<store-id>.swell.store/functions/digital_downloads/license-api`, with your store's public key in the `Authorization` header and a JSON body:

| `action` | Body | Response |
|---|---|---|
| `validate` | `{ key }` | `valid`, `status` (`active`, `revoked`, `expired` or `suspended`), `activations_used`, `activation_limit`, `date_expires` |
| `activate` | `{ key, instance_id, name? }` | Records the device or site. Activating the same `instance_id` again changes nothing. Returns 409 `activation_limit` when the key is full |
| `deactivate` | `{ key, instance_id }` | Frees that activation |

Errors return `valid: false` with `error` and `message`.

**Collections.** `apps/digital_downloads/grants` holds each order item's access, `license-keys` the keys, and `download-events` the download log.

## Support

Email [support@swell.is](mailto:support@swell.is).
