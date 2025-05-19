const path = require("path");
const express= require("express");
const app = express();
const { MongoClient, ServerApiVersion } = require("mongodb");
const { OpenAI } = require("openai");
const portNumber = 3000;

app.use(express.urlencoded({ extended: false }));
require("dotenv").config({
    path: path.resolve(__dirname, ".env"),
});

// mongoDB init
let client, database, collection;
const databaseName = "MainDB";
const collectionName = "GameInfo";
const uri = process.env.MONGO_CONNECTION_STRING;
client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });
database = client.db(databaseName);
collection = database.collection(collectionName);

// openai init
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API
});

var prompt =
    `Your mission is to to summarize the reviews about this game. Make sure to use clear, accurate, not overly analytical tone,
    and pay attention for any changes between most recent reviews and most helpful reviews. 
    Ignore the reviews that don't provide related information
    Your output should only contain the result as raw text (no markdown) and nothing else. STRICTLY FOLLOW THESE RULES.
    Below are the given information
    Game: $gameName$,
    Tags: $gameTags$,
    Description: $gameDescription$,
    Rating: $gameRating$,
    Number of Pos Reviews: $numPosReviews$,
    Number of Neg Reviews: $numNegReviews$,
    Most Helpful Reviews: $mostHelpfulReviews$,
    Past 30 Days Reviews: $recentReviews$`;

// ejs
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "templates"));
app.use(express.static(path.resolve(__dirname, "public")));

// regexp pattern for extracting app id and name
const pattern = /https:\/\/store.steampowered.com\/app\/(\d+)\/([^]+)/i;

// clicked function
function clicked() {
    let url = document.getElementById("in").value;
    if (url) {
        let results = pattern.exec(url);
        if (results) {
            let appid = Number(results[1]);
            let title = results[2];
            console.log("AppId: " + appid + ", title: " + title);
        } else {
            window.alert("Please enter a url of the form: let pattern = https://store.steampowered.com/app/app-id-here/app-name-here")
        }
    } else {
        window.alert("Please enter a URL");
    }
}

// homepage
app.get("/", (request, response) => {
    response.render('index');
});

// display page
app.post("/display", (request, response) => {
    const appid = request.body.id;

    var finalInfo;
    // first get the info of this game
    if (exist(appid)){
        finalInfo = lookupDB(appid);
    } else {
        const info = getGameInfo(appid);
        const summary = summarizeReviews(info);
        finalInfo = {
            gameId: appid,
            gameName: info.gameName,
            gameTags: info.gameTags,
            gameDescription: info.gameDescription,
            gameRating: info.gameRating,
            numPosReviews: info.numPosReviews,
            numNegReviews: info.numNegReviews,
            summary: summary,
        }
        insert(finalInfo);
    }

    const variables = {
        gameId: appid,
        gameName: finalInfo.gameName,
        gameTags: finalInfo.gameTags,
        numPosReviews: finalInfo.numPosReviews,
        numNegReviews: finalInfo.numNegReviews,
        summary: finalInfo.summary,
    }

    response.render('display', variables);
})

app.listen(portNumber);
console.log(`Web server started and running at http://localhost:${portNumber}\n`);
const stop = "Stop to shutdown the server:\n";
process.stdin.setEncoding('utf8');
process.stdout.write(stop);

process.stdin.on('readable', () => {
    const dataInput = process.stdin.read();
    if (dataInput !== null) {
        const command = dataInput.trim();

        // check the input for stop or itemsList
        if (command.toLowerCase() === "stop"){
            process.stdout.write("Shutting down the server\n");
            process.exit(0);
        }
        // print the prompt again after user typed something
        process.stdout.write(stop);
        process.stdin.resume();
    }
});

// insert
async function insert(gameInfo) {
    try {
        await client.connect();
        const game = {
            gameId: gameInfo.gameId,
            gameName: gameInfo.gameName,
            gameTags: gameInfo.gameTags,
            gameDescription: gameInfo.gameDescription,
            gameRating: gameInfo.gameRating,
            numPosReviews: gameInfo.numPosReviews,
            numNegReviews: gameInfo.numNegReviews,
            summary: gameInfo.summary,
            timestamp: Date.now() // Store current timestamp in milliseconds
        };

        let result = await collection.insertOne(game);
        console.log(`Successfully inserted game with id: ${result.insertedId}`);
        return result;
    } catch (e) {
        console.error('Error inserting to database:', e);
        return null;
    } finally {
        await client.close();
    }
}

async function lookupDB(appid) {
    let result;
    try {
        await client.connect();
        console.log(`looking up: email='${email}', gpa=${gpa}`);

        const filter = { appid: { $gte: gpa } };
        console.log("filter:", filter);
        const cursor = collection.find(filter);
        result = await cursor.toArray();
        console.log("find result (array):", result);


        return result;
    } catch (e) {
        console.error("error in lookupByEmailOrGPA:", e);
        return null;
    } finally {
        await client.close();
    }
}

// check if DB already have this game and is updated within 30 days
async function exist(appid) {
    try {
        await client.connect();
        console.log(`Checking existence for appid: ${appid}`);

        // calculate the timestamp for 30 days ago
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days in milliseconds

        // clean up old entries (older than 30 days)
        const deleteResult = await collection.deleteMany({
            timestamp: { $lt: thirtyDaysAgo }
        });

        if (deleteResult.deletedCount > 0) {
            console.log(`Cleaned up ${deleteResult.deletedCount} old entries`);
        }

        // check if appid exist
        const game = await collection.findOne({ gameId: appid });

        if (game) {
            console.log(`Found existing entry for game: ${game.gameName}`);
            // calculate age of the entry
            const ageInDays = Math.floor((Date.now() - game.timestamp) / (24 * 60 * 60 * 1000));
            console.log(`Entry age: ${ageInDays} days`);
            return {
                ...game,
                ageInDays
            };
        } else {
            console.log(`No existing entry found for appid: ${appid}`);
            return null;
        }
    } catch (e) {
        console.error("Error in exist():", e);
        return null;
    } finally {
        await client.close();
    }
}

async function getGameInfo(appid) {
    try {
        // get game details (name, tags, and description)
        const appDetailsResponse = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}`);
        const appDetailsData = await appDetailsResponse.json();

        // check if appid is valid
        if (!appDetailsData[appid].success) {
            throw new Error('Invalid appid or app not found');
        }

        const gameData = appDetailsData[appid].data;
        const gameName = gameData.name;
        const gameTags = gameData.genres.map(genre => genre.description); // Genres as tags
        const gameDescription = gameData.short_description || gameData.detailed_description || 'No description available';

        // get most helpful reviews (30)
        const helpfulReviewsResponse = await fetch(
            `https://store.steampowered.com/appreviews/${appid}?json=1&filter=all&language=all&num_per_page=30`
        );
        const helpfulReviewsData = await helpfulReviewsResponse.json();

        if (!helpfulReviewsData.success) {
            throw new Error('Failed to fetch helpful reviews');
        }

        const querySummary = helpfulReviewsData.query_summary;
        const numPosReviews = querySummary.total_positive;
        const numNegReviews = querySummary.total_negative;
        const gameRating = querySummary.review_score_desc; // e.g., "Very Positive"

        // remove short reviews
        const mostHelpfulReviews = helpfulReviewsData.reviews.filter(review =>
            review.review && review.review.length > 20
        );

        // get recent reviews (20)
        const recentReviewsResponse = await fetch(
            `https://store.steampowered.com/appreviews/${appid}?json=1&filter=recent&language=all&num_per_page=20`
        );
        const recentReviewsData = await recentReviewsResponse.json();

        if (!recentReviewsData.success) {
            throw new Error('Failed to fetch recent reviews');
        }

        // remove short reviews
        const recentReviews = recentReviewsData.reviews.filter(review =>
            review.review && review.review.length > 20
        );

        return {
            gameName,
            gameTags,
            gameDescription,
            gameRating,
            numPosReviews,
            numNegReviews,
            mostHelpfulReviews,
            recentReviews
        };
    } catch (error) {
        console.error('Error fetching game info:', error);
        throw error;
    }
}

async function summarizeReviews(prompt, gameInfo) {
    try {
        const filledPrompt = prompt
            .replace("$gameName$", gameInfo.gameName)
            .replace("$gameTags$", gameInfo.gameTags.join(', '))
            .replace("$gameDescription$", gameInfo.gameDescription)
            .replace("$gameRating$", gameInfo.gameRating)
            .replace("$numPosReviews$", gameInfo.numPosReviews)
            .replace("$numNegReviews$", gameInfo.numNegReviews)
            .replace("$mostHelpfulReviews$", JSON.stringify(gameInfo.mostHelpfulReviews))
            .replace("$recentReviews$", JSON.stringify(gameInfo.recentReviews));

        const response = await openai.chat.completions.create({
            model: "gpt-4.1-nano",
            messages: [
                {
                    role: "user",
                    content: filledPrompt,
                },
            ],
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error calling ChatGPT API:", error);
        throw error;
    }
}

async function testGetGameInfo(appid) {
    try {
        console.log(`Testing getGameInfo with appid: ${appid}`);
        const gameInfo = await getGameInfo(appid);

        console.log('\n=== Game Information ===');
        console.log(`Game Name: ${gameInfo.gameName}`);
        console.log(`Game Tags: ${gameInfo.gameTags.join(', ')}`);
        console.log(`Game Rating: ${gameInfo.gameRating}`);
        console.log(`Game Description: ${gameInfo.gameDescription}`);
        console.log(`Positive Reviews: ${gameInfo.numPosReviews}`);
        console.log(`Negative Reviews: ${gameInfo.numNegReviews}`);

        console.log('\n=== Most Helpful Reviews ===');
        console.log(`Number of helpful reviews (after filtering): ${gameInfo.mostHelpfulReviews.length}`);
        gameInfo.mostHelpfulReviews.forEach((review, index) => {
            console.log(`\nReview ${index + 1}:`);
            console.log(`Voted Up: ${review.voted_up}`);
            console.log(`Review: ${review.review}`);
            console.log(`Playtime: ${review.author.playtime_forever} hours`);
        });

        console.log('\n=== Recent Reviews ===');
        console.log(`Number of recent reviews (after filtering): ${gameInfo.recentReviews.length}`);
        gameInfo.recentReviews.forEach((review, index) => {
            console.log(`\nReview ${index + 1}:`);
            console.log(`Voted Up: ${review.voted_up}`);
            console.log(`Review: ${review.review}`);
            console.log(`Playtime: ${review.author.playtime_forever} hours`);
        });

        console.log('\n=== GPT Summarize ===');
        const summary = await summarizeReviews(prompt, gameInfo);
        console.log(summary);

        console.log('\n==== Inserting to DB ===');
        const finalInfo = {
            gameId: appid,
            ...gameInfo,
            summary
        };
        await insert(finalInfo);

        console.log('\n==== Fetching from DB ===');
        const dbEntry = await exist(appid);
        if (dbEntry) {
            console.log('Database Entry:');
            console.log(`Game: ${dbEntry.gameName}`);
            console.log(`Age: ${dbEntry.ageInDays} days`);
            console.log(`Summary: ${dbEntry.summary}`);
        } else {
            console.log('No database entry found');
        }

    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

// test
(async () => {
    try {
        // Cs2
        await testGetGameInfo('730');
    } catch (error) {
        console.error('Test failed:', error);
    }
})();

