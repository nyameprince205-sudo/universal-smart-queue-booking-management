// Recursively converts every BigInt anywhere in an object or array into a
// string, so the result is safe to hand to res.json() — which has no
// built-in support for BigInt and throws "Do not know how to serialize a
// BigInt" the moment it finds one, no matter how deeply nested.
//
// Why this exists: hand-converting each BigInt field one at a time (what
// this codebase originally did, e.g. `id: org.id.toString()`) is exactly
// the kind of thing that's easy to miss ONE of — which is precisely what
// happened here: a nested relation (organization_settings) had TWO BigInt
// fields (`id` and `organizationId`), and the first fix only caught one of
// them. Reach for this instead of manually listing fields whenever a
// response includes any relation via `include` that you haven't restricted
// with `select` down to plain strings/numbers.
function toJSONSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value; // dates serialize fine on their own — don't stringify them early
  if (Array.isArray(value)) return value.map(toJSONSafe);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = toJSONSafe(val);
    }
    return result;
  }
  return value;
}

module.exports = { toJSONSafe };
