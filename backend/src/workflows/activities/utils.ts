import { PrismaClient } from '@prisma/client'

// Activities run in the normal Node context (not the workflow sandbox), so it is
// safe to use Prisma directly here.
const prisma = new PrismaClient()

export const EMAIL_VERIFICATION = 'EMAIL_VERIFICATION'

export async function verifyEmail(email: string): Promise<boolean> {
    if (email.includes('john.doe')) {
        return false;
    }

    if (email.includes('jane.smith')) {
        await new Promise((resolve) => setTimeout(resolve, 20000));
    }

    if (/\+/.test(email)) {
        return false;
    }

    return true;
}

// Records a successful verification: the result lives on the lead itself, while
// the enrichment row is flipped to COMPLETED.
export async function recordVerificationResult(leadId: number, verified: boolean): Promise<void> {
    await prisma.lead.update({
        where: { id: leadId },
        data: { emailVerified: verified },
    })

    await prisma.enrichment.update({
        where: { leadId_type: { leadId, type: EMAIL_VERIFICATION } },
        data: { status: 'COMPLETED', error: null },
    })
}

// Records a failed verification so the enrichment row reaches a terminal state
// instead of being stranded in PENDING.
export async function recordVerificationFailure(leadId: number, error: string): Promise<void> {
    await prisma.enrichment.update({
        where: { leadId_type: { leadId, type: EMAIL_VERIFICATION } },
        data: { status: 'FAILED', error },
    })
}
