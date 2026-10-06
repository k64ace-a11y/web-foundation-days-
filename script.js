// ---------- 1. Select elements ----------
const textArea   = document.getElementById("note-text");
const charCount  = document.getElementById("char-count");
const wordCount  = document.getElementById("word-count");
const clearBtn   = document.getElementById("clear-btn");
const themeBtn   = document.getElementById("theme-toggle");

// ---------- 2. Constants ----------
const MAX_CHARS  = 200;
const WARN_CHARS = 180;
const DRAFT_KEY  = "day4-note-draft";
const THEME_KEY  = "day4-theme";

// ---------- 3. updateCounts() ----------
function updateCounts() {
  const text  = textArea.value;
  const chars = text.length;
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

  // Character counter text
  charCount.textContent = `${chars} / ${MAX_CHARS} characters`;
  // Word counter text
  wordCount.textContent = `${words} words`;

  // Remove both classes first so no stale class remains
  charCount.classList.remove("warning", "over");

  if (chars > MAX_CHARS) {
    charCount.classList.add("over");        // red + bold
  } else if (chars > WARN_CHARS) {
    charCount.classList.add("warning");      // orange
  }
}

// ---------- 4. Draft helpers ----------
function saveDraft() {
  localStorage.setItem(DRAFT_KEY, textArea.value);
}

function restoreDraft() {
  // getItem returns null when nothing is saved → fall back to ""
  textArea.value = localStorage.getItem(DRAFT_KEY) || "";
}

// ---------- 5. Clear everything ----------
function clearAll() {
  textArea.value = "";
  localStorage.removeItem(DRAFT_KEY);
  updateCounts();
  textArea.focus();
}

// ---------- 6. Theme helpers ----------
function applyTheme(theme) {
  const isDark = theme === "dark";
  // classList.toggle(name, force) – force true = add, false = remove
  document.body.classList.toggle("dark", isDark);
  themeBtn.textContent = isDark ? "Light mode" : "Dark mode";
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  const theme  = isDark ? "dark" : "light";
  themeBtn.textContent = isDark ? "Light mode" : "Dark mode";
  localStorage.setItem(THEME_KEY, theme);
}

// ---------- 7. Event listeners ----------
textArea.addEventListener("input", () => {
  updateCounts();
  saveDraft();
});

textArea.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    clearAll();
  }
});

clearBtn.addEventListener("click", clearAll);
themeBtn.addEventListener("click", toggleTheme);

// ---------- 8. Restore saved state on page load ----------
restoreDraft();
applyTheme(localStorage.getItem(THEME_KEY) || "light");
updateCounts();