import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from './config/db.js';
import { jwtAuth } from './middleware/jwt.js';

const app = express();
const PORT = process.env.PORT || 6770;
const JWT_SECRET = process.env.JWT_SECRET || 'pica-ucol-jwt-secret-2026';
const JWT_EXPIRES_IN = '8h';

app.use(cors());
app.use(express.json());

// GET /health
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'auth-service', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
    }

    console.log(`[AUTH-SERVICE] Intento de login para: "${username}"`);
    const result = await pool.query(
      `SELECT u.*, p.full_name as professor_name, p.slug as professor_slug, p.profile_data as professor_profile
       FROM admin_users u
       LEFT JOIN professors p ON u.professor_id = p.id
       WHERE (u.username = $1 OR u.email = $1) AND u.is_active = TRUE`,
      [username.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      console.log(`[AUTH-SERVICE] Usuario "${username}" no encontrado o inactivo.`);
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      console.log(`[AUTH-SERVICE] Contraseña incorrecta para "${username}".`);
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const tokenPayload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      professor_id: user.professor_id,
      professor_name: user.professor_name || null,
      professor_slug: user.professor_slug || null,
      career_id: user.career_id || null,
      faculty_id: user.faculty_id || null
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        professor_id: user.professor_id,
        professor_name: user.professor_name || null,
        professor_slug: user.professor_slug || null,
        professor_profile: user.professor_profile || null,
        career_id: user.career_id || null,
        faculty_id: user.faculty_id || null
      }
    });
  } catch (err) {
    console.error('[AUTH-SERVICE] Error en /login:', err);
    return res.status(500).json({ error: 'Error interno de autenticación.' });
  }
});

// GET /me
app.get('/me', jwtAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.*, p.full_name as professor_name, p.slug as professor_slug, p.profile_data as professor_profile
       FROM admin_users u
       LEFT JOIN professors p ON u.professor_id = p.id
       WHERE u.id = $1 AND u.is_active = TRUE`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const user = result.rows[0];
    delete user.password_hash;

    return res.json(user);
  } catch (err) {
    console.error('[AUTH-SERVICE] Error en /me:', err);
    return res.status(500).json({ error: 'Error al obtener perfil de usuario.' });
  }
});

// POST /student/login
app.post('/student/login', async (req, res) => {
  try {
    const { enrollment_id, password } = req.body;
    if (!enrollment_id || !password) {
      return res.status(400).json({ error: 'Matrícula y contraseña son requeridas.' });
    }

    const query = `
      SELECT s.id, s.enrollment_id, s.full_name, s.email, s.class_group_id, s.password_hash, c.slug as class_group_slug
      FROM students s
      LEFT JOIN class_groups c ON s.class_group_id = c.id
      WHERE s.enrollment_id = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [enrollment_id.trim()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const studentRow = result.rows[0];
    const storedPassword = String(studentRow.password_hash || '');
    const passwordMatches = storedPassword.startsWith('$2')
      ? await bcrypt.compare(String(password), storedPassword)
      : storedPassword === String(password);

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const { password_hash, ...student } = studentRow;
    return res.json({ success: true, student });
  } catch (err) {
    console.error('[AUTH-SERVICE] Error en /student/login:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /bypass-login
app.post('/bypass-login', async (req, res) => {
  try {
    const { professor_id } = req.body;
    if (!professor_id) {
      return res.status(400).json({ error: 'professor_id es requerido.' });
    }

    // Check if the professor exists
    const profResult = await pool.query(
      `SELECT id, full_name, slug, profile_data FROM professors WHERE id = $1`,
      [professor_id]
    );

    if (profResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profesor no encontrado.' });
    }

    const prof = profResult.rows[0];

    // Check if an admin_user already exists for this professor
    let userResult = await pool.query(
      `SELECT * FROM admin_users WHERE professor_id = $1 LIMIT 1`,
      [professor_id]
    );

    let user;
    if (userResult.rows.length === 0) {
      // If not, let's create a temporary admin_user entry on the fly so DB constraints/queries match!
      const tempUsername = `docente_${prof.id}`;
      const tempEmail = `${prof.slug}@ucol.mx`;
      const insertResult = await pool.query(
        `INSERT INTO admin_users (username, email, password_hash, role, professor_id)
         VALUES ($1, $2, $3, 'docente', $4)
         RETURNING *`,
        [tempUsername, tempEmail, 'bypass', prof.id]
      );
      user = insertResult.rows[0];
    } else {
      user = userResult.rows[0];
    }

    const tokenPayload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: 'docente',
      professor_id: prof.id,
      professor_name: prof.full_name,
      professor_slug: prof.slug,
      career_id: null,
      faculty_id: null
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: 'docente',
        professor_id: prof.id,
        professor_name: prof.full_name,
        professor_slug: prof.slug,
        professor_profile: prof.profile_data,
        career_id: null,
        faculty_id: null
      }
    });
  } catch (err) {
    console.error('[AUTH-SERVICE] Error en /bypass-login:', err);
    return res.status(500).json({ error: 'Error interno de bypass login.' });
  }
});


app.listen(PORT, () => {
  console.log(`[START] Microservicio de Autenticación corriendo en el puerto ${PORT}`);
});
