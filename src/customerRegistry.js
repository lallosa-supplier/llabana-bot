/**
 * CustomerRegistry — Consolidates customer registration logic (5 paths unified into 1)
 * Single source of truth for finding or creating customers
 */

const sheetsService = require('./sheetsService');
const logger = require('./logger');

class CustomerRegistry {
  /**
   * Register or find customer — single entry point for all registration paths
   * Handles 5 different scenarios that were previously duplicated:
   * 1. New customer (find + create if not exists)
   * 2. Existing customer by phone
   * 3. Existing customer by email
   * 4. Fallback registration with minimal data
   * 5. Update existing customer with new data
   */
  static async registerOrFind(phone, data = {}) {
    try {
      // Primero intentar encontrar por teléfono (más confiable)
      let customer = await sheetsService.findCustomer(phone);

      if (customer) {
        logger.debug('REGISTRY', `Customer found by phone: ${customer.name} (row ${customer.rowIndex})`);
        return customer;
      }

      // Si no existe, registrar como nuevo
      logger.info('REGISTRY', `Registering new customer: ${data.name || 'sin nombre'}`);
      const rowIndex = await sheetsService.registerCustomer({
        phone,
        name: data.name || '',
        email: data.email || '',
        state: data.state || '',
        city: data.city || '',
        cp: data.cp || '',
        segmento: data.segmento || 'Lead frío',
        aceWa: data.aceWa || 'SI',
        entryPoint: data.entryPoint || 'Directo',
        origen: data.origen || 'WhatsApp',
      });

      if (rowIndex) {
        // Recuperar el registro que acabamos de crear para retornarlo
        return await sheetsService.findCustomer(phone);
      }

      return null;
    } catch (err) {
      logger.error('REGISTRY', 'Error in registerOrFind', err);
      return null;
    }
  }

  /**
   * Update customer data atomically
   * Consolidates updateOrderData calls scattered throughout botLogic.js
   */
  static async updateCustomer(rowIndex, data) {
    if (!rowIndex) {
      logger.warn('REGISTRY', 'Cannot update: no rowIndex provided');
      return false;
    }

    try {
      await sheetsService.updateOrderData(rowIndex, data);
      logger.debug('REGISTRY', `Customer updated (row ${rowIndex})`);
      return true;
    } catch (err) {
      logger.warn('REGISTRY', `Failed to update customer: ${err.message}`);
      return false;
    }
  }

  /**
   * Add tag to customer
   */
  static async addTag(rowIndex, tag) {
    if (!rowIndex) return false;
    try {
      await sheetsService.appendTag(rowIndex, tag);
      logger.debug('REGISTRY', `Tag added: ${tag}`);
      return true;
    } catch (err) {
      logger.warn('REGISTRY', `Failed to add tag: ${err.message}`);
      return false;
    }
  }

  /**
   * Add note to customer
   */
  static async addNote(rowIndex, note) {
    if (!rowIndex) return false;
    try {
      await sheetsService.appendNota(rowIndex, note);
      logger.debug('REGISTRY', `Note added`);
      return true;
    } catch (err) {
      logger.warn('REGISTRY', `Failed to add note: ${err.message}`);
      return false;
    }
  }

  /**
   * Log conversation to customer record
   */
  static async logConversation(phone, message, response) {
    try {
      await sheetsService.appendConversationLog(phone, message, response);
      logger.debug('REGISTRY', `Conversation logged`);
      return true;
    } catch (err) {
      logger.warn('REGISTRY', `Failed to log conversation: ${err.message}`);
      return false;
    }
  }
}

module.exports = CustomerRegistry;
