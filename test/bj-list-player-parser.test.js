"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { normalizeBjListPlayerText } = require("../eloboard-utils");

test("선수명 뒤의 종족 표기만 제거한다", () => {
  assert.equal(normalizeBjListPlayerText("서지수 T"), "서지수");
  assert.equal(normalizeBjListPlayerText("정서린 P"), "정서린");
  assert.equal(normalizeBjListPlayerText("토마토 Z"), "토마토");
  assert.equal(normalizeBjListPlayerText("  서지수   T  "), "서지수");
});

test("종족 표기가 아닌 선수명은 변경하지 않는다", () => {
  assert.equal(normalizeBjListPlayerText("LIGHT"), "LIGHT");
  assert.equal(normalizeBjListPlayerText("name with space"), "name with space");
  assert.equal(normalizeBjListPlayerText(""), "");
});

test("선수 목록 파서가 정규화 함수를 사용한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(
    source,
    /normalizeBjListPlayerText\s*\(\s*cleanText\s*\(\s*linkHtml\s*\)\s*\)/,
  );
});
