# School database design

## Tables

**students** — one row per person on the system. `student_id` is the primary
key, `name` is required (`NOT NULL`), and `email` is both required and
`UNIQUE` so two students can never share a login identity.

**courses** — one row per course that can be taught. `course_id` is the
primary key and `title` is required and `UNIQUE`, so "Databases 101" exists
once and can be referred to unambiguously.

**enrolments** — one row per *enrolment event*: a particular student on a
particular course, with the grade they received. `enrolment_id` is the
primary key, and `student_id` and `course_id` are foreign keys pointing back
at the two tables above. Both are `NOT NULL` (an enrolment must have both
sides), while `grade` is nullable because a student can be enrolled but not
yet graded. `UNIQUE (student_id, course_id)` prevents the same student being
enrolled on the same course twice.

## Relationships

**students → enrolments is one-to-many.** One student can have many
enrolments; each enrolment row belongs to exactly one student. The foreign
key lives on the "many" side, in `enrolments`.

**courses → enrolments is one-to-many.** Same shape from the other
direction: one course has many enrolments, each enrolment is for one course.

**students ↔ courses is many-to-many.** A student takes many courses, and a
course has many students. A relational table can't store that directly —
there's nowhere to put the list without either duplicating student rows or
storing a comma-separated list, both of which break the model. So the
relationship gets its own table. `enrolments` is that join table: each row
is one student/course pairing, and the two foreign keys together express the
many-to-many link. It also gives the relationship somewhere to keep its own
attribute, `grade` — a grade isn't a property of a student or of a course,
it's a property of the fact that *this* student took *that* course, which is
exactly why it belongs on the join table.

## Index I would add

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments(course_id);