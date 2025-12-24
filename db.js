// db.js
import mysql from "mysql2/promise"; // promise version for async/await

const db = await mysql.createPool({
  host: "localhost", // or your MySQL host
  user: "root",      // your MySQL username
  password: "Rohitsukale@123",      // your MySQL password
  database: "LibraryManagement", // your database name
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

console.log("✅ Connected to MySQL Database");
export default db;
