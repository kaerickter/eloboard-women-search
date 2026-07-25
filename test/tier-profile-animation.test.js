const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("tier profiles animate every visible LIVE card while limiting selected non-LIVE cards", () => {
  const source = read(path.join("public", "tiers.js"));

  assert.match(source, /MAX_ANIMATED_NON_LIVE_PROFILES = 4/);
  assert.match(source, /data-static-src=/);
  assert.match(source, /data-animated-src=/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /decoding="async"/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /document\.visibilityState === "visible"/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /classList\.contains\("is-live"\)/);
  assert.match(source, /const liveCandidates = candidates\.filter/);
  assert.match(source, /\.slice\(0, MAX_ANIMATED_NON_LIVE_PROFILES\)/);
  assert.match(source, /new Set\(\[\.\.\.liveCandidates, \.\.\.selectedCandidates\]\)/);
});

test("tier API adds local profile paths and serves them with image caching", () => {
  const source = read("server.js");

  assert.match(source, /function tierProfileAssets/);
  assert.match(source, /tierStaticImage: "\/tier-profiles\/"/);
  assert.match(source, /tierAnimatedImage: "\/tier-profiles\/"/);
  assert.match(source, /players: addTierProfileAssets\(tierAdmin\.applyOverrides\(players\)\)/);
  assert.match(source, /"\.webp": "image\/webp"/);
  assert.match(source, /public, max-age=86400/);
});

test("tier cards use 200px desktop photos with larger LIVE and name labels", () => {
  const source = read(path.join("public", "tiers.css"));

  assert.match(source, /\.tier-cards \{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap;[\s\S]*justify-content: center;/);
  assert.match(source, /width: calc\(\(100% - 16px\) \/ 3\)/);
  assert.match(source, /width: calc\(\(100% - 8px\) \/ 2\)/);
  assert.match(source, /\.player-card \{[\s\S]*width: 200px;[\s\S]*height: 200px;/);
  assert.match(source, /\.player-name \{[\s\S]*font-size: 18px;/);
  assert.match(source, /\.live-badge \{[\s\S]*min-height: 30px;[\s\S]*font-size: 13px;/);
});
