export const onRequest = async (context, next) => {
  const { url, cookies, redirect, locals } = context;

  // Rutas públicas y recursos estáticos
  if (url.pathname.startsWith('/favicon.svg') || url.pathname.startsWith('/_astro') || url.pathname.startsWith('/student-auth/')) {
    return next();
  }

  // Redirigir la antigua ruta de login a la raíz
  if (url.pathname === '/login') {
    return redirect('/', 302);
  }

  // Obtener grupo seleccionado de cookies (sin forzar valor por defecto)
  const selectedGroupCookie = cookies.get('pica_selected_group');
  const groupSlug = selectedGroupCookie?.value || null;

  if (groupSlug) {
    locals.student = {
      is_anonymous: true,
      class_group_slug: groupSlug,
      full_name: 'Estudiante',
      email: 'estudiante@ucol.mx'
    };
  } else {
    locals.student = null;
  }

  return next();
};
