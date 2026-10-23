import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from './states'

interface Props {
  children: ReactNode
  /** Changing this value clears a caught error (e.g. the route or the active tab). */
  resetKey?: string
  label?: string
}

/** Catches a render crash in its subtree and shows the message instead of a blank page. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="rounded-card border bg-card">
        <ErrorState
          title={this.props.label ? `${this.props.label} could not be displayed` : 'This page could not be displayed'}
          message={error.message || 'Unexpected error'}
          onRetry={() => this.setState({ error: null })}
        />
      </div>
    )
  }
}
