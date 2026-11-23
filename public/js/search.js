
const form = document.querySelector(".search-panel");
const input = form.elements.in;
const submit = form.querySelector("[type=submit]");
const label = form.querySelector("[data-button-label]");
const example = form.querySelector("[data-example]");
const loading = form.querySelector(".loading");

example.hidden = false;
example.addEventListener("click", () => {
    input.value = "https://store.steampowered.com/app/620/Portal_2/";
    input.focus();
});

form.addEventListener("submit", event => {
    if (submit.disabled) {
        event.preventDefault();
        return;
    }
    submit.disabled = true;
    label.textContent = "Analyzing…";
    loading.hidden = false;
});

window.addEventListener("pageshow", () => {
    submit.disabled = false;
    label.textContent = "Summarize reviews";
    loading.hidden = true;
});
