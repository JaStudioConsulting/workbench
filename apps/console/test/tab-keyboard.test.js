import assert from "node:assert/strict";
import test from "node:test";
import { handleTabListKeyDown } from "../src/components/handleTabListKeyDown.js";

function keyboardEvent(key, index) {
  const activated = [];
  const tabs = [0, 1, 2].map((number) => ({
    focus() { activated.push(`focus:${number}`); },
    click() { activated.push(`click:${number}`); },
  }));
  let prevented = false;
  return {
    activated,
    event: {
      key,
      target: tabs[index],
      currentTarget: { querySelectorAll: () => tabs },
      preventDefault() { prevented = true; },
    },
    wasPrevented: () => prevented,
  };
}

test("tab lists support arrows with wraparound and Home/End", () => {
  for (const [key, start, expected] of [
    ["ArrowRight", 2, 0],
    ["ArrowLeft", 0, 2],
    ["Home", 2, 0],
    ["End", 0, 2],
  ]) {
    const caseData = keyboardEvent(key, start);
    handleTabListKeyDown(caseData.event);
    assert.equal(caseData.wasPrevented(), true);
    assert.deepEqual(caseData.activated, [`focus:${expected}`, `click:${expected}`]);
  }
});

test("tab lists leave unrelated keys to the browser", () => {
  const caseData = keyboardEvent("Tab", 1);
  handleTabListKeyDown(caseData.event);
  assert.equal(caseData.wasPrevented(), false);
  assert.deepEqual(caseData.activated, []);
});
