(async () => {
  const s = await browser.runtime.sendMessage({ type: "popup-state" });
  document.getElementById("n").textContent = String(s.blocked);
  const list = document.getElementById("list");
  for (const u of s.urls.slice(-6)) {
    const li = document.createElement("li");
    li.textContent = u;
    list.appendChild(li);
  }
  document.getElementById("opts").addEventListener("click", () => browser.runtime.openOptionsPage());
})();
