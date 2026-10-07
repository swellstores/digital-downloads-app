import { vi } from "vitest";

/**
 * In-memory stand-in for the parts of the Swell API this app uses: record
 * reads and writes by path, `where` with $in/$gt/$ne/$or/$and, `$inc`/`$set`/
 * `$app` writes, unique checks, and `$notify` capture. Unsupported operators
 * throw so tests can't pass by accident.
 */

export const APP_ID = "digital_downloads";
export const APP_OBJECT_ID = "6ac0000000000000000000aa";

type Doc = { id: string; [key: string]: any };

export interface SentNotification {
  path: string;
  id: string;
  data?: Record<string, any>;
}

export interface FakeSwell {
  api: SwellAPI;
  seed(collection: string, record: Record<string, any>): Doc;
  all(collection: string): Doc[];
  find(collection: string, id: string): Doc | undefined;
  notifications: SentNotification[];
}

let counter = 0;

export function objectId(): string {
  counter++;
  return counter.toString(16).padStart(24, "0");
}

function getPath(object: any, path: string): any {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPath(object: any, path: string, value: unknown) {
  const keys = path.split(".");
  let pointer = object;

  for (const key of keys.slice(0, -1)) {
    pointer[key] ??= {};
    pointer = pointer[key];
  }

  pointer[keys.at(-1)!] = value;
}

function deepMerge(target: any, source: any): any {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] ?? {}, value);
    } else {
      target[key] = value;
    }
  }

  return target;
}

export function matches(record: any, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "$or") {
      return condition.some((part: any) => matches(record, part));
    }

    if (key === "$and") {
      return condition.every((part: any) => matches(record, part));
    }

    const value = getPath(record, key);

    if (condition === null) {
      return value === null || value === undefined;
    }

    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      return Object.entries(condition).every(([operator, argument]: [string, any]) => {
        switch (operator) {
          case "$in":
            return argument.includes(value);
          case "$gt":
            return value > argument;
          case "$ne":
            return argument === null ? value !== null && value !== undefined : value !== argument;
          case "$exists":
            // As in MongoDB, a field stored as null exists
            return (argument === true || argument === "true") === (value !== undefined);
          default:
            throw new Error(`fake swell: unsupported operator ${operator}`);
        }
      });
    }

    return value === condition;
  });
}

/**
 * Function GET queries travel as query strings, where null becomes the string
 * "null" and matches nothing, so a null in a query is a bug.
 */
function assertNoNull(value: unknown, path = "where") {
  if (value === null) {
    throw new Error(`fake swell: ${path} is null; use $exists instead`);
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertNoNull(child, `${path}.${key}`);
    }
  }
}

const UNIQUE: Record<string, string[][]> = {
  [`/apps/${APP_ID}/license-keys`]: [["key"]],
  [`/apps/${APP_ID}/grants`]: [["item_id", "order_id"]],
};

function uniqueError(field: string) {
  return Object.assign(new Error(`${field} must be unique`), {
    status: 400,
    body: { [field]: { code: "UNIQUE", message: "Must be unique" } },
  });
}

export function createFakeSwell(options: { settings?: Record<string, any> } = {}): FakeSwell {
  const db = new Map<string, Doc[]>();
  const notifications: SentNotification[] = [];

  const collection = (path: string) => {
    if (!db.has(path)) {
      db.set(path, []);
    }
    return db.get(path)!;
  };

  const split = (url: string): [string, string | null] => {
    const match = url.match(/^(.*)\/([0-9a-f]{24})$/i);
    return match ? [match[1], match[2]] : [url, null];
  };

  const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

  function seed(path: string, record: Record<string, any>): Doc {
    const doc = { id: objectId(), date_created: new Date().toISOString(), ...clone(record) } as Doc;
    collection(path).push(doc);
    return doc;
  }

  const api = {
    get: vi.fn(async (url: string, query: Record<string, any> = {}) => {
      if (url.startsWith("/settings/")) {
        return { id: APP_OBJECT_ID };
      }

      const [path, id] = split(url);

      if (id) {
        return clone(collection(path).find((doc) => doc.id === id) ?? null);
      }

      assertNoNull(query.where);

      let results = collection(path).filter((doc) => matches(doc, query.where));

      if (query.sort) {
        const [field, direction] = String(query.sort).split(" ");
        results = [...results].sort((a, b) =>
          (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === "desc" ? -1 : 1),
        );
      }

      return { count: results.length, results: clone(results.slice(0, query.limit ?? 15)) };
    }),

    post: vi.fn(async (url: string, data: Record<string, any>) => {
      for (const fields of UNIQUE[url] ?? []) {
        if (collection(url).some((doc) => fields.every((field) => doc[field] === data[field]))) {
          throw uniqueError(fields[0]);
        }
      }

      return clone(seed(url, data));
    }),

    put: vi.fn(async (url: string, data: Record<string, any>) => {
      const [path, id] = split(url);
      const doc = collection(path).find((candidate) => candidate.id === id);

      if (!doc) {
        throw Object.assign(new Error(`Not found: ${url}`), { status: 404 });
      }

      for (const [key, value] of Object.entries(data)) {
        if (key === "$notify") {
          notifications.push({ path: url, ...(value as { id: string }) });
        } else if (key === "$inc") {
          for (const [field, amount] of Object.entries(value as Record<string, number>)) {
            setPath(doc, field, (getPath(doc, field) ?? 0) + amount);
          }
        } else if (key === "$set") {
          for (const [field, replacement] of Object.entries(value as Record<string, unknown>)) {
            setPath(doc, field, clone(replacement));
          }
        } else if (key === "$app") {
          doc.$app = deepMerge(doc.$app ?? {}, clone(value));
        } else if (key.startsWith("$")) {
          throw new Error(`fake swell: unsupported update operator ${key}`);
        } else {
          doc[key] = clone(value);
        }
      }

      return clone(doc);
    }),

    delete: vi.fn(async () => {
      throw new Error("fake swell: delete is not used by this app");
    }),

    // Like the real record, settings carry the installed app's id
    settings: vi.fn(async () => ({ id: APP_OBJECT_ID, ...clone(options.settings ?? {}) })),
  };

  return {
    api: api as unknown as SwellAPI,
    seed,
    all: (path) => collection(path),
    find: (path, id) => collection(path).find((doc) => doc.id === id),
    notifications,
  };
}
