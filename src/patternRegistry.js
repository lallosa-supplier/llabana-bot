/**
 * PatternRegistry — Centralized repository for all regex patterns
 * Consolidates 100+ patterns scattered throughout botLogic.js
 * Makes patterns discoverable, testable, and maintainable
 */

const patterns = {
  // Location detection
  OUTSIDE_MEXICO: [
    /estados\s*unidos/i, /\busa\b/i, /\bee\.?\s*uu\.?\b/i,
    /\bguatemala\b/i, /\bcolombia\b/i, /\bvenezuela\b/i,
    /\bargentina\b/i, /espa[ñn]a/i, /canad[aá]/i,
    /\bchile\b/i, /per[uú]/i, /\bcuba\b/i,
    /\bhonduras\b/i, /el\s*salvador/i, /\bnicaragua\b/i,
    /costa\s*rica/i, /panam[aá]/i, /\bbrasil\b/i,
    /\bbolivia\b/i, /\becuador\b/i, /\buruguay\b/i,
  ],

  // Escalation triggers
  ESCALATION_PROFILE: [
    /distribuidor/i,
    /revendedor/i,
    /grandes?\s*cantidades?\s+(?:de\s+)?(?:tons?|toneladas?|cami[oó]n)/i,
  ],

  // Human request
  HUMAN_REQUEST: [
    /\basesor\b/i, /\bhumano\b/i, /\bpersona\b/i, /\bwig\b/i,
    /\bagente\b/i, /hablar\s+con/i, /quiero\s+hablar/i,
    /\batenci[oó]n\s+humana\b/i, /\bme\s+atiendan?\b/i,
  ],

  // Price questions
  PRICE_QUESTION: [
    /\bprecio/i, /\bcu[aá]nto\s+cuesta/i, /\bcu[aá]nto\s+vale/i,
    /\bcu[aá]nto\s+cobran/i, /\bcu[aá]nto\s+es\b/i, /\bcosto\b/i,
    /\btarifa\b/i, /\bpresupuesto\b/i,
  ],

  // HR/Job requests
  HR_REQUEST: [
    /\bvacante/i, /\bempleo\b/i, /\btrabajo\b/i, /\bcontrataci[oó]n/i,
    /\brecursos\s*humanos/i, /\brh\b/i, /\bpostularme\b/i,
    /\bcurr[ií]culum\b/i, /\bcv\b/i, /\bsueldo\b/i, /\bplaza\b/i,
  ],

  // Distributor indicators
  DISTRIBUIDOR: [
    /\bdistribui[dr]/i, /\bser\s+distribuidor/i, /\bvender\s+sus\s+productos/i,
    /\bfranquicia/i, /\brevendedor/i, /\bpunto\s+de\s+venta\s+propio/i,
    /\bquiero\s+vender\b/i, /\bcomercializar/i,
    /\bprecio(s)?\s+(para|de)\s+(veterinaria|tienda|negocio|reventa)/i,
  ],

  // Provider indicators
  PROVEEDOR: [
    /\bser\s+proveedor/i, /\bquiero\s+proveer/i, /\bsoy\s+proveedor/i,
    /\bvenderle[s]?\s+(a\s+)?(llabana|ustedes)/i,
    /\bofrecer(les?)?\s+(mis\s+)?(productos?|servicios?)/i,
    /\bmanufacturer\b/i, /\bsupplier\b/i, /\bfabricante\b/i,
    /\bwe\s+(are|make|produce|manufacture|supply)/i,
  ],

  // Reset/Start over
  RESET: /^(inicio|men[uú]|empezar|reset|start|comenzar|nueva\s*consulta|reiniciar)$/i,

  // Goodbye
  GOODBYE: /^(gracias|muchas gracias|seria todo|sería todo|ok gracias|vale gracias|listo gracias|perfecto gracias|hasta luego|bye|adios|adiós|no gracias|es todo|eso es todo)$/i,

  // Confirmation words
  CONFIRMATION: /^(s[ií]|si|claro|obvio|por supuesto|dale|ok|okay|perfecto|excelente|bueno|vale|listo)$/i,

  // Negation
  NEGATION: /^(no|nunca|jamás|de\s*ninguna?\s*manera|para\s*nada|ni\s*hablar)$/i,
};

class PatternRegistry {
  /**
   * Test if text matches a pattern category
   * @param {string} category - pattern category name (e.g., 'OUTSIDE_MEXICO')
   * @param {string} text - text to test
   * @returns {boolean}
   */
  static test(category, text) {
    if (!text || !patterns[category]) return false;
    const patternList = patterns[category];

    if (Array.isArray(patternList)) {
      return patternList.some(pattern => pattern.test(text));
    }
    return patternList.test(text);
  }

  /**
   * Get matching pattern from category
   * @returns {RegExp|null}
   */
  static getMatch(category, text) {
    if (!text || !patterns[category]) return null;
    const patternList = patterns[category];

    if (Array.isArray(patternList)) {
      return patternList.find(pattern => pattern.test(text)) || null;
    }
    return patternList.test(text) ? patternList : null;
  }

  /**
   * Get all patterns in a category
   */
  static getPatterns(category) {
    return patterns[category] || null;
  }

  /**
   * List all available categories
   */
  static getCategories() {
    return Object.keys(patterns);
  }

  /**
   * Add or update a pattern category
   */
  static register(category, patternOrList) {
    patterns[category] = patternOrList;
  }
}

module.exports = PatternRegistry;
