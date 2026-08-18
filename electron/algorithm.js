const DEFAULT_ALGORITHM = {
  version: 3,
  cvaWarn: 52,
  cvaAlert: 46,
  cvaHardAlert: 38,
  pokeWarn: 0.28,
  pokeCva: 56,
  earFwdWarn: 0.24,
  earFwdAlert: 0.42,
  chinFwdWarn: 0.9,
  chinFwdAlert: 1.25,
  worldFwdWarn: 0.04,
  worldFwdAlert: 0.075,
  trunkWarn: 12,
  trunkAlert: 20,
  tiltLimit: 7.5,
  slopeLimit: 6.5,
  leanLimit: 8,
  tiltLimitSide: 9.5,
  slopeLimitSide: 8.5,
  leanLimitSide: 10,
  smoothAlpha: 0.2,
  smoothAlphaDown: 0.48,
  landmarkAlphaSide: 0.34,
  landmarkAlphaFront: 0.38,
};

function mergeAlgorithm(stored) {
  const next = { ...DEFAULT_ALGORITHM };
  if (!stored || typeof stored !== "object") return next;
  for (const key of Object.keys(DEFAULT_ALGORITHM)) {
    if (key === "version") continue;
    if (typeof stored[key] === "number" && Number.isFinite(stored[key])) next[key] = stored[key];
  }
  return next;
}

module.exports = { DEFAULT_ALGORITHM, mergeAlgorithm };
