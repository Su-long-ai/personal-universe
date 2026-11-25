import assert from "node:assert/strict";
import test from "node:test";

import { SOLAR_SYSTEM } from "../src/vendor/yeis/data/solarSystem.ts";
import { surfaceModeForYeisBody } from "../src/lib/universe/yeis/bridge.ts";

function body(id: string) {
  const match = SOLAR_SYSTEM.find((candidate) => candidate.id === id);
  assert.ok(match, `missing YEIS solar-system body: ${id}`);
  return match;
}

test("YEIS terrestrial secondary bodies expose the shared Surface capability", () => {
  const earth = body("earth");
  const mercury = body("mercury");

  assert.equal(
    surfaceModeForYeisBody(earth, earth.temperature ?? 288),
    "surface-terrain",
  );
  assert.equal(
    surfaceModeForYeisBody(mercury, mercury.temperature ?? 440),
    "surface-terrain",
  );
});

test("YEIS giant bodies remain non-landable", () => {
  const jupiter = body("jupiter");
  const neptune = body("neptune");

  assert.equal(
    surfaceModeForYeisBody(jupiter, jupiter.temperature ?? 165),
    "none",
  );
  assert.equal(
    surfaceModeForYeisBody(neptune, neptune.temperature ?? 72),
    "none",
  );
});
