//Import express, path, and set rt
const express = require("express")
const path = require("path");
const app = express();
const port = 5000;
//Set view engine
app.set("view engine", "ejs");

//Set directory to pages
app.set("views", path.resolve(__dirname, "../pages"));
app.use(express.static("public"));

//regexp pattern for extracting app id and name
const pattern = /https:\/\/store.steampowered.com\/app\/(\d+)\/([^]+)/i;

//clicked function
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

//default home page
app.get("/", (req, res) => {
    console.log("rendered home page");
    res.render("index");
})
//Listen on given port
app.listen(port);
console.log("Server started on port " + port);