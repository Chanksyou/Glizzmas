import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function game() {
  const nodes = new Map();
  const drawing = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      addEventListener(event, listener) { this[event] = listener; },
      getBoundingClientRect: () => ({ width: 900, height: 520 }),
      getContext: () => drawing,
      setAttribute() {}, focus() {}, style: { setProperty() {} },
    });
    return nodes.get(id);
  };
  let clock = 0;
  let frame;
  const finishes = [];
  const context = vm.createContext({
    document: { getElementById: node, addEventListener() {} },
    performance: { now: () => clock },
    requestAnimationFrame: callback => { frame = callback; },
    ResizeObserver: class { observe() {} },
    Image: class { naturalWidth = 0; },
    Audio: class { pause() {} },
    devicePixelRatio: 1,
    window: { glizzmasLeaderboard: { startRun() {}, finishRun(score) { finishes.push(score); } } },
  });
  const source = readFileSync(new URL("../index.html", import.meta.url), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(source, context);
  node("sound").click();
  const tick = time => { clock = time; frame(time); };
  tick(0);
  return { node, tick, finishes, read: expression => vm.runInContext(expression, context) };
}

test("a run lasts 100 real seconds, accelerates every 10, and can be replayed", () => {
  const { node, tick, finishes, read } = game();
  assert.equal(node("time").value, "100s");
  tick(30000);
  assert.equal(node("time").value, "100s", "the opening screen does not spend run time");
  node("start").click();
  for (let frame = 1; frame < 6000; frame++) {
    if (frame % 45 === 0) node("flap").click();
    if (frame % 20 === 0) node("throw").click();
    tick(30000 + frame * 1000 / 60);
    if (frame === 599) assert.equal(read("scrollSpeed"), 152);
    if (frame === 600) assert.equal(read("scrollSpeed"), 152 * 1.2);
    if (frame === 1200) assert.equal(read("scrollSpeed"), 152 * 1.2 ** 2);
    if (frame === 5400) assert.equal(read("scrollSpeed"), 152 * 1.2 ** 9);
  }
  assert.equal(finishes.length, 0);
  assert.equal(node("time").value, "1s");
  const finalScore = Number(node("score").value);
  assert.ok(finalScore > 0, "deliveries still score throughout an accelerated run");
  tick(130000);
  assert.equal(node("time").value, "0s");
  assert.equal(node("overlay").hidden, false);
  assert.deepEqual(finishes, [finalScore]);
  tick(131000);
  assert.equal(finishes.length, 1);
  assert.equal(Number(node("score").value), finalScore);
  node("start").click();
  assert.equal(node("time").value, "100s");
  assert.equal(read("scrollSpeed"), 152);
  tick(231000);
  assert.equal(node("time").value, "0s", "a suspended tab still expires on return");
  assert.equal(finishes.length, 2);
});

test("a hot dog at a chimney edge scores correctly at the faster pace", () => {
  const { node, tick, read } = game();
  node("start").click();
  tick(90000);
  read(`
    const target = roofs[1];
    const dt = .034;
    const crossing = 1 / ((100 + SHOT_GRAVITY * dt) * dt);
    dogs = [{
      x: target.x + target.right * SCALE - 1 - (SHOT_SPEED + scrollSpeed) * dt * crossing,
      y: target.top - 1,
      vy: 100,
    }];
    update(dt);
  `);
  assert.equal(node("score").value, "1");
});

test("a crash can still end the run before the countdown expires", () => {
  const { node, tick, finishes } = game();
  node("start").click();
  for (let frame = 1; frame < 180; frame++) tick(frame * 1000 / 60);
  assert.equal(finishes.length, 1);
  assert.ok(parseInt(node("time").value, 10) > 0);
});
