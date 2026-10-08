import { createMockRequest, type MockRequestOptions } from "./mock-request";
import { APP_ID, objectId, type FakeSwell } from "./fake-swell";

export const PATHS = {
  grants: `/apps/${APP_ID}/grants`,
  keys: `/apps/${APP_ID}/license-keys`,
  events: `/apps/${APP_ID}/download-events`,
  jobs: `/apps/${APP_ID}/notify-jobs`,
  deliverables: `/products:apps.${APP_ID}.deliverables`,
};

export const STORE = {
  id: "test-store",
  url: "https://shop.example.com",
  admin_url: "https://test-store.swell.store/admin",
};

export const STORAGE = {
  endpoint: "https://acct.r2.cloudflarestorage.com",
  bucket: "downloads",
  prefix: "digital-downloads/",
  access_key_id: "AKIDEXAMPLE",
  secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

export function request(fake: FakeSwell, options: MockRequestOptions = {}): SwellRequest {
  return createMockRequest({ store: STORE, appId: APP_ID, swell: fake.api, ...options });
}

export function seedProduct(
  fake: FakeSwell,
  values: {
    name?: string;
    type?: string;
    app?: Record<string, any>;
    deliverables?: Array<Record<string, any>>;
  } = {},
) {
  const product = fake.seed("/products", {
    name: values.name ?? "Photo Course",
    type: values.type ?? "standard",
    $app: { [APP_ID]: values.app ?? {} },
  });

  const deliverables = (values.deliverables ?? []).map((deliverable) =>
    fake.seed(PATHS.deliverables, { parent_id: product.id, source: "link", ...deliverable }),
  );

  return { product, deliverables };
}

export function seedOrder(
  fake: FakeSwell,
  items: Array<{ product_id: string; variant_id?: string; quantity?: number; product_name?: string }>,
  values: Record<string, any> = {},
) {
  return fake.seed("/orders", {
    number: "1001",
    account_id: objectId(),
    paid: true,
    grand_total: 49,
    items: items.map((item) => ({ id: objectId(), quantity: 1, ...item })),
    ...values,
  });
}

/** An order that has already been granted, with its access token. */
export function seedGrantedOrder(
  fake: FakeSwell,
  productId: string,
  options: { grant?: Record<string, any>; order?: Record<string, any> } = {},
) {
  const token = "test-token-0123456789abcdef";
  const order = seedOrder(fake, [{ product_id: productId, product_name: "Photo Course" }], {
    $app: { [APP_ID]: { access_token: token, access_status: "granted" } },
    ...options.order,
  });

  const grant = fake.seed(PATHS.grants, {
    order_id: order.id,
    item_id: order.items[0].id,
    account_id: order.account_id,
    product_id: productId,
    status: "active",
    download_limit: null,
    date_expires: null,
    ...options.grant,
  });

  return { order, grant, token };
}
