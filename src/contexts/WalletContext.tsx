import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { ACTIVE_HATHOR_NETWORK } from '../config/network'
import { WalletConnectService } from '../services/walletconnect'

const WALLET_ADDRESS_STORAGE_KEY = 'poll.wallet.address'

export interface WalletContextValue {
  connected: boolean
  address: string | null
  balance: number | null
  connecting: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  signNanoContractTx: (txData: {
    method: string
    args: unknown[]
    actions?: any[]
    ncId?: string | null
    blueprintId?: string | null
  }) => Promise<{ txId: string }>
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined)

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connected, setConnected] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const restore = async () => {
        try {
          const client = await WalletConnectService.init()
          const sessions = client.session.getAll()
          if (sessions.length === 0) {
            WalletConnectService.setCurrentSession(null)
            return
          }

          const lastSession = sessions[sessions.length - 1]
          const hathorNamespace = WalletConnectService.getHathorNamespace(lastSession)
          const methods = hathorNamespace?.methods || []
          const matchesActiveChain =
            hathorNamespace?.chains?.includes(ACTIVE_HATHOR_NETWORK.chainId) ||
            (hathorNamespace?.accounts || []).some((account: string) =>
              account.startsWith(`${ACTIVE_HATHOR_NETWORK.chainId}:`),
            )

          if (!methods.includes('htr_sendNanoContractTx') || !matchesActiveChain) {
            WalletConnectService.setCurrentSession(null)
            return
          }

          WalletConnectService.setCurrentSession(lastSession)
          const storedAddress = typeof window !== 'undefined'
            ? window.localStorage.getItem(WALLET_ADDRESS_STORAGE_KEY)
            : null
          const addr = WalletConnectService.getAddressFromSession(lastSession) || storedAddress

          setConnected(true)
          if (addr) {
            setAddress(addr)
            try {
              const bal = await WalletConnectService.getBalance()
              setBalance(bal.available)
            } catch {
              setBalance(null)
            }
          }
        } catch {
          // ignore restore errors
        }
    }
    restore()
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    setConnecting(true)
    try {
      const { address: walletAddress } = await WalletConnectService.connect()
      WalletConnectService.closeModal()
      if (typeof window !== 'undefined' && walletAddress) {
        window.localStorage.setItem(WALLET_ADDRESS_STORAGE_KEY, walletAddress)
      }
      setAddress(walletAddress)
      setConnected(true)
      try {
        const bal = await WalletConnectService.getBalance()
        setBalance(bal.available)
      } catch {
        setBalance(null)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to connect')
      WalletConnectService.closeModal()
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await WalletConnectService.disconnect()
    } finally {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(WALLET_ADDRESS_STORAGE_KEY)
      }
      setConnected(false)
      setAddress(null)
      setBalance(null)
    }
  }, [])

  const signNanoContractTx = useCallback(async (txData: {
    method: string
    args: unknown[]
    actions?: any[]
    ncId?: string | null
    blueprintId?: string | null
  }) => {
    if (!connected) {
      throw new Error('Wallet not connected')
    }
    return WalletConnectService.signNanoContractTx(txData)
  }, [connected])

  return (
    <WalletContext.Provider
      value={{
        connected,
        address,
        balance,
        connecting,
        error,
        connect,
        disconnect,
        signNanoContractTx,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export const useWallet = () => {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}
