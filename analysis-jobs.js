
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUED = 30;
const MAX_ACTIVE = 3;
const LEASE_MS = 120_000;

function makeAnalysisJobs(collection, generate, maxStartsPerMinute) {
    const starts = [];
    const active = new Set();
    let admission = Promise.resolve();
    let timer;
    let poll;

    async function enqueue(appId) {
        // One Node instance owns the queue. Serializing admission keeps the
        // capacity check and enqueue consistent across concurrent requests.
        const task = admission.then(async () => {
            const existing = await collection.findOne({ _id: appId }, { projection: { status: 1, finishedAt: 1 } });
            if (existing?.status === "queued" || existing?.status === "running" ||
                (existing?.status === "ready" && Number(existing.finishedAt) > Date.now() - CACHE_MS)) return true;

            const queued = await collection.countDocuments({ status: "queued" }, { limit: MAX_QUEUED });
            if (queued >= MAX_QUEUED) return false;
            await collection.updateOne({ _id: appId }, {
                $set: { status: "queued", queuedAt: new Date() },
                $unset: { startedAt: "", finishedAt: "" }
            }, { upsert: true });
            return true;
        });
        admission = task.catch(() => {});
        return task;
    }

    async function run(job) {
        let result;
        let status;
        try {
            result = await generate(job._id);
            status = result ? "ready" : "missing";
        } catch (error) {
            const upstreamStatus = error.status ?? (typeof error.cause === "number" ? error.cause : undefined);
            console.error("Analysis failed", { appId: job._id, name: error.name, code: error.code, status: upstreamStatus });
            status = "failed";
        }

        const finishedAt = new Date();
        const update = { $set: { status, finishedAt } };
        if (result) Object.assign(update.$set, { result, resultAt: finishedAt });
        await collection.updateOne({ _id: job._id, status: "running", startedAt: job.startedAt }, update);
    }

    async function claimJobs() {
        const now = Date.now();
        while (starts.length && starts[0] <= now - 60_000) starts.shift();
        while (timer && active.size < MAX_ACTIVE && starts.length < maxStartsPerMinute) {
            const job = await collection.findOneAndUpdate(
                { $or: [{ status: "queued" }, { status: "running", startedAt: { $lte: new Date(Date.now() - LEASE_MS) } }] },
                { $set: { status: "running", startedAt: new Date() } },
                { sort: { queuedAt: 1 }, returnDocument: "after" }
            );
            if (!job) break;
            starts.push(Date.now());
            const task = run(job).catch(error => {
                console.error("Could not save analysis status", { appId: job._id, name: error.name, code: error.code });
            }).finally(() => active.delete(task));
            active.add(task);
        }
    }

    async function start() {
        await collection.createIndex({ status: 1, queuedAt: 1 });
        await collection.updateMany({ status: "running" }, { $set: { status: "queued" }, $unset: { startedAt: "" } });
        timer = setInterval(() => {
            if (poll) return;
            poll = claimJobs().catch(error => {
                console.error("Queue poll failed", { name: error.name, code: error.code });
            }).finally(() => { poll = undefined; });
        }, 1500);
        timer.unref();
    }

    async function stop() {
        clearInterval(timer);
        timer = undefined;
        await poll;
        await Promise.all(active);
    }

    return {
        enqueue,
        start,
        stop,
        find: (appId, projection) => collection.findOne({ _id: appId }, { projection }),
        isStale: finishedAt => Number(finishedAt) <= Date.now() - CACHE_MS
    };
}

module.exports = { makeAnalysisJobs };
