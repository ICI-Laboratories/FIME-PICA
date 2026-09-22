import express from 'express';
import cors from 'cors';
import pool from './config/db.js';
import { jwtAuth } from './middleware/jwt.js';

const app = express();
const PORT = process.env.PORT || 6772;

app.use(cors());
app.use(express.json());

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// GET /health
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'academic-service', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// GET /groups
app.get('/groups', jwtAuth, async (req, res) => {
  try {
    const careerId = req.query.career_id;
    let query = 'SELECT cg.*, p.full_name as tutor_name FROM class_groups cg LEFT JOIN professors p ON cg.tutor_id = p.id';
    let params = [];

    const scopeCareer = req.user?.role === 'jefe_carrera' ? req.user.career_id : null;
    const filterCareer = careerId ? parseInt(careerId, 10) : scopeCareer;

    if (filterCareer) {
      query += ' WHERE cg.career_id = $1';
      params.push(filterCareer);
    }
    query += ' ORDER BY cg.name ASC';

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error listing groups:', err);
    return res.status(500).json({ error: 'Error al consultar grupos.' });
  }
});

// POST /groups
app.post('/groups', jwtAuth, async (req, res) => {
  try {
    const { name, career_id, academic_period, shift } = req.body;
    if (!name || !career_id) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos: name y career_id.' });
    }

    const groupSlug = `${slugify(name)}-${career_id}`;

    const query = `
      INSERT INTO class_groups (slug, career_id, name, academic_period, shift)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (slug)
      DO UPDATE SET name = EXCLUDED.name, academic_period = EXCLUDED.academic_period, shift = EXCLUDED.shift
      RETURNING *;
    `;

    const result = await pool.query(query, [groupSlug, parseInt(career_id, 10), name, academic_period || '', shift || '']);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating group:', err);
    return res.status(500).json({ error: 'Error al guardar el grupo.' });
  }
});

// POST /groups/tutor
app.post('/groups/tutor', jwtAuth, async (req, res) => {
  try {
    const { group_id, tutor_id } = req.body;
    if (!group_id) {
      return res.status(400).json({ error: 'Falta el id del grupo.' });
    }
    await pool.query('UPDATE class_groups SET tutor_id = $1 WHERE id = $2', [
      tutor_id ? parseInt(tutor_id, 10) : null,
      parseInt(group_id, 10)
    ]);
    return res.json({ success: true, message: 'Tutor asignado con éxito.' });
  } catch (err) {
    console.error('Error assigning tutor:', err);
    return res.status(500).json({ error: 'Error al asignar tutor en la base de datos.' });
  }
});

// GET /schedules
app.get('/schedules', jwtAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, p.full_name as professor_name, g.name as group_name
      FROM schedules s
      LEFT JOIN professors p ON s.professor_id = p.id
      LEFT JOIN class_groups g ON s.class_group_id = g.id
      ORDER BY s.day_of_week, s.start_time
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error listing schedules:', err);
    return res.status(500).json({ error: 'Error al consultar horarios en la base de datos.' });
  }
});

// POST /schedules
app.post('/schedules', jwtAuth, async (req, res) => {
  try {
    const { class_group_id, subject_name, professor_id, classroom_name, day_of_week, start_time, end_time, is_laboratory } = req.body;
    if (!class_group_id || !subject_name || !classroom_name || !day_of_week || !start_time || !end_time) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos para el horario.' });
    }

    const groupId = parseInt(class_group_id, 10);
    const profId = professor_id ? parseInt(professor_id, 10) : null;

    if (is_laboratory === true) {
      if (!profId) {
        return res.status(400).json({ error: 'Se requiere el ID del docente para reservar un laboratorio.' });
      }

      const classQuery = `
        SELECT * FROM schedules 
        WHERE class_group_id = $1 
          AND subject_name = $2 
          AND professor_id = $3 
          AND day_of_week = $4 
          AND is_laboratory = FALSE
          AND start_time <= $5::time
          AND end_time >= $6::time
      `;
      const classCheck = await pool.query(classQuery, [
        groupId,
        subject_name,
        profId,
        day_of_week,
        start_time,
        end_time
      ]);

      if (classCheck.rows.length === 0) {
        return res.status(400).json({
          error: `No tienes asignada una clase de "${subject_name}" el día ${day_of_week} en el horario de ${start_time.substring(0, 5)} a ${end_time.substring(0, 5)} para este grupo.`
        });
      }
    }

    const query = `
      INSERT INTO schedules (class_group_id, subject_name, professor_id, classroom_name, day_of_week, start_time, end_time, is_laboratory)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const result = await pool.query(query, [
      groupId,
      subject_name,
      profId,
      classroom_name,
      day_of_week,
      start_time,
      end_time,
      is_laboratory || false
    ]);

    if (profId) {
      await pool.query(`
        INSERT INTO professor_groups (professor_id, class_group_id, subject_taught)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [profId, groupId, subject_name]);
    }

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating schedule:', err);
    return res.status(500).json({ error: 'Error al guardar el horario.' });
  }
});

// DELETE /schedules/:id
app.delete('/schedules/:id', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM schedules WHERE id = $1', [parseInt(id, 10)]);
    return res.json({ success: true, message: 'Horario eliminado correctamente.' });
  } catch (err) {
    console.error('Error deleting schedule:', err);
    return res.status(500).json({ error: 'Error al eliminar el horario.' });
  }
});

// GET /exams
app.get('/exams', jwtAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, g.name as group_name
      FROM exam_dates e
      LEFT JOIN class_groups g ON e.class_group_id = g.id
      ORDER BY e.exam_date, e.exam_time
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error listing exams:', err);
    return res.status(500).json({ error: 'Error al consultar exámenes en la base de datos.' });
  }
});

// POST /exams
app.post('/exams', jwtAuth, async (req, res) => {
  try {
    const { class_group_id, subject_name, exam_name, exam_date, exam_time } = req.body;
    if (!class_group_id || !subject_name || !exam_name || !exam_date || !exam_time) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos para el examen.' });
    }

    const groupId = parseInt(class_group_id, 10);

    const countQuery = `
      SELECT COUNT(*) FROM exam_dates 
      WHERE class_group_id = $1 AND LOWER(TRIM(subject_name)) = LOWER(TRIM($2))
    `;
    const countCheck = await pool.query(countQuery, [groupId, subject_name]);
    const examCount = parseInt(countCheck.rows[0].count, 10);

    if (examCount >= 3) {
      return res.status(400).json({
        error: `Límite excedido: El coordinador académico dictamina un máximo de 3 fechas de evaluación/exámenes para la materia "${subject_name}" en este grupo.`
      });
    }

    const query = `
      INSERT INTO exam_dates (class_group_id, subject_name, exam_name, exam_date, exam_time)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const result = await pool.query(query, [
      groupId,
      subject_name,
      exam_name,
      exam_date,
      exam_time
    ]);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating exam:', err);
    return res.status(500).json({ error: 'Error al guardar el examen.' });
  }
});

// DELETE /exams/:id
app.delete('/exams/:id', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM exam_dates WHERE id = $1', [parseInt(id, 10)]);
    return res.json({ success: true, message: 'Examen eliminado correctamente.' });
  } catch (err) {
    console.error('Error deleting exam:', err);
    return res.status(500).json({ error: 'Error al eliminar el examen.' });
  }
});

// GET /syllabus
app.get('/syllabus', jwtAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, p.full_name as creator_name
      FROM subject_syllabus s
      LEFT JOIN professors p ON s.created_by = p.id
      ORDER BY s.subject_name ASC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error listing syllabus:', err);
    return res.status(500).json({ error: 'Error al consultar syllabus.' });
  }
});

// POST /syllabus
app.post('/syllabus', jwtAuth, async (req, res) => {
  try {
    const { subject_name, career_id, program_description, evaluation_criteria, resources, created_by } = req.body;
    if (!subject_name || !career_id || !evaluation_criteria || !resources) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos para el syllabus.' });
    }

    let parsedCriteria = typeof evaluation_criteria === 'string' ? JSON.parse(evaluation_criteria) : evaluation_criteria;

    let cleanCriteria;
    if (Array.isArray(parsedCriteria)) {
      cleanCriteria = [];
      for (const partial of parsedCriteria) {
        if (!partial.partial_name || !partial.criteria) {
          return res.status(400).json({ error: 'Formato de criterios de parcial inválido.' });
        }
        let partialPct = 0;
        const cleanPartialCriteria = {};
        for (const [key, val] of Object.entries(partial.criteria)) {
          const numStr = String(val).replace(/[^0-9.-]/g, '');
          const numVal = Math.round(parseFloat(numStr) || 0);
          cleanPartialCriteria[key] = `${numVal}%`;
          partialPct += numVal;
        }
        if (partialPct !== 100) {
          return res.status(400).json({
            error: `La suma de los criterios para "${partial.partial_name}" debe ser exactamente del 100%. Suma actual: ${partialPct}%.`
          });
        }
        cleanCriteria.push({
          partial_name: partial.partial_name,
          criteria: cleanPartialCriteria
        });
      }
    } else {
      let totalPct = 0;
      cleanCriteria = {};
      for (const [key, val] of Object.entries(parsedCriteria)) {
        const numStr = String(val).replace(/[^0-9.-]/g, '');
        const numVal = Math.round(parseFloat(numStr) || 0);
        cleanCriteria[key] = `${numVal}%`;
        totalPct += numVal;
      }
      if (totalPct !== 100) {
        return res.status(400).json({
          error: `La suma de los criterios de evaluación debe ser exactamente del 100%. Suma actual: ${totalPct}%.`
        });
      }
    }

    const slug = slugify(`${subject_name}-${career_id}`);

    const query = `
      INSERT INTO subject_syllabus (slug, subject_name, career_id, program_description, evaluation_criteria, resources, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (slug)
      DO UPDATE SET program_description = EXCLUDED.program_description, evaluation_criteria = EXCLUDED.evaluation_criteria, resources = EXCLUDED.resources, created_by = EXCLUDED.created_by, updated_at = NOW()
      RETURNING *;
    `;
    const result = await pool.query(query, [
      slug,
      subject_name,
      parseInt(career_id, 10),
      program_description || '',
      typeof cleanCriteria === 'string' ? cleanCriteria : JSON.stringify(cleanCriteria),
      typeof resources === 'string' ? resources : JSON.stringify(resources),
      created_by ? parseInt(created_by, 10) : null
    ]);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error saving syllabus:', err);
    return res.status(500).json({ error: 'Error al guardar el syllabus.' });
  }
});

app.listen(PORT, () => {
  console.log(`[START] Microservicio Académico corriendo en el puerto ${PORT}`);
});
