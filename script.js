// Starting data
let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

// 1. searchNotes
function searchNotes(word) {
  const query = word.toLowerCase();
  return notes.filter(note => note.text.toLowerCase().includes(query));
}

// 2. longestNote
function longestNote() {
  if (notes.length === 0) return null;
  let longest = notes[0];
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].text.length > longest.text.length) {
      longest = notes[i];
    }
  }
  return longest;
}

// 3. countByCategory
function countByCategory() {
  const counts = {};
  for (const note of notes) {
    counts[note.category] = (counts[note.category] || 0) + 1;
  }
  return counts;
}

// 4. getSummary
function getSummary() {
  const counts = countByCategory();
  const total = notes.length;
  const word = total === 1 ? "note" : "notes";
  const order = ["personal", "work", "study"];
  const parts = [];
  for (const cat of order) {
    if (counts[cat]) {
      parts.push(`${counts[cat]} ${cat}`);
    }
  }
  return `${total} ${word}: ${parts.join(", ")}.`;
}

// 5. isDuplicate
function isDuplicate(text) {
  const normalize = (str) => str.trim().toLowerCase().replace(/\s+/g, " ");
  const normalized = normalize(text);
  return notes.some(note => normalize(note.text) === normalized);
}

// 6. addNote
function addNote(text, category) {
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    console.log("Note must be 1-200 characters.");
    return false;
  }
  if (isDuplicate(trimmed)) {
    console.log("Note is a duplicate.");
    return false;
  }
  const allowed = ["personal", "work", "study"];
  if (!allowed.includes(category)) {
    console.log("Category must be personal, work, or study.");
    return false;
  }
  const newId = notes.length > 0 ? Math.max(...notes.map(n => n.id)) + 1 : 1;
  notes.push({ id: newId, text: trimmed, category });
  return true;
}

// -------------------- TESTS --------------------

// searchNotes
console.log(searchNotes("day")); // [ { id: 2, text: "Finish the Day 3 assignment", category: "study" } ]
console.log(searchNotes("xyz")); // []

// longestNote
console.log(longestNote()); // { id: 3, text: "Email the project report to Grace", category: "work" }
const originalNotesForLongest = notes;
notes = [];
console.log(longestNote()); // null
notes = originalNotesForLongest;

// countByCategory
console.log(countByCategory()); // { personal: 2, study: 2, work: 1 }
const originalNotesForCount = notes;
notes = [];
console.log(countByCategory()); // {}
notes = originalNotesForCount;

// getSummary
console.log(getSummary()); // "5 notes: 2 personal, 1 work, 2 study."
const originalNotesForSummary = notes;
notes = [{ id: 99, text: "Test note", category: "work" }];
console.log(getSummary()); // "1 note: 1 work."
notes = originalNotesForSummary;

// isDuplicate
console.log(isDuplicate("buy milk and bread")); // true
console.log(isDuplicate("Buy milk and bread")); // true
console.log(isDuplicate("nonexistent")); // false
console.log(isDuplicate("  Buy   milk and bread  ")); // true

// addNote
console.log(addNote("New valid note", "work")); // true
console.log(notes[notes.length - 1]); // { id: 6, text: "New valid note", category: "work" }
console.log(addNote("", "work")); // false, logs "Note must be 1-200 characters."
console.log(addNote("New valid note", "work")); // false, logs "Note is a duplicate."
console.log(addNote("Another note", "invalid")); // false, logs "Category must be personal, work, or study."