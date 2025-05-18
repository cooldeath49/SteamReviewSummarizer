const path = require("path");
const express= require("express");
const app = express();
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config({
    path: path.resolve(__dirname, ".env"),
});

// mongoDB init - make it optional
let client, database, collection;
const databaseName = "MainDB";
const collectionName = "GameInfo";
const uri = process.env.MONGO_CONNECTION_STRING;

// Only initialize MongoDB if we have a connection string
if (uri) {
    client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });
    database = client.db(databaseName);
    collection = database.collection(collectionName);
}

const portNumber = 3000;

app.use(express.urlencoded({ extended: false }));

// openai init
const API_URL = 'https://api.openai.com/v1/chat/completions';
const API_KEY = process.env.OPENAI_API;
var prompt =
    `Your mission is to to summarize the reviews about this game. Make sure to use clear, accurate, not overly analytical tone,
    and pay attention for any changes between most recent reviews and most helpful reviews. 
    Ignore the reviews that don't provide related information
    Your output should only contain the result as raw text (no markdown) and nothing else. STRICTLY FOLLOW THESE RULES.
    Below are the given information
    Game: $gameName$,
    Tags: $gameTags$,
    Rating: $gameRating$,
    Number of Pos Reviews: $numPosReviews$,
    Number of Neg Reviews: $numNegReviews$,
    Most Helpful Reviews: $mostHelpfulReviews$,
    Past 30 Days Reviews: $recentReivews$`;

// ejs
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, 'templates'));

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
        insert(info.gameName, info.gameTags, info.gameRating, info.numPosReviews, info.numNegReviews, summary);
        finalInfo = {
            gameId: appid,
            gameName: info.gameName,
            gameTags: info.gameTags,
            numPosReviews: info.numPosReviews,
            numNegReviews: info.numNegReviews,
            summary: summary,
        }
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
async function insert(name, tags, rating, numPosReviews, numNegReviews, reviewSummary){
    try {
        await client.connect();
        /* Inserting one movie */
        const game = {
            gameName: name,
            gameTags: tags,
            numPosReviews: numPosReviews,
            numNegReviews: numNegReviews,
            summary: reviewSummary,
            time: new Date()
        };

        let result = await collection.insertOne(game);
        console.log(`insert id: ${result.insertedId}`);
        return result;
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

// too lazy to write two seperate functions lol
async function lookupDB(appid) {
    let result;
    try {
        await client.connect();
        console.log(`looking up: email='${email}', gpa=${gpa}`);

        if (email && email.length > 0) {
            const filter = { emailAddress: email };
            console.log("filter:", filter);
            result = await collection.findOne(filter);
            console.log("findOne result:", result);
        } else if (gpa > 0) {
            const filter = { gpa: { $gte: gpa } };
            console.log("filter:", filter);
            const cursor = collection.find(filter);
            result = await cursor.toArray();
            console.log("find result (array):", result);
        } else {
            console.log("no email or positive gpa");
        }

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
    let result;
}

async function getGameInfo(appid) {
    try {
        // Step 1: Fetch game details (name, tags, and description)
        const appDetailsResponse = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}`);
        const appDetailsData = await appDetailsResponse.json();

        // Check if the request was successful
        if (!appDetailsData[appid].success) {
            throw new Error('Invalid appid or app not found');
        }

        const gameData = appDetailsData[appid].data;
        const gameName = gameData.name;
        const gameTags = gameData.genres.map(genre => genre.description); // Genres as tags
        const gameDescription = gameData.short_description || gameData.detailed_description || 'No description available';

        // Step 2: Fetch most helpful reviews (30 reviews)
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

        // Filter out short reviews (less than 20 characters)
        const mostHelpfulReviews = helpfulReviewsData.reviews.filter(review =>
            review.review && review.review.length > 20
        );

        // Step 3: Fetch recent reviews (20 reviews)
        const recentReviewsResponse = await fetch(
            `https://store.steampowered.com/appreviews/${appid}?json=1&filter=recent&language=all&num_per_page=20`
        );
        const recentReviewsData = await recentReviewsResponse.json();

        if (!recentReviewsData.success) {
            throw new Error('Failed to fetch recent reviews');
        }

        // Filter out short reviews (less than 20 characters)
        const recentReviews = recentReviewsData.reviews.filter(review =>
            review.review && review.review.length > 20
        );

        // Return all requested information
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

async function summarizeReviews(prompt) {
    try {
        const response = await openai.responses.create({
            model: "o4-mini",
            reasoning: { effort: "medium" },
            input: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("Error calling ChatGPT API:", error.response ? error.response.data : error.message);
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

    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

// Test the getGameInfo function directly
(async () => {
    try {
        // Test with Counter-Strike 2
        await testGetGameInfo('730');
    } catch (error) {
        console.error('Test failed:', error);
    }
})();

