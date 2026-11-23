const path = require("node:path");
const express = require("express");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { OpenAI } = require("openai");
const { STEAM_STORE, parseAppId, parseGameInput, makeGameSearch, generateGame, reviewCount } = require("./steam");
const { makeAnalysisJobs } = require("./analysis-jobs");

require("dotenv").config({ path: path.join(__dirname, ".env") });

function counts(positive, negative) {
    if (positive === null || negative === null) return null;
    const total = positive + negative;
    return { positive, negative, total, percentage: total ? Math.round(1000 * positive / total) / 10 : null };
}

function renderResult(response, appId, result, timestamp, refreshAvailable, refreshFailed = false) {
    const { reviewComparison, analysis, sampleCounts } = result;
    const comparison = reviewComparison ? {
        start: reviewComparison.start,
        end: reviewComparison.end,
        recent: counts(reviewComparison.recent.positive, reviewComparison.recent.negative),
        historical: counts(reviewComparison.historical.positive, reviewComparison.historical.negative)
    } : null;
    response.render("display", {
        appid: appId,
        gameName: result.gameName,
        gameTags: Array.isArray(result.gameTags) ? result.gameTags : [],
        gameDescription: result.gameDescription || "",
        gameRating: result.gameRating,
        totals: counts(reviewCount(result.numPosReviews), reviewCount(result.numNegReviews)),
        comparison,
        analysis,
        sampleCounts,
        summary: result.summary,
        updatedAt: new Date(timestamp),
        refreshAvailable,
        refreshFailed,
        storeUrl: STEAM_STORE + "/app/" + appId + "/"
    });
}

function createApp({ collection, jobs, checkDatabase, searchGames = makeGameSearch() }) {
    const app = express();

    app.disable("x-powered-by");
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "templates"));
    app.use((request, response, next) => {
        response.set({
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Content-Security-Policy": "default-src 'self'; img-src 'self' https://cdn.akamai.steamstatic.com; frame-src https://steamdb.info; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'"
        });
        next();
    });
    app.use(express.static(path.join(__dirname, "public")));

    app.get("/healthz", async (request, response) => {
        response.set("Cache-Control", "no-store");
        try {
            await checkDatabase();
            response.json({ status: "ok" });
        } catch {
            response.status(503).json({ status: "unavailable" });
        }
    });

    function showSearch(response, { input = "", error = "", games = [], searched = false, status = 200 } = {}) {
        return response.status(status).render("index", { input, error, games, searched });
    }

    const searchError = "Steam search is busy or unavailable. Try again, or enter an App ID or Steam URL.";
    app.get("/", (request, response) => showSearch(response));
    app.get("/api/games", async (request, response) => {
        const title = typeof request.query.q === "string" ? request.query.q.trim() : "";
        response.set("Cache-Control", "no-store");
        if (!title || title.length > 100 || !parseGameInput(title).title) {
            return response.status(400).json({ error: "Enter a game name to search." });
        }
        try {
            response.json({ games: await searchGames(title) });
        } catch (error) {
            response.status(error.status === 429 ? 429 : 503).json({ error: searchError });
        }
    });

    app.post("/display", express.urlencoded({ extended: false, limit: "4kb", parameterLimit: 4 }), async (request, response) => {
        const input = typeof request.body?.in === "string" ? request.body.in.trim() : "";
        const selected = request.body?.appId;
        const { appId, title } = selected === undefined ? parseGameInput(input) : { appId: parseAppId(selected) };
        if (title && title.length <= 100) {
            try {
                return showSearch(response, { input, games: await searchGames(title), searched: true });
            } catch (error) {
                return showSearch(response, { input, status: error.status === 429 ? 429 : 503, error: searchError });
            }
        }

        if (!appId || input.length > 512) {
            return showSearch(response, {
                input: input.slice(0, 512), status: 400,
                error: "Enter a game name (up to 100 characters), a Steam App ID, or a Steam store link."
            });
        }
        if (!await jobs.enqueue(appId)) {
            response.set("Retry-After", "60");
            return showSearch(response, { input: input || String(appId), status: 429,
                error: "The analysis queue is full. Please try again in a minute." });
        }

        response.redirect(303, "/games/" + appId);
    });

    app.get("/api/games/:appId/status", async (request, response) => {
        response.set("Cache-Control", "no-store");
        const appId = parseAppId(request.params.appId);
        const job = appId && await jobs.find(appId, { status: 1 });
        if (!job) return response.status(404).json({ status: "missing" });
        response.json({ status: job.status });
    });

    app.get("/games/:appId", async (request, response, next) => {
        const appId = parseAppId(request.params.appId);
        if (!appId) return next();
        if (request.params.appId !== String(appId)) return response.redirect(302, "/games/" + appId);

        response.set("Cache-Control", "no-store");
        const job = await jobs.find(appId);
        if (job?.status === "ready") {
            return renderResult(response, appId, job.result, job.resultAt, jobs.isStale(job.resultAt));
        }
        if ((job?.status === "failed" || job?.status === "missing") && job.result) {
            return renderResult(response, appId, job.result, job.resultAt, true, true);
        }
        if (job) {
            const status = { queued: 202, running: 202, failed: 503, missing: 404 }[job.status] || 503;
            return response.status(status).render("analysis-status", { appId, status: job.status });
        }

        const legacy = await collection.findOne({ gameId: appId }, { sort: { timestamp: -1 } });
        if (legacy) return renderResult(response, appId, legacy, legacy.timestamp, true);
        return response.status(404).render("analysis-status", { appId, status: "unrequested" });
    });

    app.use((request, response) => response.status(404).render("notfound", {
        heading: "Page not found",
        message: "Head back to the analyzer to summarize a Steam game."
    }));

    app.use((error, request, response, next) => {
        if (response.headersSent) return next(error);
        const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 503;
        if (status === 503) console.error("Request failed", { method: request.method, name: error.name, code: error.code });
        if (request.path.startsWith("/api/")) return response.status(status).json({ error: "Request unavailable" });
        response.status(status).render("notfound", {
            heading: status === 503 ? "Analysis temporarily unavailable" : "Could not read the request",
            message: status === 503
                ? "Steam, the summary service, or the database may be temporarily unavailable. Please try again shortly."
                : "Return to the homepage and enter a game name, App ID, or Steam store link."
        });
    });
    return app;
}

async function start() {
    const { MONGO_CONNECTION_STRING, OPENAI_API, OPENAI_API_KEY } = process.env;
    if (!MONGO_CONNECTION_STRING || !(OPENAI_API_KEY || OPENAI_API)) {
        throw new Error("Set MONGO_CONNECTION_STRING and OPENAI_API_KEY (or OPENAI_API).");
    }

    const port = Number(process.env.PORT || 3000);
    const maxStartsPerMinute = Number(process.env.ANALYSES_PER_MINUTE || 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535 ||
        !Number.isSafeInteger(maxStartsPerMinute) || maxStartsPerMinute < 1) {
        throw new Error("PORT and ANALYSES_PER_MINUTE must be valid positive integers.");
    }

    const client = new MongoClient(MONGO_CONNECTION_STRING, {
        serverApi: ServerApiVersion.v1,
        serverSelectionTimeoutMS: 5_000,
        timeoutMS: 5_000
    });
    const database = client.db("MainDB");
    const collection = database.collection("GameInfo");
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY || OPENAI_API, timeout: 40_000, maxRetries: 0 });
    const jobs = makeAnalysisJobs(database.collection("AnalysisJobs"),
        appId => generateGame(appId, openai, process.env.OPENAI_MODEL || "gpt-6-luna"), maxStartsPerMinute);
    const app = createApp({
        collection, jobs,
        checkDatabase: () => database.command({ ping: 1 }, { timeoutMS: 2_000 })
    });

    try {
        await client.connect();
        await collection.createIndex({ gameId: 1, timestamp: -1 });
        await jobs.start();
    } catch (error) {
        await client.close();
        console.error("Database startup failed", { name: error.name, code: error.code });
        process.exitCode = 1;
        return;
    }

    const server = app.listen(port, process.env.HOST || "0.0.0.0", () => {
        console.log("Steam Review Summarizer listening on port " + port);
    });
    server.once("error", async error => {
        console.error("Could not start HTTP server", { code: error.code });
        await jobs.stop();
        await client.close();
        process.exitCode = 1;
    });

    let stopping = false;
    async function shutdown() {
        if (stopping) return;
        stopping = true;
        const timeout = setTimeout(() => process.exit(1), 75_000);
        timeout.unref();
        try {
            const drainJobs = jobs.stop();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            await drainJobs;
            await client.close();
        } catch (error) {
            console.error("Shutdown failed", { name: error.name });
            process.exitCode = 1;
        } finally {
            clearTimeout(timeout);
        }
    }

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

if (require.main === module) {
    start().catch(error => {
        console.error("Startup failed", error.name === "MongoParseError" ? "Check the MongoDB URI." : error.message);
        process.exitCode = 1;
    });
}

module.exports = { createApp };
