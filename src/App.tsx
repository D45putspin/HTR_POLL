import { useEffect, useMemo, useState } from 'react'
import { useWallet } from './contexts/WalletContext'
import Toast from './components/Toast'
import { fetchPolls, fetchTransactionStatus, fetchVote, getContractId, type Poll, type VoteInfo } from './services/nano'

const blueprintId = import.meta.env.VITE_POLL_BLUEPRINT_ID || ''
const contractId = getContractId()
const defaultCreationFee = Number(import.meta.env.VITE_POLL_CREATION_FEE || 0)

const formatDateTime = (value: number) => {
  if (!value) return 'n/a'
  const date = new Date(value * 1000)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const toDateInputValue = (value: Date) => {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toLocalDayStart = (value: Date) => (
  new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0)
)

const parseDateInput = (value: string) => {
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

const shortAddr = (addr: string | null | undefined) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''

const getPollPhase = (poll: Poll, now: number) => {
  if (now < poll.start_at) return 'upcoming'
  if (now > poll.end_at) return 'closed'
  return 'live'
}

const EMPTY_VOTE: VoteInfo = {
  voted: false,
  option: null,
  weight: 0,
  deposit: 0,
  locked_until: 0,
}

const PollApp = () => {
  const { connected, address, connect, disconnect, connecting, error, signNanoContractTx } = useWallet()
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)
  const [waitingWallet, setWaitingWallet] = useState(false)
  const [checkingVoteStatus, setCheckingVoteStatus] = useState(false)
  const [selectedVote, setSelectedVote] = useState<VoteInfo>(EMPTY_VOTE)
  const [pendingTx, setPendingTx] = useState<{
    txId: string
    label: string
    kind: 'create' | 'vote' | 'withdraw'
    pollId?: number
  } | null>(null)
  const [view, setView] = useState<'polls' | 'create'>('polls')
  const [selectedPollId, setSelectedPollId] = useState<number | null>(null)

  const [form, setForm] = useState({
    title: '',
    description: '',
    tokenUid: '00',
    startPreset: 'today' as 'today' | 'tomorrow' | 'custom',
    customStartDate: toDateInputValue(new Date()),
    durationDays: '1',
  })
  const [options, setOptions] = useState<string[]>(['', ''])
  const [voteInputs, setVoteInputs] = useState<Record<number, { option: number; amount: string }>>({})
  const [withdrawInputs, setWithdrawInputs] = useState<Record<number, string>>({})

  const isReady = Boolean(contractId)
  const now = Math.floor(Date.now() / 1000)

  const banner = useMemo(() => {
    if (!contractId) return 'Set VITE_POLL_CONTRACT_ID to load live polls.'
    return null
  }, [])

  const sortedPolls = useMemo(() => {
    return [...polls].sort((left, right) => {
      const leftPhase = getPollPhase(left, now)
      const rightPhase = getPollPhase(right, now)
      const phaseRank = { live: 0, upcoming: 1, closed: 2 }
      if (phaseRank[leftPhase] !== phaseRank[rightPhase]) {
        return phaseRank[leftPhase] - phaseRank[rightPhase]
      }
      return right.start_at - left.start_at
    })
  }, [now, polls])

  const selectedPoll = useMemo(
    () => sortedPolls.find((poll) => poll.id === selectedPollId) ?? null,
    [selectedPollId, sortedPolls],
  )

  const createWindow = useMemo(() => {
    const durationDays = Number(form.durationDays)
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      return { startAt: 0, endAt: 0, error: 'Duration must be greater than zero.' }
    }

    if (!Number.isInteger(durationDays)) {
      return { startAt: 0, endAt: 0, error: 'Duration must be a whole number of days.' }
    }

    const todayStart = toLocalDayStart(new Date())
    let startDate: Date | null = todayStart

    if (form.startPreset === 'tomorrow') {
      startDate = new Date(todayStart)
      startDate.setDate(startDate.getDate() + 1)
    }

    if (form.startPreset === 'custom') {
      startDate = parseDateInput(form.customStartDate)
      if (!startDate) {
        return { startAt: 0, endAt: 0, error: 'Enter a valid custom start date.' }
      }
    }

    if (!startDate) {
      return { startAt: 0, endAt: 0, error: 'Invalid start date.' }
    }

    const startAt = Math.floor(startDate.getTime() / 1000)
    const endAt = Math.floor((startDate.getTime() + durationDays * 24 * 60 * 60 * 1000) / 1000)

    return { startAt, endAt, error: null }
  }, [form.customStartDate, form.durationDays, form.startPreset])

  const liveCount = sortedPolls.filter((poll) => getPollPhase(poll, now) === 'live').length
  const upcomingCount = sortedPolls.filter((poll) => getPollPhase(poll, now) === 'upcoming').length

  const loadPolls = async () => {
    if (!contractId) return
    setLoading(true)
    try {
      const data = await fetchPolls(20)
      setPolls(data)
    } catch (err: any) {
      setStatus(err?.message || 'Failed to load polls.')
      setIsSuccess(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPolls()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!contractId) return undefined

    const intervalId = setInterval(() => {
      fetchPolls(20)
        .then((data) => setPolls(data))
        .catch(() => {
          // silent background sync
        })
    }, 8000)

    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!selectedPoll) return undefined

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedPollId(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedPoll])

  useEffect(() => {
    if (selectedPollId === null || !address) {
      setSelectedVote(EMPTY_VOTE)
      setCheckingVoteStatus(false)
      return
    }

    let cancelled = false
    const pollId = selectedPollId
    setSelectedVote(EMPTY_VOTE)
    setCheckingVoteStatus(true)

    fetchVote(pollId, address)
      .then((vote) => {
        if (!cancelled) {
          setSelectedVote(vote)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedVote(EMPTY_VOTE)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingVoteStatus(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [address, selectedPollId])

  useEffect(() => {
    if (!pendingTx) return undefined

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const txLabel = pendingTx.label

    const checkConfirmation = async () => {
      try {
        const txStatus = await fetchTransactionStatus(pendingTx.txId)
        if (cancelled) return

        if (txStatus.isVoided) {
          setPendingTx(null)

          if (pendingTx.kind === 'vote') {
            const isContractFailure = txStatus.ncMethod === 'cast_vote' &&
              txStatus.ncExecution === 'failure' &&
              txStatus.voidedBy.includes('6e632d6661696c')

            if (isContractFailure && typeof pendingTx.pollId === 'number' && address) {
              try {
                const existingVote = await fetchVote(pendingTx.pollId, address)
                if (cancelled) return
                if (existingVote.voted) {
                  setStatus('This wallet already voted in this poll. One vote per wallet is allowed.')
                } else {
                  setStatus('Vote was rejected by the contract. Please check poll timing and try again.')
                }
              } catch {
                if (cancelled) return
                setStatus('Vote was rejected by the contract. Please try again.')
              }
            } else {
              setStatus('Vote transaction was voided by the network. Please try again.')
            }
          } else {
            setStatus(`${txLabel} was voided by the network. Please retry.`)
          }

          setIsSuccess(false)
          return
        }

        if (txStatus.firstBlock) {
          setPendingTx(null)
          await loadPolls()
          if (cancelled) return

          if (address && typeof pendingTx.pollId === 'number' && pendingTx.pollId === selectedPollId) {
            try {
              const refreshedVote = await fetchVote(pendingTx.pollId, address)
              if (cancelled) return
              setSelectedVote(refreshedVote)
            } catch {
              if (cancelled) return
            }
          }

          setStatus(`${txLabel} confirmed on-chain.`)
          setIsSuccess(true)
          return
        }
      } catch {
        // tx may not be indexed yet; keep polling
      }

      if (!cancelled) {
        timeoutId = setTimeout(checkConfirmation, 5000)
      }
    }

    checkConfirmation()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, pendingTx, selectedPollId])

  const handleOptionChange = (index: number, value: string) => {
    const next = [...options]
    next[index] = value
    setOptions(next)
  }

  const addOption = () => {
    setOptions((current) => [...current, ''])
  }

  const removeOption = (index: number) => {
    if (options.length <= 2) return
    const next = [...options]
    next.splice(index, 1)
    setOptions(next)
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatus(null)
    setIsSuccess(false)

    if (waitingWallet || pendingTx) {
      setStatus('Another transaction is in progress. Wait for confirmation before sending a new one.')
      return
    }

    if (!connected) {
      setStatus('Connect your wallet to create a poll.')
      return
    }

    const validOptions = options.map((option) => option.trim()).filter(Boolean)
    if (validOptions.length < 2) {
      setStatus('At least two valid options are required.')
      return
    }

    const { startAt, endAt, error: createWindowError } = createWindow
    const creationFee = defaultCreationFee

    if (createWindowError) {
      setStatus(createWindowError)
      setIsSuccess(false)
      return
    }

    if (endAt <= startAt) {
      setStatus('End date must be after start date.')
      setIsSuccess(false)
      return
    }

    if ((endAt - startAt) < 300) {
      setStatus('Poll window must be at least 5 minutes.')
      setIsSuccess(false)
      return
    }

    try {
      const actions = [] as Array<{ type: string; token: string; amount: number }>
      if (creationFee > 0) {
        actions.push({ type: 'deposit', token: '00', amount: creationFee })
      }

      setWaitingWallet(true)
      const result = await signNanoContractTx({
        method: 'create_poll',
        args: [
          form.title,
          form.description,
          validOptions,
          form.tokenUid,
          startAt,
          endAt,
          'linear',
          0,
        ],
        actions,
        ncId: contractId,
        blueprintId,
      })

      if (result?.txId) {
        setPendingTx({ txId: result.txId, label: 'Poll creation', kind: 'create' })
        setStatus('Poll creation submitted. Waiting for blockchain confirmation...')
      } else {
        setStatus('Poll creation transaction submitted.')
      }

      await loadPolls()
      setIsSuccess(true)
      setView('polls')
      setForm((previous) => ({ ...previous, title: '', description: '' }))
      setOptions(['', ''])
    } catch (err: any) {
      setStatus(err?.message || 'Failed to create poll.')
      setIsSuccess(false)
    } finally {
      setWaitingWallet(false)
    }
  }

  const handleVote = async (poll: Poll) => {
    if (waitingWallet || pendingTx) {
      setStatus('Another transaction is in progress. Wait for confirmation before sending a new one.')
      return
    }

    if (!connected) {
      setStatus('Connect your wallet to vote.')
      return
    }

    if (selectedVote.voted) {
      setStatus('This wallet already voted in this poll. One vote per wallet is allowed.')
      setIsSuccess(false)
      return
    }

    if (address) {
      try {
        const existingVote = await fetchVote(poll.id, address)
        if (existingVote.voted) {
          setSelectedVote(existingVote)
          setStatus('This wallet already voted in this poll. One vote per wallet is allowed.')
          setIsSuccess(false)
          return
        }
      } catch {
        // If the pre-check fails, continue and let the contract enforce the rule.
      }
    }

    const input = voteInputs[poll.id] || { option: 0, amount: '' }
    const amount = Number(input.amount || 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus('Enter a valid amount.')
      return
    }

    try {
      setWaitingWallet(true)
      const result = await signNanoContractTx({
        method: 'cast_vote',
        args: [poll.id, input.option],
        actions: [{ type: 'deposit', token: poll.token_uid, amount }],
        ncId: contractId,
        blueprintId,
      })

      if (result?.txId) {
        setPendingTx({ txId: result.txId, label: 'Vote', kind: 'vote', pollId: poll.id })
        setStatus('Vote submitted. Waiting for blockchain confirmation...')
      } else {
        setStatus('Vote transaction submitted.')
      }

      await loadPolls()
      setIsSuccess(true)
    } catch (err: any) {
      setStatus(err?.message || 'Vote failed.')
      setIsSuccess(false)
    } finally {
      setWaitingWallet(false)
    }
  }

  const handleWithdraw = async (poll: Poll) => {
    if (waitingWallet || pendingTx) {
      setStatus('Another transaction is in progress. Wait for confirmation before sending a new one.')
      return
    }

    if (!connected || !address) {
      setStatus('Connect your wallet to withdraw your vote deposit.')
      return
    }

    if (now <= poll.end_at) {
      setStatus(`Vote deposits unlock after ${formatDateTime(poll.end_at)}.`)
      setIsSuccess(false)
      return
    }

    let vote = selectedVote

    try {
      vote = await fetchVote(poll.id, address)
      setSelectedVote(vote)
    } catch {
      // If the fresh read fails, keep the last known dialog state.
    }

    if (!vote.voted || vote.deposit <= 0) {
      setStatus('No deposited balance is available to withdraw for this wallet.')
      setIsSuccess(false)
      return
    }

    const rawAmount = withdrawInputs[poll.id] ?? String(vote.deposit)
    const amount = Number(rawAmount || 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus('Enter a valid withdrawal amount.')
      setIsSuccess(false)
      return
    }

    if (amount > vote.deposit) {
      setStatus(`You can withdraw up to ${vote.deposit}.`)
      setIsSuccess(false)
      return
    }

    try {
      setWaitingWallet(true)
      const result = await signNanoContractTx({
        method: 'withdraw_vote',
        args: [poll.id],
        actions: [{ type: 'withdrawal', token: poll.token_uid, amount: String(amount), address }],
        ncId: contractId,
        blueprintId,
      })

      if (result?.txId) {
        setPendingTx({ txId: result.txId, label: 'Vote withdrawal', kind: 'withdraw', pollId: poll.id })
        setStatus('Vote withdrawal submitted. Waiting for blockchain confirmation...')
      } else {
        setStatus('Vote withdrawal transaction submitted.')
      }

      await loadPolls()
      setIsSuccess(true)
    } catch (err: any) {
      setStatus(err?.message || 'Vote withdrawal failed.')
      setIsSuccess(false)
    } finally {
      setWaitingWallet(false)
    }
  }

  const selectedInput = selectedPoll ? (voteInputs[selectedPoll.id] || { option: 0, amount: '' }) : { option: 0, amount: '' }
  const selectedResults = selectedPoll?.results || []
  const selectedTotalWeight = selectedResults.reduce((sum, result) => sum + (result.weight || 0), 0)
  const selectedPhase = selectedPoll ? getPollPhase(selectedPoll, now) : 'closed'
  const selectedIsLive = selectedPhase === 'live'
  const selectedAlreadyVoted = selectedVote.voted
  const selectedCanWithdraw = Boolean(selectedPoll && address && selectedPhase === 'closed' && selectedVote.deposit > 0)
  const selectedWithdrawAmount = selectedPoll
    ? (withdrawInputs[selectedPoll.id] ?? (selectedVote.deposit > 0 ? String(selectedVote.deposit) : ''))
    : ''

  return (
    <div className="app-shell">
      <div className="ambient ambient-left"></div>
      <div className="ambient ambient-right"></div>

      <nav className="topbar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div className="brand-copy">
            <h1>heleolabs polls v1</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="nav-switch" role="tablist" aria-label="App views">
            <button
              className={`nav-pill ${view === 'polls' ? 'active' : ''}`}
              onClick={() => setView('polls')}
              type="button"
            >
              Polls
            </button>
            <button
              className={`nav-pill ${view === 'create' ? 'active' : ''}`}
              onClick={() => setView('create')}
              type="button"
            >
              Create
            </button>
          </div>

          {connected ? (
            <div className="wallet-chip">
              <div className="wallet-chip-copy">
                <span>{shortAddr(address)}</span>
              </div>
              <button className="ghost-btn" onClick={disconnect} type="button">
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={connect} disabled={connecting} type="button">
              {connecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </nav>

      <main className="page-frame">
        <section className="hero-panel">
          <div className="hero-copy">
            <span className="hero-eyebrow">Token-weighted decisions</span>
            <h2>{view === 'polls' ? 'Track the room, then zoom into each vote.' : 'Draft a proposal in a dedicated creation room.'}</h2>
            <p>
              {view === 'polls'
                ? 'The main board stays compact: live status, timing, token and momentum. Open any poll to inspect results and vote inside a focused dialog.'
                : 'Creation now lives on its own page so you can set dates, token rules and options without crowding the live board.'}
            </p>
          </div>

          <div className="hero-stats">
            <article className="stat-card">
              <span>Live now</span>
              <strong>{liveCount}</strong>
            </article>
            <article className="stat-card">
              <span>Upcoming</span>
              <strong>{upcomingCount}</strong>
            </article>
            <article className="stat-card stat-card-wide">
              <span>Contract</span>
              <strong>{contractId ? shortAddr(contractId) : 'Unset'}</strong>
            </article>
          </div>
        </section>

        {banner && <div className="notice error">{banner}</div>}
        {status && <div className={`notice ${isSuccess ? 'success' : 'error'}`}>{status}</div>}
        {error && <div className="notice error">{error}</div>}
        <Toast
          visible={waitingWallet}
          type="wallet"
          message="Please check your wallet to approve the transaction."
        />
        <Toast
          visible={!waitingWallet && Boolean(pendingTx)}
          type="pending"
          message={pendingTx ? `${pendingTx.label} submitted. Waiting for blockchain confirmation...` : ''}
        />

        {view === 'polls' ? (
          <section className="board-layout">
            <header className="section-heading">
              <div>
                <span className="section-kicker">Main board</span>
                <h3>Poll overview</h3>
              </div>
              <button className="btn btn-outline" onClick={loadPolls} disabled={!isReady || loading} type="button">
                {loading ? 'Syncing...' : 'Refresh'}
              </button>
            </header>

            <div className="poll-grid">
              {sortedPolls.length === 0 && !loading && (
                <div className="empty-state">
                  No polls yet. Open the create page and publish the first one.
                </div>
              )}

              {sortedPolls.map((poll) => {
                const phase = getPollPhase(poll, now)
                const results = poll.results || []
                const totalWeight = results.reduce((sum, result) => sum + (result.weight || 0), 0)
                const leadingResult = totalWeight > 0
                  ? results.reduce((best, current) => (best.weight > current.weight ? best : current))
                  : null

                return (
                  <article key={poll.id} className={`poll-summary-card ${phase}`}>
                    <div className="poll-summary-topline">
                      <span className={`phase-chip ${phase}`}>{phase}</span>
                      <span className="poll-summary-id">Poll #{poll.id + 1}</span>
                    </div>

                    <div className="poll-summary-copy">
                      <h3>{poll.title}</h3>
                      <p>{poll.description || 'No description provided.'}</p>
                    </div>

                    <div className="poll-summary-meta">
                      <span>Token {poll.token_uid === '00' ? 'HTR' : shortAddr(poll.token_uid)}</span>
                      <span>{poll.weighting}</span>
                      <span>{phase === 'upcoming' ? `Opens ${formatDateTime(poll.start_at)}` : `Closes ${formatDateTime(poll.end_at)}`}</span>
                    </div>

                    <div className="poll-summary-footer">
                      <div className="poll-summary-signal">
                        <span>Momentum</span>
                        <strong>{leadingResult ? `${leadingResult.option} · ${leadingResult.weight} Wt` : 'No votes yet'}</strong>
                      </div>
                      <button
                        className="btn btn-outline"
                        onClick={() => setSelectedPollId(poll.id)}
                        type="button"
                      >
                        Show More
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ) : (
          <section className="create-layout">
            <div className="create-panel">
              <header className="section-heading stacked">
                <div>
                  <span className="section-kicker">Creation room</span>
                  <h3>Publish a new poll</h3>
                </div>
                <p>Pick when voting starts, set duration in days, and every vote will use linear weighting.</p>
              </header>

              <form className="create-form" onSubmit={handleCreate}>
                <div className="field">
                  <label className="field-label">Title</label>
                  <input
                    className="input"
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    placeholder="Should the treasury fund the next release?"
                    required
                  />
                </div>

                <div className="field">
                  <label className="field-label">Description</label>
                  <textarea
                    className="textarea"
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    placeholder="Set context, constraints or the expected outcome."
                  />
                </div>

                <div className="field">
                  <label className="field-label">Options</label>
                  <div className="option-stack">
                    {options.map((option, index) => (
                      <div key={index} className="option-row">
                        <input
                          className="input"
                          value={option}
                          onChange={(event) => handleOptionChange(index, event.target.value)}
                          placeholder={`Option ${index + 1}`}
                          required
                        />
                        {options.length > 2 && (
                          <button className="icon-btn" onClick={() => removeOption(index)} type="button">
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    {options.length < 8 && (
                      <button className="add-option-btn" onClick={addOption} type="button">
                        Add option
                      </button>
                    )}
                  </div>
                </div>

                <div className="form-grid">
                  <div className="field">
                    <label className="field-label">Token UID</label>
                    <input
                      className="input"
                      value={form.tokenUid}
                      onChange={(event) => setForm({ ...form, tokenUid: event.target.value })}
                      required
                    />
                  </div>

                  <div className="field">
                    <label className="field-label">Start</label>
                    <div className="start-preset">
                      <button
                        className={`preset-btn ${form.startPreset === 'today' ? 'active' : ''}`}
                        onClick={() => setForm({ ...form, startPreset: 'today' })}
                        type="button"
                      >
                        Today
                      </button>
                      <button
                        className={`preset-btn ${form.startPreset === 'tomorrow' ? 'active' : ''}`}
                        onClick={() => setForm({ ...form, startPreset: 'tomorrow' })}
                        type="button"
                      >
                        Tomorrow
                      </button>
                      <button
                        className={`preset-btn ${form.startPreset === 'custom' ? 'active' : ''}`}
                        onClick={() => setForm({ ...form, startPreset: 'custom' })}
                        type="button"
                      >
                        Custom
                      </button>
                    </div>
                  </div>

                  <div className="field">
                    <label className="field-label">Duration (days)</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      step={1}
                      value={form.durationDays}
                      onChange={(event) => setForm({ ...form, durationDays: event.target.value })}
                      required
                    />
                  </div>

                  {form.startPreset === 'custom' && (
                    <div className="field">
                      <label className="field-label">Custom Start Date</label>
                      <input
                        className="input"
                        type="date"
                        value={form.customStartDate}
                        onChange={(event) => setForm({ ...form, customStartDate: event.target.value })}
                        required
                      />
                    </div>
                  )}

                  <div className="field">
                    <label className="field-label">Calculated End</label>
                    <div className="calculated-date">
                      {createWindow.error
                        ? createWindow.error
                        : `${formatDateTime(createWindow.startAt)} → ${formatDateTime(createWindow.endAt)}`}
                    </div>
                  </div>

                  <div className="field">
                    <label className="field-label">Weighting</label>
                    <div className="calculated-date">Linear only (weight = deposited amount)</div>
                  </div>
                </div>

                <div className="create-actions">
                  <button className="btn btn-outline" onClick={() => setView('polls')} type="button">
                    Back to Polls
                  </button>
                  <button className="btn btn-primary" type="submit" disabled={waitingWallet || Boolean(pendingTx)}>
                    Publish Poll
                  </button>
                </div>
              </form>
            </div>

            <aside className="create-aside">
              <div className="aside-card">
                <span className="section-kicker">Checklist</span>
                <h3>Before you publish</h3>
                <ul className="aside-list">
                  <li>Is this the correct token [UID] for voters to deposit?</li>
                  <li>Want to announce it today but start it later? Pick a future date.</li>
                  <li>The more you lock, the more your vote means.</li>
                </ul>
              </div>

              <div className="aside-card">
                <span className="section-kicker">Live config</span>
                <h3>Current wiring</h3>
                <div className="aside-metadata">
                  <span>Blueprint</span>
                  <strong>{blueprintId ? shortAddr(blueprintId) : 'Unset'}</strong>
                  <span>Contract</span>
                  <strong>{contractId ? shortAddr(contractId) : 'Unset'}</strong>
                </div>
              </div>
            </aside>
          </section>
        )}
      </main>

      {selectedPoll && (
        <div className="dialog-backdrop" onClick={() => setSelectedPollId(null)} role="presentation">
          <div
            className="poll-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`poll-dialog-title-${selectedPoll.id}`}
          >
            <div className="dialog-header">
              <div>
                <span className="section-kicker">Poll details</span>
                <h3 id={`poll-dialog-title-${selectedPoll.id}`}>{selectedPoll.title}</h3>
                <p>{selectedPoll.description || 'No description provided.'}</p>
              </div>
              <button className="icon-btn close-btn" onClick={() => setSelectedPollId(null)} type="button">
                Close
              </button>
            </div>

            <div className="dialog-meta-grid">
              <div className="meta-panel">
                <span>Status</span>
                <strong>{selectedPhase}</strong>
              </div>
              <div className="meta-panel">
                <span>Voting window</span>
                <strong>{formatDateTime(selectedPoll.start_at)} to {formatDateTime(selectedPoll.end_at)}</strong>
              </div>
              <div className="meta-panel">
                <span>Token + model</span>
                <strong>{selectedPoll.token_uid === '00' ? 'HTR' : shortAddr(selectedPoll.token_uid)} · {selectedPoll.weighting}</strong>
              </div>
            </div>

            <div className="dialog-body">
              <section className="dialog-column">
                <h4>Current result</h4>
                <div className="results-list compact">
                  {selectedResults.map((result, index) => {
                    const pct = selectedTotalWeight ? Math.round((result.weight / selectedTotalWeight) * 100) : 0
                    return (
                      <div key={`${selectedPoll.id}-dialog-result-${index}`} className="result-item">
                        <div className="result-info">
                          <span className="result-name">{result.option}</span>
                          <span className="result-stats">{result.weight} Wt · {result.votes} votes</span>
                        </div>
                        <div className="result-bar-bg">
                          <div className="result-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="dialog-column vote-panel">
                <h4>Vote</h4>
                <div className="vote-options-grid">
                  {selectedPoll.options.map((option, index) => (
                    <button
                      key={`${selectedPoll.id}-dialog-option-${index}`}
                      className={`vote-option-btn ${selectedInput.option === index ? 'selected' : ''}`}
                      onClick={() => setVoteInputs((previous) => ({ ...previous, [selectedPoll.id]: { ...selectedInput, option: index } }))}
                      type="button"
                    >
                      <span>{option}</span>
                      <div className="vote-option-radio"></div>
                    </button>
                  ))}
                </div>

                <div className="vote-submit-row">
                  <input
                    type="number"
                    className="input"
                    placeholder="Amount to deposit"
                    value={selectedInput.amount}
                    onChange={(event) => setVoteInputs((previous) => ({
                      ...previous,
                      [selectedPoll.id]: { ...selectedInput, amount: event.target.value },
                    }))}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={() => handleVote(selectedPoll)}
                    disabled={
                      !selectedIsLive ||
                      !selectedInput.amount ||
                      waitingWallet ||
                      Boolean(pendingTx) ||
                      checkingVoteStatus ||
                      selectedAlreadyVoted
                    }
                    type="button"
                  >
                    Vote
                  </button>
                </div>

                {checkingVoteStatus && (
                  <div className="dialog-note">
                    Checking your vote status...
                  </div>
                )}

                {selectedAlreadyVoted && (
                  <div className="dialog-note">
                    You already voted in this poll with this wallet for {selectedVote.weight} weight.
                  </div>
                )}

                {selectedCanWithdraw && selectedPoll && (
                  <>
                    <div className="dialog-note">
                      Remaining deposit available to withdraw: {selectedVote.deposit} {selectedPoll.token_uid === '00' ? 'HTR' : shortAddr(selectedPoll.token_uid)}.
                    </div>
                    <div className="vote-submit-row">
                      <input
                        type="number"
                        className="input"
                        placeholder="Amount to withdraw"
                        value={selectedWithdrawAmount}
                        onChange={(event) => setWithdrawInputs((previous) => ({
                          ...previous,
                          [selectedPoll.id]: event.target.value,
                        }))}
                      />
                      <button
                        className="btn btn-outline"
                        onClick={() => handleWithdraw(selectedPoll)}
                        disabled={
                          !selectedWithdrawAmount ||
                          waitingWallet ||
                          Boolean(pendingTx) ||
                          checkingVoteStatus
                        }
                        type="button"
                      >
                        Withdraw
                      </button>
                    </div>
                  </>
                )}

                {selectedPhase === 'closed' && selectedAlreadyVoted && selectedVote.deposit === 0 && (
                  <div className="dialog-note">
                    Your deposited voting balance for this poll has already been withdrawn.
                  </div>
                )}

                {!selectedIsLive && (
                  <div className="dialog-note">
                    {selectedPhase === 'upcoming'
                      ? `Voting opens ${formatDateTime(selectedPoll.start_at)}`
                      : `Voting closed ${formatDateTime(selectedPoll.end_at)}`}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <span>Hathor Network Polls. Fully on-chain.</span>
        <span>Blueprint {blueprintId ? shortAddr(blueprintId) : 'Unset'} · Contract {contractId ? shortAddr(contractId) : 'Unset'}</span>
      </footer>
    </div>
  )
}

export default PollApp
