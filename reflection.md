# Course Reflection
# Course Reflection

The most difficult concept for me was asynchronous JavaScript. At first I did not
understand why my code printed "Promise {<pending>}" instead of data. What helped was
the idea that fetch returns a promise of a future value, and that await pauses only my
function while the rest of the page keeps running. Rebuilding the user directory
assignment twice, and watching the requests in the Network tab, made it click.

In my capstone, the feedback said my architecture diagram had good components but I did
not explain the cache invalidation clearly. I would improve this by showing the POST
/notes flow step by step on the diagram, including exactly when the cached notes are
deleted. Writing out the delete step as its own box on the diagram forced me to notice
that I was invalidating the cache before the database write committed.

Next, I want to build a real backend for QuickNotes with Node.js, Express and
PostgreSQL, so that my API design and data model become working code. After that I plan
to learn React.