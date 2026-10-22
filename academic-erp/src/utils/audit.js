const db = require('../config/db');

/**
 * Insert-only audit entry. Pass `conn` (the transaction handle) to make the
 * audit row commit or roll back together with the change it describes.
 */
async function recordAudit({ req, action, entityType, entityId, oldValue, newValue, reason }, conn = db) {
  await conn.query(
    `INSERT INTO audit_logs
       (user_id, user_role, action, entity_type, entity_id, old_value, new_value, reason, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      req.user ? req.user.id : null,
      req.user ? req.user.role : null,
      action,
      entityType,
      entityId != null ? String(entityId) : null,
      oldValue != null ? JSON.stringify(oldValue) : null,
      newValue != null ? JSON.stringify(newValue) : null,
      reason || null,
      req.ip,
    ]
  );
}

module.exports = { recordAudit };
