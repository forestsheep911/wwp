import dns from "node:dns";

export function installNotionDnsOverride(ip, {
  lookup = dns.lookup.bind(dns),
  setLookup = (value) => { dns.lookup = value; }
} = {}) {
  if (!ip) return false;
  setLookup((hostname, options, callback) => {
    if (hostname !== "api.notion.com") return lookup(hostname, options, callback);
    if (typeof options === "function") return options(null, ip, 4);
    if (options?.all) return callback(null, [{ address: ip, family: 4 }]);
    return callback(null, ip, 4);
  });
  return true;
}
