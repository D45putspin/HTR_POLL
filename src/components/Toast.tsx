import React from 'react'

interface ToastProps {
  visible: boolean
  type: 'pending' | 'wallet' | 'success' | 'error'
  message: string
  onDismiss?: () => void
}

const Toast: React.FC<ToastProps> = ({ visible, type, message, onDismiss }) => {
  if (!visible) return null

  const icons = {
    pending: (
      <svg className="toast-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
      </svg>
    ),
    wallet: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M16 12h.01" />
      </svg>
    ),
    success: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  }

  return (
    <>
      <div className="toast-container">
        <div className="toast-content">
          <div className="toast-icon">{icons[type]}</div>
          <span className="toast-message">{message}</span>
          {onDismiss && (
            <button className="toast-dismiss" onClick={onDismiss}>×</button>
          )}
        </div>
      </div>

      <style>{`
        .toast-container {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 10000;
          animation: toastSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: auto;
        }

        .toast-content {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 20px;
          background: rgba(0, 0, 0, 0.92);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          backdrop-filter: blur(12px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
          color: white;
          font-size: 14px;
          font-weight: 500;
          min-width: 280px;
          max-width: calc(100vw - 48px);
        }

        .toast-icon {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.9;
        }

        .toast-message {
          flex: 1;
          line-height: 1.4;
        }

        .toast-dismiss {
          flex-shrink: 0;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          color: rgba(255, 255, 255, 0.7);
          width: 24px;
          height: 24px;
          border-radius: 6px;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .toast-dismiss:hover {
          background: rgba(255, 255, 255, 0.2);
          color: white;
        }

        .toast-spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes toastSlideUp {
          from {
            transform: translateX(-50%) translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @media (max-width: 640px) {
          .toast-container {
            left: 0;
            right: 0;
            bottom: 0;
            transform: none;
            animation: toastSlideUpMobile 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          }

          .toast-content {
            border-radius: 0;
            max-width: 100%;
            width: 100%;
            padding: 16px 20px;
            border-left: none;
            border-right: none;
            border-bottom: none;
          }

          @keyframes toastSlideUpMobile {
            from {
              transform: translateY(100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
        }
      `}</style>
    </>
  )
}

export default Toast
