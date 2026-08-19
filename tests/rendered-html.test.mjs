import assert from "node:assert/strict";
import test from "node:test";

async function application() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return {
    fetch(path, accept = "text/html") {
      return worker.fetch(
        new Request(`http://localhost${path}`, { headers: { accept } }),
        { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
        { waitUntil() {}, passThroughOnException() {} },
      );
    },
  };
}

test("renders a search-focused homepage with canonical and social metadata", async () => {
  const app = await application();
  const response = await app.fetch("/");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<h1[^>]*>Two-photon lithography, made visible\.<\/h1>/);
  assert.match(html, /href="\/lab"/);
  assert.match(html, /href="\/guides\/parameters"/);
  assert.match(html, /class="focal-cone"/);
  assert.doesNotMatch(html, /focal-cone-(?:left|right)/);
  assert.match(html, /class="site-mark"/);
  assert.match(
    html,
    /<a(?=[^>]*href="https:\/\/github\.com\/bertona88\/twophotonlithography")(?=[^>]*target="_blank")(?=[^>]*rel="noreferrer")[^>]*>\s*View source on GitHub/,
  );
  assert.match(
    html,
    /<a(?=[^>]*href="https:\/\/wofi\.ai\/ideas\/sha256%3A182f6bf27b400b724d6e77e5a7d10d1d402dede3b5dbcaebb979a897bf74ad2e")(?=[^>]*target="_blank")(?=[^>]*rel="noreferrer")[^>]*>\s*WOFI Idea/,
  );
  assert.match(html, /href="\/wofi\.json">Provenance<\/a>/);
  assert.match(html, /href="\/LICENSE\.txt">License<\/a>/);
  assert.match(html, /rel="canonical" href="https:\/\/twophotonlithography\.com\/"/);
  assert.match(html, /property="og:image" content="https:\/\/twophotonlithography\.com\/og\.png"/);
  assert.match(html, /"@type":"WebApplication"/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /lab-interface|simulation\.worker|lab-viewport/);
});

test("renders the guide index and distinct terminology guides", async () => {
  const app = await application();
  for (const [path, patterns] of [
    ["/guides", [/Follow the light into matter/, /Multiphoton lithography/, /Parameter atlas/]],
    ["/guides/two-photon-lithography", [/What is two-photon lithography/, /Two-photon polymerization/, /TPL, 2PP and TPP/]],
    ["/guides/multiphoton-lithography", [/Multiphoton lithography/, /General multiphoton source/, /Two-photon polymerization/]],
    ["/guides/direct-laser-writing", [/Direct laser writing vs two-photon lithography/, /Femtosecond does not automatically mean two-photon/]],
    ["/guides/model-space", [/Models of two-photon lithography/, /Reaction–diffusion/, /Current lab/]],
  ]) {
    const response = await app.fetch(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    for (const pattern of patterns) assert.match(html, pattern, path);
    assert.match(html, /"@type":"Article"/, path);
    assert.match(html, new RegExp(`rel="canonical" href="https:\\/\\/twophotonlithography\\.com${path.replaceAll("/", "\\/")}"`), path);
  }
});

test("renders all parameter families and their evidence boundaries", async () => {
  const app = await application();
  const response = await app.fetch("/guides/parameters");
  assert.equal(response.status, 200);
  const html = await response.text();

  for (const pattern of [
    /27 live controls/,
    /Layer height/,
    /Specimen power/,
    /PI absorption peak/,
    /Numerical aperture/,
    /Boundary oxygen/,
    /Bimolecular termination/,
    /Gel resistance/,
    /Development time/,
    /Process input/,
    /Literature-shaped/,
    /Exploratory/,
  ]) assert.match(html, pattern);
});

test("renders the lab separately and keeps model evidence links", async () => {
  const app = await application();
  const labResponse = await app.fetch("/lab");
  assert.equal(labResponse.status, 200);
  const labHtml = await labResponse.text();
  assert.match(labHtml, /Micro‑Benchy/);
  assert.match(labHtml, /CreativeTools 3DBenchy/);
  assert.match(labHtml, /\/method#chemistry/);
  assert.match(labHtml, /lab-interface-[\w-]+\.js/);
  assert.match(
    labHtml,
    /<a(?=[^>]*href="\/")(?=[^>]*aria-label="Two-Photon Lithography Lab home")[^>]*>/,
  );

  const methodResponse = await app.fetch("/method");
  assert.equal(methodResponse.status, 200);
  const methodHtml = await methodResponse.text();
  assert.match(methodHtml, /How the two-photon lithography model works/);
  assert.match(methodHtml, /Where the power is calculated/);
  assert.match(methodHtml, /https:\/\/doi\.org\/10\.1098\/rspa\.1959\.0200/);
  assert.match(methodHtml, /href="\/lab"/);
  assert.match(methodHtml, /"@type":"Article"/);
});

test("server-renders a validated OpticalSetup laser handoff", async () => {
  const app = await application();
  const response = await app.fetch(
    "/lab?from=opticalsetup&v=1&wavelengthNm=920&sourcePowerMw=24&repetitionRateMHz=80&pulseDurationFs=120&numericalAperture=0.01",
  );
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /Imported 5 compatible setup parameters from OpticalSetup/);
  assert.match(html, /Source power and pulse duration were copied into specimen-plane controls/);
  assert.match(html, /NA was copied from the single objective traced to the sample/);
  assert.match(html, /optical model assumes circular polarization/);
  assert.match(html, /aria-label="Wavelength numeric value"[^>]*value="920"/);
  assert.match(html, /aria-label="Specimen power numeric value"[^>]*value="24"/);
  assert.match(html, /aria-label="Repetition rate numeric value"[^>]*value="80"/);
  assert.match(html, /aria-label="Pulse duration numeric value"[^>]*value="120"/);
  assert.match(html, /aria-label="Numerical aperture numeric value"[^>]*value="0.01"/);
  assert.match(html, /<h2 id="parameter-sheet-title">Light &amp; motion<\/h2>/);
  assert.match(html, /Specimen ready/);
  assert.match(html, /Loading Rust solver/);
  assert.doesNotMatch(html, /Exposure running/);
});

test("publishes crawl directives and every canonical route in the sitemap", async () => {
  const app = await application();
  const robotsResponse = await app.fetch("/robots.txt", "text/plain");
  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /User-Agent: \*/i);
  assert.match(robots, /Allow: \//i);
  assert.match(robots, /Sitemap: https:\/\/twophotonlithography\.com\/sitemap\.xml/i);

  const sitemapResponse = await app.fetch("/sitemap.xml", "application/xml");
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  for (const path of [
    "/",
    "/lab",
    "/guides",
    "/guides/two-photon-lithography",
    "/guides/multiphoton-lithography",
    "/guides/direct-laser-writing",
    "/guides/model-space",
    "/guides/parameters",
    "/method",
  ]) assert.match(sitemap, new RegExp(`<loc>https:\\/\\/twophotonlithography\\.com${path.replaceAll("/", "\\/")}<\\/loc>`));
});
