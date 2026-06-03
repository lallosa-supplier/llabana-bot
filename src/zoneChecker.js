/**
 * ZoneChecker — Consolidates zone detection logic (4 patterns unified into 1)
 * Eliminates duplicate code from handleAskingMexico, handleActive, etc.
 */

const { CPValidator } = require('./validators');

class ZoneChecker {
  // Patrones de detección por texto (consolidado de 4 lugares diferentes)
  static ZONE_TEXT_PATTERNS = {
    CDMX: /(?:cdmx|ciudad\s*de\s*méxico|méxico\s*df|df|capitalino)/i,
    EDOMEX: /(?:estado\s*de\s*méxico|edomex|zona\s*metropolitana)/i,
    LOCAL: /(?:aquí|acá|mi\s*(?:ciudad|pueblo|zona)|donde\s*vivo|donde\s*estoy|zona\s*(?:local|cercana)|mi\s*área)/i,
  };

  /**
   * Detecta la zona a partir de un código postal
   * @returns {'CDMX' | 'Edomex' | 'Nacional' | ''}
   */
  static getZoneFromCP(cp) {
    if (!cp) return '';
    if (CPValidator.isCDMX(cp)) return 'CDMX';
    if (CPValidator.isEdomex(cp)) return 'Edomex';
    return 'Nacional';
  }

  /**
   * Detecta la zona a partir de texto del usuario
   * @returns {'CDMX' | 'Edomex' | 'local' | ''}
   */
  static getZoneFromText(text) {
    if (!text) return '';
    if (this.ZONE_TEXT_PATTERNS.CDMX.test(text)) return 'CDMX';
    if (this.ZONE_TEXT_PATTERNS.EDOMEX.test(text)) return 'Edomex';
    if (this.ZONE_TEXT_PATTERNS.LOCAL.test(text)) return 'local';
    return '';
  }

  /**
   * Verifica si una zona es "local" (CDMX o Edomex)
   */
  static isLocalZone(cp) {
    return CPValidator.isCDMX(cp) || CPValidator.isEdomex(cp);
  }

  /**
   * Verifica si texto menciona zona local
   */
  static mentionsLocalZone(text) {
    return this.ZONE_TEXT_PATTERNS.LOCAL.test(text);
  }

  /**
   * Obtiene el estado basado en CP
   */
  static getStateName(cp) {
    return CPValidator.getState(cp);
  }

  /**
   * Determina si es reparto viable (cantidad vs zona)
   * @param {number} cantidad - cantidad de bultos
   * @param {string} zone - CDMX, Edomex, Nacional
   * @returns {{viable: boolean, reason: string, channel: string}}
   */
  static isViableDelivery(cantidad, zone) {
    if (zone === 'CDMX' || zone === 'Edomex') {
      return { viable: true, channel: 'asesor', reason: 'Requiere confirmación de asesor' };
    }

    if (cantidad <= 10) {
      return { viable: true, channel: 'paqueteria', reason: 'Disponible por paquetería' };
    }

    if (cantidad >= 11 && cantidad <= 499) {
      return { viable: true, channel: 'truck', reason: 'Requiere camión completo o paquetería' };
    }

    if (cantidad >= 500) {
      return { viable: true, channel: 'asesor', reason: 'Requiere contacto con asesor para camión' };
    }

    return { viable: false, reason: 'Cantidad inválida' };
  }
}

module.exports = ZoneChecker;
