// users.js

const API_URL = 'https://jsonplaceholder.typicode.com/users';

// DOM elements
const loadButton = document.getElementById('load-users');
const filterInput = document.getElementById('filter-input');
const statusEl = document.getElementById('status');
const usersListEl = document.getElementById('users-list');

// Store loaded users
let allUsers = [];

/**
 * Render a list of users into #users-list.
 * If the list is empty, show a message in #status.
 */
function renderUsers(list) {
  // Clear previous list
  usersListEl.innerHTML = '';

  if (list.length === 0) {
    statusEl.textContent = 'No users match your filter.';
    statusEl.classList.remove('error');
    return;
  }

  // Clear status when we have results (loading/success handled elsewhere)
  statusEl.textContent = '';
  statusEl.classList.remove('error');

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
 * Uses async/await with try/catch/finally.
 */
async function loadUsers() {
  loadButton.disabled = true;
  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');

  try {
    // --- To test the error path, temporarily change the URL below ---
    // e.g. const response = await fetch('https://jsonplaceholder.typicode.com/invalid-users');
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();
    allUsers = data;

    // Render all users
    renderUsers(allUsers);

    // Success message (overrides the empty status from renderUsers)
    statusEl.textContent = `Loaded ${data.length} users.`;
    statusEl.classList.remove('error');
  } catch (error) {
    statusEl.textContent = `Failed to load users: ${error.message}`;
    statusEl.classList.add('error');
    usersListEl.innerHTML = ''; // clear list on error
  } finally {
    loadButton.disabled = false;
  }
}

// --- Event listeners ---

loadButton.addEventListener('click', loadUsers);

filterInput.addEventListener('input', () => {
  const filterText = filterInput.value.trim().toLowerCase();

  if (allUsers.length === 0) {
    // No users loaded yet; show message
    renderUsers([]);
    return;
  }

  const filtered = allUsers.filter(user =>
    user.name.toLowerCase().includes(filterText)
  );

  renderUsers(filtered);
});