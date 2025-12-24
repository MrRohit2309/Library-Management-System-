// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import db from "./db.js";

const app = express();

// 🔧 Function to automatically recalculate available copies
async function updateBookAvailability(book_id) {
  await db.query(`
    UPDATE Books b SET available_copies =
      b.total_copies -
      (SELECT COUNT(*) FROM IssuedBooks i 
        WHERE i.book_id = b.book_id AND i.return_date IS NULL)
    WHERE b.book_id = ?
  `, [book_id]);
}

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// ===============================
// 📚 BOOKS API
// ===============================
// ===============================
// 📚 ADD BOOK (Prevent Duplicate Titles)
// ===============================
app.post("/api/books", async (req, res) => {
  try {
    const { title, author_name, genre, total_copies } = req.body;

    if (!title || !total_copies) {
      return res.status(400).json({ error: "Title and copies are required" });
    }

    const copiesToAdd = Number(total_copies);

    // 1️⃣ Check if book with same TITLE exists (case-insensitive)
    const [existing] = await db.query(
      `SELECT * FROM Books WHERE LOWER(TRIM(title)) = LOWER(TRIM(?))`,
      [title]
    );

    // 2️⃣ If book exists → add extra copies
    if (existing.length > 0) {
      const book = existing[0];

      const updatedTotal = book.total_copies + copiesToAdd;
      const updatedAvailable = book.available_copies + copiesToAdd;

      await db.query(
        `UPDATE Books 
         SET total_copies = ?, available_copies = ?
         WHERE book_id = ?`,
        [updatedTotal, updatedAvailable, book.book_id]
      );

      return res.json({
        success: true,
        message: "Book already exists → added extra copies.",
        book_id: book.book_id
      });
    }

    // 3️⃣ Insert new book
    const [result] = await db.query(
      `INSERT INTO Books (title, author_name, genre, total_copies, available_copies)
       VALUES (?, ?, ?, ?, ?)`,
      [title, author_name, genre, copiesToAdd, copiesToAdd]
    );

    res.json({
      success: true,
      message: "New book added successfully",
      book_id: result.insertId
    });
  } catch (err) {
    console.error("❌ Error adding book:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📚 GET ALL BOOKS (REQUIRED FOR FRONTEND)
// ===============================
app.get("/api/books", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM Books ORDER BY book_id DESC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching books:", err);
    res.status(500).json({ error: "Failed to fetch books" });
  }
});

// --- SAFE DELETE BOOK (Correct Logic) ---
app.delete("/api/books/:id", async (req, res) => {
  const bookId = req.params.id;

  try {
    // 1️⃣ BLOCK deletion if currently issued
    const [[activeIssue]] = await db.query(
      "SELECT COUNT(*) AS cnt FROM IssuedBooks WHERE book_id = ? AND return_date IS NULL",
      [bookId]
    );

    if (activeIssue.cnt > 0) {
      return res.status(400).json({
        error: "Cannot delete book — it is currently issued to a student."
      });
    }

    // 2️⃣ Allow delete even if history exists (SET NULL will handle it)
    const [result] = await db.query(
      "DELETE FROM Books WHERE book_id = ?",
      [bookId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Book not found" });
    }

    res.json({ success: true, message: "Book deleted successfully" });

  } catch (err) {
    console.error("❌ Error deleting book:", err);
    res.status(500).json({ error: "Failed to delete book" });
  }
});

// --- PUT (EDIT) Book ---
app.put("/api/books/:id", async (req, res) => {
  const { id } = req.params;
  const { title, author_name, genre, total_copies } = req.body;

  try {
    if (!title || !author_name || !genre || !total_copies) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const newTotal = parseInt(total_copies, 10);

    // 1️⃣ Fetch old book data
    const [[oldBook]] = await db.query(
      "SELECT total_copies, available_copies FROM Books WHERE book_id = ?",
      [id]
    );

    if (!oldBook) {
      return res.status(404).json({ error: "Book not found" });
    }

    const oldTotal = oldBook.total_copies;
    const oldAvailable = oldBook.available_copies;

    let newAvailable;

    if (newTotal > oldTotal) {
      // 2️⃣ Increase available copies by added amount
      const diff = newTotal - oldTotal;
      newAvailable = oldAvailable + diff;
    } else {
      // 3️⃣ If total decreased, clamp available
      newAvailable = Math.min(oldAvailable, newTotal);
    }

    // 4️⃣ Update book with new values
    await db.query(
      `UPDATE Books 
       SET title = ?, author_name = ?, genre = ?, total_copies = ?, available_copies = ?
       WHERE book_id = ?`,
      [title, author_name, genre, newTotal, newAvailable, id]
    );

    res.json({
      success: true,
      message: "Book updated successfully",
      total_copies: newTotal,
      available_copies: newAvailable
    });

  } catch (err) {
    console.error("❌ Error updating book:", err);
    res.status(500).json({ error: err.message || "Failed to update book" });
  }
});

// ===============================
// 🎓 STUDENTS API
// ===============================
app.get("/api/students", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM Students");
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching students:", err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});




app.post("/api/students", async (req, res) => {
  const { student_id, student_name, email, department, year, contact_no } = req.body;

  if (!student_name || !email) {
    return res.status(400).json({ error: "Student name and email are required" });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO Students (student_id, student_name, email, department, year, contact_no)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [student_id || null, student_name, email, department, year, contact_no]
    );

    res.json({ success: true, student_id: result.insertId });
  } catch (err) {
    console.error("❌ Error adding student:", err);

    if (err.sqlState === "45000") {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Duplicate email or duplicate student ID!" });
    }

    res.status(500).json({ error: "Database insert failed" });
  }
});




app.delete("/api/students/:id", async (req, res) => {
  const studentId = req.params.id;

  try {
    // 1️⃣ Check active issues
    const [[activeIssue]] = await db.query(
      "SELECT COUNT(*) AS cnt FROM IssuedBooks WHERE student_id = ? AND return_date IS NULL",
      [studentId]
    );

    if (activeIssue.cnt > 0) {
      return res.status(400).json({
        error: "Cannot delete student — books are issued by this student."
      });
    }

    // 2️⃣ Remove foreign key references by setting NULL (preserving history)
    await db.query(
      "UPDATE IssuedBooks SET student_id = NULL WHERE student_id = ?",
      [studentId]
    );

    // 3️⃣ Now delete the student
    const [result] = await db.query(
      "DELETE FROM Students WHERE student_id = ?",
      [studentId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json({
      success: true,
      message: "Student deleted successfully (history preserved)."
    });

  } catch (err) {
    console.error("❌ Error deleting student:", err.message);
    res.status(500).json({ error: "Delete failed" });
  }
});


// --- PUT (EDIT) Student ---

app.put("/api/students/:id", async (req, res) => {
  const { id } = req.params;
  const { student_id, student_name, email, department, year, contact_no } = req.body;

  if (!student_name || !email) {
    return res.status(400).json({ error: "Student name and email are required" });
  }

  try {
    const [result] = await db.query(
      `UPDATE Students
       SET student_id = ?, student_name = ?, email = ?, department = ?, year = ?, contact_no = ?
       WHERE student_id = ?`,
      [student_id, student_name, email, department, year, contact_no, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json({ success: true, message: "Student updated successfully" });

  } catch (err) {
    console.error("❌ Error updating student:", err);

    if (err.sqlState === "45000") {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: "Failed to update student" });
  }
});



// ===============================
// 📦 ISSUED BOOKS API
// ===============================
app.post("/api/issued", async (req, res) => {
  const { student_id, book_id, due_date } = req.body;

  if (!student_id || !book_id) {
    return res.status(400).json({ error: "Student ID and Book ID are required" });
  }

  try {
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString()
      .split("T")[0];

    const due = due_date
      ? new Date(new Date(due_date).getTime() - new Date().getTimezoneOffset() * 60000)
          .toISOString()
          .split("T")[0]
      : null;

    const [result] = await db.query(
      `INSERT INTO IssuedBooks (student_id, book_id, issue_date, due_date)
       VALUES (?, ?, ?, ?)`,
      [student_id, book_id, localDate, due]
    );

    // Auto-recalculate availability after issuing book
await updateBookAvailability(book_id);


    res.json({ success: true, issue_id: result.insertId });
  } catch (err) {
    console.error("❌ Error issuing book:", err);
    res.status(500).json({ error: "Failed to issue book" });
  }
});

// ===============================
// 📗 GET ALL ISSUED BOOKS (WITH REAL FINE CALCULATION)
// ===============================
app.get("/api/issued", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        i.issue_id,
        i.student_id,
        b.title AS book_title,
        s.student_name,
        i.issue_date,
        i.due_date,
        i.return_date,

        -- Fine for currently issued books only
        CASE
          WHEN CURDATE() > i.due_date 
          THEN DATEDIFF(CURDATE(), i.due_date) * 10
          ELSE 0
        END AS fine_amount,

        'Issued' AS status

      FROM IssuedBooks i
      LEFT JOIN Books b ON i.book_id = b.book_id
      LEFT JOIN Students s ON i.student_id = s.student_id

      -- 🔥 SHOW ONLY BOOKS THAT ARE STILL ISSUED
      WHERE i.return_date IS NULL

      ORDER BY i.issue_id DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching issued books:", err);
    res.status(500).json({ error: "Failed to fetch issued books" });
  }
});


// ===============================
// 📗 RETURN RECORDS API
// ===============================

// GET all return records
app.get("/api/returns", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        r.return_id,
        s.student_id,      -- FIX: actual student id
        b.title AS book_title,
        s.student_name,
        r.return_date,
        r.fine_amount
      FROM ReturnRecords r
      JOIN IssuedBooks i ON r.issue_id = i.issue_id
      JOIN Students s ON i.student_id = s.student_id
      JOIN Books b ON i.book_id = b.book_id
      ORDER BY r.return_id DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching return history");
  }
});



// ===============================
// 📗 RETURN BOOK (with fine message)
// ===============================
// ✅ Return a book (and update availability)

app.post("/api/returns", async (req, res) => {
  const { issue_id } = req.body;

  if (!issue_id) {
    return res.status(400).json({ error: "Issue ID is required" });
  }

  try {
    // Today's date (fixed for India timezone)
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString()
      .split("T")[0];

    // 1️⃣ Get issue details (for fine + book ID)
    const [[issue]] = await db.query(
      "SELECT book_id, due_date FROM IssuedBooks WHERE issue_id = ?",
      [issue_id]
    );

    if (!issue) return res.status(404).json({ error: "Issue record not found" });

    const bookId = issue.book_id;

    // 2️⃣ Correct Fine Calculation (Fix timezone issue)
      const todayLocal = new Date().toISOString().split("T")[0];    // YYYY-MM-DD
      const dueLocal = new Date(issue.due_date).toISOString().split("T")[0];

      // Convert back to Date objects
      const todayDate = new Date(todayLocal);
      const dueDate = new Date(dueLocal);

      // Overdue days (IF today > due)
      const diffDays = Math.ceil((todayDate - dueDate) / (1000*60*60*24));

      // Fine = ₹10 per day
     const fine = diffDays > 0 ? diffDays * 10 : 0;


    // 3️⃣ Insert return record
    await db.query(
      "INSERT INTO ReturnRecords (issue_id, return_date, fine_amount) VALUES (?, ?, ?)",
      [issue_id, localDate, fine]
    );

    // 4️⃣ Mark as returned
    await db.query(
      "UPDATE IssuedBooks SET status='Returned', return_date=? WHERE issue_id=?",
      [localDate, issue_id]
    );

    // 5️⃣ Auto update book availability
    await updateBookAvailability(bookId);

    res.json({
      success: true,
      message: `Book returned successfully${fine > 0 ? ` — Fine: ₹${fine}` : ""}`,
      fine
    });

  } catch (err) {
    console.error("❌ Error returning book:", err);
    res.status(500).json({ error: "Failed to return book" });
  }
});

// ===============================
// ⏰ OVERDUE BOOKS (VIEW)
// ===============================
app.get("/api/overdue", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        i.issue_id,
        s.student_id,
        b.title AS book_title,
        s.student_name,
        i.due_date,
        DATEDIFF(CURDATE(), i.due_date) AS days_overdue,
        (DATEDIFF(CURDATE(), i.due_date) * 10) AS fine_amount
      FROM IssuedBooks i
      JOIN Students s ON i.student_id = s.student_id
      JOIN Books b ON i.book_id = b.book_id
      WHERE i.return_date IS NULL 
        AND i.due_date < CURDATE()
      ORDER BY i.due_date ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching overdue books:", err);
    res.status(500).json({ error: "Failed to fetch overdue books" });
  }
});

// ===============================
// 📊 LIBRARY STATS API (Fixed)
// ===============================
app.get("/api/stats", async (req, res) => {
  try {
    const [[bookCount]] = await db.query("SELECT COUNT(*) AS totalBooks FROM Books");
    const [[availableBooks]] = await db.query("SELECT SUM(available_copies) AS availableBooks FROM Books");
    const [[studentCount]] = await db.query("SELECT COUNT(*) AS totalStudents FROM Students");
    const [[issuedCount]] = await db.query("SELECT COUNT(*) AS booksIssued FROM IssuedBooks");
    const [[overdueCount]] = await db.query("SELECT COUNT(*) AS overdueBooks FROM IssuedBooks WHERE due_date < CURDATE()");
    const [[returnedCount]] = await db.query("SELECT COUNT(*) AS returnedBooks FROM ReturnRecords");
    const [[fineSum]] = await db.query("SELECT COALESCE(SUM(fine_amount),0) AS totalFine FROM ReturnRecords");



    res.json({
      totalBooks: bookCount.totalBooks || 0,
      availableBooks: availableBooks.availableBooks || 0,
      totalStudents: studentCount.totalStudents || 0,
      booksIssued: issuedCount.booksIssued || 0,
      overdueBooks: overdueCount.overdueBooks || 0,
      returnedBooks: returnedCount.returnedBooks || 0,
      totalFine: fineSum.totalFine || 0
    });
  } catch (err) {
    console.error("❌ Error fetching stats:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// 🛠 Fix all availability values
app.get("/api/fix-availability", async (req, res) => {
  await db.query(`
    UPDATE Books b SET available_copies =
      b.total_copies -
      (SELECT COUNT(*) FROM IssuedBooks i 
        WHERE i.book_id = b.book_id AND i.return_date IS NULL)
  `);

  res.json({ message: "Book availability recalculated for all books" });
});



// ===============================
// ✅ START SERVER
// ===============================
const PORT = 4000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
