import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import pool from './config/db.js';
import { jwtAuth } from './middleware/jwt.js';
import { matchFaculty } from './services/faculty-matcher.js';

const app = express();
const PORT = process.env.PORT || 6771;
const CV_EXTRACTOR_URL = process.env.CV_EXTRACTOR_URL || 'http://cv-extractor-service:6774';
const REFERENCE_SERVICE_URL = process.env.REFERENCE_SERVICE_URL || 'http://reference-service:6773';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Helper to slugify
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

// Helper for loose name matching (Levenshtein/overlap based)
function looseNameMatch(name1, name2) {
  if (!name1 || !name2) return false;
  const normalize = (n) => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !['dr', 'dra', 'mtro', 'mtra', 'lic', 'ing', 'de', 'la', 'el', 'y', 'del', 'las', 'los'].includes(w));
  const w1 = normalize(name1);
  const w2 = normalize(name2);
  if (w1.length === 0 || w2.length === 0) return false;
  const set2 = new Set(w2);
  const intersection = w1.filter(w => set2.has(w));
  const minLen = Math.min(w1.length, w2.length);
  return (intersection.length / minLen) >= 0.75;
}


// GET /health
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'professors-service', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// Cache purge helper
async function purgeCache(slug) {
  try {
    console.log(`[CACHE] Purging cache for professor: ${slug}`);
    const urlsToPurge = new Set();
    urlsToPurge.add('/');
    urlsToPurge.add('/buscar-profesor');
    urlsToPurge.add(`/profesores/${slug}`);

    const dbRes = await pool.query(`
      SELECT p.delegation_id, 
             coalesce(
               json_agg(
                 json_build_object('slug', g.slug, 'career_id', g.career_id)
               ) FILTER (WHERE g.slug IS NOT NULL),
               '[]'
             ) as groups
      FROM professors p
      LEFT JOIN professor_groups pg ON p.id = pg.professor_id
      LEFT JOIN class_groups g ON pg.class_group_id = g.id
      WHERE p.slug = $1
      GROUP BY p.id;
    `, [slug]);

    if (dbRes.rows.length > 0) {
      const { delegation_id, groups } = dbRes.rows[0];

      let delegations = [];
      let careers = [];
      try {
        const delRes = await fetch(`${REFERENCE_SERVICE_URL}/delegations`);
        if (delRes.ok) delegations = await delRes.json();
      } catch (e) {
        console.warn('[WARN] Could not load delegations from reference-service:', e.message);
      }

      try {
        const carRes = await fetch(`${REFERENCE_SERVICE_URL}/careers`);
        if (carRes.ok) careers = await carRes.json();
      } catch (e) {
        console.warn('[WARN] Could not load careers from reference-service:', e.message);
      }

      const delegation = delegations.find(d => d.id === delegation_id);
      if (delegation) {
        urlsToPurge.add(`/delegaciones/${delegation.slug}`);

        if (Array.isArray(groups)) {
          for (const g of groups) {
            const career = careers.find(c => c.id === g.career_id);
            if (career) {
              urlsToPurge.add(`/delegaciones/${delegation.slug}/carreras/${career.slug}`);
              urlsToPurge.add(`/delegaciones/${delegation.slug}/carreras/${career.slug}/grupos/${g.slug}`);
            }
          }
        }
      }
    }

    for (const relativeUrl of urlsToPurge) {
      const purgeUrl = `http://proxy${relativeUrl}`;
      fetch(purgeUrl, {
        method: 'GET',
        headers: { 'X-Purge': '1' }
      }).catch(err => {
        console.log(`Failed to purge ${purgeUrl}: ${err.message}`);
      });
    }
  } catch (err) {
    console.warn('[WARN] Could not execute cache purge:', err.message);
  }
}

// GET /professors
app.get('/professors', (req, res, next) => {
  if (req.headers.authorization) {
    return jwtAuth(req, res, next);
  }
  return next();
}, async (req, res) => {
  try {
    let query = `
      SELECT p.id, p.slug, p.full_name, p.email, p.delegation_id, p.profile_data,
             COALESCE(
               json_agg(
                 json_build_object('class_group_id', pg.class_group_id, 'subject_taught', pg.subject_taught)
               ) FILTER (WHERE pg.class_group_id IS NOT NULL),
               '[]'
             ) as group_assignments
      FROM professors p
      LEFT JOIN professor_groups pg ON p.id = pg.professor_id
    `;
    let params = [];

    if (req.user && req.user.role === 'docente' && req.user.professor_id) {
      query += ' WHERE p.id = $1';
      params.push(req.user.professor_id);
    }

    query += ' GROUP BY p.id ORDER BY p.full_name ASC';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error listing professors:', err);
    return res.status(500).json({ error: 'Error al consultar profesores en la base de datos.' });
  }
});

// GET /professors/me/groups
app.get('/professors/me/groups', jwtAuth, async (req, res) => {
  try {
    if (!req.user || !req.user.professor_id) {
      return res.status(403).json({ error: 'Este endpoint es solo para docentes.' });
    }

    const result = await pool.query(`
      SELECT
        cg.id, cg.slug, cg.name as group_name, cg.academic_period, cg.shift, cg.career_id,
        pg.subject_taught,
        p.full_name as tutor_name
      FROM professor_groups pg
      JOIN class_groups cg ON pg.class_group_id = cg.id
      LEFT JOIN professors p ON cg.tutor_id = p.id
      WHERE pg.professor_id = $1
      ORDER BY cg.name ASC
    `, [req.user.professor_id]);

    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching teacher groups:', err);
    return res.status(500).json({ error: 'Error al consultar grupos del docente.' });
  }
});

// POST /professors
app.post('/professors', jwtAuth, async (req, res) => {
  try {
    const { professorData, delegation_id, faculty_id, group_assignments } = req.body;
    if (!professorData) {
      return res.status(400).json({ error: 'Faltan los datos del profesor.' });
    }

    // Call cv-extractor-service for formatting via HTTP
    const formatRes = await fetch(`${CV_EXTRACTOR_URL}/format`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(professorData)
    });

    if (!formatRes.ok) {
      const errorText = await formatRes.text();
      throw new Error(`cv-extractor-service format failed: ${errorText}`);
    }

    const formattedProfile = await formatRes.json();

    const slug = formattedProfile.slug;
    const fullName = formattedProfile.fullName;
    const email = formattedProfile.institutionalEmail;

    let finalDelegationId = delegation_id;

    // Perform faculty matching
    const match = await matchFaculty(faculty_id, formattedProfile.department);
    if (match) {
      formattedProfile.faculty_id = match.faculty_id;
      formattedProfile.auto_career_ids = match.career_ids;
      if (!finalDelegationId) finalDelegationId = match.delegation_id;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if professor already exists by email or loose name matching
      const allProfsRes = await client.query('SELECT id, slug, full_name, email, profile_data FROM professors');
      let existingProf = null;

      if (email) {
        existingProf = allProfsRes.rows.find(p => p.email && p.email.toLowerCase() === email.toLowerCase());
      }

      if (!existingProf) {
        existingProf = allProfsRes.rows.find(p => looseNameMatch(p.full_name, fullName));
      }

      let professorId;
      let finalSlug = slug;

      const incomingPhotoUrl = req.body.professorData?.photoUrl || req.body.professorData?.professorData?.photoUrl;
      const incomingPortraitUrl = req.body.professorData?.portraitUrl || req.body.professorData?.professorData?.portraitUrl;
      const incomingBiography = req.body.professorData?.biography || req.body.professorData?.professorData?.biography;
      const incomingShowOnlyBio = req.body.professorData?.showOnlyBiography ?? req.body.professorData?.professorData?.showOnlyBiography;

      if (existingProf) {
        professorId = existingProf.id;
        finalSlug = existingProf.slug; // Keep original slug to avoid breaking links
        
        const oldData = existingProf.profile_data || {};

        // 1. Photo handling: Ensure photoUrl comes from explicitly uploaded photo or existing DB photo;
        // otherwise null so student-hub resolves from public/images/profesores using baseImageSlug
        if (incomingPhotoUrl) {
          formattedProfile.photoUrl = incomingPhotoUrl;
        } else if (oldData.photoUrl) {
          formattedProfile.photoUrl = oldData.photoUrl;
        } else {
          formattedProfile.photoUrl = null;
        }

        if (incomingPortraitUrl) {
          formattedProfile.portraitUrl = incomingPortraitUrl;
        } else if (oldData.portraitUrl) {
          formattedProfile.portraitUrl = oldData.portraitUrl;
        }

        // 2. Semblanza handling: Preserve existing biography (semblanza) & showOnlyBiography
        if (incomingBiography) {
          formattedProfile.biography = incomingBiography;
        } else if (oldData.biography) {
          formattedProfile.biography = oldData.biography;
        }

        if (incomingShowOnlyBio !== undefined) {
          formattedProfile.showOnlyBiography = incomingShowOnlyBio;
        } else if (oldData.showOnlyBiography !== undefined) {
          formattedProfile.showOnlyBiography = oldData.showOnlyBiography;
        }

        const updateQuery = `
          UPDATE professors 
          SET full_name = $1, email = $2, delegation_id = $3, profile_data = $4, updated_at = NOW()
          WHERE id = $5;
        `;
        formattedProfile.slug = finalSlug;
        await client.query(updateQuery, [fullName, email, finalDelegationId || null, formattedProfile, professorId]);
      } else {
        if (incomingPhotoUrl) {
          formattedProfile.photoUrl = incomingPhotoUrl;
        } else {
          formattedProfile.photoUrl = null;
        }

        if (incomingPortraitUrl) formattedProfile.portraitUrl = incomingPortraitUrl;
        if (incomingBiography) formattedProfile.biography = incomingBiography;
        if (incomingShowOnlyBio !== undefined) formattedProfile.showOnlyBiography = incomingShowOnlyBio;

        const insertQuery = `
          INSERT INTO professors (slug, full_name, email, delegation_id, profile_data, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (slug)
          DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, delegation_id = EXCLUDED.delegation_id, profile_data = EXCLUDED.profile_data, updated_at = NOW()
          RETURNING id;
        `;
        const profRes = await client.query(insertQuery, [slug, fullName, email, finalDelegationId || null, formattedProfile]);
        professorId = profRes.rows[0].id;
      }

      await client.query('DELETE FROM professor_groups WHERE professor_id = $1', [professorId]);

      if (group_assignments && Array.isArray(group_assignments)) {
        for (const assoc of group_assignments) {
          if (assoc.class_group_id) {
            await client.query(
              'INSERT INTO professor_groups (professor_id, class_group_id, subject_taught) VALUES ($1, $2, $3)',
              [professorId, assoc.class_group_id, assoc.subject_taught || '']
            );
          }
        }
      }

      await client.query('COMMIT');
      purgeCache(finalSlug);

      return res.status(200).json({ success: true, message: 'Perfil guardado correctamente.', id: professorId, slug: finalSlug });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error in POST /professors:', err);
    return res.status(500).json({ error: err.message || 'Error interno al guardar el perfil.' });
  }
});

app.listen(PORT, () => {
  console.log(`[START] Microservicio de Profesores corriendo en el puerto ${PORT}`);
});
