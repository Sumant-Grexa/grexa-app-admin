import express from "express";
import session from "express-session";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import apiRouter from "./routes/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3456;

// Trust nginx reverse proxy (needed for secure cookies + correct IP forwarding)
app.set("trust proxy", 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "grexa-deployer-secret-2024",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
  })
);

// API routes
app.use("/api", apiRouter);

// Static UI
app.use(express.static(join(__dirname, "public")));
app.get("*", (_req, res) =>
  res.sendFile(join(__dirname, "public", "index.html"))
);

// Start
const PASSWORD = process.env.DEPLOY_PASSWORD || "grexa@preprod";
app.listen(PORT, "127.0.0.1", () => {
  console.log(`\nGrexa Deployer running at http://127.0.0.1:${PORT}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   Set DEPLOY_PASSWORD env var to change it\n`);
});
