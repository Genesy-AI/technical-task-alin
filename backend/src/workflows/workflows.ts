import { proxyActivities } from '@temporalio/workflow'
import type * as activities from './activities'

const { verifyEmail, recordVerificationResult, recordVerificationFailure } = proxyActivities<
  typeof activities
>({
  // The verification provider can legitimately take a long time, so give the
  // activity a realistic per-attempt timeout, detect dead calls via heartbeat,
  // and bound retries + total duration so a failing check can never hang forever.
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '30 seconds',
  scheduleToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
})

export async function verifyEmailWorkflow(leadId: number, email: string): Promise<boolean> {
  try {
    const verified = await verifyEmail(email)
    await recordVerificationResult(leadId, verified)
    return verified
  } catch (err) {
    // Any failure (including retries exhausted) is recorded as a terminal state
    // so the enrichment row is never stranded in PENDING.
    await recordVerificationFailure(leadId, err instanceof Error ? err.message : String(err))
    throw err
  }
}
