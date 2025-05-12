const pattern = /https:\/\/store.steampowered.com\/app\/(\d+)\/([^]+)/i;

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