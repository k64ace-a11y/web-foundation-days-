// users.js

const API_URL = 'https://jsonplaceholder.typicode.com/users';

// --- DOM elements ---
const loadButton  = document.getElementById('load-users');
const filterInput = document.getElementById('filter-input');
const statusEl    = document.getElementById('status');
const usersListEl = document.getElementById('users-list');

// --- State ---
// Holds the users returned by the API so the filter can work offline.
let allUsers = [];

/**
 * Update the status line and toggle the error style.
 */
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

/**
 * Draw an array of users into #users-list.
 * Only renders — the caller is responsible for the status line.
 */
function renderUsers(list) {
  usersListEl.innerHTML = '';

  list.forEach(user => {
    const li = document.createElement('li');

    const name = document.createElement('h2');
    name.textContent = user.name;
    li.appendChild(name);

    const email = document.createElement('p');
    email.textContent = `Email: ${user.email}`;
    li.appendChild(email);

    const city = document.createElement('p');
    city.textContent = `City: ${user.address.city}`;
    li.appendChild(city);

    const company = document.createElement('p');
    company.textContent = `Company: ${user.company.name}`;
    li.appendChild(company);

    usersListEl.appendChild(li);
  });
}

/**
 * Load users from the API.
 * Uses async / await with try / catch / finally.
 */
async function loadUsers() {
  loadButton.disabled = true;
  setStatus('Loading...');

  try {
    // --- To test the error path, temporarily break the URL below ---
    // e.g. fetch('https://jsonplaceholder.typicode.com/invalid-users')
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();
    allUsers = data;

    renderUsers(allUsers);
    setStatus(`Loaded ${data.length} users.`);

    // Re-apply whatever is already typed in the filter box.
    applyFilter();
  } catch (error) {
    allUsers = [];
    usersListEl.innerHTML = '';
    setStatus(`Failed to load users: ${error.message}`, true);
  } finally {
    loadButton.disabled = false;
  }
}

/**
 * Filter the stored users by the current input value and re-render.
 * Never issues a network request.
 */
function applyFilter() {
  const filterText = filterInput.value.trim().toLowerCase();

  if (allUsers.length === 0) {
    renderUsers([]);
    setStatus('No users loaded yet — click "Load users".');
    return;
  }

  const filtered = allUsers.filter(user =>
    user.name.toLowerCase().includes(filterText)
  );

  renderUsers(filtered);

  if (filtered.length === 0) {
    setStatus('No users match your filter.');
  } else {
    setStatus(`Showing ${filtered.length} of ${allUsers.length} users.`);
  }
}

// --- Event listeners ---
loadButton.addEventListener('click', loadUsers);
filterInput.addEventListener('input', applyFilter);