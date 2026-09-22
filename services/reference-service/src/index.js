import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const app = express();
const PORT = process.env.PORT || 6773;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

function getReferencePath(filename) {
  return path.join(__dirname, '..', 'data', filename);
}

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'reference-service', uptime: process.uptime() });
});

// GET /delegations
app.get('/delegations', async (req, res) => {
  try {
    const filepath = getReferencePath('delegations.yaml');
    const content = await fs.readFile(filepath, 'utf-8');
    const data = yaml.load(content);
    return res.json(data);
  } catch (err) {
    console.error('Error al leer delegations.yaml:', err);
    return res.status(500).json({ error: 'No se pudieron cargar las delegaciones.' });
  }
});

// GET /careers
app.get('/careers', async (req, res) => {
  try {
    const filepath = getReferencePath('careers.yaml');
    const content = await fs.readFile(filepath, 'utf-8');
    const data = yaml.load(content);
    return res.json(data);
  } catch (err) {
    console.error('Error al leer careers.yaml:', err);
    return res.status(500).json({ error: 'No se pudieron cargar las carreras.' });
  }
});

// GET /faculties
app.get('/faculties', async (req, res) => {
  try {
    const filepath = getReferencePath('faculties.yaml');
    const content = await fs.readFile(filepath, 'utf-8');
    const data = yaml.load(content);
    return res.json(data);
  } catch (err) {
    console.error('Error al leer faculties.yaml:', err);
    return res.status(500).json({ error: 'No se pudieron cargar las facultades.' });
  }
});

app.listen(PORT, () => {
  console.log(`[START] Microservicio de Referencia corriendo en el puerto ${PORT}`);
});
