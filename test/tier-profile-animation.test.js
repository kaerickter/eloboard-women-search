const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("tier profiles start static and only animate for visible LIVE or selected cards", () => {
  const source = read(path.join("public", "tiers.js"));

  assert.match(source, /MAX_ANIMATED_PROFILES = 4/);
  assert.match(source, /data-static-src=/);
  assert.match(source, /data-animated-src=/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /decoding="async"/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /document\.visibilityState === "visible"/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /classList\.contains\("is-live"\)/);
  assert.match(source, /\.slice\(0, MAX_ANIMATED_PROFILES\)/);
});

test("tier API adds local profile paths and serves them with image caching", () => {
  const source = read("server.js");

  assert.match(source, /function tierProfileAssets/);
  assert.match(source, /tierStaticImage: "\/tier-profiles\/"/);
  assert.match(source, /tierAnimatedImage: "\/tier-profiles\/"/);
  assert.match(source, /players: addTierProfileAssets\(players\)/);
  assert.match(source, /"\.webp": "image\/webp"/);
  assert.match(source, /public, max-age=86400/);
});

test("tier cards use 200px desktop photos with larger LIVE and name labels", () => {
  const source = read(path.join("public", "tiers.css"));

  assert.match(source, /grid-template-columns: repeat\(auto-fill, 200px\)/);
  assert.match(source, /\.player-card \{[\s\S]*width: 200px;[\s\S]*height: 200px;/);
  assert.match(source, /\.player-name \{[\s\S]*font-size: 18px;/);
  assert.match(source, /\.live-badge \{[\s\S]*min-height: 30px;[\s\S]*font-size: 13px;/);
});
