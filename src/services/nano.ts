export interface Poll {
  id: number
  title: string
  description: string
  options: string[]
  option_count?: number
  token_uid: string
  start_at: number
  end_at: number
  creator: string
  weighting: string
  weight_cap: number
  results?: PollResult[]
}

export interface PollResult {
  option: string
  weight: number
  votes: number
}

export interface TransactionStatus {
  firstBlock: string | null
  isVoided: boolean
  voidedBy: string[]
  ncExecution: string | null
  ncMethod: string | null
}

interface ContractHistoryItem {
  timestamp?: number
  nc_method?: string
  nc_args_decoded?: unknown[]
  nc_context?: {
    caller_id?: string
    address?: string
  }
  is_voided?: boolean
}

const RAW_NODE_URL = import.meta.env.VITE_HATHOR_NODE_URL || '/api/'
const CONTRACT_ID = import.meta.env.VITE_POLL_CONTRACT_ID || ''
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_NC_STATE_TIMEOUT_MS || 30000)

const normalizeBaseUrl = (url: string) => {
  if (!url.endsWith('/')) return `${url}/`
  return url
}

const NODE_URL = normalizeBaseUrl(RAW_NODE_URL)

const DEFAULT_POLL_WEIGHTING = 'linear'

const unwrapValue = (val: any) => {
  if (val && typeof val === 'object') {
    if ('value' in val) return (val as any).value
    if ('result' in val) return (val as any).result
  }
  return val
}

const extractCallValue = (callsResult: any, prefix: string) => {
  if (!callsResult) return null
  if (Array.isArray(callsResult)) {
    const item = callsResult.find((entry) => {
      const key = entry?.call || entry?.method || entry?.name || ''
      return typeof key === 'string' && key.startsWith(prefix)
    })
    if (!item) return null
    return unwrapValue(item.result ?? item.value ?? item)
  }
  if (typeof callsResult === 'object') {
    const callKey = Object.keys(callsResult).find((k) => typeof k === 'string' && k.startsWith(prefix))
    if (!callKey) return null
    const val = callsResult[callKey]
    return unwrapValue(val?.result ?? val?.value ?? val)
  }
  return null
}

const extractCallValueByCall = (callsResult: any, call: string) => {
  if (!callsResult) return null
  if (Array.isArray(callsResult)) {
    const item = callsResult.find((entry) => {
      const key = entry?.call || entry?.method || entry?.name || ''
      return key === call
    })
    if (!item) return null
    return unwrapValue(item.result ?? item.value ?? item)
  }
  if (typeof callsResult === 'object') {
    if (call in callsResult) {
      const val = callsResult[call]
      return unwrapValue(val?.result ?? val?.value ?? val)
    }
  }
  return null
}

interface CallNanoStateOptions {
  calls?: string[]
  fields?: string[]
}

const callNanoState = async ({ calls = [], fields = [] }: CallNanoStateOptions = {}) => {
  if (!CONTRACT_ID) {
    throw new Error('Missing VITE_POLL_CONTRACT_ID')
  }

  const params = new URLSearchParams()
  params.set('id', CONTRACT_ID)
  calls.forEach((call: string) => params.append('calls[]', call))
  fields.forEach((field) => params.append('fields[]', field))

  const url = `${NODE_URL}nano_contract/state?${params.toString()}`
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null

  try {
    const res = await fetch(url, controller ? { signal: controller.signal } : undefined)
    const payload = await res.json()
    if (!res.ok) {
      throw new Error(payload?.message || payload?.error || 'Failed to fetch nano contract state')
    }
    return payload
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

const callNanoHistory = async (): Promise<ContractHistoryItem[]> => {
  if (!CONTRACT_ID) {
    throw new Error('Missing VITE_POLL_CONTRACT_ID')
  }

  const res = await fetch(`${NODE_URL}nano_contract/history?id=${CONTRACT_ID}`)
  const payload = await res.json()
  if (!res.ok) {
    throw new Error(payload?.message || payload?.error || 'Failed to fetch nano contract history')
  }

  return Array.isArray(payload?.history) ? payload.history : []
}

export const fetchTransactionStatus = async (txId: string): Promise<TransactionStatus> => {
  if (!txId) {
    throw new Error('Missing tx id')
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null

  try {
    const res = await fetch(`${NODE_URL}transaction?id=${txId}`, controller ? { signal: controller.signal } : undefined)
    const payload = await res.json()

    if (!res.ok) {
      throw new Error(payload?.message || payload?.error || 'Failed to fetch transaction')
    }

    const firstBlock = payload?.first_block || payload?.meta?.first_block || payload?.tx?.first_block || null
    const voidedBy = Array.isArray(payload?.meta?.voided_by) ? payload.meta.voided_by : []
    const isVoided = payload?.is_voided === true ||
      payload?.meta?.voided === true ||
      voidedBy.length > 0

    return {
      firstBlock,
      isVoided,
      voidedBy,
      ncExecution: payload?.meta?.nc_execution || null,
      ncMethod: payload?.tx?.nc_method || null,
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export const hasAddressVoted = async (pollId: number, address: string): Promise<boolean> => {
  if (!address) return false

  const history = await callNanoHistory()
  const targetAddress = address.toLowerCase()

  return history.some((entry) => {
    if (entry?.nc_method !== 'cast_vote' || entry?.is_voided) return false
    const args = Array.isArray(entry?.nc_args_decoded) ? entry.nc_args_decoded : []
    const votePollId = Number(args[0])
    const voter = (entry?.nc_context?.caller_id || entry?.nc_context?.address || '').toLowerCase()
    return votePollId === pollId && voter === targetAddress
  })
}

const parseCreatePollArgs = (args: unknown[] = []) => {
  const [
    title = '',
    description = '',
    rawOptions = [],
    tokenUid = '00',
    startAt = 0,
    endAt = 0,
    weighting = DEFAULT_POLL_WEIGHTING,
    weightCap = 0,
  ] = args

  return {
    title: String(title || ''),
    description: String(description || ''),
    options: Array.isArray(rawOptions) ? rawOptions.map((option) => String(option || '')) : [],
    token_uid: String(tokenUid || '00'),
    start_at: Number(startAt || 0),
    end_at: Number(endAt || 0),
    weighting: String(weighting || DEFAULT_POLL_WEIGHTING),
    weight_cap: Number(weightCap || 0),
  }
}

const fetchPollResults = async (pollId: number, fallbackOptions: string[]): Promise<PollResult[]> => {
  const resultsCall = `get_poll_results(${pollId})`
  const detailState = await callNanoState({ calls: [resultsCall] })
  const rawResults = extractCallValueByCall(detailState?.calls, resultsCall) as Array<[number, number, number]>

  if (!Array.isArray(rawResults)) {
    return []
  }

  return rawResults.map((row) => {
    const index = row?.[0] ?? 0
    return {
      option: fallbackOptions[index] || `Option ${index + 1}`,
      weight: row?.[1] ?? 0,
      votes: row?.[2] ?? 0,
    }
  })
}

export const fetchPollCount = async (): Promise<number> => {
  const state = await callNanoState({ calls: ['get_poll_count()'] })
  const count = extractCallValue(state?.calls, 'get_poll_count')
  const numeric = Number(Array.isArray(count) ? count[0] : count)
  return Number.isFinite(numeric) ? numeric : 0
}

export const fetchPoll = async (pollId: number): Promise<Poll> => {
  const history = await callNanoHistory()
  const createPollEntries = history
    .filter((entry) => entry?.nc_method === 'create_poll' && !entry?.is_voided)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

  const entry = createPollEntries[pollId]
  if (!entry) {
    throw new Error('Poll not found')
  }

  const poll = parseCreatePollArgs(entry.nc_args_decoded)
  const results = await fetchPollResults(pollId, poll.options)

  return {
    id: pollId,
    title: poll.title || `Poll #${pollId + 1}`,
    description: poll.description,
    options: poll.options,
    option_count: poll.options.length,
    token_uid: poll.token_uid,
    start_at: poll.start_at,
    end_at: poll.end_at,
    creator: entry.nc_context?.caller_id || entry.nc_context?.address || '',
    weighting: poll.weighting,
    weight_cap: poll.weight_cap,
    results,
  }
}

export const fetchPolls = async (limit = 20): Promise<Poll[]> => {
  const count = await fetchPollCount()
  const max = Math.min(count, limit)
  return Promise.all(Array.from({ length: max }, (_, index) => fetchPoll(index)))
}

export const getContractId = () => CONTRACT_ID
