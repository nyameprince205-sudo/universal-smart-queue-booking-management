function toJSONSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value;
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
module.exports = {
  toJSONSafe
};