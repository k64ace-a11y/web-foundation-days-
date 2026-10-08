-- ============================================================
-- Day 6 assignment: School database (SQLite)
-- Entities: students, courses, and enrolments (the join table
-- that records that a student is enrolled on a course, with a grade).
-- ============================================================

PRAGMA foreign_keys = ON;

-- Drop in reverse dependency order so re-running the script is safe.
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

-- ------------------------------------------------------------
-- students: one row per person. Email must be unique, name required.
-- ------------------------------------------------------------
CREATE TABLE students (
    student_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE
);

-- ------------------------------------------------------------
-- courses: one row per course. Title is required and unique.
-- ------------------------------------------------------------
CREATE TABLE courses (
    course_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT NOT NULL UNIQUE
);

-- ------------------------------------------------------------
-- enrolments: join table between students and courses.
-- Holds the grade, which belongs to the relationship, not to
-- either entity on its own. The UNIQUE(student_id, course_id)
-- rule stops the same student enrolling on the same course twice.
-- ------------------------------------------------------------
CREATE TABLE enrolments (
    enrolment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   INTEGER NOT NULL REFERENCES students(student_id),
    course_id    INTEGER NOT NULL REFERENCES courses(course_id),
    grade        TEXT,
    UNIQUE (student_id, course_id)
);

-- ============================================================
-- Sample data
-- ============================================================

INSERT INTO students (name, email) VALUES
    ('Alice Johnson', 'alice.johnson@example.com'),
    ('Ben Carter',    'ben.carter@example.com'),
    ('Chloe Nguyen',  'chloe.nguyen@example.com'),
    ('Dan Okafor',    'dan.okafor@example.com');   -- enrolled on nothing, on purpose

INSERT INTO courses (title) VALUES
    ('Databases 101'),
    ('Web Development'),
    ('Data Structures');

INSERT INTO enrolments (student_id, course_id, grade) VALUES
    -- Alice: Databases 101 and Web Development
    ((SELECT student_id FROM students WHERE email = 'alice.johnson@example.com'),
     (SELECT course_id  FROM courses  WHERE title = 'Databases 101'), 'A'),
    ((SELECT student_id FROM students WHERE email = 'alice.johnson@example.com'),
     (SELECT course_id  FROM courses  WHERE title = 'Web Development'), 'B+'),
    -- Ben: Databases 101 and Data Structures
    ((SELECT student_id FROM students WHERE email = 'ben.carter@example.com'),
     (SELECT course_id  FROM courses  WHERE title = 'Databases 101'), 'B'),
    ((SELECT student_id FROM students WHERE email = 'ben.carter@example.com'),
     (SELECT course_id  FROM courses  WHERE title = 'Data Structures'), 'A-'),
    -- Chloe: Web Development only
    ((SELECT student_id FROM students WHERE email = 'chloe.nguyen@example.com'),
     (SELECT course_id  FROM courses  WHERE title = 'Web Development'), 'A');

-- ============================================================
-- Query 1: all courses for one student (by name)
-- ============================================================
SELECT s.name AS student, c.title AS course, e.grade
FROM students s
JOIN enrolments e ON e.student_id = s.student_id
JOIN courses    c ON c.course_id  = e.course_id
WHERE s.name = 'Alice Johnson'
ORDER BY c.title;

-- ============================================================
-- Query 2: all students on one course
-- ============================================================
SELECT c.title AS course, s.name AS student, s.email, e.grade
FROM courses c
JOIN enrolments e ON e.course_id  = c.course_id
JOIN students   s ON s.student_id = e.student_id
WHERE c.title = 'Databases 101'
ORDER BY s.name;

-- ============================================================
-- Query 3: number of students per course
-- LEFT JOIN so a course with no enrolments still shows up, as 0.
-- COUNT(e.student_id) ignores NULLs, so empty courses count 0.
-- ============================================================
SELECT c.title AS course, COUNT(e.student_id) AS student_count
FROM courses c
LEFT JOIN enrolments e ON e.course_id = c.course_id
GROUP BY c.course_id, c.title
ORDER BY student_count DESC, c.title;

-- ============================================================
-- Query 4: students who have no enrolments
-- ============================================================
SELECT s.student_id, s.name, s.email
FROM students s
LEFT JOIN enrolments e ON e.student_id = s.student_id
WHERE e.enrolment_id IS NULL
ORDER BY s.name;

-- ============================================================
-- Query 5: update one enrolment's grade, then show the result
-- ============================================================
UPDATE enrolments
SET grade = 'A'
WHERE student_id = (SELECT student_id FROM students WHERE email = 'ben.carter@example.com')
  AND course_id  = (SELECT course_id  FROM courses  WHERE title = 'Databases 101');

SELECT s.name AS student, c.title AS course, e.grade
FROM enrolments e
JOIN students s ON s.student_id = e.student_id
JOIN courses  c ON c.course_id  = e.course_id
WHERE s.email = 'ben.carter@example.com'
ORDER BY c.title;