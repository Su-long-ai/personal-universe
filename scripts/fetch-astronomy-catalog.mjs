import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const query = `
select top 400
  hostname,ra,dec,sy_dist,st_spectype,st_teff,st_mass,st_rad,
  pl_name,pl_orbsmax,pl_rade,pl_bmasse,pl_eqt
from pscomppars
where sy_dist is not null
  and ra is not null
  and dec is not null
order by sy_dist asc
`.replace(/\s+/g, " ").trim();

const url = new URL("https://exoplanetarchive.ipac.caltech.edu/TAP/sync");
url.searchParams.set("query", query);
url.searchParams.set("format", "json");

const response = await fetch(url, {
  headers: {
    "User-Agent": "personal-universe-catalog-refresh/1.0",
    "Accept": "application/json",
  },
});

if (!response.ok) {
  throw new Error(`NASA Exoplanet Archive request failed: ${response.status} ${response.statusText}`);
}

const rows = await response.json();
const byHost = new Map();

for (const row of rows) {
  const hostname = row.hostname;
  if (!hostname) continue;

  let host = byHost.get(hostname);
  if (!host) {
    host = {
      hostname,
      raDeg: Number(row.ra),
      decDeg: Number(row.dec),
      distancePc: Number(row.sy_dist),
      spectralType: row.st_spectype || null,
      temperatureK: finiteOrNull(row.st_teff),
      massSolar: finiteOrNull(row.st_mass),
      radiusSolar: finiteOrNull(row.st_rad),
      planets: [],
    };
    byHost.set(hostname, host);
  }

  host.planets.push({
    name: row.pl_name || `${hostname} ?`,
    orbitAU: finiteOrNull(row.pl_orbsmax),
    radiusEarth: finiteOrNull(row.pl_rade),
    massEarth: finiteOrNull(row.pl_bmasse),
    equilibriumTempK: finiteOrNull(row.pl_eqt),
  });
}

const systems = [...byHost.values()]
  .filter((host) =>
    Number.isFinite(host.raDeg) &&
    Number.isFinite(host.decDeg) &&
    Number.isFinite(host.distancePc),
  )
  .slice(0, 64);

const payload = {
  generatedAt: new Date().toISOString(),
  source: "NASA Exoplanet Archive TAP / pscomppars",
  sourceUrl: "https://exoplanetarchive.ipac.caltech.edu/",
  systems,
};

const output = resolve(process.cwd(), "src/data/exoplanet-hosts.json");
await writeFile(output, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`Wrote ${systems.length} nearby observed host systems to ${output}`);

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
