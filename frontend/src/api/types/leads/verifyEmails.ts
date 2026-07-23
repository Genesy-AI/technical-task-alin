export type LeadsVerifyEmailsInput = {
  leadIds: number[]
}

export type LeadsVerifyEmailsOutput = {
  // Leads for which a verification workflow was started.
  started: number[]
  // Leads skipped because a verification is already in flight (or could not start).
  skipped: number[]
}
