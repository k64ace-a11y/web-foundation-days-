# Library API — Books Resource

REST API design for managing books in a library.

## Conventions

- Base URL: `/api`
- All request and response bodies are `application/json`.
- `{id}` is the book's unique identifier (integer).

---

## Endpoints

### 1. List all books

- **Method:** `GET`
- **Path:** `/books`
- **Description:** Retrieve a list of every book in the library.
- **Request body:** None.
- **Success status:** `200 OK`

---

### 2. Get a single book

- **Method:** `GET`
- **Path:** `/books/{id}`
- **Description:** Retrieve one book by its ID.
- **Request body:** None.
- **Success status:** `200 OK`

---

### 3. Create a new book

- **Method:** `POST`
- **Path:** `/books`
- **Description:** Add a new book to the library.
- **Example request body:**

~~~json
{
  "title": "The Great Gatsby",
  "author": "F. Scott Fitzgerald",
  "isbn": "978-0743273565",
  "publishedYear": 1925
}
~~~

- **Success status:** `201 Created`

---

### 4. Update an existing book (full replace)

- **Method:** `PUT`
- **Path:** `/books/{id}`
- **Description:** Replace an existing book with a complete new representation.
- **Example request body:**

~~~json
{
  "title": "The Great Gatsby (Revised Edition)",
  "author": "F. Scott Fitzgerald",
  "isbn": "978-0743273565",
  "publishedYear": 1925
}
~~~

- **Success status:** `200 OK`

---

### 5. Partially update an existing book

- **Method:** `PATCH`
- **Path:** `/books/{id}`
- **Description:** Update only the fields supplied, leaving the rest unchanged.
- **Example request body:**

~~~json
{
  "publishedYear": 1926
}
~~~

- **Success status:** `200 OK`

---

### 6. Delete a book

- **Method:** `DELETE`
- **Path:** `/books/{id}`
- **Description:** Remove a book from the library permanently.
- **Request body:** None.
- **Success status:** `204 No Content`

---

### 7. List books by author

- **Method:** `GET`
- **Path:** `/books?author={authorName}`
- **Description:** Retrieve every book written by a specific author. The author name
  is passed as a query parameter and matched case-insensitively.
- **Request body:** None.
- **Example request:** `GET /api/books?author=F.%20Scott%20Fitzgerald`
- **Success status:** `200 OK`

---

## Error Codes

### 400 Bad Request

Returned when the request itself is malformed or the payload fails validation.

- **Example:** `POST /api/books` with a body that omits the required `title` field,
  or sends `publishedYear` as a string instead of a number. The server rejects it
  rather than storing incomplete data.

### 404 Not Found

Returned when the requested resource does not exist.

- **Example:** `GET /api/books/9999` when no book with ID `9999` has ever been
  created. The same code applies to `PUT`, `PATCH`, and `DELETE` on a missing ID.