// ─── SESIÓN FIRMADA ──────────────────────────────────────────────────────────
//
// `/api/login` verifica el PIN y emite un token firmado. El navegador lo manda
// en cada consulta a Supabase, y las políticas RLS leen de él quién es y qué
// perfiles tiene. Sin token válido, la base no devuelve nada.
//
// ── Por qué esto y no Supabase Auth con correo y contraseña ─────────────────
//
// Porque conserva el ingreso por nombre + PIN. Las socias ya lo aprendieron y
// cambiarlo obliga a capacitar de nuevo a diecisiete familias, algunas sin
// mucha costumbre de aplicaciones. El token va firmado con el secreto JWT del
// propio proyecto Supabase, así que la base lo valida igual que si lo hubiera
// emitido Supabase Auth: la garantía criptográfica es la misma.
//
// La otra ventaja es que no hay que reescribir las cincuenta funciones de datos
// del navegador. Siguen hablando con Supabase; lo que cambia es que ahora van
// identificadas.
//
// ── Por qué se firma a mano y no con una librería ───────────────────────────
//
// Un JWT HS256 es tres pedazos en base64url y un HMAC-SHA256. `crypto` de Node
// hace el HMAC. Traer `jsonwebtoken` serían 40 KB y una dependencia más que
// auditar para escribir cuarenta líneas.
//
// ── Por qué NO se usa auth.uid() en las políticas ───────────────────────────
//
// `auth.uid()` de Supabase hace `(claims->>'sub')::uuid`, y los `families.id`
// de esta base son TEXT ('fabian', '1757...'), no UUID: el casteo reventaría.
// Las políticas de la migración 010 leen `auth.jwt() ->> 'family_id'`, que es
// texto y no castea nada. Está anotado también en la migración.

const crypto = require('crypto');

const EMISOR = 'cooperativa-quilpueblo';

// Ocho horas: más que un turno de bodega y menos que un día. Si alguien deja la
// sesión abierta en un computador compartido, caduca sola esa misma jornada.
const DURACION_SEGUNDOS = 8 * 60 * 60;

const b64url = (x) => Buffer.from(x).toString('base64url');

function hmac(datos, secreto) {
  return crypto.createHmac('sha256', secreto).update(datos).digest();
}

// El secreto vive SOLO en el servidor. Sin prefijo REACT_APP_: ese prefijo lo
// incrustaría en el JavaScript público, y con el secreto cualquiera se emite un
// token de administrador.
function secreto() {
  return process.env.SUPABASE_JWT_SECRET || null;
}

const haySecreto = () => !!secreto();

// Emite el token. `roles` va adentro para que las políticas puedan distinguir
// una familia de una comisión sin volver a consultar la tabla — y sobre todo
// para que el navegador no pueda mentir sobre sus propios permisos: los perfiles
// los decide el servidor al verificar el PIN, no el cliente.
function emitir(fam) {
  const s = secreto();
  if (!s) return null;

  const ahora = Math.floor(Date.now() / 1000);
  const roles = Array.isArray(fam.roles) && fam.roles.length
    ? fam.roles
    : (fam.role === 'admin' ? ['admin', 'familia'] : ['familia']);

  const payload = {
    // Lo que Supabase exige para aceptar el token y elegir el rol de base.
    // 'authenticated' existe por defecto en todo proyecto.
    aud: 'authenticated',
    role: 'authenticated',
    iss: EMISOR,
    sub: String(fam.id),
    iat: ahora,
    exp: ahora + DURACION_SEGUNDOS,

    // Lo que leen las políticas.
    family_id: String(fam.id),
    family_name: fam.name || '',
    roles,
  };

  const cabecera = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify(payload));
  const firma = Buffer.from(hmac(cabecera + '.' + cuerpo, s)).toString('base64url');

  return { token: cabecera + '.' + cuerpo + '.' + firma, expiraEn: DURACION_SEGUNDOS, expiraEl: payload.exp };
}

// Verifica firma y vencimiento. Devuelve el payload o null.
//
// La comparación de la firma es en tiempo constante: una comparación normal
// filtra por cuánto tarda en fallar, y con eso se puede ir adivinando byte a
// byte.
function verificar(token) {
  const s = secreto();
  if (!s || typeof token !== 'string') return null;

  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cabecera, cuerpo, firma] = partes;

  const esperada = Buffer.from(hmac(cabecera + '.' + cuerpo, s));
  let recibida;
  try { recibida = Buffer.from(firma, 'base64url'); } catch { return null; }
  if (recibida.length !== esperada.length) return null;
  if (!crypto.timingSafeEqual(recibida, esperada)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')); } catch { return null; }

  if (payload.iss !== EMISOR) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

// Lee el token del encabezado Authorization de una petición a /api.
function delRequest(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || !/^Bearer /i.test(h)) return null;
  return verificar(h.slice(7).trim());
}

module.exports = { emitir, verificar, delRequest, haySecreto, DURACION_SEGUNDOS };
