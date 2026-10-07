import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app")!;
root.innerHTML = `
  <h1>Rust Multi-Thread Lab</h1>
  <p>Choose a scenario, then inspect its named Rust workers in Craidd.</p>
  <div class="actions">
    <button data-variant="1">1 · Start two waiting workers</button>
    <button data-release>1 · Release workers</button>
    <button data-variant="2">2 · Launch short worker burst</button>
    <button data-variant="3">3 · Producer / consumer handoff</button>
  </div>
  <p id="status" role="status">Choose a variant.</p>
  <p class="hint">Use source markers BREAK_RS_GUI_BASIC, BREAK_RS_GUI_BURST and BREAK_RS_GUI_HANDOFF for breakpoints.</p>
`;

const status = document.querySelector<HTMLElement>("#status")!;
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-variant]")) {
  button.addEventListener("click", async () => {
    try {
      status.textContent = await invoke<string>("start_variant", { variant: Number(button.dataset.variant) });
    } catch (error) { status.textContent = String(error); }
  });
}
document.querySelector<HTMLButtonElement>("[data-release]")!.addEventListener("click", async () => {
  try { status.textContent = await invoke<string>("release_basic"); }
  catch (error) { status.textContent = String(error); }
});
void listen<string>("mt-status", (event) => { status.textContent = event.payload; });
