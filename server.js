import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL no está configurado. Define la cadena de conexión de PostgreSQL.");
  process.exit(1);
}

const sslMode = process.env.DATABASE_SSL_MODE || "require";
const caPath = process.env.DATABASE_CA_CERT_PATH;
const caInline = process.env.DATABASE_CA_CERT;

let ssl = false;
if (!DATABASE_URL.includes("localhost") && sslMode !== "disable"){
  if (caInline && caInline.trim().length > 0){
    ssl = { ca: caInline, rejectUnauthorized: true };
  } else if (caPath){
    try{
      const ca = fs.readFileSync(caPath, "utf8");
      ssl = { ca, rejectUnauthorized: true };
    } catch(err){
      console.warn("No se pudo leer DATABASE_CA_CERT_PATH, se usará SSL sin validar certificado.", err.message);
      ssl = { rejectUnauthorized: false };
    }
  } else {
    ssl = { rejectUnauthorized: false };
  }
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl
});

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

await ensureTable();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = __dirname;

app.use(express.static(publicDir));

app.post("/api/subscribe", async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ message: "Correo inválido" });
  }

  const normalized = email.trim().toLowerCase();
  const emailRegex = /\S+@\S+\.\S+/;
  if (!emailRegex.test(normalized)) {
    return res.status(400).json({ message: "Formato de correo no válido" });
  }

  try {
  const insertSQL = "INSERT INTO public.subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id";
    const result = await pool.query(insertSQL, [normalized]);
    if (result.rowCount === 0) {
      return res.status(409).json({ ok: false, message: "Ese correo ya está registrado." });
    }
    return res.status(200).json({ ok: true, stored: true });
  } catch (error) {
    console.error("Error guardando correo", error);
    return res.status(500).json({ message: "Error al guardar el correo" });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
