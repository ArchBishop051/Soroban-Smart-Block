import { parseFeeBump } from "./feeBumpParser.js";
import { extractFailureReason } from "./diagnosticParser.js";

export function calculateFeeBreakdown({ inclusionFee = 0, resourceFee = 0, refundableFeeCharged = 0, refundAmount = 0, rentFee = 0 } = {}) {
  const inclusion = Number(inclusionFee) || 0;
  const resource = Number(resourceFee) || 0;
  const refund = Number(refundAmount) || 0;
  const refundable = Number(refundableFeeCharged) || 0;
  const charged = inclusion + resource + refundable + (Number(rentFee) || 0) - refund;
  return { inclusion_fee: inclusion, resource_fee: resource, refundable_fee_charged: refundable, refund_amount: refund, rent_fee: Number(rentFee) || 0, charged_fee: charged };
}

export async function extractTransactionRecord({ hash, ledger, source, status, resultCode, operationCount = 0, footprint = {}, fee, envelopeXdr, resultMetaXdr, diagnostics }) {
  const feeBump = envelopeXdr ? parseFeeBump(envelopeXdr) : null;
  const failureReason = diagnostics ? await extractFailureReason(diagnostics) : null;
  return { hash, ledger, source: source ?? null, status: status ?? "unknown", result_code: resultCode ?? null, operation_count: operationCount, footprint_read_bytes: footprint.readBytes ?? null, footprint_write_bytes: footprint.writeBytes ?? null, fee_payer: feeBump?.sponsor ?? source ?? null, inner_source: feeBump?.inner_source ?? source ?? null, ...calculateFeeBreakdown(fee), failure_reason: failureReason };
}

export function feeBreakdownFromSorobanMeta(meta = {}) {
  return calculateFeeBreakdown({ inclusionFee: meta.inclusionFee ?? meta.inclusion_fee, resourceFee: meta.resourceFee ?? meta.resource_fee, refundableFeeCharged: meta.refundableFeeCharged ?? meta.refundable_fee_charged, refundAmount: meta.refundAmount ?? meta.refund_amount, rentFee: meta.rentFee ?? meta.rent_fee });
}
