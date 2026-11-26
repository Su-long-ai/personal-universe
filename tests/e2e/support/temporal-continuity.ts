// Work in a physically meaningful scalar coordinate (e.g. log-distance for
// astronomical zoom, unwrapped angle for rotation, arc length for dragging).
// Include the measured start and final samples; do not infer the path from UI intent.
export function measureTemporalContinuity(samples: number[]) {
  if (samples.length < 2 || !samples.every(Number.isFinite)) {
    throw new Error("Expected finite rendered samples including both endpoints");
  }
  const start = samples[0];
  const end = samples[samples.length - 1];
  const total = Math.abs(end - start);
  if (total === 0) throw new Error("Rendered trajectory did not move");
  const direction = Math.sign(end - start);
  const slack = total * 1e-5;
  const steps = samples.slice(1).map((sample, i) => direction * (sample - samples[i]));
  const interior = samples.filter((sample) =>
    direction * (sample - start) > slack && direction * (end - sample) > slack);
  return {
    monotonic: steps.every((step) => step >= -slack),
    intermediatePositions: new Set(interior).size,
    largestStepFraction: Math.max(...steps.map(Math.abs)) / total,
  };
}
