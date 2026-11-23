# SteamReviewSummarizer
1. Arthur You submitted: UID 119732830
2. Arthur You (119732830) and Max Cai (119823026)
3. Summarizes a Steam game's reviews using Steam and OpenAI APIs with other small details
4. https://youtu.be/mIrd2-wrx7Q
5. 
Steam API: https://store.steampowered.com/api/
(API documentation here: https://steamcommunity.com/dev)
OpenAPI link is in .env file
(API documentation here: https://openai.com/api/)
6. ayou@terpmail.umd.edu
7. https://steamreviewsummarizer.onrender.com/

## Run locally

Use Node.js 24. Copy `.env.example` to `.env` and set
`MONGO_CONNECTION_STRING` and `OPENAI_API_KEY`. Existing deployments can
continue to use the `OPENAI_API` variable. If you set `OPENAI_MODEL`, use a
model that supports Chat Completions Structured Outputs. The default is
`gpt-6-luna`. Replace any `OPENAI_MODEL=gpt-4.1-nano` entry in an older `.env`
file because that model has been retired.

```sh
npm ci
npm start
```

Open http://localhost:3000. The server also honors `HOST` and `PORT` when
running directly. The MongoDB user needs read/write and index creation
permissions in `MainDB`. Older results remain readable from `GameInfo`.
New jobs and their results live in `AnalysisJobs`, which the app initializes
on startup.

Search by game name and pick a match, or enter a Steam App ID or store URL.
Game name search uses Steam's Store Search endpoint. An App ID or a store
link bypasses this lookup if the endpoint is unavailable.

An analysis gets a stable `/games/<app-id>` link as soon as it is queued.
The result compares Steam's date-filtered counts for the last 30 days with
earlier reviews. The text summary uses a smaller, deduplicated sample of
helpful and recent reviews. Each displayed finding links to sampled Steam
reviews that the model cited. The app omits comparisons when Steam's
counts are missing or inconsistent.

## Deploy to a VPS

Install Docker Engine and the Compose plugin on the VPS. Point your
domain's A record (and AAAA record, if using IPv6) at the VPS. Allow incoming
TCP ports 80 and 443, and optionally UDP 443 for HTTP/3. For MongoDB Atlas,
allow the VPS's outbound IP in your project's IP access list. Compose
expects ports 80 and 443 to be available on the host.

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env` with your MongoDB URI, OpenAI key, and public hostname in
`SITE_ADDRESS` (for example, `reviews.example.com`). Use the host's
existing MongoDB service or a managed instance reachable from the app
container. If a value contains a literal dollar sign, single-quote it
in the Compose `.env` file. Then run:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail=50 app caddy
curl -fsS https://reviews.example.com/healthz
```

Caddy obtains and renews HTTPS certificates. The Node server is reachable
only on the Compose network. The health endpoint checks HTTP and MongoDB
connectivity. Search for a game that isn't already cached, select it, and
open its result link in a second tab to verify Steam, OpenAI, and the queue.
Re-run `docker compose up --build -d` after an update.

Run a single app instance per database. It owns the queue and resumes
unfinished jobs after a restart. Queue capacity is 30 waiting jobs, with
up to three active jobs and `ANALYSES_PER_MINUTE` starts per minute.
Concurrent requests for the same game share one job. Completed analyses
can be read at their links and become eligible for refresh after 24 hours.
For a public deployment, set an appropriate project spending alert or
usage limit with your model provider.

The bundled legacy `node_modules` tree is excluded from Docker builds.
The image installs locked dependencies with `npm ci`.
