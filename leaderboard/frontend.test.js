import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("frontend submits a completed run, retries failures, and isolates newer runs", async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", textContent: "", disabled: false,
      addEventListener(event, fn) { this[event] = fn; },
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children = children; },
      focus() {},
    });
    return nodes.get(id);
  };
  let failSave = true;
  let releaseSave;
  let pendingSave;
  let savedPayload;
  const window = { GLIZZMAS_LEADERBOARD_API: "https://scores.example" };
  const context = vm.createContext({
    window, document: { getElementById: node, createElement: tag => node(Symbol(tag)) },
    localStorage: { getItem() { return ""; }, setItem() {} },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      if (url.endsWith("/runs")) return { ok: true, json: async () => ({ runId: "test-run" }) };
      if (options.method === "POST") {
        savedPayload = JSON.parse(options.body);
        if (failSave) return { ok: false, json: async () => ({ error: "Try again" }) };
        if (pendingSave) await pendingSave;
      }
      return { ok: true, json: async () => ({ scores: [{ name: "Santa", score: 3 }] }) };
    },
  });
  vm.runInContext(readFileSync(new URL("../leaderboard.js", import.meta.url), "utf8"), context);
  const board = window.glizzmasLeaderboard;
  board.startRun();
  board.finishRun(0);
  assert.equal(node("submit-score").disabled, true);
  board.startRun();
  board.finishRun(3);
  node("nickname").value = "Santa";
  await node("score-form").submit({ preventDefault() {} });
  assert.equal(node("submission-status").textContent, "Try again");
  assert.equal(node("submit-score").disabled, false, "failed save can be retried");
  failSave = false;
  await node("score-form").submit({ preventDefault() {} });
  assert.deepEqual(savedPayload, { runId: "test-run", name: "Santa", score: 3 });
  assert.equal(node("submit-score").disabled, true);
  assert.match(node("submission-status").textContent, /Score saved/);
  assert.equal(node("leaderboard-rows").children[0].children[1].textContent, "Santa");
  board.startRun();
  board.finishRun(4);
  pendingSave = new Promise(resolve => { releaseSave = resolve; });
  const oldSubmit = node("score-form").submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  board.startRun();
  board.finishRun(1);
  const newStatus = node("submission-status").textContent;
  releaseSave();
  await oldSubmit;
  assert.equal(node("finished-score").textContent, "1");
  assert.equal(node("submission-status").textContent, newStatus);
  assert.equal(node("submit-score").disabled, false);
});
