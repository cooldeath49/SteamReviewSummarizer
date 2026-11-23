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
continue to use the `OPENAI_API` variable. Optionally set `OPENAI_MODEL`.

```sh
npm ci
npm start
```

Open http://localhost:3000. The server also honors `HOST` and `PORT` when
running directly. It uses the existing MongoDB `MainDB.GameInfo` cache and
creates an index on `gameId` and `timestamp` at startup. The MongoDB user needs
read/write access to `MainDB`, including permission to create that index.

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
connectivity. Submit a Steam link that isn't already cached to verify the
Steam and OpenAI paths. Re-run `docker compose up --build -d` after an update.

The Compose configuration runs one app instance. New analyses are
limited to three concurrent jobs and `ANALYSES_PER_MINUTE` starts per minute
across that instance. Concurrent requests for the same game share one
job, and cached summaries can be served for up to 30 days. For a public
deployment, set an appropriate project spending alert or usage limit with
your model provider.

The bundled legacy `node_modules` tree is excluded from Docker builds.
The image installs locked dependencies with `npm ci`.
