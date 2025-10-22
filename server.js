import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ENV
const DATABASE_URL = process.env.DATABASE_URL;
const USE_SSL = process.env.PG_USE_SSL === "true";
const CA_PATH = process.env.PG_SSL_CA;
const PORT = parseInt(process.env.PORT || "5000", 10);

if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}
if (USE_SSL && !CA_PATH) {
  console.error("Falta PG_SSL_CA cuando PG_USE_SSL=true");
  process.exit(1);
}

// SSL
let ssl = false;
if (USE_SSL) {
  const ca = fs.readFileSync(CA_PATH, "utf8");
  ssl = { rejectUnauthorized: true, ca };
}

// Pool unico
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl,
});

// DB bootstrap
async function ensureTable() {
  const createSQL = `
    CREATE TABLE IF NOT EXISTS public.subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.query(createSQL);
}

// App
const app = express();
app.use(cors());
app.use(express.json());

// estáticos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

// API
app.post("/api/subscribe", async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== "string") return res.status(400).json({ message: "Correo inválido" });
  const normalized = email.trim().toLowerCase();
  const emailRegex = /\S+@\S+\.\S+/;
  if (!emailRegex.test(normalized)) return res.status(400).json({ message: "Formato de correo no válido" });

  try {
    const sql = "INSERT INTO public.subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id";
    const r = await pool.query(sql, [normalized]);
    if (r.rowCount === 0) return res.status(409).json({ ok: false, message: "Ese correo ya está registrado." });
    return res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    console.error("Error guardando correo", e);
    return res.status(500).json({ message: "Error al guardar el correo" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Start
(async () => {
  try {
    await ensureTable();
    app.listen(PORT, () => console.log(`Servidor iniciado en http://localhost:${PORT}`));
  } catch (err) {
    console.error("Fallo al iniciar:", err);
    process.exit(1);
  }
})();
