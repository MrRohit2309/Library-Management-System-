-- db.sql
DROP DATABASE IF EXISTS LibraryManagement;
CREATE DATABASE LibraryManagement;
USE LibraryManagement;

-- Authors
CREATE TABLE Authors (
    author_id INT AUTO_INCREMENT PRIMARY KEY,
    author_name VARCHAR(100) NOT NULL,
    nationality VARCHAR(50)
);

-- Students
CREATE TABLE Students (
    student_id INT AUTO_INCREMENT PRIMARY KEY,
    student_name VARCHAR(100) NOT NULL,
    department VARCHAR(50),
    year INT,
    contact_no VARCHAR(15),
    email VARCHAR(100) UNIQUE
);

-- Books
CREATE TABLE Books (
    book_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    author_id INT,
    genre VARCHAR(50),
    total_copies INT DEFAULT 1,
    available_copies INT DEFAULT 1,
    FOREIGN KEY (author_id) REFERENCES Authors(author_id) ON DELETE SET NULL
);

-- IssuedBooks: active issues (we keep history in ReturnRecords)
CREATE TABLE IssuedBooks (
    issue_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT,
    book_id INT,
    issue_date DATE DEFAULT (CURRENT_DATE),
    due_date DATE,
    FOREIGN KEY (student_id) REFERENCES Students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES Books(book_id) ON DELETE CASCADE
);

-- ReturnRecords: history of returns & fines
CREATE TABLE ReturnRecords (
    return_id INT AUTO_INCREMENT PRIMARY KEY,
    issue_id INT,
    return_date DATE,
    fine_amount DECIMAL(10,2),
    FOREIGN KEY (issue_id) REFERENCES IssuedBooks(issue_id) ON DELETE SET NULL
);

-- SAMPLE DATA
INSERT INTO Authors (author_name, nationality) VALUES
('J.K. Rowling','British'),('George R.R. Martin','American'),('R.K. Narayan','Indian');

INSERT INTO Books (title, author_id, genre, total_copies, available_copies) VALUES
('Harry Potter',1,'Fantasy',5,5),
('Game of Thrones',2,'Fantasy',3,3),
('Malgudi Days',3,'Fiction',4,4);

INSERT INTO Students (student_name, department, year, contact_no, email) VALUES
('Rohit Sukale','Computer Science',2,'9876543210','rohit@example.com'),
('Priya Sharma','IT',3,'9876501234','priya@example.com'),
('Amit Patil','Electronics',1,'9823456789','amit@example.com');

-- PROCEDURES, FUNCTION, TRIGGERS

DELIMITER //

-- IssueBook: prevents duplicate active issues and prevents issuing if no copies
CREATE PROCEDURE IssueBook(IN s_id INT, IN b_id INT)
BEGIN
    DECLARE available INT;
    DECLARE already_issued INT;

    SELECT available_copies INTO available FROM Books WHERE book_id = b_id;
    IF available <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No available copies!';
    ELSE
        SELECT COUNT(*) INTO already_issued
        FROM IssuedBooks i
        LEFT JOIN ReturnRecords r ON i.issue_id = r.issue_id
        WHERE i.student_id = s_id AND i.book_id = b_id AND r.issue_id IS NULL;

        IF already_issued > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This student already has this book issued and not yet returned!';
        ELSE
            INSERT INTO IssuedBooks (student_id, book_id, issue_date, due_date)
            VALUES (s_id, b_id, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 14 DAY));

            UPDATE Books SET available_copies = available_copies - 1 WHERE book_id = b_id;
        END IF;
    END IF;
END //

-- ReturnBook: prevents double return, calculates fine, stores return record, updates available_copies and optionally deletes issued record (we keep issued record for history but mark as returned via ReturnRecords)
CREATE PROCEDURE ReturnBook(IN i_id INT)
BEGIN
    DECLARE due DATE;
    DECLARE fine DECIMAL(10,2);
    DECLARE b_id INT;
    DECLARE already_returned INT;

    SELECT COUNT(*) INTO already_returned FROM ReturnRecords WHERE issue_id = i_id;
    IF already_returned > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This book has already been returned!';
    ELSE
        SELECT due_date, book_id INTO due, b_id FROM IssuedBooks WHERE issue_id = i_id;

        IF CURDATE() > due THEN
            SET fine = DATEDIFF(CURDATE(), due) * 5;  -- ₹5 per day
        ELSE
            SET fine = 0;
        END IF;

        INSERT INTO ReturnRecords (issue_id, return_date, fine_amount)
        VALUES (i_id, CURDATE(), fine);

        UPDATE Books SET available_copies = available_copies + 1 WHERE book_id = b_id;
    END IF;
END //

-- Function to calculate fine on demand
CREATE FUNCTION CalculateFine(issueID INT) RETURNS DECIMAL(10,2)
DETERMINISTIC
BEGIN
    DECLARE fine DECIMAL(10,2);
    DECLARE due DATE;
    DECLARE diff INT;

    SELECT due_date INTO due FROM IssuedBooks WHERE issue_id = issueID;
    IF due IS NULL THEN
        RETURN 0;
    END IF;

    IF CURDATE() > due THEN
        SET diff = DATEDIFF(CURDATE(), due);
        SET fine = diff * 5;
    ELSE
        SET fine = 0;
    END IF;
    RETURN fine;
END //

-- OverdueReport view
CREATE VIEW OverdueReport AS
SELECT 
    i.issue_id,
    s.student_name,
    b.title AS book_title,
    i.issue_date,
    i.due_date,
    CalculateFine(i.issue_id) AS fine_amount
FROM IssuedBooks i
JOIN Students s ON i.student_id = s.student_id
JOIN Books b ON i.book_id = b.book_id
WHERE i.due_date < CURDATE();

DELIMITER ;

-- Optional trigger example to prevent direct insert to IssuedBooks without availability check
DELIMITER //
CREATE TRIGGER check_book_availability
BEFORE INSERT ON IssuedBooks
FOR EACH ROW
BEGIN
    DECLARE available INT;
    SELECT available_copies INTO available FROM Books WHERE book_id = NEW.book_id;
    IF available <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot issue: No copies available!';
    END IF;
END //
DELIMITER ;

-- Notes:
-- To start cleanly, you can DROP PROCEDURE IF EXISTS IssueBook; DROP PROCEDURE IF EXISTS ReturnBook; DROP FUNCTION IF EXISTS CalculateFine; DROP VIEW IF EXISTS OverdueReport;

