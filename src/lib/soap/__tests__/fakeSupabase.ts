// Минимальная табличная заглушка Supabase-клиента для тестов route-хендлеров.
// Поддерживает select/eq/in/order/limit/maybeSingle/single/insert/update — ровно то, что нужно роутам SOAP.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FakeDb {
  tables: Record<string, any[]>;
  inserted: Record<string, any[]>;
  updated: Record<string, Array<{ filters: Array<[string, unknown]>; patch: any }>>;
}

export function makeFakeSupabase(tables: Record<string, any[]>, userId: string | null = "user-1") {
  const db: FakeDb = { tables, inserted: {}, updated: {} };
  let seq = 0;

  function builder(table: string) {
    const filters: Array<[string, unknown]> = [];
    let inFilter: [string, unknown[]] | null = null;
    let mode: "select" | "insert" | "update" = "select";
    let payload: any;

    function matching(): any[] {
      return (db.tables[table] ?? []).filter(
        r => filters.every(([k, v]) => r[k] === v) && (!inFilter || inFilter[1].includes(r[inFilter[0]]))
      );
    }
    function run(): any[] {
      if (mode === "insert") {
        seq += 1;
        const row = { id: `${table}-${seq}`, ...payload };
        (db.tables[table] ??= []).push(row);
        (db.inserted[table] ??= []).push(row);
        return [row];
      }
      if (mode === "update") {
        const rows = matching();
        rows.forEach(r => Object.assign(r, payload));
        (db.updated[table] ??= []).push({ filters: [...filters], patch: payload });
        return rows;
      }
      return matching();
    }
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      in: (k: string, v: unknown[]) => ((inFilter = [k, v]), b),
      order: () => b,
      limit: () => b,
      insert: (row: any) => ((mode = "insert"), (payload = row), b),
      update: (patch: any) => ((mode = "update"), (payload = patch), b),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: any[]; error: null }) => void) => resolve({ data: run(), error: null }),
    };
    return b;
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => builder(table),
  };
  return { client, db };
}
