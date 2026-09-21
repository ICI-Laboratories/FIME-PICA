import { fetchFromService } from './api-client.js';
import fs from 'fs';
import path from 'path';

function resolveTeacherPhoto(slug, existingPhotoUrl) {
  if (existingPhotoUrl) return existingPhotoUrl;
  if (!slug) return null;
  const baseSlug = slug.replace(/-\d+$/, '');
  
  const possibleDirs = [
    path.join(process.cwd(), 'public', 'images', 'profesores'),
    path.join(process.cwd(), 'services', 'student-hub', 'public', 'images', 'profesores'),
  ];
  
  for (const dir of possibleDirs) {
    if (fs.existsSync(dir)) {
      const exactFile = path.join(dir, `${baseSlug}.jpg`);
      if (fs.existsSync(exactFile)) {
        return `/images/profesores/${baseSlug}.jpg`;
      }
      try {
        const files = fs.readdirSync(dir);
        const match = files.find(f => f.endsWith('.jpg') && f.includes(baseSlug));
        if (match) {
          return `/images/profesores/${match}`;
        }
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
}

export async function cargarProfesores() {
  try {
    const rows = await fetchFromService('professors', '/professors');
    return rows.map(row => {
      const profile = row.profile_data || {};
      profile.id = row.id;
      profile.slug = row.slug;
      profile.fullName = row.full_name;
      profile.institutionalEmail = row.email;
      profile.delegation_id = row.delegation_id;
      profile.photoUrl = resolveTeacherPhoto(row.slug, profile.photoUrl);
      
      const careerIdsFromAssignments = row.group_assignments ? row.group_assignments.map(a => a.career_id).filter(Boolean) : [];
      const combinedCareers = new Set(careerIdsFromAssignments);
      if (profile.auto_career_ids) {
        profile.auto_career_ids.forEach(cid => combinedCareers.add(cid));
      }
      profile.career_ids = Array.from(combinedCareers);
      
      return profile;
    });
  } catch (err) {
    console.error('Error loading teachers from professors-service:', err);
    return [];
  }
}

export async function cargarProfesor(slug) {
  try {
    const decodedSlug = decodeURIComponent(slug);
    const rows = await fetchFromService('professors', '/professors');
    
    // Exact match first
    let prof = rows.find(p => p.slug === decodedSlug);
    
    // If not found, try matching base slug without number
    if (!prof) {
      prof = rows.find(p => p.slug.replace(/-\d+$/, '') === decodedSlug.replace(/-\d+$/, ''));
    }

    if (prof) {
      const profile = prof.profile_data || {};
      profile.id = prof.id;
      profile.slug = prof.slug;
      profile.fullName = profile.fullName || prof.full_name;
      profile.institutionalEmail = profile.institutionalEmail || prof.email;
      profile.department = profile.department || null;
      profile.admissionYear = profile.admissionYear || null;
      profile.photoUrl = resolveTeacherPhoto(prof.slug, profile.photoUrl);
      
      return profile;
    }
    return null;
  } catch (err) {
    console.error(`Error loading teacher with slug "${slug}" from professors-service:`, err);
    return null;
  }
}

