
const form = document.querySelector(".search-panel");
const input = form.elements.in;
const example = form.querySelector("[data-example]");
const list = form.querySelector("[data-game-results]");
const status = form.querySelector("[data-search-status]");
let timer;
let active;

function renderGames(games) {
    list.replaceChildren();
    for (const game of games) {
        const wrapper = document.createElement("li");
        const button = document.createElement("button");
        button.type = "submit";
        button.name = "appId";
        button.value = String(game.id);

        const image = document.createElement("img");
        image.src = "https://cdn.akamai.steamstatic.com/steam/apps/" + game.id + "/header.jpg";
        image.alt = "";
        image.width = 92;
        image.height = 43;

        const text = document.createElement("span");
        const name = document.createElement("b");
        name.textContent = game.name;
        const appId = document.createElement("small");
        appId.textContent = "App ID " + game.id;
        text.append(name, appId);

        const arrow = document.createElement("span");
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "→";
        button.append(image, text, arrow);
        wrapper.append(button);
        list.append(wrapper);
    }
    list.hidden = games.length === 0;
    status.textContent = games.length ? "Select a game to analyze." : "No matches. Try another name or a Steam App ID.";
}

function scheduleSearch() {
    clearTimeout(timer);
    active?.abort();
    list.replaceChildren();
    list.hidden = true;
    status.textContent = "";
    input.removeAttribute("aria-invalid");
    const previousError = form.querySelector("#search-error");
    if (previousError) {
        previousError.remove();
        input.setAttribute("aria-describedby", "search-hint");
    }

    const term = input.value.trim();
    if (term.length < 2 || term.length > 100 ||
        /^(?:\d+$|\w+:\/\/|store\.steampowered\.com(?:\/|$))/i.test(term)) return;

    timer = setTimeout(async () => {
        const controller = new AbortController();
        active = controller;
        status.textContent = "Searching Steam…";
        try {
            const response = await fetch("/api/games?q=" + encodeURIComponent(term), { signal: controller.signal });
            if (!response.ok) throw new Error("Search unavailable");
            const { games } = await response.json();
            if (!controller.signal.aborted) renderGames(games);
        } catch {
            if (!controller.signal.aborted) {
                status.textContent = "Steam search is unavailable. Try again, or enter an App ID or Steam URL.";
            }
        }
    }, 300);
}

input.addEventListener("input", event => { if (!event.isComposing) scheduleSearch(); });
input.addEventListener("compositionend", scheduleSearch);
example.hidden = false;
example.addEventListener("click", () => {
    input.value = "Portal 2";
    input.focus();
    scheduleSearch();
});
