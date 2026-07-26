import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error('[ErrorBoundary] Caught runtime error:', error, errorInfo);
  }

  render() {
    const { error, errorInfo } = this.state;
    if (!error) return this.props.children;

    const isDev = import.meta.env.DEV;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f8fafc',
          padding: '2rem',
        }}
      >
        <div
          style={{
            maxWidth: 640,
            width: '100%',
            background: '#fff',
            border: '1px solid #fee2e2',
            borderRadius: 8,
            padding: '2rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}
        >
          <h1 style={{ color: '#dc2626', marginTop: 0, fontSize: '1.25rem' }}>
            Something went wrong
          </h1>
          {isDev ? (
            <>
              <p style={{ color: '#374151', fontWeight: 600 }}>{error.message}</p>
              <pre
                style={{
                  background: '#f1f5f9',
                  borderRadius: 4,
                  padding: '1rem',
                  overflowX: 'auto',
                  fontSize: '0.8rem',
                  color: '#1e293b',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {error.stack}
                {errorInfo?.componentStack && (
                  <>
                    {'\n\nComponent Stack:'}
                    {errorInfo.componentStack}
                  </>
                )}
              </pre>
            </>
          ) : (
            <p style={{ color: '#6b7280' }}>
              An unexpected error occurred. Please refresh the page or contact support.
            </p>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
