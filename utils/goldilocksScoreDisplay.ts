import { GOLDILOCKS_STRATEGY_VERSION } from "./goldilocksConfig";

const semanticVersionNumber = (strategyVersion?: string) => {
  const match = strategyVersion?.match(/^0\.(\d+)$/);
  return Number(match?.[1] ?? 0);
};

export const goldilocksScoreContractVersionNumber = (
  strategyVersion?: string,
) => {
  const legacy = strategyVersion?.match(/^h1-m15-m5-v(\d+)$/);
  if (legacy) return Number(legacy[1]);

  const semantic = semanticVersionNumber(strategyVersion);
  if (semantic) return semantic;

  // Research timeframe profiles use the current scoring contract even though
  // their independent detector label ends in research-vN.
  if (/^(?:m15-m5-m1|d1-h4-h1)-research-v\d+$/.test(strategyVersion ?? "")) {
    return semanticVersionNumber(GOLDILOCKS_STRATEGY_VERSION);
  }

  return 0;
};

const usesConfluenceHeavyWeights = (strategyVersion?: string) => {
  const version = goldilocksScoreContractVersionNumber(strategyVersion);
  return version ? version >= 16 : true;
};

export const goldilocksScoreComponentMaximum = (
  name: string,
  strategyVersion?: string,
) => {
  if (name.endsWith(" range")) return 0;
  if (name.endsWith(" trend"))
    return usesConfluenceHeavyWeights(strategyVersion) ? 3 : 4;
  if (name.endsWith(" departure quality")) {
    const version = goldilocksScoreContractVersionNumber(strategyVersion);
    return version >= 23 ? 4 : version === 22 ? 5 : 8;
  }
  if (name.endsWith(" approach warnings")) {
    const version = goldilocksScoreContractVersionNumber(strategyVersion);
    return version >= 23 ? 5 : version === 22 ? 4 : 3;
  }
  if (name.endsWith(" purity")) return 4;
  if (name === "Available RRR") return 1;
  if (name === "Zone inside zone")
    return usesConfluenceHeavyWeights(strategyVersion) ? 4 : 3;
  return null;
};
