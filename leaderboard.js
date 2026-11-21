(() => {
  const api = window.GLIZZMAS_LEADERBOARD_API;
  const panel = document.getElementById("leaderboard");
  if (!api) return;
  panel.hidden = false;
  const rows = document.getElementById("leaderboard-rows");
  const status = document.getElementById("leaderboard-status");
  const form = document.getElementById("score-form");
  const nickname = document.getElementById("nickname");
  const submit = document.getElementById("submit-score");
  const submissionStatus = document.getElementById("submission-status");
  const refresh = document.getElementById("refresh-scores");
  let runReady;
  let finishedRun;
  let loading = 0;

  try {
    nickname.value = localStorage.getItem("glizzmas-nickname") || "";
  } catch {}

  async function request(path, data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(api + path, {
        method: data ? "POST" : "GET",
        headers: data ? { "Content-Type": "application/json" } : {},
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Scores are unavailable. Please try again.");
      return body;
    } catch (error) {
      if (error.name === "AbortError" || error instanceof TypeError) {
        throw new Error("Couldn't connect to the leaderboard. Please try again.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function showScores(data) {
    if (!Array.isArray(data.scores) || data.scores.length > 10 || data.scores.some(entry =>
      typeof entry.name !== "string" || !Number.isSafeInteger(entry.score) || entry.score < 1)) {
      throw new Error("Scores are unavailable. Please try again.");
    }
    const entries = data.scores.map((entry, index) => {
      const row = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(index + 1);
      const name = document.createElement("span");
      name.textContent = entry.name;
      const points = document.createElement("strong");
      points.textContent = String(entry.score);
      row.append(rank, name, points);
      return row;
    });
    rows.replaceChildren(...entries);
    status.textContent = entries.length ? "Best score per nickname" : "Be the first to deliver a hot dog!";
  }

  async function loadScores() {
    const current = ++loading;
    refresh.disabled = true;
    status.textContent = "Loading scores…";
    try {
      const data = await request("/scores");
      if (current === loading) showScores(data);
    } catch (error) {
      if (current === loading) status.textContent = error.message;
    } finally {
      if (current === loading) refresh.disabled = false;
    }
  }

  window.glizzmasLeaderboard = {
    startRun() {
      finishedRun = null;
      form.hidden = true;
      runReady = request("/runs", {}).catch(() => null);
    },
    finishRun(score) {
      finishedRun = { score, ready: runReady, saved: false };
      const link = document.getElementById("leaderboard-link");
      link.hidden = false;
      link.textContent = score > 0 ? "Submit score · Top 10" : "Top 10";
      form.hidden = false;
      document.getElementById("finished-score").textContent = String(score);
      submit.disabled = score < 1;
      submissionStatus.textContent = score > 0
        ? "Your nickname and score will be public."
        : "Deliver a hot dog to submit a score.";
      loadScores();
    },
  };

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const run = finishedRun;
    if (!run || run.saved || submit.disabled) return;
    const name = nickname.value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!/^[\p{L}\p{N} ._'-]{1,20}$/u.test(name)) {
      submissionStatus.textContent = "Use 1–20 letters, numbers, spaces, or . _ ' - in your nickname.";
      nickname.focus();
      return;
    }
    submit.disabled = true;
    submissionStatus.textContent = "Saving score…";
    try {
      const session = await run.ready;
      if (!session?.runId) throw new Error("This run couldn't connect. Play again to submit a score.");
      const data = await request("/scores", { runId: session.runId, name, score: run.score });
      if (finishedRun !== run) return;
      ++loading;
      refresh.disabled = false;
      showScores(data);
      run.saved = true;
      submissionStatus.textContent = "Score saved! Play again to beat it.";
      try {
        localStorage.setItem("glizzmas-nickname", name);
      } catch {}
    } catch (error) {
      if (finishedRun === run) submissionStatus.textContent = error.message;
    } finally {
      if (finishedRun === run) submit.disabled = run.saved;
    }
  });
  refresh.addEventListener("click", loadScores);
  loadScores();
})();
