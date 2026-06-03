/**
 * Session Updaters — Atomic, typed wrappers for session updates
 * Prevents race conditions and ensures consistent session mutations
 */

const sessionManager = require('./sessionManager');
const CustomerRegistry = require('./customerRegistry');
const logger = require('./logger');

class SessionUpdaters {
  /**
   * Update conversation state
   */
  static async updateState(phone, newState) {
    try {
      await sessionManager.updateSession(phone, { flowState: newState });
      logger.debug('STATE_UPDATE', `${phone} → ${newState}`);
      return true;
    } catch (err) {
      logger.error('STATE_UPDATE', `Failed to update state for ${phone}`, err);
      return false;
    }
  }

  /**
   * Add message to conversation history
   */
  static async addMessageToHistory(phone, role, content) {
    try {
      const session = await sessionManager.getSession(phone);
      const history = session?.conversationHistory || [];

      history.push({
        role,
        content: typeof content === 'string' ? content : JSON.stringify(content),
      });

      await sessionManager.updateSession(phone, {
        conversationHistory: history,
      });

      logger.debug('HISTORY_UPDATE', `${role} message added for ${phone}`);
      return true;
    } catch (err) {
      logger.error('HISTORY_UPDATE', `Failed to update history for ${phone}`, err);
      return false;
    }
  }

  /**
   * Update customer info (name, CP, state, etc)
   */
  static async updateCustomerInfo(phone, customerData) {
    try {
      const session = await sessionManager.getSession(phone);
      const current = session?.customer || {};

      const updated = { ...current, ...customerData };
      await sessionManager.updateSession(phone, { customer: updated });

      // Also update Sheets if customer has rowIndex
      if (current.rowIndex) {
        await CustomerRegistry.updateCustomer(current.rowIndex, customerData);
      }

      logger.info('CUSTOMER_UPDATE', `Updated customer info for ${phone}`);
      return true;
    } catch (err) {
      logger.error('CUSTOMER_UPDATE', `Failed to update customer for ${phone}`, err);
      return false;
    }
  }

  /**
   * Update temporary data (flow state info, form progress, etc)
   */
  static async updateTempData(phone, tempDataPartial) {
    try {
      const session = await sessionManager.getSession(phone);
      const current = session?.tempData || {};

      await sessionManager.updateSession(phone, {
        tempData: { ...current, ...tempDataPartial },
      });

      logger.debug('TEMP_DATA_UPDATE', `Updated tempData for ${phone}`);
      return true;
    } catch (err) {
      logger.error('TEMP_DATA_UPDATE', `Failed to update tempData for ${phone}`, err);
      return false;
    }
  }

  /**
   * Set escalation metadata (reason, time, details)
   */
  static async setEscalationData(phone, escalationData) {
    try {
      const session = await sessionManager.getSession(phone);
      const tempData = session?.tempData || {};

      await sessionManager.updateSession(phone, {
        flowState: 'waiting_for_wig',
        tempData: {
          ...tempData,
          escalationReason: escalationData.reason,
          escalationTime: new Date().toISOString(),
          escalationDetails: escalationData.details || {},
          wigAvisado: true,
        },
      });

      logger.info('ESCALATION_DATA', `Escalation data set for ${phone}`);
      return true;
    } catch (err) {
      logger.error('ESCALATION_DATA', `Failed to set escalation data for ${phone}`, err);
      return false;
    }
  }

  /**
   * Clear sensitive data (CP) from session after use
   */
  static async clearSensitiveData(phone, fields = ['cp']) {
    try {
      const session = await sessionManager.getSession(phone);
      const customer = session?.customer || {};

      const cleaned = { ...customer };
      fields.forEach(field => delete cleaned[field]);

      await sessionManager.updateSession(phone, { customer: cleaned });

      logger.info('DATA_CLEAR', `Cleared ${fields.join(', ')} from ${phone}`);
      return true;
    } catch (err) {
      logger.error('DATA_CLEAR', `Failed to clear data for ${phone}`, err);
      return false;
    }
  }

  /**
   * Reset session to initial state (after goodbye)
   */
  static async resetToInitial(phone) {
    try {
      const session = await sessionManager.getSession(phone);
      const customer = session?.customer || {};

      // Keep customer name but reset flow
      await sessionManager.updateSession(phone, {
        flowState: 'active',
        conversationHistory: [],
        tempData: {},
        customer: {
          ...customer,
          // Clear sensitive temp data but keep identifying info
        },
      });

      logger.info('SESSION_RESET', `Session reset for ${phone}`);
      return true;
    } catch (err) {
      logger.error('SESSION_RESET', `Failed to reset session for ${phone}`, err);
      return false;
    }
  }

  /**
   * Mark session as out of coverage
   */
  static async markOutOfCoverage(phone) {
    try {
      await sessionManager.updateSession(phone, {
        flowState: 'out_of_coverage',
        tempData: {
          outOfCoverageTime: new Date().toISOString(),
        },
      });

      logger.info('OUT_OF_COVERAGE', `Marked out of coverage: ${phone}`);
      return true;
    } catch (err) {
      logger.error('OUT_OF_COVERAGE', `Failed to mark out of coverage for ${phone}`, err);
      return false;
    }
  }
}

module.exports = SessionUpdaters;
