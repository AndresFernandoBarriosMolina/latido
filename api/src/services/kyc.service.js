import { withTx, query } from '../config/db.js';
import { config } from '../config/index.js';

// ============================================================================
//  Decisión de KYC (verificación de creadoras).
//
//  Automatización pensada para escala (millones de usuarios) SIN sacrificar el
//  cumplimiento legal. Dos modos:
//   - Con proveedor (KYC_PROVIDER): la aprobación la dicta el resultado del
//     proveedor (OCR + prueba de vida + face-match). Es la vía de producción.
//   - Sin proveedor (interino): aprobación automática por reglas. NO es
//     verificación real de identidad/vida; úsese solo en dev/MVP.
//
//  BARRERAS INNEGOCIABLES en ambos modos:
//   1) Nunca aprobar a un usuario que no sea verificablemente mayor de 18.
//   2) Nunca aprobar un documento ya usado por OTRA cuenta aprobada (anti-fraude).
// ============================================================================

async function isAdultUser(userId) {
  const { rows } = await query(`SELECT birthdate, age_verified FROM users WHERE id=$1`, [userId]);
  const u = rows[0];
  if (!u || !u.birthdate) return false;
  const age = (Date.now() - new Date(u.birthdate).getTime()) / (365.25 * 24 * 3600 * 1000);
  return u.age_verified === true && age >= 18;
}

async function documentAlreadyUsed(docHash, userId) {
  const { rows } = await query(
    `SELECT 1 FROM kyc_verifications
      WHERE document_number_hash=$1 AND status='approved' AND user_id<>$2 LIMIT 1`,
    [docHash, userId]
  );
  return rows.length > 0;
}

// Evalúa automáticamente una solicitud. Devuelve { decision, reason }.
//   decision ∈ 'approved' | 'rejected' | 'in_review'
export async function evaluateKyc({ userId, docHash, providerResult = null }) {
  // --- Barreras de seguridad (siempre) ---
  if (!(await isAdultUser(userId))) return { decision: 'rejected', reason: 'underage_or_unverified_age' };
  if (await documentAlreadyUsed(docHash, userId)) return { decision: 'rejected', reason: 'document_already_used' };

  // --- Con proveedor: manda el resultado del proveedor ---
  if (config.kyc.provider) {
    if (!providerResult) return { decision: 'in_review', reason: 'awaiting_provider' };
    const ok = providerResult.liveness_passed === true &&
               Number(providerResult.face_match_score || 0) >= config.kyc.faceMatchMin;
    return ok ? { decision: 'approved', reason: 'provider_passed' } : { decision: 'rejected', reason: 'provider_failed' };
  }

  // --- Sin proveedor: reglas (interino) o revisión manual ---
  if (config.kyc.autoApprove) return { decision: 'approved', reason: 'rules_auto_no_provider' };
  return { decision: 'in_review', reason: 'manual_review_required' };
}

// Aplica una decisión con efectos idénticos venga de donde venga (auto, manual,
// webhook de proveedor). Mantiene la auditoría y las notificaciones consistentes.
export async function applyDecision({ kycId, userId, decision, reviewerId = null, notes = null, source = 'auto', ip = null }) {
  const approved = decision === 'approve' || decision === 'approved';
  return withTx(async (c) => {
    await c.query(
      `UPDATE kyc_verifications SET status=$1, reviewer_id=$2, review_notes=$3, reviewed_at=now() WHERE id=$4`,
      [approved ? 'approved' : 'rejected', reviewerId, notes, kycId]
    );
    if (approved) {
      await c.query(`UPDATE model_profiles SET kyc_status='approved', kyc_approved_at=now(), published=true WHERE user_id=$1`, [userId]);
      await c.query(`UPDATE profiles SET is_verified=true WHERE user_id=$1`, [userId]);
      await c.query(
        `INSERT INTO notifications (user_id,type,title,body)
         VALUES ($1,'kyc_approved','¡Verificación aprobada! 🎉','Tu cuenta de creadora fue verificada. Ya puedes publicar contenido.')`,
        [userId]
      );
    } else {
      await c.query(`UPDATE model_profiles SET kyc_status='rejected' WHERE user_id=$1`, [userId]);
      await c.query(
        `INSERT INTO notifications (user_id,type,title,body)
         VALUES ($1,'kyc_rejected','Verificación no aprobada','Tu solicitud no cumple los requisitos. Puedes enviar nuevos documentos.')`,
        [userId]
      );
    }
    await c.query(
      `INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta)
       VALUES ($1,$2,'kyc_verifications',$3,$4,$5)`,
      [reviewerId, source === 'manual' ? 'kyc.decision' : 'kyc.auto_decision', kycId, ip,
       JSON.stringify({ decision: approved ? 'approve' : 'reject', notes, source })]
    );
    return approved ? 'approved' : 'rejected';
  });
}
