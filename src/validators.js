/**
 * Validadores centralizados para datos comunes
 */

class CPValidator {
  static validate(cp) {
    if (!cp) return { valid: false, error: 'CP vacío' };
    const normalized = String(cp).trim().replace(/\D/g, '');
    if (normalized.length !== 5) return { valid: false, error: 'CP debe ser 5 dígitos' };
    return { valid: true, value: normalized };
  }

  static isCDMX(cp) {
    const n = parseInt(cp, 10);
    return n >= 1000 && n <= 16999;
  }

  static isEdomex(cp) {
    const s = String(cp).padStart(5, '0');
    const prefix = parseInt(s.substring(0, 2), 10);
    return prefix >= 50 && prefix <= 57;
  }

  static getState(cp) {
    if (this.isCDMX(cp)) return 'Ciudad de México';
    if (this.isEdomex(cp)) return 'Estado de México';
    return '';
  }

  static isNacional(cp) {
    return !this.isCDMX(cp) && !this.isEdomex(cp);
  }
}

class PhoneValidator {
  static normalize(phone) {
    let n = (phone || '').replace('whatsapp:', '').replace(/\D/g, '');
    if (n.length > 10) n = n.slice(-10);
    return n;
  }

  static validate(phone) {
    const normalized = this.normalize(phone);
    if (normalized.length !== 10) {
      return { valid: false, error: 'Teléfono debe ser 10 dígitos', value: null };
    }
    return { valid: true, value: normalized };
  }

  static formatForStorage(phone) {
    let n = (phone || '').replace(/^whatsapp:/i, '').replace(/\D/g, '');
    if (n.startsWith('521') && n.length === 13) n = n.substring(3);
    else if (n.startsWith('52') && n.length === 12) n = n.substring(2);
    return n ? `'+52${n}` : '';
  }

  static isMexican(phone) {
    const normalized = this.normalize(phone);
    return normalized.length === 10;
  }
}

module.exports = { CPValidator, PhoneValidator };
