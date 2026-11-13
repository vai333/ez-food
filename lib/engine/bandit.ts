/**
 * Beta-Bernoulli bandit with Thompson sampling (build prompt §12.3). Hard constraints are applied BEFORE
 * this runs: the bandit only ever orders candidates that already passed the validator.
 */
export type Posterior = { alpha: number; beta: number; n: number };
export const PRIOR: Posterior = { alpha: 1, beta: 1, n: 0 };

export function update(p: Posterior | undefined, success: boolean, weight = 1): Posterior {
  const b = p ?? PRIOR;
  return { alpha: b.alpha + (success ? weight : 0), beta: b.beta + (success ? 0 : weight), n: b.n + 1 };
}

export const mean = (p: Posterior) => p.alpha / (p.alpha + p.beta);

/** Seedable PRNG (mulberry32) so tests and replays are deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Marsaglia–Tsang gamma sampler (shape ≥ 1; boosts smaller shapes). */
function gamma(shape: number, r: () => number): number {
  if (shape < 1) return gamma(shape + 1, r) * Math.pow(r(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = gaussian(r);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(p: Posterior, r: () => number): number {
  const x = gamma(p.alpha, r);
  const y = gamma(p.beta, r);
  return x / (x + y);
}

/**
 * Hierarchical back-off: when the context-specific posterior has little data, blend toward the global one.
 */
export function backoff(ctx: Posterior | undefined, global: Posterior | undefined, k = 5): Posterior {
  const g = global ?? PRIOR;
  if (!ctx) return g;
  const w = ctx.n / (ctx.n + k);
  return { alpha: w * ctx.alpha + (1 - w) * g.alpha, beta: w * ctx.beta + (1 - w) * g.beta, n: ctx.n };
}

/** Thompson-rank candidate keys. With probability epsilon, one random candidate is promoted to the top (exploration floor). */
export function thompsonRank<T>(items: T[], key: (t: T) => string, posteriors: Map<string, Posterior>, r: () => number, epsilon = 0.1, base?: (t: T) => number): T[] {
  const scored = items.map((it) => ({ it, s: sampleBeta(posteriors.get(key(it)) ?? PRIOR, r) + (base ? base(it) : 0) }));
  scored.sort((a, b) => b.s - a.s);
  if (scored.length > 1 && r() < epsilon) {
    const i = 1 + Math.floor(r() * (scored.length - 1));
    const [pick] = scored.splice(i, 1);
    scored.unshift(pick);
  }
  return scored.map((x) => x.it);
}
