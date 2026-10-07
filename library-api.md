# Library API — Books Resource

REST API design for managing books in a library.

## Base URL

`/api`

## Endpoints

### List all books

- **Method:** `GET`
- **Path:** `/books`
- **Description:** Retrieve a list of all books.
- **Request body:** None.
- **Success status:** `200 OK`

---

### Get a single book

- **Method:** `GET`
- **Path:** `/books/{id}`
- **Description:** Retrieve a single book by its ID.
- **Request body:** None.
- **Success status:** `200 OK`

---

### Create a new book

- **Method:** `POST`
- **Path:** `/books`
- **Description:** Add a new book to the library.
- **Example request body:**
  ```json
  {
    "title": "The Great Gatsby",
    "author": "F. Scott Fitzgerald",
    "isbn": "978-0743273565",
    "publishedYear": 1925
  }