
const copyButton = document.querySelector("[data-copy-link]");
const copyStatus = document.querySelector("[data-copy-status]");
if (copyButton && navigator.clipboard) {
    copyButton.hidden = false;
    copyButton.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(window.location.origin + window.location.pathname);
            copyStatus.textContent = "Link copied.";
        } catch {
            copyStatus.textContent = "Copy the link from your address bar.";
        }
    });
}

const panel = document.querySelector("[data-status-url]");
if (panel) {
    const heading = panel.querySelector("h1");
    const message = panel.querySelector("[data-analysis-message]");
    let failures = 0;
    let lastStatus = panel.dataset.status;
    async function checkStatus() {
        try {
            const response = await fetch(panel.dataset.statusUrl, { cache: "no-store" });
            if (response.status === 404) {
                window.location.reload();
                return;
            }
            if (!response.ok) throw new Error("Status unavailable");
            const { status } = await response.json();
            if (status !== "queued" && status !== "running") {
                window.location.reload();
                return;
            }
            failures = 0;
            if (status !== lastStatus) {
                lastStatus = status;
                heading.textContent = status === "running" ? "Analyzing Steam reviews" : "Analysis queued";
                message.textContent = status === "running"
                    ? "We’re reading recent and helpful reviews. You can close this page and return using the same link."
                    : "Your request is in the queue. You can close this page and return using the same link.";
            }
        } catch {
            failures++;
            if (failures >= 4) {
                message.textContent = "Automatic status checks have paused. Use Check status to try again.";
                return;
            }
        }
        setTimeout(checkStatus, failures ? 5000 : 2500);
    }
    setTimeout(checkStatus, 2500);
}
