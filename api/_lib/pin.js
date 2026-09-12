// Cifrado y verificación de PIN.
//
// Usa scrypt del módulo crypto de Node: sin dependencias que instalar y
// deliberadamente lento, que es justo lo que se quiere contra fuerza bruta.
//
// Un PIN de 4 dígitos son 10.000 combinaciones: poco. Por eso scrypt con costo
// alto y, además, /api/login limita los intentos. Aun así, un PIN nunca va a ser
// tan fuerte como una contraseña — es el compromiso aceptado para que las socias
// no tengan que recordar credenciales.

const crypto = require('crypto');

const N = 16384, r = 8, p = 1, KEYLEN = 32;

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pin), salt, KEYLEN, { N, r, p });
  return 'scrypt$' + N + '$' + r + '$' + p + '$' + salt.toString('hex') + '$' + dk.toString('hex');
}

function verifyPin(pin, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, rr, pp, saltHex, hashHex] = parts;
  let dk;
  try {
    dk = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), KEYLEN, {
      N: parseInt(n, 10), r: parseInt(rr, 10), p: parseInt(pp, 10),
    });
  } catch {
    return false;
  }

  const esperado = Buffer.from(hashHex, 'hex');
  // Comparación en tiempo constante: una comparación normal filtra información
  // por cuánto tarda en fallar.
  if (esperado.length !== dk.length) return false;
  return crypto.timingSafeEqual(esperado, dk);
}

// Reglas mínimas. No pedimos más porque un PIN largo que nadie recuerda termina
// anotado en un papel pegado al monitor.
function validarPin(pin) {
  const s = String(pin == null ? '' : pin).trim();
  if (!/^[0-9]+$/.test(s)) return 'El PIN debe tener solo números';
  if (s.length < 4) return 'El PIN debe tener al menos 4 dígitos';
  if (s.length > 8) return 'El PIN no puede tener más de 8 dígitos';
  if (/^(.)\1+$/.test(s)) return 'El PIN no puede ser el mismo dígito repetido';
  if ('0123456789'.includes(s) || '9876543210'.includes(s)) return 'El PIN no puede ser una secuencia seguida';
  return '';
}

module.exports = { hashPin, verifyPin, validarPin };
