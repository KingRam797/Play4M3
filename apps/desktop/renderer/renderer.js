// Static renderer for the Phase 0 shell. No inline script (CSP), no Node.
(async () => {
  const out = document.getElementById("ping");
  try {
    const brand = await window.station.brand();
    document.getElementById("title").textContent = brand.stationName;
    const r = await window.station.ping("hello");
    out.textContent = r.pong === "hello" ? `ok (v${r.version})` : "mismatch";
  } catch {
    out.textContent = "failed";
  }
})();
