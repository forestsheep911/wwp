const ROUTES = Object.freeze({
  direct: ["DIRECT", "国内直连", "Notion"],
  "jms-s801": ["JMS London s801 - Reality", "JMS London 节点", "Notion"]
});

function containsOrderedChain(actual, expected) {
  if (actual.length < expected.length) return false;
  for (let start = 0; start <= actual.length - expected.length; start += 1) {
    if (expected.every((value, offset) => actual[start + offset] === value)) return true;
  }
  return false;
}

export function supportedNotionUploadRoutes() {
  return Object.keys(ROUTES);
}

export function evaluateNotionUploadRoute(connections, expectedRoute) {
  const expectedChain = ROUTES[expectedRoute];
  if (!expectedChain) throw new Error(`Unsupported Notion upload route: ${expectedRoute}`);

  const observedChains = (connections ?? [])
    .map((connection) => Array.isArray(connection?.chains) ? connection.chains.map(String) : [])
    .filter((chain) => chain.length > 0);
  const matchingChains = observedChains.filter((chain) => containsOrderedChain(chain, expectedChain));
  const unexpectedChains = observedChains.filter((chain) => !containsOrderedChain(chain, expectedChain));

  return {
    expectedRoute,
    expectedChain,
    observedChains,
    matchingChains,
    unexpectedChains,
    accepted: matchingChains.length > 0 && unexpectedChains.length === 0,
    reason: observedChains.length === 0
      ? "no_clash_route_evidence"
      : matchingChains.length === 0
        ? "expected_chain_not_observed"
        : unexpectedChains.length > 0
          ? "mixed_or_unexpected_chain"
          : "accepted"
  };
}

export function requireNotionUploadRoute(connections, expectedRoute) {
  const result = evaluateNotionUploadRoute(connections, expectedRoute);
  if (!result.accepted) {
    const observed = result.observedChains.length
      ? result.observedChains.map((chain) => chain.join(" -> ")).join("; ")
      : "none";
    throw new Error(
      `Notion upload route rejected (${result.reason}). Expected ${result.expectedChain.join(" -> ")}; observed ${observed}.`
    );
  }
  return result;
}
