import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "./worker.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async all() { return { results: statement.all(...values) }; },
        async first() { return statement.get(...values) || null; },
        async run() { return { meta: statement.run(...values) }; },
      };
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
}

test("runs validate, save once, retry safely, rank best scores, and expire", async t => {
  const DB = database();
  t.after(() => DB.sqlite.close());
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  const call = (path, data, origin = "https://chanksyou.github.io") => worker.fetch(new Request(
    "https://scores.example" + path,
    { method: data === undefined ? "GET" : "POST", headers: { Origin: origin }, body: data === undefined ? undefined : JSON.stringify(data) }
  ), { DB });
  const session = await call("/runs", {});
  assert.equal(session.status, 201);
  const { runId } = await session.json();
  const payload = { runId, name: "Santa", score: 8 };
  assert.equal((await call("/scores", payload)).status, 400, "impossible score rejected");
  assert.equal((await call("/scores", { ...payload, score: -1 })).status, 400);
  assert.equal((await call("/scores", { ...payload, name: "<script>" })).status, 400);
  assert.equal((await call("/scores", null)).status, 400);
  now += 12000;
  const saved = await call("/scores", payload);
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).scores, [{ name: "Santa", score: 8 }]);
  const retries = await Promise.all([call("/scores", payload), call("/scores", payload)]);
  assert.deepEqual(retries.map(response => response.status), [200, 200]);
  assert.equal((await call("/scores", { ...payload, score: 9 })).status, 409);
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS count FROM runs WHERE score IS NOT NULL").get().count, 1);

  const secondRun = (await (await call("/runs", {})).json()).runId;
  assert.equal((await call("/scores", { runId: secondRun, name: "santa", score: 2 })).status, 200);
  const entries = await (await call("/scores")).json();
  assert.equal(entries.scores.length, 1, "case-insensitive nicknames share a best score");
  assert.equal(entries.scores[0].score, 8);
  for (let i = 0; i < 12; i++) {
    DB.sqlite.prepare("INSERT INTO runs VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), now, "Player " + i, i + 1);
  }
  const top = (await (await call("/scores")).json()).scores;
  assert.equal(top.length, 10);
  assert.equal(top[0].score, 12);
  assert.ok(top.every((entry, index) => index === 0 || entry.score <= top[index - 1].score));

  const expired = (await (await call("/runs", {})).json()).runId;
  now += 100000;
  assert.equal((await call("/scores", { runId: expired, name: "Speedy", score: 196 })).status, 400);
  now += 100000;
  assert.equal((await call("/scores", { runId: expired, name: "Speedy", score: 196 })).status, 400, "waiting longer cannot exceed the 100-second distance");
  assert.equal((await call("/scores", { runId: expired, name: "Speedy", score: 150 })).status, 200, "faster runs can earn totals above the old pace limit");
  const pending = (await (await call("/runs", {})).json()).runId;
  now += 14400001;
  assert.equal((await call("/scores", { runId: pending, name: "Elf", score: 1 })).status, 400);
  await call("/runs", {});
  assert.equal(DB.sqlite.prepare("SELECT count(*) AS count FROM runs WHERE id = ?").get(pending).count, 0);
  assert.equal((await call("/scores", undefined, "https://unrelated.example")).status, 403);
  assert.equal((await call("/scores")).headers.get("Access-Control-Allow-Origin"), "https://chanksyou.github.io");
  const big = new Request("https://scores.example/scores", {
    method: "POST", headers: { Origin: "https://chanksyou.github.io" }, body: "x".repeat(1025),
  });
  assert.equal((await worker.fetch(big, { DB })).status, 413);
});
