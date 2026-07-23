export type LeadsGetManyInput = undefined

export type EnrichmentStatus = 'PENDING' | 'COMPLETED' | 'FAILED'

export type Enrichment = {
  type: string
  status: EnrichmentStatus
  error: string | null
}

export type LeadsGetManyOutput = {
  id: number
  createdAt: string
  updatedAt: string
  firstName: string
  lastName: string | null
  email: string | null
  jobTitle: string | null
  countryCode: string | null
  companyName: string | null
  message: string | null
  emailVerified: boolean | null
  enrichments: Enrichment[]
}[]
