/**
 * Escalation Manager — Central hub for all escalation logic
 * Consolidates escalation handling from botLogic.js, wigAdminHandler.js, colaEscalaciones.js
 */

const sessionManager = require('./sessionManager');
const twilioService = require('./twilioService');
const CustomerRegistry = require('./customerRegistry');
const logger = require('./logger');

class EscalationManager {
  /**
   * Initiate escalation to Wig (main entry point)
   * @param {string} phone
   * @param {object} session
   * @param {string} reason - Why escalating
   * @param {object} options - { cp, quantity, zone, etc }
   * @returns {object} { escalated: boolean, fueraHorario: boolean }
   */
  static async escalate(phone, session, reason, options = {}) {
    try {
      logger.info('ESCALATION', `Escalating ${phone}: ${reason}`);

      // Update session to waiting_for_wig
      await sessionManager.updateSession(phone, {
        flowState: 'waiting_for_wig',
        tempData: {
          ...session.tempData,
          escalationReason: reason,
          escalationTime: new Date().toISOString(),
          escalationDetails: options,
          wigAvisado: true,
        },
      });

      // Notify Wig
      const { fueraHorario } = await this.notifyWig(phone, session, reason, options);

      // If outside business hours, add to queue for follow-up
      if (fueraHorario) {
        await this.queueForLaterNotification(phone, reason);
        logger.info('ESCALATION', `Queued for later notification: ${phone}`);
      }

      return { escalated: true, fueraHorario };
    } catch (err) {
      logger.error('ESCALATION', 'Error escalating', err);
      return { escalated: false, error: err.message };
    }
  }

  /**
   * Notify Wig about escalation (immediate or queued)
   */
  static async notifyWig(phone, session, reason, options = {}) {
    const customer = session.customer || {};
    const nombre = customer.name || session.tempData?.name || 'Sin nombre';
    const telefonoLimpio = phone.replace('whatsapp:', '');

    const message = this._buildWigNotification(phone, nombre, reason, options);

    try {
      await twilioService.sendMessage(process.env.WIG_WHATSAPP_NUMBER, message);
      logger.success('WIG_NOTIFY', `Notified Wig: ${nombre}`);
      return { notified: true, fueraHorario: false };
    } catch (err) {
      logger.error('WIG_NOTIFY', 'Failed to notify Wig', err);
      return { notified: false, fueraHorario: true };
    }
  }

  /**
   * Queue escalation for out-of-hours notification
   */
  static async queueForLaterNotification(phone, reason) {
    try {
      const redis = sessionManager.getRedisClient?.();
      if (redis) {
        await redis.lpush(
          'escalations:pending',
          JSON.stringify({ phone, reason, timestamp: Date.now() })
        );
        logger.debug('QUEUE', `Added to escalation queue: ${phone}`);
      }
    } catch (err) {
      logger.warn('QUEUE', `Failed to queue escalation: ${err.message}`);
    }
  }

  /**
   * Handle Wig admin command (/atendido, /reparto, etc)
   */
  static async handleWigCommand(phone, command) {
    logger.info('WIG_COMMAND', `Command from Wig: ${command} for ${phone}`);

    if (command.startsWith('/atendido')) {
      return await this._handleAtendido(phone);
    }
    if (command.startsWith('/reparto')) {
      return await this._handleReparto(phone);
    }
    if (command.startsWith('/nocontesta')) {
      return await this._handleNoContesta(phone);
    }

    return 'Comando no reconocido';
  }

  /**
   * Close escalation (customer was attended)
   */
  static async _handleAtendido(phone) {
    try {
      await sessionManager.deleteSession(phone);
      logger.success('ESCALATION_CLOSE', `Customer attended and closed: ${phone}`);
      return `✅ Sesión cerrada para ${phone}`;
    } catch (err) {
      logger.error('ESCALATION_CLOSE', 'Error closing session', err);
      return 'Error cerrando sesión';
    }
  }

  /**
   * Mark customer as distributor/reparto
   */
  static async _handleReparto(phone) {
    try {
      const customer = await CustomerRegistry.registerOrFind(phone);
      if (customer?.rowIndex) {
        await CustomerRegistry.updateCustomer(customer.rowIndex, {
          segmento: 'Distribuidor',
        });
        await CustomerRegistry.addTag(customer.rowIndex, 'Reparto');
        logger.success('REPARTO', `Marked as distributor: ${phone}`);
        return `✅ ${customer.name} marcado como Distribuidor`;
      }
    } catch (err) {
      logger.error('REPARTO', 'Error marking reparto', err);
    }
    return 'Error procesando comando';
  }

  /**
   * Mark customer as non-responsive
   */
  static async _handleNoContesta(phone) {
    try {
      const customer = await CustomerRegistry.registerOrFind(phone);
      if (customer?.rowIndex) {
        await CustomerRegistry.addTag(customer.rowIndex, 'No Contestó');
        logger.info('NO_CONTESTA', `Marked as no-answer: ${phone}`);
        return `✅ ${customer.name} marcado como No Contestó`;
      }
    } catch (err) {
      logger.error('NO_CONTESTA', 'Error marking no-contesta', err);
    }
    return 'Error procesando comando';
  }

  /**
   * Build formatted message for Wig
   */
  static _buildWigNotification(phone, nombre, reason, options) {
    const parts = [
      `📨 *ESCALACIÓN*`,
      ``,
      `👤 *Cliente:* ${nombre}`,
      `📱 *Teléfono:* ${phone}`,
      `🏷️ *Motivo:* ${reason}`,
    ];

    if (options.cp) parts.push(`📍 *CP:* ${options.cp}`);
    if (options.quantity) parts.push(`📦 *Cantidad:* ${options.quantity} bultos`);
    if (options.zone) parts.push(`🗺️ *Zona:* ${options.zone}`);

    return parts.join('\n');
  }
}

module.exports = EscalationManager;
