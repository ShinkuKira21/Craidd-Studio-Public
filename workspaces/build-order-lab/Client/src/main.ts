import "./style.css";

const api = "http://127.0.0.1:5187";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<main><p class="eyebrow">CRAIDD · BUILD ORDER LAB</p><h1>Three languages.<br>One working application.</h1>
  <div class="chain"><span>C++ library</span><b>→</b><span>C# API</span><b>→</b><span>Tauri V2</span></div>
  <section><p>20 + 22, calculated in C++</p><strong id="value">…</strong><p id="status">Connecting to API…</p></section>
  <button id="refresh">Try again</button><p class="hint">If you see 42, the native library was built, installed beside the .NET output, and called through the API.</p></main>`;

async function refresh() {
  const status = document.querySelector<HTMLParagraphElement>("#status")!;
  const value = document.querySelector<HTMLElement>("#value")!;
  try {
    // /health is only a readiness gate; /sum is the blue LDI call site.
    const response = await fetch(`${api}/sum/20/22`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    value.textContent = String(result.value);
    status.textContent = "Native library installed · API ready · GUI connected";
    status.className = "ready";
  } catch (error) {
    value.textContent = "!";
    status.textContent = `API is not ready: ${String(error)}`;
    status.className = "error";
  }
}
document.querySelector("#refresh")!.addEventListener("click", () => void refresh());
void refresh();
