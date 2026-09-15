// Used only by the standalone fixture config; no production auth or network.
export function getSupabaseBrowserClient() {
  const query = {
    select: () => query, eq: () => query, gte: () => query, lt: () => query, neq: () => query,
    order: () => Promise.resolve({ data: [], error: null }),
  };
  return { from: () => query };
}
