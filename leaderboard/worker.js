const TOP_SCORES = `
  SELECT MIN(name) AS name, MAX(score) AS score
  FROM runs
  WHERE score IS NOT NULL
  GROUP BY name COLLATE NOCASE
  ORDER BY score DESC, name COLLATE NOCASE ASC
  LIMIT 10
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://chanksyou.github.io";
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (origin === allowedOrigin || origin === url.origin) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    const reply = (body, status = 200) => Response.json(body, { status, headers });

    if (origin && !headers["Access-Control-Allow-Origin"]) {
      return reply({ error: "This site cannot submit scores." }, 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    try {
      if (url.pathname === "/scores" && request.method === "GET") {
        const { results } = await env.DB.prepare(TOP_SCORES).all();
        return reply({ scores: results });
      }
      if (request.method !== "POST" || !["/runs", "/scores"].includes(url.pathname)) {
        return reply({ error: "Not found." }, 404);
      }
      if (!origin) return reply({ error: "A game origin is required." }, 403);

      // Bound actual streamed bytes as Content-Length may be missing or inaccurate.
      let body = "";
      let size = 0;
      if (request.body) {
        const reader = request.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024) {
            await reader.cancel();
            return reply({ error: "Request is too large." }, 413);
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      }

      const now = Date.now();
      if (url.pathname === "/runs") {
        const id = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare("DELETE FROM runs WHERE score IS NULL AND created_at < ?").bind(now - 14400000),
          env.DB.prepare("INSERT INTO runs (id, created_at) VALUES (?, ?)").bind(id, now),
        ]);
        return reply({ runId: id }, 201);
      }

      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return reply({ error: "Enter a nickname and a valid score." }, 400);
      }
      if (!data || typeof data !== "object" || typeof data.name !== "string" ||
          typeof data.runId !== "string" || !/^[a-f0-9-]{36}$/.test(data.runId) ||
          !Number.isSafeInteger(data.score) || data.score < 1 || data.score > 10000) {
        return reply({ error: "Enter a nickname and a valid score." }, 400);
      }
      const name = data.name.normalize("NFKC").trim().replace(/\s+/g, " ");
      if (!/^[\p{L}\p{N} ._'-]{1,20}$/u.test(name)) {
        return reply({ error: "Use 1–20 letters, numbers, spaces, or . _ ' - in your nickname." }, 400);
      }
      const run = await env.DB.prepare("SELECT * FROM runs WHERE id = ?").bind(data.runId).first();
      if (!run || now - run.created_at > 14400000) {
        return reply({ error: "This run expired. Play again to submit a score." }, 400);
      }
      // Casual score checks reject impossible totals. The browser still owns gameplay.
      if (data.score > Math.floor((now - run.created_at) / 1000) + 3) {
        return reply({ error: "That score could not be verified. Please play again." }, 400);
      }
      if (run.score !== null && (run.score !== data.score || run.name !== name)) {
        return reply({ error: "This run was already submitted." }, 409);
      }
      const result = await env.DB.prepare(
        "UPDATE runs SET name = ?, score = ? WHERE id = ? AND score IS NULL"
      ).bind(name, data.score, data.runId).run();
      if (result.meta.changes === 0) {
        const saved = await env.DB.prepare("SELECT name, score FROM runs WHERE id = ?").bind(data.runId).first();
        if (saved.name !== name || saved.score !== data.score) {
          return reply({ error: "This run was already submitted." }, 409);
        }
      }
      const { results } = await env.DB.prepare(TOP_SCORES).all();
      return reply({ scores: results });
    } catch (error) {
      console.error("Leaderboard request failed", error);
      return reply({ error: "Scores are temporarily unavailable. Please try again." }, 503);
    }
  },
};
