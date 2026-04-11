/**
 * editor-flow.mjs — Scenario for branch-continue
 *
 * Drives through: landing → file loaded (time machine) → editor → search modal
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  name: "editor-flow",
  app: "http://localhost:5173",
  startUrl: "/",
  steps: [
    // 1. Proof the landing page
    { action: "proof", state: "landing" },

    // 2. Load a file via file chooser
    {
      action: "filechooser",
      trigger: "button.btn-primary",
      files: resolve(__dirname, "../.textproof/fixture.org"),
    },

    // 3. Wait for time machine cards
    { action: "waitFor", selector: ".tm-stage", timeout: 5000 },
    { action: "wait", ms: 500 },

    // 4. Proof the time machine view
    { action: "proof", state: "time-machine" },

    // 5. Open editor by clicking focused card
    { action: "click", selector: ".tm-card-focused" },
    { action: "waitFor", selector: "article.note-editor", timeout: 5000 },
    { action: "wait", ms: 300 },

    // 6. Proof the editor view
    { action: "proof", state: "editor" },

    // 7. Close editor to access topbar
    { action: "press", key: "Escape" },
    { action: "wait", ms: 300 },

    // 8. Hide Leva debug panel if present, then open search
    { action: "evaluate", fn: "document.querySelector('#leva__root')?.remove()" },
    { action: "click", selector: "button.topbar-search >> text=Search" },
    { action: "waitFor", selector: ".search-modal", timeout: 5000 },
    { action: "wait", ms: 300 },

    // 9. Proof the search modal
    { action: "proof", state: "search-modal" },
  ],
};
